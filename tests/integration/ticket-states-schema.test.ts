// Phase 12.1 schema proofs (AIDA-56, AIDA-97): the state model, the organization trigger, the
// default state of a created ticket. Unmocked, on the shared Testcontainers database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { createTicket } from "@/lib/tickets/create-ticket";

const DEFAULT_STATES = [
  { name: "New", group: "OPEN", colorToken: "indigo-filled", sortOrder: 0, legacyStatus: "NEW" },
  { name: "Open", group: "OPEN", colorToken: "indigo", sortOrder: 1, legacyStatus: "OPEN" },
  { name: "Pending", group: "PENDING", colorToken: "amber", sortOrder: 2, legacyStatus: "PENDING" },
  { name: "Resolved", group: "RESOLVED", colorToken: "green", sortOrder: 3, legacyStatus: "RESOLVED" },
  { name: "Closed", group: "CLOSED", colorToken: "gray", sortOrder: 4, legacyStatus: "CLOSED" },
] as const;

/** Inserts an organization directly through Prisma (no bootstrap, no helper). */
async function insertOrg(): Promise<string> {
  const id = randomUUID();
  await prisma.organization.create({
    data: { id, name: "States Org", slug: `states-${id}`, createdAt: new Date() },
  });
  return id;
}

/** The five states of an organization keyed by name. */
async function statesByName(orgId: string) {
  const rows = await prisma.ticketState.findMany({ where: { organizationId: orgId } });
  return new Map(rows.map((r) => [r.name, r]));
}

describe("Phase 12.1 schema: default states through the organization trigger", () => {
  it("gives an organization inserted directly its five states and a configuration row", async () => {
    const orgId = await insertOrg();
    const rows = await prisma.ticketState.findMany({
      where: { organizationId: orgId },
      orderBy: { sortOrder: "asc" },
    });
    expect(
      rows.map((r) => ({
        name: r.name,
        group: r.group,
        colorToken: r.colorToken,
        sortOrder: r.sortOrder,
        legacyStatus: r.legacyStatus,
      })),
    ).toEqual(DEFAULT_STATES.map((s) => ({ ...s })));
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);

    const byName = await statesByName(orgId);
    const config = await prisma.ticketStateConfig.findUnique({ where: { organizationId: orgId } });
    expect(config).not.toBeNull();
    expect(config?.newStateId).toBe(byName.get("New")?.id);
    expect(config?.reopenStateId).toBe(byName.get("Open")?.id);
    expect(config?.resolveStateId).toBe(byName.get("Resolved")?.id);
    expect(config?.autoCloseStateId).toBe(byName.get("Closed")?.id);
    expect(config?.mergeCloseStateId).toBe(byName.get("Closed")?.id);
  });

  it("creates a ticket in the default state New with no SLA pause", async () => {
    const orgId = await insertOrg();
    const created = await createTicket(orgId, {
      subject: "Default state",
      priority: "NORMAL",
      body: "Body",
      contact: { email: `states-${randomUUID()}@example.test` },
      direction: "INBOUND",
    });
    const ticket = await scopedDb(orgId).ticket.findFirst({
      where: { id: created.id },
      include: { state: true },
    });
    expect(ticket?.state.name).toBe("New");
    expect(ticket?.state.group).toBe("OPEN");
    expect(ticket?.slaPausedAt).toBeNull();
    expect(ticket?.slaPausedMs).toBe(0n);
  });
});
