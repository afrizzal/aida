// Codex diff critique D1 (round 1): the inbox list panel loads the organization's member roster
// for the bulk bar. A member whose row was deleted while the session still carries the
// organization must get no roster and no other panel data, only the defined membership_ended
// state. Real Postgres through Testcontainers; nothing is mocked.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSavedView } from "@/lib/saved-views/service";
import { loadTicketListPanelData } from "@/lib/tickets/list-panel-data";
import { readLegacyStateIds } from "@/lib/tickets/ticket-states";
import { seedOrgWithMembers, seedTicket, stateIdFor } from "../support/inbox-fixtures";

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
      { name: "Roster view", visibility: "SHARED", filters: { view: "all", stateIds: [] } },
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
      stateOptions: [],
      defaultStateId: null,
      legacyStateIds: { NEW: null, OPEN: null, PENDING: null, RESOLVED: null, CLOSED: null },
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
    expect(after.stateOptions).toEqual([]);
    expect(after.defaultStateId).toBeNull();
    expect(after.legacyStateIds).toEqual({
      NEW: null,
      OPEN: null,
      PENDING: null,
      RESOLVED: null,
      CLOSED: null,
    });
  });
});

// Phase 12.1 (AIDA-56, D-09, review C1): the list filters by state ids from the URL, and a missing
// id or a present but empty or malformed state parameter narrows the list, never widens it.
describe("inbox list panel data: the state filter fails closed (D-09, review C1)", () => {
  async function seedThreeStates() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
    const actor = { userId: users[0].id, orgId };
    const newTicket = await seedTicket(orgId, { status: "NEW" });
    const openTicket = await seedTicket(orgId, { status: "OPEN" });
    const pendingTicket = await seedTicket(orgId, { status: "PENDING" });
    const openId = await stateIdFor(orgId, "OPEN");
    const deleted = await prisma.ticketState.create({
      data: {
        organizationId: orgId,
        name: `Gone ${Math.random().toString(36).slice(2)}`,
        colorToken: "gray",
        group: "OPEN",
        sortOrder: 99,
        deletedAt: new Date(),
      },
    });
    return { orgId, actor, newTicket, openTicket, pendingTicket, openId, deletedId: deleted.id };
  }

  it("state=<Open id> returns only the Open ticket; a deleted id narrows and never widens", async () => {
    const { actor, openTicket, openId, deletedId } = await seedThreeStates();

    const only = await loadTicketListPanelData(prisma, actor, { state: openId });
    expect(only.tickets.map((t) => t.id)).toEqual([openTicket.id]);
    expect(only.tickets[0].state).toMatchObject({ id: openId, group: "OPEN" });

    const mixed = await loadTicketListPanelData(prisma, actor, { state: `${openId},${deletedId}` });
    expect(mixed.tickets.map((t) => t.id)).toEqual([openTicket.id]);

    const missingOnly = await loadTicketListPanelData(prisma, actor, { state: deletedId });
    expect(missingOnly.tickets).toEqual([]);
  });

  it("a present but empty, comma-only or whitespace state parameter returns zero tickets", async () => {
    const { actor } = await seedThreeStates();

    const unfiltered = await loadTicketListPanelData(prisma, actor, {});
    expect(unfiltered.tickets).toHaveLength(3);

    for (const raw of ["", ",,,", "  "]) {
      const result = await loadTicketListPanelData(prisma, actor, { state: raw });
      expect(result.tickets, `state=${JSON.stringify(raw)}`).toEqual([]);
    }
  });

  it("a valid id mixed with an invalid or empty token returns only the valid id's tickets", async () => {
    const { actor, openTicket, openId } = await seedThreeStates();

    const invalid = await loadTicketListPanelData(prisma, actor, { state: `${openId},not valid!` });
    expect(invalid.tickets.map((t) => t.id)).toEqual([openTicket.id]);

    const blanks = await loadTicketListPanelData(prisma, actor, { state: `${openId}, ,` });
    expect(blanks.tickets.map((t) => t.id)).toEqual([openTicket.id]);
  });

  it("returns the active states in group order, the default state id and the legacy ids", async () => {
    const { orgId, actor } = await seedThreeStates();
    const legacy = await readLegacyStateIds(prisma, orgId);
    const config = await prisma.ticketStateConfig.findUniqueOrThrow({
      where: { organizationId: orgId },
    });

    const result = await loadTicketListPanelData(prisma, actor, {});
    expect(result.stateOptions.map((s) => s.id)).toEqual([
      legacy.NEW,
      legacy.OPEN,
      legacy.PENDING,
      legacy.RESOLVED,
      legacy.CLOSED,
    ]);
    expect(result.stateOptions.map((s) => s.group)).toEqual([
      "OPEN",
      "OPEN",
      "PENDING",
      "RESOLVED",
      "CLOSED",
    ]);
    for (const option of result.stateOptions) {
      expect(Object.keys(option).sort()).toEqual(["colorToken", "group", "id", "name"]);
    }
    expect(result.defaultStateId).toBe(config.newStateId);
    expect(result.legacyStateIds).toEqual(legacy);
    expect(Object.values(result.legacyStateIds).every((id) => typeof id === "string")).toBe(true);
  });
});
