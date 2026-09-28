import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findActiveMembership } from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";
import { recordTicketAudit } from "@/lib/tickets/ticket-audit";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

type SavedViewVisibilityValue = "PRIVATE" | "SHARED";

const STORED_FILTERS = { version: 2, view: "all", stateIds: [] } as const;

function createView(
  orgId: string,
  ownerUserId: string,
  name: string,
  visibility: SavedViewVisibilityValue,
  position = 0,
) {
  return prisma.savedView.create({
    data: {
      organizationId: orgId,
      ownerUserId,
      name,
      visibility,
      filters: STORED_FILTERS,
      position,
    },
  });
}

/** Unique violation from Postgres (23505) as surfaced by Prisma (P2002) or the pg adapter. */
function isUniqueViolation(err: unknown, index: string): boolean {
  const text = `${(err as { code?: string })?.code ?? ""} ${String((err as Error)?.message ?? err)} ${JSON.stringify((err as { meta?: unknown })?.meta ?? {})}`;
  return /P2002|23505|unique/i.test(text) && (text.includes(index) || /P2002/.test(text));
}

const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

// Better Auth's organization/user/member models have no @default() on id or createdAt,
// so every seed row carries explicit values.
async function seedOrg(label: string) {
  return prisma.organization.create({
    data: {
      id: randomUUID(),
      name: `Inbox ${label}`,
      slug: `inbox-${label}-${randomUUID()}`,
      createdAt: new Date(),
    },
  });
}

describe("Phase 11 schema: TicketAuditEvent", () => {
  it("recordTicketAudit writes one row with the given fields", async () => {
    const org = await seedOrg("audit-write");
    const ticketId = randomUUID();
    const userId = randomUUID();
    const batchId = randomUUID();

    const { id } = await prisma.$transaction((tx) =>
      recordTicketAudit(tx, org.id, {
        ticketId,
        actorType: "USER",
        actorUserId: userId,
        action: "STATUS_CHANGED",
        before: { status: "OPEN" },
        after: { status: "RESOLVED" },
        batchId,
      }),
    );

    const rows = await prisma.ticketAuditEvent.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      organizationId: org.id,
      ticketId,
      actorType: "USER",
      actorUserId: userId,
      action: "STATUS_CHANGED",
      before: { status: "OPEN" },
      after: { status: "RESOLVED" },
      batchId,
    });
  });

  it("records through a scopedDb transaction client with organizationId set explicitly", async () => {
    const org = await seedOrg("audit-scoped");
    const ticketId = randomUUID();
    const db = scopedDb(org.id);

    await db.$transaction((tx) =>
      recordTicketAudit(tx, org.id, {
        ticketId,
        actorType: "SYSTEM",
        actorUserId: null,
        action: "AUTO_CLOSED",
        before: { status: "RESOLVED" },
        after: { status: "CLOSED" },
      }),
    );

    const row = await db.ticketAuditEvent.findFirst({ where: { ticketId } });
    expect(row).toMatchObject({
      organizationId: org.id,
      actorType: "SYSTEM",
      actorUserId: null,
      batchId: null,
    });
  });

  it("rejects a direct UPDATE and a direct DELETE at the database level", async () => {
    const org = await seedOrg("audit-immutable");
    const { id } = await recordTicketAudit(prisma, org.id, {
      ticketId: randomUUID(),
      actorType: "SYSTEM",
      actorUserId: null,
      action: "AUTO_CLOSED",
      before: { status: "RESOLVED" },
      after: { status: "CLOSED" },
    });

    await expect(
      prisma.ticketAuditEvent.update({ where: { id }, data: { action: "TAG_ADDED" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.ticketAuditEvent.delete({ where: { id } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`UPDATE "TicketAuditEvent" SET "batchId" = 'x' WHERE id = ${id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM "TicketAuditEvent" WHERE id = ${id}`,
    ).rejects.toThrow(/append-only/);

    const still = await prisma.ticketAuditEvent.findUnique({ where: { id } });
    expect(still?.action).toBe("AUTO_CLOSED");
    expect(still?.batchId).toBeNull();
  });

  it("hides organization A's audit rows from scopedDb(orgB) reads and updateMany", async () => {
    const orgA = await seedOrg("audit-iso-a");
    const orgB = await seedOrg("audit-iso-b");
    const ticketId = randomUUID();
    await recordTicketAudit(prisma, orgA.id, {
      ticketId,
      actorType: "SYSTEM",
      actorUserId: null,
      action: "AUTO_CLOSED",
      before: { status: "RESOLVED" },
      after: { status: "CLOSED" },
    });

    const dbB = scopedDb(orgB.id);
    expect(await dbB.ticketAuditEvent.findMany({ where: { ticketId } })).toHaveLength(0);
    expect(await dbB.ticketAuditEvent.findFirst({ where: { ticketId } })).toBeNull();
    expect(await dbB.ticketAuditEvent.count({ where: { ticketId } })).toBe(0);
    // updateMany through B touches zero rows of A, so the trigger never even fires.
    const updated = await dbB.ticketAuditEvent.updateMany({
      where: { ticketId },
      data: { batchId: "tampered" },
    });
    expect(updated.count).toBe(0);

    expect(await scopedDb(orgA.id).ticketAuditEvent.count({ where: { ticketId } })).toBe(1);
  });
});

describe("Phase 11 schema: SavedView isolation (D-22)", () => {
  it("hides organization A's views from scopedDb(orgB) reads and leaves them untouched by its writes", async () => {
    const a = await seedOrgWithMembers(prisma, ["member"]);
    const b = await seedOrgWithMembers(prisma, ["member"]);
    const view = await createView(a.orgId, a.users[0].id, "A private", "PRIVATE");
    await createView(a.orgId, a.users[0].id, "A shared", "SHARED", 1);

    const dbB = scopedDb(b.orgId);
    expect(await dbB.savedView.findMany()).toHaveLength(0);
    expect(await dbB.savedView.findFirst({ where: { id: view.id } })).toBeNull();
    expect(await dbB.savedView.count()).toBe(0);
    expect(
      (await dbB.savedView.updateMany({ where: { id: view.id }, data: { name: "Hijacked" } }))
        .count,
    ).toBe(0);
    expect((await dbB.savedView.deleteMany({ where: { id: view.id } })).count).toBe(0);
    expect((await dbB.savedView.deleteMany()).count).toBe(0);

    const dbA = scopedDb(a.orgId);
    expect(await dbA.savedView.count()).toBe(2);
    expect((await dbA.savedView.findFirst({ where: { id: view.id } }))?.name).toBe("A private");
  });
});

describe("Phase 11 schema: SavedView name uniqueness (D-04)", () => {
  it("rejects two PRIVATE views of one owner whose names differ only in case", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    await createView(orgId, users[0].id, "Urgent", "PRIVATE");
    const err = await createView(orgId, users[0].id, "urgent", "PRIVATE", 1).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isUniqueViolation(err, "SavedView_private_name_key")).toBe(true);
  });

  it("allows the same PRIVATE name for two owners", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    await createView(orgId, users[0].id, "Urgent", "PRIVATE");
    await createView(orgId, users[1].id, "Urgent", "PRIVATE");
    expect(await prisma.savedView.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("allows one PRIVATE and one SHARED view with the same name", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    await createView(orgId, users[0].id, "Urgent", "PRIVATE");
    await createView(orgId, users[0].id, "Urgent", "SHARED", 1);
    expect(await prisma.savedView.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("rejects two SHARED views with the same name (ignoring case) in one organization", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "admin"]);
    await createView(orgId, users[0].id, "Team queue", "SHARED");
    const err = await createView(orgId, users[1].id, "TEAM QUEUE", "SHARED", 1).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isUniqueViolation(err, "SavedView_shared_name_key")).toBe(true);
  });

  it("allows the same SHARED name in two organizations", async () => {
    const a = await seedOrgWithMembers(prisma, ["member"]);
    const b = await seedOrgWithMembers(prisma, ["member"]);
    await createView(a.orgId, a.users[0].id, "Team queue", "SHARED");
    await createView(b.orgId, b.users[0].id, "Team queue", "SHARED");
    expect(
      await prisma.savedView.count({ where: { name: "Team queue", organizationId: a.orgId } }),
    ).toBe(1);
    expect(
      await prisma.savedView.count({ where: { name: "Team queue", organizationId: b.orgId } }),
    ).toBe(1);
  });
});

describe("Phase 11 schema: SHARED name race (AIDA-47, Codex review R2-2)", () => {
  async function raceSharedName(outcome: "commit" | "rollback") {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member", "member"]);
    const [u1, u2] = users;
    const SENTINEL = new Error("T1 rollback sentinel");
    const pidT1 = deferred<number>();
    const t1Inserted = deferred<void>();
    const releaseT1 = deferred<void>();
    const pidT2 = deferred<number>();

    const t1 = prisma.$transaction(async (tx) => {
      pidT1.resolve(await backendPid(tx));
      await tx.savedView.create({
        data: {
          organizationId: orgId,
          ownerUserId: u1.id,
          name: "Escalations",
          visibility: "SHARED",
          filters: STORED_FILTERS,
          position: 0,
        },
      });
      t1Inserted.resolve();
      await releaseT1.promise;
      if (outcome === "rollback") throw SENTINEL;
    }, TX_OPTS);
    t1.catch(() => {});

    // T2 starts only after T1 has inserted and is holding before commit.
    await t1Inserted.promise;
    const t2 = prisma.$transaction(async (tx) => {
      pidT2.resolve(await backendPid(tx));
      await tx.savedView.create({
        data: {
          organizationId: orgId,
          ownerUserId: u2.id,
          name: "escalations",
          visibility: "SHARED",
          filters: STORED_FILTERS,
          position: 1,
        },
      });
    }, TX_OPTS);
    t2.catch(() => {});

    const p1 = await pidT1.promise;
    const p2 = await pidT2.promise;
    // The evidence of the race: T2's insert is observed waiting on T1's uncommitted row in
    // SavedView_shared_name_key BEFORE T1 is released.
    let observedBlocked = false;
    await waitForBlockedBy(prisma, p1, [p2]);
    observedBlocked = true;
    releaseT1.resolve();

    const [r1, r2] = await Promise.allSettled([t1, t2]);
    const rows = await prisma.savedView.findMany({
      where: {
        organizationId: orgId,
        visibility: "SHARED",
        name: { equals: "escalations", mode: "insensitive" },
      },
    });
    return { observedBlocked, r1, r2, rows, u1, u2, SENTINEL };
  }

  it("first commits: the second insert, observed blocked, fails with a unique violation", async () => {
    const { observedBlocked, r1, r2, rows, u1 } = await raceSharedName("commit");
    expect(observedBlocked).toBe(true);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("rejected");
    expect(
      isUniqueViolation((r2 as PromiseRejectedResult).reason, "SavedView_shared_name_key"),
    ).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerUserId).toBe(u1.id);
    expect(rows[0].name).toBe("Escalations");
  });

  it("first rolls back: the second insert, observed blocked, commits", async () => {
    const { observedBlocked, r1, r2, rows, u2, SENTINEL } = await raceSharedName("rollback");
    expect(observedBlocked).toBe(true);
    expect(r1.status).toBe("rejected");
    expect((r1 as PromiseRejectedResult).reason).toBe(SENTINEL);
    expect(r2.status).toBe("fulfilled");
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerUserId).toBe(u2.id);
    expect(rows[0].name).toBe("escalations");
  });
});

describe("Phase 11 schema: CHECK constraints", () => {
  it("rejects an empty and an 81-character view name, accepts 80 characters", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    await expect(createView(orgId, users[0].id, "", "PRIVATE")).rejects.toThrow(
      /SavedView_name_length_check|check constraint/i,
    );
    await expect(createView(orgId, users[0].id, "x".repeat(81), "PRIVATE")).rejects.toThrow(
      /SavedView_name_length_check|check constraint/i,
    );
    await createView(orgId, users[0].id, "y".repeat(80), "PRIVATE");
    expect(await prisma.savedView.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("ties actorType SYSTEM to a null actorUserId and USER to a non-null one", async () => {
    const org = await seedOrg("actor-check");
    const base = {
      organizationId: org.id,
      ticketId: randomUUID(),
      action: "STATUS_CHANGED" as const,
      before: { status: "OPEN" },
      after: { status: "PENDING" },
    };
    await expect(
      prisma.ticketAuditEvent.create({
        data: { ...base, actorType: "SYSTEM", actorUserId: randomUUID() },
      }),
    ).rejects.toThrow(/TicketAuditEvent_actor_check|check constraint/i);
    await expect(
      prisma.ticketAuditEvent.create({ data: { ...base, actorType: "USER", actorUserId: null } }),
    ).rejects.toThrow(/TicketAuditEvent_actor_check|check constraint/i);
    expect(await prisma.ticketAuditEvent.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("Phase 11: findActiveMembership (D-01)", () => {
  it("returns id and role for a member through the global, scoped and transaction clients", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
    const [admin] = users;
    const expected = { id: admin.memberId, role: "admin" };
    expect(await findActiveMembership(prisma, admin.id, orgId)).toEqual(expected);
    expect(await findActiveMembership(scopedDb(orgId), admin.id, orgId)).toEqual(expected);
    expect(
      await prisma.$transaction((tx) => findActiveMembership(tx, admin.id, orgId), TX_OPTS),
    ).toEqual(expected);
  });

  it("returns null once the member row is deleted and for a member of another organization only", async () => {
    const a = await seedOrgWithMembers(prisma, ["member"]);
    const b = await seedOrgWithMembers(prisma, ["owner"]);
    expect(await findActiveMembership(prisma, b.users[0].id, a.orgId)).toBeNull();

    const [m] = a.users;
    expect(await findActiveMembership(prisma, m.id, a.orgId)).not.toBeNull();
    await prisma.member.delete({ where: { id: m.memberId } });
    expect(await findActiveMembership(prisma, m.id, a.orgId)).toBeNull();
    // The user row still exists; only the membership is gone.
    expect(await prisma.user.findUnique({ where: { id: m.id } })).not.toBeNull();
  });
});

describe("tests/support/lock-wait self-tests (Codex review C6)", () => {
  /** Opens an interactive transaction, records its PID, runs body, then holds until released. */
  function holdTx(body: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    const pid = deferred<number>();
    const release = deferred<void>();
    const done = prisma.$transaction(async (tx) => {
      pid.resolve(await backendPid(tx));
      await body(tx);
      await release.promise;
    }, TX_OPTS);
    done.catch(() => {});
    return { pid: pid.promise, release: () => release.resolve(), done };
  }

  const lockRow = (id: string) => (tx: Prisma.TransactionClient) =>
    tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
  const updateRow = (id: string) => (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`UPDATE "Ticket" SET "subject" = "subject" WHERE id = ${id}`;
  const idle = async () => {};

  async function expectTimeout(promise: Promise<void>, timeoutMs: number) {
    const started = Date.now();
    await expect(promise).rejects.toThrow(/not blocked by holder/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(timeoutMs);
  }

  it("resolves when the recorded waiter is blocked by the recorded holder on a row lock", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, []);
    const t = await seedTicket(orgId);
    const lockTaken = deferred<void>();
    const holder = holdTx(async (tx) => {
      await lockRow(t.id)(tx);
      lockTaken.resolve();
    });
    const holderPid = await holder.pid;
    await lockTaken.promise;
    const waiter = holdTx(updateRow(t.id));
    const waiterPid = await waiter.pid;

    await waitForBlockedBy(prisma, holderPid, [waiterPid]);

    holder.release();
    waiter.release();
    await Promise.all([holder.done, waiter.done]);
  });

  it("times out when the listed PID is open but not waiting", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, []);
    const t = await seedTicket(orgId);
    const lockTaken = deferred<void>();
    const holder = holdTx(async (tx) => {
      await lockRow(t.id)(tx);
      lockTaken.resolve();
    });
    const holderPid = await holder.pid;
    await lockTaken.promise;
    const other = holdTx(idle);
    const otherPid = await other.pid;

    await expectTimeout(waitForBlockedBy(prisma, holderPid, [otherPid], { timeoutMs: 500 }), 500);

    holder.release();
    other.release();
    await Promise.all([holder.done, other.done]);
  });

  it("times out when the listed PID is blocked by a different holder", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, []);
    const r1 = await seedTicket(orgId);
    const r2 = await seedTicket(orgId);
    const locked1 = deferred<void>();
    const locked2 = deferred<void>();
    const h1 = holdTx(async (tx) => {
      await lockRow(r1.id)(tx);
      locked1.resolve();
    });
    const h2 = holdTx(async (tx) => {
      await lockRow(r2.id)(tx);
      locked2.resolve();
    });
    const h1Pid = await h1.pid;
    const h2Pid = await h2.pid;
    await Promise.all([locked1.promise, locked2.promise]);
    const w = holdTx(updateRow(r2.id));
    const wPid = await w.pid;
    // Precondition: W really is waiting, on H2.
    await waitForBlockedBy(prisma, h2Pid, [wPid]);

    await expectTimeout(waitForBlockedBy(prisma, h1Pid, [wPid], { timeoutMs: 500 }), 500);

    h1.release();
    h2.release();
    w.release();
    await Promise.all([h1.done, h2.done, w.done]);
  });

  it("times out when only some other backend is blocked by the holder", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, []);
    const t = await seedTicket(orgId);
    const lockTaken = deferred<void>();
    const holder = holdTx(async (tx) => {
      await lockRow(t.id)(tx);
      lockTaken.resolve();
    });
    const hPid = await holder.pid;
    await lockTaken.promise;
    const w1 = holdTx(updateRow(t.id));
    const w1Pid = await w1.pid;
    const w2 = holdTx(idle);
    const w2Pid = await w2.pid;
    // Precondition: W1 is blocked by H, so an anonymous count would be satisfied.
    await waitForBlockedBy(prisma, hPid, [w1Pid]);

    await expectTimeout(waitForBlockedBy(prisma, hPid, [w2Pid], { timeoutMs: 500 }), 500);
    await expectTimeout(waitForBlockedBy(prisma, hPid, [w1Pid, w2Pid], { timeoutMs: 500 }), 500);

    holder.release();
    w1.release();
    w2.release();
    await Promise.all([holder.done, w1.done, w2.done]);
  });

  it("throws at once, before any query, for an empty waiter list", async () => {
    let queries = 0;
    const observer = {
      $queryRaw: async <T>() => {
        queries += 1;
        return [] as T;
      },
    };
    await expect(waitForBlockedBy(observer, 1, [])).rejects.toThrow(/at least one/);
    expect(queries).toBe(0);
  });
});
