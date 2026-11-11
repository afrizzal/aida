// The notification producers of Phase 10 (plan 10-06, AIDA-44) on a real Postgres through
// Testcontainers, with nothing mocked: ASSIGNED inside the one ticket mutation service (V-08,
// D-16), and CUSTOMER_REPLY on the two writers that append an INBOUND message to an existing
// ticket (V-10, V-28, owner item 11 option b, O-7 defaults). Each case seeds fresh organizations.
//
// The INBOUND writers and their cases (C11 part 3, V-10):
//   - email ingest appending to a ticket (ingest-message.ts): emits, "CUSTOMER_REPLY: email ...";
//   - the status-page follow-up (follow-up/route.ts): emits, "CUSTOMER_REPLY: follow-up ...";
//   - email ingest opening a new ticket through createTicket: no emit (O-7 (a));
//   - public intake (intake/route.ts): no emit (O-7 (a));
//   - the demo seed (createTicket and insertDemoReplies): exempt, seeded history is not an event.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The follow-up and intake routes store files under UPLOADS_DIR, which the storage module reads
// when it loads, so a fresh temporary directory is set before any import pulls it in.
const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-notification-emitters-"));
  process.env.UPLOADS_DIR = dir;
  // A test-only value; the public routes hash rate-limit identifiers with it.
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "notification-emitters-test";
  return { dir };
});

import { POST as intakePost } from "@/app/api/public/intake/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { deriveEmailMessageId, ingestMessage } from "@/lib/channels/email/ingest-message";
import { prisma } from "@/lib/db";
import { seedDemoData } from "@/lib/demo/seed-demo-data";
import { setUnassignedSetting } from "@/lib/notifications/preferences";
import { countUnread } from "@/lib/notifications/store";
import { mergeTickets } from "@/lib/tickets/merge";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { uniqueClientIp } from "../support/client-ip";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";
import { seedContactTicket } from "../support/lifecycle-fixtures";

const SELF_ADDRESS = "support@aida.test";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

function notificationsOf(orgId: string) {
  return prisma.notification.findMany({
    where: { organizationId: orgId },
    orderBy: [{ recipientUserId: "asc" }, { eventKey: "asc" }],
  });
}

describe("ASSIGNED in runTicketMutation (V-08, D-16)", () => {
  it("tracer: an owner assigns a member a ticket, and the member gets one ASSIGNED row in the same commit", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, member] = users;
    const ticket = await seedTicket(orgId);
    const now = new Date("2026-11-13T09:00:00.000Z");

    const result = await runTicketMutation(
      {
        actor: { userId: owner.id, orgId },
        ticketIds: [ticket.id],
        op: { kind: "assign", assigneeId: member.id },
        mode: "single",
      },
      { clock: () => now },
    );
    expect(result).toEqual({ ok: true, count: 1, batchId: null });

    const rows = await notificationsOf(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: orgId,
      recipientUserId: member.id,
      actorUserId: owner.id,
      type: "ASSIGNED",
      eventKey: `assigned:${ticket.id}:${now.toISOString()}`,
      entityType: "ticket",
      entityId: ticket.id,
      unassignedFallback: false,
      readAt: null,
      archivedAt: null,
    });
    expect(await countUnread(orgId, member.id)).toBe(1);
    expect(await countUnread(orgId, owner.id)).toBe(0);
  });

  it("self-assignment notifies nobody", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
    const [admin] = users;
    const ticket = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor: { userId: admin.id, orgId },
      ticketIds: [ticket.id],
      op: { kind: "assign", assigneeId: admin.id },
      mode: "single",
    });
    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.assigneeId).toBe(admin.id);
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("re-assigning the current assignee notifies nobody", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, member] = users;
    const ticket = await seedTicket(orgId, { assigneeId: member.id });

    const result = await runTicketMutation({
      actor: { userId: owner.id, orgId },
      ticketIds: [ticket.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "single",
    });
    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("unassigning notifies nobody, neither the former assignee nor the owners and admins", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const [owner, , member] = users;
    const ticket = await seedTicket(orgId, { assigneeId: member.id });

    const result = await runTicketMutation({
      actor: { userId: owner.id, orgId },
      ticketIds: [ticket.id],
      op: { kind: "assign", assigneeId: null },
      mode: "single",
    });
    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.assigneeId).toBeNull();
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("a bulk assignment of three tickets to one member writes three rows with three event keys", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
    const [admin, member] = users;
    const tickets = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];
    const now = new Date("2026-11-13T09:30:00.000Z");

    const result = await runTicketMutation(
      {
        actor: { userId: admin.id, orgId },
        ticketIds: tickets.map((t) => t.id),
        op: { kind: "assign", assigneeId: member.id },
        mode: "bulk",
      },
      { clock: () => now },
    );
    expect(result).toMatchObject({ ok: true, count: 3 });

    const rows = await notificationsOf(orgId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.recipientUserId === member.id && r.type === "ASSIGNED")).toBe(true);
    expect(new Set(rows.map((r) => r.eventKey))).toEqual(
      new Set(tickets.map((t) => `assigned:${t.id}:${now.toISOString()}`)),
    );
    expect(new Set(rows.map((r) => r.entityId))).toEqual(new Set(tickets.map((t) => t.id)));
    expect(await countUnread(orgId, member.id)).toBe(3);
  });

  it("a bulk assignment where one ticket already has the assignee notifies only for the changed tickets", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
    const [admin, member] = users;
    const already = await seedTicket(orgId, { assigneeId: member.id });
    const fresh = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor: { userId: admin.id, orgId },
      ticketIds: [already.id, fresh.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "bulk",
    });
    expect(result).toMatchObject({ ok: true, count: 2 });
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => r.entityId)).toEqual([fresh.id]);
  });

  it("assignment to a user of another organization is MEMBER_NOT_ACTIVE and writes no row anywhere", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const b = await seedOrgWithMembers(prisma, ["member"]);
    const ticket = await seedTicket(a.orgId);

    const result = await runTicketMutation({
      actor: { userId: a.users[0].id, orgId: a.orgId },
      ticketIds: [ticket.id],
      op: { kind: "assign", assigneeId: b.users[0].id },
      mode: "single",
    });
    expect(result).toEqual({ ok: false, error: "MEMBER_NOT_ACTIVE" });
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.assigneeId).toBeNull();
    expect(await notificationsOf(a.orgId)).toEqual([]);
    expect(await notificationsOf(b.orgId)).toEqual([]);
  });

  it("a member who turned ASSIGNED off in-app gets no row, and the assignment still commits", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, member] = users;
    await prisma.notificationPreference.create({
      data: { organizationId: orgId, userId: member.id, type: "ASSIGNED", inApp: false },
    });
    const ticket = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor: { userId: owner.id, orgId },
      ticketIds: [ticket.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "single",
    });
    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.assigneeId).toBe(member.id);
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("a conditional reassignment that skips a ticket emits nothing for it (onlyIfAssignedTo)", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
    const [owner, from, to] = users;
    const stillFrom = await seedTicket(orgId, { assigneeId: from.id, status: "OPEN" });
    const movedAway = await seedTicket(orgId, { assigneeId: owner.id, status: "OPEN" });

    const result = await runTicketMutation({
      actor: { userId: owner.id, orgId },
      ticketIds: [stillFrom.id, movedAway.id],
      op: { kind: "assign", assigneeId: to.id, onlyIfAssignedTo: from.id },
      mode: "bulk",
    });
    expect(result).toMatchObject({ ok: true, count: 1, skipped: 1 });
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.entityId])).toEqual([[to.id, stillFrom.id]]);
  });

  it("a refused mutation rolls the notification back with everything else", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, member] = users;
    const ticket = await seedTicket(orgId);

    await expect(
      runTicketMutation(
        {
          actor: { userId: owner.id, orgId },
          ticketIds: [ticket.id],
          op: { kind: "assign", assigneeId: member.id },
          mode: "single",
        },
        {
          afterItem: () => {
            throw new Error("forced failure after the item");
          },
        },
      ),
    ).rejects.toThrow("forced failure after the item");
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.assigneeId).toBeNull();
    expect(await notificationsOf(orgId)).toEqual([]);
  });
});

async function tokenOf(ticketId: string): Promise<string> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { statusToken: true },
  });
  return row.statusToken;
}

async function assign(ticketId: string, assigneeId: string | null): Promise<void> {
  await prisma.ticket.update({ where: { id: ticketId }, data: { assigneeId } });
}

/** Feeds one email through ingestMessage the way email-ingest.test.ts does. */
async function ingestEmail(orgId: string, subject: string, headers: Record<string, string> = {}) {
  const buf = await new MailComposer({
    from: `customer-${randomUUID()}@example.com`,
    to: SELF_ADDRESS,
    subject,
    text: `Customer text ${randomUUID()}`,
    messageId: `<emitters-${randomUUID()}@test.local>`,
    headers,
  })
    .compile()
    .build();
  const parsed = await simpleParser(buf);
  const emailMessageId = deriveEmailMessageId(buf, parsed.messageId);
  const result = await ingestMessage(orgId, buf, SELF_ADDRESS, emailMessageId);
  const message = await prisma.message.findFirst({
    where: { organizationId: orgId, emailMessageId },
    select: { id: true, ticketId: true },
  });
  return { result, message };
}

/** Calls the follow-up route's POST with a constructed Request from a fresh client identity. */
async function followUp(token: string, body: string): Promise<Response> {
  const form = new FormData();
  form.set("message", body);
  return followUpPost(
    new Request(`http://localhost/api/public/status/${token}/follow-up`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": uniqueClientIp() },
    }),
    { params: Promise.resolve({ token }) },
  );
}

async function inboundByBody(orgId: string, body: string) {
  return prisma.message.findFirstOrThrow({
    where: { organizationId: orgId, direction: "INBOUND", bodyMarkdown: body },
    select: { id: true, ticketId: true },
  });
}

describe("CUSTOMER_REPLY: email ingest appending to a ticket (V-10, ingest-message.ts)", () => {
  it("a reply threaded onto an assigned ticket notifies the assignee once; two replies make two rows", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const [, , member] = users;
    const ticket = await seedTicket(orgId, { assigneeId: member.id });

    const first = await ingestEmail(orgId, `Re: help [#${ticket.number}]`);
    expect(first.result).toBe("appended");
    expect(first.message?.ticketId).toBe(ticket.id);
    let rows = await notificationsOf(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientUserId: member.id,
      actorUserId: null,
      type: "CUSTOMER_REPLY",
      eventKey: `message:${first.message?.id}`,
      entityType: "ticket",
      entityId: ticket.id,
      unassignedFallback: false,
    });

    const second = await ingestEmail(orgId, `Re: help again [#${ticket.number}]`);
    expect(second.result).toBe("appended");
    rows = await notificationsOf(orgId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.eventKey))).toEqual(
      new Set([`message:${first.message?.id}`, `message:${second.message?.id}`]),
    );
    expect(rows.every((r) => r.recipientUserId === member.id)).toBe(true);
    expect(await countUnread(orgId, member.id)).toBe(2);
  });

  // Review c-IN-01 (F3): auto mail (an out-of-office, an auto-acknowledgement) threads onto the
  // ticket and never reopens it (D-13); it is not a customer reply either, so it notifies nobody.
  it("an auto-reply threaded onto a ticket is appended but notifies nobody, on an assigned or an unassigned ticket", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const [, , member] = users;
    const assigned = await seedTicket(orgId, { assigneeId: member.id });
    const unassigned = await seedTicket(orgId);

    // Presence: a human reply notifies the assignee.
    const human = await ingestEmail(orgId, `Re: help [#${assigned.number}]`);
    expect(human.result).toBe("appended");
    expect(await notificationsOf(orgId)).toHaveLength(1);

    const autoHeaders: Record<string, string>[] = [
      { "Auto-Submitted": "auto-replied" },
      { "Auto-Submitted": "auto-generated" },
      { Precedence: "auto_reply" },
    ];
    for (const headers of autoHeaders) {
      for (const ticket of [assigned, unassigned]) {
        const auto = await ingestEmail(
          orgId,
          `Out of office: Re: help [#${ticket.number}]`,
          headers,
        );
        expect(auto.result).toBe("appended");
        expect(auto.message?.ticketId).toBe(ticket.id);
      }
    }
    expect(await notificationsOf(orgId)).toHaveLength(1);
  });

  it("a reply threaded onto a merged source notifies the target's assignee and names the target", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member", "member"]);
    const [admin, sourceAssignee, targetAssignee] = users;
    const contactEmail = `emitters-${randomUUID()}@example.test`;
    const source = await seedContactTicket(orgId, { contactEmail });
    const target = await seedContactTicket(orgId, { contactEmail });
    await assign(source.id, sourceAssignee.id);
    await assign(target.id, targetAssignee.id);
    const merged = await mergeTickets(
      prisma,
      { userId: admin.id, orgId },
      { sourceTicketId: source.id, targetTicketId: target.id, reviewedLinkLabel: null },
    );
    expect(merged).toMatchObject({ ok: true });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });

    const reply = await ingestEmail(orgId, `Re: old thread [#${source.number}]`);
    expect(reply.result).toBe("appended");
    expect(reply.message?.ticketId).toBe(target.id);
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type, r.entityId, r.eventKey])).toEqual([
      [targetAssignee.id, "CUSTOMER_REPLY", target.id, `message:${reply.message?.id}`],
    ]);
  });

  it("a reply on an unassigned ticket notifies every owner and admin (unassignedFallback) except one who opted out; a member gets nothing", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, [
      "owner",
      "admin",
      "admin",
      "member",
    ]);
    const [owner, admin, optedOut, member] = users;
    expect(await setUnassignedSetting(orgId, optedOut.id, false)).toBe(false);
    const ticket = await seedTicket(orgId);

    const reply = await ingestEmail(orgId, `Re: anyone? [#${ticket.number}]`);
    expect(reply.result).toBe("appended");
    const rows = await notificationsOf(orgId);
    expect(new Set(rows.map((r) => r.recipientUserId))).toEqual(new Set([owner.id, admin.id]));
    expect(rows.every((r) => r.unassignedFallback === true)).toBe(true);
    expect(rows.every((r) => r.type === "CUSTOMER_REPLY")).toBe(true);
    expect(rows.every((r) => r.eventKey === `message:${reply.message?.id}`)).toBe(true);
    expect(rows.some((r) => r.recipientUserId === member.id)).toBe(false);
    expect(rows.some((r) => r.recipientUserId === optedOut.id)).toBe(false);
  });

  it("a reply on a ticket whose assignee's member rows were deleted notifies nobody (O-7 (b))", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const [, , former] = users;
    const ticket = await seedTicket(orgId, { assigneeId: former.id });
    await prisma.member.deleteMany({ where: { organizationId: orgId, userId: former.id } });

    const reply = await ingestEmail(orgId, `Re: still there? [#${ticket.number}]`);
    expect(reply.result).toBe("appended");
    expect(reply.message?.ticketId).toBe(ticket.id);
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("the notification carries ids, a type and an event key only, never the customer's text (T-10-25)", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const ticket = await seedTicket(orgId, { assigneeId: users[1].id });
    const reply = await ingestEmail(orgId, `Re: secret [#${ticket.number}]`);
    const body = await prisma.message.findUniqueOrThrow({
      where: { id: reply.message?.id ?? "" },
      select: { bodyMarkdown: true },
    });
    const rows = await notificationsOf(orgId);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(body.bodyMarkdown.trim());
  });
});

describe("CUSTOMER_REPLY: the status-page follow-up (V-10, follow-up/route.ts)", () => {
  it("a follow-up on an assigned ticket notifies the assignee once", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [, member] = users;
    const ticket = await seedContactTicket(orgId, {
      contactEmail: `emitters-${randomUUID()}@example.test`,
    });
    await assign(ticket.id, member.id);
    const body = `follow-up ${randomUUID()}`;

    expect((await followUp(await tokenOf(ticket.id), body)).status).toBe(200);
    const message = await inboundByBody(orgId, body);
    const rows = await notificationsOf(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientUserId: member.id,
      actorUserId: null,
      type: "CUSTOMER_REPLY",
      eventKey: `message:${message.id}`,
      entityId: ticket.id,
      unassignedFallback: false,
    });
  });

  it("a follow-up through a merged source's token notifies the target's assignee and names the target", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member", "member"]);
    const [admin, sourceAssignee, targetAssignee] = users;
    const contactEmail = `emitters-${randomUUID()}@example.test`;
    const source = await seedContactTicket(orgId, { contactEmail });
    const target = await seedContactTicket(orgId, { contactEmail });
    await assign(source.id, sourceAssignee.id);
    await assign(target.id, targetAssignee.id);
    expect(
      await mergeTickets(
        prisma,
        { userId: admin.id, orgId },
        { sourceTicketId: source.id, targetTicketId: target.id, reviewedLinkLabel: null },
      ),
    ).toMatchObject({ ok: true });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    const body = `merged follow-up ${randomUUID()}`;

    expect((await followUp(await tokenOf(source.id), body)).status).toBe(200);
    const message = await inboundByBody(orgId, body);
    expect(message.ticketId).toBe(target.id);
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.type, r.entityId, r.eventKey])).toEqual([
      [targetAssignee.id, "CUSTOMER_REPLY", target.id, `message:${message.id}`],
    ]);
  });

  it("a follow-up on an unassigned ticket notifies the owners and admins (unassignedFallback), not the opted-out admin or a member", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const [owner, optedOut, member] = users;
    await setUnassignedSetting(orgId, optedOut.id, false);
    const ticket = await seedContactTicket(orgId, {
      contactEmail: `emitters-${randomUUID()}@example.test`,
    });
    const body = `unassigned follow-up ${randomUUID()}`;

    expect((await followUp(await tokenOf(ticket.id), body)).status).toBe(200);
    const message = await inboundByBody(orgId, body);
    const rows = await notificationsOf(orgId);
    expect(rows.map((r) => [r.recipientUserId, r.unassignedFallback, r.eventKey])).toEqual([
      [owner.id, true, `message:${message.id}`],
    ]);
    expect(rows.some((r) => r.recipientUserId === member.id)).toBe(false);
  });

  it("a follow-up whose ticket's assignee is no longer a member notifies nobody (O-7 (b))", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [, former] = users;
    const ticket = await seedContactTicket(orgId, {
      contactEmail: `emitters-${randomUUID()}@example.test`,
    });
    await assign(ticket.id, former.id);
    await prisma.member.deleteMany({ where: { organizationId: orgId, userId: former.id } });

    expect((await followUp(await tokenOf(ticket.id), `gone ${randomUUID()}`)).status).toBe(200);
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("a follow-up honeypot hit writes no message and no notification", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const ticket = await seedContactTicket(orgId, {
      contactEmail: `emitters-${randomUUID()}@example.test`,
    });
    const token = await tokenOf(ticket.id);
    const form = new FormData();
    form.set("message", "bot text");
    form.set("company_website", "https://spam.example");
    const response = await followUpPost(
      new Request(`http://localhost/api/public/status/${token}/follow-up`, {
        method: "POST",
        body: form,
        headers: { "x-forwarded-for": uniqueClientIp() },
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(response.status).toBe(200);
    expect(await notificationsOf(orgId)).toEqual([]);
  });
});

describe("no notification for new tickets and seeded history (O-7 (a), V-10)", () => {
  it("an email that opens a new ticket through createTicket notifies nobody", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const opened = await ingestEmail(orgId, `Brand new problem ${randomUUID()}`);
    expect(opened.result).toBe("created");
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: opened.message?.ticketId ?? "" },
      select: { assigneeId: true },
    });
    expect(ticket.assigneeId).toBeNull();
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("a public intake submission notifies nobody", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    // Single-org v1: intake resolves the one organization with findFirstOrThrow; pin it to the
    // seeded one (the pattern of file-delete-inventory.test.ts). The database is not mocked.
    vi.spyOn(prisma.organization, "findFirstOrThrow").mockResolvedValue(org as never);
    const subject = `intake ${randomUUID()}`;
    const form = new FormData();
    form.set("name", "Intake Customer");
    form.set("email", `intake-${randomUUID()}@example.test`);
    form.set("subject", subject);
    form.set("message", "Please help with my order.");
    const response = await intakePost(
      new Request("http://localhost/api/public/intake", {
        method: "POST",
        headers: { "x-forwarded-for": uniqueClientIp() },
        body: form,
      }),
    );
    expect(response.status).toBeLessThan(300);
    const created = await prisma.ticket.findFirstOrThrow({
      where: { organizationId: orgId, subject },
      select: { id: true, assigneeId: true },
    });
    expect(created.assigneeId).toBeNull();
    expect(
      await prisma.message.count({ where: { ticketId: created.id, direction: "INBOUND" } }),
    ).toBe(1);
    expect(await notificationsOf(orgId)).toEqual([]);
  });

  it("the demo seed writes INBOUND rows (createTicket and insertDemoReplies) and emits nothing", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
    const summary = await seedDemoData({
      orgId,
      adminUserId: users[0].id,
      agentUserId: users[1].id,
    });
    expect(summary.tickets).toBeGreaterThan(0);
    const inbound = await prisma.message.count({
      where: { organizationId: orgId, direction: "INBOUND" },
    });
    expect(inbound).toBeGreaterThan(summary.tickets);
    expect(await notificationsOf(orgId)).toEqual([]);
  });
});
