// Phase 11, plan 11-02: the one ticket mutation service (AIDA-48, D-07 to D-09), on a real
// Postgres through Testcontainers. Nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mergeTickets } from "@/lib/tickets/merge";
import { runTicketMutation, type TicketMutationActor } from "@/lib/tickets/mutations";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { seedContactTicket } from "../support/lifecycle-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

/** Every organization whose actor wrote audit rows in this file (the audit-content case). */
const actorOrgIds = new Set<string>();

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
  actorOrgIds.add(orgId);
  const [admin, member] = users;
  const actor: TicketMutationActor = { userId: admin.id, orgId };
  return { orgId, actor, admin, member };
}

function auditRows(orgId: string, ticketId?: string) {
  return prisma.ticketAuditEvent.findMany({
    where: { organizationId: orgId, ...(ticketId ? { ticketId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("runTicketMutation: status (tracer)", () => {
  it("resolves a ticket, stamps resolvedAt, clears the flags and writes one STATUS_CHANGED row", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    await prisma.ticket.update({ where: { id: t.id }, data: { isAtRisk: true, isBreached: true } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "status", status: "RESOLVED" },
      mode: "single",
    });

    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(ticket.status).toBe("RESOLVED");
    expect(ticket.resolvedAt).toBeInstanceOf(Date);
    expect(ticket.isAtRisk).toBe(false);
    expect(ticket.isBreached).toBe(false);

    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "STATUS_CHANGED",
      actorType: "USER",
      actorUserId: admin.id,
      batchId: null,
      before: { status: "OPEN" },
      after: { status: "RESOLVED" },
    });
  });

  it("repeating the same status is a no-op that still writes one row with before equal to after", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    const op = { kind: "status", status: "RESOLVED" } as const;

    await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" });
    const first = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    const again = await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" });
    const second = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

    expect(again).toEqual({ ok: true, count: 1, batchId: null });
    expect(second.resolvedAt?.toISOString()).toBe(first.resolvedAt?.toISOString());
    expect(second.updatedAt.toISOString()).toBe(first.updatedAt.toISOString());
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].before).toEqual({ status: "RESOLVED" });
    expect(rows[1].after).toEqual({ status: "RESOLVED" });
  });

  it("returns MEMBERSHIP_ENDED for an actor whose member row was deleted, and changes nothing", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    await prisma.member.delete({ where: { id: admin.memberId } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "status", status: "RESOLVED" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(ticket.status).toBe("OPEN");
    expect(ticket.resolvedAt).toBeNull();
    expect(await auditRows(orgId)).toHaveLength(0);
  });
});

function tagCount(orgId: string) {
  return prisma.tag.count({ where: { organizationId: orgId } });
}

function links(ticketId: string) {
  return prisma.ticketTag.findMany({ where: { ticketId } });
}

describe("runTicketMutation: assign", () => {
  it("assigns a member, unassigns with null, and records assigneeId before and after", async () => {
    const { orgId, actor, member } = await seedActor();
    const t = await seedTicket(orgId);

    const assigned = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "single",
    });
    expect(assigned.ok).toBe(true);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBe(
      member.id,
    );

    const unassigned = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: null },
      mode: "single",
    });
    expect(unassigned.ok).toBe(true);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();

    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["ASSIGNEE_CHANGED", { assigneeId: null }, { assigneeId: member.id }],
      ["ASSIGNEE_CHANGED", { assigneeId: member.id }, { assigneeId: null }],
    ]);
  });

  it("refuses an assignee who is not a member of the organization with MEMBER_NOT_ACTIVE", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["member"]);
    const t = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: other.users[0].id },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MEMBER_NOT_ACTIVE" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it("assigning the same assignee again is a no-op with before equal to after", async () => {
    const { orgId, actor, member } = await seedActor();
    const t = await seedTicket(orgId, { assigneeId: member.id });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "single",
    });

    expect(result.ok).toBe(true);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ assigneeId: member.id });
    expect(rows[0].after).toEqual({ assigneeId: member.id });
  });
});

describe("runTicketMutation: priority (Codex review C2)", () => {
  const CREATED_AT = new Date("2026-01-05T08:00:00.000Z");
  const MIN = 60_000;

  it("writes priority, both targets, both due dates and clears the flags, from the organization's policy or the defaults", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    await prisma.slaPolicy.create({
      data: {
        organizationId: orgId,
        priority: "URGENT",
        firstResponseTargetMinutes: 30,
        resolutionTargetMinutes: 240,
      },
    });
    await prisma.slaPolicy.create({
      data: {
        organizationId: other.orgId,
        priority: "URGENT",
        firstResponseTargetMinutes: 5,
        resolutionTargetMinutes: 10,
      },
    });
    const t = await seedTicket(orgId, { priority: "NORMAL" });
    await prisma.ticket.update({
      where: { id: t.id },
      data: { createdAt: CREATED_AT, isAtRisk: true, isBreached: true },
    });

    const urgent = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "priority", priority: "URGENT" },
      mode: "single",
    });
    expect(urgent.ok).toBe(true);
    const u = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(u).toMatchObject({
      priority: "URGENT",
      firstResponseTargetMinutes: 30,
      resolutionTargetMinutes: 240,
      isAtRisk: false,
      isBreached: false,
    });
    expect(u.firstResponseDueAt.getTime()).toBe(CREATED_AT.getTime() + 30 * MIN);
    expect(u.resolutionDueAt.getTime()).toBe(CREATED_AT.getTime() + 240 * MIN);

    const low = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "priority", priority: "LOW" },
      mode: "single",
    });
    expect(low.ok).toBe(true);
    const l = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(l).toMatchObject({
      priority: "LOW",
      firstResponseTargetMinutes: 1440,
      resolutionTargetMinutes: 4320,
    });
    expect(l.firstResponseDueAt.getTime()).toBe(CREATED_AT.getTime() + 1440 * MIN);
    expect(l.resolutionDueAt.getTime()).toBe(CREATED_AT.getTime() + 4320 * MIN);

    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["PRIORITY_CHANGED", { priority: "NORMAL" }, { priority: "URGENT" }],
      ["PRIORITY_CHANGED", { priority: "URGENT" }, { priority: "LOW" }],
    ]);
  });

  it("re-applying the current priority writes nothing to the ticket and records before equal to after", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId, { priority: "HIGH" });
    await prisma.ticket.update({ where: { id: t.id }, data: { isAtRisk: true } });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "priority", priority: "HIGH" },
      mode: "single",
    });

    expect(result.ok).toBe(true);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toEqual(before);
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ priority: "HIGH" });
    expect(rows[0].after).toEqual({ priority: "HIGH" });
  });
});

describe("runTicketMutation: tags", () => {
  it("addTag links the tag, and a tag already linked is a no-op with present true on both sides", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "vip" } });
    const op = { kind: "addTag", tagId: tag.id } as const;

    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );
    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );

    expect((await links(t.id)).map((l) => l.tagId)).toEqual([tag.id]);
    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["TAG_ADDED", { tagId: tag.id, present: false }, { tagId: tag.id, present: true }],
      ["TAG_ADDED", { tagId: tag.id, present: true }, { tagId: tag.id, present: true }],
    ]);
  });

  it("addTag with a tag of another organization gives TAG_MISSING", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId);
    const foreign = await prisma.tag.create({ data: { organizationId: other.orgId, name: "x" } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "addTag", tagId: foreign.id },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "TAG_MISSING" });
    expect(await links(t.id)).toHaveLength(0);
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it('addTagByName " Billing " creates one trimmed tag, links it, and an existing name is reused', async () => {
    const { orgId, actor } = await seedActor();
    const t1 = await seedTicket(orgId);
    const t2 = await seedTicket(orgId);
    const countBefore = await tagCount(orgId);

    const first = await runTicketMutation({
      actor,
      ticketIds: [t1.id],
      op: { kind: "addTagByName", name: " Billing " },
      mode: "single",
    });
    expect(first.ok).toBe(true);
    const tags = await prisma.tag.findMany({ where: { organizationId: orgId } });
    expect(tags.map((t) => t.name)).toEqual(["Billing"]);
    expect(await tagCount(orgId)).toBe(countBefore + 1);
    expect((await links(t1.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
    const [row] = await auditRows(orgId, t1.id);
    expect(row).toMatchObject({
      action: "TAG_ADDED",
      before: { tagId: tags[0].id, present: false },
      after: { tagId: tags[0].id, present: true },
    });

    const second = await runTicketMutation({
      actor,
      ticketIds: [t2.id],
      op: { kind: "addTagByName", name: "Billing" },
      mode: "single",
    });
    expect(second.ok).toBe(true);
    expect(await tagCount(orgId)).toBe(countBefore + 1);
    expect((await links(t2.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
  });

  it("addTagByName for an actor whose member row was deleted gives MEMBERSHIP_ENDED and creates no tag", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId);
    await prisma.member.delete({ where: { id: admin.memberId } });
    const countBefore = await tagCount(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "addTagByName", name: "Revoked" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await tagCount(orgId)).toBe(countBefore);
    expect(await links(t.id)).toHaveLength(0);
  });

  it("addTagByName on a ticket of another organization gives TICKET_UNAVAILABLE and rolls the new tag back", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    const foreignTicket = await seedTicket(other.orgId);
    const countBefore = await tagCount(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [foreignTicket.id],
      op: { kind: "addTagByName", name: "Leaked" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "TICKET_UNAVAILABLE" });
    expect(await tagCount(orgId)).toBe(countBefore);
    expect(await links(foreignTicket.id)).toHaveLength(0);
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it("addTagByName with a blank name gives INVALID", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "addTagByName", name: "   " },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "INVALID" });
    expect(await tagCount(orgId)).toBe(0);
  });

  it("removeTag unlinks and records TAG_REMOVED; a tag not linked is a no-op", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "urgent-ish" } });
    await prisma.ticketTag.create({ data: { ticketId: t.id, tagId: tag.id } });
    const op = { kind: "removeTag", tagId: tag.id } as const;

    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );
    expect(await links(t.id)).toHaveLength(0);
    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );

    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["TAG_REMOVED", { tagId: tag.id, present: true }, { tagId: tag.id, present: false }],
      ["TAG_REMOVED", { tagId: tag.id, present: false }, { tagId: tag.id, present: false }],
    ]);
  });
});

describe("runTicketMutation: bulk", () => {
  it("a bulk change over three tickets returns count 3 and writes three rows sharing one batchId", async () => {
    const { orgId, actor } = await seedActor();
    const tickets = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];

    const result = await runTicketMutation({
      actor,
      ticketIds: tickets.map((t) => t.id),
      op: { kind: "status", status: "PENDING" },
      mode: "bulk",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(3);
    expect(result.batchId).toEqual(expect.any(String));
    const rows = await auditRows(orgId);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.batchId))).toEqual(new Set([result.batchId]));
    expect(new Set(rows.map((r) => r.ticketId))).toEqual(new Set(tickets.map((t) => t.id)));
  });
});

// ---------------------------------------------------------------------------------------------
// Task 3: rollback, refusal, idempotency and concurrency proofs (D-01, D-09, AIDA-48)
// ---------------------------------------------------------------------------------------------

/** Long enough for every wait below; the holders are always released explicitly. */
const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

/** Evidence lines for the SUMMARY (observed waits, deadlock error, delete timing). */
function evidence(line: string) {
  console.log(`[11-02 evidence] ${line}`);
}

async function timed(promise: Promise<void>): Promise<number> {
  const started = Date.now();
  await promise;
  return Date.now() - started;
}

/** Opens an interactive transaction, records its PID, runs body, then holds until released. */
function holdTx(body: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const pid = deferred<number>();
  const ready = deferred<void>();
  const release = deferred<void>();
  const done = prisma.$transaction(async (tx) => {
    pid.resolve(await backendPid(tx));
    await body(tx);
    ready.resolve();
    await release.promise;
  }, TX_OPTS);
  done.catch(() => {});
  return { pid: pid.promise, ready: ready.promise, release: () => release.resolve(), done };
}

const lockRow = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;

/** The ids in the order the database's ORDER BY id returns them ("ascending" = this order). */
async function dbOrder(ids: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Ticket" WHERE id = ANY(${ids}::text[]) ORDER BY id
  `;
  return rows.map((r) => r.id);
}

function ticketSnapshot(ids: string[]) {
  return prisma.ticket.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
}

/** SQLSTATE of a Postgres error as surfaced by Prisma's driver adapter, or by pg directly. */
function sqlState(err: unknown): string | undefined {
  const e = err as {
    code?: string;
    meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } };
    cause?: { originalCode?: string; code?: string };
  };
  return (
    e?.meta?.driverAdapterError?.cause?.originalCode ??
    e?.cause?.originalCode ??
    e?.meta?.code ??
    e?.cause?.code ??
    (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : undefined)
  );
}

describe("runTicketMutation: rollback (D-09, Codex review C5)", () => {
  it("a plain Error thrown after the first ticket was written rejects with that sentinel and rolls everything back", async () => {
    const { orgId, actor } = await seedActor();
    const tickets = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];
    const ids = tickets.map((t) => t.id);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "rollback" } });
    // One earlier audit row, so "unchanged" is checked against a non-zero count.
    await runTicketMutation({
      actor,
      ticketIds: [ids[0]],
      op: { kind: "status", status: "OPEN" },
      mode: "single",
    });
    const auditBefore = await prisma.ticketAuditEvent.count({ where: { organizationId: orgId } });
    const ticketsBefore = await ticketSnapshot(ids);

    const SENTINEL = new Error("D-09 forced mid-batch failure");
    const readings: { ticketId: string; linkInTx: boolean; auditInTx: number }[] = [];
    const call = runTicketMutation(
      { actor, ticketIds: ids, op: { kind: "addTag", tagId: tag.id }, mode: "bulk" },
      {
        async afterItem(tx, ticketId, index) {
          if (index !== 0) return;
          const link = await tx.ticketTag.findUnique({
            where: { ticketId_tagId: { ticketId, tagId: tag.id } },
          });
          const auditInTx = await tx.ticketAuditEvent.count({ where: { organizationId: orgId } });
          readings.push({ ticketId, linkInTx: link !== null, auditInTx });
          throw SENTINEL;
        },
      },
    );

    await expect(call).rejects.toBe(SENTINEL);
    expect(readings).toHaveLength(1);
    expect(readings[0].linkInTx).toBe(true);
    expect(readings[0].auditInTx).toBe(auditBefore + 1);

    expect(await prisma.ticketTag.count({ where: { ticketId: { in: ids } } })).toBe(0);
    expect(await ticketSnapshot(ids)).toEqual(ticketsBefore);
    expect(await prisma.ticketAuditEvent.count({ where: { organizationId: orgId } })).toBe(
      auditBefore,
    );
  });
});

describe("runTicketMutation: membership inside the transaction (D-01, Codex reviews C7 and R2-1)", () => {
  it("a member removal committed before the membership read refuses with MEMBERSHIP_ENDED", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    const before = await ticketSnapshot([t.id]);

    const result = await runTicketMutation(
      { actor, ticketIds: [t.id], op: { kind: "status", status: "RESOLVED" }, mode: "single" },
      {
        async onTransactionStart() {
          // A separate, committed statement on another connection of the global client.
          await prisma.member.delete({ where: { id: admin.memberId } });
        },
      },
    );

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await ticketSnapshot([t.id])).toEqual(before);
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it("a member removal committed after the membership read neither blocks nor undoes the mutation", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    const written = deferred<void>();
    const release = deferred<void>();

    const call = runTicketMutation(
      { actor, ticketIds: [t.id], op: { kind: "status", status: "RESOLVED" }, mode: "single" },
      {
        async afterItem() {
          written.resolve();
          await release.promise;
        },
      },
    );
    call.catch(() => {});

    await written.promise;
    // The delete runs on another connection while the mutation is held. It must commit within
    // 5 seconds; a delete that waited on the held transaction would hang until its timeout.
    const started = Date.now();
    let deleteCommitted = false;
    try {
      await Promise.race([
        prisma.member.delete({ where: { id: admin.memberId } }).then(() => {
          deleteCommitted = true;
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("member delete did not commit within 5 s")), 5_000),
        ),
      ]);
    } finally {
      // Release only after the delete committed (or the case already failed).
      if (!deleteCommitted) release.resolve();
    }
    const deleteMs = Date.now() - started;
    expect(deleteCommitted).toBe(true);
    evidence(`member delete committed in ${deleteMs} ms while the mutation was held in afterItem`);
    release.resolve();

    const result = await call;
    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(ticket.status).toBe("RESOLVED");
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "STATUS_CHANGED", actorUserId: admin.id });
    expect(await prisma.member.findUnique({ where: { id: admin.memberId } })).toBeNull();
  });
});

describe("runTicketMutation: refusals and dedupe (D-08, D-09)", () => {
  it("a batch containing a ticket of another organization is refused whole with TICKET_UNAVAILABLE", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    const own = [await seedTicket(orgId), await seedTicket(orgId)];
    const foreign = await seedTicket(other.orgId);
    const ownIds = own.map((t) => t.id);
    const before = await ticketSnapshot([...ownIds, foreign.id]);

    const result = await runTicketMutation({
      actor,
      ticketIds: [...ownIds, foreign.id],
      op: { kind: "status", status: "CLOSED" },
      mode: "bulk",
    });

    expect(result).toEqual({ ok: false, error: "TICKET_UNAVAILABLE" });
    expect(await ticketSnapshot([...ownIds, foreign.id])).toEqual(before);
    expect(await auditRows(orgId)).toHaveLength(0);
    expect(await auditRows(other.orgId)).toHaveLength(0);
  });

  it("ids [a, b, a, c] write exactly three audit rows", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b, c] = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];

    const result = await runTicketMutation({
      actor,
      ticketIds: [a.id, b.id, a.id, c.id],
      op: { kind: "priority", priority: "HIGH" },
      mode: "bulk",
    });

    expect(result).toMatchObject({ ok: true, count: 3 });
    const rows = await auditRows(orgId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.ticketId).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("101 unique ids give TOO_MANY before any database work", async () => {
    const { orgId, actor } = await seedActor();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    let transactionStarted = false;

    const result = await runTicketMutation(
      { actor, ticketIds: ids, op: { kind: "status", status: "OPEN" }, mode: "bulk" },
      {
        onTransactionStart() {
          transactionStarted = true;
        },
      },
    );

    expect(result).toEqual({ ok: false, error: "TOO_MANY" });
    expect(transactionStarted).toBe(false);
    expect(await auditRows(orgId)).toHaveLength(0);
  });
});

describe("runTicketMutation: idempotency (AIDA-48)", () => {
  it("a bulk status change to RESOLVED applied twice leaves every ticket as after the first run", async () => {
    const { orgId, actor } = await seedActor();
    const ids = [
      (await seedTicket(orgId, { status: "OPEN" })).id,
      (await seedTicket(orgId, { status: "PENDING" })).id,
      (await seedTicket(orgId, { status: "NEW" })).id,
    ];
    const op = { kind: "status", status: "RESOLVED" } as const;

    const first = await runTicketMutation({ actor, ticketIds: ids, op, mode: "bulk" });
    const afterFirst = await ticketSnapshot(ids);
    const second = await runTicketMutation({ actor, ticketIds: ids, op, mode: "bulk" });
    const afterSecond = await ticketSnapshot(ids);

    expect(first.ok && second.ok).toBe(true);
    expect(afterSecond).toEqual(afterFirst);
    for (const t of afterSecond) expect(t.status).toBe("RESOLVED");

    const rows = await auditRows(orgId);
    expect(rows).toHaveLength(6);
    const secondBatch = rows.filter((r) => second.ok && r.batchId === second.batchId);
    expect(secondBatch).toHaveLength(3);
    for (const r of secondBatch) expect(r.before).toEqual(r.after);
  });

  it("a bulk priority change applied twice does not recompute the SLA dates", async () => {
    const { orgId, actor } = await seedActor();
    const ids = [(await seedTicket(orgId)).id, (await seedTicket(orgId)).id];
    const op = { kind: "priority", priority: "URGENT" } as const;

    await runTicketMutation({ actor, ticketIds: ids, op, mode: "bulk" });
    const afterFirst = await ticketSnapshot(ids);
    await runTicketMutation({ actor, ticketIds: ids, op, mode: "bulk" });

    expect(await ticketSnapshot(ids)).toEqual(afterFirst);
    const rows = await auditRows(orgId);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => JSON.stringify(r.before) === JSON.stringify(r.after))).toHaveLength(
      2,
    );
  });
});

describe("runTicketMutation: concurrency (AIDA-48, Codex review C6)", () => {
  it("two bulk runs over overlapping tickets in opposite orders both commit without a deadlock", async () => {
    const { orgId, actor } = await seedActor();
    const seeded = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];
    const [a, b, c] = await dbOrder(seeded.map((t) => t.id));

    const holder = holdTx((tx) => lockRow(tx, b));
    const holderPid = await holder.pid;
    await holder.ready;

    const pidA = deferred<number>();
    const runA = runTicketMutation(
      { actor, ticketIds: [a, b, c], op: { kind: "status", status: "PENDING" }, mode: "bulk" },
      {
        async onTransactionStart(tx) {
          pidA.resolve(await backendPid(tx));
        },
      },
    );
    runA.catch(() => {});
    const pA = await pidA.promise;
    // A holds a and waits for b, held by the holder.
    const waitA = await timed(waitForBlockedBy(prisma, holderPid, [pA]));

    const pidB = deferred<number>();
    const runB = runTicketMutation(
      { actor, ticketIds: [c, b, a], op: { kind: "priority", priority: "HIGH" }, mode: "bulk" },
      {
        async onTransactionStart(tx) {
          pidB.resolve(await backendPid(tx));
        },
      },
    );
    runB.catch(() => {});
    const pB = await pidB.promise;
    // B's sorted lock starts at a, held by A.
    const waitB = await timed(waitForBlockedBy(prisma, pA, [pB]));
    evidence(
      `bulk concurrency: A (pid ${pA}) observed blocked by holder after ${waitA} ms; B (pid ${pB}) observed blocked by A after ${waitB} ms`,
    );

    holder.release();
    await holder.done;
    const [resultA, resultB] = await Promise.all([runA, runB]);

    expect(resultA).toMatchObject({ ok: true, count: 3 });
    expect(resultB).toMatchObject({ ok: true, count: 3 });
    const rows = await auditRows(orgId);
    expect(rows).toHaveLength(6);
    const batches = new Set(rows.map((r) => r.batchId));
    expect(batches.size).toBe(2);
    expect(batches).toEqual(
      new Set([resultA.ok ? resultA.batchId : "x", resultB.ok ? resultB.batchId : "y"]),
    );
  });

  it("control: locking rows one per statement in input order deadlocks (SQLSTATE 40P01)", async () => {
    const { orgId } = await seedActor();
    const seeded = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];
    const [a, b, c] = await dbOrder(seeded.map((t) => t.id));

    const holder = holdTx((tx) => lockRow(tx, b));
    const holderPid = await holder.pid;
    await holder.ready;

    const pidT1 = deferred<number>();
    const t1 = prisma.$transaction(async (tx) => {
      pidT1.resolve(await backendPid(tx));
      for (const id of [a, b, c]) await lockRow(tx, id);
    }, TX_OPTS);
    t1.catch(() => {});
    const p1 = await pidT1.promise;
    const waitT1 = await timed(waitForBlockedBy(prisma, holderPid, [p1]));

    const pidT2 = deferred<number>();
    const t2 = prisma.$transaction(async (tx) => {
      pidT2.resolve(await backendPid(tx));
      for (const id of [c, b, a]) await lockRow(tx, id);
    }, TX_OPTS);
    t2.catch(() => {});
    const p2 = await pidT2.promise;
    // T2 holds c and queues behind T1 on b's tuple lock.
    const waitT2 = await timed(waitForBlockedBy(prisma, p1, [p2]));

    holder.release();
    await holder.done;
    const settled = await Promise.allSettled([t1, t2]);

    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(sqlState(rejected[0].reason)).toBe("40P01");
    evidence(
      `control: T1 (pid ${p1}) observed blocked by holder after ${waitT1} ms; T2 (pid ${p2}) observed blocked by T1 after ${waitT2} ms; deadlock error: ${sqlState(rejected[0].reason)} ${String(
        (rejected[0].reason as Error)?.message ?? rejected[0].reason,
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240)}`,
    );
  });
});

describe("runTicketMutation: addTagByName same-name race (Codex review R2-2)", () => {
  async function raceSameName(outcome: "commit" | "rollback") {
    const { orgId, actor } = await seedActor();
    const p = await seedTicket(orgId);
    const q = await seedTicket(orgId);
    const tagCountBefore = await tagCount(orgId);
    expect(await prisma.tag.count({ where: { organizationId: orgId, name: "Escalation" } })).toBe(
      0,
    );

    const SENTINEL = new Error("run A rollback sentinel");
    const pidA = deferred<number>();
    const aWritten = deferred<void>();
    const releaseA = deferred<void>();
    const runA = runTicketMutation(
      {
        actor,
        ticketIds: [p.id],
        op: { kind: "addTagByName", name: "Escalation" },
        mode: "single",
      },
      {
        async onTransactionStart(tx) {
          pidA.resolve(await backendPid(tx));
        },
        async afterItem() {
          aWritten.resolve();
          await releaseA.promise;
          if (outcome === "rollback") throw SENTINEL;
        },
      },
    );
    runA.catch(() => {});
    const pA = await pidA.promise;
    // B starts only after A created the tag, linked p, audited, and is held before commit.
    await aWritten.promise;

    const pidB = deferred<number>();
    const runB = runTicketMutation(
      {
        actor,
        ticketIds: [q.id],
        op: { kind: "addTagByName", name: "Escalation" },
        mode: "single",
      },
      {
        async onTransactionStart(tx) {
          pidB.resolve(await backendPid(tx));
        },
      },
    );
    runB.catch(() => {});
    const pB = await pidB.promise;
    // The evidence of the race: B's INSERT … ON CONFLICT waits on A's uncommitted tag row.
    const waitMs = await timed(waitForBlockedBy(prisma, pA, [pB]));
    evidence(
      `same-name tag race (${outcome}): B (pid ${pB}) observed blocked by A (pid ${pA}) after ${waitMs} ms`,
    );
    releaseA.resolve();

    return { orgId, p, q, tagCountBefore, runA, runB, SENTINEL };
  }

  it("first commits: both runs return ok and both tickets link the one tag", async () => {
    const { orgId, p, q, tagCountBefore, runA, runB } = await raceSameName("commit");
    const [resultA, resultB] = await Promise.all([runA, runB]);

    expect(resultA).toEqual({ ok: true, count: 1, batchId: null });
    expect(resultB).toEqual({ ok: true, count: 1, batchId: null });
    expect(await tagCount(orgId)).toBe(tagCountBefore + 1);
    const tags = await prisma.tag.findMany({
      where: { organizationId: orgId, name: "Escalation" },
    });
    expect(tags).toHaveLength(1);
    expect((await links(p.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
    expect((await links(q.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
    for (const ticketId of [p.id, q.id]) {
      const rows = await auditRows(orgId, ticketId);
      expect(rows.map((r) => [r.action, r.after])).toEqual([
        ["TAG_ADDED", { tagId: tags[0].id, present: true }],
      ]);
    }
  });

  it("first rolls back: A rejects with its sentinel, B returns ok, the one tag links q only", async () => {
    const { orgId, p, q, tagCountBefore, runA, runB, SENTINEL } = await raceSameName("rollback");

    await expect(runA).rejects.toBe(SENTINEL);
    expect(await runB).toEqual({ ok: true, count: 1, batchId: null });
    expect(await tagCount(orgId)).toBe(tagCountBefore + 1);
    const tags = await prisma.tag.findMany({
      where: { organizationId: orgId, name: "Escalation" },
    });
    expect(tags).toHaveLength(1);
    expect((await links(q.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
    expect(await links(p.id)).toHaveLength(0);
    expect(await auditRows(orgId, p.id)).toHaveLength(0);
    expect((await auditRows(orgId, q.id)).map((r) => r.action)).toEqual(["TAG_ADDED"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Codex diff critique round 1, D1: a merged source's status cannot change (Phase 12, D-07, D-08)
// ---------------------------------------------------------------------------------------------

describe("runTicketMutation: a merged source keeps its status (Codex diff round 1, D1)", () => {
  // Not added to actorOrgIds: the merge writes its own audit rows (MERGED_INTO and others),
  // whose keys the privacy case above does not list.
  async function seedMergedPair() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
    const actor: TicketMutationActor = { userId: users[0].id, orgId };
    const contactEmail = `mutation-merge-${randomUUID()}@example.test`;
    const source = await seedContactTicket(orgId, { contactEmail });
    const target = await seedContactTicket(orgId, { contactEmail });
    return { orgId, actor, source, target };
  }

  async function merge(actor: TicketMutationActor, sourceId: string, targetId: string) {
    return mergeTickets(prisma, actor, {
      sourceTicketId: sourceId,
      targetTicketId: targetId,
      reviewedLinkLabel: null,
    });
  }

  async function sourceState(id: string) {
    return prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: { status: true, resolvedAt: true, mergedIntoTicketId: true, updatedAt: true },
    });
  }

  it("single: a status change on a merged source is refused with MERGED_SOURCE and changes nothing", async () => {
    const { orgId, actor, source, target } = await seedMergedPair();
    expect((await merge(actor, source.id, target.id)).ok).toBe(true);
    const before = await sourceState(source.id);
    const auditsBefore = await auditRows(orgId);
    expect(before.status).toBe("CLOSED");

    const result = await runTicketMutation({
      actor,
      ticketIds: [source.id],
      op: { kind: "status", status: "OPEN" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MERGED_SOURCE" });
    expect(await sourceState(source.id)).toEqual(before);
    expect(await auditRows(orgId)).toEqual(auditsBefore);
  });

  it("bulk: one merged source in the batch refuses the whole batch with MERGED_SOURCE, nothing changed", async () => {
    const { orgId, actor, source, target } = await seedMergedPair();
    const plain = await seedTicket(orgId, { status: "OPEN" });
    expect((await merge(actor, source.id, target.id)).ok).toBe(true);
    const before = await ticketSnapshot([plain.id, source.id, target.id]);
    const auditsBefore = await auditRows(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [plain.id, source.id],
      op: { kind: "status", status: "PENDING" },
      mode: "bulk",
    });

    expect(result).toEqual({ ok: false, error: "MERGED_SOURCE" });
    expect(await ticketSnapshot([plain.id, source.id, target.id])).toEqual(before);
    expect(await auditRows(orgId)).toEqual(auditsBefore);
  });

  it("other operations on a merged source still apply: assignee, priority and tags stay on the source (D-08)", async () => {
    const { orgId, actor, source, target } = await seedMergedPair();
    expect((await merge(actor, source.id, target.id)).ok).toBe(true);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "after-merge" } });

    const ops = [
      { kind: "assign", assigneeId: actor.userId },
      { kind: "priority", priority: "HIGH" },
      { kind: "addTag", tagId: tag.id },
    ] as const;
    for (const op of ops) {
      const result = await runTicketMutation({ actor, ticketIds: [source.id], op, mode: "single" });
      expect(result).toMatchObject({ ok: true, count: 1 });
    }
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: source.id } });
    expect(after).toMatchObject({
      status: "CLOSED",
      mergedIntoTicketId: target.id,
      assigneeId: actor.userId,
      priority: "HIGH",
    });
    expect((await links(source.id)).map((l) => l.tagId)).toEqual([tag.id]);
  });

  it("forced order: a status change observed blocked by a held merge is refused after the merge commits", async () => {
    const { orgId, actor, source, target } = await seedMergedPair();
    const mergePid = deferred<number>();
    const mergeHeld = deferred<void>();
    const releaseMerge = deferred<void>();
    const mergeRun = mergeTickets(
      prisma,
      actor,
      { sourceTicketId: source.id, targetTicketId: target.id, reviewedLinkLabel: null },
      {
        async afterLock(tx) {
          mergePid.resolve(await backendPid(tx));
          mergeHeld.resolve();
          await releaseMerge.promise;
        },
      },
    );
    mergeRun.catch(() => {});
    await mergeHeld.promise;

    const statusPid = deferred<number>();
    const statusRun = runTicketMutation(
      { actor, ticketIds: [source.id], op: { kind: "status", status: "OPEN" }, mode: "single" },
      {
        async onTransactionStart(tx) {
          statusPid.resolve(await backendPid(tx));
        },
      },
    );
    statusRun.catch(() => {});
    // The status change waits on the source's row lock, which the merge holds.
    await waitForBlockedBy(prisma, await mergePid.promise, [await statusPid.promise]);
    const statusBefore = await sourceState(source.id);
    expect(statusBefore.mergedIntoTicketId).toBeNull();

    releaseMerge.resolve();
    expect(await mergeRun).toEqual({
      ok: true,
      sourceTicketId: source.id,
      targetTicketId: target.id,
    });
    expect(await statusRun).toEqual({ ok: false, error: "MERGED_SOURCE" });

    const after = await sourceState(source.id);
    expect(after.status).toBe("CLOSED");
    expect(after.mergedIntoTicketId).toBe(target.id);
    const statusRows = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, ticketId: source.id, action: "STATUS_CHANGED" },
    });
    // Only the merge's own close (D-08), never an OPEN written after it.
    expect(statusRows.map((row) => row.after)).toEqual([{ status: "CLOSED" }]);
  });
});

describe("TicketAuditEvent content (AIDA-48 privacy prohibition)", () => {
  it("every audit row written in this file holds only allowed keys with id, enum, boolean or null values", async () => {
    const ALLOWED = new Set(["status", "priority", "assigneeId", "tagId", "present"]);
    const rows = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: { in: [...actorOrgIds] } },
    });
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      for (const snapshot of [row.before, row.after]) {
        expect(snapshot).toBeTypeOf("object");
        expect(Array.isArray(snapshot)).toBe(false);
        for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
          expect(ALLOWED.has(key)).toBe(true);
          expect(value === null || typeof value === "string" || typeof value === "boolean").toBe(
            true,
          );
        }
      }
    }
  });
});
