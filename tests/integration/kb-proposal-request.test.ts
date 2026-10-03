// Phase 12.2, plan 12.2-04: the KB proposal request (AIDA-18, D-01, D-03, D-07, D-09, D-13,
// reviews C5 and R2-3), on a real Postgres through Testcontainers. Real organizations, members,
// tickets and states; only the app-side pg-boss client is replaced by a recording double, so no
// job is really queued and no LLM is called.
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isProposalJobPayload, KB_PROPOSAL_GENERATE_QUEUE } from "@/lib/kb/proposal-contract";
import { requestProposal } from "@/lib/kb/proposal-request";
import {
  seedOrgWithMembers,
  seedResolvedTicket,
  stateIdFor,
} from "../support/kb-proposal-fixtures";

// The recording double. `observe` reads the proposal through a separate client inside send, so
// a send issued before the transaction committed would find nothing.
const bossEnv = vi.hoisted(() => ({
  sends: [] as {
    queue: string;
    payload: unknown;
    seenStatus: string | null;
  }[],
  failSend: false,
  observe: null as null | ((payload: unknown) => Promise<string | null>),
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (queue: string, payload: unknown) => {
      const seenStatus = bossEnv.observe ? await bossEnv.observe(payload) : null;
      bossEnv.sends.push({ queue, payload, seenStatus });
      if (bossEnv.failSend) throw new Error("boss send failed (test double)");
      return "job-id";
    },
  }),
}));

let observerPool: pg.Pool;
let observer: PrismaClient;

beforeAll(() => {
  observerPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  observer = new PrismaClient({ adapter: new PrismaPg(observerPool) });
  bossEnv.observe = async (payload) => {
    const proposalId = (payload as { proposalId?: unknown }).proposalId;
    if (typeof proposalId !== "string") return null;
    const row = await observer.kbProposal.findUnique({
      where: { id: proposalId },
      select: { status: true },
    });
    return row?.status ?? null;
  };
});

afterAll(async () => {
  bossEnv.observe = null;
  await observer.$disconnect();
  await observerPool.end();
});

beforeEach(() => {
  bossEnv.sends = [];
  bossEnv.failSend = false;
});

async function enableAi(orgId: string, value = "true"): Promise<void> {
  await prisma.setting.create({ data: { organizationId: orgId, key: "aiEnabled", value } });
}

/** An organization with an owner, an admin and a plain member; AI on unless told otherwise. */
async function seedOrg(ai: "true" | "false" | "absent" = "true") {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
  if (ai !== "absent") await enableAi(orgId, ai);
  return {
    orgId,
    owner: { userId: users[0].id, orgId },
    admin: { userId: users[1].id, orgId },
    member: { userId: users[2].id, orgId },
    users,
  };
}

/** Asserts that a refused request left nothing behind: no proposal, no source, no job. */
async function expectNothingLeft(orgId: string): Promise<void> {
  expect(await prisma.kbProposal.count({ where: { organizationId: orgId } })).toBe(0);
  expect(await prisma.kbProposalSource.count({ where: { organizationId: orgId } })).toBe(0);
  expect(bossEnv.sends).toEqual([]);
}

/** Marks a ticket as merged into another one (CLOSED group, merge fields set together). */
async function markMerged(orgId: string, sourceId: string, targetId: string): Promise<void> {
  await prisma.ticket.update({
    where: { id: sourceId },
    data: {
      stateId: await stateIdFor(orgId, "CLOSED"),
      mergedIntoTicketId: targetId,
      mergedAt: new Date(),
      mergeMessageSeq: 1n,
    },
  });
}

describe("requestProposal: tracer (D-01, D-03, D-13, reviews C5 and R2-3)", () => {
  it("an owner requests a proposal from one resolved ticket; row, source and one job after commit", async () => {
    const { orgId, owner } = await seedOrg("absent");
    const ticket = await seedResolvedTicket(orgId);
    // AI switched on after seeding, so the ticket's own creation enqueued no triage job.
    await enableAi(orgId);
    bossEnv.sends = [];
    const now = new Date("2026-11-09T08:00:00.000Z");

    const result = await requestProposal(owner, [ticket.id], { now: () => now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proposal = await prisma.kbProposal.findUniqueOrThrow({
      where: { id: result.proposalId },
      select: {
        organizationId: true,
        status: true,
        version: true,
        generationEpoch: true,
        requestedByUserId: true,
        generationQueuedAt: true,
        generationClaimedAt: true,
        title: true,
        bodyMarkdown: true,
      },
    });
    expect(proposal).toEqual({
      organizationId: orgId,
      status: "GENERATING",
      version: 0,
      generationEpoch: 1,
      requestedByUserId: owner.userId,
      generationQueuedAt: now,
      generationClaimedAt: null,
      title: null,
      bodyMarkdown: null,
    });

    const sources = await prisma.kbProposalSource.findMany({
      where: { organizationId: orgId, proposalId: result.proposalId },
      select: { ticketId: true, position: true, snapshotSeq: true },
    });
    expect(sources).toEqual([{ ticketId: ticket.id, position: 1, snapshotSeq: null }]);

    expect(bossEnv.sends).toHaveLength(1);
    const [send] = bossEnv.sends;
    expect(send.queue).toBe(KB_PROPOSAL_GENERATE_QUEUE);
    expect(send.payload).toStrictEqual({ proposalId: result.proposalId, epoch: 1 });
    expect(Object.keys(send.payload as object).sort()).toEqual(["epoch", "proposalId"]);
    expect(isProposalJobPayload(send.payload)).toBe(true);
    // The epoch is the created row's generationEpoch.
    expect((send.payload as { epoch: number }).epoch).toBe(proposal.generationEpoch);
    // Sent after commit: a separate client already saw the GENERATING row inside send.
    expect(send.seenStatus).toBe("GENERATING");
  });
});

describe("requestProposal: membership and role first (D-01, T-12.2-15)", () => {
  it("a session whose member row was deleted gets MEMBERSHIP_ENDED before any other check", async () => {
    // AI off and an empty selection: membership must still be the reason.
    const { orgId, users } = await seedOrg("false");
    await prisma.member.delete({ where: { id: users[1].memberId } });

    const result = await requestProposal({ userId: users[1].id, orgId }, []);

    expect(result).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
    await expectNothingLeft(orgId);
  });

  it("a plain member gets NOT_ALLOWED before the count, AI and eligibility checks", async () => {
    const { orgId, member } = await seedOrg("false");

    const result = await requestProposal(member, []);

    expect(result).toEqual({ ok: false, code: "NOT_ALLOWED" });
    await expectNothingLeft(orgId);
  });

  it("a plain member with a valid selection and AI on is still NOT_ALLOWED", async () => {
    const { orgId, member } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    bossEnv.sends = [];

    const result = await requestProposal(member, [ticket.id]);

    expect(result).toEqual({ ok: false, code: "NOT_ALLOWED" });
    await expectNothingLeft(orgId);
  });

  it("a user of another organization is MEMBERSHIP_ENDED for this one", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const ticket = await seedResolvedTicket(a.orgId);
    bossEnv.sends = [];

    const result = await requestProposal({ userId: b.owner.userId, orgId: a.orgId }, [ticket.id]);

    expect(result).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
    await expectNothingLeft(a.orgId);
    await expectNothingLeft(b.orgId);
  });
});

describe("requestProposal: count 1 to 5 (edge AIDA-18 empty)", () => {
  it("zero ticket ids get COUNT, even with AI off (count before AI)", async () => {
    const { orgId, owner } = await seedOrg("false");

    const result = await requestProposal(owner, []);

    expect(result).toEqual({ ok: false, code: "COUNT" });
    await expectNothingLeft(orgId);
  });

  it("six ticket ids get COUNT", async () => {
    const { orgId, admin } = await seedOrg();
    const tickets = [];
    for (let i = 0; i < 6; i += 1) tickets.push(await seedResolvedTicket(orgId));
    bossEnv.sends = [];

    const result = await requestProposal(
      admin,
      tickets.map((t) => t.id),
    );

    expect(result).toEqual({ ok: false, code: "COUNT" });
    await expectNothingLeft(orgId);
  });

  it("exactly five eligible tickets are accepted, positions 1 to 5 in selection order", async () => {
    const { orgId, admin } = await seedOrg();
    const tickets = [];
    for (let i = 0; i < 5; i += 1) {
      tickets.push(
        await seedResolvedTicket(orgId, { status: i % 2 === 0 ? "RESOLVED" : "CLOSED" }),
      );
    }
    // A selection order that is not the creation order.
    const selected = [tickets[3], tickets[0], tickets[4], tickets[2], tickets[1]];
    bossEnv.sends = [];

    const result = await requestProposal(
      admin,
      selected.map((t) => t.id),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sources = await prisma.kbProposalSource.findMany({
      where: { organizationId: orgId, proposalId: result.proposalId },
      orderBy: { position: "asc" },
      select: { ticketId: true, position: true },
    });
    expect(sources).toEqual(selected.map((t, i) => ({ ticketId: t.id, position: i + 1 })));
    expect(bossEnv.sends).toHaveLength(1);
    expect(bossEnv.sends[0].payload).toStrictEqual({ proposalId: result.proposalId, epoch: 1 });
  });
});

describe("requestProposal: AI off (D-09)", () => {
  it("aiEnabled 'false' gets AI_OFF", async () => {
    const { orgId, owner } = await seedOrg("false");
    const ticket = await seedResolvedTicket(orgId);
    bossEnv.sends = [];

    const result = await requestProposal(owner, [ticket.id]);

    expect(result).toEqual({ ok: false, code: "AI_OFF" });
    await expectNothingLeft(orgId);
  });

  it("an absent aiEnabled setting gets AI_OFF, before the eligibility check", async () => {
    const { orgId, owner } = await seedOrg("absent");
    const open = await seedResolvedTicket(orgId, { status: "OPEN" });

    const result = await requestProposal(owner, [open.id]);

    expect(result).toEqual({ ok: false, code: "AI_OFF" });
    await expectNothingLeft(orgId);
  });
});

describe("requestProposal: eligibility by group, whole refusal (D-07, owner item 12.2-o3)", () => {
  it("PENDING, OPEN, merged and another organization's ticket are refused with one reason each", async () => {
    const { orgId, owner } = await seedOrg();
    const other = await seedOrg();
    const resolved = await seedResolvedTicket(orgId);
    const pending = await seedResolvedTicket(orgId, { status: "PENDING" });
    const open = await seedResolvedTicket(orgId, { status: "OPEN" });
    const target = await seedResolvedTicket(orgId, { status: "OPEN" });
    const merged = await seedResolvedTicket(orgId);
    await markMerged(orgId, merged.id, target.id);
    const foreign = await seedResolvedTicket(other.orgId);
    bossEnv.sends = [];

    const result = await requestProposal(owner, [
      resolved.id,
      pending.id,
      open.id,
      merged.id,
      foreign.id,
    ]);

    expect(result).toEqual({
      ok: false,
      code: "SELECTION",
      refusals: [
        { ticketId: pending.id, reason: "NOT_RESOLVED" },
        { ticketId: open.id, reason: "NOT_RESOLVED" },
        { ticketId: merged.id, reason: "MERGED", mergedIntoNumber: target.number },
        { ticketId: foreign.id, reason: "NOT_FOUND" },
      ],
    });
    await expectNothingLeft(orgId);
    await expectNothingLeft(other.orgId);
  });

  it("a repeated id is DUPLICATE on its second occurrence; an unknown id is NOT_FOUND like a foreign one", async () => {
    const { orgId, admin } = await seedOrg();
    const closed = await seedResolvedTicket(orgId, { status: "CLOSED" });
    const resolved = await seedResolvedTicket(orgId);
    const unknownId = "c-no-such-ticket-0000000000";
    bossEnv.sends = [];

    const result = await requestProposal(admin, [closed.id, resolved.id, unknownId, closed.id]);

    expect(result).toEqual({
      ok: false,
      code: "SELECTION",
      refusals: [
        { ticketId: unknownId, reason: "NOT_FOUND" },
        { ticketId: closed.id, reason: "DUPLICATE" },
      ],
    });
    await expectNothingLeft(orgId);
  });

  it("a RESOLVED ticket and a CLOSED ticket together are accepted", async () => {
    const { orgId, owner } = await seedOrg();
    const resolved = await seedResolvedTicket(orgId);
    const closed = await seedResolvedTicket(orgId, { status: "CLOSED" });
    bossEnv.sends = [];

    const result = await requestProposal(owner, [resolved.id, closed.id]);

    expect(result.ok).toBe(true);
    expect(await prisma.kbProposalSource.count({ where: { organizationId: orgId } })).toBe(2);
    expect(bossEnv.sends).toHaveLength(1);
  });

  it("the group decides, never the name: a custom RESOLVED-group state is eligible, an OPEN state named 'Resolved' is not", async () => {
    const { orgId, owner } = await seedOrg();
    // Free the name 'Resolved' (active names are unique per organization), then reuse it on an
    // OPEN-group state, and add an admin-created state of the RESOLVED group with another name.
    const defaultResolvedId = await stateIdFor(orgId, "RESOLVED");
    await prisma.ticketState.update({
      where: { id: defaultResolvedId },
      data: { name: "Done (default)" },
    });
    const misnamed = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Resolved",
        colorToken: "blue",
        group: "OPEN",
        sortOrder: 9,
      },
    });
    const custom = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Fixed by vendor",
        colorToken: "green",
        group: "RESOLVED",
        sortOrder: 9,
      },
    });
    const inCustom = await seedResolvedTicket(orgId, { stateId: custom.id });
    const inMisnamed = await seedResolvedTicket(orgId, { stateId: misnamed.id });
    bossEnv.sends = [];

    const refused = await requestProposal(owner, [inCustom.id, inMisnamed.id]);
    expect(refused).toEqual({
      ok: false,
      code: "SELECTION",
      refusals: [{ ticketId: inMisnamed.id, reason: "NOT_RESOLVED" }],
    });
    await expectNothingLeft(orgId);

    const accepted = await requestProposal(owner, [inCustom.id]);
    expect(accepted.ok).toBe(true);
    expect(bossEnv.sends).toHaveLength(1);
  });
});

describe("requestProposal: enqueue failure after commit (D-13, pattern S5, T-12.2-19)", () => {
  it("a send that throws still returns ok; the proposal stays GENERATING; the log holds the id only", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    bossEnv.sends = [];
    bossEnv.failSend = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const now = new Date("2026-11-09T09:30:00.000Z");

    let result: Awaited<ReturnType<typeof requestProposal>>;
    try {
      result = await requestProposal(owner, [ticket.id], { now: () => now });
      expect(logged.mock.calls).toEqual([
        [`kb-proposal-request: enqueue failed for ${result.ok ? result.proposalId : "?"}`],
      ]);
    } finally {
      logged.mockRestore();
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The send was attempted once, after commit.
    expect(bossEnv.sends).toHaveLength(1);
    expect(bossEnv.sends[0].seenStatus).toBe("GENERATING");
    const proposal = await prisma.kbProposal.findUniqueOrThrow({
      where: { id: result.proposalId },
      select: { status: true, generationQueuedAt: true, generationClaimedAt: true },
    });
    expect(proposal).toEqual({
      status: "GENERATING",
      generationQueuedAt: now,
      generationClaimedAt: null,
    });
    expect(await prisma.kbProposalSource.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
