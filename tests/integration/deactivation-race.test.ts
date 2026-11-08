// Phase 10, plan 10-03 Task 3 (AIDA-43, V-25, V-16, T-10-13c): ticket assignment against the
// deactivation of the assignee, in both commit orders, single and bulk (100 tickets), on a real
// Postgres through Testcontainers, unmocked.
//
// The mechanism under test: runTicketMutation reads the assignee with shareLockActiveMembership
// (every member row of the assignee FOR SHARE, before the ticket lock), and deactivateMember holds
// the organization row FOR NO KEY UPDATE and deletes the member rows. The assignment's audit insert
// takes FOR KEY SHARE on the organization row, which NO KEY UPDATE does not block, so no cycle can
// form: the deactivation's delete waits for an assignment in flight, and an assignment waits for
// a deactivation in flight and then sees no member row.
//
// Every race records each run's backend PID from inside its own transaction through the service's
// hook (afterItem and onTransactionStart for runTicketMutation; beforeLock and afterDelete for
// deactivateMember), parks the holder on a deferred, proves with waitForBlockedBy that exactly the
// waiter's PID is blocked by the holder's PID, releases, and ends with assertNoDeadlock and the
// final database state (ticket assignee, member rows, audit rows).
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { deactivateMember } from "@/lib/workspace-members/member-admin";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import { assertNoDeadlock, createObserverClient, settleAll } from "../support/project-race";

type Tx = Prisma.TransactionClient;

/** Each race passes its own proof: the waiter's recorded PID blocked by the holder's PID. */
type ProveBlocked = (holderPid: number, waiterPid: number) => Promise<void>;

const observer = createObserverClient();
afterAll(async () => {
  await observer.close();
});

/** Owner O and member X, plus `count` open unassigned tickets. */
async function seedRace(count: number) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const [owner, member] = users;
  if (!owner || !member) throw new Error("fixture users missing");
  const ticketIds: string[] = [];
  for (let i = 0; i < count; i++) {
    ticketIds.push((await seedTicket(orgId, { status: "OPEN" })).id);
  }
  return { orgId, o: owner.id, x: member.id, ticketIds };
}

/** Parks the first call (records its PID first); later calls pass through. */
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

function pidPoint() {
  const pid = deferred<number>();
  return {
    pid: pid.promise,
    hook: async (tx: Tx) => {
      pid.resolve(await backendPid(tx));
    },
  };
}

async function assigneesOf(ticketIds: readonly string[]) {
  const rows = await prisma.ticket.findMany({
    where: { id: { in: [...ticketIds] } },
    select: { assigneeId: true },
  });
  return rows.map((r) => r.assigneeId);
}

function memberRows(orgId: string, userId: string) {
  return prisma.member.count({ where: { organizationId: orgId, userId } });
}

function ticketAudit(orgId: string) {
  return prisma.ticketAuditEvent.findMany({ where: { organizationId: orgId } });
}

function memberAudit(orgId: string) {
  return prisma.memberAuditEvent.findMany({ where: { organizationId: orgId } });
}

/**
 * Assignment first: the assignment (single or bulk) parks in afterItem, holding X's member rows
 * FOR SHARE and its tickets FOR UPDATE; the deactivation of X records its PID in beforeLock and
 * must be blocked by the assignment's PID. Returns both settled results in commit order.
 */
async function assignmentFirst(count: number, proveBlocked: ProveBlocked) {
  const ctx = await seedRace(count);
  const { orgId, o, x, ticketIds } = ctx;
  const hold = holdPoint();
  const wait = pidPoint();
  const order: string[] = [];

  const assignment = runTicketMutation(
    {
      actor: { userId: o, orgId },
      ticketIds,
      op: { kind: "assign", assigneeId: x },
      mode: count === 1 ? "single" : "bulk",
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
      { orgId, actorUserId: o, targetUserId: x },
      { beforeLock: wait.hook },
    ).then((r) => {
      order.push("deactivation");
      return r;
    });
    deactivation.catch(() => {});
    const deactivationPid = await wait.pid;
    await proveBlocked(assignmentPid, deactivationPid);
  } finally {
    hold.release();
  }
  const results = await settleAll<unknown>([assignment, deactivation]);
  return { ...ctx, results, order };
}

/**
 * Deactivation first: the deactivation of X parks in afterDelete (X's member rows deleted, not yet
 * committed); the assignment records its PID in onTransactionStart and must be blocked by the
 * deactivation's PID (its share lock on X's rows).
 */
async function deactivationFirst(count: number, proveBlocked: ProveBlocked) {
  const ctx = await seedRace(count);
  const { orgId, o, x, ticketIds } = ctx;
  const hold = holdPoint();
  const wait = pidPoint();

  const deactivation = deactivateMember(
    { orgId, actorUserId: o, targetUserId: x },
    { afterDelete: (tx) => hold.hook(tx) },
  );
  deactivation.catch(() => {});
  let assignment: Promise<unknown> = Promise.resolve();
  try {
    const deactivationPid = await hold.pid;
    assignment = runTicketMutation(
      {
        actor: { userId: o, orgId },
        ticketIds,
        op: { kind: "assign", assigneeId: x },
        mode: count === 1 ? "single" : "bulk",
      },
      { onTransactionStart: wait.hook },
    );
    assignment.catch(() => {});
    const assignmentPid = await wait.pid;
    await proveBlocked(deactivationPid, assignmentPid);
  } finally {
    hold.release();
  }
  const results = await settleAll<unknown>([deactivation, assignment]);
  return { ...ctx, results };
}

describe("assignment against deactivation of the assignee (V-25)", () => {
  it("assignment first: the assignment commits with assignee X, then the deactivation removes X", async () => {
    const { orgId, o, x, ticketIds, results, order } = await assignmentFirst(
      1,
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    assertNoDeadlock(results);
    const [assignment, deactivation] = results;
    expect(assignment).toEqual({
      status: "fulfilled",
      value: { ok: true, count: 1, batchId: null },
    });
    expect(deactivation).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(order).toEqual(["assignment", "deactivation"]);

    expect(await assigneesOf(ticketIds)).toEqual([x]);
    expect(await memberRows(orgId, x)).toBe(0);
    const audit = await ticketAudit(orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "ASSIGNEE_CHANGED", actorUserId: o });
    expect(audit[0]?.after).toEqual({ assigneeId: x });
    expect((await memberAudit(orgId)).map((a) => a.action)).toEqual(["MEMBER_DEACTIVATED"]);
  });

  it("deactivation first: the assignment fails with MEMBER_NOT_ACTIVE and the ticket is unchanged", async () => {
    const { orgId, x, ticketIds, results } = await deactivationFirst(1, (holderPid, waiterPid) =>
      waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    assertNoDeadlock(results);
    const [deactivation, assignment] = results;
    expect(deactivation).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(assignment).toEqual({
      status: "fulfilled",
      value: { ok: false, error: "MEMBER_NOT_ACTIVE" },
    });

    expect(await assigneesOf(ticketIds)).toEqual([null]);
    expect(await memberRows(orgId, x)).toBe(0);
    expect(await ticketAudit(orgId)).toHaveLength(0);
    expect((await memberAudit(orgId)).map((a) => a.action)).toEqual(["MEMBER_DEACTIVATED"]);
  });
});

describe("bulk assignment of 100 tickets against deactivation of the assignee (V-25)", () => {
  it("assignment first: all 100 tickets are assigned to X, then X is removed", {
    timeout: 180_000,
  }, async () => {
    const { orgId, x, ticketIds, results, order } = await assignmentFirst(
      100,
      (holderPid, waiterPid) => waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    assertNoDeadlock(results);
    const [assignment, deactivation] = results;
    expect(assignment).toMatchObject({ status: "fulfilled", value: { ok: true, count: 100 } });
    expect(deactivation).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(order).toEqual(["assignment", "deactivation"]);

    const assignees = await assigneesOf(ticketIds);
    expect(assignees).toHaveLength(100);
    expect(assignees.every((a) => a === x)).toBe(true);
    expect(await memberRows(orgId, x)).toBe(0);
    const audit = await ticketAudit(orgId);
    expect(audit).toHaveLength(100);
    expect(new Set(audit.map((a) => a.batchId)).size).toBe(1);
    expect((await memberAudit(orgId)).map((a) => a.action)).toEqual(["MEMBER_DEACTIVATED"]);
  });

  it("deactivation first: the bulk assignment fails with MEMBER_NOT_ACTIVE and no ticket changes", {
    timeout: 180_000,
  }, async () => {
    const { orgId, x, ticketIds, results } = await deactivationFirst(100, (holderPid, waiterPid) =>
      waitForBlockedBy(observer.client, holderPid, [waiterPid]),
    );
    assertNoDeadlock(results);
    const [deactivation, assignment] = results;
    expect(deactivation).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(assignment).toEqual({
      status: "fulfilled",
      value: { ok: false, error: "MEMBER_NOT_ACTIVE" },
    });

    const assignees = await assigneesOf(ticketIds);
    expect(assignees).toHaveLength(100);
    expect(assignees.every((a) => a === null)).toBe(true);
    expect(await memberRows(orgId, x)).toBe(0);
    expect(await ticketAudit(orgId)).toHaveLength(0);
  });
});
