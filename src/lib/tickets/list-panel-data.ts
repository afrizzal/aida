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
import {
  type LegacyStatusKey,
  listActiveStates,
  readLegacyStateIds,
  type StateGroup,
} from "@/lib/tickets/ticket-states";

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

/** One active state for the Status filter (D-11 Filters row). */
export interface ListPanelStateOption {
  id: string;
  name: string;
  colorToken: string;
  group: StateGroup;
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
  /** The organization's active states in group, then sort order (Phase 12.1, D-11). */
  stateOptions: ListPanelStateOption[];
  /** The configuration's state for new tickets; null for a removed member. */
  defaultStateId: string | null;
  /** The active state id per legacy key, for the old status= URL mapper (D-09). */
  legacyStateIds: Record<LegacyStatusKey, string | null>;
}

const NO_LEGACY_STATE_IDS: Record<LegacyStatusKey, string | null> = {
  NEW: null,
  OPEN: null,
  PENDING: null,
  RESOLVED: null,
  CLOSED: null,
};

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
      stateOptions: [],
      defaultStateId: null,
      legacyStateIds: { ...NO_LEGACY_STATE_IDS },
    };
  }

  const db = scopedDb(orgId);
  const filters = parseTicketListFilters(searchParams);

  // Better Auth's `member` model is excluded from scopedDb's DOMAIN_MODELS allowlist: the global
  // client with an explicit organizationId filter, as on the ticket page.
  // The states, the default and the legacy map are read only after the membership check above.
  const [
    tickets,
    totalTicketCount,
    tags,
    customFieldDefinitions,
    members,
    states,
    stateConfig,
    legacyStateIds,
  ] = await Promise.all([
    fetchTicketList(filters, { db, orgId, userId }),
    db.ticket.count(),
    db.tag.findMany({ orderBy: { name: "asc" } }),
    db.customFieldDefinition.findMany({ orderBy: { position: "asc" } }),
    client.member.findMany({ where: { organizationId: orgId }, include: { user: true } }),
    listActiveStates(client, orgId),
    client.ticketStateConfig.findUnique({
      where: { organizationId: orgId },
      select: { newStateId: true },
    }),
    readLegacyStateIds(client, orgId),
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
    stateOptions: states.map((s) => ({
      id: s.id,
      name: s.name,
      colorToken: s.colorToken,
      group: s.group,
    })),
    defaultStateId: stateConfig?.newStateId ?? null,
    legacyStateIds,
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
