// The notification producers of Phase 10 (plan 10-06, AIDA-44) on a real Postgres through
// Testcontainers, with nothing mocked: ASSIGNED inside the one ticket mutation service (V-08,
// D-16), and CUSTOMER_REPLY on the two writers that append an INBOUND message to an existing
// ticket (V-10, V-28, owner item 11 option b, O-7 defaults). Each case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { countUnread } from "@/lib/notifications/store";
import { runTicketMutation } from "@/lib/tickets/mutations";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

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
