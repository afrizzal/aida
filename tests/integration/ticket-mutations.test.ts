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

function tagCount(orgId: string) {
  return prisma.tag.count({ where: { organizationId: orgId } });
}

function links(ticketId: string) {
  return prisma.ticketTag.findMany({ where: { ticketId } });
}

describe("runTicketMutation: assign", () => {
  it("assigns a member, unassigns with null, and records assigneeId before and after", async () => {
    const { orgId, actor, member } = await seedActor();
    const t = await seedTicket(orgId);

    const assigned = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "single",
    });
    expect(assigned.ok).toBe(true);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBe(
      member.id,
    );

    const unassigned = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: null },
      mode: "single",
    });
    expect(unassigned.ok).toBe(true);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();

    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["ASSIGNEE_CHANGED", { assigneeId: null }, { assigneeId: member.id }],
      ["ASSIGNEE_CHANGED", { assigneeId: member.id }, { assigneeId: null }],
    ]);
  });

  it("refuses an assignee who is not a member of the organization with MEMBER_NOT_ACTIVE", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["member"]);
    const t = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: other.users[0].id },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MEMBER_NOT_ACTIVE" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it("assigning the same assignee again is a no-op with before equal to after", async () => {
    const { orgId, actor, member } = await seedActor();
    const t = await seedTicket(orgId, { assigneeId: member.id });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "assign", assigneeId: member.id },
      mode: "single",
    });

    expect(result.ok).toBe(true);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ assigneeId: member.id });
    expect(rows[0].after).toEqual({ assigneeId: member.id });
  });
});

describe("runTicketMutation: priority (Codex review C2)", () => {
  const CREATED_AT = new Date("2026-01-05T08:00:00.000Z");
  const MIN = 60_000;

  it("writes priority, both targets, both due dates and clears the flags, from the organization's policy or the defaults", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    await prisma.slaPolicy.create({
      data: {
        organizationId: orgId,
        priority: "URGENT",
        firstResponseTargetMinutes: 30,
        resolutionTargetMinutes: 240,
      },
    });
    await prisma.slaPolicy.create({
      data: {
        organizationId: other.orgId,
        priority: "URGENT",
        firstResponseTargetMinutes: 5,
        resolutionTargetMinutes: 10,
      },
    });
    const t = await seedTicket(orgId, { priority: "NORMAL" });
    await prisma.ticket.update({
      where: { id: t.id },
      data: { createdAt: CREATED_AT, isAtRisk: true, isBreached: true },
    });

    const urgent = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "priority", priority: "URGENT" },
      mode: "single",
    });
    expect(urgent.ok).toBe(true);
    const u = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(u).toMatchObject({
      priority: "URGENT",
      firstResponseTargetMinutes: 30,
      resolutionTargetMinutes: 240,
      isAtRisk: false,
      isBreached: false,
    });
    expect(u.firstResponseDueAt.getTime()).toBe(CREATED_AT.getTime() + 30 * MIN);
    expect(u.resolutionDueAt.getTime()).toBe(CREATED_AT.getTime() + 240 * MIN);

    const low = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "priority", priority: "LOW" },
      mode: "single",
    });
    expect(low.ok).toBe(true);
    const l = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(l).toMatchObject({
      priority: "LOW",
      firstResponseTargetMinutes: 1440,
      resolutionTargetMinutes: 4320,
    });
    expect(l.firstResponseDueAt.getTime()).toBe(CREATED_AT.getTime() + 1440 * MIN);
    expect(l.resolutionDueAt.getTime()).toBe(CREATED_AT.getTime() + 4320 * MIN);

    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["PRIORITY_CHANGED", { priority: "NORMAL" }, { priority: "URGENT" }],
      ["PRIORITY_CHANGED", { priority: "URGENT" }, { priority: "LOW" }],
    ]);
  });

  it("re-applying the current priority writes nothing to the ticket and records before equal to after", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId, { priority: "HIGH" });
    await prisma.ticket.update({ where: { id: t.id }, data: { isAtRisk: true } });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "priority", priority: "HIGH" },
      mode: "single",
    });

    expect(result.ok).toBe(true);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toEqual(before);
    const rows = await auditRows(orgId, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ priority: "HIGH" });
    expect(rows[0].after).toEqual({ priority: "HIGH" });
  });
});

describe("runTicketMutation: tags", () => {
  it("addTag links the tag, and a tag already linked is a no-op with present true on both sides", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "vip" } });
    const op = { kind: "addTag", tagId: tag.id } as const;

    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );
    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );

    expect((await links(t.id)).map((l) => l.tagId)).toEqual([tag.id]);
    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["TAG_ADDED", { tagId: tag.id, present: false }, { tagId: tag.id, present: true }],
      ["TAG_ADDED", { tagId: tag.id, present: true }, { tagId: tag.id, present: true }],
    ]);
  });

  it("addTag with a tag of another organization gives TAG_MISSING", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    const t = await seedTicket(orgId);
    const foreign = await prisma.tag.create({ data: { organizationId: other.orgId, name: "x" } });

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "addTag", tagId: foreign.id },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "TAG_MISSING" });
    expect(await links(t.id)).toHaveLength(0);
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it('addTagByName " Billing " creates one trimmed tag, links it, and an existing name is reused', async () => {
    const { orgId, actor } = await seedActor();
    const t1 = await seedTicket(orgId);
    const t2 = await seedTicket(orgId);
    const countBefore = await tagCount(orgId);

    const first = await runTicketMutation({
      actor,
      ticketIds: [t1.id],
      op: { kind: "addTagByName", name: " Billing " },
      mode: "single",
    });
    expect(first.ok).toBe(true);
    const tags = await prisma.tag.findMany({ where: { organizationId: orgId } });
    expect(tags.map((t) => t.name)).toEqual(["Billing"]);
    expect(await tagCount(orgId)).toBe(countBefore + 1);
    expect((await links(t1.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
    const [row] = await auditRows(orgId, t1.id);
    expect(row).toMatchObject({
      action: "TAG_ADDED",
      before: { tagId: tags[0].id, present: false },
      after: { tagId: tags[0].id, present: true },
    });

    const second = await runTicketMutation({
      actor,
      ticketIds: [t2.id],
      op: { kind: "addTagByName", name: "Billing" },
      mode: "single",
    });
    expect(second.ok).toBe(true);
    expect(await tagCount(orgId)).toBe(countBefore + 1);
    expect((await links(t2.id)).map((l) => l.tagId)).toEqual([tags[0].id]);
  });

  it("addTagByName for an actor whose member row was deleted gives MEMBERSHIP_ENDED and creates no tag", async () => {
    const { orgId, actor, admin } = await seedActor();
    const t = await seedTicket(orgId);
    await prisma.member.delete({ where: { id: admin.memberId } });
    const countBefore = await tagCount(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "addTagByName", name: "Revoked" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "MEMBERSHIP_ENDED" });
    expect(await tagCount(orgId)).toBe(countBefore);
    expect(await links(t.id)).toHaveLength(0);
  });

  it("addTagByName on a ticket of another organization gives TICKET_UNAVAILABLE and rolls the new tag back", async () => {
    const { orgId, actor } = await seedActor();
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    const foreignTicket = await seedTicket(other.orgId);
    const countBefore = await tagCount(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [foreignTicket.id],
      op: { kind: "addTagByName", name: "Leaked" },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "TICKET_UNAVAILABLE" });
    expect(await tagCount(orgId)).toBe(countBefore);
    expect(await links(foreignTicket.id)).toHaveLength(0);
    expect(await auditRows(orgId)).toHaveLength(0);
  });

  it("addTagByName with a blank name gives INVALID", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId);

    const result = await runTicketMutation({
      actor,
      ticketIds: [t.id],
      op: { kind: "addTagByName", name: "   " },
      mode: "single",
    });

    expect(result).toEqual({ ok: false, error: "INVALID" });
    expect(await tagCount(orgId)).toBe(0);
  });

  it("removeTag unlinks and records TAG_REMOVED; a tag not linked is a no-op", async () => {
    const { orgId, actor } = await seedActor();
    const t = await seedTicket(orgId);
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: "urgent-ish" } });
    await prisma.ticketTag.create({ data: { ticketId: t.id, tagId: tag.id } });
    const op = { kind: "removeTag", tagId: tag.id } as const;

    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );
    expect(await links(t.id)).toHaveLength(0);
    expect((await runTicketMutation({ actor, ticketIds: [t.id], op, mode: "single" })).ok).toBe(
      true,
    );

    const rows = await auditRows(orgId, t.id);
    expect(rows.map((r) => [r.action, r.before, r.after])).toEqual([
      ["TAG_REMOVED", { tagId: tag.id, present: true }, { tagId: tag.id, present: false }],
      ["TAG_REMOVED", { tagId: tag.id, present: false }, { tagId: tag.id, present: false }],
    ]);
  });
});

describe("runTicketMutation: bulk", () => {
  it("a bulk change over three tickets returns count 3 and writes three rows sharing one batchId", async () => {
    const { orgId, actor } = await seedActor();
    const tickets = [await seedTicket(orgId), await seedTicket(orgId), await seedTicket(orgId)];

    const result = await runTicketMutation({
      actor,
      ticketIds: tickets.map((t) => t.id),
      op: { kind: "status", status: "PENDING" },
      mode: "bulk",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(3);
    expect(result.batchId).toEqual(expect.any(String));
    const rows = await auditRows(orgId);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.batchId))).toEqual(new Set([result.batchId]));
    expect(new Set(rows.map((r) => r.ticketId))).toEqual(new Set(tickets.map((t) => t.id)));
  });
});
