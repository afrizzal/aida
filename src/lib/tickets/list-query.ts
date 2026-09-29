import type { scopedDb } from "@/lib/scoped-db";
import { DEFAULT_TICKET_LIST_LIMIT, parseUrlFilters } from "@/lib/tickets/list-filters";
import { searchTickets } from "@/lib/tickets/search";

export { DEFAULT_TICKET_LIST_LIMIT };

export interface TicketListFilters {
  view?: "unassigned" | "mine" | "all";
  /**
   * State ids of the organization (D-09). Non-empty filters by these ids only, so ids that are
   * missing (deleted, unknown, another organization's, the sentinel) match no ticket.
   */
  stateIds?: string[];
  tagId?: string;
  cf?: { definitionId: string; value: string };
  q?: string;
  /** Phase 12 D-16: true lists only snoozed tickets; absent lists only unsnoozed ones. */
  snoozed?: true;
  limit?: number;
}

// Narrowed to just the delegate this module needs — matches the Pick<ReturnType<typeof
// scopedDb>, ...> pattern already established in sla.ts / find-or-create-contact.ts.
type TicketListDb = Pick<ReturnType<typeof scopedDb>, "ticket">;

export interface FetchTicketListCtx {
  db: TicketListDb;
  orgId: string;
  userId: string;
}

/**
 * Converts raw Next.js `searchParams` into typed `TicketListFilters`. Delegates to the one
 * inbox filter grammar, parseUrlFilters in list-filters.ts (D-03), which FilterChipRow and
 * saved views share; `limit` is clamped to 1..MAX_LIST_LIMIT there.
 */
export function parseTicketListFilters(
  searchParams: Record<string, string | string[] | undefined>,
): TicketListFilters {
  const { filters, limit } = parseUrlFilters(searchParams);
  return {
    view: filters.view,
    stateIds: filters.stateIds.length > 0 ? [...filters.stateIds] : undefined,
    tagId: filters.tagId,
    cf: filters.cf,
    q: filters.q,
    snoozed: filters.snoozed,
    limit,
  };
}

/**
 * Builds the scopedDb `where` clause from filters and fetches the page of tickets.
 *
 * CRITICAL: when `q` is set, this forwards `filters.limit ?? 50` as searchTickets's own
 * `limit` argument. `searchTickets` defaults that argument to 25 internally — BELOW this
 * function's 50-row page size — so an FTS-active "Load more" would silently stop
 * appearing once `results.length` can never reach the 50-row `limit` again. Forwarding
 * the same limit keeps the FTS candidate-id window in lockstep with pagination.
 */
export async function fetchTicketList(filters: TicketListFilters, ctx: FetchTicketListCtx) {
  const limit = filters.limit ?? DEFAULT_TICKET_LIST_LIMIT;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic Prisma where-clause assembly
  const where: any = {};

  if (filters.view === "unassigned") {
    where.assigneeId = null;
  } else if (filters.view === "mine") {
    where.assigneeId = ctx.userId;
  }
  // "all" (or unset) — no assignee filter.

  // D-16: every view hides snoozed tickets by default; the snoozed filter shows only them. The
  // rows carry snoozedUntil (every scalar column is returned) for the snoozed chip.
  where.snoozedUntil = filters.snoozed === true ? { not: null } : null;

  // D-09: an all-missing list matches nothing. With the parser's floor an empty list only comes
  // from an absent state parameter or a stored view without a status filter.
  if (filters.stateIds && filters.stateIds.length > 0) {
    where.stateId = { in: filters.stateIds };
  }

  if (filters.tagId) {
    where.tags = { some: { tagId: filters.tagId } };
  }

  if (filters.cf) {
    const { definitionId, value } = filters.cf;
    // biome-ignore lint/suspicious/noExplicitAny: OR branch list assembled conditionally per value shape
    const or: any[] = [{ valueText: value }];
    const asNumber = Number(value);
    if (value.trim() !== "" && !Number.isNaN(asNumber)) {
      or.push({ valueNumber: asNumber });
    }
    if (value === "true" || value === "false") {
      or.push({ valueBoolean: value === "true" });
    }
    where.customFieldValues = {
      some: { customFieldDefinitionId: definitionId, OR: or },
    };
  }

  if (filters.q) {
    // 3-arg form is mandatory here — see the CRITICAL note above.
    const rows = await searchTickets(ctx.orgId, filters.q, limit);
    where.id = { in: rows.map((row) => row.id) };
  }

  return ctx.db.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      contact: true,
      assignee: true,
      tags: { include: { tag: true } },
      state: { select: { id: true, name: true, colorToken: true, group: true } },
    },
  });
}

export type TicketListItem = Awaited<ReturnType<typeof fetchTicketList>>[number];
