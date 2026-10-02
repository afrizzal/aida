// AIDA-57 end to end (D-16, D-17): the real sla-flag handler and real state transitions
// (runTicketMutation) driven by injected time. Every time here is an explicit Date: hooks.clock
// for a transition, opts.now for the handler. No timed waits. Testcontainers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runTicketMutation, type TicketMutationHooks } from "@/lib/tickets/mutations";
import { DEFAULT_SLA_TARGETS } from "@/lib/tickets/sla";
import { slaFlagHandler } from "@/lib/worker/jobs/sla-flag";
import {
  type LegacyStatusKey,
  seedOrgWithMembers,
  seedTicket,
  stateIdFor,
} from "../support/inbox-fixtures";

const MIN = 60_000;

// The first-response case posts through the real messages route. Its session and queue are
// replaced exactly as tests/integration/ticket-merge.test.ts does; everything else is real.
const routeEnv = vi.hoisted(() => ({
  actor: null as null | { orgId: string; userId: string },
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
  getBoss: async () => ({ send: async () => "job" }),
}));

afterEach(() => {
  routeEnv.actor = null;
});

interface Actor {
  orgId: string;
  userId: string;
}

async function newActor(): Promise<Actor> {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  return { orgId, userId: users[0].id };
}

/** Moves one ticket to the organization's state with the given legacy key at the given time. */
async function moveTo(
  actor: Actor,
  ticketId: string,
  key: LegacyStatusKey,
  at: Date,
  hooks: TicketMutationHooks = {},
  run: typeof runTicketMutation = runTicketMutation,
): Promise<void> {
  const stateId = await stateIdFor(actor.orgId, key);
  const result = await run(
    { actor, ticketIds: [ticketId], op: { kind: "state", stateId }, mode: "single" },
    { ...hooks, clock: () => at },
  );
  expect(result).toMatchObject({ ok: true, count: 1 });
}

const read = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe("SLA pause with the real sla-flag handler (AIDA-57)", () => {
  it("tracer: no flag while paused, deadlines moved by the pause, breach 1 ms after the moved deadline", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "NEW" });
    const created = await read(id);
    // A first response is in, so only the resolution timer can breach.
    await prisma.ticket.update({
      where: { id },
      data: { firstRespondedAt: at(created.createdAt, MIN) },
    });
    const original = await read(id);

    const pauseAt = at(original.createdAt, 5 * MIN);
    await moveTo(actor, id, "PENDING", pauseAt);
    expect((await read(id)).slaPausedAt?.getTime()).toBe(pauseAt.getTime());

    await slaFlagHandler(undefined, { now: at(original.resolutionDueAt, MIN) });
    const whilePaused = await read(id);
    expect(whilePaused.isBreached).toBe(false);
    expect(whilePaused.isAtRisk).toBe(false);

    await moveTo(actor, id, "OPEN", at(pauseAt, 90 * MIN));
    const resumed = await read(id);
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.firstResponseDueAt.getTime() - original.firstResponseDueAt.getTime()).toBe(
      90 * MIN,
    );
    expect(resumed.resolutionDueAt.getTime() - original.resolutionDueAt.getTime()).toBe(90 * MIN);

    await slaFlagHandler(undefined, { now: at(resumed.resolutionDueAt, -MIN) });
    expect((await read(id)).isBreached).toBe(false);

    await slaFlagHandler(undefined, { now: at(resumed.resolutionDueAt, 1) });
    expect((await read(id)).isBreached).toBe(true);
  });

  it("three pauses of 20, 35 and 5 minutes move both deadlines by exactly 60 minutes", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await read(id);
    const c = original.createdAt;

    await moveTo(actor, id, "PENDING", at(c, 1 * MIN));
    await moveTo(actor, id, "OPEN", at(c, 21 * MIN));
    await moveTo(actor, id, "PENDING", at(c, 30 * MIN));
    await moveTo(actor, id, "OPEN", at(c, 65 * MIN));
    await moveTo(actor, id, "PENDING", at(c, 70 * MIN));
    await moveTo(actor, id, "OPEN", at(c, 75 * MIN));

    const after = await read(id);
    expect(after.firstResponseDueAt.getTime() - original.firstResponseDueAt.getTime()).toBe(
      60 * MIN,
    );
    expect(after.resolutionDueAt.getTime() - original.resolutionDueAt.getTime()).toBe(60 * MIN);
    expect(after.slaPausedMs).toBe(3600000n);
    expect(after.slaPausedAt).toBeNull();
  });

  it("ordering: 30 then 45 minutes and 45 then 30 minutes give the same 75-minute shift", async () => {
    const actor = await newActor();
    const x = await seedTicket(actor.orgId, { status: "OPEN" });
    const y = await seedTicket(actor.orgId, { status: "OPEN" });
    const shifts: number[][] = [];
    for (const [ticket, [first, second]] of [
      [x, [30, 45]],
      [y, [45, 30]],
    ] as const) {
      const original = await read(ticket.id);
      const c = original.createdAt;
      await moveTo(actor, ticket.id, "PENDING", at(c, MIN));
      await moveTo(actor, ticket.id, "OPEN", at(c, (1 + first) * MIN));
      await moveTo(actor, ticket.id, "PENDING", at(c, (2 + first) * MIN));
      await moveTo(actor, ticket.id, "OPEN", at(c, (2 + first + second) * MIN));
      const after = await read(ticket.id);
      expect(after.slaPausedMs).toBe(4500000n);
      shifts.push([
        after.firstResponseDueAt.getTime() - original.firstResponseDueAt.getTime(),
        after.resolutionDueAt.getTime() - original.resolutionDueAt.getTime(),
      ]);
    }
    expect(shifts).toEqual([
      [75 * MIN, 75 * MIN],
      [75 * MIN, 75 * MIN],
    ]);
  });

  it("boundary: a deadline equal to now gets no flag; 1 ms later the breach pass flags it", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const due = (await read(id)).firstResponseDueAt;

    await slaFlagHandler(undefined, { now: due });
    const atDue = await read(id);
    expect(atDue.isBreached).toBe(false);
    expect(atDue.isAtRisk).toBe(false);

    await slaFlagHandler(undefined, { now: at(due, 1) });
    const after = await read(id);
    expect(after.isBreached).toBe(true);
    expect(after.isAtRisk).toBe(true);
  });

  it("at-risk window keeps 'due > now' and 'within 20 percent of the target'", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const ticket = await read(id);
    const window = ticket.firstResponseTargetMinutes * 0.2 * MIN;

    await slaFlagHandler(undefined, { now: at(ticket.firstResponseDueAt, -window - 1) });
    expect((await read(id)).isAtRisk).toBe(false);

    await slaFlagHandler(undefined, { now: at(ticket.firstResponseDueAt, -window) });
    const inside = await read(id);
    expect(inside.isAtRisk).toBe(true);
    expect(inside.isBreached).toBe(false);
  });

  it("restart: a fresh module and client resume by exactly the pause and the fresh handler respects it", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await read(id);
    const pauseAt = at(original.createdAt, 2 * MIN);
    await moveTo(actor, id, "PENDING", pauseAt);

    // The worker restarts: new module instances, a new pg pool and Prisma client. The pause
    // state lives only in the database (D-16).
    const g = globalThis as unknown as { prisma?: typeof prisma };
    const saved = g.prisma;
    vi.resetModules();
    delete g.prisma;
    const freshDb = await import("@/lib/db");
    const freshMutations = await import("@/lib/tickets/mutations");
    const freshFlag = await import("@/lib/worker/jobs/sla-flag");
    try {
      expect(freshDb.prisma).not.toBe(prisma);
      await moveTo(actor, id, "OPEN", at(pauseAt, 40 * MIN), {}, freshMutations.runTicketMutation);
      const resumed = await read(id);
      expect(resumed.firstResponseDueAt.getTime() - original.firstResponseDueAt.getTime()).toBe(
        40 * MIN,
      );
      expect(resumed.resolutionDueAt.getTime() - original.resolutionDueAt.getTime()).toBe(40 * MIN);
      expect(resumed.slaPausedMs).toBe(2400000n);

      await freshFlag.slaFlagHandler(undefined, { now: at(original.firstResponseDueAt, MIN) });
      expect((await read(id)).isBreached).toBe(false);
      await freshFlag.slaFlagHandler(undefined, { now: resumed.firstResponseDueAt });
      expect((await read(id)).isBreached).toBe(false);
      await freshFlag.slaFlagHandler(undefined, { now: at(resumed.firstResponseDueAt, 1) });
      expect((await read(id)).isBreached).toBe(true);
    } finally {
      g.prisma = saved;
      await freshDb.prisma.$disconnect();
    }
  });

  it("a first response during a pause is recorded and clears the flags; the resume still moves both deadlines", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await read(id);
    const pauseAt = at(original.createdAt, 3 * MIN);
    await moveTo(actor, id, "PENDING", pauseAt);
    await prisma.ticket.update({ where: { id }, data: { isAtRisk: true, isBreached: true } });

    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    routeEnv.actor = actor;
    const form = new FormData();
    form.set("mode", "public");
    form.set("body", "Reply while the ticket waits on the customer");
    const response = await POST(
      new Request(`http://localhost/api/tickets/${id}/messages`, { method: "POST", body: form }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBeLessThan(300);

    const replied = await read(id);
    expect(replied.firstRespondedAt).not.toBeNull();
    expect(replied.isAtRisk).toBe(false);
    expect(replied.isBreached).toBe(false);
    expect(replied.slaPausedAt?.getTime()).toBe(pauseAt.getTime());

    await moveTo(actor, id, "OPEN", at(pauseAt, 25 * MIN));
    const resumed = await read(id);
    expect(resumed.firstResponseDueAt.getTime() - original.firstResponseDueAt.getTime()).toBe(
      25 * MIN,
    );
    expect(resumed.resolutionDueAt.getTime() - original.resolutionDueAt.getTime()).toBe(25 * MIN);
  });

  it("a priority change inside a pause counts the closed pauses; the open one is added when it closes", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const c = (await read(id)).createdAt;
    await moveTo(actor, id, "PENDING", at(c, MIN));
    await moveTo(actor, id, "OPEN", at(c, 11 * MIN));
    await moveTo(actor, id, "PENDING", at(c, 20 * MIN));

    const result = await runTicketMutation({
      actor,
      ticketIds: [id],
      op: { kind: "priority", priority: "HIGH" },
      mode: "single",
    });
    expect(result).toMatchObject({ ok: true, count: 1 });
    const high = DEFAULT_SLA_TARGETS.HIGH;
    const changed = await read(id);
    expect(changed.firstResponseTargetMinutes).toBe(high.firstResponseMinutes);
    expect(changed.resolutionTargetMinutes).toBe(high.resolutionMinutes);
    expect(changed.firstResponseDueAt.getTime()).toBe(
      at(c, (10 + high.firstResponseMinutes) * MIN).getTime(),
    );
    expect(changed.resolutionDueAt.getTime()).toBe(
      at(c, (10 + high.resolutionMinutes) * MIN).getTime(),
    );

    await moveTo(actor, id, "OPEN", at(c, 35 * MIN));
    const resumed = await read(id);
    expect(resumed.slaPausedMs).toBe(1500000n);
    expect(resumed.firstResponseDueAt.getTime()).toBe(
      at(c, (25 + high.firstResponseMinutes) * MIN).getTime(),
    );
    expect(resumed.resolutionDueAt.getTime()).toBe(
      at(c, (25 + high.resolutionMinutes) * MIN).getTime(),
    );
  });

  it("a ticket breached before its pause stays breached while paused and the handler changes nothing", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await read(id);
    await slaFlagHandler(undefined, { now: at(original.firstResponseDueAt, 1) });
    expect((await read(id)).isBreached).toBe(true);

    await moveTo(actor, id, "PENDING", at(original.firstResponseDueAt, 2 * MIN));
    const paused = await read(id);
    expect(paused.isBreached).toBe(true);
    expect(paused.isAtRisk).toBe(true);

    await slaFlagHandler(undefined, { now: at(original.resolutionDueAt, 24 * 60 * MIN) });
    expect(await read(id)).toEqual(paused);
  });

  it("a snoozed ticket is not paused and is flagged (snoozedUntil written directly, review C5)", async () => {
    const actor = await newActor();
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await read(id);
    await prisma.ticket.update({
      where: { id },
      data: { snoozedUntil: at(original.createdAt, 24 * 60 * MIN) },
    });
    const snoozed = await read(id);
    expect(snoozed.snoozedUntil).not.toBeNull();
    expect(snoozed.slaPausedAt).toBeNull();

    await slaFlagHandler(undefined, { now: at(original.resolutionDueAt, 1) });
    const after = await read(id);
    expect(after.isBreached).toBe(true);
    expect(after.slaPausedAt).toBeNull();
  });
});

// Codex diff critique round 2, R2-D1 (run decision K46, D-16 "flags already set when a pause
// starts stay set"): the worker skips paused tickets, so a priority change during an open pause
// recomputes the deadlines but keeps the flags; with no open pause it clears them as before.
describe("a priority change and the SLA flags (R2-D1, K46)", () => {
  async function breachedTicket(actor: Actor) {
    const { id } = await seedTicket(actor.orgId, { status: "OPEN" });
    const original = await read(id);
    await slaFlagHandler(undefined, { now: at(original.firstResponseDueAt, 1) });
    const flagged = await read(id);
    expect(flagged.isBreached).toBe(true);
    expect(flagged.isAtRisk).toBe(true);
    return original;
  }

  async function changePriority(actor: Actor, id: string) {
    const result = await runTicketMutation({
      actor,
      ticketIds: [id],
      op: { kind: "priority", priority: "HIGH" },
      mode: "single",
    });
    expect(result).toMatchObject({ ok: true, count: 1 });
  }

  it("during an open pause the deadlines are recomputed and both flags stay set", async () => {
    const actor = await newActor();
    const original = await breachedTicket(actor);
    const pauseAt = at(original.firstResponseDueAt, 2 * MIN);
    await moveTo(actor, original.id, "PENDING", pauseAt);

    await changePriority(actor, original.id);

    const high = DEFAULT_SLA_TARGETS.HIGH;
    const changed = await read(original.id);
    expect(changed.priority).toBe("HIGH");
    expect(changed.slaPausedAt?.getTime()).toBe(pauseAt.getTime());
    expect(changed.firstResponseDueAt.getTime()).toBe(
      at(original.createdAt, high.firstResponseMinutes * MIN).getTime(),
    );
    expect(changed.resolutionDueAt.getTime()).toBe(
      at(original.createdAt, high.resolutionMinutes * MIN).getTime(),
    );
    expect(changed.isBreached).toBe(true);
    expect(changed.isAtRisk).toBe(true);
  });

  it("with no open pause the deadlines are recomputed and both flags are cleared", async () => {
    const actor = await newActor();
    const original = await breachedTicket(actor);

    await changePriority(actor, original.id);

    const high = DEFAULT_SLA_TARGETS.HIGH;
    const changed = await read(original.id);
    expect(changed.priority).toBe("HIGH");
    expect(changed.slaPausedAt).toBeNull();
    expect(changed.firstResponseDueAt.getTime()).toBe(
      at(original.createdAt, high.firstResponseMinutes * MIN).getTime(),
    );
    expect(changed.resolutionDueAt.getTime()).toBe(
      at(original.createdAt, high.resolutionMinutes * MIN).getTime(),
    );
    expect(changed.isBreached).toBe(false);
    expect(changed.isAtRisk).toBe(false);
  });
});
