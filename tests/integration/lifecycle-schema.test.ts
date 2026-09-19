import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { isMessageVisibleForToken, statusMessageWhere } from "@/lib/tickets/status-visibility";
import { recordTicketAudit } from "@/lib/tickets/ticket-audit";
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
    const other = await seedContactTicket(orgId, {
      contactEmail: `lc-c-${randomUUID()}@example.test`,
    });

    // Pre-merge rows: on S (to be moved), on T, and on another ticket C (moved from C later).
    const sPub = await seedMessage(prisma, src.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      withAttachment: true,
    });
    const sInt = await seedMessage(prisma, src.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
    });
    const tPre = await seedMessage(prisma, tgt.id, { visibility: "PUBLIC", direction: "OUTBOUND" });
    const tPreTie = await seedMessage(prisma, tgt.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
    });
    const tPreInt = await seedMessage(prisma, tgt.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
    });
    const cPub = await seedMessage(prisma, other.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
    });

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
    const tPostInt = await seedMessage(prisma, tgt.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
    });
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

    const sSees = ids(
      await prisma.message.findMany({ where: statusMessageWhere(sTicket), select: { id: true } }),
    );
    const tSees = ids(
      await prisma.message.findMany({ where: statusMessageWhere(tTicket), select: { id: true } }),
    );
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

// Definitions captured from aida_p12_lifecycle before 20261109100000_ticket_lifecycle was applied
// (Task 1, review C8). Their origin is the hand-written migration 20260701234808_ticket_search;
// a later migration that drops or rewrites one of them fails the cases below (D-19).
const TICKET_SEARCH_EXPR = `(setweight(to_tsvector('simple'::regconfig, COALESCE((number)::text, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(subject, ''::text)), 'B'::"char"))`;
const MESSAGE_SEARCH_EXPR = `to_tsvector('english'::regconfig, COALESCE("bodyMarkdown", ''::text))`;
const TICKET_SEARCH_INDEXDEF = `CREATE INDEX "Ticket_searchVector_idx" ON public."Ticket" USING gin ("searchVector")`;
const MESSAGE_SEARCH_INDEXDEF = `CREATE INDEX "Message_searchVector_idx" ON public."Message" USING gin ("searchVector")`;

const NEW_ACTIONS = [
  "RELATION_ADDED",
  "RELATION_REMOVED",
  "MERGED_INTO",
  "MERGED_FROM",
  "SNOOZED",
  "WOKEN",
] as const;

describe("Phase 12 isolation (D-20)", () => {
  it("scopedDb(orgB) never reads, counts, updates or deletes A's TicketRelation rows", async () => {
    const { orgId: orgA, userId, a, b } = await twoTickets("iso-rel");
    const { orgId: orgB } = await seedOrgWithMembers(prisma, ["owner"]);
    const rel = await seedRelation(prisma, orgA, {
      type: "RELATED_TO",
      fromTicketId: a.id,
      toTicketId: b.id,
      createdById: userId,
    });
    const dbB = scopedDb(orgB);

    expect(await dbB.ticketRelation.findMany({ where: { id: rel.id } })).toEqual([]);
    expect(await dbB.ticketRelation.findFirst({ where: { fromTicketId: a.id } })).toBeNull();
    expect(await dbB.ticketRelation.count({ where: { toTicketId: b.id } })).toBe(0);
    expect(
      (await dbB.ticketRelation.updateMany({ where: { id: rel.id }, data: { type: "CHILD_OF" } }))
        .count,
    ).toBe(0);
    expect((await dbB.ticketRelation.deleteMany({ where: { id: rel.id } })).count).toBe(0);

    const still = await prisma.ticketRelation.findUniqueOrThrow({ where: { id: rel.id } });
    expect(still.type).toBe("RELATED_TO");
  });

  it("scopedDb(orgB) never changes or reads A's merge, snooze and provenance columns", async () => {
    const { a, b } = await twoTickets("iso-cols");
    const { orgId: orgB } = await seedOrgWithMembers(prisma, ["owner"]);
    const snoozedUntil = new Date(Date.now() + 86_400_000);
    const marker = await drawMergeMarker();
    await prisma.ticket.update({
      where: { id: a.id },
      data: { mergedIntoTicketId: b.id, mergedAt: new Date(), mergeMessageSeq: marker },
    });
    await prisma.ticket.update({ where: { id: b.id }, data: { snoozedUntil } });
    const message = await seedMessage(prisma, b.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      mergedFromTicketId: a.id,
    });
    const dbB = scopedDb(orgB);

    expect(
      (
        await dbB.ticket.updateMany({
          where: { id: { in: [a.id, b.id] } },
          data: { snoozedUntil: null },
        })
      ).count,
    ).toBe(0);
    expect(
      (
        await dbB.ticket.updateMany({
          where: { id: a.id },
          data: { mergedIntoTicketId: null, mergedAt: null, mergeMessageSeq: null },
        })
      ).count,
    ).toBe(0);
    expect(
      (await dbB.ticket.updateMany({ where: { id: a.id }, data: { mergeMessageSeq: marker + 1n } }))
        .count,
    ).toBe(0);
    expect(
      (
        await dbB.message.updateMany({
          where: { id: message.id },
          data: { mergedFromTicketId: null },
        })
      ).count,
    ).toBe(0);
    expect(await dbB.ticket.findMany({ where: { mergedIntoTicketId: { not: null } } })).toEqual([]);
    expect(await dbB.ticket.findMany({ where: { snoozedUntil: { not: null } } })).toEqual([]);
    expect(await dbB.message.findMany({ where: { mergedFromTicketId: a.id } })).toEqual([]);

    const aRow = await prisma.ticket.findUniqueOrThrow({ where: { id: a.id } });
    expect(aRow.mergedIntoTicketId).toBe(b.id);
    expect(aRow.mergeMessageSeq).toBe(marker);
    const bRow = await prisma.ticket.findUniqueOrThrow({ where: { id: b.id } });
    expect(bRow.snoozedUntil?.getTime()).toBe(snoozedUntil.getTime());
    const mRow = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(mRow.mergedFromTicketId).toBe(a.id);
  });
});

describe("Phase 12 append-only audit (D-20, review C8)", () => {
  it("rejects raw UPDATE and DELETE of TicketAuditEvent rows with each of the six new actions", async () => {
    const { orgId, userId, a } = await twoTickets("audit-new");
    for (const action of NEW_ACTIONS) {
      const { id } = await recordTicketAudit(prisma, orgId, {
        ticketId: a.id,
        actorType: "USER",
        actorUserId: userId,
        action,
        before: { ticketId: a.id },
        after: { ticketId: a.id },
      });
      await expect(
        prisma.$executeRaw`UPDATE "TicketAuditEvent" SET "batchId" = 'x' WHERE id = ${id}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM "TicketAuditEvent" WHERE id = ${id}`,
      ).rejects.toThrow(/append-only/);
      const row = await prisma.ticketAuditEvent.findUniqueOrThrow({ where: { id } });
      expect(row.action).toBe(action);
      expect(row.batchId).toBeNull();
    }
  });

  it("rejects raw UPDATE and DELETE of an AuditEvent row", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const event = await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        actionType: "TRIAGE",
        provider: "openai",
        model: "gpt-5.4-mini",
        input: "redacted input",
        output: JSON.stringify({ category: "OTHER" }),
      },
    });
    await expect(
      prisma.$executeRaw`UPDATE "AuditEvent" SET "output" = 'tampered' WHERE id = ${event.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${event.id}`,
    ).rejects.toThrow(/append-only/);
    const row = await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.output).toBe(JSON.stringify({ category: "OTHER" }));
  });
});

describe("Phase 12 database guards", () => {
  it("refuses a second parent for one child (TicketRelation_one_parent_key) and allows other types", async () => {
    const { orgId, userId, a: child, b: parent1 } = await twoTickets("one-parent");
    const email = `lc-op-${randomUUID()}@example.test`;
    const parent2 = await seedContactTicket(orgId, { contactEmail: email });
    const related = await seedContactTicket(orgId, { contactEmail: email });
    await seedRelation(prisma, orgId, {
      type: "CHILD_OF",
      fromTicketId: child.id,
      toTicketId: parent1.id,
      createdById: userId,
    });
    const text = await rejection(
      seedRelation(prisma, orgId, {
        type: "CHILD_OF",
        fromTicketId: child.id,
        toTicketId: parent2.id,
        createdById: userId,
      }),
    );
    expect(text).toContain("TicketRelation_one_parent_key");

    await seedRelation(prisma, orgId, {
      type: "RELATED_TO",
      fromTicketId: child.id,
      toTicketId: related.id,
      createdById: userId,
    });
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("Ticket_merge_fields_check keeps the merge fields together and refuses a self-merge", async () => {
    const { a, b } = await twoTickets("merge-check");
    const marker = await drawMergeMarker();
    const now = new Date();
    for (const data of [
      { mergedIntoTicketId: b.id },
      { mergedIntoTicketId: b.id, mergedAt: now },
      { mergedIntoTicketId: b.id, mergeMessageSeq: marker },
      { mergedAt: now },
      { mergeMessageSeq: marker },
      { mergedAt: now, mergeMessageSeq: marker },
      { mergedIntoTicketId: a.id, mergedAt: now, mergeMessageSeq: marker },
    ]) {
      const text = await rejection(prisma.ticket.update({ where: { id: a.id }, data }));
      expect(text).toContain("Ticket_merge_fields_check");
    }
    const ok = await prisma.ticket.update({
      where: { id: a.id },
      data: { mergedIntoTicketId: b.id, mergedAt: now, mergeMessageSeq: marker },
    });
    expect(ok.mergedIntoTicketId).toBe(b.id);
  });

  it("assigns Message.seq in the database, strictly increasing per insert", async () => {
    const { a } = await twoTickets("seq");
    const first = await seedMessage(prisma, a.id, { visibility: "PUBLIC", direction: "INBOUND" });
    const second = await seedMessage(prisma, a.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
    });
    expect(second.seq > first.seq).toBe(true);
    const rows = await prisma.$queryRaw<{ seq: bigint }[]>`
      INSERT INTO "Message" (id, "organizationId", "ticketId", direction, visibility, "bodyMarkdown", "bodyHtml")
      SELECT ${randomUUID()}, "organizationId", id, 'INBOUND', 'PUBLIC', 'raw', '<p>raw</p>'
      FROM "Ticket" WHERE id = ${a.id}
      RETURNING seq`;
    expect(BigInt(rows[0].seq) > second.seq).toBe(true);
  });
});

describe("Phase 12 keeps earlier hand-written objects (D-19, review C8)", () => {
  it("both append-only triggers stay attached, on the right table and function, and enabled", async () => {
    const rows = await prisma.$queryRaw<
      { tgname: string; relname: string; proname: string; tgenabled: string }[]
    >`
      SELECT t.tgname, c.relname, p.proname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname IN ('aida_audit_event_no_update_delete', 'aida_ticket_audit_event_no_update_delete')
      ORDER BY t.tgname`;
    expect(rows).toEqual([
      {
        tgname: "aida_audit_event_no_update_delete",
        relname: "AuditEvent",
        proname: "aida_audit_event_immutable",
        tgenabled: "O",
      },
      {
        tgname: "aida_ticket_audit_event_no_update_delete",
        relname: "TicketAuditEvent",
        proname: "aida_ticket_audit_event_immutable",
        tgenabled: "O",
      },
    ]);
  });

  it("the generated searchVector columns keep their captured expressions", async () => {
    const rows = await prisma.$queryRaw<{ relname: string; attgenerated: string; expr: string }[]>`
      SELECT c.relname, a.attgenerated::text AS attgenerated, pg_get_expr(d.adbin, d.adrelid) AS expr
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attname = 'searchVector' AND c.relname IN ('Ticket', 'Message') AND NOT a.attisdropped
      ORDER BY c.relname`;
    expect(rows).toEqual([
      { relname: "Message", attgenerated: "s", expr: MESSAGE_SEARCH_EXPR },
      { relname: "Ticket", attgenerated: "s", expr: TICKET_SEARCH_EXPR },
    ]);
  });

  it("the searchVector GIN indexes keep their captured indexdef", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('Ticket_searchVector_idx', 'Message_searchVector_idx')
      ORDER BY indexname`;
    expect(rows).toEqual([
      { indexname: "Message_searchVector_idx", indexdef: MESSAGE_SEARCH_INDEXDEF },
      { indexname: "Ticket_searchVector_idx", indexdef: TICKET_SEARCH_INDEXDEF },
    ]);
  });

  it("the SavedView name indexes and the Phase 11 and 12 CHECK constraints exist", async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('SavedView_private_name_key', 'SavedView_shared_name_key',
                          'TicketRelation_pair_key', 'TicketRelation_one_parent_key')
      ORDER BY indexname`;
    expect(indexes.map((r) => r.indexname)).toEqual([
      "SavedView_private_name_key",
      "SavedView_shared_name_key",
      "TicketRelation_one_parent_key",
      "TicketRelation_pair_key",
    ]);
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conname IN ('SavedView_name_length_check', 'TicketAuditEvent_actor_check',
                                          'TicketRelation_no_self_check', 'Ticket_merge_fields_check')
      ORDER BY conname`;
    expect(checks.map((r) => r.conname)).toEqual([
      "SavedView_name_length_check",
      "TicketAuditEvent_actor_check",
      "TicketRelation_no_self_check",
      "Ticket_merge_fields_check",
    ]);
  });
});
