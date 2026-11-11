// Phase 10, plan 10-06 Task 3 (AIDA-44, V-25, V-28, T-10-25b): the notification emitters against
// deactivateMember, on a real Postgres through Testcontainers, unmocked.
//
// The SLA pass holds its candidate tickets FOR UPDATE (SKIP LOCKED) and emits with plain reads of
// member, preference and setting rows; its notification insert takes FOR KEY SHARE on the
// organization and user rows only. deactivateMember holds the organization row FOR NO KEY UPDATE
// (compatible with FOR KEY SHARE), deletes member rows and locks no ticket. So neither waits for
// the other: each must commit while the other is parked. The emitting assignment holds the
// assignee's member rows FOR SHARE (V-25), so a deactivation of that assignee waits for it, and an
// assignment that starts behind a deactivation in flight waits and is refused.
//
// K167: the pass runs one transaction per organization, so each hook below acts on this case's
// organization only.
//
// Race helpers per V-16: backendPid, deferred and waitForBlockedBy from tests/support/lock-wait.ts,
// createObserverClient, settleAll and assertNoDeadlock from tests/support/project-race.ts. Every
// PID is recorded from inside the run's own transaction through the services' seams. No sleeps.
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { slaFlagHandler } from "@/lib/worker/jobs/sla-flag";
import { deactivateMember } from "@/lib/workspace-members/member-admin";
import { type MemberRole, seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import { assertNoDeadlock, createObserverClient, settleAll } from "../support/project-race";

type Tx = Prisma.TransactionClient;

const MIN = 60_000;

const observer = createObserverClient();
afterAll(async () => {
  await observer.close();
});

/** Parks the first call after recording its PID; later calls pass through. */
function holdPoint() {
  const pid = deferred<number>();
  const gate = deferred<void>();
  let used = false;
  return {
    pid: pid.promise,
    release: () => gate.resolve(),
    hook: async (tx: Tx) => {
      if (used) return;
      used = true;
      pid.resolve(await backendPid(tx));
      await gate.promise;
    },
  };
}

/** Records the PID of the first call. */
function pidPoint() {
  const pid = deferred<number>();
  let used = false;
  return {
    pid: pid.promise,
    hook: async (tx: Tx) => {
      if (used) return;
      used = true;
      pid.resolve(await backendPid(tx));
    },
  };
}

/** An organization in the given roles with one open ticket overdue on first response at `now`. */
async function seedOverdue(roles: readonly MemberRole[], now: Date, assigneeIndex: number | null) {
  const { orgId, users } = await seedOrgWithMembers(prisma, roles);
  const ticket = await seedTicket(orgId, {
    status: "OPEN",
    assigneeId: assigneeIndex === null ? null : users[assigneeIndex].id,
  });
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      firstResponseDueAt: new Date(now.getTime() - 5 * MIN),
      resolutionDueAt: new Date(now.getTime() + 8 * 60 * MIN),
    },
  });
  return { orgId, users, ticketId: ticket.id };
}

function notificationsOf(orgId: string) {
  return prisma.notification.findMany({
    where: { organizationId: orgId },
    orderBy: [{ recipientUserId: "asc" }],
  });
}

function memberRows(orgId: string, userId: string) {
  return prisma.member.count({ where: { organizationId: orgId, userId } });
}

describe("SLA pass against deactivation (V-25, V-28)", () => {
  it("SLA pass parked in afterPassUpdate: the deactivation of the assignee commits without waiting, then the pass commits", async () => {
    const now = new Date(Date.now());
    const { orgId, users, ticketId } = await seedOverdue(["owner", "member"], now, 1);
    const [owner, x] = users;
    const hold = holdPoint();
    const wait = pidPoint();
    let passDone = false;

    const pass = slaFlagHandler(undefined, {
      now,
      afterPassUpdate: (tx, p, org) =>
        p === "breach" && org === orgId ? hold.hook(tx) : undefined,
    }).then(() => {
      passDone = true;
    });
    pass.catch(() => {});
    let deactivation: Promise<unknown> = Promise.resolve();
    try {
      const passPid = await hold.pid;
      deactivation = deactivateMember(
        { orgId, actorUserId: owner.id, targetUserId: x.id },
        { beforeLock: wait.hook },
      );
      deactivation.catch(() => {});
      const deactivationPid = await wait.pid;
      expect(deactivationPid).not.toBe(passPid);
      // The deactivation does not queue behind the parked pass: it commits while the pass holds
      // its ticket lock and its uncommitted notification row.
      await expect(deactivation).resolves.toMatchObject({ ok: true });
      expect(passDone).toBe(false);
    } finally {
      hold.release();
    }
    const results = await settleAll<unknown>([pass, deactivation]);
    assertNoDeadlock(results);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.isBreached).toBe(true);
    expect(await memberRows(orgId, x.id)).toBe(0);
    // The pass read X's member row before the deactivation committed: one inert row for X, which
    // the bell and the digest re-check against membership when they read (D-25).
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type])).toEqual([[x.id, "SLA_BREACHED"]]);
  });

  it("deactivation parked after its delete: the SLA pass commits without waiting, then the deactivation commits", async () => {
    const now = new Date(Date.now());
    const { orgId, users, ticketId } = await seedOverdue(["owner", "member"], now, 1);
    const [owner, x] = users;
    const hold = holdPoint();
    const wait = pidPoint();
    let deactivationDone = false;

    const deactivation = deactivateMember(
      { orgId, actorUserId: owner.id, targetUserId: x.id },
      { afterDelete: (tx) => hold.hook(tx) },
    ).then((r) => {
      deactivationDone = true;
      return r;
    });
    deactivation.catch(() => {});
    let pass: Promise<unknown> = Promise.resolve();
    try {
      const deactivationPid = await hold.pid;
      pass = slaFlagHandler(undefined, {
        now,
        onPassTransaction: (tx, p, org) =>
          p === "breach" && org === orgId ? wait.hook(tx) : undefined,
      });
      pass.catch(() => {});
      const passPid = await wait.pid;
      expect(passPid).not.toBe(deactivationPid);
      await expect(pass).resolves.toBeUndefined();
      expect(deactivationDone).toBe(false);
    } finally {
      hold.release();
    }
    const results = await settleAll<unknown>([deactivation, pass]);
    assertNoDeadlock(results);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(results[1]).toMatchObject({ status: "fulfilled" });

    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).isBreached).toBe(
      true,
    );
    expect(await memberRows(orgId, x.id)).toBe(0);
    // The deletion was not committed when the pass read: the snapshot still held X.
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type])).toEqual([[x.id, "SLA_BREACHED"]]);
  });

  it("unassigned fallback: the pass parked after emitting to owners and admins does not block the deactivation of an admin", async () => {
    const now = new Date(Date.now());
    const { orgId, users } = await seedOverdue(["owner", "admin", "admin"], now, null);
    const [owner, adminA, adminB] = users;
    const hold = holdPoint();
    const wait = pidPoint();

    const pass = slaFlagHandler(undefined, {
      now,
      afterPassUpdate: (tx, p, org) =>
        p === "breach" && org === orgId ? hold.hook(tx) : undefined,
    });
    pass.catch(() => {});
    let deactivation: Promise<unknown> = Promise.resolve();
    try {
      await hold.pid;
      deactivation = deactivateMember(
        { orgId, actorUserId: owner.id, targetUserId: adminA.id },
        { beforeLock: wait.hook },
      );
      deactivation.catch(() => {});
      await wait.pid;
      await expect(deactivation).resolves.toMatchObject({ ok: true });
    } finally {
      hold.release();
    }
    const results = await settleAll<unknown>([pass, deactivation]);
    assertNoDeadlock(results);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const rows = await notificationsOf(orgId);
    expect(new Set(rows.map((r) => r.recipientUserId))).toEqual(
      new Set([owner.id, adminA.id, adminB.id]),
    );
    expect(rows.every((r) => r.unassignedFallback && r.type === "SLA_BREACHED")).toBe(true);
    expect(await memberRows(orgId, adminA.id)).toBe(0);
  });
});

describe("emitting assignment against deactivation of the assignee (V-25)", () => {
  it("assignment parked in afterItem after emitting: the deactivation waits for it, both commit, one ASSIGNED row", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, x] = users;
    const ticket = await seedTicket(orgId, { status: "OPEN" });
    const hold = holdPoint();
    const wait = pidPoint();
    const order: string[] = [];

    const assignment = runTicketMutation(
      {
        actor: { userId: owner.id, orgId },
        ticketIds: [ticket.id],
        op: { kind: "assign", assigneeId: x.id },
        mode: "single",
      },
      { afterItem: (tx) => hold.hook(tx) },
    ).then((r) => {
      order.push("assignment");
      return r;
    });
    assignment.catch(() => {});
    let deactivation: Promise<unknown> = Promise.resolve();
    try {
      const assignmentPid = await hold.pid;
      deactivation = deactivateMember(
        { orgId, actorUserId: owner.id, targetUserId: x.id },
        { beforeLock: wait.hook },
      ).then((r) => {
        order.push("deactivation");
        return r;
      });
      deactivation.catch(() => {});
      const deactivationPid = await wait.pid;
      await waitForBlockedBy(observer.client, assignmentPid, [deactivationPid]);
    } finally {
      hold.release();
    }
    const results = await settleAll<unknown>([assignment, deactivation]);
    assertNoDeadlock(results);
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { ok: true, count: 1, batchId: null },
    });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(order).toEqual(["assignment", "deactivation"]);

    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBe(
      x.id,
    );
    expect(await memberRows(orgId, x.id)).toBe(0);
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type, r.entityId])).toEqual([
      [x.id, "ASSIGNED", ticket.id],
    ]);
  });

  it("deactivation parked after its delete: the emitting assignment waits, is refused with MEMBER_NOT_ACTIVE and writes no row", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, x] = users;
    const ticket = await seedTicket(orgId, { status: "OPEN" });
    const hold = holdPoint();
    const wait = pidPoint();

    const deactivation = deactivateMember(
      { orgId, actorUserId: owner.id, targetUserId: x.id },
      { afterDelete: (tx) => hold.hook(tx) },
    );
    deactivation.catch(() => {});
    let assignment: Promise<unknown> = Promise.resolve();
    try {
      const deactivationPid = await hold.pid;
      assignment = runTicketMutation(
        {
          actor: { userId: owner.id, orgId },
          ticketIds: [ticket.id],
          op: { kind: "assign", assigneeId: x.id },
          mode: "single",
        },
        { onTransactionStart: wait.hook },
      );
      assignment.catch(() => {});
      const assignmentPid = await wait.pid;
      await waitForBlockedBy(observer.client, deactivationPid, [assignmentPid]);
    } finally {
      hold.release();
    }
    const results = await settleAll<unknown>([deactivation, assignment]);
    assertNoDeadlock(results);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { ok: false, error: "MEMBER_NOT_ACTIVE" },
    });
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId,
    ).toBeNull();
    expect(await notificationsOf(orgId)).toEqual([]);
  });
});
