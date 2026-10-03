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
import { seedOrgWithMembers, seedResolvedTicket } from "../support/kb-proposal-fixtures";

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
