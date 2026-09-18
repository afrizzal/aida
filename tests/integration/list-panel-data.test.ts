// Codex diff critique D1 (round 1): the inbox list panel loads the organization's member roster
// for the bulk bar. A member whose row was deleted while the session still carries the
// organization must get no roster and no other panel data, only the defined membership_ended
// state. Real Postgres through Testcontainers; nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSavedView } from "@/lib/saved-views/service";
import { loadTicketListPanelData } from "@/lib/tickets/list-panel-data";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

describe("inbox list panel data: the actor's membership is checked first (D-01)", () => {
  it("a member whose row was deleted gets no roster, no tickets, no tags and membership_ended", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, gone] = users;
    const tagName = `Roster tag ${Math.random().toString(36).slice(2)}`;
    await prisma.tag.create({ data: { organizationId: orgId, name: tagName } });
    await prisma.customFieldDefinition.create({
      data: { organizationId: orgId, label: "Plan", type: "TEXT" },
    });
    await seedTicket(orgId);
    const view = await createSavedView(
      prisma,
      { userId: owner.id, orgId },
      { name: "Roster view", visibility: "SHARED", filters: { view: "all", statuses: [] } },
    );
    if (!view.ok) throw new Error(`createSavedView refused: ${view.error}`);
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const searchParams = { view: "all", sv: view.id };
    const actor = { userId: gone.id, orgId };

    // While the member row exists, the panel gets the roster and the rest of its data.
    const before = await loadTicketListPanelData(prisma, actor, searchParams);
    expect(before.membershipActive).toBe(true);
    expect(before.memberOptions.map((m) => m.id).sort()).toEqual([owner.id, gone.id].sort());
    expect(before.tickets).toHaveLength(1);
    expect(before.tagOptions.map((t) => t.name)).toEqual([tagName]);
    expect(before.savedView).toMatchObject({ status: "ok" });

    // The member is removed; the session (userId plus activeOrganizationId) is still valid.
    await prisma.member.delete({ where: { id: gone.memberId } });

    const after = await loadTicketListPanelData(prisma, actor, searchParams);
    expect(after).toEqual({
      membershipActive: false,
      tickets: [],
      totalTicketCount: 0,
      tagOptions: [],
      fieldOptions: [],
      memberOptions: [],
      savedView: { status: "membership_ended" },
    });
    // Nothing of the roster reaches what the panel serializes into the response.
    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain(ownerRow.email);
    expect(serialized).not.toContain(ownerRow.name);
    expect(serialized).not.toContain(owner.id);
  });

  it("without sv a removed member still gets membership_ended, so the panel shows the defined line", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    await seedTicket(orgId);
    await prisma.member.delete({ where: { id: users[1].memberId } });

    const after = await loadTicketListPanelData(prisma, { userId: users[1].id, orgId }, {});
    expect(after.membershipActive).toBe(false);
    expect(after.memberOptions).toEqual([]);
    expect(after.tickets).toEqual([]);
    expect(after.savedView).toEqual({ status: "membership_ended" });
  });
});
