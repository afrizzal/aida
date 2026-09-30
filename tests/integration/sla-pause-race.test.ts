// PID-bound race orders for the sla-flag worker (D-17, review C6). Two orders against a state
// transition on one ticket, and three two-ticket orders against a bulk runTicketMutation, which
// locks its tickets in ascending id in one statement and waits. The worker locks its candidates
// in id order with SKIP LOCKED and updates only what it locked, so it never waits on a ticket
// lock. Every wait is bound to backend PIDs recorded inside the transactions (waitForBlockedBy on
// the observer client), never to a timer; every time is an injected Date. Where the proof is that
// the worker did not wait, the test awaits the handler before resolving the other side's release:
// a wait would block the test until the vitest timeout and fail it. Testcontainers.
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  runTicketMutation,
  type TicketMutationHooks,
  type TicketOp,
} from "@/lib/tickets/mutations";
import { DEFAULT_SLA_TARGETS } from "@/lib/tickets/sla";
import { type SlaFlagPass, slaFlagHandler } from "@/lib/worker/jobs/sla-flag";
import {
  type LegacyStatusKey,
  seedOrgWithMembers,
  seedTicket,
  stateIdFor,
} from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

const MIN = 60_000;
/** The worker's injected time for the two-ticket orders and order 2, after every fixture deadline. */
const FAR = new Date("2099-01-01T00:00:00.000Z");
/** The injected clock of a pause that follows the worker's run at FAR. */
const PAUSE_CLOCK = new Date("2099-01-01T00:05:00.000Z");

interface Actor {
  orgId: string;
  userId: string;
}

async function newActor(): Promise<Actor> {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  return { orgId, userId: users[0].id };
}

async function stateOp(actor: Actor, key: LegacyStatusKey): Promise<TicketOp> {
  return { kind: "state", stateId: await stateIdFor(actor.orgId, key) };
}

function mutate(
  actor: Actor,
  ticketIds: string[],
  op: TicketOp,
  hooks: TicketMutationHooks = {},
): ReturnType<typeof runTicketMutation> {
  return runTicketMutation(
    { actor, ticketIds, op, mode: ticketIds.length > 1 ? "bulk" : "single" },
    hooks,
  );
}

const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

async function row(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: {
      stateId: true,
      priority: true,
      slaPausedAt: true,
      slaPausedMs: true,
      isBreached: true,
      isAtRisk: true,
      createdAt: true,
      firstResponseDueAt: true,
      resolutionDueAt: true,
    },
  });
}

/** Two OPEN tickets of one organization, named T1 and T2 by the default string comparison. */
async function twoTickets(actor: Actor): Promise<[string, string]> {
  const a = await seedTicket(actor.orgId, { status: "OPEN" });
  const b = await seedTicket(actor.orgId, { status: "OPEN" });
  return a.id < b.id ? [a.id, b.id] : [b.id, a.id];
}

/**
 * Flags every other eligible ticket of the shared database at `now`, so a later run at the same
 * `now` locks only the tickets a case creates afterwards.
 */
async function drain(now: Date): Promise<void> {
  await slaFlagHandler(undefined, { now });
}

const isDeadlock = (reason: unknown): boolean => {
  const e = reason as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null;
  return (
    e?.code === "40P01" || e?.meta?.code === "40P01" || String(e?.message ?? "").includes("40P01")
  );
};

/** Every promise fulfilled and none rejected with a deadlock (40P01). */
function expectSettledWithoutDeadlock(results: PromiseSettledResult<unknown>[]): void {
  const rejected = results.filter((r) => r.status === "rejected");
  expect(rejected.filter((r) => isDeadlock(r.reason))).toEqual([]);
  expect(rejected).toEqual([]);
}

function evidence(entry: Record<string, unknown>): void {
  const file = process.env.AIDA_P121_06_EVIDENCE;
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

describe("sla-flag worker against a state transition (D-17)", () => {
  // Codex diff critique D4: the paused ticket alone is no candidate (slaPausedAt IS NOT NULL in
  // the committed snapshot), so the worker would never try to lock it. The same transaction
  // therefore also holds an OPEN ticket that is overdue at `mid`, an eligible breach candidate:
  // without SKIP LOCKED the worker waits on it and the test blocks until the vitest timeout.
  it("order 1: a resume holds the row and an eligible candidate; the worker skips it without waiting; serial resume-then-worker", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await row(id);
    const pauseAt = at(original.createdAt, MIN);
    const pausedFor = 120 * MIN;
    const resumeAt = at(pauseAt, pausedFor);
    expect(
      await mutate(actor, [id], await stateOp(actor, "PENDING"), { clock: () => pauseAt }),
    ).toMatchObject({ ok: true });
    // After the original first-response deadline, before the moved one and outside its at-risk
    // window (moved due minus mid = 110 minutes, window 20 percent of 480 = 96 minutes).
    const mid = at(original.firstResponseDueAt, 10 * MIN);
    await drain(mid);
    // Seeded after the drain: OPEN, no pause, first response overdue at mid.
    const { id: eligibleId } = await seedTicket(actor.orgId, { status: "OPEN" });
    const eligible = await row(eligibleId);
    expect(eligible.slaPausedAt).toBeNull();
    expect(eligible.firstResponseDueAt.getTime()).toBeLessThan(mid.getTime());

    const resumePid = deferred<number>();
    const release = deferred<void>();
    // One bulk transaction locks both tickets in one statement before its first item; the
    // eligible ticket is already OPEN, so its item is a no-op that keeps its lock to the commit.
    const resume = mutate(actor, [id, eligibleId], await stateOp(actor, "OPEN"), {
      clock: () => resumeAt,
      afterItem: async (tx) => {
        resumePid.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const holder = await resumePid.promise;

    let workerPid = 0;
    const locks: [SlaFlagPass, string[]][] = [];
    await slaFlagHandler(undefined, {
      now: mid,
      onPassTransaction: async (tx) => {
        workerPid ||= await backendPid(tx);
      },
      afterPassLock: (_tx, pass, ids) => {
        locks.push([pass, ids]);
      },
    });
    // Settled while the resume still holds the row (release not yet resolved).
    expect(locks).toEqual([
      ["breach", []],
      ["atRisk", []],
    ]);
    expect(workerPid).not.toBe(holder);
    const whileHeld = await row(id);
    expect(whileHeld.isBreached).toBe(false);
    expect(whileHeld.isAtRisk).toBe(false);
    expect((await row(eligibleId)).isBreached).toBe(false);

    release.resolve();
    const results = await Promise.allSettled([resume]);
    expectSettledWithoutDeadlock(results);
    expect((results[0] as PromiseFulfilledResult<unknown>).value).toMatchObject({ ok: true });

    await slaFlagHandler(undefined, { now: mid });
    // The held candidate was eligible: once released, the same run time breaches it.
    expect((await row(eligibleId)).isBreached).toBe(true);
    const resumed = await row(id);
    // Serial resume-then-worker: deadlines moved by the pause, no flag at mid.
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.slaPausedMs).toBe(BigInt(pausedFor));
    expect(resumed.firstResponseDueAt.getTime()).toBe(
      original.firstResponseDueAt.getTime() + pausedFor,
    );
    expect(resumed.resolutionDueAt.getTime()).toBe(original.resolutionDueAt.getTime() + pausedFor);
    expect(resumed.isBreached).toBe(false);
    expect(resumed.isAtRisk).toBe(false);

    await slaFlagHandler(undefined, { now: at(resumed.firstResponseDueAt, 1) });
    expect((await row(id)).isBreached).toBe(true);
    evidence({ order: "1", resumePid: holder, workerPid });
  });

  it("order 2: the worker's uncommitted breach update holds the row; a pause waits behind its PID; serial worker-then-pause", async () => {
    await drain(FAR);
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await row(id);
    const pendingId = await stateIdFor(actor.orgId, "PENDING");

    const workerHeld = deferred<number>();
    const release = deferred<void>();
    let breachLocked: string[] = [];
    const worker = slaFlagHandler(undefined, {
      now: FAR,
      afterPassLock: (_tx, pass, ids) => {
        if (pass === "breach") breachLocked = ids;
      },
      afterPassUpdate: async (tx, pass) => {
        if (pass !== "breach") return;
        workerHeld.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const workerPid = await workerHeld.promise;
    expect(breachLocked).toEqual([id]);

    const agentPid = deferred<number>();
    const pause = mutate(
      actor,
      [id],
      { kind: "state", stateId: pendingId },
      {
        onTransactionStart: async (tx) => agentPid.resolve(await backendPid(tx)),
        clock: () => PAUSE_CLOCK,
      },
    );
    const agent = await agentPid.promise;
    await waitForBlockedBy(prisma, workerPid, [agent]);
    release.resolve();

    const results = await Promise.allSettled([worker, pause]);
    expectSettledWithoutDeadlock(results);
    expect((results[1] as PromiseFulfilledResult<unknown>).value).toMatchObject({ ok: true });

    const after = await row(id);
    expect(after).toEqual({
      ...original,
      stateId: pendingId,
      slaPausedAt: PAUSE_CLOCK,
      isBreached: true,
      isAtRisk: true,
    });
    await slaFlagHandler(undefined, { now: at(FAR, 24 * 60 * MIN) });
    expect(await row(id)).toEqual(after);
    evidence({ order: "2", workerPid, agentPid: agent });
  });
});

describe("sla-flag worker against a two-ticket bulk mutation (review C6)", () => {
  it("order A: the bulk mutation holds both; the worker locks nothing and settles; serial mutation-then-worker", async () => {
    await drain(FAR);
    const actor = await newActor();
    const [t1, t2] = await twoTickets(actor);
    const before = { [t1]: await row(t1), [t2]: await row(t2) };

    const mutationPid = deferred<number>();
    const release = deferred<void>();
    const mutation = mutate(
      actor,
      [t1, t2],
      { kind: "priority", priority: "URGENT" },
      {
        afterItem: async (tx, _ticketId, index) => {
          if (index !== 0) return;
          // Both rows are locked by the one ascending statement before the first item.
          mutationPid.resolve(await backendPid(tx));
          await release.promise;
        },
      },
    );
    const holder = await mutationPid.promise;

    let workerPid = 0;
    const locks: [SlaFlagPass, string[]][] = [];
    await slaFlagHandler(undefined, {
      now: FAR,
      onPassTransaction: async (tx) => {
        workerPid ||= await backendPid(tx);
      },
      afterPassLock: (_tx, pass, ids) => {
        locks.push([pass, ids]);
      },
    });
    // Settled while the mutation still holds both rows.
    expect(locks).toEqual([
      ["breach", []],
      ["atRisk", []],
    ]);
    expect(workerPid).not.toBe(holder);
    expect(await row(t1)).toEqual(before[t1]);
    expect(await row(t2)).toEqual(before[t2]);

    release.resolve();
    const results = await Promise.allSettled([mutation]);
    expectSettledWithoutDeadlock(results);
    expect((results[0] as PromiseFulfilledResult<unknown>).value).toMatchObject({
      ok: true,
      count: 2,
    });

    await slaFlagHandler(undefined, { now: FAR });
    // Serial mutation-then-worker: URGENT deadlines from createdAt, then both flagged at FAR.
    const urgent = DEFAULT_SLA_TARGETS.URGENT;
    for (const id of [t1, t2]) {
      const c = before[id].createdAt;
      expect(await row(id)).toEqual({
        ...before[id],
        priority: "URGENT",
        firstResponseDueAt: at(c, urgent.firstResponseMinutes * MIN),
        resolutionDueAt: at(c, urgent.resolutionMinutes * MIN),
        isBreached: true,
        isAtRisk: true,
      });
    }
    evidence({ order: "A", mutationPid: holder, workerPid, t1, t2 });
  });

  it("order B: the worker holds both; the bulk mutation waits behind its PID; serial worker-then-mutation", async () => {
    await drain(FAR);
    const actor = await newActor();
    const [t1, t2] = await twoTickets(actor);
    const before = { [t1]: await row(t1), [t2]: await row(t2) };
    const pendingId = await stateIdFor(actor.orgId, "PENDING");

    const workerHeld = deferred<number>();
    const release = deferred<void>();
    let breachLocked: string[] = [];
    const worker = slaFlagHandler(undefined, {
      now: FAR,
      afterPassLock: async (tx, pass, ids) => {
        if (pass !== "breach") return;
        breachLocked = ids;
        workerHeld.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const workerPid = await workerHeld.promise;
    expect(breachLocked).toEqual([t1, t2]);

    const mutationPid = deferred<number>();
    const mutation = mutate(
      actor,
      [t1, t2],
      { kind: "state", stateId: pendingId },
      {
        onTransactionStart: async (tx) => mutationPid.resolve(await backendPid(tx)),
        clock: () => PAUSE_CLOCK,
      },
    );
    const waiter = await mutationPid.promise;
    await waitForBlockedBy(prisma, workerPid, [waiter]);
    release.resolve();

    const results = await Promise.allSettled([worker, mutation]);
    expectSettledWithoutDeadlock(results);
    expect((results[1] as PromiseFulfilledResult<unknown>).value).toMatchObject({
      ok: true,
      count: 2,
    });

    // Serial worker-then-mutation: both breached at FAR, then both paused at PAUSE_CLOCK with the
    // flags kept (entering PENDING keeps flags, D-16).
    for (const id of [t1, t2]) {
      expect(await row(id)).toEqual({
        ...before[id],
        stateId: pendingId,
        slaPausedAt: PAUSE_CLOCK,
        isBreached: true,
        isAtRisk: true,
      });
    }
    evidence({ order: "B", workerPid, mutationPid: waiter, t1, t2 });
  });

  it("order C: the worker holds T2 only; the mutation holds T1 and waits for T2 behind the worker; serial worker-then-mutation", async () => {
    await drain(FAR);
    const actor = await newActor();
    const [t1, t2] = await twoTickets(actor);
    // T1 is not yet due at FAR and outside its at-risk window; T2 is past due.
    const notDue = at(FAR, 30 * 24 * 60 * MIN);
    await prisma.ticket.update({
      where: { id: t1 },
      data: { firstResponseDueAt: notDue, resolutionDueAt: notDue },
    });
    const before = { [t1]: await row(t1), [t2]: await row(t2) };
    const pendingId = await stateIdFor(actor.orgId, "PENDING");

    const workerHeld = deferred<number>();
    const release = deferred<void>();
    let breachLocked: string[] = [];
    const worker = slaFlagHandler(undefined, {
      now: FAR,
      afterPassLock: async (tx, pass, ids) => {
        if (pass !== "breach") return;
        breachLocked = ids;
        workerHeld.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const workerPid = await workerHeld.promise;
    expect(breachLocked).toEqual([t2]);

    const mutationPid = deferred<number>();
    const mutation = mutate(
      actor,
      [t1, t2],
      { kind: "state", stateId: pendingId },
      {
        onTransactionStart: async (tx) => mutationPid.resolve(await backendPid(tx)),
        clock: () => PAUSE_CLOCK,
      },
    );
    const waiter = await mutationPid.promise;
    await waitForBlockedBy(prisma, workerPid, [waiter]);
    // While it waits for T2, the mutation holds T1: a SKIP LOCKED probe cannot take it.
    const probe = await prisma.$transaction(
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Ticket" WHERE id = ANY(${[t1, t2]}::text[]) ORDER BY id FOR UPDATE SKIP LOCKED
        `,
    );
    expect(probe).toEqual([]);
    release.resolve();

    const results = await Promise.allSettled([worker, mutation]);
    expectSettledWithoutDeadlock(results);
    expect((results[1] as PromiseFulfilledResult<unknown>).value).toMatchObject({
      ok: true,
      count: 2,
    });

    // Serial worker-then-mutation: only T2 breached at FAR, then both paused at PAUSE_CLOCK.
    expect(await row(t1)).toEqual({
      ...before[t1],
      stateId: pendingId,
      slaPausedAt: PAUSE_CLOCK,
    });
    expect(await row(t2)).toEqual({
      ...before[t2],
      stateId: pendingId,
      slaPausedAt: PAUSE_CLOCK,
      isBreached: true,
      isAtRisk: true,
    });
    evidence({ order: "C", workerPid, mutationPid: waiter, t1, t2 });
  });
});
