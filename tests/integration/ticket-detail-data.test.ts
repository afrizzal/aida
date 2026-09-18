// Codex diff critique round 2, E1 (run-loop K31): the ticket page sends the ticket, its messages
// and the organization's member roster to the browser. A member whose row was deleted while the
// session still carries the organization must get none of it, only the defined
// membership_ended state, and nothing may throw (Phase 10 review C6). Real Postgres through
// Testcontainers; nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTicket } from "@/lib/tickets/create-ticket";
import { loadTicketDetailData } from "@/lib/tickets/ticket-detail-data";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

describe("ticket page data: the actor's membership is checked first (D-01)", () => {
  it("a member whose row was deleted cannot read a known ticket's subject, messages or roster", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, gone] = users;
    const marker = randomUUID();
    const subject = `Detail subject ${marker}`;
    const body = `Detail message text ${marker}`;
    const ticket = await createTicket(orgId, {
      subject,
      priority: "NORMAL",
      body,
      contact: { email: `detail-${marker}@example.test`, name: `Detail contact ${marker}` },
      direction: "INBOUND",
    });
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const actor = { userId: gone.id, orgId };

    // While the member row exists, the page gets the ticket, its message and the roster.
    const before = await loadTicketDetailData(prisma, actor, ticket.id);
    if (before.status !== "ok") throw new Error(`expected ok, got ${before.status}`);
    expect(before.ticket.subject).toBe(subject);
    expect(before.ticket.messages.map((m) => m.bodyMarkdown)).toContain(body);
    expect(before.members.map((m) => m.user.id).sort()).toEqual([owner.id, gone.id].sort());

    // The member is removed; the session (userId plus activeOrganizationId) is still valid.
    await prisma.member.delete({ where: { id: gone.memberId } });

    const after = await loadTicketDetailData(prisma, actor, ticket.id);
    expect(after).toEqual({ status: "membership_ended" });
    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain(ownerRow.email);
    expect(serialized).not.toContain(ownerRow.name);
    expect(serialized).not.toContain(owner.id);
  });

  it("an unknown ticket id for a member is not_found, not an error", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["member"]);
    const result = await loadTicketDetailData(prisma, { userId: users[0].id, orgId }, randomUUID());
    expect(result).toEqual({ status: "not_found" });
  });

  it("a ticket of another organization is not_found for a member", async () => {
    const mine = await seedOrgWithMembers(prisma, ["member"]);
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    const foreign = await createTicket(other.orgId, {
      subject: `Foreign ${randomUUID()}`,
      priority: "NORMAL",
      body: "Foreign body",
      contact: { email: `foreign-${randomUUID()}@example.test` },
      direction: "INBOUND",
    });
    const result = await loadTicketDetailData(
      prisma,
      { userId: mine.users[0].id, orgId: mine.orgId },
      foreign.id,
    );
    expect(result).toEqual({ status: "not_found" });
  });
});
