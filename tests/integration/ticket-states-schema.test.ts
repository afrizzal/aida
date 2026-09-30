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
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";

/** Full text of a Prisma or pg adapter error, including meta and the cause chain. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; meta?: unknown; cause?: unknown };
    parts.push(String(e.code ?? ""), String(e.message ?? current), JSON.stringify(e.meta ?? {}));
    current = e.cause;
  }
  return parts.join(" ");
}

/** Resolves with the error text when the promise rejects; fails the test when it resolves. */
async function rejection(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return errorText(err);
  }
  throw new Error("expected the operation to be rejected");
}

// Captured from migration 20260701234808_ticket_search (as in lifecycle-schema.test.ts): this
// phase's migration must not have rewritten the generated FTS columns or their GIN indexes.
const TICKET_SEARCH_EXPR = `(setweight(to_tsvector('simple'::regconfig, COALESCE((number)::text, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(subject, ''::text)), 'B'::"char"))`;
const MESSAGE_SEARCH_EXPR = `to_tsvector('english'::regconfig, COALESCE("bodyMarkdown", ''::text))`;
const TICKET_SEARCH_INDEXDEF = `CREATE INDEX "Ticket_searchVector_idx" ON public."Ticket" USING gin ("searchVector")`;
const MESSAGE_SEARCH_INDEXDEF = `CREATE INDEX "Message_searchVector_idx" ON public."Message" USING gin ("searchVector")`;

const DEFAULT_STATES = [
  { name: "New", group: "OPEN", colorToken: "indigo-filled", sortOrder: 0, legacyStatus: "NEW" },
  { name: "Open", group: "OPEN", colorToken: "indigo", sortOrder: 1, legacyStatus: "OPEN" },
  { name: "Pending", group: "PENDING", colorToken: "amber", sortOrder: 2, legacyStatus: "PENDING" },
  {
    name: "Resolved",
    group: "RESOLVED",
    colorToken: "green",
    sortOrder: 3,
    legacyStatus: "RESOLVED",
  },
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
      data: {
        organizationId: orgId,
        name: "Triage",
        colorToken: "teal",
        group: "OPEN",
        sortOrder: 1,
      },
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

/** A fresh organization (through the shared fixture, so the trigger seeds it). */
async function freshOrg(): Promise<string> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  return orgId;
}

interface StateInsert {
  name: string;
  colorToken?: string;
  group?: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
  legacyStatus?: string | null;
}

/** Inserts one state with raw SQL, so constraint names reach the error text unchanged. */
function insertState(orgId: string, state: StateInsert) {
  return prisma.$executeRaw`
    INSERT INTO "TicketState"
      ("id", "organizationId", "name", "colorToken", "group", "sortOrder", "legacyStatus", "updatedAt")
    VALUES (${randomUUID()}, ${orgId}, ${state.name}, ${state.colorToken ?? "teal"},
            ${state.group ?? "OPEN"}::"TicketStateGroup", 9, ${state.legacyStatus ?? null},
            CURRENT_TIMESTAMP)`;
}

describe("Phase 12.1 schema: organization ownership (D-04, D-05)", () => {
  it("refuses a ticket update or insert with another organization's state id", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const ticket = await seedTicket(orgA);
    const foreign = await stateIdFor(orgB, "OPEN");

    const update = await rejection(
      prisma.$executeRaw`UPDATE "Ticket" SET "stateId" = ${foreign} WHERE id = ${ticket.id}`,
    );
    expect(update).toContain("Ticket_organizationId_stateId_fkey");

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const insert = await rejection(
      prisma.$executeRaw`
        INSERT INTO "Ticket" ("id", "organizationId", "number", "statusToken", "subject", "stateId",
          "contactId", "firstResponseTargetMinutes", "resolutionTargetMinutes", "firstResponseDueAt",
          "resolutionDueAt", "updatedAt")
        VALUES (${randomUUID()}, ${orgA}, 999999, ${randomUUID()}, 'Foreign state', ${foreign},
          ${row.contactId}, 60, 600, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    expect(insert).toContain("Ticket_organizationId_stateId_fkey");
  });

  it("refuses a configuration role pointing at another organization's state", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const foreign = await stateIdFor(orgB, "NEW");
    const text = await rejection(
      prisma.$executeRaw`
        UPDATE "TicketStateConfig" SET "newStateId" = ${foreign} WHERE "organizationId" = ${orgA}`,
    );
    expect(text).toContain("TicketStateConfig_organizationId_newStateId_fkey");
  });

  it("refuses a hard DELETE of a state a ticket or a configuration role uses", async () => {
    const orgId = await freshOrg();
    const ticket = await seedTicket(orgId, { status: "PENDING" });
    const pending = await stateIdFor(orgId, "PENDING");
    const resolved = await stateIdFor(orgId, "RESOLVED");
    const byTicket = await rejection(
      prisma.$executeRaw`DELETE FROM "TicketState" WHERE id = ${pending}`,
    );
    expect(byTicket).toContain("Ticket_organizationId_stateId_fkey");
    const byRole = await rejection(
      prisma.$executeRaw`DELETE FROM "TicketState" WHERE id = ${resolved}`,
    );
    expect(byRole).toContain("TicketStateConfig_organizationId_resolveStateId_fkey");
    expect(await prisma.ticket.count({ where: { id: ticket.id, stateId: pending } })).toBe(1);
  });

  it("refuses moving a state into another organization instead of cascading its tickets (review WR-01)", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    // A state that holds no role, so only the ticket's composite key references it.
    const extra = await prisma.ticketState.create({
      data: {
        organizationId: orgA,
        name: "Waiting on vendor",
        colorToken: "gray",
        group: "OPEN",
        sortOrder: 9,
      },
      select: { id: true },
    });
    const ticket = await seedTicket(orgA, { stateId: extra.id });
    const moved = await rejection(
      prisma.$executeRaw`UPDATE "TicketState" SET "organizationId" = ${orgB} WHERE id = ${extra.id}`,
    );
    expect(moved).toContain("Ticket_organizationId_stateId_fkey");
    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { organizationId: true, stateId: true },
    });
    expect(after).toEqual({ organizationId: orgA, stateId: extra.id });
  });

  it("declares every composite state foreign key ON UPDATE RESTRICT and ON DELETE RESTRICT (review WR-01)", async () => {
    const names = [
      "Ticket_organizationId_stateId_fkey",
      "TicketStateConfig_organizationId_newStateId_fkey",
      "TicketStateConfig_organizationId_reopenStateId_fkey",
      "TicketStateConfig_organizationId_resolveStateId_fkey",
      "TicketStateConfig_organizationId_autoCloseStateId_fkey",
      "TicketStateConfig_organizationId_mergeCloseStateId_fkey",
    ];
    const rows = await prisma.$queryRaw<{ conname: string; upd: string; del: string }[]>`
      SELECT conname, confupdtype::text AS upd, confdeltype::text AS del
      FROM pg_constraint WHERE conname = ANY(${names}::text[])
    `;
    rows.sort((x, y) => (x.conname < y.conname ? -1 : 1));
    expect(rows).toEqual([...names].sort().map((conname) => ({ conname, upd: "r", del: "r" })));
  });
});

describe("Phase 12.1 schema: names, checks and the group fence (D-03, K42)", () => {
  it("active names are unique per organization case-insensitively; deleted names can be reused", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    await insertState(orgA, { name: "Waiting" });
    expect(await rejection(insertState(orgA, { name: "waiting" }))).toContain(
      "TicketState_active_name_key",
    );
    await insertState(orgB, { name: "Waiting" });

    await prisma.ticketState.updateMany({
      where: { organizationId: orgA, name: "Waiting" },
      data: { deletedAt: new Date() },
    });
    await insertState(orgA, { name: "Waiting" });
    expect(
      await prisma.ticketState.count({ where: { organizationId: orgA, name: "Waiting" } }),
    ).toBe(2);
  });

  it("refuses a bad name, colour key or legacy key, and a negative pause sum", async () => {
    const orgId = await freshOrg();
    expect(await rejection(insertState(orgId, { name: "  Waiting" }))).toContain(
      "TicketState_name_check",
    );
    expect(await rejection(insertState(orgId, { name: "" }))).toContain("TicketState_name_check");
    expect(await rejection(insertState(orgId, { name: "x".repeat(41) }))).toContain(
      "TicketState_name_check",
    );
    await insertState(orgId, { name: "y".repeat(40) });
    expect(await rejection(insertState(orgId, { name: "Violet", colorToken: "violet" }))).toContain(
      "TicketState_color_token_check",
    );
    expect(
      await rejection(insertState(orgId, { name: "Archive", legacyStatus: "ARCHIVED" })),
    ).toContain("TicketState_legacy_status_check");
    const ticket = await seedTicket(orgId);
    expect(
      await rejection(
        prisma.$executeRaw`UPDATE "Ticket" SET "slaPausedMs" = -1 WHERE id = ${ticket.id}`,
      ),
    ).toContain("Ticket_sla_paused_ms_check");
  });

  it("a second legacy NEW state in one organization fails on TicketState_legacy_status_key", async () => {
    const orgId = await freshOrg();
    expect(await rejection(insertState(orgId, { name: "Fresh", legacyStatus: "NEW" }))).toContain(
      "TicketState_legacy_status_key",
    );
  });

  it("a state's group never changes (aida_ticket_state_group_fixed); name, colour and order do", async () => {
    const orgId = await freshOrg();
    const pending = await stateIdFor(orgId, "PENDING");
    const text = await rejection(
      prisma.$executeRaw`UPDATE "TicketState" SET "group" = 'OPEN' WHERE id = ${pending}`,
    );
    expect(text).toContain("TicketState.group cannot change");

    await prisma.$executeRaw`
      UPDATE "TicketState" SET "name" = 'Waiting', "colorToken" = 'orange', "sortOrder" = 7,
        "group" = 'PENDING'
      WHERE id = ${pending}`;
    const row = await prisma.ticketState.findUniqueOrThrow({ where: { id: pending } });
    expect(row).toMatchObject({
      name: "Waiting",
      colorToken: "orange",
      sortOrder: 7,
      group: "PENDING",
    });

    const triggers = await prisma.$queryRaw<
      { relname: string; proname: string; tgenabled: string }[]
    >`
      SELECT c.relname, p.proname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname = 'aida_ticket_state_group_fixed'`;
    expect(triggers).toEqual([
      { relname: "TicketState", proname: "aida_ticket_state_group_immutable", tgenabled: "O" },
    ]);
  });
});

describe("Phase 12.1 schema: the seed function and the trigger (D-07 amended, K43)", () => {
  it("calling aida_seed_ticket_states a second time inserts nothing", async () => {
    const orgId = await freshOrg();
    await prisma.$queryRaw`SELECT aida_seed_ticket_states(${orgId})::text AS done`;
    expect(await prisma.ticketState.count({ where: { organizationId: orgId } })).toBe(5);
    expect(await prisma.ticketStateConfig.count({ where: { organizationId: orgId } })).toBe(1);

    const triggers = await prisma.$queryRaw<
      { relname: string; proname: string; tgenabled: string }[]
    >`
      SELECT c.relname, p.proname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname = 'aida_organization_ticket_states'`;
    expect(triggers).toEqual([
      { relname: "organization", proname: "aida_organization_seed_ticket_states", tgenabled: "O" },
    ]);
  });
});

describe("Phase 12.1 schema: the enum is gone (assumption-delta invariant, D-04)", () => {
  it("Ticket has no status column, no TicketStatus type exists, and the index moved to stateId", async () => {
    const columns = await prisma.$queryRaw<{ attname: string }[]>`
      SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'Ticket' AND a.attname = 'status' AND NOT a.attisdropped`;
    expect(columns).toEqual([]);
    const types = await prisma.$queryRaw<{ typname: string }[]>`
      SELECT typname FROM pg_type WHERE typname = 'TicketStatus'`;
    expect(types).toEqual([]);
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('Ticket_organizationId_stateId_idx', 'Ticket_organizationId_status_idx')`;
    expect(indexes.map((r) => r.indexname)).toEqual(["Ticket_organizationId_stateId_idx"]);
  });

  it("every ticket's state belongs to its own organization", async () => {
    const orgId = await freshOrg();
    await seedTicket(orgId, { status: "CLOSED" });
    const mismatched = await prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM "Ticket" t
      WHERE NOT EXISTS (
        SELECT 1 FROM "TicketState" s WHERE s.id = t."stateId" AND s."organizationId" = t."organizationId"
      )`;
    expect(mismatched).toEqual([]);
  });
});

describe("Phase 12.1 schema: scopedDb isolation of the new models (D-01)", () => {
  it("scopedDb(orgB) never reads, counts, updates or deletes organization A's states", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const aIds = (await prisma.ticketState.findMany({ where: { organizationId: orgA } })).map(
      (s) => s.id,
    );
    const dbB = scopedDb(orgB);

    const seen = await dbB.ticketState.findMany({ where: { id: { in: aIds } } });
    expect(seen).toEqual([]);
    expect(await dbB.ticketState.count({ where: { id: { in: aIds } } })).toBe(0);
    const all = await dbB.ticketState.findMany();
    expect(all.every((s) => s.organizationId === orgB)).toBe(true);
    expect(all).toHaveLength(5);

    const updated = await dbB.ticketState.updateMany({
      where: { id: { in: aIds } },
      data: { colorToken: "red" },
    });
    expect(updated.count).toBe(0);
    const deleted = await dbB.ticketState.deleteMany({ where: { id: { in: aIds } } });
    expect(deleted.count).toBe(0);
    const aRows = await prisma.ticketState.findMany({ where: { organizationId: orgA } });
    expect(aRows).toHaveLength(5);
    expect(aRows.some((s) => s.colorToken === "red")).toBe(false);
  });

  it("scopedDb(orgB) never reads or updates organization A's configuration row", async () => {
    const orgA = await freshOrg();
    const orgB = await freshOrg();
    const before = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgA },
    });
    const dbB = scopedDb(orgB);

    // A's row selected by its own role ids is invisible to B.
    const read = await dbB.ticketStateConfig.findFirst({
      where: { newStateId: before.newStateId },
    });
    expect(read).toBeNull();
    // A caller-supplied organizationId is overridden by the scope: B only ever sees its own row.
    const overridden = await dbB.ticketStateConfig.findFirst({ where: { organizationId: orgA } });
    expect(overridden?.organizationId).toBe(orgB);
    const own = await dbB.ticketStateConfig.findFirst();
    expect(own?.organizationId).toBe(orgB);

    const updated = await dbB.ticketStateConfig.updateMany({
      where: { newStateId: before.newStateId },
      data: { updatedAt: new Date(0) },
    });
    expect(updated.count).toBe(0);
    const after = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgA },
    });
    expect(after).toEqual(before);
  });
});

describe("Phase 12.1 keeps earlier hand-written objects (T-12.1-03)", () => {
  it("both append-only triggers stay attached and enabled", async () => {
    const rows = await prisma.$queryRaw<
      { tgname: string; relname: string; proname: string; tgenabled: string }[]
    >`
      SELECT t.tgname, c.relname, p.proname, t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname IN ('aida_audit_event_no_update_delete', 'aida_ticket_audit_event_no_update_delete')
      ORDER BY t.tgname`;
    expect(rows).toEqual([
      {
        tgname: "aida_audit_event_no_update_delete",
        relname: "AuditEvent",
        proname: "aida_audit_event_immutable",
        tgenabled: "O",
      },
      {
        tgname: "aida_ticket_audit_event_no_update_delete",
        relname: "TicketAuditEvent",
        proname: "aida_ticket_audit_event_immutable",
        tgenabled: "O",
      },
    ]);
  });

  it("the generated searchVector columns and their GIN indexes are unchanged", async () => {
    const columns = await prisma.$queryRaw<
      { relname: string; attgenerated: string; expr: string }[]
    >`
      SELECT c.relname, a.attgenerated::text AS attgenerated, pg_get_expr(d.adbin, d.adrelid) AS expr
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attname = 'searchVector' AND c.relname IN ('Ticket', 'Message') AND NOT a.attisdropped
      ORDER BY c.relname`;
    expect(columns).toEqual([
      { relname: "Message", attgenerated: "s", expr: MESSAGE_SEARCH_EXPR },
      { relname: "Ticket", attgenerated: "s", expr: TICKET_SEARCH_EXPR },
    ]);
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('Ticket_searchVector_idx', 'Message_searchVector_idx')
      ORDER BY indexname`;
    expect(indexes).toEqual([
      { indexname: "Message_searchVector_idx", indexdef: MESSAGE_SEARCH_INDEXDEF },
      { indexname: "Ticket_searchVector_idx", indexdef: TICKET_SEARCH_INDEXDEF },
    ]);
  });

  it("the SavedView, TicketRelation and Ticket hand-written indexes and CHECKs exist", async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('SavedView_private_name_key', 'SavedView_shared_name_key',
                          'TicketRelation_pair_key', 'TicketRelation_one_parent_key',
                          'TicketState_active_name_key', 'TicketState_legacy_status_key')
      ORDER BY indexname`;
    expect(indexes.map((r) => r.indexname)).toEqual([
      "SavedView_private_name_key",
      "SavedView_shared_name_key",
      "TicketRelation_one_parent_key",
      "TicketRelation_pair_key",
      "TicketState_active_name_key",
      "TicketState_legacy_status_key",
    ]);
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conname IN ('SavedView_name_length_check', 'TicketAuditEvent_actor_check',
                                          'TicketRelation_no_self_check', 'Ticket_merge_fields_check',
                                          'Ticket_sla_paused_ms_check')
      ORDER BY conname`;
    expect(checks.map((r) => r.conname)).toEqual([
      "SavedView_name_length_check",
      "TicketAuditEvent_actor_check",
      "TicketRelation_no_self_check",
      "Ticket_merge_fields_check",
      "Ticket_sla_paused_ms_check",
    ]);
  });
});
