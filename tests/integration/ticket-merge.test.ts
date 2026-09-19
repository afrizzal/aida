// Phase 12, plan 12-03: the merge service (AIDA-53, D-07 to D-10) on a real Postgres through
// Testcontainers. Nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { type MergeActor, mergeTickets } from "@/lib/tickets/merge";
import { seedContactTicket, seedMessage, seedOrgWithMembers } from "../support/lifecycle-fixtures";

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: MergeActor = { userId: users[0].id, orgId };
  return { orgId, actor };
}

const email = () => `merge-${randomUUID()}@example.test`;

async function samePair(orgId: string) {
  const contactEmail = email();
  const s = await seedContactTicket(orgId, { contactEmail });
  const t = await seedContactTicket(orgId, { contactEmail });
  return { s, t };
}

async function orgCounts(orgId: string) {
  return {
    messages: await prisma.message.count({ where: { organizationId: orgId } }),
    attachments: await prisma.attachment.count({ where: { organizationId: orgId } }),
    tickets: await prisma.ticket.count({ where: { organizationId: orgId } }),
  };
}

describe("mergeTickets (tracer)", () => {
  it("moves the whole thread with provenance, closes the source as a duplicate and audits both", async () => {
    const { orgId, actor } = await seedActor();
    const { s, t } = await samePair(orgId);
    const sPublic = await seedMessage(prisma, s.id, {
      visibility: "PUBLIC",
      direction: "INBOUND",
      withAttachment: true,
    });
    const sNote = await seedMessage(prisma, s.id, {
      visibility: "INTERNAL",
      direction: "OUTBOUND",
    });
    const tPublic = await seedMessage(prisma, t.id, { visibility: "PUBLIC", direction: "INBOUND" });
    const sourceMessageIds = (
      await prisma.message.findMany({ where: { ticketId: s.id }, select: { id: true } })
    ).map((m) => m.id);
    expect(sourceMessageIds).toEqual(expect.arrayContaining([sPublic.id, sNote.id]));
    const attachmentBefore = await prisma.attachment.findUniqueOrThrow({
      where: { id: sPublic.attachmentId ?? "" },
    });
    const before = await orgCounts(orgId);

    expect(
      await mergeTickets(prisma, actor, { sourceTicketId: s.id, targetTicketId: t.id }),
    ).toEqual({ ok: true, sourceTicketId: s.id, targetTicketId: t.id });

    const moved = await prisma.message.findMany({ where: { id: { in: sourceMessageIds } } });
    expect(moved).toHaveLength(sourceMessageIds.length);
    for (const m of moved) {
      expect(m.ticketId).toBe(t.id);
      expect(m.mergedFromTicketId).toBe(s.id);
    }
    const tMessage = await prisma.message.findUniqueOrThrow({ where: { id: tPublic.id } });
    expect(tMessage.mergedFromTicketId).toBeNull();

    const attachmentAfter = await prisma.attachment.findUniqueOrThrow({
      where: { id: attachmentBefore.id },
      include: { message: { select: { ticketId: true } } },
    });
    const { message, ...attachmentRow } = attachmentAfter;
    expect(attachmentRow).toEqual(attachmentBefore);
    expect(message.ticketId).toBe(t.id);

    const source = await prisma.ticket.findUniqueOrThrow({ where: { id: s.id } });
    expect(source.status).toBe("CLOSED");
    expect(source.mergedIntoTicketId).toBe(t.id);
    expect(source.mergedAt).toBeInstanceOf(Date);
    expect(typeof source.mergeMessageSeq).toBe("bigint");

    const relations = await prisma.ticketRelation.findMany({ where: { organizationId: orgId } });
    expect(relations.map((r) => [r.type, r.fromTicketId, r.toTicketId])).toEqual([
      ["DUPLICATE_OF", s.id, t.id],
    ]);

    const audit = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: { in: ["MERGED_INTO", "MERGED_FROM"] } },
    });
    expect(audit.map((r) => [r.action, r.ticketId]).sort()).toEqual(
      [
        ["MERGED_FROM", t.id],
        ["MERGED_INTO", s.id],
      ].sort(),
    );
    expect(await orgCounts(orgId)).toEqual(before);
  });
});
