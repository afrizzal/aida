// The data TicketListPanel renders (Phase 11, AIDA-43, AIDA-47, AIDA-48). Kept out of the server
// component so a test can run it against a real Postgres.
//
// Codex diff critique D1 (round 1): the panel sends the organization's member roster (names and
// emails) to the bulk bar, so the actor's member row is checked with findActiveMembership (D-01)
// BEFORE anything is read. A removed member whose session still carries the organization gets
// no tickets, no tags, no custom field definitions and no roster, and the same
// "membership_ended" saved-view state the strip wrapper already defines.
import type { CustomFieldType, PrismaClient } from "@/generated/prisma/client";
import { findActiveMembership } from "@/lib/membership";
import { getSavedViewForPanel } from "@/lib/saved-views/service";
import { panelOrMembershipEnded, type SavedViewPanelState } from "@/lib/saved-views/ui-state";
import { scopedDb } from "@/lib/scoped-db";
import { parseUrlFilters } from "@/lib/tickets/list-filters";
import { fetchTicketList, parseTicketListFilters } from "@/lib/tickets/list-query";

export interface ListPanelActor {
  userId: string;
  orgId: string;
}

export interface ListPanelOption {
  id: string;
  name: string;
}

export interface ListPanelFieldOption {
  id: string;
  label: string;
  type: CustomFieldType;
}

export type ListPanelTicket = Awaited<ReturnType<typeof fetchTicketList>>[number];

export interface TicketListPanelData {
  /** False when the actor's member row is gone: every list below is empty then. */
  membershipActive: boolean;
  tickets: ListPanelTicket[];
  totalTicketCount: number;
  tagOptions: ListPanelOption[];
  fieldOptions: ListPanelFieldOption[];
  /** The active organization's members, for the bulk bar's Assign picker (T-11-30). */
  memberOptions: ListPanelOption[];
  /** The saved view named by `sv`, or membership_ended for a removed member. */
  savedView: SavedViewPanelState | null;
}

export async function loadTicketListPanelData(
  client: PrismaClient,
  actor: ListPanelActor,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<TicketListPanelData> {
  const { userId, orgId } = actor;
  const svId = firstParam(searchParams.sv);

  // D-01: no read of panel data before the member row is confirmed.
  if (!(await findActiveMembership(client, userId, orgId))) {
    return {
      membershipActive: false,
      tickets: [],
      totalTicketCount: 0,
      tagOptions: [],
      fieldOptions: [],
      memberOptions: [],
      savedView: { status: "membership_ended" },
    };
  }

  const db = scopedDb(orgId);
  const filters = parseTicketListFilters(searchParams);

  // Better Auth's `member` model is excluded from scopedDb's DOMAIN_MODELS allowlist: the global
  // client with an explicit organizationId filter, as on the ticket page.
  const [tickets, totalTicketCount, tags, customFieldDefinitions, members] = await Promise.all([
    fetchTicketList(filters, { db, orgId, userId }),
    db.ticket.count(),
    db.tag.findMany({ orderBy: { name: "asc" } }),
    db.customFieldDefinition.findMany({ orderBy: { position: "asc" } }),
    client.member.findMany({ where: { organizationId: orgId }, include: { user: true } }),
  ]);

  // Saved view in the URL (AIDA-47, UI-SPEC Surface 2b): the service decides the strip state and
  // whether the viewer may edit. The list always runs with the URL filters, so a broken reference
  // is never dropped (D-05).
  const savedView: SavedViewPanelState | null = svId
    ? await panelOrMembershipEnded(() =>
        getSavedViewForPanel(client, actor, svId, parseUrlFilters(searchParams).filters),
      )
    : null;

  return {
    membershipActive: true,
    tickets,
    totalTicketCount,
    tagOptions: tags.map((tag) => ({ id: tag.id, name: tag.name })),
    fieldOptions: customFieldDefinitions.map((def) => ({
      id: def.id,
      label: def.label,
      type: def.type,
    })),
    memberOptions: members
      .map((member) => ({ id: member.user.id, name: member.user.name || member.user.email }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    savedView,
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
