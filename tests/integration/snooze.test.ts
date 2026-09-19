// Phase 12, plan 12-05: snooze and wake (AIDA-54, D-12 to D-16), on a real Postgres through
// Testcontainers. Nothing is mocked.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { deriveEmailMessageId, ingestMessage } from "@/lib/channels/email/ingest-message";
import { prisma } from "@/lib/db";
import { AUTO_CLOSE_DAYS_KEY, AUTO_CLOSE_ENABLED_AT_KEY } from "@/lib/tickets/auto-close-settings";
import { mergeTickets } from "@/lib/tickets/merge";
import { runTicketMutation } from "@/lib/tickets/mutations";
import {
  SNOOZE_MAX_LEAD_MS,
  SNOOZE_MIN_LEAD_MS,
  snoozeTicket,
  wakeTicket,
} from "@/lib/tickets/snooze";
import { autoCloseHandler } from "@/lib/worker/jobs/auto-close";
import { snoozeWakeHandler } from "@/lib/worker/jobs/snooze-wake";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { seedContactTicket } from "../support/lifecycle-fixtures";

// The agent messages route reads its session through getScopedDb and enqueues through getBoss;
// both are replaced by test doubles bound to the case's actor (as in ticket-merge.test.ts).
// Nothing is sent: the outbound queue is a recording double.
const routeEnv = vi.hoisted(() => ({
  actor: null as null | { orgId: string; userId: string },
}));

vi.mock("@/lib/session", async () => {
  const { scopedDb } = await import("@/lib/scoped-db");
  return {
    getScopedDb: async () => {
      if (!routeEnv.actor) throw new Error("no session");
      return {
        db: scopedDb(routeEnv.actor.orgId),
        orgId: routeEnv.actor.orgId,
        session: { user: { id: routeEnv.actor.userId } },
      };
    },
  };
});

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({ send: async () => "job" }),
}));

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const SELF_ADDRESS = "support@aida.test";

let uploadsDir = "";
let previousUploads: string | undefined;
let agentPost: typeof import("@/app/api/tickets/[id]/messages/route")["POST"];

beforeAll(async () => {
  // The follow-up route hashes the client IP with this pepper; a test-only value.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "snooze-test";
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), "aida-snooze-uploads-"));
  previousUploads = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = uploadsDir;
  ({ POST: agentPost } = await import("@/app/api/tickets/[id]/messages/route"));
});

afterAll(async () => {
  if (previousUploads === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploads;
  await rm(uploadsDir, { recursive: true, force: true });
});

afterEach(() => {
  routeEnv.actor = null;
});

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
  return { orgId, owner: { userId: users[0].id, orgId }, member: { userId: users[1].id, orgId } };
}

async function audits(ticketId: string, action: "SNOOZED" | "WOKEN") {
  return prisma.ticketAuditEvent.findMany({
    where: { ticketId, action },
    orderBy: { createdAt: "asc" },
    select: { actorType: true, actorUserId: true, before: true, after: true },
  });
}

async function snoozedUntil(ticketId: string): Promise<Date | null> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { snoozedUntil: true },
  });
  return row.snoozedUntil;
}

describe("snooze tracer (D-12, D-13)", () => {
  it("snoozes through the service and the job wakes it exactly once", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedTicket(orgId);
    const now = new Date();
    const until = new Date(now.getTime() + 10 * MIN);

    const result = await snoozeTicket(prisma, owner, { ticketId: ticket.id, until }, { now });
    expect(result).toEqual({ ok: true, ticketId: ticket.id, snoozedUntil: until });
    expect((await snoozedUntil(ticket.id))?.toISOString()).toBe(until.toISOString());
    const snoozed = await audits(ticket.id, "SNOOZED");
    expect(snoozed).toEqual([
      {
        actorType: "USER",
        actorUserId: owner.userId,
        before: { snoozedUntil: null },
        after: { snoozedUntil: until.toISOString() },
      },
    ]);

    const wakeAt = new Date(until.getTime() + 1000);
    const first = await snoozeWakeHandler(undefined, { now: wakeAt });
    expect(first.woken).toBeGreaterThanOrEqual(1);
    expect(await snoozedUntil(ticket.id)).toBeNull();
    expect(await audits(ticket.id, "WOKEN")).toEqual([
      {
        actorType: "SYSTEM",
        actorUserId: null,
        before: { snoozedUntil: until.toISOString() },
        after: { snoozedUntil: null },
      },
    ]);

    const second = await snoozeWakeHandler(undefined, { now: wakeAt });
    expect(second).toEqual({ woken: 0 });
    expect(await audits(ticket.id, "WOKEN")).toHaveLength(1);
  });
});

/** Sets a deadline directly (fixture write; production writes go through snoozeTicket). */
async function setDeadline(ticketId: string, until: Date | null) {
  await prisma.ticket.update({ where: { id: ticketId }, data: { snoozedUntil: until } });
}

async function auditCount(ticketId: string) {
  return prisma.ticketAuditEvent.count({ where: { ticketId } });
}

async function enableAutoClose(orgId: string, now: Date) {
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
}

async function followUp(ticketId: string) {
  const { statusToken } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  const form = new FormData();
  form.set("message", `Follow-up ${randomUUID()}`);
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
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

async function emailReply(orgId: string, ticketNumber: number, headers?: Record<string, string>) {
  const buf = await new MailComposer({
    from: `customer-${randomUUID()}@example.com`,
    to: SELF_ADDRESS,
    subject: `Re: my question [#${ticketNumber}]`,
    text: "Thanks, one more thing.",
    messageId: `<snooze-${randomUUID()}@test.local>`,
    headers,
  })
    .compile()
    .build();
  const parsed = await simpleParser(buf);
  return ingestMessage(orgId, buf, SELF_ADDRESS, deriveEmailMessageId(buf, parsed.messageId));
}

function agentMessage(ticketId: string, mode: "public" | "internal") {
  const form = new FormData();
  form.set("mode", mode);
  form.set("body", `Agent ${mode} ${randomUUID()}`);
  return agentPost(
    new Request(`http://localhost/api/tickets/${ticketId}/messages`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id: ticketId }) },
  );
}

describe("snooze refusals (D-12)", () => {
  it("refuses CLOSED, a CLOSED merged source (MERGED_SOURCE first), and both bounds; changes nothing", async () => {
    const { orgId, owner } = await seedOrg();
    const now = new Date();
    const inTen = new Date(now.getTime() + 10 * MIN);

    const closed = await seedTicket(orgId, { status: "CLOSED" });
    expect(
      await snoozeTicket(prisma, owner, { ticketId: closed.id, until: inTen }, { now }),
    ).toEqual({ ok: false, error: "TICKET_CLOSED" });

    const contactEmail = `snooze-${randomUUID()}@example.test`;
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    expect(
      await mergeTickets(prisma, owner, { sourceTicketId: s.id, targetTicketId: t.id }),
    ).toMatchObject({ ok: true });
    const source = await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } });
    expect(source.status).toBe("CLOSED");
    expect(await snoozeTicket(prisma, owner, { ticketId: s.id, until: inTen }, { now })).toEqual({
      ok: false,
      error: "MERGED_SOURCE",
    });

    const open = await seedTicket(orgId);
    const before = await auditCount(open.id);
    const tooSoon = new Date(now.getTime() + 3 * MIN);
    const tooFar = new Date(now.getTime() + 367 * DAY);
    expect(
      await snoozeTicket(prisma, owner, { ticketId: open.id, until: tooSoon }, { now }),
    ).toEqual({ ok: false, error: "TOO_SOON" });
    expect(
      await snoozeTicket(prisma, owner, { ticketId: open.id, until: tooFar }, { now }),
    ).toEqual({
      ok: false,
      error: "TOO_FAR",
    });
    expect(
      await snoozeTicket(
        prisma,
        owner,
        { ticketId: open.id, until: new Date(Number.NaN) },
        { now },
      ),
    ).toEqual({ ok: false, error: "INVALID" });
    for (const id of [closed.id, s.id, open.id]) expect(await snoozedUntil(id)).toBeNull();
    expect(await auditCount(open.id)).toBe(before);
    expect(await audits(s.id, "SNOOZED")).toEqual([]);

    const atMin = new Date(now.getTime() + SNOOZE_MIN_LEAD_MS);
    const atMax = new Date(now.getTime() + SNOOZE_MAX_LEAD_MS);
    expect(
      await snoozeTicket(prisma, owner, { ticketId: open.id, until: atMin }, { now }),
    ).toMatchObject({ ok: true });
    const other = await seedTicket(orgId, { status: "RESOLVED", resolvedAt: now });
    expect(
      await snoozeTicket(prisma, owner, { ticketId: other.id, until: atMax }, { now }),
    ).toMatchObject({ ok: true });
    expect((await snoozedUntil(other.id))?.toISOString()).toBe(atMax.toISOString());
  });

  it("refuses another organization's ticket, an unknown id, an ended membership and NOT_SNOOZED", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const now = new Date();
    const until = new Date(now.getTime() + 30 * MIN);
    const bTicket = await seedTicket(b.orgId);
    await setDeadline(bTicket.id, until);
    const bAudits = await auditCount(bTicket.id);

    expect(await snoozeTicket(prisma, a.owner, { ticketId: bTicket.id, until }, { now })).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await wakeTicket(prisma, a.owner, { ticketId: bTicket.id })).toEqual({
      ok: false,
      error: "TICKET_UNAVAILABLE",
    });
    expect(await snoozeTicket(prisma, a.owner, { ticketId: randomUUID(), until }, { now })).toEqual(
      {
        ok: false,
        error: "TICKET_UNAVAILABLE",
      },
    );
    expect((await snoozedUntil(bTicket.id))?.toISOString()).toBe(until.toISOString());
    expect(await auditCount(bTicket.id)).toBe(bAudits);

    const aTicket = await seedTicket(a.orgId);
    expect(await wakeTicket(prisma, a.owner, { ticketId: aTicket.id })).toEqual({
      ok: false,
      error: "NOT_SNOOZED",
    });

    await setDeadline(aTicket.id, until);
    const aAudits = await auditCount(aTicket.id);
    await prisma.member.deleteMany({ where: { userId: a.member.userId, organizationId: a.orgId } });
    const later = new Date(now.getTime() + 60 * MIN);
    expect(
      await snoozeTicket(prisma, a.member, { ticketId: aTicket.id, until: later }, { now }),
    ).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await wakeTicket(prisma, a.member, { ticketId: aTicket.id })).toEqual({
      ok: false,
      error: "MEMBERSHIP_ENDED",
    });
    expect((await snoozedUntil(aTicket.id))?.toISOString()).toBe(until.toISOString());
    expect(await auditCount(aTicket.id)).toBe(aAudits);
  });
});

describe("snooze edges (AIDA-54)", () => {
  it("wakes a deadline equal to the job's now and not one a millisecond later", async () => {
    const { orgId } = await seedOrg();
    const at = new Date(Date.now() - 5 * MIN);
    const due = await seedTicket(orgId);
    const notYet = await seedTicket(orgId);
    await setDeadline(due.id, at);
    await setDeadline(notYet.id, new Date(at.getTime() + 1));

    await snoozeWakeHandler(undefined, { now: at });
    expect(await snoozedUntil(due.id)).toBeNull();
    expect(await audits(due.id, "WOKEN")).toHaveLength(1);
    expect((await snoozedUntil(notYet.id))?.getTime()).toBe(at.getTime() + 1);
    expect(await audits(notYet.id, "WOKEN")).toEqual([]);
    await setDeadline(notYet.id, null);
  });

  it("a re-snooze replaces the deadline; a status change keeps it; a CLOSED ticket can be woken", async () => {
    const { orgId, owner } = await seedOrg();
    const now = new Date();
    const first = new Date(now.getTime() + 30 * MIN);
    const second = new Date(now.getTime() + 90 * MIN);
    const ticket = await seedTicket(orgId);

    await snoozeTicket(prisma, owner, { ticketId: ticket.id, until: first }, { now });
    expect(
      await snoozeTicket(prisma, owner, { ticketId: ticket.id, until: second }, { now }),
    ).toMatchObject({ ok: true });
    const snoozed = await audits(ticket.id, "SNOOZED");
    expect(snoozed[1]).toMatchObject({
      before: { snoozedUntil: first.toISOString() },
      after: { snoozedUntil: second.toISOString() },
    });

    const status = await runTicketMutation({
      actor: owner,
      ticketIds: [ticket.id],
      op: { kind: "status", status: "PENDING" },
      mode: "single",
    });
    expect(status).toMatchObject({ ok: true });
    expect((await snoozedUntil(ticket.id))?.toISOString()).toBe(second.toISOString());

    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    expect(await wakeTicket(prisma, owner, { ticketId: ticket.id })).toEqual({
      ok: true,
      ticketId: ticket.id,
    });
    expect(await snoozedUntil(ticket.id)).toBeNull();
    expect(await audits(ticket.id, "WOKEN")).toEqual([
      {
        actorType: "USER",
        actorUserId: owner.userId,
        before: { snoozedUntil: second.toISOString() },
        after: { snoozedUntil: null },
      },
    ]);
  });

  it("auto-close skips a snoozed RESOLVED ticket past its quiet period, and closes it after a wake", async () => {
    const { orgId, owner } = await seedOrg();
    const now = new Date();
    await enableAutoClose(orgId, now);
    const ticket = await seedTicket(orgId, {
      status: "RESOLVED",
      resolvedAt: new Date(now.getTime() - 10 * DAY),
    });
    await snoozeTicket(prisma, owner, {
      ticketId: ticket.id,
      until: new Date(now.getTime() + DAY),
    });

    await autoCloseHandler(undefined, { now, log: () => {} });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
      "RESOLVED",
    );
    expect(
      await prisma.ticketAuditEvent.count({
        where: { ticketId: ticket.id, action: "AUTO_CLOSED" },
      }),
    ).toBe(0);

    expect(await wakeTicket(prisma, owner, { ticketId: ticket.id })).toMatchObject({ ok: true });
    await autoCloseHandler(undefined, { now, log: () => {} });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
      "CLOSED",
    );
  });
});

describe("customer replies wake a snoozed ticket (D-14)", () => {
  it("a follow-up and an inbound email wake with WOKEN before = the deadline; automatic mail does not", async () => {
    const { orgId } = await seedOrg();
    const deadline = new Date(Date.now() + 2 * 60 * MIN);
    const expectedWoken = [
      {
        actorType: "SYSTEM",
        actorUserId: null,
        before: { snoozedUntil: deadline.toISOString() },
        after: { snoozedUntil: null },
      },
    ];

    const viaFollowUp = await seedTicket(orgId);
    await setDeadline(viaFollowUp.id, deadline);
    expect(await followUp(viaFollowUp.id)).toBeLessThan(300);
    expect(await snoozedUntil(viaFollowUp.id)).toBeNull();
    expect(await audits(viaFollowUp.id, "WOKEN")).toEqual(expectedWoken);

    const viaEmail = await seedTicket(orgId);
    await setDeadline(viaEmail.id, deadline);
    await emailReply(orgId, viaEmail.number);
    expect(await snoozedUntil(viaEmail.id)).toBeNull();
    expect(await audits(viaEmail.id, "WOKEN")).toEqual(expectedWoken);

    const viaAuto = await seedTicket(orgId, { status: "RESOLVED", resolvedAt: new Date() });
    await setDeadline(viaAuto.id, deadline);
    await emailReply(orgId, viaAuto.number, { "Auto-Submitted": "auto-replied" });
    expect((await snoozedUntil(viaAuto.id))?.toISOString()).toBe(deadline.toISOString());
    expect(await audits(viaAuto.id, "WOKEN")).toEqual([]);
    expect(await prisma.message.count({ where: { ticketId: viaAuto.id } })).toBeGreaterThan(1);
  });

  it("an agent reply and an internal note do not wake", async () => {
    const { orgId, owner } = await seedOrg();
    await prisma.setting.create({
      data: { organizationId: orgId, key: "email:enabled", value: "true" },
    });
    routeEnv.actor = owner;
    const deadline = new Date(Date.now() + 2 * 60 * MIN);
    const ticket = await seedTicket(orgId);
    await setDeadline(ticket.id, deadline);

    expect((await agentMessage(ticket.id, "public")).ok).toBe(true);
    expect((await agentMessage(ticket.id, "internal")).ok).toBe(true);
    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(3);
    expect((await snoozedUntil(ticket.id))?.toISOString()).toBe(deadline.toISOString());
    expect(await audits(ticket.id, "WOKEN")).toEqual([]);
  });

  it("a follow-up through a merged source's token wakes the snoozed target", async () => {
    const { orgId, owner } = await seedOrg();
    const contactEmail = `snooze-${randomUUID()}@example.test`;
    const s = await seedContactTicket(orgId, { contactEmail });
    const t = await seedContactTicket(orgId, { contactEmail });
    await mergeTickets(prisma, owner, { sourceTicketId: s.id, targetTicketId: t.id });
    const deadline = new Date(Date.now() + 2 * 60 * MIN);
    expect(await snoozeTicket(prisma, owner, { ticketId: t.id, until: deadline })).toMatchObject({
      ok: true,
    });

    expect(await followUp(s.id)).toBeLessThan(300);
    expect(await snoozedUntil(t.id)).toBeNull();
    expect(await audits(t.id, "WOKEN")).toEqual([
      {
        actorType: "SYSTEM",
        actorUserId: null,
        before: { snoozedUntil: deadline.toISOString() },
        after: { snoozedUntil: null },
      },
    ]);
  });
});
