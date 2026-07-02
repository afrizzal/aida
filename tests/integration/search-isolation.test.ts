import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { searchTickets } from "@/lib/tickets/search";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id` or `createdAt` — BA manages them internally, so we provide them here for tests.
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

// plan 03 (createTicket / statusToken generator) had not landed at the time this plan was
// written — seed tickets with explicit bare inserts providing every required field instead.
async function seedTicket(params: {
  orgId: string;
  number: number;
  subject: string;
  contactEmail: string;
}) {
  const contact = await prisma.contact.create({
    data: {
      organizationId: params.orgId,
      email: params.contactEmail,
    },
  });

  const now = new Date();
  return prisma.ticket.create({
    data: {
      organizationId: params.orgId,
      number: params.number,
      statusToken: randomUUID(),
      subject: params.subject,
      contactId: contact.id,
      firstResponseTargetMinutes: 60,
      resolutionTargetMinutes: 480,
      firstResponseDueAt: new Date(now.getTime() + 60 * 60_000),
      resolutionDueAt: new Date(now.getTime() + 480 * 60_000),
    },
  });
}

async function seedMessage(params: {
  orgId: string;
  ticketId: string;
  bodyMarkdown: string;
}) {
  return prisma.message.create({
    data: {
      organizationId: params.orgId,
      ticketId: params.ticketId,
      direction: "INBOUND",
      bodyMarkdown: params.bodyMarkdown,
      bodyHtml: `<p>${params.bodyMarkdown}</p>`,
    },
  });
}

describe("AIDA-02: searchTickets tenant isolation", () => {
  it("subject match: orgA search never returns orgB's ticket and vice-versa", async () => {
    const orgA = await prisma.organization.create({
      data: makeOrgData("Org Search A", "ws-search-subject-a"),
    });
    const orgB = await prisma.organization.create({
      data: makeOrgData("Org Search B", "ws-search-subject-b"),
    });

    const ticketA = await seedTicket({
      orgId: orgA.id,
      number: 1,
      subject: "Zephyrquartz printer jam",
      contactEmail: "a@example.com",
    });
    const ticketB = await seedTicket({
      orgId: orgB.id,
      number: 1,
      subject: "Zephyrquartz printer jam",
      contactEmail: "b@example.com",
    });

    const resultsA = await searchTickets(orgA.id, "zephyrquartz");
    const resultsB = await searchTickets(orgB.id, "zephyrquartz");

    expect(resultsA.length).toBeGreaterThan(0);
    expect(resultsA.some((r) => r.id === ticketA.id)).toBe(true);
    expect(resultsA.some((r) => r.id === ticketB.id)).toBe(false);

    expect(resultsB.length).toBeGreaterThan(0);
    expect(resultsB.some((r) => r.id === ticketB.id)).toBe(true);
    expect(resultsB.some((r) => r.id === ticketA.id)).toBe(false);
  });

  it("message-body match: a ticket surfaces via its message content, still org-scoped", async () => {
    const orgA = await prisma.organization.create({
      data: makeOrgData("Org Search Body A", "ws-search-body-a"),
    });
    const orgB = await prisma.organization.create({
      data: makeOrgData("Org Search Body B", "ws-search-body-b"),
    });

    const ticketA = await seedTicket({
      orgId: orgA.id,
      number: 2,
      subject: "Generic subject",
      contactEmail: "a2@example.com",
    });
    const ticketB = await seedTicket({
      orgId: orgB.id,
      number: 2,
      subject: "Generic subject",
      contactEmail: "b2@example.com",
    });

    await seedMessage({
      orgId: orgA.id,
      ticketId: ticketA.id,
      bodyMarkdown: "The flumboxinator is broken again",
    });
    await seedMessage({
      orgId: orgB.id,
      ticketId: ticketB.id,
      bodyMarkdown: "The flumboxinator is broken again",
    });

    const resultsA = await searchTickets(orgA.id, "flumboxinator");
    const resultsB = await searchTickets(orgB.id, "flumboxinator");

    expect(resultsA.some((r) => r.id === ticketA.id)).toBe(true);
    expect(resultsA.some((r) => r.id === ticketB.id)).toBe(false);

    expect(resultsB.some((r) => r.id === ticketB.id)).toBe(true);
    expect(resultsB.some((r) => r.id === ticketA.id)).toBe(false);
  });
});
