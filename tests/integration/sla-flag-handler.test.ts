import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { setUnassignedSetting } from "@/lib/notifications/preferences";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { SLA_PASS_ROW_CAP, type SlaFlagPass, slaFlagHandler } from "@/lib/worker/jobs/sla-flag";
import {
  type LegacyStatusKey,
  type MemberRole,
  seedOrgWithMembers,
  stateIdFor,
} from "../support/inbox-fixtures";

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
  /** Phase 10 (plan 10-06): the assignee the SLA notifications go to. */
  assigneeId?: string | null;
  createdAt?: Date;
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
      assigneeId: overrides.assigneeId ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
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

// Phase 10, plan 10-06 Task 3 (AIDA-44, V-09, V-30, V-28, D-18): both passes return the rows they
// flipped and notify for exactly those rows in the pass transaction. Event keys are
// sla-breached:{ticketId}:{now ISO} and sla-at-risk:{ticketId}:{now ISO}, with one now per run.
// Every case passes its own now and asserts only on its own organization: the handler is global.

/** One organization with members in the given roles and a contact for its tickets. */
async function seedOrgWithMembersAndContact(roles: readonly MemberRole[]) {
  const { orgId, users } = await seedOrgWithMembers(prisma, roles);
  const contact = await prisma.contact.create({
    data: { organizationId: orgId, email: `sla-${randomUUID()}@sla-flag.test` },
  });
  return { orgId, users, contactId: contact.id };
}

function slaNotifications(orgId: string) {
  return prisma.notification.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "asc" }, { type: "asc" }, { recipientUserId: "asc" }],
  });
}

/** Overdue on first response by five minutes; resolution far away. */
function overdue(now: Date) {
  return {
    firstResponseDueAt: new Date(now.getTime() - 5 * MIN),
    resolutionDueAt: new Date(now.getTime() + 8 * 60 * MIN),
  };
}

/** Due on first response in ten minutes of a 60-minute target (inside the 12-minute window). */
function soon(now: Date) {
  return {
    firstResponseDueAt: new Date(now.getTime() + 10 * MIN),
    resolutionDueAt: new Date(now.getTime() + 8 * 60 * MIN),
    firstResponseTargetMinutes: 60,
  };
}

describe("slaFlagHandler notifications (plan 10-06, V-09, V-30)", () => {
  it("a ticket entering the at-risk window gets one SLA_AT_RISK for its assignee; a second run adds nothing", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const now = new Date(Date.now());
    const ticket = await seedTicket(orgId, contactId, 1, { ...soon(now), assigneeId: member.id });

    await slaFlagHandler(undefined, { now });
    let rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type, r.eventKey, r.entityId])).toEqual([
      [member.id, "SLA_AT_RISK", `sla-at-risk:${ticket.id}:${now.toISOString()}`, ticket.id],
    ]);
    expect(rows[0]).toMatchObject({
      actorUserId: null,
      entityType: "ticket",
      unassignedFallback: false,
    });

    await slaFlagHandler(undefined, { now: new Date(now.getTime() + 1000) });
    rows = await slaNotifications(orgId);
    expect(rows).toHaveLength(1);
  });

  it("a ticket past its due time that was never at risk gets one SLA_BREACHED and no SLA_AT_RISK", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const now = new Date(Date.now());
    const ticket = await seedTicket(orgId, contactId, 1, {
      ...overdue(now),
      assigneeId: member.id,
    });

    await slaFlagHandler(undefined, { now });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect({ isBreached: row.isBreached, isAtRisk: row.isAtRisk }).toEqual({
      isBreached: true,
      isAtRisk: true,
    });
    const rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type, r.eventKey])).toEqual([
      [member.id, "SLA_BREACHED", `sla-breached:${ticket.id}:${now.toISOString()}`],
    ]);
  });

  it("an at-risk ticket that later breaches gets one SLA_AT_RISK, then one SLA_BREACHED", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const t1 = new Date(Date.now());
    const ticket = await seedTicket(orgId, contactId, 1, { ...soon(t1), assigneeId: member.id });

    await slaFlagHandler(undefined, { now: t1 });
    const t2 = new Date(t1.getTime() + 11 * MIN);
    await slaFlagHandler(undefined, { now: t2 });
    await slaFlagHandler(undefined, { now: new Date(t2.getTime() + MIN) });

    const rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.type, r.eventKey])).toEqual([
      ["SLA_AT_RISK", `sla-at-risk:${ticket.id}:${t1.toISOString()}`],
      ["SLA_BREACHED", `sla-breached:${ticket.id}:${t2.toISOString()}`],
    ]);
    expect(rows.every((r) => r.recipientUserId === member.id)).toBe(true);
  });

  it("one run shares its now between both passes: a breach and an at-risk ticket carry the same timestamp", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const now = new Date(Date.now());
    const late = await seedTicket(orgId, contactId, 1, { ...overdue(now), assigneeId: member.id });
    const close = await seedTicket(orgId, contactId, 2, { ...soon(now), assigneeId: member.id });

    await slaFlagHandler(undefined, { now });
    const keys = (await slaNotifications(orgId)).map((r) => r.eventKey).sort();
    expect(keys).toEqual(
      [
        `sla-at-risk:${close.id}:${now.toISOString()}`,
        `sla-breached:${late.id}:${now.toISOString()}`,
      ].sort(),
    );
  });

  it("afterPassUpdate throwing leaves neither flag nor notification; the next run emits exactly one", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const now = new Date(Date.now());
    const ticket = await seedTicket(orgId, contactId, 1, {
      ...overdue(now),
      assigneeId: member.id,
    });

    await expect(
      slaFlagHandler(undefined, {
        now,
        afterPassUpdate: (_tx, pass) => {
          if (pass === "breach") throw new Error("forced failure after the breach update");
        },
      }),
    ).rejects.toThrow("forced failure after the breach update");
    const rolledBack = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect({ isBreached: rolledBack.isBreached, isAtRisk: rolledBack.isAtRisk }).toEqual({
      isBreached: false,
      isAtRisk: false,
    });
    expect(await slaNotifications(orgId)).toEqual([]);

    const retryAt = new Date(now.getTime() + 1000);
    await slaFlagHandler(undefined, { now: retryAt });
    const rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.type, r.eventKey])).toEqual([
      ["SLA_BREACHED", `sla-breached:${ticket.id}:${retryAt.toISOString()}`],
    ]);
    await slaFlagHandler(undefined, { now: new Date(retryAt.getTime() + 1000) });
    expect(await slaNotifications(orgId)).toHaveLength(1);
  });

  it("after a reset by a priority change (the flag reset of runTicketMutation) a re-flag at a later now emits a second notification", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["admin", "member"]);
    const [admin, member] = users;
    const t1 = new Date(Date.now());
    // Created ten days ago, so the deadlines recomputed by the priority change are still past.
    const ticket = await seedTicket(orgId, contactId, 1, {
      ...overdue(t1),
      assigneeId: member.id,
      createdAt: new Date(t1.getTime() - 10 * 24 * 60 * MIN),
    });

    await slaFlagHandler(undefined, { now: t1 });
    const reset = await runTicketMutation({
      actor: { userId: admin.id, orgId },
      ticketIds: [ticket.id],
      op: { kind: "priority", priority: "HIGH" },
      mode: "single",
    });
    expect(reset).toEqual({ ok: true, count: 1, batchId: null });
    const cleared = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect({ isBreached: cleared.isBreached, isAtRisk: cleared.isAtRisk }).toEqual({
      isBreached: false,
      isAtRisk: false,
    });

    const t2 = new Date(t1.getTime() + MIN);
    await slaFlagHandler(undefined, { now: t2 });
    const rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type, r.eventKey])).toEqual([
      [member.id, "SLA_BREACHED", `sla-breached:${ticket.id}:${t1.toISOString()}`],
      [member.id, "SLA_BREACHED", `sla-breached:${ticket.id}:${t2.toISOString()}`],
    ]);
  });

  it("boundaries: a due time equal to now is not breached and one millisecond earlier is", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const now = new Date(Date.now());
    const far = new Date(now.getTime() + 8 * 60 * MIN);
    const equal = await seedTicket(orgId, contactId, 1, {
      firstResponseDueAt: new Date(now.getTime()),
      resolutionDueAt: far,
      assigneeId: member.id,
    });
    const earlier = await seedTicket(orgId, contactId, 2, {
      firstResponseDueAt: new Date(now.getTime() - 1),
      resolutionDueAt: far,
      assigneeId: member.id,
    });

    await slaFlagHandler(undefined, { now });
    const rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.type, r.entityId])).toEqual([["SLA_BREACHED", earlier.id]]);
    const equalRow = await prisma.ticket.findUniqueOrThrow({ where: { id: equal.id } });
    expect({ isBreached: equalRow.isBreached, isAtRisk: equalRow.isAtRisk }).toEqual({
      isBreached: false,
      isAtRisk: false,
    });
  });

  it("boundaries: remaining time of exactly 20 percent of the target is at risk, one millisecond more is not", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const [, member] = users;
    const now = new Date(Date.now());
    const far = new Date(now.getTime() + 8 * 60 * MIN);
    // 60-minute target: 20 percent is exactly 12 minutes.
    const atEdge = await seedTicket(orgId, contactId, 1, {
      firstResponseDueAt: new Date(now.getTime() + 12 * MIN),
      resolutionDueAt: far,
      firstResponseTargetMinutes: 60,
      assigneeId: member.id,
    });
    const above = await seedTicket(orgId, contactId, 2, {
      firstResponseDueAt: new Date(now.getTime() + 12 * MIN + 1),
      resolutionDueAt: far,
      firstResponseTargetMinutes: 60,
      assigneeId: member.id,
    });

    await slaFlagHandler(undefined, { now });
    const rows = await slaNotifications(orgId);
    expect(rows.map((r) => [r.type, r.entityId])).toEqual([["SLA_AT_RISK", atEdge.id]]);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: above.id } })).isAtRisk).toBe(
      false,
    );
  });

  it("an unassigned breached ticket notifies every owner and admin (unassignedFallback), not the opted-out admin or a member", async () => {
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact([
      "owner",
      "admin",
      "admin",
      "member",
    ]);
    const [owner, admin, optedOut, member] = users;
    await setUnassignedSetting(orgId, optedOut.id, false);
    const now = new Date(Date.now());
    const ticket = await seedTicket(orgId, contactId, 1, overdue(now));

    await slaFlagHandler(undefined, { now });
    const rows = await slaNotifications(orgId);
    expect(new Set(rows.map((r) => r.recipientUserId))).toEqual(new Set([owner.id, admin.id]));
    expect(
      rows.every(
        (r) =>
          r.type === "SLA_BREACHED" &&
          r.unassignedFallback === true &&
          r.eventKey === `sla-breached:${ticket.id}:${now.toISOString()}`,
      ),
    ).toBe(true);
    expect(rows.some((r) => r.recipientUserId === member.id)).toBe(false);
  });

  it("fan-out: an unassigned breach in an organization with one owner and 60 admins writes 61 rows in the pass transaction (duration recorded)", async () => {
    const roles: MemberRole[] = ["owner", ...Array.from({ length: 60 }, () => "admin" as const)];
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(roles);
    const now = new Date(Date.now());
    const ticket = await seedTicket(orgId, contactId, 1, overdue(now));

    let passStart = 0;
    let passEmitted = 0;
    let inserted = -1;
    const started = performance.now();
    await slaFlagHandler(undefined, {
      now,
      onPassTransaction: (_tx, pass) => {
        if (pass === "breach") passStart = performance.now();
      },
      afterPassUpdate: async (tx, pass) => {
        if (pass !== "breach") return;
        passEmitted = performance.now();
        // Inside the pass transaction, before its commit: every row is already written.
        inserted = await tx.notification.count({ where: { organizationId: orgId } });
      },
    });
    const total = performance.now() - started;
    const breachPassMs = passEmitted - passStart;
    console.log(
      `[10-06 fan-out] ${users.length} recipients, breach pass (lock, update, emit) ${breachPassMs.toFixed(1)} ms, handler ${total.toFixed(1)} ms`,
    );

    expect(inserted).toBe(61);
    const rows = await slaNotifications(orgId);
    expect(rows).toHaveLength(61);
    expect(new Set(rows.map((r) => r.recipientUserId))).toEqual(new Set(users.map((u) => u.id)));
    expect(
      rows.every(
        (r) =>
          r.unassignedFallback && r.eventKey === `sla-breached:${ticket.id}:${now.toISOString()}`,
      ),
    ).toBe(true);
  });

  it("two organizations: each assignee is notified only for its own organization's tickets", async () => {
    const a = await seedOrgWithMembersAndContact(["owner", "member"]);
    const b = await seedOrgWithMembersAndContact(["owner", "member"]);
    const now = new Date(Date.now());
    const ticketA = await seedTicket(a.orgId, a.contactId, 1, {
      ...overdue(now),
      assigneeId: a.users[1].id,
    });
    const ticketB = await seedTicket(b.orgId, b.contactId, 1, {
      ...overdue(now),
      assigneeId: b.users[1].id,
    });

    await slaFlagHandler(undefined, { now });
    const rowsA = await slaNotifications(a.orgId);
    const rowsB = await slaNotifications(b.orgId);
    expect(rowsA.map((r) => [r.recipientUserId, r.entityId])).toEqual([
      [a.users[1].id, ticketA.id],
    ]);
    expect(rowsB.map((r) => [r.recipientUserId, r.entityId])).toEqual([
      [b.users[1].id, ticketB.id],
    ]);
    expect(
      await prisma.notification.count({
        where: { recipientUserId: { in: [a.users[1].id, b.users[1].id] } },
      }),
    ).toBe(2);
  });
});

// K167 (c-WR-02): each pass is bounded. It discovers the organizations with candidates by a plain
// read, then runs one transaction per organization, which locks at most the row cap of that
// organization's candidates (id order, SKIP LOCKED), flips them and notifies exactly the flipped
// rows inside the same transaction. The remainder waits for the next run. A failure in one
// organization's transaction rolls back that organization only; the handler still rethrows it.
describe("slaFlagHandler is bounded: one transaction per organization and a row cap (K167)", () => {
  type LockCall = { pass: SlaFlagPass; orgId: string; ids: string[]; txid: string };

  async function txid(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<{ txid: string }[]>`SELECT txid_current()::text AS txid`;
    return row?.txid ?? "";
  }

  async function overdueTickets(
    orgId: string,
    contactId: string,
    count: number,
    now: Date,
    assigneeId: string,
  ) {
    const ids: string[] = [];
    for (let n = 1; n <= count; n += 1) {
      ids.push((await seedTicket(orgId, contactId, n, { ...overdue(now), assigneeId })).id);
    }
    return ids.sort();
  }

  async function breached(orgId: string) {
    const rows = await prisma.ticket.findMany({
      where: { organizationId: orgId, isBreached: true },
      select: { id: true },
    });
    return rows.map((r) => r.id).sort();
  }

  it("a backlog above the cap: the first run flips the cap's lowest ids of each organization in its own transaction and notifies exactly those; the next run flips the rest; a third adds nothing", async () => {
    const a = await seedOrgWithMembersAndContact(["owner", "member"]);
    const b = await seedOrgWithMembersAndContact(["owner", "member"]);
    const now = new Date(Date.now());
    const idsA = await overdueTickets(a.orgId, a.contactId, 5, now, a.users[1].id);
    const idsB = await overdueTickets(b.orgId, b.contactId, 2, now, b.users[1].id);
    const ours = new Set([a.orgId, b.orgId]);

    const locks: LockCall[] = [];
    const inTx = new Map<string, number>();
    await slaFlagHandler(undefined, {
      now,
      rowCap: 3,
      afterPassLock: async (tx, pass, ids, orgId) => {
        if (orgId && ours.has(orgId)) locks.push({ pass, orgId, ids, txid: await txid(tx) });
      },
      afterPassUpdate: async (tx, pass, orgId) => {
        if (pass !== "breach" || !orgId || !ours.has(orgId)) return;
        // Inside the organization's own transaction, before its commit.
        inTx.set(orgId, await tx.notification.count({ where: { organizationId: orgId } }));
      },
    });

    const breachLocks = locks.filter((l) => l.pass === "breach");
    expect(breachLocks.map((l) => [l.orgId, l.ids])).toEqual(
      [
        [a.orgId, idsA.slice(0, 3)],
        [b.orgId, idsB],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(new Set(breachLocks.map((l) => l.txid)).size).toBe(2);
    expect(inTx.get(a.orgId)).toBe(3);
    expect(inTx.get(b.orgId)).toBe(2);
    expect(await breached(a.orgId)).toEqual(idsA.slice(0, 3));
    expect(await breached(b.orgId)).toEqual(idsB);
    const keys = (rows: { eventKey: string }[]) => rows.map((r) => r.eventKey).sort();
    expect(keys(await slaNotifications(a.orgId))).toEqual(
      idsA
        .slice(0, 3)
        .map((id) => `sla-breached:${id}:${now.toISOString()}`)
        .sort(),
    );
    expect(await slaNotifications(b.orgId)).toHaveLength(2);

    const next = new Date(now.getTime() + 1000);
    await slaFlagHandler(undefined, { now: next, rowCap: 3 });
    expect(await breached(a.orgId)).toEqual(idsA);
    expect(keys(await slaNotifications(a.orgId))).toEqual(
      [
        ...idsA.slice(0, 3).map((id) => `sla-breached:${id}:${now.toISOString()}`),
        ...idsA.slice(3).map((id) => `sla-breached:${id}:${next.toISOString()}`),
      ].sort(),
    );

    await slaFlagHandler(undefined, { now: new Date(next.getTime() + 1000), rowCap: 3 });
    expect(await slaNotifications(a.orgId)).toHaveLength(5);
    expect(await slaNotifications(b.orgId)).toHaveLength(2);
  });

  it("the shipped cap: 501 overdue tickets of one organization flip 500 in the first run (500 notifications) and the last one in the next", async () => {
    expect(SLA_PASS_ROW_CAP).toBe(500);
    const { orgId, users, contactId } = await seedOrgWithMembersAndContact(["owner", "member"]);
    const now = new Date(Date.now());
    const stateId = await stateIdFor(orgId, "OPEN");
    await prisma.ticket.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        organizationId: orgId,
        contactId,
        number: i + 1,
        statusToken: randomUUID(),
        subject: `SLA cap test #${i + 1}`,
        stateId,
        priority: "NORMAL" as const,
        firstResponseTargetMinutes: 60,
        resolutionTargetMinutes: 480,
        ...overdue(now),
        assigneeId: users[1].id,
      })),
    });

    const started = performance.now();
    await slaFlagHandler(undefined, { now });
    console.log(`[K167 cap] 501 overdue, first run ${(performance.now() - started).toFixed(1)} ms`);
    expect(await breached(orgId)).toHaveLength(500);
    expect(await slaNotifications(orgId)).toHaveLength(500);

    await slaFlagHandler(undefined, { now: new Date(now.getTime() + 1000) });
    expect(await breached(orgId)).toHaveLength(501);
    expect(await slaNotifications(orgId)).toHaveLength(501);
  });

  it("a failure in one organization's transaction rolls back that organization only; the other commits its flags and notifications; the handler rethrows; the next run flags the first", async () => {
    const a = await seedOrgWithMembersAndContact(["owner", "member"]);
    const b = await seedOrgWithMembersAndContact(["owner", "member"]);
    const now = new Date(Date.now());
    const [ticketA] = await overdueTickets(a.orgId, a.contactId, 1, now, a.users[1].id);
    const [ticketB] = await overdueTickets(b.orgId, b.contactId, 1, now, b.users[1].id);

    await expect(
      slaFlagHandler(undefined, {
        now,
        afterPassUpdate: (_tx, pass, orgId) => {
          if (pass === "breach" && orgId === a.orgId) throw new Error("forced failure in org A");
        },
      }),
    ).rejects.toThrow("forced failure in org A");
    expect(await breached(b.orgId)).toEqual([ticketB]);
    expect(await slaNotifications(b.orgId)).toHaveLength(1);
    expect(await breached(a.orgId)).toEqual([]);
    expect(await slaNotifications(a.orgId)).toEqual([]);
    const rowA = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketA } });
    // Its at-risk pass is skipped in the same run, so the failed breach is not turned into at-risk.
    expect(rowA.isAtRisk).toBe(false);

    await slaFlagHandler(undefined, { now: new Date(now.getTime() + 1000) });
    expect(await breached(a.orgId)).toEqual([ticketA]);
    expect(await slaNotifications(a.orgId)).toHaveLength(1);
  });
});
