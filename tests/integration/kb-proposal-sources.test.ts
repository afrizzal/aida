// Phase 12.2, plan 12.2-04: the KB proposal source module (AIDA-18, D-07, D-08, D-10, review P1),
// on a real Postgres through Testcontainers. Nothing is mocked: real organizations, tickets,
// states and messages. Seqs stay bigint end to end; no seq is converted to a number.
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { MAX_MESSAGES_PER_SOURCE } from "@/lib/kb/proposal-prompt";
import {
  findChangedSources,
  loadSourceInputs,
  recheckSourceEligibility,
} from "@/lib/kb/proposal-sources";
import {
  seedInternalNote,
  seedOrgWithMembers,
  seedProposal,
  seedPublicMessage,
  seedResolvedTicket,
  stateIdFor,
} from "../support/kb-proposal-fixtures";

async function freshOrg(): Promise<string> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  return orgId;
}

/**
 * A ticket in the given group whose thread is empty: the opening message createTicket writes is
 * removed, so each case controls every message (and every seq) of the ticket itself.
 */
async function seedBareTicket(
  orgId: string,
  status: "RESOLVED" | "CLOSED" | "OPEN" | "PENDING" = "RESOLVED",
): Promise<{ id: string; number: number; subject: string }> {
  const ticket = await seedResolvedTicket(orgId, { status });
  await prisma.message.deleteMany({ where: { organizationId: orgId, ticketId: ticket.id } });
  const { subject } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { subject: true },
  });
  return { ...ticket, subject };
}

async function moveToState(orgId: string, ticketId: string, key: "OPEN" | "CLOSED") {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { stateId: await stateIdFor(orgId, key) },
  });
}

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

/** JSON of a result with bigints written as strings, to search it for a text. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** A separate client that logs every statement it sends. */
async function withQueryLog<T>(
  run: (client: PrismaClient) => Promise<T>,
): Promise<{ result: T; queries: string[] }> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: [{ emit: "event", level: "query" }],
  });
  const queries: string[] = [];
  client.$on("query", (event) => {
    queries.push(event.query);
  });
  try {
    const result = await run(client);
    return { result, queries };
  } finally {
    await client.$disconnect();
    await pool.end();
  }
}

describe("loadSourceInputs: PUBLIC only, bounded, snapshot marker (D-08, D-10, T-12.2-17)", () => {
  it("returns the subject and PUBLIC bodies in seq order; the INTERNAL note appears nowhere", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    const first = await seedPublicMessage(orgId, ticket.id, "Customer: the export button fails");
    await seedInternalNote(orgId, ticket.id, "INTERNAL-ONLY-7f3a: call the vendor hotline");
    const third = await seedPublicMessage(orgId, ticket.id, "Agent: clear the cache, then retry");

    const loaded = await loadSourceInputs(prisma, orgId, [{ ticketId: ticket.id, position: 1 }]);

    expect(loaded.inputs).toEqual([
      {
        position: 1,
        subject: ticket.subject,
        messages: [
          { seq: first.seq, body: "Customer: the export button fails" },
          { seq: third.seq, body: "Agent: clear the cache, then retry" },
        ],
      },
    ]);
    expect(loaded.snapshots).toEqual({ [ticket.id]: third.seq });
    expect(typeof loaded.snapshots[ticket.id]).toBe("bigint");
    expect(serialize(loaded)).not.toContain("INTERNAL-ONLY-7f3a");
  });

  it("returns MAX_MESSAGES_PER_SOURCE + 1 of 25 PUBLIC messages and the 25th seq as snapshot", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    const seeded = [];
    for (let i = 1; i <= 25; i += 1) {
      seeded.push(await seedPublicMessage(orgId, ticket.id, `Message ${i}`));
    }

    const loaded = await loadSourceInputs(prisma, orgId, [{ ticketId: ticket.id, position: 1 }]);

    expect(MAX_MESSAGES_PER_SOURCE + 1).toBe(21);
    expect(loaded.inputs[0].messages).toHaveLength(21);
    expect(loaded.inputs[0].messages.map((m) => m.body)).toEqual(
      seeded.slice(0, 21).map((_m, i) => `Message ${i + 1}`),
    );
    // The ticket's largest PUBLIC seq, not the largest seq among the messages read.
    expect(loaded.snapshots[ticket.id]).toBe(seeded[24].seq);
    expect(loaded.snapshots[ticket.id]).not.toBe(seeded[20].seq);
  });

  it("returns no messages and snapshot null for a ticket with only a subject", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    await seedInternalNote(orgId, ticket.id, "Only an internal note");

    const loaded = await loadSourceInputs(prisma, orgId, [{ ticketId: ticket.id, position: 1 }]);

    expect(loaded.inputs).toEqual([{ position: 1, subject: ticket.subject, messages: [] }]);
    expect(loaded.snapshots).toEqual({ [ticket.id]: null });
  });

  it("returns the inputs in position order for three sources selected in a non-id order", async () => {
    const orgId = await freshOrg();
    const a = await seedBareTicket(orgId);
    const b = await seedBareTicket(orgId);
    const c = await seedBareTicket(orgId);
    await seedPublicMessage(orgId, a.id, "body a");
    await seedPublicMessage(orgId, b.id, "body b");
    await seedPublicMessage(orgId, c.id, "body c");

    // Positions reverse the creation order, and the argument order is neither.
    const loaded = await loadSourceInputs(prisma, orgId, [
      { ticketId: b.id, position: 2 },
      { ticketId: a.id, position: 3 },
      { ticketId: c.id, position: 1 },
    ]);

    expect(loaded.inputs.map((input) => [input.position, input.subject])).toEqual([
      [1, c.subject],
      [2, b.subject],
      [3, a.subject],
    ]);
    expect(loaded.inputs.map((input) => input.messages.map((m) => m.body))).toEqual([
      ["body c"],
      ["body b"],
      ["body a"],
    ]);
  });

  it("returns nothing for another organization's ticket ids (T-12.2-16)", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const ticket = await seedBareTicket(orgA);
    await seedPublicMessage(orgA, ticket.id, "Organization A secret body");

    const loaded = await loadSourceInputs(prisma, orgB, [{ ticketId: ticket.id, position: 1 }]);

    expect(loaded).toEqual({ inputs: [], snapshots: {} });
  });

  it("keeps seqs above 2^31 and 2^53 exact as bigint (review P1)", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    // Every message of this ticket on an explicit seq, inserted in reverse order.
    await seedPublicMessage(orgId, ticket.id, "later body", { seq: 9007199254740993n });
    await seedPublicMessage(orgId, ticket.id, "earlier body", { seq: 2147483653n });

    const loaded = await loadSourceInputs(prisma, orgId, [{ ticketId: ticket.id, position: 1 }]);

    const snapshot = loaded.snapshots[ticket.id];
    expect(typeof snapshot).toBe("bigint");
    expect(snapshot).toBe(9007199254740993n);
    expect(loaded.inputs[0].messages).toEqual([
      { seq: 2147483653n, body: "earlier body" },
      { seq: 9007199254740993n, body: "later body" },
    ]);
    expect(loaded.inputs[0].messages.map((m) => typeof m.seq)).toEqual(["bigint", "bigint"]);
  });
});

describe("recheckSourceEligibility: the request rule on stored sources (D-08)", () => {
  it("is ok for unchanged RESOLVED and CLOSED sources", async () => {
    const orgId = await freshOrg();
    const resolved = await seedBareTicket(orgId, "RESOLVED");
    const closed = await seedBareTicket(orgId, "CLOSED");
    const proposal = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [resolved.id, closed.id],
    });

    expect(await recheckSourceEligibility(prisma, orgId, proposal.id)).toEqual({ ok: true });
  });

  it("reports a source moved to an OPEN-group state, and reads no Message row", async () => {
    const orgId = await freshOrg();
    const kept = await seedBareTicket(orgId);
    const reopened = await seedBareTicket(orgId);
    await seedPublicMessage(orgId, kept.id, "public text");
    await seedInternalNote(orgId, reopened.id, "internal text");
    const proposal = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [kept.id, reopened.id],
    });
    await moveToState(orgId, reopened.id, "OPEN");

    const { result, queries } = await withQueryLog((client) =>
      recheckSourceEligibility(client, orgId, proposal.id),
    );

    expect(result).toEqual({
      ok: false,
      changed: [{ ticketId: reopened.id, reason: "NOT_RESOLVED" }],
    });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.filter((query) => query.includes('"Message"'))).toEqual([]);
  });

  it("reports a merged source", async () => {
    const orgId = await freshOrg();
    const target = await seedBareTicket(orgId, "OPEN");
    const source = await seedBareTicket(orgId);
    const other = await seedBareTicket(orgId, "CLOSED");
    const proposal = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [other.id, source.id],
    });
    await markMerged(orgId, source.id, target.id);

    const { result, queries } = await withQueryLog((client) =>
      recheckSourceEligibility(client, orgId, proposal.id),
    );

    expect(result).toEqual({ ok: false, changed: [{ ticketId: source.id, reason: "MERGED" }] });
    expect(queries.filter((query) => query.includes('"Message"'))).toEqual([]);
  });
});

describe("findChangedSources: eligibility and new PUBLIC messages after the snapshot (D-08)", () => {
  it("does not report a truncated 25-message source until one new PUBLIC message arrives", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    for (let i = 1; i <= 25; i += 1) await seedPublicMessage(orgId, ticket.id, `Message ${i}`);
    const loaded = await loadSourceInputs(prisma, orgId, [{ ticketId: ticket.id, position: 1 }]);
    // Stored as the generation job (plan 12.2-07) stores it.
    const proposal = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [ticket.id],
      inputTruncated: true,
      snapshotSeqs: [loaded.snapshots[ticket.id] ?? null],
    });

    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([]);

    await seedPublicMessage(orgId, ticket.id, "Message 26");
    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([ticket.number]);
  });

  it("reports a new PUBLIC message, a reopened and a merged source; not an INTERNAL-only change", async () => {
    const orgId = await freshOrg();
    const target = await seedBareTicket(orgId, "OPEN");
    const grown = await seedBareTicket(orgId);
    const reopened = await seedBareTicket(orgId);
    const merged = await seedBareTicket(orgId);
    const noted = await seedBareTicket(orgId, "CLOSED");
    const tickets = [grown, reopened, merged, noted];
    for (const ticket of tickets) await seedPublicMessage(orgId, ticket.id, "original public");
    const loaded = await loadSourceInputs(
      prisma,
      orgId,
      tickets.map((ticket, index) => ({ ticketId: ticket.id, position: index + 1 })),
    );
    const proposal = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: tickets.map((ticket) => ticket.id),
      snapshotSeqs: tickets.map((ticket) => loaded.snapshots[ticket.id] ?? null),
    });
    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([]);

    await seedPublicMessage(orgId, grown.id, "a new public reply");
    await moveToState(orgId, reopened.id, "OPEN");
    await markMerged(orgId, merged.id, target.id);
    await seedInternalNote(orgId, noted.id, "an internal note only");

    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([
      grown.number,
      reopened.number,
      merged.number,
    ]);
  });

  it("treats a null snapshot as no PUBLIC message: any PUBLIC message now is a change", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    const proposal = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [ticket.id],
      snapshotSeqs: [null],
    });
    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([]);

    await seedInternalNote(orgId, ticket.id, "internal only");
    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([]);

    await seedPublicMessage(orgId, ticket.id, "first public message");
    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([ticket.number]);
  });

  it("compares as bigint: a change from 2^53 to 2^53 + 1 is reported (review P1)", async () => {
    const orgId = await freshOrg();
    const ticket = await seedBareTicket(orgId);
    await seedPublicMessage(orgId, ticket.id, "at 2^53", { seq: 9007199254740992n });
    const loaded = await loadSourceInputs(prisma, orgId, [{ ticketId: ticket.id, position: 1 }]);
    expect(loaded.snapshots[ticket.id]).toBe(9007199254740992n);
    const proposal = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [ticket.id],
      snapshotSeqs: [9007199254740992n],
    });

    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([]);

    // Number(9007199254740993n) === Number(9007199254740992n): only a bigint comparison sees it.
    await seedPublicMessage(orgId, ticket.id, "at 2^53 + 1", { seq: 9007199254740993n });
    expect(await findChangedSources(prisma, orgId, proposal.id)).toEqual([ticket.number]);
  });

  it("finds nothing for a proposal of another organization", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const ticket = await seedBareTicket(orgA);
    const proposal = await seedProposal(orgA, {
      status: "DRAFT",
      ticketIds: [ticket.id],
      snapshotSeqs: [null],
    });
    await seedPublicMessage(orgA, ticket.id, "a public message after the snapshot");

    expect(await findChangedSources(prisma, orgB, proposal.id)).toEqual([]);
    expect(await findChangedSources(prisma, orgA, proposal.id)).toEqual([ticket.number]);
    expect(await recheckSourceEligibility(prisma, orgB, proposal.id)).toEqual({
      ok: false,
      changed: [],
    });
  });
});
