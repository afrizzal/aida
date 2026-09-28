import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
// nodemailer's MailComposer isn't re-exported from the package root — import the subpath
// directly (mirrors tests/unit/compose-outbound.test.ts's established pattern).
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { deriveEmailMessageId, ingestMessage } from "@/lib/channels/email/ingest-message";
import { prisma } from "@/lib/db";
import { stateIdFor } from "../support/inbox-fixtures";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id`/`createdAt` — BA manages them internally, so we provide them here for tests
// (mirrors tests/integration/create-ticket.test.ts's makeOrgData).
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

const SELF_ADDRESS = "support@aida.test";

type FixtureOpts = {
  messageId: string;
  subject: string;
  from: string;
  text?: string;
  inReplyTo?: string;
  headers?: Record<string, string>;
};

// Builds a real RFC-MIME .eml buffer via nodemailer's MailComposer so every fixture is
// parsed by the exact same mailparser codepath ingestMessage uses in production.
async function buildFixture(opts: FixtureOpts): Promise<Buffer> {
  const composer = new MailComposer({
    from: opts.from,
    to: SELF_ADDRESS,
    subject: opts.subject,
    text: opts.text ?? "Body text.",
    messageId: opts.messageId,
    inReplyTo: opts.inReplyTo,
    headers: opts.headers,
  });
  return composer.compile().build();
}

async function deriveIdFor(buf: Buffer): Promise<string> {
  const parsed = await simpleParser(buf);
  return deriveEmailMessageId(buf, parsed.messageId);
}

describe("email-ingest", () => {
  let orgId: string;
  let fixture1: Buffer;
  let ticket1Id: string;
  let ticket1Number: number;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: makeOrgData("Org Email Ingest", "email-ingest"),
    });
    orgId = org.id;
  });

  it("1. new email with no thread headers creates a ticket", async () => {
    fixture1 = await buildFixture({
      messageId: "<fixture1@test.local>",
      subject: "Order issue",
      from: "customer1@example.com",
      text: "I have an issue with my order.",
    });
    const emailMessageId1 = await deriveIdFor(fixture1);

    const result = await ingestMessage(orgId, fixture1, SELF_ADDRESS, emailMessageId1);
    expect(result).toBe("created");

    const tickets = await prisma.ticket.findMany({ where: { organizationId: orgId } });
    expect(tickets).toHaveLength(1);
    ticket1Id = tickets[0].id;
    ticket1Number = tickets[0].number;
    // Phase 12.1 (D-11 Create ticket row): a new ticket starts in the organization's newStateId.
    const config = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(tickets[0].stateId).toBe(config.newStateId);
    expect(tickets[0].stateId).toBe(await stateIdFor(orgId, "NEW"));

    const message = await prisma.message.findFirst({ where: { emailMessageId: emailMessageId1 } });
    expect(message).not.toBeNull();
    expect(message?.direction).toBe("INBOUND");
    expect(message?.ticketId).toBe(ticket1Id);

    const contact = await prisma.contact.findFirst({
      where: { organizationId: orgId, email: "customer1@example.com" },
    });
    expect(contact).not.toBeNull();
  });

  it("2. reply via In-Reply-To threads onto the existing ticket (no new ticket)", async () => {
    const emailMessageId1 = await deriveIdFor(fixture1);
    const fixture2 = await buildFixture({
      messageId: "<fixture2@test.local>",
      subject: "Re: Order issue",
      from: "customer1@example.com",
      text: "Any update?",
      inReplyTo: emailMessageId1,
    });
    const emailMessageId2 = await deriveIdFor(fixture2);

    const result = await ingestMessage(orgId, fixture2, SELF_ADDRESS, emailMessageId2);
    expect(result).toBe("appended");

    const ticketCount = await prisma.ticket.count({ where: { organizationId: orgId } });
    expect(ticketCount).toBe(1);

    const messageCount = await prisma.message.count({ where: { ticketId: ticket1Id } });
    expect(messageCount).toBe(2);
  });

  it("3. re-ingesting the same fixture buffer is deduped (no new message)", async () => {
    const emailMessageId1 = await deriveIdFor(fixture1);

    const result = await ingestMessage(orgId, fixture1, SELF_ADDRESS, emailMessageId1);
    expect(result).toBe("duplicate");

    const messageCount = await prisma.message.count({ where: { ticketId: ticket1Id } });
    expect(messageCount).toBe(2);
  });

  it("4. subject [#N] token threads onto the ticket when header match misses", async () => {
    const fixture4 = await buildFixture({
      messageId: "<fixture4@test.local>",
      subject: `Re: whatever [#${ticket1Number}]`,
      from: "customer1@example.com",
      text: "Following up via a new email thread (no In-Reply-To).",
    });
    const emailMessageId4 = await deriveIdFor(fixture4);

    const result = await ingestMessage(orgId, fixture4, SELF_ADDRESS, emailMessageId4);
    expect(result).toBe("appended");

    const ticketCount = await prisma.ticket.count({ where: { organizationId: orgId } });
    expect(ticketCount).toBe(1);

    const messageCount = await prisma.message.count({ where: { ticketId: ticket1Id } });
    expect(messageCount).toBe(3);
  });

  it("5. auto-generated email with no thread match is dropped (no ticket created)", async () => {
    const fixture5 = await buildFixture({
      messageId: "<fixture5@test.local>",
      subject: "Weekly newsletter",
      from: "newsletter@bulk.example.com",
      text: "Bulk content.",
      headers: { "Auto-Submitted": "auto-replied" },
    });
    const emailMessageId5 = await deriveIdFor(fixture5);

    const result = await ingestMessage(orgId, fixture5, SELF_ADDRESS, emailMessageId5);
    expect(result).toBe("dropped-auto");

    const ticketCount = await prisma.ticket.count({ where: { organizationId: orgId } });
    expect(ticketCount).toBe(1);

    const message = await prisma.message.findFirst({ where: { emailMessageId: emailMessageId5 } });
    expect(message).toBeNull();
  });

  it("6. reply to a ticket in Resolved reopens it into the reopen state (triggeredReopen marker)", async () => {
    await prisma.ticket.update({
      where: { id: ticket1Id },
      data: { stateId: await stateIdFor(orgId, "RESOLVED"), resolvedAt: new Date() },
    });

    const emailMessageId1 = await deriveIdFor(fixture1);
    const fixture6 = await buildFixture({
      messageId: "<fixture6@test.local>",
      subject: "Re: Order issue",
      from: "customer1@example.com",
      text: "Actually it's still broken.",
      inReplyTo: emailMessageId1,
    });
    const emailMessageId6 = await deriveIdFor(fixture6);

    const result = await ingestMessage(orgId, fixture6, SELF_ADDRESS, emailMessageId6);
    expect(result).toBe("appended");

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket1Id } });
    const config = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(ticket.stateId).toBe(config.reopenStateId);
    expect(ticket.stateId).toBe(await stateIdFor(orgId, "OPEN"));
    expect(ticket.resolvedAt).toBeNull();

    const message = await prisma.message.findFirst({ where: { emailMessageId: emailMessageId6 } });
    expect(message?.triggeredReopen).toBe(true);
  });

  it("7. reply matched by header to a ticket in Pending keeps Pending, its slaPausedAt and its deadlines", async () => {
    const pausedAt = new Date("2026-11-01T10:00:00.000Z");
    const pendingId = await stateIdFor(orgId, "PENDING");
    await prisma.ticket.update({
      where: { id: ticket1Id },
      data: { stateId: pendingId, resolvedAt: null, slaPausedAt: pausedAt },
    });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket1Id } });

    const emailMessageId1 = await deriveIdFor(fixture1);
    const fixture7 = await buildFixture({
      messageId: "<fixture7@test.local>",
      subject: "Re: Order issue",
      from: "customer1@example.com",
      text: "Here is the information you asked for.",
      inReplyTo: emailMessageId1,
    });
    const emailMessageId7 = await deriveIdFor(fixture7);
    expect(await ingestMessage(orgId, fixture7, SELF_ADDRESS, emailMessageId7)).toBe("appended");

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket1Id } });
    expect(after.stateId).toBe(pendingId);
    expect(after.slaPausedAt?.toISOString()).toBe(pausedAt.toISOString());
    expect(after.slaPausedMs).toBe(before.slaPausedMs);
    expect(after.firstResponseDueAt.toISOString()).toBe(before.firstResponseDueAt.toISOString());
    expect(after.resolutionDueAt.toISOString()).toBe(before.resolutionDueAt.toISOString());
    expect(after.resolvedAt).toBeNull();
    const message = await prisma.message.findFirst({ where: { emailMessageId: emailMessageId7 } });
    expect(message?.triggeredReopen).toBe(false);
    expect(
      await prisma.ticketAuditEvent.count({
        where: { ticketId: ticket1Id, action: "STATUS_CHANGED" },
      }),
    ).toBe(0);
  });

  it("8. automatic reply matched to a snoozed ticket in Resolved neither reopens nor wakes it", async () => {
    const resolvedId = await stateIdFor(orgId, "RESOLVED");
    const resolvedAt = new Date("2026-11-02T10:00:00.000Z");
    const snoozedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.ticket.update({
      where: { id: ticket1Id },
      data: { stateId: resolvedId, resolvedAt, slaPausedAt: null, snoozedUntil },
    });

    const emailMessageId1 = await deriveIdFor(fixture1);
    const fixture8 = await buildFixture({
      messageId: "<fixture8@test.local>",
      subject: "Re: Order issue",
      from: "customer1@example.com",
      text: "I am out of office.",
      inReplyTo: emailMessageId1,
      headers: { "Auto-Submitted": "auto-replied" },
    });
    const emailMessageId8 = await deriveIdFor(fixture8);
    expect(await ingestMessage(orgId, fixture8, SELF_ADDRESS, emailMessageId8)).toBe("appended");

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket1Id } });
    expect(after.stateId).toBe(resolvedId);
    expect(after.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString());
    expect(after.snoozedUntil?.toISOString()).toBe(snoozedUntil.toISOString());
    const message = await prisma.message.findFirst({ where: { emailMessageId: emailMessageId8 } });
    expect(message?.triggeredReopen).toBe(false);
    expect(
      await prisma.ticketAuditEvent.count({ where: { ticketId: ticket1Id, action: "WOKEN" } }),
    ).toBe(0);
  });
});
