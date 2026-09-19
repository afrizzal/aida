// Phase 12, plan 12-02: the relations service (AIDA-52, D-03 to D-06) on a real Postgres
// through Testcontainers. Nothing is mocked.
import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ANCESTOR_WALK_LIMIT,
  addRelation,
  listRelationsForTicket,
  type RelationActor,
  removeRelation,
} from "@/lib/tickets/relations";
import { seedOrgWithMembers, seedRelation, seedTicket } from "../support/lifecycle-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: RelationActor = { userId: users[0].id, orgId };
  return { orgId, actor };
}

describe("addRelation (tracer)", () => {
  it("links A as a duplicate of B, shows it from both sides and audits both tickets", async () => {
    const { orgId, actor } = await seedActor();
    const a = await seedTicket(orgId);
    const b = await seedTicket(orgId);

    const result = await addRelation(prisma, actor, {
      ticketId: a.id,
      otherTicketId: b.id,
      choice: "is a duplicate of",
    });
    expect(result.ok).toBe(true);

    const fromA = await listRelationsForTicket(prisma, actor, a.id);
    const fromB = await listRelationsForTicket(prisma, actor, b.id);
    expect(fromA.ok && fromA.relations.map((r) => [r.label, r.number])).toEqual([
      ["Duplicate of", b.number],
    ]);
    expect(fromB.ok && fromB.relations.map((r) => [r.label, r.number])).toEqual([
      ["Has duplicate", a.number],
    ]);

    const audit = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: "RELATION_ADDED" },
    });
    expect(audit.map((r) => r.ticketId).sort()).toEqual([a.id, b.id].sort());
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2: refusals, remove, CHILD_OF hierarchy and PID-bound races.

const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

async function counts(orgId: string) {
  return {
    relations: await prisma.ticketRelation.count({ where: { organizationId: orgId } }),
    audit: await prisma.ticketAuditEvent.count({ where: { organizationId: orgId } }),
  };
}

const link = (actor: RelationActor, ticketId: string, otherTicketId: string, choice: string) =>
  addRelation(prisma, actor, { ticketId, otherTicketId, choice });

/** Seeds a CHILD_OF chain: ids[0] child of ids[1] child of ids[2] ... */
async function seedChain(orgId: string, userId: string, ids: string[]) {
  for (let i = 0; i + 1 < ids.length; i++) {
    await seedRelation(prisma, orgId, {
      type: "CHILD_OF",
      fromTicketId: ids[i],
      toTicketId: ids[i + 1],
      createdById: userId,
    });
  }
}

async function tickets(orgId: string, n: number) {
  const out: { id: string; number: number }[] = [];
  for (let i = 0; i < n; i++) out.push(await seedTicket(orgId));
  return out;
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

describe("addRelation: refusals change nothing", () => {
  it("SELF before any query", async () => {
    const { orgId, actor } = await seedActor();
    const [a] = await tickets(orgId, 1);
    const before = await counts(orgId);
    expect(await link(actor, a.id, a.id, "is related to")).toEqual({ ok: false, error: "SELF" });
    expect(await counts(orgId)).toEqual(before);
  });

  it.each([
    ["same direction", "is related to", false, "is related to"],
    ["reverse direction", "is related to", true, "is related to"],
    ["another type", "is related to", false, "is a duplicate of"],
  ])("ALREADY_LINKED for the same pair (%s)", async (_name, firstChoice, reverse, secondChoice) => {
    const { orgId, actor } = await seedActor();
    const [a, b] = await tickets(orgId, 2);
    expect((await link(actor, a.id, b.id, firstChoice)).ok).toBe(true);
    const before = await counts(orgId);
    const again = reverse
      ? await link(actor, b.id, a.id, secondChoice)
      : await link(actor, a.id, b.id, secondChoice);
    expect(again).toEqual({ ok: false, error: "ALREADY_LINKED" });
    expect(await counts(orgId)).toEqual(before);
  });

  it("TICKET_UNAVAILABLE for another organization's ticket", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedActor();
    const [a] = await tickets(orgId, 1);
    const [foreign] = await tickets(other.orgId, 1);
    const before = await counts(orgId);
    const otherBefore = await counts(other.orgId);
    expect(await link(actor, a.id, foreign.id, "is related to")).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await counts(orgId)).toEqual(before);
    expect(await counts(other.orgId)).toEqual(otherBefore);
  });

  it("TICKET_UNAVAILABLE for an unknown ticket id", async () => {
    const { orgId, actor } = await seedActor();
    const [a] = await tickets(orgId, 1);
    const before = await counts(orgId);
    expect(await link(actor, a.id, "no-such-ticket", "is related to")).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await counts(orgId)).toEqual(before);
  });

  it("MEMBERSHIP_ENDED when the actor's member row was deleted", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b] = await tickets(orgId, 2);
    await prisma.member.deleteMany({ where: { userId: actor.userId, organizationId: orgId } });
    const before = await counts(orgId);
    expect(await link(actor, a.id, b.id, "is related to")).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    expect(await counts(orgId)).toEqual(before);
    expect(await listRelationsForTicket(prisma, actor, a.id)).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
  });
});

describe("addRelation: CHILD_OF hierarchy (D-05)", () => {
  it("PARENT_EXISTS for a child that already has a parent", async () => {
    const { orgId, actor } = await seedActor();
    const [c, p1, p2] = await tickets(orgId, 3);
    expect((await link(actor, c.id, p1.id, "is a child of")).ok).toBe(true);
    const before = await counts(orgId);
    expect(await link(actor, c.id, p2.id, "is a child of")).toEqual({
      ok: false,
      error: "PARENT_EXISTS",
    });
    expect(await counts(orgId)).toEqual(before);
  });

  it("CYCLE: with C child of B child of A, A child of C is refused", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b, c] = await tickets(orgId, 3);
    expect((await link(actor, b.id, a.id, "is a child of")).ok).toBe(true);
    expect((await link(actor, c.id, b.id, "is a child of")).ok).toBe(true);
    const before = await counts(orgId);
    expect(await link(actor, a.id, c.id, "is a child of")).toEqual({ ok: false, error: "CYCLE" });
    expect(await counts(orgId)).toEqual(before);
  });

  it("ANCESTOR_WALK_LIMIT is 1000", () => {
    expect(ANCESTOR_WALK_LIMIT).toBe(1000);
  });

  it("a parent with exactly the limit of ancestors (3) is accepted", async () => {
    const { orgId, actor } = await seedActor();
    const [x, p, a1, a2, a3] = await tickets(orgId, 5);
    await seedChain(orgId, actor.userId, [p.id, a1.id, a2.id, a3.id]);
    const result = await addRelation(
      prisma,
      actor,
      { ticketId: x.id, otherTicketId: p.id, choice: "is a child of" },
      {},
      { ancestorWalkLimit: 3 },
    );
    expect(result.ok).toBe(true);
  });

  it("HIERARCHY_TOO_DEEP for a parent with the limit + 1 (4) ancestors, nothing written", async () => {
    const { orgId, actor } = await seedActor();
    const [y, q, a1, a2, a3, a4] = await tickets(orgId, 6);
    await seedChain(orgId, actor.userId, [q.id, a1.id, a2.id, a3.id, a4.id]);
    const before = await counts(orgId);
    const result = await addRelation(
      prisma,
      actor,
      { ticketId: y.id, otherTicketId: q.id, choice: "is a child of" },
      {},
      { ancestorWalkLimit: 3 },
    );
    expect(result).toEqual({ ok: false, error: "HIERARCHY_TOO_DEEP" });
    expect(await counts(orgId)).toEqual(before);
  });

  it("RELATED_TO and DUPLICATE_OF never wait on the organization advisory lock", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b, c] = await tickets(orgId, 3);
    const holder = holdTx(
      (tx) =>
        tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('aida:ticket-relation:child-of:' || ${orgId}, 0))::text`,
    );
    await holder.ready;
    expect((await link(actor, a.id, b.id, "is related to")).ok).toBe(true);
    expect((await link(actor, a.id, c.id, "is a duplicate of")).ok).toBe(true);
    holder.release();
    await holder.done;
  });
});

describe("removeRelation", () => {
  it("removes the row, audits both tickets, and a second remove returns ALREADY_REMOVED", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b] = await tickets(orgId, 2);
    const added = await link(actor, a.id, b.id, "is related to");
    if (!added.ok) throw new Error("setup");
    const removed = await removeRelation(prisma, actor, {
      ticketId: b.id,
      relationId: added.relationId,
    });
    expect(removed.ok).toBe(true);
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(0);
    const audit = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: "RELATION_REMOVED" },
    });
    expect(audit.map((r) => r.ticketId).sort()).toEqual([a.id, b.id].sort());
    expect(audit[0].before).toEqual({
      relationId: added.relationId,
      type: "RELATED_TO",
      fromTicketId: a.id,
      toTicketId: b.id,
    });
    expect(
      await removeRelation(prisma, actor, { ticketId: a.id, relationId: added.relationId }),
    ).toEqual({ ok: false, error: "ALREADY_REMOVED" });
  });

  it("TICKET_UNAVAILABLE for another organization's relation, which stays", async () => {
    const { actor } = await seedActor();
    const other = await seedActor();
    const [fa, fb] = await tickets(other.orgId, 2);
    const foreign = await link(other.actor, fa.id, fb.id, "is related to");
    if (!foreign.ok) throw new Error("setup");
    expect(
      await removeRelation(prisma, actor, { ticketId: fa.id, relationId: foreign.relationId }),
    ).toEqual({ ok: false, error: "TICKET_UNAVAILABLE" });
    expect(await prisma.ticketRelation.count({ where: { id: foreign.relationId } })).toBe(1);
  });

  it("MERGE_LINK for the merge's DUPLICATE_OF; another relation of the merged ticket is removable", async () => {
    const { orgId, actor } = await seedActor();
    const [s, t, r] = await tickets(orgId, 3);
    const mergeLink = await link(actor, s.id, t.id, "is a duplicate of");
    const other = await link(actor, s.id, r.id, "is related to");
    if (!mergeLink.ok || !other.ok) throw new Error("setup");
    await prisma.ticket.update({
      where: { id: s.id },
      data: {
        mergedIntoTicketId: t.id,
        mergedAt: new Date(),
        mergeMessageSeq: 1n,
        status: "CLOSED",
      },
    });
    const before = await counts(orgId);
    expect(
      await removeRelation(prisma, actor, { ticketId: t.id, relationId: mergeLink.relationId }),
    ).toEqual({ ok: false, error: "MERGE_LINK" });
    expect(await counts(orgId)).toEqual(before);
    const fromS = await listRelationsForTicket(prisma, actor, s.id);
    expect(
      fromS.ok && fromS.relations.find((c) => c.relationId === mergeLink.relationId)?.locked,
    ).toBe(true);
    expect(
      (await removeRelation(prisma, actor, { ticketId: s.id, relationId: other.relationId })).ok,
    ).toBe(true);
  });
});

describe("races bound to recorded PIDs (D-05, review C5 and C10)", () => {
  it("a removal decides from the re-read under the locks: a concurrent delete gives ALREADY_REMOVED", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b] = await tickets(orgId, 2);
    const added = await link(actor, a.id, b.id, "is related to");
    if (!added.ok) throw new Error("setup");

    const holder = holdTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ANY(${[a.id, b.id]}::text[]) ORDER BY id FOR UPDATE`;
      await tx.ticketRelation.delete({ where: { id: added.relationId } });
    });
    const holderPid = await holder.pid;
    await holder.ready;

    const pid = deferred<number>();
    const run = removeRelation(
      prisma,
      actor,
      { ticketId: a.id, relationId: added.relationId },
      { onTransactionStart: async (tx) => pid.resolve(await backendPid(tx)) },
    );
    run.catch(() => {});
    await waitForBlockedBy(prisma, holderPid, [await pid.promise]);
    holder.release();
    await holder.done;

    expect(await run).toEqual({ ok: false, error: "ALREADY_REMOVED" });
    expect(
      await prisma.ticketAuditEvent.count({
        where: { organizationId: orgId, action: "RELATION_REMOVED" },
      }),
    ).toBe(0);
  });

  it("cycle race: A child of B against B child of A, exactly one succeeds and the other is CYCLE", async () => {
    const { orgId, actor } = await seedActor();
    const [a, b] = await tickets(orgId, 2);

    const pid1 = deferred<number>();
    const locked1 = deferred<void>();
    const release1 = deferred<void>();
    const run1 = addRelation(
      prisma,
      actor,
      { ticketId: a.id, otherTicketId: b.id, choice: "is a child of" },
      {
        onTransactionStart: async (tx) => pid1.resolve(await backendPid(tx)),
        afterLock: async () => {
          locked1.resolve();
          await release1.promise;
        },
      },
    );
    run1.catch(() => {});
    const p1 = await pid1.promise;
    await locked1.promise;

    const pid2 = deferred<number>();
    const run2 = addRelation(
      prisma,
      actor,
      { ticketId: b.id, otherTicketId: a.id, choice: "is a child of" },
      { onTransactionStart: async (tx) => pid2.resolve(await backendPid(tx)) },
    );
    run2.catch(() => {});
    await waitForBlockedBy(prisma, p1, [await pid2.promise]);
    release1.resolve();

    expect((await run1).ok).toBe(true);
    expect(await run2).toEqual({ ok: false, error: "CYCLE" });
    expect(
      await prisma.ticketRelation.count({ where: { organizationId: orgId, type: "CHILD_OF" } }),
    ).toBe(1);
  });

  it.each([
    ["the first commits", false],
    ["the first rolls back", true],
  ])("same-pair race (%s): exactly one relation", async (_name, rollback) => {
    const { orgId, actor } = await seedActor();
    const [a, b] = await tickets(orgId, 2);
    const sentinel = new Error("sentinel rollback");

    const pid1 = deferred<number>();
    const held1 = deferred<void>();
    const release1 = deferred<void>();
    const run1 = addRelation(
      prisma,
      actor,
      { ticketId: a.id, otherTicketId: b.id, choice: "is related to" },
      {
        onTransactionStart: async (tx) => pid1.resolve(await backendPid(tx)),
        beforeCommit: async () => {
          held1.resolve();
          await release1.promise;
          if (rollback) throw sentinel;
        },
      },
    );
    run1.catch(() => {});
    const p1 = await pid1.promise;
    await held1.promise;

    const pid2 = deferred<number>();
    const run2 = addRelation(
      prisma,
      actor,
      { ticketId: b.id, otherTicketId: a.id, choice: "is related to" },
      { onTransactionStart: async (tx) => pid2.resolve(await backendPid(tx)) },
    );
    run2.catch(() => {});
    await waitForBlockedBy(prisma, p1, [await pid2.promise]);
    release1.resolve();

    if (rollback) {
      await expect(run1).rejects.toBe(sentinel);
      const second = await run2;
      expect(second.ok).toBe(true);
      const audit = await prisma.ticketAuditEvent.findMany({
        where: { organizationId: orgId, action: "RELATION_ADDED" },
      });
      expect(audit).toHaveLength(2);
      expect(
        audit.every(
          (r) =>
            (r.after as { relationId?: string }).relationId === (second.ok && second.relationId),
        ),
      ).toBe(true);
    } else {
      expect((await run1).ok).toBe(true);
      expect(await run2).toEqual({ ok: false, error: "ALREADY_LINKED" });
    }
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
