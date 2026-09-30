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
import { readLegacyStateIds } from "@/lib/tickets/ticket-states";
import {
  type AutoCloseHandlerOptions,
  AutoCloseRunError,
  AutoCloseStateUnavailableError,
  autoCloseHandler,
  closeResolvedTicketIfQuiet,
} from "@/lib/worker/jobs/auto-close";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

const DAY = 24 * 60 * 60 * 1000;
const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

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

/**
 * The ticket's state id, its group and resolvedAt. key is the legacy key (NEW to CLOSED) of the
 * migrated state whose id equals the ticket's stateId in its own organization, or null for any
 * other state, so `key` assertions compare state ids.
 */
async function ticketState(id: string) {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: {
      organizationId: true,
      stateId: true,
      resolvedAt: true,
      state: { select: { group: true } },
    },
  });
  const legacy = await readLegacyStateIds(prisma, row.organizationId);
  const key =
    (Object.keys(legacy) as (keyof typeof legacy)[]).find((k) => legacy[k] === row.stateId) ?? null;
  return { stateId: row.stateId, group: row.state.group, resolvedAt: row.resolvedAt, key };
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

  it("refuses a combined role such as member,admin, like every other admin check (review IN-05)", async () => {
    const { orgId, member, admin, adminMemberId } = await seedAdminOrg();
    await prisma.member.update({ where: { id: adminMemberId }, data: { role: "member,admin" } });
    expect(await saveAutoCloseDays(prisma, admin, "7")).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    // A plain member is refused too.
    expect(await saveAutoCloseDays(prisma, member, "9")).toEqual({
      ok: false,
      error: "NOT_ALLOWED",
    });
    expect(await storedSettings(orgId)).toEqual({ days: null, enabledAt: null });
  });
});

describe("autoCloseHandler isolates each organization (review WR-02)", () => {
  it("a failing organization is logged by error code, later organizations still close, and the run rejects", async () => {
    const now = new Date();
    const a = await seedAdminOrg();
    const b = await seedAdminOrg();
    // Organizations run in id order: make the failing one the first of the two.
    const [failing, healthy] = a.orgId < b.orgId ? [a, b] : [b, a];
    await setAutoClose(failing.orgId, "7", daysAgo(now, 30));
    await setAutoClose(healthy.orgId, "7", daysAgo(now, 30));
    const broken = await resolvedTicket(failing.orgId, daysAgo(now, 10));
    const quiet = await resolvedTicket(healthy.orgId, daysAgo(now, 10));
    const subject = (
      await prisma.ticket.findUniqueOrThrow({ where: { id: broken.id }, select: { subject: true } })
    ).subject;

    const lines: string[] = [];
    const outcome = await autoCloseHandler(undefined, {
      now,
      log: (line) => lines.push(line),
      onCloseTransaction(_tx, ticketId) {
        if (ticketId !== broken.id) return;
        // A database-style error whose message carries ticket text: only the code may be logged.
        throw Object.assign(new Error(`deadlock while closing "${subject}"`), { code: "40P01" });
      },
    }).then(
      () => null,
      (err: unknown) => err,
    );

    // The failing organization's ticket is untouched; the later organization still ran.
    expect((await ticketState(broken.id)).key).toBe("RESOLVED");
    expect(await autoClosedRows(broken.id)).toHaveLength(0);
    expect((await ticketState(quiet.id)).key).toBe("CLOSED");
    expect(await autoClosedRows(quiet.id)).toHaveLength(1);

    expect(outcome).toBeInstanceOf(AutoCloseRunError);
    const result = (outcome as AutoCloseRunError).result;
    expect(result.failedOrganizations).toContainEqual({
      orgId: failing.orgId,
      code: "40P01",
      closed: 0,
    });
    expect(result.organizations.find((o) => o.orgId === failing.orgId)).toBeUndefined();
    expect(result.organizations.find((o) => o.orgId === healthy.orgId)).toMatchObject({
      closed: 1,
      skippedWithoutResolvedAt: 0,
      stoppedOff: false,
    });

    expect(lines.filter((l) => l.includes(`org=${failing.orgId}`))).toEqual([
      `[auto-close] org=${failing.orgId} failed code=40P01 closed=0`,
    ]);
    expect(lines.filter((l) => l.includes(`org=${healthy.orgId}`))).toEqual([
      `[auto-close] org=${healthy.orgId} closed=1 skippedWithoutResolvedAt=0`,
    ]);
    expect(lines.join("\n")).not.toContain(subject);

    // The run is idempotent: once the fault is gone, the next run closes the skipped ticket.
    const retry = await runJob(failing.orgId, now);
    expect(retry.org?.closed).toBe(1);
    expect((await ticketState(broken.id)).key).toBe("CLOSED");
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
      expect((await ticketState(t.id)).key).toBe("CLOSED");
    }
    expect((await ticketState(recent.id)).key).toBe("RESOLVED");
    expect(await autoClosedRows(recent.id)).toHaveLength(0);
  });

  it("does not close a ticket resolved long ago when auto-close was enabled just now (D-15)", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", now);
    const t = await resolvedTicket(orgId, daysAgo(now, 30));

    const { org } = await runJob(orgId, now);
    expect(org?.closed).toBe(0);
    expect((await ticketState(t.id)).key).toBe("RESOLVED");
  });

  it("keeps resolvedAt, writes exactly one SYSTEM AUTO_CLOSED row and adds nothing when run again", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const resolvedAt = daysAgo(now, 10);
    const t = await resolvedTicket(orgId, resolvedAt);

    await runJob(orgId, now);
    const after = await ticketState(t.id);
    expect(after.key).toBe("CLOSED");
    expect(after.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString());

    const rows = await autoClosedRows(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: orgId,
      actorType: "SYSTEM",
      actorUserId: null,
      action: "AUTO_CLOSED",
      before: { stateId: await stateIdFor(orgId, "RESOLVED"), stateGroup: "RESOLVED" },
      after: { stateId: await stateIdFor(orgId, "CLOSED"), stateGroup: "CLOSED" },
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
    const resolvedStateId = await stateIdFor(orgId, "RESOLVED");
    const closedStateId = await stateIdFor(orgId, "CLOSED");
    const rows = [];
    for (let i = 1; i < 105; i += 1) {
      rows.push({
        organizationId: orgId,
        contactId: contact.contactId,
        number: 10_000 + i,
        statusToken: randomUUID(),
        subject: `Cap fixture ${i}`,
        stateId: resolvedStateId,
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
      where: { organizationId: orgId, stateId: closedStateId },
      select: { id: true },
    });
    expect(new Set(closedAfter1.map((r) => r.id))).toEqual(new Set(expectedFirst));

    const run2 = await runJob(orgId, now);
    expect(run2.org?.closed).toBe(5);
    expect(
      await prisma.ticket.count({ where: { organizationId: orgId, stateId: resolvedStateId } }),
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

      expect((await ticketState(t.id)).key).toBe("RESOLVED");
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
    expect((await ticketState(noResolvedAt.id)).key).toBe("RESOLVED");
    expect((await ticketState(due.id)).key).toBe("CLOSED");
    expect((await ticketState(otherTicket.id)).key).toBe("RESOLVED");
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
      expect((await ticketState(t.id)).key).toBe("RESOLVED");
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

async function timed(promise: Promise<void>): Promise<number> {
  const started = Date.now();
  await promise;
  return Date.now() - started;
}

describe("setting change and close serialise in both orders (Codex reviews C8, C6, R2-3)", () => {
  it("(d) setting off first: the close waits for the save, then finds auto-close off", async () => {
    const now = new Date();
    const { orgId, admin } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const t = await resolvedTicket(orgId, daysAgo(now, 10));

    const savePid = deferred<number>();
    const written = deferred<void>();
    const releaseSave = deferred<void>();
    const save = saveAutoCloseDays(prisma, admin, "0", {
      hooks: {
        async onTransactionStart(tx) {
          savePid.resolve(await backendPid(tx));
        },
        async beforeCommit() {
          written.resolve();
          await releaseSave.promise;
        },
      },
    });
    save.catch(() => {});
    const holderPid = await savePid.promise;
    await written.promise;

    const closePid = deferred<number>();
    const job = runJob(orgId, now, async (tx, ticketId) => {
      if (ticketId === t.id) closePid.resolve(await backendPid(tx));
    });
    job.catch(() => {});
    const waiterPid = await closePid.promise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [waiterPid]));
    console.log(
      `[race d] savePid=${holderPid} closePid=${waiterPid} observedBlockedAfterMs=${waitedMs}`,
    );

    releaseSave.resolve();
    expect(await save).toEqual({ ok: true, days: 0, enabledAt: null });
    const { org, lines } = await job;

    expect((await ticketState(t.id)).key).toBe("RESOLVED");
    expect(await autoClosedRows(t.id)).toHaveLength(0);
    expect(org).toMatchObject({ closed: 0, stoppedOff: true });
    expect(lines[0]).toContain("closed=0");
    expect(await storedSettings(orgId)).toEqual({ days: "0", enabledAt: null });
  });

  it("(e) close first: the save waits for the close, the close stands, then nothing more closes", async () => {
    const now = new Date();
    const { orgId, admin } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const t = await resolvedTicket(orgId, daysAgo(now, 10));

    const holderPidD = deferred<number>();
    const closedD = deferred<Awaited<ReturnType<typeof closeResolvedTicketIfQuiet>>>();
    const releaseClose = deferred<void>();
    const holder = prisma.$transaction(async (tx) => {
      holderPidD.resolve(await backendPid(tx));
      closedD.resolve(await closeResolvedTicketIfQuiet(tx, { orgId, ticketId: t.id, now }));
      await releaseClose.promise;
    }, TX_OPTS);
    holder.catch(() => {});
    const holderPid = await holderPidD.promise;
    expect(await closedD.promise).toEqual({ closed: true, off: false });

    const savePid = deferred<number>();
    const save = saveAutoCloseDays(prisma, admin, "0", {
      hooks: {
        async onTransactionStart(tx) {
          savePid.resolve(await backendPid(tx));
        },
      },
    });
    save.catch(() => {});
    const waiterPid = await savePid.promise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [waiterPid]));
    console.log(
      `[race e] closePid=${holderPid} savePid=${waiterPid} observedBlockedAfterMs=${waitedMs}`,
    );

    releaseClose.resolve();
    await holder;
    expect(await save).toEqual({ ok: true, days: 0, enabledAt: null });

    expect((await ticketState(t.id)).key).toBe("CLOSED");
    expect(await autoClosedRows(t.id)).toHaveLength(1);
    expect(await storedSettings(orgId)).toEqual({ days: "0", enabledAt: null });

    const again = await runJob(orgId, now);
    expect(again.org).toBeUndefined();
    expect(again.lines).toEqual([]);
    expect(await autoClosedRows(t.id)).toHaveLength(1);
  });

  it("(f) no days row: a setting committed after the FOR SHARE statement is never used by that close", async () => {
    const now = new Date();
    const { orgId, admin } = await seedAdminOrg();
    const t = await resolvedTicket(orgId, daysAgo(now, 10));

    let saveCommittedInHook = false;
    let saveMs = -1;
    const first = await prisma.$transaction(
      (tx) =>
        closeResolvedTicketIfQuiet(
          tx,
          { orgId, ticketId: t.id, now },
          {
            async afterShareLock() {
              const started = Date.now();
              const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000));
              const saved = await Promise.race([saveAutoCloseDays(prisma, admin, "7"), timeout]);
              if (saved === "timeout") throw new Error("save did not resolve within 5 seconds");
              saveMs = Date.now() - started;
              expect(saved).toMatchObject({ ok: true, days: 7 });
              await prisma.setting.update({
                where: {
                  organizationId_key: { organizationId: orgId, key: AUTO_CLOSE_ENABLED_AT_KEY },
                },
                data: { value: daysAgo(now, 30).toISOString() },
              });
              saveCommittedInHook = true;
            },
          },
        ),
      TX_OPTS,
    );
    console.log(`[race f] saveCommittedInHook=${saveCommittedInHook} saveMs=${saveMs}`);

    expect(saveCommittedInHook).toBe(true);
    expect(first).toEqual({ closed: false, off: true });
    expect((await ticketState(t.id)).key).toBe("RESOLVED");
    expect(await autoClosedRows(t.id)).toHaveLength(0);
    expect(await storedSettings(orgId)).toEqual({
      days: "7",
      enabledAt: daysAgo(now, 30).toISOString(),
    });

    // Control: the committed setting does qualify the ticket.
    const control = await prisma.$transaction(
      (tx) => closeResolvedTicketIfQuiet(tx, { orgId, ticketId: t.id, now }),
      TX_OPTS,
    );
    expect(control).toEqual({ closed: true, off: false });
    expect((await ticketState(t.id)).key).toBe("CLOSED");
    expect(await autoClosedRows(t.id)).toHaveLength(1);
  });
});

describe("auto-close reasons about the RESOLVED group and closes into the auto-close role (Phase 12.1, D-11)", () => {
  async function addState(orgId: string, name: string, group: "RESOLVED" | "CLOSED") {
    return prisma.ticketState.create({
      data: { organizationId: orgId, name, colorToken: "green", group, sortOrder: 5 },
      select: { id: true },
    });
  }

  it("closes a quiet ticket in Resolved and one in 'Resolved - confirmed' into autoCloseStateId, keeps resolvedAt, audits ids only", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const confirmed = await addState(orgId, "Resolved - confirmed", "RESOLVED");
    const resolvedAt = daysAgo(now, 10);
    const inResolved = await resolvedTicket(orgId, resolvedAt);
    const inConfirmed = await seedTicket(orgId, { stateId: confirmed.id, resolvedAt });
    const config = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    const resolvedId = await stateIdFor(orgId, "RESOLVED");

    const { org } = await runJob(orgId, now);
    expect(org).toMatchObject({ closed: 2, skippedWithoutResolvedAt: 0 });

    for (const [ticket, previous] of [
      [inResolved, resolvedId],
      [inConfirmed, confirmed.id],
    ] as const) {
      const after = await ticketState(ticket.id);
      expect(after.stateId).toBe(config.autoCloseStateId);
      expect(after.group).toBe("CLOSED");
      expect(after.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString());
      const rows = await autoClosedRows(ticket.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toEqual({ stateId: previous, stateGroup: "RESOLVED" });
      expect(rows[0].after).toEqual({ stateId: config.autoCloseStateId, stateGroup: "CLOSED" });
    }
  });

  it("uses a second CLOSED-group state once the config's autoCloseStateId points at it", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const archived = await addState(orgId, "Closed - archived", "CLOSED");
    await prisma.ticketStateConfig.update({
      where: { organizationId: orgId },
      data: { autoCloseStateId: archived.id },
    });
    const t = await resolvedTicket(orgId, daysAgo(now, 10));

    const { org } = await runJob(orgId, now);
    expect(org?.closed).toBe(1);
    const after = await ticketState(t.id);
    expect(after.stateId).toBe(archived.id);
    expect(after.key).toBeNull();
    const rows = await autoClosedRows(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ stateId: archived.id, stateGroup: "CLOSED" });
  });

  it("never closes tickets in New, Open, Pending or Closed; counts RESOLVED-group tickets without resolvedAt", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const confirmed = await addState(orgId, "Resolved - confirmed", "RESOLVED");
    const old = daysAgo(now, 100);
    const others = [];
    for (const status of ["NEW", "OPEN", "PENDING", "CLOSED"] as const) {
      others.push({ status, ticket: await seedTicket(orgId, { status, resolvedAt: old }) });
    }
    await resolvedTicket(orgId, null);
    await seedTicket(orgId, { stateId: confirmed.id, resolvedAt: null });

    const { org, lines } = await runJob(orgId, now);
    expect(org).toMatchObject({ closed: 0, skippedWithoutResolvedAt: 2 });
    expect(lines).toEqual([`[auto-close] org=${orgId} closed=0 skippedWithoutResolvedAt=2`]);
    for (const { status, ticket } of others) {
      expect((await ticketState(ticket.id)).key).toBe(status);
      expect(await autoClosedRows(ticket.id)).toHaveLength(0);
    }
  });

  it("refuses an auto-close role that points outside the CLOSED group (review IN-a2-2)", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const openId = await stateIdFor(orgId, "OPEN");
    const { autoCloseStateId } = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    // Only a hand edit or a bug can do this: the service keeps the role inside CLOSED.
    await prisma.ticketStateConfig.update({
      where: { organizationId: orgId },
      data: { autoCloseStateId: openId },
    });
    const t = await resolvedTicket(orgId, daysAgo(now, 10));

    try {
      await expect(
        prisma.$transaction(
          (tx) => closeResolvedTicketIfQuiet(tx, { orgId, ticketId: t.id, now }),
          TX_OPTS,
        ),
      ).rejects.toBeInstanceOf(AutoCloseStateUnavailableError);
      expect((await ticketState(t.id)).key).toBe("RESOLVED");
      expect(await autoClosedRows(t.id)).toHaveLength(0);
    } finally {
      // The job runs over every organization of the shared database: leave no broken role behind
      // for the auto-close runs of later test files.
      await prisma.ticketStateConfig.update({
        where: { organizationId: orgId },
        data: { autoCloseStateId },
      });
      await setAutoClose(orgId, "0", null);
    }
  });

  it("closeResolvedTicketIfQuiet re-checks the group under the ticket lock: an Open ticket is not closed", async () => {
    const now = new Date();
    const { orgId } = await seedAdminOrg();
    await setAutoClose(orgId, "7", daysAgo(now, 30));
    const t = await seedTicket(orgId, { status: "OPEN", resolvedAt: daysAgo(now, 100) });

    const outcome = await prisma.$transaction(
      (tx) => closeResolvedTicketIfQuiet(tx, { orgId, ticketId: t.id, now }),
      TX_OPTS,
    );
    expect(outcome).toEqual({ closed: false, off: false });
    expect((await ticketState(t.id)).key).toBe("OPEN");
    expect(await autoClosedRows(t.id)).toHaveLength(0);
  });
});
