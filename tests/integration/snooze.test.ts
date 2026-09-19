// Phase 12, plan 12-05: snooze and wake (AIDA-54, D-12 to D-16), on a real Postgres through
// Testcontainers. Nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { snoozeTicket } from "@/lib/tickets/snooze";
import { snoozeWakeHandler } from "@/lib/worker/jobs/snooze-wake";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

const MIN = 60 * 1000;

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
  return { orgId, owner: { userId: users[0].id, orgId }, member: { userId: users[1].id, orgId } };
}

async function audits(ticketId: string, action: "SNOOZED" | "WOKEN") {
  return prisma.ticketAuditEvent.findMany({
    where: { ticketId, action },
    orderBy: { createdAt: "asc" },
    select: { actorType: true, actorUserId: true, before: true, after: true },
  });
}

async function snoozedUntil(ticketId: string): Promise<Date | null> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { snoozedUntil: true },
  });
  return row.snoozedUntil;
}

describe("snooze tracer (D-12, D-13)", () => {
  it("snoozes through the service and the job wakes it exactly once", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedTicket(orgId);
    const now = new Date();
    const until = new Date(now.getTime() + 10 * MIN);

    const result = await snoozeTicket(prisma, owner, { ticketId: ticket.id, until }, { now });
    expect(result).toEqual({ ok: true, ticketId: ticket.id, snoozedUntil: until });
    expect((await snoozedUntil(ticket.id))?.toISOString()).toBe(until.toISOString());
    const snoozed = await audits(ticket.id, "SNOOZED");
    expect(snoozed).toEqual([
      {
        actorType: "USER",
        actorUserId: owner.userId,
        before: { snoozedUntil: null },
        after: { snoozedUntil: until.toISOString() },
      },
    ]);

    const wakeAt = new Date(until.getTime() + 1000);
    const first = await snoozeWakeHandler(undefined, { now: wakeAt });
    expect(first.woken).toBeGreaterThanOrEqual(1);
    expect(await snoozedUntil(ticket.id)).toBeNull();
    expect(await audits(ticket.id, "WOKEN")).toEqual([
      {
        actorType: "SYSTEM",
        actorUserId: null,
        before: { snoozedUntil: until.toISOString() },
        after: { snoozedUntil: null },
      },
    ]);

    const second = await snoozeWakeHandler(undefined, { now: wakeAt });
    expect(second).toEqual({ woken: 0 });
    expect(await audits(ticket.id, "WOKEN")).toHaveLength(1);
  });
});
