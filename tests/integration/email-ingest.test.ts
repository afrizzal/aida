import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
// nodemailer's MailComposer isn't re-exported from the package root — import the subpath
// directly (mirrors tests/unit/compose-outbound.test.ts's established pattern).
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { deriveEmailMessageId, ingestMessage } from "@/lib/channels/email/ingest-message";
import { prisma } from "@/lib/db";

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

  it("6. reply to a RESOLVED ticket reopens it (triggeredReopen marker)", async () => {
    await prisma.ticket.update({
      where: { id: ticket1Id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
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
    expect(ticket.status).toBe("OPEN");
    expect(ticket.resolvedAt).toBeNull();

    const message = await prisma.message.findFirst({ where: { emailMessageId: emailMessageId6 } });
    expect(message?.triggeredReopen).toBe(true);
  });
});
