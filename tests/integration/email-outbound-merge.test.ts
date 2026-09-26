// Phase 12, Codex diff round 2, R2-2 (run decision K37, replaces K36) and round 3, R3-1 (run
// decision K38, refines K37): an outbound reply keeps the email thread of the ticket it was
// written on, also when that ticket is merged between queueing and sending, and a ticket's
// thread is the messages written on it, never the ones moved in by a merge. Real Postgres through Testcontainers. Only the SMTP transport is a
// test double that records each mail: no SMTP server is contacted and no email is sent.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageDirection } from "@/generated/prisma/client";
import { saveEmailSettings } from "@/lib/channels/email/settings";
import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { type MergeActor, mergeTickets } from "@/lib/tickets/merge";
import {
  emailOutboundSendHandler,
  setOutboundSendObserverForTests,
} from "@/lib/worker/jobs/email-outbound-send";
import { seedContactTicket, seedOrgWithMembers } from "../support/lifecycle-fixtures";

interface SentMail {
  to: unknown;
  subject: string;
  inReplyTo?: string;
  references?: string;
}

// sent: the mails the fake accepted. attempts: every mail handed to it, a refused one included.
// failNext: how many of the next sends the fake refuses (it throws, as a failed SMTP send).
const transport = vi.hoisted(() => ({
  sent: [] as SentMail[],
  attempts: [] as SentMail[],
  failNext: 0,
}));

// The worker imports this module by a relative path; the alias resolves to the same file, so
// the worker gets this fake transport.
vi.mock("@/lib/channels/email/smtp-client", () => ({
  createSmtpTransport: () => ({
    sendMail: async (mail: SentMail) => {
      transport.attempts.push(mail);
      if (transport.failNext > 0) {
        transport.failNext -= 1;
        throw new Error("fake SMTP refused the send");
      }
      transport.sent.push(mail);
      return { messageId: "fake" };
    },
  }),
}));

afterEach(() => {
  transport.sent.length = 0;
  transport.attempts.length = 0;
  transport.failNext = 0;
  setOutboundSendObserverForTests(null);
  vi.restoreAllMocks();
});

async function seedPair() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  await saveEmailSettings(scopedDb(orgId), orgId, {
    enabled: true,
    fromAddress: "support@outbound-merge.test",
    smtpHost: "fake-smtp.invalid",
    smtpPort: 2525,
    smtpSecure: false,
    smtpUser: "fake",
  });
  const contactEmail = `outbound-merge-${randomUUID()}@example.test`;
  const s = await seedContactTicket(orgId, { contactEmail });
  const t = await seedContactTicket(orgId, { contactEmail });
  const subjects = await prisma.ticket.findMany({
    where: { id: { in: [s.id, t.id] } },
    select: { id: true, subject: true },
  });
  const subjectOf = (id: string) => subjects.find((row) => row.id === id)?.subject ?? "";
  return {
    orgId,
    actor,
    contactEmail,
    s: { ...s, subject: subjectOf(s.id) },
    t: { ...t, subject: subjectOf(t.id) },
  };
}

let clock = Date.parse("2026-11-01T08:00:00.000Z");
/** Strictly increasing createdAt values, so the thread order never depends on timing. */
function nextTime(): Date {
  clock += 60_000;
  return new Date(clock);
}

/** One email-bearing message on the ticket, as ingest or an earlier send leaves it. */
async function emailMessage(
  orgId: string,
  ticketId: string,
  direction: MessageDirection,
  emailMessageId: string,
) {
  await prisma.message.create({
    data: {
      organizationId: orgId,
      ticketId,
      direction,
      visibility: "PUBLIC",
      bodyMarkdown: `Thread ${emailMessageId}`,
      bodyHtml: `<p>Thread ${emailMessageId}</p>`,
      emailMessageId,
      createdAt: nextTime(),
    },
  });
}

/** A public agent reply waiting for the worker (QUEUED, no Message-ID yet). */
async function queuedReply(orgId: string, ticketId: string): Promise<string> {
  const row = await prisma.message.create({
    data: {
      organizationId: orgId,
      ticketId,
      direction: "OUTBOUND",
      visibility: "PUBLIC",
      bodyMarkdown: "Queued reply",
      bodyHtml: "<p>Queued reply</p>",
      deliveryStatus: "QUEUED",
      createdAt: nextTime(),
    },
    select: { id: true },
  });
  return row.id;
}

/** The source's thread S1 (in), S2 (out), S3 (in) and the target's T1 (in), T2 (out). */
async function seedThreads(orgId: string, sId: string, tId: string) {
  const tag = randomUUID();
  const ids = {
    s1: `<s1-${tag}@customer.test>`,
    s2: `<s2-${tag}@outbound-merge.test>`,
    s3: `<s3-${tag}@customer.test>`,
    t1: `<t1-${tag}@customer.test>`,
    t2: `<t2-${tag}@outbound-merge.test>`,
  };
  await emailMessage(orgId, sId, "INBOUND", ids.s1);
  await emailMessage(orgId, tId, "INBOUND", ids.t1);
  await emailMessage(orgId, sId, "OUTBOUND", ids.s2);
  await emailMessage(orgId, tId, "OUTBOUND", ids.t2);
  await emailMessage(orgId, sId, "INBOUND", ids.s3);
  return ids;
}

describe("email-outbound-send keeps the thread of the ticket the reply was written on (R2-2, K37)", () => {
  it("(a) a reply queued on the source, then merged, then sent: the source's subject and references", async () => {
    const { orgId, actor, contactEmail, s, t } = await seedPair();
    const ids = await seedThreads(orgId, s.id, t.id);
    const replyId = await queuedReply(orgId, s.id);

    const merged = await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    expect(merged.ok).toBe(true);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: replyId } })).ticketId).toBe(
      t.id,
    );

    await emailOutboundSendHandler({ messageId: replyId });

    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail.subject).toBe(`Re: ${s.subject} [#${s.number}]`);
    expect(mail.references).toBe([ids.s1, ids.s2, ids.s3].join(" "));
    expect(mail.inReplyTo).toBe(ids.s3);
    expect(mail.to).toBe(contactEmail);
    const sent = await prisma.message.findUniqueOrThrow({ where: { id: replyId } });
    expect(sent.deliveryStatus).toBe("SENT");
  });

  it("(b) in flight: the message is read before the merge and the history after it, with the same result as (a)", async () => {
    const { orgId, actor, contactEmail, s, t } = await seedPair();
    const ids = await seedThreads(orgId, s.id, t.id);
    const replyId = await queuedReply(orgId, s.id);

    let mergedInFlight = false;
    setOutboundSendObserverForTests({
      afterMessageRead: async () => {
        const merged = await mergeTickets(prisma, actor, {
          sourceTicketId: s.id,
          targetTicketId: t.id,
          reviewedLinkLabel: null,
        });
        expect(merged.ok).toBe(true);
        mergedInFlight = true;
      },
    });

    await emailOutboundSendHandler({ messageId: replyId });

    expect(mergedInFlight).toBe(true);
    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail.subject).toBe(`Re: ${s.subject} [#${s.number}]`);
    expect(mail.references).toBe([ids.s1, ids.s2, ids.s3].join(" "));
    expect(mail.inReplyTo).toBe(ids.s3);
    expect(mail.to).toBe(contactEmail);
  });

  it("(c) a reply written on the target after the merge keeps the target's own thread (K38)", async () => {
    const { orgId, actor, contactEmail, s, t } = await seedPair();
    const ids = await seedThreads(orgId, s.id, t.id);
    const merged = await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    expect(merged.ok).toBe(true);
    const replyId = await queuedReply(orgId, t.id);

    await emailOutboundSendHandler({ messageId: replyId });

    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail.subject).toBe(`Re: ${t.subject} [#${t.number}]`);
    // K38: the target's thread is the messages written on the target. The messages moved in
    // from the source belong to the source's thread and never appear here.
    expect(mail.references).toBe([ids.t1, ids.t2].join(" "));
    expect(mail.inReplyTo).toBe(ids.t1);
    expect(mail.to).toBe(contactEmail);
  });

  it("(d) a source with a long history merged into the target: a target reply keeps the target's ids in References (K38)", async () => {
    const { orgId, actor, contactEmail, t, s } = await seedPair();
    const tag = randomUUID();
    const t1 = `<t1-${tag}@customer.test>`;
    const t2 = `<t2-${tag}@outbound-merge.test>`;
    await emailMessage(orgId, t.id, "INBOUND", t1);
    await emailMessage(orgId, t.id, "OUTBOUND", t2);
    // Twelve email-bearing source messages, all newer than the target's: more than the
    // 10-entry References cap, so a thread that took them in would push out t1 and t2.
    const sourceIds: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const inbound = i % 2 === 1;
      const id = `<s${i}-${tag}@${inbound ? "customer" : "outbound-merge"}.test>`;
      sourceIds.push(id);
      await emailMessage(orgId, s.id, inbound ? "INBOUND" : "OUTBOUND", id);
    }
    const merged = await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    expect(merged.ok).toBe(true);
    const replyId = await queuedReply(orgId, t.id);

    await emailOutboundSendHandler({ messageId: replyId });

    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail.subject).toBe(`Re: ${t.subject} [#${t.number}]`);
    expect(mail.references).toBe([t1, t2].join(" "));
    expect(mail.inReplyTo).toBe(t1);
    for (const id of sourceIds) expect(mail.references).not.toContain(id);
    expect(mail.to).toBe(contactEmail);
  });

  it("(e) a target reply whose first send fails before the merge and is retried after it keeps the same References and In-Reply-To (K38)", async () => {
    const { orgId, actor, contactEmail, s, t } = await seedPair();
    const ids = await seedThreads(orgId, s.id, t.id);
    const replyId = await queuedReply(orgId, t.id);
    vi.spyOn(console, "error").mockImplementation(() => {});

    transport.failNext = 1;
    await expect(emailOutboundSendHandler({ messageId: replyId })).rejects.toThrow(
      "fake SMTP refused the send",
    );
    expect(transport.sent).toHaveLength(0);
    expect(transport.attempts).toHaveLength(1);
    const [first] = transport.attempts;
    expect(first.references).toBe([ids.t1, ids.t2].join(" "));
    expect(first.inReplyTo).toBe(ids.t1);
    const failed = await prisma.message.findUniqueOrThrow({ where: { id: replyId } });
    expect(failed.deliveryStatus).toBe("FAILED");

    const merged = await mergeTickets(prisma, actor, {
      sourceTicketId: s.id,
      targetTicketId: t.id,
      reviewedLinkLabel: null,
    });
    expect(merged.ok).toBe(true);

    // The pg-boss retry: the same job runs again on the same message.
    await emailOutboundSendHandler({ messageId: replyId });

    expect(transport.sent).toHaveLength(1);
    const [retry] = transport.sent;
    expect(retry.references).toBe(first.references);
    expect(retry.inReplyTo).toBe(first.inReplyTo);
    expect(retry.subject).toBe(first.subject);
    expect(retry.to).toBe(contactEmail);
    const sent = await prisma.message.findUniqueOrThrow({ where: { id: replyId } });
    expect(sent.deliveryStatus).toBe("SENT");
  });
});
