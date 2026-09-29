// AIDA-57 end to end (D-16, D-17): the real sla-flag handler and real state transitions
// (runTicketMutation) driven by injected time. Every time here is an explicit Date: hooks.clock
// for a transition, opts.now for the handler. Nothing sleeps. Testcontainers.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runTicketMutation, type TicketMutationHooks } from "@/lib/tickets/mutations";
import { slaFlagHandler } from "@/lib/worker/jobs/sla-flag";
import {
  type LegacyStatusKey,
  seedOrgWithMembers,
  seedTicket,
  stateIdFor,
} from "../support/inbox-fixtures";

const MIN = 60_000;

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
});
