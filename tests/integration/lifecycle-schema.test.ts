import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { isMessageVisibleForToken, statusMessageWhere } from "@/lib/tickets/status-visibility";
import {
  seedContactTicket,
  seedMessage,
  seedOrgWithMembers,
  seedRelation,
} from "../support/lifecycle-fixtures";

/** Draws one value from the Message seq sequence, as the merge does under the row locks. */
async function drawMergeMarker(): Promise<bigint> {
  const rows = await prisma.$queryRaw<{ v: bigint }[]>`
    SELECT nextval(pg_get_serial_sequence('"Message"', 'seq')) AS v`;
  return BigInt(rows[0].v);
}

/** Full text of a Prisma or pg adapter error, including meta and the cause chain. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; meta?: unknown; cause?: unknown };
    parts.push(String(e.code ?? ""), String(e.message ?? current), JSON.stringify(e.meta ?? {}));
    current = e.cause;
  }
  return parts.join(" ");
}

/** Resolves with the error text when the promise rejects; fails the test when it resolves. */
async function rejection(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return errorText(err);
  }
  throw new Error("expected the operation to be rejected");
}

async function twoTickets(label: string) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  const email = `lc-${label}-${randomUUID()}@example.test`;
  const a = await seedContactTicket(orgId, { contactEmail: email });
  const b = await seedContactTicket(orgId, { contactEmail: email });
  return { orgId, userId: users[0].id, a, b };
}

describe("Phase 12 schema: TicketRelation", () => {
  it("writes a relation through scopedDb(orgA) and reads it back", async () => {
    const { orgId, userId, a, b } = await twoTickets("roundtrip");
    const db = scopedDb(orgId);

    const created = await db.ticketRelation.create({
      data: {
        organizationId: orgId,
        type: "RELATED_TO",
        fromTicketId: a.id,
        toTicketId: b.id,
        createdById: userId,
      },
    });
    const rows = await db.ticketRelation.findMany({ where: { fromTicketId: a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      organizationId: orgId,
      type: "RELATED_TO",
      fromTicketId: a.id,
      toTicketId: b.id,
      createdById: userId,
    });
  });

  it("refuses B->A after A->B, A->B twice and a second type on the same pair (TicketRelation_pair_key)", async () => {
    const { orgId, userId, a, b } = await twoTickets("pair");
    await seedRelation(prisma, orgId, {
      type: "RELATED_TO",
      fromTicketId: a.id,
      toTicketId: b.id,
      createdById: userId,
    });

    for (const attempt of [
      { type: "RELATED_TO" as const, fromTicketId: b.id, toTicketId: a.id },
      { type: "RELATED_TO" as const, fromTicketId: a.id, toTicketId: b.id },
      { type: "DUPLICATE_OF" as const, fromTicketId: a.id, toTicketId: b.id },
      { type: "CHILD_OF" as const, fromTicketId: b.id, toTicketId: a.id },
    ]) {
      const text = await rejection(
        seedRelation(prisma, orgId, { ...attempt, createdById: userId }),
      );
      expect(text).toMatch(/P2002|23505|unique/i);
      expect(text).toContain("TicketRelation_pair_key");
    }
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("refuses a self-link (TicketRelation_no_self_check)", async () => {
    const { orgId, userId, a } = await twoTickets("self");
    const text = await rejection(
      seedRelation(prisma, orgId, {
        type: "RELATED_TO",
        fromTicketId: a.id,
        toTicketId: a.id,
        createdById: userId,
      }),
    );
    expect(text).toContain("TicketRelation_no_self_check");
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("resolves the Message.seq sequence through pg_get_serial_sequence", async () => {
    const rows = await prisma.$queryRaw<{ seq: string | null }[]>`
      SELECT pg_get_serial_sequence('"Message"', 'seq') AS seq`;
    expect(rows[0]?.seq).not.toBeNull();
  });
});

describe("Phase 12 provenance predicate on real rows (D-09 amended, review C1)", () => {
  it("statusMessageWhere returns exactly what isMessageVisibleForToken accepts, for S and T", async () => {
    const { orgId, a: src, b: tgt } = await twoTickets("provenance");
    const other = await seedContactTicket(orgId, { contactEmail: `lc-c-${randomUUID()}@example.test` });

    // Pre-merge rows: on S (to be moved), on T, and on another ticket C (moved from C later).
    const sPub = await seedMessage(prisma, src.id, { visibility: "PUBLIC", direction: "INBOUND", withAttachment: true });
    const sInt = await seedMessage(prisma, src.id, { visibility: "INTERNAL", direction: "OUTBOUND" });
    const tPre = await seedMessage(prisma, tgt.id, { visibility: "PUBLIC", direction: "OUTBOUND" });
    const tPreTie = await seedMessage(prisma, tgt.id, { visibility: "PUBLIC", direction: "INBOUND" });
    const tPreInt = await seedMessage(prisma, tgt.id, { visibility: "INTERNAL", direction: "OUTBOUND" });
    const cPub = await seedMessage(prisma, other.id, { visibility: "PUBLIC", direction: "INBOUND" });

    // Stage the merge: marker drawn from the sequence, moved rows, merge fields on S.
    const marker = await drawMergeMarker();
    const mergedAt = new Date(Date.now() + 60_000);
    await prisma.message.updateMany({
      where: { id: { in: [sPub.id, sInt.id] } },
      data: { ticketId: tgt.id, mergedFromTicketId: src.id },
    });
    await prisma.message.update({
      where: { id: cPub.id },
      data: { ticketId: tgt.id, mergedFromTicketId: other.id },
    });
    await prisma.ticket.update({
      where: { id: src.id },
      data: { mergedIntoTicketId: tgt.id, mergedAt, mergeMessageSeq: marker, status: "CLOSED" },
    });
    // A pre-merge T row whose createdAt equals the merge time: still below the marker.
    await prisma.message.update({ where: { id: tPreTie.id }, data: { createdAt: mergedAt } });

    // Post-merge rows; one carries a createdAt before the merge (a transaction that began earlier).
    const tPost = await seedMessage(prisma, tgt.id, {
      visibility: "PUBLIC",
      direction: "OUTBOUND",
      createdAt: new Date(mergedAt.getTime() - 3_600_000),
    });
    const tPostInt = await seedMessage(prisma, tgt.id, { visibility: "INTERNAL", direction: "OUTBOUND" });
    expect(tPost.seq > marker).toBe(true);
    expect(tPreTie.seq < marker).toBe(true);

    const sTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: src.id },
      select: { id: true, mergedIntoTicketId: true, mergeMessageSeq: true },
    });
    const tTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: tgt.id },
      select: { id: true, mergedIntoTicketId: true, mergeMessageSeq: true },
    });

    const all = await prisma.message.findMany({
      where: { ticketId: { in: [src.id, tgt.id, other.id] } },
      select: { id: true, ticketId: true, visibility: true, mergedFromTicketId: true, seq: true },
    });
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

    for (const ticket of [sTicket, tTicket]) {
      const viaWhere = await prisma.message.findMany({
        where: statusMessageWhere(ticket),
        select: { id: true },
      });
      const viaPredicate = all.filter((m) => isMessageVisibleForToken(ticket, m));
      expect(ids(viaWhere)).toEqual(ids(viaPredicate));
    }

    const sSees = ids(await prisma.message.findMany({ where: statusMessageWhere(sTicket), select: { id: true } }));
    const tSees = ids(await prisma.message.findMany({ where: statusMessageWhere(tTicket), select: { id: true } }));
    expect(sSees).toEqual([sPub.id, tPost.id].sort());
    expect(tSees).toContain(tPre.id);
    expect(tSees).toContain(tPreTie.id);
    expect(tSees).toContain(tPost.id);
    for (const hidden of [sPub.id, sInt.id, cPub.id, tPreInt.id, tPostInt.id]) {
      expect(tSees).not.toContain(hidden);
    }
    for (const hidden of [tPre.id, tPreTie.id, sInt.id, cPub.id, tPreInt.id, tPostInt.id]) {
      expect(sSees).not.toContain(hidden);
    }
    // A moved message keeps its createdAt and its seq; only ticketId and mergedFromTicketId change.
    const moved = await prisma.message.findUniqueOrThrow({ where: { id: sPub.id } });
    expect(moved.seq).toBe(sPub.seq);
    expect(moved.createdAt.getTime()).toBe(sPub.createdAt.getTime());
    expect(moved.ticketId).toBe(tgt.id);
  });
});
