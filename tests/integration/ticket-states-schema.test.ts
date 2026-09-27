// Phase 12.1 schema proofs (AIDA-56, AIDA-97): the state model, the organization trigger, the
// default state of a created ticket. Unmocked, on the shared Testcontainers database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { createTicket } from "@/lib/tickets/create-ticket";
import { lockTicketsInIdOrder } from "@/lib/tickets/merge";
import {
  listActiveStates,
  readLegacyStateIds,
  readStateGroups,
  shareLockActiveState,
  stateAuditSnapshot,
} from "@/lib/tickets/ticket-states";
import { seedTicket, stateIdFor } from "../support/inbox-fixtures";

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

/** Code-unit comparison, the order of COLLATE "C". */
function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

describe("Phase 12.1 shared state reads (ticket-states.ts)", () => {
  it("shareLockActiveState returns an active state of the organization and null otherwise", async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const a = await statesByName(orgA);
    const b = await statesByName(orgB);
    const pendingA = a.get("Pending")?.id as string;
    const closedA = a.get("Closed")?.id as string;
    await prisma.ticketState.update({ where: { id: closedA }, data: { deletedAt: new Date() } });

    const result = await prisma.$transaction(async (tx) => ({
      active: await shareLockActiveState(tx, orgA, pendingA),
      deleted: await shareLockActiveState(tx, orgA, closedA),
      other: await shareLockActiveState(tx, orgA, b.get("Pending")?.id as string),
      unknown: await shareLockActiveState(tx, orgA, randomUUID()),
    }));
    expect(result.active).toEqual({ id: pendingA, group: "PENDING" });
    expect(result.deleted).toBeNull();
    expect(result.other).toBeNull();
    expect(result.unknown).toBeNull();
  });

  it("readStateGroups maps the organization's ids (soft-deleted included) and leaves out others", async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const a = await statesByName(orgA);
    const b = await statesByName(orgB);
    const resolvedA = a.get("Resolved")?.id as string;
    const newA = a.get("New")?.id as string;
    await prisma.ticketState.update({ where: { id: resolvedA }, data: { deletedAt: new Date() } });

    const groups = await readStateGroups(prisma, orgA, [
      newA,
      resolvedA,
      b.get("Closed")?.id as string,
    ]);
    expect([...groups.entries()].sort()).toEqual(
      [
        [newA, "OPEN"],
        [resolvedA, "RESOLVED"],
      ].sort(),
    );
  });

  it("listActiveStates orders by group, sortOrder and id in code-unit order, without deleted states", async () => {
    const orgId = await insertOrg();
    const fresh = await listActiveStates(prisma, orgId);
    expect(fresh.map((s) => s.name)).toEqual(["New", "Open", "Pending", "Resolved", "Closed"]);
    expect(fresh[0]).toMatchObject({ colorToken: "indigo-filled", group: "OPEN", sortOrder: 0 });

    const byName = await statesByName(orgId);
    const openId = byName.get("Open")?.id as string;
    const triage = await prisma.ticketState.create({
      data: { organizationId: orgId, name: "Triage", colorToken: "teal", group: "OPEN", sortOrder: 1 },
    });
    const gone = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Gone",
        colorToken: "red",
        group: "OPEN",
        sortOrder: 1,
        deletedAt: new Date(),
      },
    });

    const listed = await listActiveStates(prisma, orgId);
    const tiedOpen = [openId, triage.id].sort(codeUnitCompare);
    expect(listed.map((s) => s.id)).toEqual([
      byName.get("New")?.id,
      ...tiedOpen,
      byName.get("Pending")?.id,
      byName.get("Resolved")?.id,
      byName.get("Closed")?.id,
    ]);
    expect(listed.some((s) => s.id === gone.id)).toBe(false);
  });

  it("readLegacyStateIds returns the five ids keyed NEW to CLOSED, null for a deleted one", async () => {
    const orgId = await insertOrg();
    const byName = await statesByName(orgId);
    const before = await readLegacyStateIds(prisma, orgId);
    expect(before).toEqual({
      NEW: byName.get("New")?.id,
      OPEN: byName.get("Open")?.id,
      PENDING: byName.get("Pending")?.id,
      RESOLVED: byName.get("Resolved")?.id,
      CLOSED: byName.get("Closed")?.id,
    });

    await prisma.ticketState.update({
      where: { id: byName.get("Pending")?.id as string },
      data: { deletedAt: new Date() },
    });
    const after = await readLegacyStateIds(prisma, orgId);
    expect(after.PENDING).toBeNull();
    expect(after.OPEN).toBe(byName.get("Open")?.id);
  });

  it("stateAuditSnapshot is the flat { stateId, stateGroup } shape", () => {
    expect(stateAuditSnapshot("s1", "PENDING")).toEqual({ stateId: "s1", stateGroup: "PENDING" });
  });
});

describe("Phase 12.1 lock helper and fixtures", () => {
  it("lockTicketsInIdOrder returns the Ticket columns of each locked ticket in ascending id order", async () => {
    const orgId = await insertOrg();
    const one = await seedTicket(orgId, { status: "PENDING" });
    const two = await seedTicket(orgId);
    const expectedOrder = [one.id, two.id].sort(codeUnitCompare);

    const rows = await prisma.$transaction((tx) =>
      lockTicketsInIdOrder(tx, orgId, [two.id, one.id, two.id]),
    );
    expect(rows.map((r) => r.id)).toEqual(expectedOrder);

    const stored = await prisma.ticket.findMany({ where: { organizationId: orgId } });
    for (const row of rows) {
      const ticket = stored.find((t) => t.id === row.id);
      expect(ticket).toBeDefined();
      expect(row.stateId).toBe(ticket?.stateId);
      expect(row.contactId).toBe(ticket?.contactId);
      expect(row.mergedIntoTicketId).toBeNull();
      expect(row.snoozedUntil).toBeNull();
      expect(typeof row.slaPausedMs).toBe("bigint");
      expect(row.slaPausedMs).toBe(0n);
      expect(row.firstResponseDueAt.getTime()).toBe(ticket?.firstResponseDueAt.getTime());
      expect(row.resolutionDueAt.getTime()).toBe(ticket?.resolutionDueAt.getTime());
      expect(row.slaPausedAt?.getTime() ?? null).toBe(ticket?.slaPausedAt?.getTime() ?? null);
    }
    expect(rows.find((r) => r.id === one.id)?.slaPausedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === two.id)?.slaPausedAt).toBeNull();
  });

  it("seedTicket maps a legacy key to the state id and keeps the pause invariant; stateIdFor resolves keys", async () => {
    const orgId = await insertOrg();
    const byName = await statesByName(orgId);
    const pending = await seedTicket(orgId, { status: "PENDING" });
    const resolved = await seedTicket(orgId, { status: "RESOLVED" });

    const p = await prisma.ticket.findUniqueOrThrow({ where: { id: pending.id } });
    expect(p.stateId).toBe(byName.get("Pending")?.id);
    expect(p.slaPausedAt).toBeInstanceOf(Date);

    const r = await prisma.ticket.findUniqueOrThrow({ where: { id: resolved.id } });
    expect(r.stateId).toBe(byName.get("Resolved")?.id);
    expect(r.slaPausedAt).toBeNull();

    expect(await stateIdFor(orgId, "CLOSED")).toBe(byName.get("Closed")?.id);
  });
});
