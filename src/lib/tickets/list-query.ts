import type { TicketStatus } from "@/generated/prisma/client";
import type { scopedDb } from "@/lib/scoped-db";
import { parseCfParam } from "@/lib/tickets/cf-param";
import { searchTickets } from "@/lib/tickets/search";

export const DEFAULT_TICKET_LIST_LIMIT = 50;

const VALID_STATUSES: readonly TicketStatus[] = ["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"];

export interface TicketListFilters {
  view?: "unassigned" | "mine" | "all";
  statuses?: TicketStatus[];
  tagId?: string;
  cf?: { definitionId: string; value: string };
  q?: string;
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

function toSingleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Converts raw Next.js `searchParams` into typed `TicketListFilters` — the single
 * parsing site that must stay in lockstep with FilterChipRow's URL scheme
 * (view/status/tag/cf/q/limit).
 */
export function parseTicketListFilters(
  searchParams: Record<string, string | string[] | undefined>,
): TicketListFilters {
  const view = toSingleParam(searchParams.view);
  const status = toSingleParam(searchParams.status);
  const tag = toSingleParam(searchParams.tag);
  const cf = toSingleParam(searchParams.cf);
  const q = toSingleParam(searchParams.q);
  const limit = toSingleParam(searchParams.limit);

  const statuses = status
    ?.split(",")
    .filter((s): s is TicketStatus => (VALID_STATUSES as string[]).includes(s));

  return {
    view: view === "unassigned" || view === "mine" ? view : "all",
    statuses: statuses && statuses.length > 0 ? statuses : undefined,
    tagId: tag || undefined,
    cf: cf ? parseCfParam(cf) : undefined,
    q: q || undefined,
    limit: limit ? Number(limit) || DEFAULT_TICKET_LIST_LIMIT : DEFAULT_TICKET_LIST_LIMIT,
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

  if (filters.statuses && filters.statuses.length > 0) {
    where.status = { in: filters.statuses };
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
    },
  });
}

export type TicketListItem = Awaited<ReturnType<typeof fetchTicketList>>[number];
