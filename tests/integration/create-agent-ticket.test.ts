// Codex diff critique round 2, E1 (run-loop K31): the agent "New Ticket" action (opened by the
// Phase 11 palette's Create ticket) must refuse a member whose row was deleted while the session
// still carries the organization, before any write. Real Postgres through Testcontainers;
// nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createAgentTicket } from "@/lib/tickets/create-agent-ticket";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

function input(marker: string) {
  return {
    subject: `Agent ticket ${marker}`,
    priority: "NORMAL" as const,
    body: `Agent body ${marker}`,
    contactEmail: `agent-${marker}@example.test`,
    contactName: `Agent contact ${marker}`,
  };
}

async function writtenRows(orgId: string) {
  const [tickets, contacts, messages, counters] = await Promise.all([
    prisma.ticket.count({ where: { organizationId: orgId } }),
    prisma.contact.count({ where: { organizationId: orgId } }),
    prisma.message.count({ where: { organizationId: orgId } }),
    prisma.ticketCounter.count({ where: { organizationId: orgId } }),
  ]);
  return { tickets, contacts, messages, counters };
}

describe("agent New Ticket: the actor's membership is checked before any write (D-01)", () => {
  it("a member creates a ticket authored by them", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const marker = randomUUID();

    const result = await createAgentTicket(prisma, { userId: users[0].id, orgId }, input(marker));
    if (!result.ok) throw new Error(`createAgentTicket refused: ${result.error}`);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: result.id },
      include: { messages: true },
    });
    expect(ticket.organizationId).toBe(orgId);
    expect(ticket.subject).toBe(`Agent ticket ${marker}`);
    expect(ticket.messages.map((m) => m.authorUserId)).toEqual([users[0].id]);
  });

  it("a member whose row was deleted is refused with MEMBERSHIP_ENDED and nothing is written", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const gone = users[1];
    // The member is removed; the session (userId plus activeOrganizationId) is still valid.
    await prisma.member.delete({ where: { id: gone.memberId } });
    const marker = randomUUID();

    const result = await createAgentTicket(prisma, { userId: gone.id, orgId }, input(marker));

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await writtenRows(orgId)).toEqual({ tickets: 0, contacts: 0, messages: 0, counters: 0 });
    expect(await prisma.ticket.count({ where: { subject: `Agent ticket ${marker}` } })).toBe(0);
  });
});
