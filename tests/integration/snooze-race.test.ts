// Phase 12, plan 12-05: forced-order snooze races (D-17, review C6), on a real Postgres through
// Testcontainers. Nothing is mocked.
//
// Every race records the holder's PID from inside the holder's transaction and the waiter's PID
// from inside the waiter's own transaction, filtered to the case's ticket id, and waits for that
// waiter to be blocked by that holder (waitForBlockedBy) before releasing the holder.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { prisma } from "@/lib/db";
import { AUTO_CLOSE_DAYS_KEY, AUTO_CLOSE_ENABLED_AT_KEY } from "@/lib/tickets/auto-close-settings";
import { setReopenObserverForTests } from "@/lib/tickets/reopen-on-reply";
import { snoozeTicket } from "@/lib/tickets/snooze";
import { autoCloseHandler } from "@/lib/worker/jobs/auto-close";
import { snoozeWakeHandler } from "@/lib/worker/jobs/snooze-wake";
import { uniqueClientIp } from "../support/client-ip";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

beforeAll(() => {
  // The follow-up route hashes the client IP with this pepper; a test-only value.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "snooze-race-test";
});

afterEach(() => {
  setReopenObserverForTests(null);
});

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  return { orgId, owner: { userId: users[0].id, orgId } };
}

async function setDeadline(ticketId: string, until: Date | null) {
  await prisma.ticket.update({ where: { id: ticketId }, data: { snoozedUntil: until } });
}

async function snoozedUntil(ticketId: string): Promise<Date | null> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { snoozedUntil: true },
  });
  return row.snoozedUntil;
}

async function audits(ticketId: string, action: "SNOOZED" | "WOKEN" | "AUTO_CLOSED") {
  return prisma.ticketAuditEvent.findMany({
    where: { ticketId, action },
    orderBy: { createdAt: "asc" },
    select: { id: true, actorType: true, before: true, after: true },
  });
}

async function followUp(ticketId: string) {
  const { statusToken } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  const form = new FormData();
  form.set("message", `Follow-up ${randomUUID()}`);
  const ip = uniqueClientIp();
  const res = await followUpPost(
    new Request(`http://localhost/api/public/status/${statusToken}/follow-up`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token: statusToken }) },
  );
  return res.status;
}

describe("snooze races (D-17)", () => {
  it("Race A: a follow-up holds the row lock; the wake job waits; one WOKEN row, the reply's", async () => {
    const { orgId } = await seedOrg();
    const deadline = new Date(Date.now() - MIN);
    const ticket = await seedTicket(orgId);
    await setDeadline(ticket.id, deadline);

    const replyPid = deferred<number>();
    const replyXid = deferred<string>();
    const release = deferred<void>();
    setReopenObserverForTests({
      afterResolve: async (tx, effectiveId) => {
        if (effectiveId !== ticket.id) return;
        const rows = await tx.$queryRaw<{ xid: string }[]>`
          SELECT (pg_current_xact_id()::text::bigint % 4294967296)::text AS xid
        `;
        replyXid.resolve(rows[0].xid);
        replyPid.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const reply = followUp(ticket.id);
    const holder = await replyPid.promise;

    const jobPid = deferred<number>();
    const job = snoozeWakeHandler(undefined, {
      now: new Date(),
      onWakeTransaction: async (tx, id) => {
        if (id === ticket.id) jobPid.resolve(await backendPid(tx));
      },
    });
    await waitForBlockedBy(prisma, holder, [await jobPid.promise]);
    release.resolve();

    expect(await reply).toBeLessThan(300);
    await job;
    expect(await snoozedUntil(ticket.id)).toBeNull();
    const woken = await audits(ticket.id, "WOKEN");
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({
      actorType: "SYSTEM",
      before: { snoozedUntil: deadline.toISOString() },
      after: { snoozedUntil: null },
    });
    const [{ xmin }] = await prisma.$queryRaw<{ xmin: string }[]>`
      SELECT xmin::text AS xmin FROM "TicketAuditEvent" WHERE id = ${woken[0].id}
    `;
    expect(xmin).toBe(await replyXid.promise);
  });

  it("Race B: a later re-snooze holds the lock; the job waits and wakes nothing", async () => {
    const { orgId, owner } = await seedOrg();
    const oldDeadline = new Date(Date.now() - MIN);
    const ticket = await seedTicket(orgId);
    await setDeadline(ticket.id, oldDeadline);
    const later = new Date(Date.now() + 2 * 60 * MIN);

    const snoozePid = deferred<number>();
    const release = deferred<void>();
    const snooze = snoozeTicket(
      prisma,
      owner,
      { ticketId: ticket.id, until: later },
      {
        hooks: {
          beforeCommit: async (tx) => {
            snoozePid.resolve(await backendPid(tx));
            await release.promise;
          },
        },
      },
    );
    const holder = await snoozePid.promise;

    const jobPid = deferred<number>();
    const job = snoozeWakeHandler(undefined, {
      now: new Date(),
      onWakeTransaction: async (tx, id) => {
        if (id === ticket.id) jobPid.resolve(await backendPid(tx));
      },
    });
    await waitForBlockedBy(prisma, holder, [await jobPid.promise]);
    release.resolve();

    expect(await snooze).toMatchObject({ ok: true });
    await job;
    expect((await snoozedUntil(ticket.id))?.toISOString()).toBe(later.toISOString());
    expect(await audits(ticket.id, "WOKEN")).toEqual([]);
    expect(await audits(ticket.id, "SNOOZED")).toMatchObject([
      {
        before: { snoozedUntil: oldDeadline.toISOString() },
        after: { snoozedUntil: later.toISOString() },
      },
    ]);
  });

  it("Race B2: the job holds after reading the due deadline under the lock (afterWakeLock); the re-snooze waits and survives", async () => {
    const { orgId, owner } = await seedOrg();
    const oldDeadline = new Date(Date.now() - MIN);
    const ticket = await seedTicket(orgId);
    await setDeadline(ticket.id, oldDeadline);
    const later = new Date(Date.now() + 2 * 60 * MIN);

    let current: string | null = null;
    const jobPid = deferred<number>();
    const locked = deferred<void>();
    const release = deferred<void>();
    const job = snoozeWakeHandler(undefined, {
      now: new Date(),
      onWakeTransaction: async (tx, id) => {
        current = id;
        if (id === ticket.id) jobPid.resolve(await backendPid(tx));
      },
      afterWakeLock: async () => {
        if (current !== ticket.id) return;
        locked.resolve();
        await release.promise;
      },
    });
    const holder = await jobPid.promise;
    await locked.promise;

    const snoozePid = deferred<number>();
    const snooze = snoozeTicket(
      prisma,
      owner,
      { ticketId: ticket.id, until: later },
      {
        hooks: {
          onTransactionStart: async (tx) => {
            snoozePid.resolve(await backendPid(tx));
          },
        },
      },
    );
    await waitForBlockedBy(prisma, holder, [await snoozePid.promise]);
    release.resolve();

    await job;
    expect(await snooze).toMatchObject({ ok: true });
    expect(await audits(ticket.id, "WOKEN")).toMatchObject([
      {
        actorType: "SYSTEM",
        before: { snoozedUntil: oldDeadline.toISOString() },
        after: { snoozedUntil: null },
      },
    ]);
    expect(await audits(ticket.id, "SNOOZED")).toMatchObject([
      { before: { snoozedUntil: null }, after: { snoozedUntil: later.toISOString() } },
    ]);
    expect((await snoozedUntil(ticket.id))?.toISOString()).toBe(later.toISOString());
  });

  it("Race C: a snooze of a quiet RESOLVED ticket holds the lock; auto-close waits and closes nothing", async () => {
    const { orgId, owner } = await seedOrg();
    const now = new Date();
    await prisma.setting.create({
      data: { organizationId: orgId, key: AUTO_CLOSE_DAYS_KEY, value: "7" },
    });
    await prisma.setting.create({
      data: {
        organizationId: orgId,
        key: AUTO_CLOSE_ENABLED_AT_KEY,
        value: new Date(now.getTime() - 30 * DAY).toISOString(),
      },
    });
    const ticket = await seedTicket(orgId, {
      status: "RESOLVED",
      resolvedAt: new Date(now.getTime() - 10 * DAY),
    });

    const snoozePid = deferred<number>();
    const release = deferred<void>();
    const snooze = snoozeTicket(
      prisma,
      owner,
      { ticketId: ticket.id, until: new Date(now.getTime() + DAY) },
      {
        hooks: {
          beforeCommit: async (tx) => {
            snoozePid.resolve(await backendPid(tx));
            await release.promise;
          },
        },
      },
    );
    const holder = await snoozePid.promise;

    const closePid = deferred<number>();
    const close = autoCloseHandler(undefined, {
      now,
      log: () => {},
      onCloseTransaction: async (tx, id) => {
        if (id === ticket.id) closePid.resolve(await backendPid(tx));
      },
    });
    await waitForBlockedBy(prisma, holder, [await closePid.promise]);
    release.resolve();

    expect(await snooze).toMatchObject({ ok: true });
    await close;
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.stateId).toBe(await stateIdFor(orgId, "RESOLVED"));
    expect(row.snoozedUntil).not.toBeNull();
    expect(await audits(ticket.id, "AUTO_CLOSED")).toEqual([]);
  });
});
