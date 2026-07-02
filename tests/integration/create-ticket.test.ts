import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTicket } from "@/lib/tickets/create-ticket";

// Helper to seed a test organization. Better Auth's organization model has no @default()
// on `id` or `createdAt` — BA manages them internally, so we provide them here for tests.
function makeOrgData(name: string, slug: string) {
  return { id: randomUUID(), name, slug, createdAt: new Date() };
}

describe("createTicket", () => {
  it("assigns sequential numbers", async () => {
    const org = await prisma.organization.create({
      data: makeOrgData("Org Sequential", "create-ticket-sequential"),
    });

    const first = await createTicket(org.id, {
      subject: "First ticket",
      priority: "NORMAL",
      body: "hello",
      contact: { email: "seq1@example.com" },
      direction: "INBOUND",
    });
    const second = await createTicket(org.id, {
      subject: "Second ticket",
      priority: "NORMAL",
      body: "hello again",
      contact: { email: "seq2@example.com" },
      direction: "INBOUND",
    });

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });

  it("assigns no duplicate numbers under concurrency", async () => {
    const org = await prisma.organization.create({
      data: makeOrgData("Org Concurrency", "create-ticket-concurrency"),
    });

    const concurrency = 20;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        createTicket(org.id, {
          subject: `Concurrent ticket ${i}`,
          priority: "NORMAL",
          body: "hi",
          contact: { email: `u${i}@x.com` },
          direction: "INBOUND",
        }),
      ),
    );

    const numbers = results.map((r) => r.number);
    expect(new Set(numbers).size).toBe(concurrency);
  });

  it("links contact by normalized email", async () => {
    const org = await prisma.organization.create({
      data: makeOrgData("Org Contact Dedup", "create-ticket-contact-dedup"),
    });

    const first = await createTicket(org.id, {
      subject: "First from A@X.com",
      priority: "NORMAL",
      body: "hi",
      contact: { email: "A@X.com", name: "Case Test" },
      direction: "INBOUND",
    });
    const second = await createTicket(org.id, {
      subject: "Second from a@x.com",
      priority: "NORMAL",
      body: "hi again",
      contact: { email: "a@x.com" },
      direction: "INBOUND",
    });

    const firstTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: first.id } });
    const secondTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: second.id } });

    expect(firstTicket.contactId).toBe(secondTicket.contactId);

    const contactCount = await prisma.contact.count({
      where: { organizationId: org.id, email: "a@x.com" },
    });
    expect(contactCount).toBe(1);
  });
});
