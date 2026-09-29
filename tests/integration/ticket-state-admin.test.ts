// Phase 12.1, plan 12.1-08: the ticket state admin service (AIDA-97, D-01, D-03, D-05, D-06,
// D-12, D-14, D-15 amended, K40 to K42), on a real Postgres through Testcontainers. Nothing is
// mocked: real organizations, real members, real tickets.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteTicketState } from "@/lib/tickets/ticket-state-admin";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";

async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
  return {
    orgId,
    admin: { userId: users[0].id, orgId },
    member: { userId: users[1].id, orgId },
    memberRowId: users[1].memberId,
  };
}

async function addState(
  orgId: string,
  group: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED",
  name = `State ${randomUUID().slice(0, 8)}`,
  sortOrder = 50,
) {
  const row = await prisma.ticketState.create({
    data: { organizationId: orgId, name, colorToken: "blue", group, sortOrder },
    select: { id: true, name: true },
  });
  return row;
}

async function config(orgId: string) {
  return prisma.ticketStateConfig.findUniqueOrThrow({ where: { organizationId: orgId } });
}

describe("deleteTicketState tracer (K41, K42, D-15)", () => {
  it("deletes Open with a same-group replacement, moving its ticket and its reopen role", async () => {
    const { orgId, admin } = await seedOrg();
    const openId = await stateIdFor(orgId, "OPEN");
    const second = await addState(orgId, "OPEN", "Second open");
    const ticket = await seedTicket(orgId, { status: "OPEN" });
    expect((await config(orgId)).reopenStateId).toBe(openId);

    const result = await deleteTicketState(prisma, admin, {
      stateId: openId,
      replacementStateId: second.id,
    });

    expect(result).toEqual({
      ok: true,
      movedCount: 1,
      rolesMoved: true,
      name: "Open",
      replacementName: "Second open",
    });
    const moved = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { stateId: true },
    });
    expect(moved.stateId).toBe(second.id);
    const audits = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: ticket.id, action: "STATUS_CHANGED" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "USER",
      actorUserId: admin.userId,
      before: { stateId: openId, stateGroup: "OPEN" },
      after: { stateId: second.id, stateGroup: "OPEN" },
    });
    expect(audits[0].batchId).toEqual(expect.any(String));
    expect((await config(orgId)).reopenStateId).toBe(second.id);
    const deleted = await prisma.ticketState.findUniqueOrThrow({ where: { id: openId } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });
});
