// Ticket search for the command palette (Phase 11, AIDA-49, D-12). Called only by
// GET /api/palette/tickets after the session was read.
//
// Order, always: the actor's member row (D-01, MEMBERSHIP_ENDED), then the query rules (trim;
// fewer than 2 characters returns nothing without querying; cut to 200 characters), then the
// existing searchTickets with a server limit of 10. searchTickets is raw SQL with an explicit
// organizationId filter and parameterised text, so another organization's ticket never
// matches (T-11-15, T-11-16). Only id, number, subject and status leave this function.
//
// Relative imports only and no Next.js import.
import { findActiveMembership, type MembershipClient } from "../membership";
import { searchTickets, type TicketSearchRow } from "./search";

export const PALETTE_RESULT_LIMIT = 10;
export const PALETTE_MIN_QUERY_LENGTH = 2;
export const PALETTE_MAX_QUERY_LENGTH = 200;

export interface PaletteActor {
  userId: string;
  orgId: string;
}

export interface PaletteTicketResult {
  id: string;
  number: number;
  subject: string;
  status: string;
}

export type PaletteSearchResult =
  | { ok: true; results: PaletteTicketResult[] }
  | { ok: false; error: "MEMBERSHIP_ENDED" };

/** The search the palette runs. A test passes a recorder that calls the real searchTickets. */
export interface PaletteSearchDeps {
  search(orgId: string, queryText: string, limit?: number): Promise<TicketSearchRow[]>;
}

/** Production: the existing full-text search, limited to PALETTE_RESULT_LIMIT (10) rows. */
const DEFAULT_DEPS: PaletteSearchDeps = {
  search: (orgId, queryText, limit = PALETTE_RESULT_LIMIT) =>
    searchTickets(orgId, queryText, limit),
};

/** Cuts to max UTF-16 units without leaving a lone high surrogate at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

export async function searchTicketsForPalette(
  client: MembershipClient,
  actor: PaletteActor,
  rawQuery: unknown,
  deps: PaletteSearchDeps = DEFAULT_DEPS,
): Promise<PaletteSearchResult> {
  const membership = await findActiveMembership(client, actor?.userId, actor?.orgId);
  if (!membership) return { ok: false, error: "MEMBERSHIP_ENDED" };

  const trimmed = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (trimmed.length < PALETTE_MIN_QUERY_LENGTH) return { ok: true, results: [] };
  const q = cut(trimmed, PALETTE_MAX_QUERY_LENGTH);

  const rows = await deps.search(actor.orgId, q, PALETTE_RESULT_LIMIT);
  return {
    ok: true,
    results: rows.slice(0, PALETTE_RESULT_LIMIT).map((row) => ({
      id: row.id,
      number: row.number,
      subject: row.subject,
      status: row.status,
    })),
  };
}
