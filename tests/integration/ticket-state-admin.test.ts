// Phase 12.1, plan 12.1-08: the ticket state admin service (AIDA-97, D-01, D-03, D-05, D-06,
// D-12, D-14, D-15 amended, K40 to K42), on a real Postgres through Testcontainers. Nothing is
// mocked: real organizations, real members, real tickets.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { STATE_COLOR_KEYS } from "@/lib/tickets/state-colors";
import {
  createTicketState,
  deleteTicketState,
  listStatesForSettings,
  moveTicketState,
  setDefaultTicketState,
  updateTicketState,
} from "@/lib/tickets/ticket-state-admin";
import { listActiveStates } from "@/lib/tickets/ticket-states";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";

/** An organization with an admin, a plain member and a removed (formerly admin) member. */
async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member", "admin"]);
  await prisma.member.delete({ where: { id: users[2].memberId } });
  return {
    orgId,
    admin: { userId: users[0].id, orgId },
    member: { userId: users[1].id, orgId },
    removed: { userId: users[2].id, orgId },
  };
}

async function addState(
  orgId: string,
  group: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED",
  name = `State ${randomUUID().slice(0, 8)}`,
  sortOrder = 50,
) {
  const row = await prisma.ticketState.create({
    data: { organizationId: orgId, name, colorToken: "blue", group, sortOrder },
    select: { id: true, name: true },
  });
  return row;
}

async function config(orgId: string) {
  return prisma.ticketStateConfig.findUniqueOrThrow({ where: { organizationId: orgId } });
}

describe("deleteTicketState tracer (K41, K42, D-15)", () => {
  it("deletes Open with a same-group replacement, moving its ticket and its reopen role", async () => {
    const { orgId, admin } = await seedOrg();
    const openId = await stateIdFor(orgId, "OPEN");
    const second = await addState(orgId, "OPEN", "Second open");
    const ticket = await seedTicket(orgId, { status: "OPEN" });
    expect((await config(orgId)).reopenStateId).toBe(openId);

    const result = await deleteTicketState(prisma, admin, {
      stateId: openId,
      replacementStateId: second.id,
    });

    expect(result).toEqual({
      ok: true,
      movedCount: 1,
      rolesMoved: true,
      name: "Open",
      replacementName: "Second open",
    });
    const moved = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { stateId: true },
    });
    expect(moved.stateId).toBe(second.id);
    const audits = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: ticket.id, action: "STATUS_CHANGED" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "USER",
      actorUserId: admin.userId,
      before: { stateId: openId, stateGroup: "OPEN" },
      after: { stateId: second.id, stateGroup: "OPEN" },
    });
    expect(audits[0].batchId).toEqual(expect.any(String));
    expect((await config(orgId)).reopenStateId).toBe(second.id);
    const deleted = await prisma.ticketState.findUniqueOrThrow({ where: { id: openId } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });
});

const ROLE_GROUPS = {
  newStateId: "OPEN",
  reopenStateId: "OPEN",
  resolveStateId: "RESOLVED",
  autoCloseStateId: "CLOSED",
  mergeCloseStateId: "CLOSED",
} as const;

/** D-05: every role points at an active state of its required group. */
async function expectRolesValid(orgId: string) {
  const cfg = await config(orgId);
  for (const [column, group] of Object.entries(ROLE_GROUPS)) {
    const id = cfg[column as keyof typeof ROLE_GROUPS];
    const state = await prisma.ticketState.findUniqueOrThrow({ where: { id } });
    expect(state.organizationId).toBe(orgId);
    expect(state.deletedAt).toBeNull();
    expect(state.group).toBe(group);
  }
}

/** Every state row and the config row of the organization, for "nothing changed" checks. */
async function snapshot(orgId: string) {
  const states = await prisma.ticketState.findMany({
    where: { organizationId: orgId },
    orderBy: { id: "asc" },
  });
  const tickets = await prisma.ticket.findMany({
    where: { organizationId: orgId },
    orderBy: { id: "asc" },
    select: { id: true, stateId: true },
  });
  return { states, tickets, config: await config(orgId) };
}

async function groupOrder(orgId: string, group: string) {
  return (await listActiveStates(prisma, orgId))
    .filter((s) => s.group === group)
    .map((s) => ({ name: s.name, sortOrder: s.sortOrder }));
}

describe("createTicketState (D-03, D-14)", () => {
  it("stores the trimmed name one above the group's highest sortOrder", async () => {
    const { orgId, admin } = await seedOrg();
    const first = await createTicketState(prisma, admin, {
      group: "PENDING",
      name: "  Waiting on vendor ",
      colorToken: "orange",
    });
    expect(first).toMatchObject({
      ok: true,
      state: { name: "Waiting on vendor", group: "PENDING", colorToken: "orange", sortOrder: 3 },
    });
    await expectRolesValid(orgId);
  });

  it("counts code points: 40 with emoji is accepted, 41 is INVALID_NAME", async () => {
    const { admin } = await seedOrg();
    const forty = `${"😀".repeat(20)}${"a".repeat(20)}`;
    expect([...forty]).toHaveLength(40);
    expect(
      await createTicketState(prisma, admin, { group: "OPEN", name: forty, colorToken: "blue" }),
    ).toMatchObject({ ok: true, state: { name: forty } });
    expect(
      await createTicketState(prisma, admin, {
        group: "OPEN",
        name: `${forty}b`,
        colorToken: "blue",
      }),
    ).toEqual({ ok: false, error: "INVALID_NAME" });
  });

  it("refuses an empty or whitespace-only name as INVALID_NAME", async () => {
    const { orgId, admin } = await seedOrg();
    const before = await snapshot(orgId);
    for (const name of ["", "   "]) {
      expect(
        await createTicketState(prisma, admin, { group: "OPEN", name, colorToken: "blue" }),
      ).toEqual({ ok: false, error: "INVALID_NAME" });
    }
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("refuses control, format (zero-width, bidi) and line-separator characters as INVALID_NAME (review IN-a2-3)", async () => {
    const { orgId, admin } = await seedOrg();
    const pendingId = await stateIdFor(orgId, "PENDING");
    const before = await snapshot(orgId);
    const names = [
      "Open\u200B", // zero-width space
      "Op\nen", // inner newline
      "Op\u0007en", // bell (Cc)
      "\u202EOpen", // right-to-left override (Cf)
      "Op\u2028en", // line separator
      "Op\u2029en", // paragraph separator
      "Op\uFEFFen", // inner zero-width no-break space (Cf)
    ];
    for (const name of names) {
      expect(
        await createTicketState(prisma, admin, { group: "OPEN", name, colorToken: "blue" }),
      ).toEqual({ ok: false, error: "INVALID_NAME" });
      expect(await updateTicketState(prisma, admin, { stateId: pendingId, name })).toEqual({
        ok: false,
        error: "INVALID_NAME",
      });
    }
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("refuses an unknown colour as INVALID_COLOR and an unknown group as INVALID", async () => {
    const { admin } = await seedOrg();
    expect(
      await createTicketState(prisma, admin, { group: "OPEN", name: "X", colorToken: "violet" }),
    ).toEqual({ ok: false, error: "INVALID_COLOR" });
    expect(
      await createTicketState(prisma, admin, { group: "WAITING", name: "X", colorToken: "blue" }),
    ).toEqual({ ok: false, error: "INVALID" });
  });

  it("maps the active-name index to DUPLICATE_NAME after trimming and case folding", async () => {
    const { orgId, admin } = await seedOrg();
    await createTicketState(prisma, admin, {
      group: "PENDING",
      name: "Waiting on vendor",
      colorToken: "orange",
    });
    expect(
      await createTicketState(prisma, admin, {
        group: "OPEN",
        name: "waiting on vendor",
        colorToken: "blue",
      }),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
    await createTicketState(prisma, admin, {
      group: "PENDING",
      name: "Waiting",
      colorToken: "amber",
    });
    expect(
      await createTicketState(prisma, admin, {
        group: "PENDING",
        name: " waiting ",
        colorToken: "amber",
      }),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
    expect(
      await createTicketState(prisma, admin, {
        group: "PENDING",
        name: "Waitinh",
        colorToken: "amber",
      }),
    ).toMatchObject({ ok: true });
    await expectRolesValid(orgId);
  });

  it("accepts every key of STATE_COLOR_KEYS", async () => {
    const { admin } = await seedOrg();
    for (const key of STATE_COLOR_KEYS) {
      expect(
        await createTicketState(prisma, admin, {
          group: "CLOSED",
          name: `Colour ${key}`,
          colorToken: key,
        }),
      ).toMatchObject({ ok: true, state: { colorToken: key } });
    }
  });
});

describe("updateTicketState (D-03, D-14)", () => {
  it("renames and recolours, keeping the group", async () => {
    const { orgId, admin } = await seedOrg();
    const pendingId = await stateIdFor(orgId, "PENDING");
    expect(
      await updateTicketState(prisma, admin, {
        stateId: pendingId,
        name: " On hold ",
        colorToken: "red",
      }),
    ).toMatchObject({
      ok: true,
      state: { id: pendingId, name: "On hold", colorToken: "red", group: "PENDING" },
    });
    expect(
      await updateTicketState(prisma, admin, { stateId: pendingId, colorToken: "teal" }),
    ).toMatchObject({ ok: true, state: { name: "On hold", colorToken: "teal" } });
  });

  it("refuses another active state's name in any case, but allows its own name in another case", async () => {
    const { orgId, admin } = await seedOrg();
    const openId = await stateIdFor(orgId, "OPEN");
    expect(await updateTicketState(prisma, admin, { stateId: openId, name: "pending" })).toEqual({
      ok: false,
      error: "DUPLICATE_NAME",
    });
    expect(await updateTicketState(prisma, admin, { stateId: openId, name: "OPEN" })).toMatchObject(
      {
        ok: true,
        state: { name: "OPEN" },
      },
    );
  });

  it("refuses a soft-deleted state as STATE_NOT_FOUND and lets its name be reused", async () => {
    const { orgId, admin } = await seedOrg();
    const pendingId = await stateIdFor(orgId, "PENDING");
    expect(
      await deleteTicketState(prisma, admin, { stateId: pendingId, replacementStateId: null }),
    ).toMatchObject({ ok: true });
    expect(await updateTicketState(prisma, admin, { stateId: pendingId, name: "Back" })).toEqual({
      ok: false,
      error: "STATE_NOT_FOUND",
    });
    expect(
      await createTicketState(prisma, admin, {
        group: "PENDING",
        name: "Pending",
        colorToken: "amber",
      }),
    ).toMatchObject({ ok: true, state: { name: "Pending" } });
  });
});

describe("moveTicketState (D-14 reorder)", () => {
  it("swaps a state with its neighbour and renumbers the group 0..n-1", async () => {
    const { orgId, admin } = await seedOrg();
    const x = await addState(orgId, "OPEN", "X", 9);
    expect(await moveTicketState(prisma, admin, { stateId: x.id, direction: "up" })).toEqual({
      ok: true,
      position: 2,
      total: 3,
      group: "OPEN",
      name: "X",
    });
    expect(await groupOrder(orgId, "OPEN")).toEqual([
      { name: "New", sortOrder: 0 },
      { name: "X", sortOrder: 1 },
      { name: "Open", sortOrder: 2 },
    ]);
  });

  it("returns the unchanged position for the first state up and the last state down", async () => {
    const { orgId, admin } = await seedOrg();
    const newId = await stateIdFor(orgId, "NEW");
    const openId = await stateIdFor(orgId, "OPEN");
    const before = await snapshot(orgId);
    expect(await moveTicketState(prisma, admin, { stateId: newId, direction: "up" })).toEqual({
      ok: true,
      position: 1,
      total: 2,
      group: "OPEN",
      name: "New",
    });
    expect(
      await moveTicketState(prisma, admin, { stateId: openId, direction: "down" }),
    ).toMatchObject({
      ok: true,
      position: 2,
      total: 2,
    });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("orders equal sortOrder values by id before the swap", async () => {
    const { orgId, admin } = await seedOrg();
    const a = await addState(orgId, "RESOLVED", "Equal A", 7);
    const b = await addState(orgId, "RESOLVED", "Equal B", 7);
    const [low, high] = [a, b].sort((p, q) => (p.id < q.id ? -1 : 1));
    expect(
      await moveTicketState(prisma, admin, { stateId: high.id, direction: "up" }),
    ).toMatchObject({
      ok: true,
      position: 2,
      total: 3,
    });
    expect((await groupOrder(orgId, "RESOLVED")).map((s) => s.name)).toEqual([
      "Resolved",
      high.name,
      low.name,
    ]);
    expect((await groupOrder(orgId, "RESOLVED")).map((s) => s.sortOrder)).toEqual([0, 1, 2]);
  });

  it("refuses an unknown direction as INVALID", async () => {
    const { orgId, admin } = await seedOrg();
    const openId = await stateIdFor(orgId, "OPEN");
    expect(await moveTicketState(prisma, admin, { stateId: openId, direction: "left" })).toEqual({
      ok: false,
      error: "INVALID",
    });
  });
});

describe("setDefaultTicketState (D-06, K40)", () => {
  it("makes an OPEN state the default and createTicket then starts there", async () => {
    const { orgId, admin } = await seedOrg();
    const openId = await stateIdFor(orgId, "OPEN");
    const before = await config(orgId);
    expect(await setDefaultTicketState(prisma, admin, { stateId: openId })).toEqual({
      ok: true,
      defaultStateId: openId,
      name: "Open",
    });
    const after = await config(orgId);
    expect({ ...after, updatedAt: null }).toEqual({
      ...before,
      newStateId: openId,
      updatedAt: null,
    });
    const ticket = await seedTicket(orgId);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.stateId).toBe(openId);
  });

  it("refuses a PENDING state, accepts the current default unchanged, refuses a deleted one", async () => {
    const { orgId, admin } = await seedOrg();
    const pendingId = await stateIdFor(orgId, "PENDING");
    const newId = await stateIdFor(orgId, "NEW");
    expect(await setDefaultTicketState(prisma, admin, { stateId: pendingId })).toEqual({
      ok: false,
      error: "NOT_OPEN_GROUP",
    });
    const before = await snapshot(orgId);
    expect(await setDefaultTicketState(prisma, admin, { stateId: newId })).toMatchObject({
      ok: true,
      defaultStateId: newId,
    });
    expect(await snapshot(orgId)).toEqual(before);
    const extra = await addState(orgId, "OPEN", "Extra open");
    await deleteTicketState(prisma, admin, { stateId: extra.id, replacementStateId: null });
    expect(await setDefaultTicketState(prisma, admin, { stateId: extra.id })).toEqual({
      ok: false,
      error: "STATE_NOT_FOUND",
    });
  });
});

describe("deleteTicketState (D-12, K41, K42)", () => {
  it("case A: soft-deletes a state no ticket and no role uses, without a replacement", async () => {
    const { orgId, admin } = await seedOrg();
    const extra = await addState(orgId, "CLOSED", "Spam");
    expect(
      await deleteTicketState(prisma, admin, { stateId: extra.id, replacementStateId: null }),
    ).toEqual({
      ok: true,
      movedCount: 0,
      rolesMoved: false,
      name: "Spam",
      replacementName: null,
    });
    expect(
      (await prisma.ticketState.findUniqueOrThrow({ where: { id: extra.id } })).deletedAt,
    ).toBeInstanceOf(Date);
    await expectRolesValid(orgId);
  });

  it("refuses REPLACEMENT_REQUIRED without and REPLACEMENT_INVALID with a wrong replacement", async () => {
    const { orgId, admin } = await seedOrg();
    const resolvedId = await stateIdFor(orgId, "RESOLVED");
    const closedId = await stateIdFor(orgId, "CLOSED");
    await addState(orgId, "RESOLVED", "Resolved two");
    await seedTicket(orgId, { status: "RESOLVED", resolvedAt: new Date() });
    const before = await snapshot(orgId);
    expect(
      await deleteTicketState(prisma, admin, { stateId: resolvedId, replacementStateId: null }),
    ).toEqual({
      ok: false,
      error: "REPLACEMENT_REQUIRED",
    });
    expect(
      await deleteTicketState(prisma, admin, { stateId: resolvedId, replacementStateId: closedId }),
    ).toEqual({
      ok: false,
      error: "REPLACEMENT_INVALID",
    });
    expect(
      await deleteTicketState(prisma, admin, {
        stateId: resolvedId,
        replacementStateId: resolvedId,
      }),
    ).toEqual({
      ok: false,
      error: "REPLACEMENT_INVALID",
    });
    const other = await seedOrg();
    const foreign = await addState(other.orgId, "RESOLVED", "Foreign resolved");
    expect(
      await deleteTicketState(prisma, admin, {
        stateId: resolvedId,
        replacementStateId: foreign.id,
      }),
    ).toEqual({
      ok: false,
      error: "REPLACEMENT_INVALID",
    });
    expect(await snapshot(orgId)).toEqual(before);
  });

  it("refuses deleting the last CLOSED state as LAST_IN_GROUP", async () => {
    const { orgId, admin } = await seedOrg();
    const closedId = await stateIdFor(orgId, "CLOSED");
    expect(
      await deleteTicketState(prisma, admin, { stateId: closedId, replacementStateId: null }),
    ).toEqual({
      ok: false,
      error: "LAST_IN_GROUP",
    });
  });

  it("lets PENDING become empty, and a second delete is STATE_NOT_FOUND", async () => {
    const { orgId, admin } = await seedOrg();
    const pendingId = await stateIdFor(orgId, "PENDING");
    expect(
      await deleteTicketState(prisma, admin, { stateId: pendingId, replacementStateId: null }),
    ).toMatchObject({
      ok: true,
      movedCount: 0,
    });
    expect((await listActiveStates(prisma, orgId)).filter((s) => s.group === "PENDING")).toEqual(
      [],
    );
    const before = await snapshot(orgId);
    expect(
      await deleteTicketState(prisma, admin, { stateId: pendingId, replacementStateId: null }),
    ).toEqual({
      ok: false,
      error: "STATE_NOT_FOUND",
    });
    expect(await snapshot(orgId)).toEqual(before);
    await expectRolesValid(orgId);
  });

  for (const key of ["OPEN", "PENDING", "RESOLVED", "CLOSED"] as const) {
    it(`a same-group move from ${key} changes only stateId (K41)`, async () => {
      const { orgId, admin } = await seedOrg();
      const fromId = await stateIdFor(orgId, key);
      const replacement = await addState(orgId, key, `${key} two`);
      const ticket = await seedTicket(orgId, { status: key });
      const t = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n));
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          resolvedAt: key === "RESOLVED" || key === "CLOSED" ? t(1) : null,
          isAtRisk: true,
          isBreached: true,
          firstResponseDueAt: t(2),
          resolutionDueAt: t(3),
          slaPausedAt: key === "PENDING" ? t(4) : null,
          slaPausedMs: BigInt(12_345),
        },
      });
      const cols = {
        resolvedAt: true,
        isAtRisk: true,
        isBreached: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
        slaPausedAt: true,
        slaPausedMs: true,
      } as const;
      const before = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: cols,
      });
      expect(
        await deleteTicketState(prisma, admin, {
          stateId: fromId,
          replacementStateId: replacement.id,
        }),
      ).toMatchObject({ ok: true, movedCount: 1 });
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { ...cols, stateId: true },
      });
      expect(after).toEqual({ ...before, stateId: replacement.id });
      await expectRolesValid(orgId);
    });
  }
});

describe("listStatesForSettings (D-01, UI-SPEC 1a)", () => {
  it("returns the states in group and sort order with ticket counts, roles and the default", async () => {
    const { orgId, admin, member, removed } = await seedOrg();
    await seedTicket(orgId, { status: "PENDING" });
    await seedTicket(orgId, { status: "PENDING" });
    const list = await listStatesForSettings(prisma, admin);
    if (!list.ok) throw new Error("expected ok");
    expect(list.isAdmin).toBe(true);
    expect(list.defaultStateId).toBe(await stateIdFor(orgId, "NEW"));
    expect(list.states.map((s) => [s.name, s.group, s.ticketCount, s.roles])).toEqual([
      ["New", "OPEN", 0, ["new"]],
      ["Open", "OPEN", 0, ["reopen"]],
      ["Pending", "PENDING", 2, []],
      ["Resolved", "RESOLVED", 0, ["resolve"]],
      ["Closed", "CLOSED", 0, ["autoClose", "mergeClose"]],
    ]);
    expect(await listStatesForSettings(prisma, member)).toMatchObject({ ok: true, isAdmin: false });
    expect(await listStatesForSettings(prisma, removed)).toEqual({
      ok: false,
      error: "membership_ended",
    });
  });

  it("never returns another organization's states", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const listB = await listStatesForSettings(prisma, b.admin);
    if (!listB.ok) throw new Error("expected ok");
    const idsA = new Set((await listActiveStates(prisma, a.orgId)).map((s) => s.id));
    expect(listB.states.some((s) => idsA.has(s.id))).toBe(false);
  });
});

describe("the admin gate and organization isolation, per operation (D-01, AIDA-97)", () => {
  type Op = (actor: { userId: string; orgId: string }, orgId: string) => Promise<unknown>;

  async function expectGate(op: Op) {
    const a = await seedOrg();
    const b = await seedOrg();
    const before = await snapshot(a.orgId);
    expect(await op(a.removed, a.orgId)).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await op(a.member, a.orgId)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await op(b.admin, a.orgId)).toEqual({ ok: false, error: "STATE_NOT_FOUND" });
    expect(await snapshot(a.orgId)).toEqual(before);
  }

  it("createTicketState refuses a removed member and a member (org B creates only in B)", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const before = await snapshot(a.orgId);
    const raw = { group: "OPEN", name: "Gate", colorToken: "blue" };
    expect(await createTicketState(prisma, a.removed, raw)).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    expect(await createTicketState(prisma, a.member, raw)).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(
      await createTicketState(prisma, { userId: b.admin.userId, orgId: a.orgId }, raw),
    ).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    expect(await snapshot(a.orgId)).toEqual(before);
  });

  it("updateTicketState", async () => {
    await expectGate(async (actor, orgId) =>
      updateTicketState(prisma, actor, {
        stateId: await stateIdFor(orgId, "OPEN"),
        name: "Hacked",
      }),
    );
  });

  it("moveTicketState", async () => {
    await expectGate(async (actor, orgId) =>
      moveTicketState(prisma, actor, { stateId: await stateIdFor(orgId, "OPEN"), direction: "up" }),
    );
  });

  it("setDefaultTicketState", async () => {
    await expectGate(async (actor, orgId) =>
      setDefaultTicketState(prisma, actor, { stateId: await stateIdFor(orgId, "OPEN") }),
    );
  });

  it("deleteTicketState", async () => {
    await expectGate(async (actor, orgId) =>
      deleteTicketState(prisma, actor, {
        stateId: await stateIdFor(orgId, "PENDING"),
        replacementStateId: null,
      }),
    );
  });

  it("listStatesForSettings refuses a removed member and an outsider", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    expect(await listStatesForSettings(prisma, a.removed)).toEqual({
      ok: false,
      error: "membership_ended",
    });
    expect(await listStatesForSettings(prisma, { userId: b.admin.userId, orgId: a.orgId })).toEqual(
      {
        ok: false,
        error: "membership_ended",
      },
    );
  });
});
