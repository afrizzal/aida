// Phase 12, plan 12-02: the relations service (AIDA-52, D-03 to D-06) on a real Postgres
// through Testcontainers. Nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addRelation, listRelationsForTicket, type RelationActor } from "@/lib/tickets/relations";
import { seedOrgWithMembers, seedTicket } from "../support/lifecycle-fixtures";

async function seedActor() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
  const actor: RelationActor = { userId: users[0].id, orgId };
  return { orgId, actor };
}

describe("addRelation (tracer)", () => {
  it("links A as a duplicate of B, shows it from both sides and audits both tickets", async () => {
    const { orgId, actor } = await seedActor();
    const a = await seedTicket(orgId);
    const b = await seedTicket(orgId);

    const result = await addRelation(prisma, actor, {
      ticketId: a.id,
      otherTicketId: b.id,
      choice: "is a duplicate of",
    });
    expect(result.ok).toBe(true);

    const fromA = await listRelationsForTicket(prisma, actor, a.id);
    const fromB = await listRelationsForTicket(prisma, actor, b.id);
    expect(fromA.ok && fromA.relations.map((r) => [r.label, r.number])).toEqual([
      ["Duplicate of", b.number],
    ]);
    expect(fromB.ok && fromB.relations.map((r) => [r.label, r.number])).toEqual([
      ["Has duplicate", a.number],
    ]);

    const audit = await prisma.ticketAuditEvent.findMany({
      where: { organizationId: orgId, action: "RELATION_ADDED" },
    });
    expect(audit.map((r) => r.ticketId).sort()).toEqual([a.id, b.id].sort());
    expect(await prisma.ticketRelation.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
