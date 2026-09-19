// Ticket picker for the link and merge dialogs (Phase 12, AIDA-52, D-01, UI-SPEC 2c). Called only
// by GET /api/tickets/picker after the session was read.
//
// Order, always: the actor's member row (D-01, MEMBERSHIP_ENDED); the current ticket read in the
// actor's organization (TICKET_NOT_FOUND for an unknown id or another organization's ticket);
// then the query rules: trim and cut to 200 characters; "#N" or "N" (digits only, one digit is
// enough) is a number lookup in the organization; any other query shorter than 2 characters
// returns nothing without querying; otherwise the existing searchTickets with limit 11, so that
// leaving out the current ticket still leaves 10 rows.
//
// Only id, number, subject, status, alreadyLinked, sameContact and mergedSource leave this
// function. It never selects message text or contact fields (UI-SPEC Assumption 3 confirmed).
// Both dialogs use the same rows; purpose only names the caller.
//
// Relative imports only and no Next.js import.
import type { PrismaClient } from "../../generated/prisma/client";
import { findActiveMembership } from "../membership";
import { cut } from "../text/cut";
import { searchTickets, type TicketSearchRow } from "./search";

export const PICKER_RESULT_LIMIT = 10;
export const PICKER_MIN_QUERY_LENGTH = 2;
export const PICKER_MAX_QUERY_LENGTH = 200;
const INT4_MAX = 2_147_483_647;

export type PickerPurpose = "link" | "merge";

export interface PickerActor {
  userId: string;
  orgId: string;
}

export interface PickerInput {
  q: unknown;
  ticketId: unknown;
  purpose: PickerPurpose;
}

export interface PickerTicketResult {
  id: string;
  number: number;
  subject: string;
  status: string;
  alreadyLinked: boolean;
  sameContact: boolean;
  mergedSource: boolean;
}

export type PickerSearchResult =
  | { ok: true; results: PickerTicketResult[] }
  | { ok: false; error: "MEMBERSHIP_ENDED" | "TICKET_NOT_FOUND" };

/** The full-text search the picker runs. A test passes a recorder that calls the real one. */
export interface PickerSearchDeps {
  search(orgId: string, queryText: string, limit?: number): Promise<TicketSearchRow[]>;
}

const DEFAULT_DEPS: PickerSearchDeps = {
  search: (orgId, queryText, limit) => searchTickets(orgId, queryText, limit),
};

type PickerClient = Pick<PrismaClient, "member" | "ticket" | "ticketRelation">;

interface CandidateRow {
  id: string;
  number: number;
  subject: string;
  status: string;
}

export async function searchTicketsForPicker(
  client: PickerClient,
  actor: PickerActor,
  input: PickerInput,
  deps: PickerSearchDeps = DEFAULT_DEPS,
): Promise<PickerSearchResult> {
  const membership = await findActiveMembership(client, actor?.userId, actor?.orgId);
  if (!membership) return { ok: false, error: "MEMBERSHIP_ENDED" };

  const ticketId = typeof input.ticketId === "string" ? input.ticketId : "";
  const current = ticketId
    ? await client.ticket.findFirst({
        where: { id: ticketId, organizationId: actor.orgId },
        select: { id: true, contactId: true },
      })
    : null;
  if (!current) return { ok: false, error: "TICKET_NOT_FOUND" };

  const trimmed = typeof input.q === "string" ? input.q.trim() : "";
  const q = cut(trimmed, PICKER_MAX_QUERY_LENGTH);

  let candidates: CandidateRow[];
  const numberMatch = /^#?(\d+)$/.exec(q);
  if (numberMatch) {
    const n = Number(numberMatch[1]);
    if (!Number.isSafeInteger(n) || n > INT4_MAX) return { ok: true, results: [] };
    const row = await client.ticket.findFirst({
      where: { organizationId: actor.orgId, number: n },
      select: { id: true, number: true, subject: true, status: true },
    });
    candidates = row ? [row] : [];
  } else if (q.length < PICKER_MIN_QUERY_LENGTH) {
    return { ok: true, results: [] };
  } else {
    candidates = await deps.search(actor.orgId, q, PICKER_RESULT_LIMIT + 1);
  }

  const rows = candidates.filter((r) => r.id !== current.id).slice(0, PICKER_RESULT_LIMIT);
  if (rows.length === 0) return { ok: true, results: [] };
  const ids = rows.map((r) => r.id);

  const [details, relations] = await Promise.all([
    client.ticket.findMany({
      where: { organizationId: actor.orgId, id: { in: ids } },
      select: { id: true, contactId: true, mergedIntoTicketId: true },
    }),
    client.ticketRelation.findMany({
      where: {
        organizationId: actor.orgId,
        OR: [
          { fromTicketId: current.id, toTicketId: { in: ids } },
          { toTicketId: current.id, fromTicketId: { in: ids } },
        ],
      },
      select: { fromTicketId: true, toTicketId: true },
    }),
  ]);
  const detailById = new Map(details.map((d) => [d.id, d]));
  const linked = new Set(
    relations.map((r) => (r.fromTicketId === current.id ? r.toTicketId : r.fromTicketId)),
  );

  return {
    ok: true,
    results: rows.flatMap((row) => {
      const detail = detailById.get(row.id);
      if (!detail) return [];
      return [
        {
          id: row.id,
          number: row.number,
          subject: row.subject,
          status: String(row.status),
          alreadyLinked: linked.has(row.id),
          sameContact: detail.contactId === current.contactId,
          mergedSource: detail.mergedIntoTicketId !== null,
        },
      ];
    }),
  };
}
