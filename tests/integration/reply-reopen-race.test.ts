// Phase 11, plan 11-04: a customer reply always wins against the auto-close job and against an
// agent's resolve that is still uncommitted (D-17 and its 11-04 amendment), on both reply paths
// (email ingest and the public status follow-up route). Real Postgres through Testcontainers;
// nothing is mocked.
//
// Every race records the holder's PID from inside the holder's transaction and the waiter's PID
// from inside the waiter's own transaction (opts.onCloseTransaction for the job,
// setReopenObserverForTests for both reply paths), filtered to the case's ticket id, and waits
// for that waiter to be blocked by that holder before releasing the holder (Codex review C6).
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import type { Prisma } from "@/generated/prisma/client";
import { deriveEmailMessageId, ingestMessage } from "@/lib/channels/email/ingest-message";
import { prisma } from "@/lib/db";
import { AUTO_CLOSE_DAYS_KEY, AUTO_CLOSE_ENABLED_AT_KEY } from "@/lib/tickets/auto-close-settings";
import { reopenOnCustomerReply, setReopenObserverForTests } from "@/lib/tickets/reopen-on-reply";
import { autoCloseHandler, closeResolvedTicketIfQuiet } from "@/lib/worker/jobs/auto-close";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

const DAY = 24 * 60 * 60 * 1000;
const SELF_ADDRESS = "support@aida.test";
const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

beforeAll(() => {
  // The follow-up route hashes the client IP with this pepper; a test-only value.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "reply-reopen-race-test";
});

afterEach(() => {
  setReopenObserverForTests(null);
});

/** Auto-close on for the organization: 7 days, enabled 30 days before now (fixture write). */
async function enableAutoClose(orgId: string, now: Date) {
  await prisma.setting.create({
    data: { organizationId: orgId, key: AUTO_CLOSE_DAYS_KEY, value: "7" },
  });
  await prisma.setting.create({
    data: {
      organizationId: orgId,
      key: AUTO_CLOSE_ENABLED_AT_KEY,
      value: daysAgo(now, 30).toISOString(),
    },
  });
}

/** Opens an interactive transaction, records its PID, runs body, then holds until released. */
function holdTx<T>(body: (tx: Prisma.TransactionClient) => Promise<T>) {
  const pid = deferred<number>();
  const ready = deferred<T>();
  const release = deferred<void>();
  const done = prisma.$transaction(async (tx) => {
    pid.resolve(await backendPid(tx));
    ready.resolve(await body(tx));
    await release.promise;
  }, TX_OPTS);
  done.catch(() => {});
  return { pid: pid.promise, ready: ready.promise, release: () => release.resolve(), done };
}

async function timed(promise: Promise<void>): Promise<number> {
  const started = Date.now();
  await promise;
  return Date.now() - started;
}

/** Records the reply transaction's PID through the observer, for this ticket only. */
function observeReply(ticketId: string) {
  const replyPid = deferred<number>();
  setReopenObserverForTests(async (tx, ticket) => {
    if (ticket.ticketId === ticketId) replyPid.resolve(await backendPid(tx));
  });
  return replyPid.promise;
}

async function emailReply(orgId: string, ticketNumber: number, headers?: Record<string, string>) {
  const buf = await new MailComposer({
    from: `customer-${randomUUID()}@example.com`,
    to: SELF_ADDRESS,
    subject: `Re: my question [#${ticketNumber}]`,
    text: "Thanks, one more thing.",
    messageId: `<race-${randomUUID()}@test.local>`,
    headers,
  })
    .compile()
    .build();
  const parsed = await simpleParser(buf);
  const emailMessageId = deriveEmailMessageId(buf, parsed.messageId);
  return {
    emailMessageId,
    run: () => ingestMessage(orgId, buf, SELF_ADDRESS, emailMessageId),
  };
}

async function statusReply(ticketId: string) {
  const { statusToken } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  const body = `Follow-up ${randomUUID()}`;
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  return {
    body,
    run: async () => {
      const form = new FormData();
      form.set("message", body);
      const res = await followUpPost(
        new Request(`http://localhost/api/public/status/${statusToken}/follow-up`, {
          method: "POST",
          body: form,
          headers: { "x-forwarded-for": ip },
        }),
        { params: Promise.resolve({ token: statusToken }) },
      );
      return res.status;
    },
  };
}

async function ticketState(id: string) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { stateId: true, resolvedAt: true, slaPausedAt: true },
  });
}

/** The organization's reopen role (TicketStateConfig.reopenStateId; the migrated Open state). */
async function reopenStateId(orgId: string): Promise<string> {
  const config = await prisma.ticketStateConfig.findUniqueOrThrow({
    where: { organizationId: orgId },
    select: { reopenStateId: true },
  });
  return config.reopenStateId;
}

function autoClosedCount(ticketId: string) {
  return prisma.ticketAuditEvent.count({ where: { ticketId, action: "AUTO_CLOSED" } });
}

describe("reply versus auto-close and agent resolve (D-17, Codex review C6)", () => {
  it("(a) reply then close: the job waits on the reply's row lock and the ticket ends OPEN", async () => {
    const now = new Date();
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    await enableAutoClose(orgId, now);
    const t = await seedTicket(orgId, { status: "RESOLVED", resolvedAt: daysAgo(now, 10) });

    const holder = holdTx((tx) =>
      reopenOnCustomerReply(tx, { orgId, ticketId: t.id, isAutoGenerated: false }),
    );
    const holderPid = await holder.pid;
    expect(await holder.ready).toBe(true);

    const closePid = deferred<number>();
    const lines: string[] = [];
    const job = autoCloseHandler(undefined, {
      now,
      log: (l) => lines.push(l),
      async onCloseTransaction(tx, ticketId) {
        if (ticketId === t.id) closePid.resolve(await backendPid(tx));
      },
    });
    job.catch(() => {});
    const waiterPid = await closePid.promise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [waiterPid]));
    console.log(
      `[race a] holderPid=${holderPid} closePid=${waiterPid} observedBlockedAfterMs=${waitedMs}`,
    );

    holder.release();
    await holder.done;
    const result = await job;

    expect((await ticketState(t.id)).stateId).toBe(await reopenStateId(orgId));
    expect(result.organizations.find((o) => o.orgId === orgId)?.closed).toBe(0);
    expect(lines.filter((l) => l.includes(`org=${orgId}`))[0]).toContain("closed=0");
    expect(await autoClosedCount(t.id)).toBe(0);
  });

  it("(b-email) close then email reply: the reply waits, then reopens the CLOSED ticket", async () => {
    const now = new Date();
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    await enableAutoClose(orgId, now);
    const t = await seedTicket(orgId, { status: "RESOLVED", resolvedAt: daysAgo(now, 10) });

    const holder = holdTx((tx) => closeResolvedTicketIfQuiet(tx, { orgId, ticketId: t.id, now }));
    const holderPid = await holder.pid;
    expect(await holder.ready).toEqual({ closed: true, off: false });

    const replyPidPromise = observeReply(t.id);
    const mail = await emailReply(orgId, t.number);
    const reply = mail.run();
    reply.catch(() => {});
    const replyPid = await replyPidPromise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [replyPid]));
    console.log(
      `[race b-email] holderPid=${holderPid} replyPid=${replyPid} observedBlockedAfterMs=${waitedMs}`,
    );

    holder.release();
    await holder.done;
    expect(await reply).toBe("appended");

    const state = await ticketState(t.id);
    expect(state.stateId).toBe(await reopenStateId(orgId));
    expect(state.resolvedAt).toBeNull();
    const msg = await prisma.message.findFirstOrThrow({
      where: { emailMessageId: mail.emailMessageId },
    });
    expect(msg.triggeredReopen).toBe(true);
    expect(await autoClosedCount(t.id)).toBe(1);
  });

  it("(b-status) close then status-page follow-up: the reply waits, then reopens the CLOSED ticket", async () => {
    const now = new Date();
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    await enableAutoClose(orgId, now);
    const t = await seedTicket(orgId, { status: "RESOLVED", resolvedAt: daysAgo(now, 10) });

    const holder = holdTx((tx) => closeResolvedTicketIfQuiet(tx, { orgId, ticketId: t.id, now }));
    const holderPid = await holder.pid;
    expect(await holder.ready).toEqual({ closed: true, off: false });

    const replyPidPromise = observeReply(t.id);
    const followUp = await statusReply(t.id);
    const reply = followUp.run();
    reply.catch(() => {});
    const replyPid = await replyPidPromise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [replyPid]));
    console.log(
      `[race b-status] holderPid=${holderPid} replyPid=${replyPid} observedBlockedAfterMs=${waitedMs}`,
    );

    holder.release();
    await holder.done;
    expect(await reply).toBe(200);

    const state = await ticketState(t.id);
    expect(state.stateId).toBe(await reopenStateId(orgId));
    expect(state.resolvedAt).toBeNull();
    const msg = await prisma.message.findFirstOrThrow({
      where: { ticketId: t.id, bodyMarkdown: followUp.body },
    });
    expect(msg.triggeredReopen).toBe(true);
    expect(await autoClosedCount(t.id)).toBe(1);
  });

  it("(c-email) email reply during an uncommitted agent resolve: the ticket ends OPEN", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId, { status: "OPEN" });
    const resolvedStateId = await stateIdFor(orgId, "RESOLVED");

    const holder = holdTx((tx) =>
      tx.ticket.update({
        where: { id: t.id },
        data: { stateId: resolvedStateId, resolvedAt: new Date() },
        select: { id: true },
      }),
    );
    const holderPid = await holder.pid;
    await holder.ready;

    const replyPidPromise = observeReply(t.id);
    const mail = await emailReply(orgId, t.number);
    const reply = mail.run();
    reply.catch(() => {});
    const replyPid = await replyPidPromise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [replyPid]));
    console.log(
      `[race c-email] holderPid=${holderPid} replyPid=${replyPid} observedBlockedAfterMs=${waitedMs}`,
    );

    holder.release();
    await holder.done;
    expect(await reply).toBe("appended");

    const state = await ticketState(t.id);
    expect(state.stateId).toBe(await reopenStateId(orgId));
    expect(state.resolvedAt).toBeNull();
    const msg = await prisma.message.findFirstOrThrow({
      where: { emailMessageId: mail.emailMessageId },
    });
    expect(msg.triggeredReopen).toBe(true);
  });

  it("(c-status) status-page follow-up during an uncommitted agent resolve: the ticket ends OPEN", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId, { status: "OPEN" });
    const resolvedStateId = await stateIdFor(orgId, "RESOLVED");

    const holder = holdTx((tx) =>
      tx.ticket.update({
        where: { id: t.id },
        data: { stateId: resolvedStateId, resolvedAt: new Date() },
        select: { id: true },
      }),
    );
    const holderPid = await holder.pid;
    await holder.ready;

    const replyPidPromise = observeReply(t.id);
    const followUp = await statusReply(t.id);
    const reply = followUp.run();
    reply.catch(() => {});
    const replyPid = await replyPidPromise;
    const waitedMs = await timed(waitForBlockedBy(prisma, holderPid, [replyPid]));
    console.log(
      `[race c-status] holderPid=${holderPid} replyPid=${replyPid} observedBlockedAfterMs=${waitedMs}`,
    );

    holder.release();
    await holder.done;
    expect(await reply).toBe(200);

    const state = await ticketState(t.id);
    expect(state.stateId).toBe(await reopenStateId(orgId));
    expect(state.resolvedAt).toBeNull();
    const msg = await prisma.message.findFirstOrThrow({
      where: { ticketId: t.id, bodyMarkdown: followUp.body },
    });
    expect(msg.triggeredReopen).toBe(true);
  });

  it("automatic mail to a CLOSED ticket appends a message and never reopens it", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId, { status: "CLOSED", resolvedAt: new Date() });

    const mail = await emailReply(orgId, t.number, { "Auto-Submitted": "auto-replied" });
    expect(await mail.run()).toBe("appended");

    expect((await ticketState(t.id)).stateId).toBe(await stateIdFor(orgId, "CLOSED"));
    const msg = await prisma.message.findFirstOrThrow({
      where: { emailMessageId: mail.emailMessageId },
    });
    expect(msg.triggeredReopen).toBe(false);
  });
});

describe("customer reply reopens by group into the reopen role (Phase 12.1, D-11)", () => {
  it("reopens a ticket in a second CLOSED-group state into the reopen role", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const duplicate = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: "Closed - duplicate",
        colorToken: "gray",
        group: "CLOSED",
        sortOrder: 5,
      },
    });
    const t = await seedTicket(orgId, { stateId: duplicate.id, resolvedAt: new Date() });

    const followUp = await statusReply(t.id);
    expect(await followUp.run()).toBe(200);

    const state = await ticketState(t.id);
    expect(state.stateId).toBe(await reopenStateId(orgId));
    expect(state.stateId).toBe(await stateIdFor(orgId, "OPEN"));
    expect(state.resolvedAt).toBeNull();
    const msg = await prisma.message.findFirstOrThrow({
      where: { ticketId: t.id, bodyMarkdown: followUp.body },
    });
    expect(msg.triggeredReopen).toBe(true);
    // The reopen writes no STATUS_CHANGED row (as in Phase 11; triggeredReopen records it).
    expect(
      await prisma.ticketAuditEvent.count({ where: { ticketId: t.id, action: "STATUS_CHANGED" } }),
    ).toBe(0);
  });
});
