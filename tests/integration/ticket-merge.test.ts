// Phase 12, plan 12-03: the merge service (AIDA-53, D-07 to D-10) on a real Postgres through
// Testcontainers. Nothing is mocked.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  type DemoReplyInput,
  DemoSeedTicketMergedError,
  finalizeDemoTicket,
  insertDemoReplies,
  seedDemoData,
} from "@/lib/demo/seed-demo-data";
import {
  type MergeActor,
  type MergeHooks,
  mergeTickets,
  setAgentMessageObserverForTests,
} from "@/lib/tickets/merge";
import {
  seedContactTicket,
  seedMessage,
  seedOrgWithMembers,
  seedRelation,
} from "../support/lifecycle-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

// Task 3: the messages route reads its session through getScopedDb and enqueues through
// getBoss; both are replaced by test doubles bound to the case's actor. Everything else is real.
const routeEnv = vi.hoisted(() => ({
  actor: null as null | { orgId: string; userId: string },
  sends: [] as unknown[][],
}));

vi.mock("@/lib/session", async () => {
  const { scopedDb } = await import("@/lib/scoped-db");
  return {
    getScopedDb: async () => {
      if (!routeEnv.actor) throw new Error("no session");
      return {
        db: scopedDb(routeEnv.actor.orgId),
        orgId: routeEnv.actor.orgId,
        session: { user: { id: routeEnv.actor.userId } },
      };
    },
  };
});

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (...args: unknown[]) => {
      routeEnv.sends.push(args);
      return "job";
    },
  }),
}));

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  return { orgId, actor };
}

const email = () => `merge-${randomUUID()}@example.test`;

async function samePair(orgId: string) {
  const contactEmail = email();
  const s = await seedContactTicket(orgId, { contactEmail });
  const t = await seedContactTicket(orgId, { contactEmail });
  return { s, t };
}

async function orgCounts(orgId: string) {
  return {
    messages: await prisma.message.count({ where: { organizationId: orgId } }),
    attachments: await prisma.attachment.count({ where: { organizationId: orgId } }),
    tickets: await prisma.ticket.count({ where: { organizationId: orgId } }),
  };
}

describe("mergeTickets (tracer)", () => {
  it("moves the whole thread with provenance, closes the source as a duplicate and audits both", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const sPublic = await seedMessage(prisma, s.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      withAttachment: true,
    });
    const sNote = await seedMessage(prisma, s.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
    });
    const tPublic = await seedMessage(prisma, t.id, { visibility: "PUBLIC", direction: "INBOUND" });
    const sourceMessageIds = (
      await prisma.message.findMany({ where: { ticketId: s.id }, select: { id: true } })
    ).map((m) => m.id);
    expect(sourceMessageIds).toEqual(expect.arrayContaining([sPublic.id, sNote.id]));
    const attachmentBefore = await prisma.attachment.findUniqueOrThrow({
      where: { id: sPublic.attachmentId ?? "" },
    });
    const before = await orgCounts(orgId);

    expect(
      await mergeTickets(prisma, actor, { sourceTicketId: s.id, targetTicketId: t.id }),
    ).toEqual({ ok: true, sourceTicketId: s.id, targetTicketId: t.id });

    const moved = await prisma.message.findMany({ where: { id: { in: sourceMessageIds } } });
    expect(moved).toHaveLength(sourceMessageIds.length);
    for (const m of moved) {
      expect(m.ticketId).toBe(t.id);
      expect(m.mergedFromTicketId).toBe(s.id);
    }
    const tMessage = await prisma.message.findUniqueOrThrow({ where: { id: tPublic.id } });
    expect(tMessage.mergedFromTicketId).toBeNull();

    const attachmentAfter = await prisma.attachment.findUniqueOrThrow({
      where: { id: attachmentBefore.id },
      include: { message: { select: { ticketId: true } } },
    });
    const { message, ...attachmentRow } = attachmentAfter;
    expect(attachmentRow).toEqual(attachmentBefore);
    expect(message.ticketId).toBe(t.id);

    const source = await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } });
    expect(source.status).toBe("CLOSED");
    expect(source.mergedIntoTicketId).toBe(t.id);
    expect(source.mergedAt).toBeInstanceOf(Date);
    expect(typeof source.mergeMessageSeq).toBe("bigint");

    const relations = await prisma.ticketRelation.findMany({ where: { organizationId: orgId } });
    expect(relations.map((r) => [r.type, r.fromTicketId, r.toTicketId])).toEqual([
      ["DUPLICATE_OF", s.id, t.id],
    ]);

    const audit = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: { in: ["MERGED_INTO", "MERGED_FROM"] } },
    });
    expect(audit.map((r) => [r.action, r.ticketId]).sort()).toEqual(
      [
        ["MERGED_FROM", t.id],
        ["MERGED_INTO", s.id],
      ].sort(),
    );
    expect(await orgCounts(orgId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2: refusals, link replacement, rollback, idempotency and races bound to recorded PIDs.

const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

/** Full rows of every table a merge touches, for the organization, in id order. */
async function snapshot(orgId: string) {
  const where = { organizationId: orgId };
  const orderBy = { id: "asc" as const };
  return {
    tickets: await prisma.ticket.findMany({ where, orderBy }),
    messages: await prisma.message.findMany({ where, orderBy }),
    attachments: await prisma.attachment.findMany({ where, orderBy }),
    relations: await prisma.ticketRelation.findMany({ where, orderBy }),
    audit: await prisma.ticketAuditEvent.findMany({ where, orderBy }),
  };
}

const merge = (
  actor: MergeActor,
  sourceTicketId: string,
  targetTicketId: string,
  hooks?: MergeHooks,
) => mergeTickets(prisma, actor, { sourceTicketId, targetTicketId }, hooks);

async function auditActions(orgId: string, ticketId: string) {
  const rows = await prisma.ticketAuditEvent.findMany({
    where: { organizationId: orgId, ticketId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.action).sort();
}

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

/** Starts a merge that holds in beforeCommit until released; resolves its PID once held. */
function heldMerge(actor: MergeActor, sourceTicketId: string, targetTicketId: string) {
  const pid = deferred<number>();
  const held = deferred<void>();
  const release = deferred<void>();
  const run = merge(actor, sourceTicketId, targetTicketId, {
    onTransactionStart: async (tx) => pid.resolve(await backendPid(tx)),
    beforeCommit: async () => {
      held.resolve();
      await release.promise;
    },
  });
  run.catch(() => {});
  return { pid: pid.promise, held: held.promise, release: () => release.resolve(), run };
}

function pidHooks() {
  const pid = deferred<number>();
  return {
    pid: pid.promise,
    hooks: {
      onTransactionStart: async (tx: Prisma.TransactionClient) => pid.resolve(await backendPid(tx)),
    },
  };
}

describe("mergeTickets: refusals change nothing (D-07, D-10)", () => {
  it("SELF before any query", async () => {
    const { orgId, actor } = await seedActor();
    const { s } = await samePair(orgId);
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, s.id)).toEqual({ ok: false, error: "SELF" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("MEMBERSHIP_ENDED for an unmerged source after the member row was deleted (review C3)", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    await prisma.member.deleteMany({ where: { userId: actor.userId, organizationId: orgId } });
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, t.id)).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("MEMBERSHIP_ENDED, never SOURCE_MERGED, for an already merged source (review C3)", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const u = await seedContactTicket(orgId, {
      contactEmail:
        (await prisma.contact.findUniqueOrThrow({ where: { id: s.contactId } })).email ?? "",
    });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    await prisma.member.deleteMany({ where: { userId: actor.userId, organizationId: orgId } });
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, u.id)).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("TICKET_UNAVAILABLE for another organization's ticket", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const foreign = await seedContactTicket(other.orgId, { contactEmail });
    const before = await snapshot(orgId);
    const beforeOther = await snapshot(other.orgId);
    expect(await merge(actor, s.id, foreign.id)).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await merge(actor, foreign.id, s.id)).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await snapshot(orgId)).toEqual(before);
    expect(await snapshot(other.orgId)).toEqual(beforeOther);
  });

  it("TICKET_UNAVAILABLE for an unknown id", async () => {
    const { orgId, actor } = await seedActor();
    const { s } = await samePair(orgId);
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, randomUUID())).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("SOURCE_MERGED for a source that is already merged", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const u = await seedContactTicket(orgId, { contactEmail });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, u.id)).toEqual({ ok: false, error: "SOURCE_MERGED" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("TARGET_MERGED for a target that is merged (no chains, D-07)", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const u = await seedContactTicket(orgId, { contactEmail });
    expect((await merge(actor, t.id, u.id)).ok).toBe(true);
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, t.id)).toEqual({ ok: false, error: "TARGET_MERGED" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("SOURCE_HAS_MERGES for a source that has received merges (no chains, D-07)", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const u = await seedContactTicket(orgId, { contactEmail });
    expect((await merge(actor, u.id, s.id)).ok).toBe(true);
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, t.id)).toEqual({ ok: false, error: "SOURCE_HAS_MERGES" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("DIFFERENT_CONTACTS for tickets of two contacts (K33)", async () => {
    const { orgId, actor } = await seedActor();
    const s = await seedContactTicket(orgId, { contactEmail: email() });
    const t = await seedContactTicket(orgId, { contactEmail: email() });
    await seedMessage(prisma, s.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      withAttachment: true,
    });
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, t.id)).toEqual({ ok: false, error: "DIFFERENT_CONTACTS" });
    expect(await snapshot(orgId)).toEqual(before);
  });
});

describe("mergeTickets: provenance, links, adjacency and rollback", () => {
  it("mergeMessageSeq is above every earlier seq and below every later one (review C1)", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    await seedMessage(prisma, s.id, { visibility: "PUBLIC", direction: "INBOUND" });
    await seedMessage(prisma, t.id, { visibility: "PUBLIC", direction: "INBOUND" });
    const earlier = await prisma.message.findMany({
      where: { ticketId: { in: [s.id, t.id] } },
      select: { id: true, seq: true, createdAt: true },
    });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const source = await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } });
    const marker = source.mergeMessageSeq;
    if (marker === null) throw new Error("no marker");
    for (const m of earlier) expect(m.seq < marker).toBe(true);
    const after = await prisma.message.findMany({
      where: { id: { in: earlier.map((m) => m.id) } },
      select: { id: true, seq: true, createdAt: true },
    });
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      earlier.sort((a, b) => a.id.localeCompare(b.id)),
    );
    const later = await seedMessage(prisma, t.id, { visibility: "PUBLIC", direction: "OUTBOUND" });
    expect(later.seq > marker).toBe(true);
  });

  it("a merge with no prior link writes neither RELATION_ADDED nor RELATION_REMOVED", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    expect(
      await prisma.ticketAuditEvent.count({
        where: { organizationId: orgId, action: { in: ["RELATION_ADDED", "RELATION_REMOVED"] } },
      }),
    ).toBe(0);
    expect(await auditActions(orgId, s.id)).toEqual(["MERGED_INTO", "STATUS_CHANGED"]);
    expect(await auditActions(orgId, t.id)).toEqual(["MERGED_FROM"]);
  });

  for (const [oldType, reverse] of [
    ["RELATED_TO", false],
    ["CHILD_OF", true],
  ] as const) {
    it(`replaces an existing ${oldType} link by DUPLICATE_OF and audits both tickets`, async () => {
      const { orgId, actor } = await seedActor();
      const { s, t } = await samePair(orgId);
      const old = await seedRelation(prisma, orgId, {
        type: oldType,
        fromTicketId: reverse ? t.id : s.id,
        toTicketId: reverse ? s.id : t.id,
        createdById: actor.userId,
      });
      expect((await merge(actor, s.id, t.id)).ok).toBe(true);
      const relations = await prisma.ticketRelation.findMany({ where: { organizationId: orgId } });
      expect(relations.map((r) => [r.type, r.fromTicketId, r.toTicketId])).toEqual([
        ["DUPLICATE_OF", s.id, t.id],
      ]);
      for (const id of [s.id, t.id]) {
        const removed = await prisma.ticketAuditEvent.findMany({
          where: { organizationId: orgId, ticketId: id, action: "RELATION_REMOVED" },
        });
        expect(removed).toHaveLength(1);
        expect(removed[0].before).toMatchObject({ relationId: old.id, type: oldType });
        const added = await prisma.ticketAuditEvent.findMany({
          where: { organizationId: orgId, ticketId: id, action: "RELATION_ADDED" },
        });
        expect(added).toHaveLength(1);
        expect(added[0].after).toMatchObject({ relationId: relations[0].id, type: "DUPLICATE_OF" });
      }
    });
  }

  it("a CLOSED source merges without STATUS_CHANGED", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail, status: "CLOSED" });
    const t = await seedContactTicket(orgId, { contactEmail });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    expect(await auditActions(orgId, s.id)).toEqual(["MERGED_INTO"]);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CLOSED");
  });

  it("a RESOLVED source becomes CLOSED with one STATUS_CHANGED row", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail, status: "RESOLVED" });
    const t = await seedContactTicket(orgId, { contactEmail });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const rows = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, ticketId: s.id, action: "STATUS_CHANGED" },
    });
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      [{ status: "RESOLVED" }, { status: "CLOSED" }],
    ]);
  });

  it("a CLOSED target stays CLOSED", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail, status: "CLOSED" });
    const targetBefore = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(targetBefore);
  });

  it("a source with zero messages merges and writes the same audit rows", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    await prisma.message.deleteMany({ where: { ticketId: s.id } });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    expect(await auditActions(orgId, s.id)).toEqual(["MERGED_INTO", "STATUS_CHANGED"]);
    expect(await auditActions(orgId, t.id)).toEqual(["MERGED_FROM"]);
  });

  it("re-running the same merge returns SOURCE_MERGED and changes nothing", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const before = await snapshot(orgId);
    expect(await merge(actor, s.id, t.id)).toEqual({ ok: false, error: "SOURCE_MERGED" });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("the target's thread interleaves both histories by original createdAt", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const at = (h: number) => new Date(Date.UTC(2020, 0, 1, h));
    const s1 = await seedMessage(prisma, s.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      createdAt: at(1),
    });
    const t2 = await seedMessage(prisma, t.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      createdAt: at(2),
    });
    const s3 = await seedMessage(prisma, s.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
      createdAt: at(3),
    });
    const t4 = await seedMessage(prisma, t.id, {
      visibility: "PUBLIC",
      direction: "OUTBOUND",
      createdAt: at(4),
    });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const ids = [s1.id, t2.id, s3.id, t4.id];
    const rows = await prisma.message.findMany({
      where: { ticketId: t.id, id: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    });
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(rows.map((r) => r.createdAt.getTime())).toEqual(
      [1, 2, 3, 4].map((h) => at(h).getTime()),
    );
  });

  it("clears a snoozed source with one WOKEN row and keeps a snoozed target's deadline", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const deadline = new Date(Date.now() + 86_400_000);
    await prisma.ticket.updateMany({
      where: { id: { in: [s.id, t.id] } },
      data: { snoozedUntil: deadline },
    });
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } })).snoozedUntil,
    ).toBeNull();
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).snoozedUntil).toEqual(
      deadline,
    );
    const woken = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: "WOKEN" },
    });
    expect(woken.map((r) => [r.ticketId, r.actorType, r.actorUserId])).toEqual([
      [s.id, "USER", actor.userId],
    ]);
  });

  it("rolls back everything when a sentinel is thrown after the messages moved", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    await seedMessage(prisma, s.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      withAttachment: true,
    });
    await seedRelation(prisma, orgId, {
      type: "RELATED_TO",
      fromTicketId: s.id,
      toTicketId: t.id,
      createdById: actor.userId,
    });
    const before = await snapshot(orgId);
    const sentinel = new Error("merge rollback sentinel");
    await expect(
      merge(actor, s.id, t.id, {
        afterMove: () => {
          throw sentinel;
        },
      }),
    ).rejects.toBe(sentinel);
    expect(await snapshot(orgId)).toEqual(before);
  });
});

describe("mergeTickets: races bound to recorded PIDs (D-08, D-10)", () => {
  it("A into T held, A into U observed blocked, returns SOURCE_MERGED", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const a = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    const u = await seedContactTicket(orgId, { contactEmail });
    const first = heldMerge(actor, a.id, t.id);
    await first.held;
    const second = pidHooks();
    const run2 = merge(actor, a.id, u.id, second.hooks);
    run2.catch(() => {});
    await waitForBlockedBy(prisma, await first.pid, [await second.pid]);
    first.release();
    expect((await first.run).ok).toBe(true);
    expect(await run2).toEqual({ ok: false, error: "SOURCE_MERGED" });
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: a.id } })).mergedIntoTicketId,
    ).toBe(t.id);
  });

  it("A into T held, T into A observed blocked, returns TARGET_MERGED", async () => {
    const { orgId, actor } = await seedActor();
    const { s: a, t } = await samePair(orgId);
    const first = heldMerge(actor, a.id, t.id);
    await first.held;
    const second = pidHooks();
    const run2 = merge(actor, t.id, a.id, second.hooks);
    run2.catch(() => {});
    await waitForBlockedBy(prisma, await first.pid, [await second.pid]);
    first.release();
    expect((await first.run).ok).toBe(true);
    expect(await run2).toEqual({ ok: false, error: "TARGET_MERGED" });
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).mergedIntoTicketId,
    ).toBeNull();
  });

  it("a link insert holding both rows makes the merge wait, then the merge replaces that link", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    let linkId = "";
    const holder = holdTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ANY(${[s.id, t.id]}::text[]) ORDER BY id FOR UPDATE`;
      const row = await tx.ticketRelation.create({
        data: {
          organizationId: orgId,
          type: "RELATED_TO",
          fromTicketId: s.id,
          toTicketId: t.id,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      linkId = row.id;
    });
    const holderPid = await holder.pid;
    await holder.ready;
    const waiter = pidHooks();
    const run = merge(actor, s.id, t.id, waiter.hooks);
    run.catch(() => {});
    await waitForBlockedBy(prisma, holderPid, [await waiter.pid]);
    holder.release();
    await holder.done;
    expect((await run).ok).toBe(true);
    const relations = await prisma.ticketRelation.findMany({ where: { organizationId: orgId } });
    expect(relations.map((r) => r.type)).toEqual(["DUPLICATE_OF"]);
    const removed = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: "RELATION_REMOVED" },
    });
    expect(removed).toHaveLength(2);
    for (const r of removed)
      expect(r.before).toMatchObject({ relationId: linkId, type: "RELATED_TO" });
  });
});

describe("demo seed writes under the ticket row lock (reviews R2-2, R3-1)", () => {
  const replies = (userId: string, marker: string): DemoReplyInput[] =>
    [1, 2].map((n) => ({
      direction: "OUTBOUND",
      visibility: "PUBLIC",
      authorUserId: userId,
      authorContactId: null,
      bodyMarkdown: `Seed reply ${marker} ${n}`,
      createdAt: new Date(),
    }));

  it("(a) seed holds the row: the merge waits, then moves both replies with provenance", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const seedPid = deferred<number>();
    const held = deferred<void>();
    const release = deferred<void>();
    const seeding = insertDemoReplies(orgId, s.id, replies(actor.userId, "a"), {
      onTransactionStart: async (tx) => seedPid.resolve(await backendPid(tx)),
      afterLock: async () => {
        held.resolve();
        await release.promise;
      },
    });
    seeding.catch(() => {});
    await held.promise;
    const waiter = pidHooks();
    const run = merge(actor, s.id, t.id, waiter.hooks);
    run.catch(() => {});
    await waitForBlockedBy(prisma, await seedPid.promise, [await waiter.pid]);
    release.resolve();
    const ids = await seeding;
    expect((await run).ok).toBe(true);
    const marker = (await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } })).mergeMessageSeq;
    if (marker === null) throw new Error("no marker");
    const rows = await prisma.message.findMany({ where: { id: { in: ids } } });
    expect(rows).toHaveLength(2);
    for (const m of rows) {
      expect(m.ticketId).toBe(t.id);
      expect(m.mergedFromTicketId).toBe(s.id);
      expect(m.seq < marker).toBe(true);
    }
  });

  it("(b) merge holds the row: the seed waits, then refuses and writes no reply", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const first = heldMerge(actor, s.id, t.id);
    await first.held;
    const seed = pidHooks();
    const seeding = insertDemoReplies(orgId, s.id, replies(actor.userId, "b"), seed.hooks);
    seeding.catch(() => {});
    await waitForBlockedBy(prisma, await first.pid, [await seed.pid]);
    first.release();
    expect((await first.run).ok).toBe(true);
    await expect(seeding).rejects.toBeInstanceOf(DemoSeedTicketMergedError);
    expect(
      await prisma.message.count({
        where: { ticketId: { in: [s.id, t.id] }, bodyMarkdown: { startsWith: "Seed reply b" } },
      }),
    ).toBe(0);
  });

  it("(c) merge holds the row: the seed's status write waits, refuses and the source stays CLOSED", async () => {
    const { orgId, actor } = await seedActor();
    const contactEmail = email();
    const s = await seedContactTicket(orgId, { contactEmail, status: "OPEN" });
    const t = await seedContactTicket(orgId, { contactEmail });
    const first = heldMerge(actor, s.id, t.id);
    await first.held;
    const seed = pidHooks();
    const finalizing = finalizeDemoTicket(
      orgId,
      s.id,
      { status: "OPEN", updatedAt: new Date() },
      seed.hooks,
    );
    finalizing.catch(() => {});
    await waitForBlockedBy(prisma, await first.pid, [await seed.pid]);
    first.release();
    expect((await first.run).ok).toBe(true);
    const afterMerge = await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } });
    await expect(finalizing).rejects.toBeInstanceOf(DemoSeedTicketMergedError);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toEqual(afterMerge);
    expect(row.status).toBe("CLOSED");
  });

  it("(d) a merged source refuses the seed's status write and is unchanged", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const before = await snapshot(orgId);
    await expect(finalizeDemoTicket(orgId, s.id, { status: "RESOLVED" })).rejects.toBeInstanceOf(
      DemoSeedTicketMergedError,
    );
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("(e) an id in no organization is refused and nothing is written", async () => {
    const { orgId } = await seedActor();
    const before = await snapshot(orgId);
    const ticketsBefore = await prisma.ticket.count();
    const id = randomUUID();
    await expect(finalizeDemoTicket(orgId, id, { status: "RESOLVED" })).rejects.toBeInstanceOf(
      DemoSeedTicketMergedError,
    );
    expect(await prisma.ticket.count()).toBe(ticketsBefore);
    expect(await prisma.ticket.findUnique({ where: { id } })).toBeNull();
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("(e) another organization's ticket is refused and neither organization changes", async () => {
    const { orgId } = await seedActor();
    const other = await seedActor();
    const foreign = await seedContactTicket(other.orgId, { contactEmail: email() });
    const before = await snapshot(orgId);
    const beforeOther = await snapshot(other.orgId);
    await expect(
      finalizeDemoTicket(orgId, foreign.id, { status: "RESOLVED" }),
    ).rejects.toBeInstanceOf(DemoSeedTicketMergedError);
    expect(await snapshot(orgId)).toEqual(before);
    expect(await snapshot(other.orgId)).toEqual(beforeOther);
  });

  it("seedDemoData still writes the same rows its summary reports through the locked helpers", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
    const summary = await seedDemoData({
      orgId,
      adminUserId: users[0].id,
      agentUserId: users[1].id,
    });
    expect(await prisma.message.count({ where: { organizationId: orgId } })).toBe(summary.messages);
    expect(
      await prisma.message.count({ where: { organizationId: orgId, visibility: "INTERNAL" } }),
    ).toBe(summary.internalNotes);
    const statuses = await prisma.ticket.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(statuses.map((r) => [r.status, r._count._all]));
    for (const [status, count] of Object.entries(summary.byStatus)) {
      expect(byStatus[status] ?? 0).toBe(count);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Task 3: agents cannot write to a merged source; a refused agent message leaves no stored file.

describe("POST /api/tickets/{id}/messages on a merged source (review C1, C7, R3-2)", () => {
  let uploadsDir = "";
  let previousUploads: string | undefined;
  let POST: typeof import("@/app/api/tickets/[id]/messages/route")["POST"];
  let localFileStorage: typeof import("@/lib/attachments/local-file-storage")["localFileStorage"];

  beforeAll(async () => {
    uploadsDir = await mkdtemp(path.join(os.tmpdir(), "aida-merge-uploads-"));
    previousUploads = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = uploadsDir;
    ({ POST } = await import("@/app/api/tickets/[id]/messages/route"));
    ({ localFileStorage } = await import("@/lib/attachments/local-file-storage"));
  });

  afterAll(async () => {
    if (previousUploads === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploads;
    await rm(uploadsDir, { recursive: true, force: true });
  });

  afterEach(() => {
    setAgentMessageObserverForTests(null);
    routeEnv.actor = null;
    routeEnv.sends = [];
    vi.restoreAllMocks();
  });

  /** Every file stored for the organization under the temporary upload directory. */
  async function storedFiles(orgId: string): Promise<string[]> {
    const dir = path.join(uploadsDir, orgId);
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return [];
      throw err;
    }
  }

  const pdf = (name: string, marker = "fixture") =>
    new File([Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\n%%EOF\n`)], name, {
      type: "application/pdf",
    });

  function post(ticketId: string, mode: "public" | "internal", body: string, files: File[]) {
    const form = new FormData();
    form.set("mode", mode);
    form.set("body", body);
    for (const file of files) form.append("file", file);
    const request = new Request(`http://localhost/api/tickets/${ticketId}/messages`, {
      method: "POST",
      body: form,
    });
    return POST(request, { params: Promise.resolve({ id: ticketId }) });
  }

  async function mergedPair() {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    await prisma.setting.create({
      data: { organizationId: orgId, key: "email:enabled", value: "true" },
    });
    routeEnv.actor = actor;
    routeEnv.sends = [];
    return { orgId, actor, s, t };
  }

  it("refuses a public reply and an internal note with 409 MERGED_SOURCE, writes and stores nothing; the target accepts", async () => {
    const { orgId, actor, s, t } = await mergedPair();
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const before = await snapshot(orgId);

    const reply = await post(s.id, "public", "Reply to merged source", [
      pdf("a.pdf"),
      pdf("b.pdf"),
    ]);
    expect(reply.status).toBe(409);
    expect(await reply.json()).toEqual({ error: "MERGED_SOURCE" });
    const note = await post(s.id, "internal", "Note on merged source", []);
    expect(note.status).toBe(409);
    expect(await note.json()).toEqual({ error: "MERGED_SOURCE" });
    expect(await snapshot(orgId)).toEqual(before);
    expect(routeEnv.sends).toEqual([]);
    expect(await storedFiles(orgId)).toEqual([]);

    const ok = await post(t.id, "public", "Reply to target", [pdf("c.pdf")]);
    expect(ok.status).toBe(200);
    const created = await prisma.message.findFirstOrThrow({
      where: { ticketId: t.id, bodyMarkdown: "Reply to target" },
      include: { attachments: true },
    });
    expect(created.attachments).toHaveLength(1);
    expect(await storedFiles(orgId)).toEqual([created.attachments[0].storageKey]);
    expect(routeEnv.sends).toEqual([["email-outbound-send", { messageId: created.id }]]);
  });

  it("forced order: a reply observed blocked by a held merge is refused after the merge commits", async () => {
    const { orgId, actor, s, t } = await mergedPair();
    const first = heldMerge(actor, s.id, t.id);
    await first.held;
    const replyPid = deferred<number>();
    setAgentMessageObserverForTests({
      onTransactionStart: async (tx) => replyPid.resolve(await backendPid(tx)),
    });
    const reply = post(s.id, "public", "Raced reply", [pdf("raced.pdf")]);
    reply.catch(() => {});
    await waitForBlockedBy(prisma, await first.pid, [await replyPid.promise]);
    first.release();
    expect((await first.run).ok).toBe(true);
    const response = await reply;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "MERGED_SOURCE" });
    expect(
      await prisma.message.count({
        where: { ticketId: { in: [s.id, t.id] }, bodyMarkdown: "Raced reply" },
      }),
    ).toBe(0);
    expect(routeEnv.sends).toEqual([]);
    expect(await storedFiles(orgId)).toEqual([]);
  });

  it("a transaction rolled back by a sentinel rethrows it and leaves no message and no file", async () => {
    const { orgId, s } = await mergedPair();
    const before = await snapshot(orgId);
    const sentinel = new Error("route rollback sentinel");
    setAgentMessageObserverForTests({
      afterLock: () => {
        throw sentinel;
      },
    });
    await expect(post(s.id, "public", "Rolled back", [pdf("r.pdf")])).rejects.toBe(sentinel);
    expect(await snapshot(orgId)).toEqual(before);
    expect(await storedFiles(orgId)).toEqual([]);
  });

  it("an EACCES delete keeps the 409, is logged by key and code without content, and leaves that one file", async () => {
    const { orgId, actor, s, t } = await mergedPair();
    expect((await merge(actor, s.id, t.id)).ok).toBe(true);
    const marker = `CONTENT-MARKER-${randomUUID()}`;
    vi.spyOn(localFileStorage, "delete").mockRejectedValue(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(s.id, "public", "Refused with EACCES", [pdf("e.pdf", marker)]);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "MERGED_SOURCE" });
    const remaining = await storedFiles(orgId);
    expect(remaining).toHaveLength(1);
    const logged = errorSpy.mock.calls.map((args) =>
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    );
    expect(logged.some((line) => line.includes(remaining[0]) && line.includes("EACCES"))).toBe(
      true,
    );
    for (const line of logged) expect(line).not.toContain(marker);
  });

  it("a removed member gets 403 MEMBERSHIP_ENDED: no message, no stored file, nothing queued (review WR-03)", async () => {
    const { orgId, actor, t } = await mergedPair();
    await prisma.member.deleteMany({ where: { userId: actor.userId, organizationId: orgId } });
    const before = await snapshot(orgId);

    const reply = await post(t.id, "public", "Reply after removal", [pdf("gone.pdf")]);
    expect(reply.status).toBe(403);
    expect(await reply.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
    const note = await post(t.id, "internal", "Note after removal", [pdf("gone-note.pdf")]);
    expect(note.status).toBe(403);
    expect(await note.json()).toEqual({ error: "MEMBERSHIP_ENDED" });

    expect(await snapshot(orgId)).toEqual(before);
    expect(routeEnv.sends).toEqual([]);
    expect(await storedFiles(orgId)).toEqual([]);
  });

  describe("a removed member is refused before anything is read (Codex diff round 1, D2)", () => {
    async function removedMember() {
      const env = await mergedPair();
      await prisma.member.deleteMany({
        where: { userId: env.actor.userId, organizationId: env.orgId },
      });
      return env;
    }

    it("an existing id: 403 MEMBERSHIP_ENDED and no file is ever written, not even staged", async () => {
      const { orgId, t } = await removedMember();
      const before = await snapshot(orgId);
      const save = vi.spyOn(localFileStorage, "save");

      const reply = await post(t.id, "public", "Reply after removal", [pdf("early.pdf")]);
      expect(reply.status).toBe(403);
      expect(await reply.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
      expect(save).not.toHaveBeenCalled();
      expect(await snapshot(orgId)).toEqual(before);
      expect(routeEnv.sends).toEqual([]);
    });

    it("a missing id: the same 403 MEMBERSHIP_ENDED, never 404", async () => {
      const { orgId } = await removedMember();
      const before = await snapshot(orgId);

      const reply = await post(randomUUID(), "public", "Reply to nothing", []);
      expect(reply.status).toBe(403);
      expect(await reply.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
      expect(await snapshot(orgId)).toEqual(before);
    });

    it("an invalid body: the same 403 MEMBERSHIP_ENDED, never 400 or 415", async () => {
      const { orgId, t } = await removedMember();
      const before = await snapshot(orgId);

      const empty = await post(t.id, "public", "", []);
      expect(empty.status).toBe(403);
      expect(await empty.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
      const notAllowed = new File([Buffer.from("plain text, not an allowed type")], "x.txt", {
        type: "text/plain",
      });
      const unsupported = await post(t.id, "internal", "With a bad file", [notAllowed]);
      expect(unsupported.status).toBe(403);
      expect(await unsupported.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
      const malformed = await POST(
        new Request(`http://localhost/api/tickets/${t.id}/messages`, {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=missing" },
          body: "not a form",
        }),
        { params: Promise.resolve({ id: t.id }) },
      );
      expect(malformed.status).toBe(403);
      expect(await malformed.json()).toEqual({ error: "MEMBERSHIP_ENDED" });

      expect(await snapshot(orgId)).toEqual(before);
      expect(await storedFiles(orgId)).toEqual([]);
    });

    it("a removal that commits after the first check is still refused inside the transaction (WR-03 kept)", async () => {
      const { orgId, actor, t } = await mergedPair();
      setAgentMessageObserverForTests({
        // Runs inside the route's transaction, after the first check passed: the removal
        // commits on another connection before the in-transaction check reads the member row.
        onTransactionStart: async () => {
          await prisma.member.deleteMany({
            where: { userId: actor.userId, organizationId: orgId },
          });
        },
      });
      const before = await snapshot(orgId);

      const reply = await post(t.id, "public", "Reply during removal", [pdf("late.pdf")]);
      expect(reply.status).toBe(403);
      expect(await reply.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
      expect(await snapshot(orgId)).toEqual(before);
      expect(routeEnv.sends).toEqual([]);
      expect(await storedFiles(orgId)).toEqual([]);
    });

    it("an active member still gets the existing answers for a missing id and an empty body", async () => {
      const { t } = await mergedPair();
      expect((await post(randomUUID(), "public", "Reply to nothing", [])).status).toBe(404);
      const empty = await post(t.id, "public", "", []);
      expect(empty.status).toBe(400);
      expect(await empty.json()).toEqual({ error: "empty_message" });
    });
  });

  it("two concurrent first public replies keep the first firstRespondedAt stamp (review WR-04)", async () => {
    const { t } = await mergedPair();
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).firstRespondedAt,
    ).toBeNull();
    const pids = [deferred<number>(), deferred<number>()];
    let starts = 0;
    let locks = 0;
    const firstHeld = deferred<void>();
    const releaseFirst = deferred<void>();
    const committedStamp = deferred<Date | null>();
    setAgentMessageObserverForTests({
      onTransactionStart: async (tx) => {
        const slot = pids[starts++];
        slot?.resolve(await backendPid(tx));
      },
      afterLock: async (tx) => {
        if (locks++ === 0) {
          firstHeld.resolve();
          await releaseFirst.promise;
          return;
        }
        // The second reply holds the row lock after the first committed: the stamp it reads
        // here is the first reply's.
        const rows = await tx.$queryRaw<{ firstRespondedAt: Date | null }[]>`
          SELECT "firstRespondedAt" FROM "Ticket" WHERE id = ${t.id}
        `;
        const stamp = rows[0]?.firstRespondedAt ?? null;
        committedStamp.resolve(stamp);
        // A later stamp must differ at millisecond precision; this waits on database round
        // trips, not on a timer.
        while (stamp && Date.now() <= stamp.getTime()) await tx.$queryRaw`SELECT 1`;
      },
    });

    const first = post(t.id, "public", "First reply one", []);
    first.catch(() => {});
    await firstHeld.promise;
    // The second reply's own pre-read sees firstRespondedAt null: the first is uncommitted.
    const second = post(t.id, "public", "First reply two", []);
    second.catch(() => {});
    await waitForBlockedBy(prisma, await pids[0].promise, [await pids[1].promise]);
    releaseFirst.resolve();

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const stamp = await committedStamp.promise;
    expect(stamp).toBeInstanceOf(Date);
    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: t.id },
      select: { firstRespondedAt: true },
    });
    expect(after.firstRespondedAt?.toISOString()).toBe(stamp?.toISOString());
    expect(
      await prisma.message.count({
        where: { ticketId: t.id, bodyMarkdown: { startsWith: "First reply" } },
      }),
    ).toBe(2);
  });
});
