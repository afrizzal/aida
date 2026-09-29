import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { slaFlagHandler } from "@/lib/worker/jobs/sla-flag";
import { type LegacyStatusKey, stateIdFor } from "../support/inbox-fixtures";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id` or `createdAt` — BA manages them internally, so we provide them here for tests.
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

async function seedOrgWithContact(label: string) {
  const org = await prisma.organization.create({
    data: makeOrgData(`Org ${label}`, `sla-flag-${label}`),
  });
  const contact = await prisma.contact.create({
    data: { organizationId: org.id, email: `${label}@sla-flag.test` },
  });
  return { org, contact };
}

type TicketOverrides = {
  /** Legacy key of one of the five default states (the organization trigger creates them). */
  state?: LegacyStatusKey;
  /** A state id of the same organization; wins over state. */
  stateId?: string;
  /** Written as given; a PENDING-group state gets its pause start by default. */
  slaPausedAt?: Date | null;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstRespondedAt?: Date | null;
  firstResponseTargetMinutes?: number;
  resolutionTargetMinutes?: number;
};

async function seedTicket(
  orgId: string,
  contactId: string,
  number: number,
  overrides: TicketOverrides,
) {
  const key = overrides.state ?? "OPEN";
  const stateId = overrides.stateId ?? (await stateIdFor(orgId, key));
  const slaPausedAt =
    overrides.slaPausedAt !== undefined
      ? overrides.slaPausedAt
      : overrides.stateId === undefined && key === "PENDING"
        ? new Date()
        : null;
  return prisma.ticket.create({
    data: {
      organizationId: orgId,
      contactId,
      number,
      statusToken: randomUUID(),
      subject: `SLA flag test #${number}`,
      stateId,
      slaPausedAt,
      priority: "NORMAL",
      firstResponseTargetMinutes: overrides.firstResponseTargetMinutes ?? 60,
      resolutionTargetMinutes: overrides.resolutionTargetMinutes ?? 480,
      firstResponseDueAt: overrides.firstResponseDueAt,
      resolutionDueAt: overrides.resolutionDueAt,
      firstRespondedAt: overrides.firstRespondedAt ?? null,
    },
  });
}

const MIN = 60 * 1000;

describe("slaFlagHandler", () => {
  it("marks a ticket breached (and implicitly at-risk) once firstResponseDueAt has passed", async () => {
    const { org, contact } = await seedOrgWithContact("breach-first-response");
    const now = Date.now();
    const ticket = await seedTicket(org.id, contact.id, 1, {
      firstResponseDueAt: new Date(now - 5 * MIN),
      resolutionDueAt: new Date(now + 8 * 60 * MIN),
    });

    await slaFlagHandler();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.isBreached).toBe(true);
    expect(updated.isAtRisk).toBe(true);
  });

  it("marks a ticket breached via resolutionDueAt once the first response is already in", async () => {
    const { org, contact } = await seedOrgWithContact("breach-resolution");
    const now = Date.now();
    const ticket = await seedTicket(org.id, contact.id, 1, {
      firstResponseDueAt: new Date(now - 50 * MIN),
      firstRespondedAt: new Date(now - 45 * MIN),
      resolutionDueAt: new Date(now - 5 * MIN),
      resolutionTargetMinutes: 480,
    });

    await slaFlagHandler();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.isBreached).toBe(true);
  });

  it("marks a ticket at-risk (not breached) when due within 20% of the target duration", async () => {
    const { org, contact } = await seedOrgWithContact("at-risk");
    const now = Date.now();
    // 60-minute target; 20% = 12 minutes. Due in 10 minutes falls inside that window.
    const ticket = await seedTicket(org.id, contact.id, 1, {
      firstResponseDueAt: new Date(now + 10 * MIN),
      resolutionDueAt: new Date(now + 8 * 60 * MIN),
      firstResponseTargetMinutes: 60,
    });

    await slaFlagHandler();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.isAtRisk).toBe(true);
    expect(updated.isBreached).toBe(false);
  });

  it("leaves a comfortably-on-track ticket untouched", async () => {
    const { org, contact } = await seedOrgWithContact("on-track");
    const now = Date.now();
    // 60-minute target; due in 30 minutes is well outside the 20% (12-minute) at-risk window.
    const ticket = await seedTicket(org.id, contact.id, 1, {
      firstResponseDueAt: new Date(now + 30 * MIN),
      resolutionDueAt: new Date(now + 8 * 60 * MIN),
      firstResponseTargetMinutes: 60,
    });

    await slaFlagHandler();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.isAtRisk).toBe(false);
    expect(updated.isBreached).toBe(false);
  });

  it("excludes RESOLVED and CLOSED tickets even when their due timestamps are long past", async () => {
    const { org, contact } = await seedOrgWithContact("excluded-statuses");
    const now = Date.now();
    const resolved = await seedTicket(org.id, contact.id, 1, {
      state: "RESOLVED",
      firstResponseDueAt: new Date(now - 24 * 60 * MIN),
      resolutionDueAt: new Date(now - 24 * 60 * MIN),
    });
    const closed = await seedTicket(org.id, contact.id, 2, {
      state: "CLOSED",
      firstResponseDueAt: new Date(now - 24 * 60 * MIN),
      resolutionDueAt: new Date(now - 24 * 60 * MIN),
    });

    await slaFlagHandler();

    const updatedResolved = await prisma.ticket.findUniqueOrThrow({ where: { id: resolved.id } });
    const updatedClosed = await prisma.ticket.findUniqueOrThrow({ where: { id: closed.id } });
    expect(updatedResolved.isBreached).toBe(false);
    expect(updatedResolved.isAtRisk).toBe(false);
    expect(updatedClosed.isBreached).toBe(false);
    expect(updatedClosed.isAtRisk).toBe(false);
  });

  it("group gate: overdue tickets in New, Open and an admin-created OPEN state are flagged; Pending, Resolved, Closed and a paused OPEN ticket are not", async () => {
    const { org, contact } = await seedOrgWithContact("group-gate");
    const now = new Date("2031-03-04T05:06:07.890Z");
    const overdue = {
      firstResponseDueAt: new Date(now.getTime() - 60 * MIN),
      resolutionDueAt: new Date(now.getTime() - 30 * MIN),
    };
    const custom = await prisma.ticketState.create({
      data: {
        organizationId: org.id,
        name: "Waiting on engineering",
        colorToken: "indigo",
        group: "OPEN",
        sortOrder: 10,
      },
    });

    const flagged = [
      await seedTicket(org.id, contact.id, 1, { ...overdue, state: "NEW" }),
      await seedTicket(org.id, contact.id, 2, { ...overdue, state: "OPEN" }),
      await seedTicket(org.id, contact.id, 3, { ...overdue, stateId: custom.id }),
    ];
    const skipped = [
      await seedTicket(org.id, contact.id, 4, { ...overdue, state: "PENDING" }),
      await seedTicket(org.id, contact.id, 5, { ...overdue, state: "RESOLVED" }),
      await seedTicket(org.id, contact.id, 6, { ...overdue, state: "CLOSED" }),
      // Inconsistent data written directly: an OPEN-group ticket with an open pause.
      await seedTicket(org.id, contact.id, 7, {
        ...overdue,
        state: "OPEN",
        slaPausedAt: new Date(now.getTime() - 90 * MIN),
      }),
    ];
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: skipped[0].id } })).slaPausedAt,
    ).not.toBeNull();

    await slaFlagHandler(undefined, { now });

    for (const t of flagged) {
      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect({ n: row.number, isBreached: row.isBreached, isAtRisk: row.isAtRisk }).toEqual({
        n: t.number,
        isBreached: true,
        isAtRisk: true,
      });
    }
    for (const t of skipped) {
      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect({ n: row.number, isBreached: row.isBreached, isAtRisk: row.isAtRisk }).toEqual({
        n: t.number,
        isBreached: false,
        isAtRisk: false,
      });
    }
  });

  it("group gate, at-risk pass: a paused ticket inside the 20 percent window is not marked at-risk", async () => {
    const { org, contact } = await seedOrgWithContact("group-gate-at-risk");
    const now = new Date("2031-03-04T05:06:07.890Z");
    const soon = {
      firstResponseDueAt: new Date(now.getTime() + 10 * MIN),
      resolutionDueAt: new Date(now.getTime() + 8 * 60 * MIN),
      firstResponseTargetMinutes: 60,
    };
    const open = await seedTicket(org.id, contact.id, 1, { ...soon, state: "OPEN" });
    const pending = await seedTicket(org.id, contact.id, 2, { ...soon, state: "PENDING" });

    await slaFlagHandler(undefined, { now });

    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: open.id } })).isAtRisk).toBe(true);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: pending.id } })).isAtRisk).toBe(
      false,
    );
  });
});
