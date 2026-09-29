// Codex diff critique round 2, E1 (run-loop K31): the ticket page sends the ticket, its messages
// and the organization's member roster to the browser. A member whose row was deleted while the
// session still carries the organization must get none of it, only the defined
// membership_ended state, and nothing may throw (Phase 10 review C6). Real Postgres through
// Testcontainers; nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTicket } from "@/lib/tickets/create-ticket";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { loadTicketDetailData } from "@/lib/tickets/ticket-detail-data";
import { listActiveStates, readLegacyStateIds } from "@/lib/tickets/ticket-states";
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

// Phase 12.1 (D-01, D-11 single state change row, D-18; UI-SPEC 3a): the page gets the ticket's
// state, its pause and the organization's active states for the grouped top-bar picker, all read
// after the membership check.
describe("ticket page data: states and the SLA pause (Phase 12.1)", () => {
  async function seedPausedTicket() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const marker = randomUUID();
    const ticket = await createTicket(orgId, {
      subject: `State subject ${marker}`,
      priority: "NORMAL",
      body: `State body ${marker}`,
      contact: { email: `state-${marker}@example.test` },
      direction: "INBOUND",
    });
    // A second Pending state and a soft-deleted Open state, written directly (the admin
    // service is plan 12.1-08's).
    const waiting = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: `Waiting ${marker.slice(0, 8)}`,
        colorToken: "purple",
        group: "PENDING",
        sortOrder: 9,
      },
    });
    const gone = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: `Gone ${marker.slice(0, 8)}`,
        colorToken: "teal",
        group: "OPEN",
        sortOrder: 7,
        deletedAt: new Date(),
      },
    });
    const result = await runTicketMutation({
      actor: { orgId, userId: users[0].id },
      ticketIds: [ticket.id],
      op: { kind: "state", stateId: waiting.id },
      mode: "single",
    });
    expect(result).toMatchObject({ ok: true, count: 1 });
    return { orgId, users, ticket, waiting, gone, marker };
  }

  it("returns the ticket's state, its slaPausedAt and the active states in group and sort order", async () => {
    const { orgId, users, ticket, waiting, gone } = await seedPausedTicket();
    const data = await loadTicketDetailData(prisma, { userId: users[1].id, orgId }, ticket.id);
    if (data.status !== "ok") throw new Error(`expected ok, got ${data.status}`);

    expect(data.ticket.state).toEqual({
      id: waiting.id,
      name: waiting.name,
      colorToken: "purple",
      group: "PENDING",
    });
    expect(data.ticket.slaPausedAt).toBeInstanceOf(Date);

    const expected = await listActiveStates(prisma, orgId);
    expect(data.stateOptions).toEqual(expected);
    const ids = data.stateOptions.map((s) => s.id);
    expect(ids).toContain(waiting.id);
    expect(ids).not.toContain(gone.id);
    const order = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];
    const groupIndexes = data.stateOptions.map((s) => order.indexOf(s.group));
    expect(groupIndexes).toEqual([...groupIndexes].sort((a, b) => a - b));
    expect(new Set(data.stateOptions.map((s) => s.group))).toEqual(new Set(order));
    // Within Pending the seeded state (sortOrder 2) comes before the added one (sortOrder 9).
    const legacy = await readLegacyStateIds(prisma, orgId);
    const pendingIds = data.stateOptions.filter((s) => s.group === "PENDING").map((s) => s.id);
    expect(pendingIds).toEqual([legacy.PENDING, waiting.id]);
  });

  it("a removed member gets membership_ended and no state data", async () => {
    const { orgId, users, ticket, waiting } = await seedPausedTicket();
    await prisma.member.delete({ where: { id: users[1].memberId } });
    const data = await loadTicketDetailData(prisma, { userId: users[1].id, orgId }, ticket.id);
    expect(data).toEqual({ status: "membership_ended" });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(waiting.id);
    expect(serialized).not.toContain(waiting.name);
  });
});
