// Phase 11, plan 11-02: the one ticket mutation service (AIDA-48, D-07 to D-09), on a real
// Postgres through Testcontainers. Nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runTicketMutation, type TicketMutationActor } from "@/lib/tickets/mutations";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin", "member"]);
  const [admin, member] = users;
  const actor: TicketMutationActor = { userId: admin.id, orgId };
  return { orgId, actor, admin, member };
}

function auditRows(orgId: string, ticketId?: string) {
  return prisma.ticketAuditEvent.findMany({
    where: { organizationId: orgId, ...(ticketId ? { ticketId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("runTicketMutation: status (tracer)", () => {
  it("resolves a ticket, stamps resolvedAt, clears the flags and writes one STATUS_CHANGED row", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    await prisma.ticket.update({ where: { id: t.id }, data: { isAtRisk: true, isBreached: true } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "status", status: "RESOLVED" },
      mode: "single",
    });

    expect(result).toEqual({ ok: true, count: 1, batchId: null });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(ticket.status).toBe("RESOLVED");
    expect(ticket.resolvedAt).toBeInstanceOf(Date);
    expect(ticket.isAtRisk).toBe(false);
    expect(ticket.isBreached).toBe(false);

    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "STATUS_CHANGED",
      actorType: "USER",
      actorUserId: admin.id,
      batchId: null,
      before: { status: "OPEN" },
      after: { status: "RESOLVED" },
    });
  });

  it("repeating the same status is a no-op that still writes one row with before equal to after", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    const op = { kind: "status", status: "RESOLVED" } as const;

    await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" });
    const first = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    const again = await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" });
    const second = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

    expect(again).toEqual({ ok: true, count: 1, batchId: null });
    expect(second.resolvedAt?.toISOString()).toBe(first.resolvedAt?.toISOString());
    expect(second.updatedAt.toISOString()).toBe(first.updatedAt.toISOString());
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].before).toEqual({ status: "RESOLVED" });
    expect(rows[1].after).toEqual({ status: "RESOLVED" });
  });

  it("returns MEMBERSHIP_ENDED for an actor whose member row was deleted, and changes nothing", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId, { status: "OPEN" });
    await prisma.member.delete({ where: { id: admin.memberId } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "status", status: "RESOLVED" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(ticket.status).toBe("OPEN");
    expect(ticket.resolvedAt).toBeNull();
    expect(await auditRows(orgId)).toHaveLength(0);
  });
});
