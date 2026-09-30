// Phase 12.1, plan 12.1-08: PID-bound race proofs of the state deletion lock protocol (D-15
// amended, K41, K42), on a real Postgres through Testcontainers. Nothing is mocked.
//
// Every race records the holder's PID from inside the holder's own transaction (a production
// hook) and the waiter's PID from inside the waiter's own transaction, waits until exactly that
// waiter is blocked by that holder (waitForBlockedBy), and only then releases the holder. No
// timed wait anywhere. Every promise must settle without a deadlock error (SQLSTATE 40P01).
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { prisma } from "@/lib/db";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { setReopenObserverForTests } from "@/lib/tickets/reopen-on-reply";
import { deleteTicketState } from "@/lib/tickets/ticket-state-admin";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

beforeAll(() => {
  // The follow-up route hashes the client IP with this pepper; a test-only value.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "state-delete-race-test";
});

afterEach(() => {
  setReopenObserverForTests(null);
});

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "admin", "member"]);
  return {
    orgId,
    admin: { userId: users[0].id, orgId },
    admin2: { userId: users[1].id, orgId },
    agent: { userId: users[2].id, orgId },
  };
}

async function addState(orgId: string, group: "OPEN" | "PENDING", name: string) {
  return prisma.ticketState.create({
    data: { organizationId: orgId, name, colorToken: "blue", group, sortOrder: 50 },
    select: { id: true },
  });
}

async function ticketRow(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { stateId: true, priority: true },
  });
}

async function statusAudits(ticketId: string) {
  return prisma.ticketAuditEvent.findMany({
    where: { ticketId, action: "STATUS_CHANGED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { actorUserId: true, before: true, after: true, batchId: true },
  });
}

/** Both promises settled; none rejected, and in particular none with a deadlock (40P01). */
async function settleWithoutDeadlock<A, B>(a: Promise<A>, b: Promise<B>): Promise<[A, B]> {
  const [ra, rb] = await Promise.allSettled([a, b]);
  for (const r of [ra, rb]) {
    if (r.status === "rejected") {
      expect(String((r.reason as Error)?.message ?? r.reason)).not.toMatch(/40P01|deadlock/i);
      throw r.reason;
    }
  }
  return [(ra as PromiseFulfilledResult<A>).value, (rb as PromiseFulfilledResult<B>).value];
}

async function followUp(ticketId: string) {
  const { statusToken } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  const form = new FormData();
  form.set("message", `Follow-up ${randomUUID()}`);
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const res = await followUpPost(
    new Request(`http://localhost/api/public/status/${statusToken}/follow-up`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token: statusToken }) },
  );
  return res.status;
}

describe("state deletion races (D-15 amended)", () => {
  it("Race 1: the deletion holds the state lock; a state change to it waits and is refused", async () => {
    const { orgId, admin, agent } = await seedOrg();
    const doomed = await addState(orgId, "OPEN", "Doomed");
    const replacementId = await stateIdFor(orgId, "OPEN");
    const newId = await stateIdFor(orgId, "NEW");
    const resident = await seedTicket(orgId, { stateId: doomed.id });
    const ticket = await seedTicket(orgId, { status: "NEW" });

    const deletePid = deferred<number>();
    const release = deferred<void>();
    const deletion = deleteTicketState(
      prisma,
      admin,
      { stateId: doomed.id, replacementStateId: replacementId },
      {
        afterStateLock: async (tx) => {
          deletePid.resolve(await backendPid(tx));
          await release.promise;
        },
      },
    );
    const holder = await deletePid.promise;

    const agentPid = deferred<number>();
    const mutation = runTicketMutation(
      {
        actor: agent,
        ticketIds: [ticket.id],
        op: { kind: "state", stateId: doomed.id },
        mode: "single",
      },
      { onTransactionStart: async (tx) => agentPid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await agentPid.promise]);
    release.resolve();

    const [deleted, mutated] = await settleWithoutDeadlock(deletion, mutation);
    expect(deleted).toMatchObject({ ok: true, movedCount: 1 });
    expect(mutated).toEqual({ ok: false, error: "STATE_NOT_FOUND" });
    expect((await ticketRow(ticket.id)).stateId).toBe(newId);
    expect((await ticketRow(resident.id)).stateId).toBe(replacementId);
    expect(await prisma.ticket.count({ where: { stateId: doomed.id } })).toBe(0);
  });

  it("Race 2: a state change holds the target's share lock; the deletion waits and moves that ticket too", async () => {
    const { orgId, admin, agent } = await seedOrg();
    const doomed = await addState(orgId, "OPEN", "Doomed");
    const replacementId = await stateIdFor(orgId, "OPEN");
    const ticket = await seedTicket(orgId, { status: "NEW" });

    const agentPid = deferred<number>();
    const release = deferred<void>();
    const mutation = runTicketMutation(
      {
        actor: agent,
        ticketIds: [ticket.id],
        op: { kind: "state", stateId: doomed.id },
        mode: "single",
      },
      {
        afterItem: async (tx, id) => {
          if (id !== ticket.id) return;
          agentPid.resolve(await backendPid(tx));
          await release.promise;
        },
      },
    );
    const holder = await agentPid.promise;

    const deletePid = deferred<number>();
    const deletion = deleteTicketState(
      prisma,
      admin,
      { stateId: doomed.id, replacementStateId: replacementId },
      { onTransactionStart: async (tx) => deletePid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await deletePid.promise]);
    release.resolve();

    const [mutated, deleted] = await settleWithoutDeadlock(mutation, deletion);
    expect(mutated).toMatchObject({ ok: true, count: 1 });
    expect(deleted).toMatchObject({ ok: true, movedCount: 1 });
    expect((await ticketRow(ticket.id)).stateId).toBe(replacementId);
    const audits = await statusAudits(ticket.id);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ actorUserId: agent.userId, after: { stateId: doomed.id } });
    expect(audits[1]).toMatchObject({
      actorUserId: admin.userId,
      before: { stateId: doomed.id, stateGroup: "OPEN" },
      after: { stateId: replacementId, stateGroup: "OPEN" },
    });
    expect(audits[1].batchId).toEqual(expect.any(String));
  });

  it("Race 3a: a priority change holds the ticket row; the deletion waits, then moves it and keeps the priority", async () => {
    const { orgId, admin, agent } = await seedOrg();
    const doomed = await addState(orgId, "OPEN", "Doomed");
    const replacementId = await stateIdFor(orgId, "OPEN");
    const ticket = await seedTicket(orgId, { stateId: doomed.id, priority: "NORMAL" });

    const agentPid = deferred<number>();
    const release = deferred<void>();
    const mutation = runTicketMutation(
      {
        actor: agent,
        ticketIds: [ticket.id],
        op: { kind: "priority", priority: "HIGH" },
        mode: "single",
      },
      {
        afterItem: async (tx, id) => {
          if (id !== ticket.id) return;
          agentPid.resolve(await backendPid(tx));
          await release.promise;
        },
      },
    );
    const holder = await agentPid.promise;

    const deletePid = deferred<number>();
    const deletion = deleteTicketState(
      prisma,
      admin,
      { stateId: doomed.id, replacementStateId: replacementId },
      { onTransactionStart: async (tx) => deletePid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await deletePid.promise]);
    release.resolve();

    const [mutated, deleted] = await settleWithoutDeadlock(mutation, deletion);
    expect(mutated).toMatchObject({ ok: true, count: 1 });
    expect(deleted).toMatchObject({ ok: true, movedCount: 1 });
    expect(await ticketRow(ticket.id)).toEqual({ stateId: replacementId, priority: "HIGH" });
  });

  it("Race 3b: a move out of the deleted state holds the ticket row; the deletion waits and skips it", async () => {
    const { orgId, admin, agent } = await seedOrg();
    const doomed = await addState(orgId, "OPEN", "Doomed");
    const replacementId = await stateIdFor(orgId, "OPEN");
    const elsewhere = await addState(orgId, "PENDING", "Elsewhere");
    const ticket = await seedTicket(orgId, { stateId: doomed.id });

    const agentPid = deferred<number>();
    const release = deferred<void>();
    const mutation = runTicketMutation(
      {
        actor: agent,
        ticketIds: [ticket.id],
        op: { kind: "state", stateId: elsewhere.id },
        mode: "single",
      },
      {
        afterItem: async (tx, id) => {
          if (id !== ticket.id) return;
          agentPid.resolve(await backendPid(tx));
          await release.promise;
        },
      },
    );
    const holder = await agentPid.promise;

    const deletePid = deferred<number>();
    const deletion = deleteTicketState(
      prisma,
      admin,
      { stateId: doomed.id, replacementStateId: replacementId },
      { onTransactionStart: async (tx) => deletePid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await deletePid.promise]);
    release.resolve();

    const [mutated, deleted] = await settleWithoutDeadlock(mutation, deletion);
    expect(mutated).toMatchObject({ ok: true, count: 1 });
    expect(deleted).toMatchObject({ ok: true, movedCount: 0 });
    expect((await ticketRow(ticket.id)).stateId).toBe(elsewhere.id);
    const audits = await statusAudits(ticket.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: agent.userId,
      after: { stateId: elsewhere.id },
    });
  });

  it("Race 4: a customer reply holds the config share lock; deleting the reopen state waits, then moves the reopened ticket", async () => {
    const { orgId, admin } = await seedOrg();
    const reopenId = await stateIdFor(orgId, "OPEN");
    const r1 = await addState(orgId, "OPEN", "Reopened two");
    const ticket = await seedTicket(orgId, { status: "RESOLVED", resolvedAt: new Date() });

    const replyPid = deferred<number>();
    const release = deferred<void>();
    setReopenObserverForTests({
      afterResolve: async (tx, effectiveId) => {
        if (effectiveId !== ticket.id) return;
        replyPid.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const reply = followUp(ticket.id);
    const holder = await replyPid.promise;

    const deletePid = deferred<number>();
    const deletion = deleteTicketState(
      prisma,
      admin,
      { stateId: reopenId, replacementStateId: r1.id },
      { onTransactionStart: async (tx) => deletePid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await deletePid.promise]);
    release.resolve();

    const [status, deleted] = await settleWithoutDeadlock(reply, deletion);
    expect(status).toBeLessThan(300);
    expect(deleted).toMatchObject({ ok: true, movedCount: 1, rolesMoved: true });
    expect((await ticketRow(ticket.id)).stateId).toBe(r1.id);
    const config = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(config.reopenStateId).toBe(r1.id);
    const audits = await statusAudits(ticket.id);
    expect(audits.at(-1)).toMatchObject({
      actorUserId: admin.userId,
      before: { stateId: reopenId },
      after: { stateId: r1.id },
    });
  });

  it("Race 5: two admins delete the same state; one succeeds, the other gets STATE_NOT_FOUND", async () => {
    const { orgId, admin, admin2 } = await seedOrg();
    const doomed = await addState(orgId, "PENDING", "Doomed");

    const firstPid = deferred<number>();
    const release = deferred<void>();
    const first = deleteTicketState(
      prisma,
      admin,
      { stateId: doomed.id, replacementStateId: null },
      {
        afterConfigLock: async (tx) => {
          firstPid.resolve(await backendPid(tx));
          await release.promise;
        },
      },
    );
    const holder = await firstPid.promise;

    const secondPid = deferred<number>();
    const second = deleteTicketState(
      prisma,
      admin2,
      { stateId: doomed.id, replacementStateId: null },
      { onTransactionStart: async (tx) => secondPid.resolve(await backendPid(tx)) },
    );
    await waitForBlockedBy(prisma, holder, [await secondPid.promise]);
    release.resolve();

    const [a, b] = await settleWithoutDeadlock(first, second);
    expect(a).toMatchObject({ ok: true, name: "Doomed" });
    expect(b).toEqual({ ok: false, error: "STATE_NOT_FOUND" });
  });
});
