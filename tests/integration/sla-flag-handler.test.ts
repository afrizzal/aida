import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { slaFlagHandler } from "@/lib/worker/jobs/sla-flag";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id` or `createdAt` — BA manages them internally, so we provide them here for tests.
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

async function seedOrgWithContact(label: string) {
  const org = await prisma.organization.create({ data: makeOrgData(`Org ${label}`, `sla-flag-${label}`) });
  const contact = await prisma.contact.create({
    data: { organizationId: org.id, email: `${label}@sla-flag.test` },
  });
  return { org, contact };
}

type TicketOverrides = {
  status?: "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
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
  return prisma.ticket.create({
    data: {
      organizationId: orgId,
      contactId,
      number,
      statusToken: randomUUID(),
      subject: `SLA flag test #${number}`,
      status: overrides.status ?? "OPEN",
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
      status: "RESOLVED",
      firstResponseDueAt: new Date(now - 24 * 60 * MIN),
      resolutionDueAt: new Date(now - 24 * 60 * MIN),
    });
    const closed = await seedTicket(org.id, contact.id, 2, {
      status: "CLOSED",
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
});
