// Phase 11, plan 11-04: auto-close of resolved tickets (AIDA-51, D-15 to D-19), on a real
// Postgres through Testcontainers. Nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  AUTO_CLOSE_DAYS_KEY,
  AUTO_CLOSE_ENABLED_AT_KEY,
  readAutoCloseSettings,
  saveAutoCloseDays,
} from "@/lib/tickets/auto-close-settings";
import { type AutoCloseHandlerOptions, autoCloseHandler } from "@/lib/worker/jobs/auto-close";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

async function seedAdminOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
  const [owner, admin, member] = users;
  return {
    orgId,
    owner: { userId: owner.id, orgId },
    admin: { userId: admin.id, orgId },
    member: { userId: member.id, orgId },
    adminMemberId: admin.memberId,
  };
}

/** Writes both settings directly (fixtures may backdate them; production writes go through save). */
async function setAutoClose(orgId: string, days: string, enabledAt: Date | null) {
  await prisma.setting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: AUTO_CLOSE_DAYS_KEY } },
    create: { organizationId: orgId, key: AUTO_CLOSE_DAYS_KEY, value: days },
    update: { value: days },
  });
  if (enabledAt === null) {
    await prisma.setting.deleteMany({
      where: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY },
    });
  } else {
    await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY } },
      create: {
        organizationId: orgId,
        key: AUTO_CLOSE_ENABLED_AT_KEY,
        value: enabledAt.toISOString(),
      },
      update: { value: enabledAt.toISOString() },
    });
  }
}

async function storedSettings(orgId: string) {
  const rows = await prisma.setting.findMany({
    where: { organizationId: orgId, key: { in: [AUTO_CLOSE_DAYS_KEY, AUTO_CLOSE_ENABLED_AT_KEY] } },
  });
  return {
    days: rows.find((r) => r.key === AUTO_CLOSE_DAYS_KEY)?.value ?? null,
    enabledAt: rows.find((r) => r.key === AUTO_CLOSE_ENABLED_AT_KEY)?.value ?? null,
  };
}

async function resolvedTicket(orgId: string, resolvedAt: Date | null) {
  return seedTicket(orgId, { status: "RESOLVED", resolvedAt });
}

async function ticketState(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, resolvedAt: true },
  });
}

function autoClosedRows(ticketId: string) {
  return prisma.ticketAuditEvent.findMany({ where: { ticketId, action: "AUTO_CLOSED" } });
}

/** Runs the handler with a captured log; returns the result and this organization's log lines. */
async function runJob(
  orgId: string,
  now: Date,
  onCloseTransaction?: AutoCloseHandlerOptions["onCloseTransaction"],
) {
  const lines: string[] = [];
  const result = await autoCloseHandler(undefined, {
    now,
    log: (line) => lines.push(line),
    onCloseTransaction,
  });
  return {
    result,
    org: result.organizations.find((o) => o.orgId === orgId),
    lines: lines.filter((l) => l.includes(`org=${orgId}`)),
  };
}

describe("saveAutoCloseDays (D-15, D-01)", () => {
  it("sets enabledAt from 0, keeps it between positive values, clears it at 0, stores canonical decimals", async () => {
    const { orgId, admin } = await seedAdminOrg();
    const t1 = new Date("2026-10-01T10:00:00.000Z");
    const t2 = new Date("2026-10-05T10:00:00.000Z");
    const t3 = new Date("2026-10-09T10:00:00.000Z");

    expect(await saveAutoCloseDays(prisma, admin, "7", { now: t1 })).toEqual({
      ok: true,
      days: 7,
      enabledAt: t1,
    });
    expect(await storedSettings(orgId)).toEqual({ days: "7", enabledAt: t1.toISOString() });

    expect(await saveAutoCloseDays(prisma, admin, "14", { now: t2 })).toEqual({
      ok: true,
      days: 14,
      enabledAt: t1,
    });
    expect(await storedSettings(orgId)).toEqual({ days: "14", enabledAt: t1.toISOString() });

    expect(await saveAutoCloseDays(prisma, admin, "0", { now: t3 })).toEqual({
      ok: true,
      days: 0,
      enabledAt: null,
    });
    expect(await storedSettings(orgId)).toEqual({ days: "0", enabledAt: null });

    const t4 = new Date("2026-10-10T10:00:00.000Z");
    expect(await saveAutoCloseDays(prisma, admin, " 007 ", { now: t4 })).toEqual({
      ok: true,
      days: 7,
      enabledAt: t4,
    });
    expect(await storedSettings(orgId)).toEqual({ days: "7", enabledAt: t4.toISOString() });
    expect(await readAutoCloseSettings(prisma, orgId)).toEqual({
      days: 7,
      enabledAt: t4,
      invalid: false,
    });
  });

  it("refuses 366, 1.5 and the empty string with INVALID and changes nothing", async () => {
    const { orgId, owner } = await seedAdminOrg();
    const t1 = new Date("2026-10-01T10:00:00.000Z");
    await saveAutoCloseDays(prisma, owner, "5", { now: t1 });
    for (const raw of ["366", "1.5", ""]) {
      expect(await saveAutoCloseDays(prisma, owner, raw)).toEqual({ ok: false, error: "INVALID" });
    }
    expect(await storedSettings(orgId)).toEqual({ days: "5", enabledAt: t1.toISOString() });
  });

  it("refuses a member with NOT_ALLOWED and a removed member with MEMBERSHIP_ENDED", async () => {
    const { orgId, admin, member, adminMemberId } = await seedAdminOrg();
    expect(await saveAutoCloseDays(prisma, member, "7")).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    await prisma.member.delete({ where: { id: adminMemberId } });
    expect(await saveAutoCloseDays(prisma, admin, "7")).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    expect(await storedSettings(orgId)).toEqual({ days: null, enabledAt: null });
  });
});

describe("autoCloseHandler (D-16 as amended, D-17, D-18, D-19)", () => {
  it("closes resolved tickets whose period has passed, whatever messages they carry", async () => {
    const now = new Date();
    const { orgId, admin } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));

    const old = await resolvedTicket(orgId, daysAgo(now, 10));
    const recent = await resolvedTicket(orgId, daysAgo(now, 2));
    const withAgentReply = await resolvedTicket(orgId, daysAgo(now, 10));
    const withNote = await resolvedTicket(orgId, daysAgo(now, 10));
    const withAutoMail = await resolvedTicket(orgId, daysAgo(now, 10));

    const base = { organizationId: orgId, bodyMarkdown: "x", bodyHtml: "<p>x</p>" };
    await prisma.message.create({
      data: {
        ...base,
        ticketId: withAgentReply.id,
        direction: "OUTBOUND",
        visibility: "PUBLIC",
        authorUserId: admin.userId,
        createdAt: daysAgo(now, 1),
      },
    });
    await prisma.message.create({
      data: {
        ...base,
        ticketId: withNote.id,
        direction: "OUTBOUND",
        visibility: "INTERNAL",
        authorUserId: admin.userId,
        createdAt: daysAgo(now, 1),
      },
    });
    await prisma.message.create({
      data: {
        ...base,
        ticketId: withAutoMail.id,
        direction: "INBOUND",
        visibility: "PUBLIC",
        triggeredReopen: false,
        createdAt: daysAgo(now, 1),
      },
    });

    const { org, lines } = await runJob(orgId, now);
    expect(org).toMatchObject({ closed: 4, skippedWithoutResolvedAt: 0, stoppedOff: false });
    expect(lines).toEqual([`[auto-close] org=${orgId} closed=4 skippedWithoutResolvedAt=0`]);

    for (const t of [old, withAgentReply, withNote, withAutoMail]) {
      expect((await ticketState(t.id)).status).toBe("CLOSED");
    }
    expect((await ticketState(recent.id)).status).toBe("RESOLVED");
    expect(await autoClosedRows(recent.id)).toHaveLength(0);
  });

  it("does not close a ticket resolved long ago when auto-close was enabled just now (D-15)", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", now);
    const t = await resolvedTicket(orgId, daysAgo(now, 30));

    const { org } = await runJob(orgId, now);
    expect(org?.closed).toBe(0);
    expect((await ticketState(t.id)).status).toBe("RESOLVED");
  });

  it("keeps resolvedAt, writes exactly one SYSTEM AUTO_CLOSED row and adds nothing when run again", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const resolvedAt = daysAgo(now, 10);
    const t = await resolvedTicket(orgId, resolvedAt);

    await runJob(orgId, now);
    const after = await ticketState(t.id);
    expect(after.status).toBe("CLOSED");
    expect(after.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString());

    const rows = await autoClosedRows(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: orgId,
      actorType: "SYSTEM",
      actorUserId: null,
      action: "AUTO_CLOSED",
      before: { status: "RESOLVED" },
      after: { status: "CLOSED" },
      batchId: null,
    });

    const second = await runJob(orgId, now);
    expect(second.org?.closed).toBe(0);
    expect(await autoClosedRows(t.id)).toHaveLength(1);
  });

  it("closes at most 100 per organization per run, oldest quiet start first, ties by id (D-18)", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 300));

    const first = await resolvedTicket(orgId, daysAgo(now, 200));
    const contact = await prisma.ticket.findUniqueOrThrow({
      where: { id: first.id },
      select: { contactId: true },
    });
    // 98 tickets with distinct resolvedAt (200 to 103 days ago, oldest first), then 7 that share
    // one resolvedAt newer than all of them: the 100-ticket boundary falls inside the tie group.
    const tieAt = daysAgo(now, 50);
    const rows = [];
    for (let i = 1; i < 105; i += 1) {
      rows.push({
        organizationId: orgId,
        contactId: contact.contactId,
        number: 10_000 + i,
        statusToken: randomUUID(),
        subject: `Cap fixture ${i}`,
        status: "RESOLVED" as const,
        priority: "NORMAL" as const,
        firstResponseTargetMinutes: 60,
        resolutionTargetMinutes: 480,
        firstResponseDueAt: now,
        resolutionDueAt: now,
        resolvedAt: i < 98 ? daysAgo(now, 200 - i) : tieAt,
      });
    }
    await prisma.ticket.createMany({ data: rows });

    const distinct = await prisma.ticket.findMany({
      where: { organizationId: orgId, resolvedAt: { lt: tieAt } },
      orderBy: { resolvedAt: "asc" },
      select: { id: true },
    });
    expect(distinct).toHaveLength(98);
    const ties = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Ticket" WHERE "organizationId" = ${orgId} AND "resolvedAt" = ${tieAt}
      ORDER BY "id"
    `;
    expect(ties).toHaveLength(7);
    const expectedFirst = [...distinct.map((r) => r.id), ...ties.slice(0, 2).map((r) => r.id)];

    const run1 = await runJob(orgId, now);
    expect(run1.org?.closed).toBe(100);
    const closedAfter1 = await prisma.ticket.findMany({
      where: { organizationId: orgId, status: "CLOSED" },
      select: { id: true },
    });
    expect(new Set(closedAfter1.map((r) => r.id))).toEqual(new Set(expectedFirst));

    const run2 = await runJob(orgId, now);
    expect(run2.org?.closed).toBe(5);
    expect(
      await prisma.ticket.count({ where: { organizationId: orgId, status: "RESOLVED" } }),
    ).toBe(0);
    expect(
      await prisma.ticketAuditEvent.count({
        where: { organizationId: orgId, action: "AUTO_CLOSED" },
      }),
    ).toBe(105);
  });

  it("closes nothing at 0, without a setting row, with a stored 'abc' or a positive value without enabledAt", async () => {
    const now = new Date();
    const cases: Array<{ days: string | null; enabledAt: Date | null; invalid: boolean }> = [
      { days: "0", enabledAt: null, invalid: false },
      { days: null, enabledAt: null, invalid: false },
      { days: "abc", enabledAt: daysAgo(now, 30), invalid: true },
      { days: "7", enabledAt: null, invalid: true },
    ];
    for (const c of cases) {
      const { orgId } = await seedAdminOrg();
      if (c.days !== null) await setAutoClose(orgId, c.days, c.enabledAt);
      const t = await resolvedTicket(orgId, daysAgo(now, 100));

      const lines: string[] = [];
      const result = await autoCloseHandler(undefined, { now, log: (l) => lines.push(l) });
      const own = lines.filter((l) => l.includes(`org=${orgId}`));

      expect((await ticketState(t.id)).status).toBe("RESOLVED");
      expect(await autoClosedRows(t.id)).toHaveLength(0);
      expect(result.organizations.find((o) => o.orgId === orgId)).toBeUndefined();
      if (c.invalid) {
        expect(result.invalidOrganizations).toContain(orgId);
        expect(own).toEqual([`[auto-close] org=${orgId} setting invalid, treated as off`]);
      } else {
        expect(result.invalidOrganizations).not.toContain(orgId);
        expect(own).toEqual([]);
      }
    }
  });

  it("with auto-close on and no candidates finishes with zero closed and no audit rows", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    await seedTicket(orgId);

    const { org, lines } = await runJob(orgId, now);
    expect(org).toMatchObject({ closed: 0, skippedWithoutResolvedAt: 0 });
    expect(lines).toEqual([`[auto-close] org=${orgId} closed=0 skippedWithoutResolvedAt=0`]);
    expect(
      await prisma.ticketAuditEvent.count({
        where: { organizationId: orgId, action: "AUTO_CLOSED" },
      }),
    ).toBe(0);
  });

  it("skips a RESOLVED ticket without resolvedAt and counts it; leaves other organizations alone", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const noResolvedAt = await resolvedTicket(orgId, null);
    const due = await resolvedTicket(orgId, daysAgo(now, 10));

    const other = await seedAdminOrg();
    const otherTicket = await resolvedTicket(other.orgId, daysAgo(now, 100));

    const { org, lines } = await runJob(orgId, now);
    expect(org).toMatchObject({ closed: 1, skippedWithoutResolvedAt: 1 });
    expect(lines).toEqual([`[auto-close] org=${orgId} closed=1 skippedWithoutResolvedAt=1`]);
    expect((await ticketState(noResolvedAt.id)).status).toBe("RESOLVED");
    expect((await ticketState(due.id)).status).toBe("CLOSED");
    expect((await ticketState(otherTicket.id)).status).toBe("RESOLVED");
    expect(await autoClosedRows(otherTicket.id)).toHaveLength(0);
  });
});

describe("autoCloseHandler re-reads the setting under a lock for every close (Codex review C8)", () => {
  for (const raw of ["30", "0"]) {
    it(`a save of "${raw}" committed before the close's settings lock stops the close`, async () => {
      const now = new Date();
      const { orgId, admin } = await seedAdminOrg();
      await setAutoClose(orgId, "7", daysAgo(now, 30));
      const t = await resolvedTicket(orgId, daysAgo(now, 10));

      let saved: Awaited<ReturnType<typeof saveAutoCloseDays>> | null = null;
      const { org, lines } = await runJob(orgId, now, async (_tx, ticketId) => {
        if (ticketId !== t.id) return;
        saved = await saveAutoCloseDays(prisma, admin, raw);
      });

      expect(saved).toMatchObject({ ok: true, days: Number(raw) });
      expect((await ticketState(t.id)).status).toBe("RESOLVED");
      expect(await autoClosedRows(t.id)).toHaveLength(0);
      expect(org?.closed).toBe(0);
      expect(lines[0]).toContain("closed=0");
      // A lengthened setting keeps enabledAt; a setting turned off clears it.
      const stored = await storedSettings(orgId);
      expect(stored.days).toBe(raw);
      expect(stored.enabledAt).toBe(raw === "0" ? null : daysAgo(now, 30).toISOString());
    });
  }
});
