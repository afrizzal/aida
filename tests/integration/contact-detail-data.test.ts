// Phase 12.1 review WR-b2 (run decision K44, as K31 in Phase 11): the contact detail loader reads
// nothing for a session whose member row was deleted (D-01). Real Postgres; nothing is mocked.
import { describe, expect, it } from "vitest";
import { loadContactDetailData } from "@/lib/contacts/contact-detail-data";
import { prisma } from "@/lib/db";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

async function seed() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
  await prisma.member.delete({ where: { id: users[1].memberId } });
  const ticket = await seedTicket(orgId, { status: "PENDING" });
  const { contactId } = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { contactId: true },
  });
  return {
    orgId,
    ticket,
    contactId,
    active: { userId: users[0].id, orgId },
    removed: { userId: users[1].id, orgId },
  };
}

describe("loadContactDetailData (D-01, K44)", () => {
  it("returns the contact with its tickets and their state name and colour to an active member", async () => {
    const { contactId, ticket, active } = await seed();
    const data = await loadContactDetailData(prisma, active, contactId);
    if (data.status !== "ok") throw new Error(`expected ok, got ${data.status}`);
    expect(data.contact.id).toBe(contactId);
    expect(data.contact.tickets).toHaveLength(1);
    expect(data.contact.tickets[0]).toMatchObject({
      id: ticket.id,
      state: { name: "Pending", colorToken: expect.any(String) },
    });
  });

  it("reads nothing for a session whose member row was deleted", async () => {
    const { contactId, removed } = await seed();
    expect(await loadContactDetailData(prisma, removed, contactId)).toEqual({
      status: "membership_ended",
    });
  });

  it("never returns another organization's contact", async () => {
    const a = await seed();
    const b = await seed();
    expect(await loadContactDetailData(prisma, b.active, a.contactId)).toEqual({
      status: "not_found",
    });
  });
});
