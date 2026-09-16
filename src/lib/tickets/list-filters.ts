// The ONE inbox filter grammar (Phase 11, D-03), shared by the URL parser and saved views.
//
// Client-safe: imports zod and the pure cf-param helpers only. FilterChipRow and the saved-view
// dialog import this module, so it must never pull a database or server module into the
// client bundle.
//
// `limit` is page size, never a filter: it is parsed from the URL beside the filters, clamped
// to MAX_LIST_LIMIT, and never stored in a saved view. `mine` always means the viewer; the
// grammar stores the word, never a user id.
import { z } from "zod/v4";
import { parseCfParam, serializeCfParam } from "./cf-param";

/** Ticket statuses in enum order (prisma/schema.prisma TicketStatus). */
export const TICKET_STATUSES = ["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"] as const;
export type InboxTicketStatus = (typeof TICKET_STATUSES)[number];

export const INBOX_VIEWS = ["all", "unassigned", "mine"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const DEFAULT_TICKET_LIST_LIMIT = 50;
/** Ten "Load more" steps of 50; larger URL values are clamped, not rejected (UI-SPEC Assumption 12). */
export const MAX_LIST_LIMIT = 500;

const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 200;

const filterShape = {
  view: z.enum(INBOX_VIEWS).default("all"),
  statuses: z
    .array(z.enum(TICKET_STATUSES))
    .refine((list) => new Set(list).size === list.length, { message: "statuses must be unique" })
    .default([]),
  tagId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  cf: z
    .strictObject({
      definitionId: z.string().min(1).max(MAX_ID_LENGTH),
      value: z.string().max(MAX_TEXT_LENGTH),
    })
    .optional(),
  q: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
};

/** Inbox filters as used by the URL and the list query. Unknown keys (including limit) are refused. */
export const ticketListFiltersSchema = z.strictObject(filterShape);

/** Stored saved-view filters: the same grammar plus `version: 1`. */
export const storedViewFiltersSchema = z.strictObject({ version: z.literal(1), ...filterShape });

export type InboxFilters = z.output<typeof ticketListFiltersSchema>;
/** Looser input form: view and statuses may be absent; limit is tolerated and ignored. */
export type InboxFiltersInput = z.input<typeof ticketListFiltersSchema> & { limit?: number };
export type StoredViewFilters = z.output<typeof storedViewFiltersSchema>;

/** Next.js `searchParams` objects, URLSearchParams and ReadonlyURLSearchParams. */
export type SearchParamsLike =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

function readParam(source: SearchParamsLike, key: string): string | undefined {
  if (typeof (source as { get?: unknown }).get === "function") {
    return (source as { get(name: string): string | null }).get(key) ?? undefined;
  }
  const value = (source as Record<string, string | string[] | undefined>)[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Cuts to max UTF-16 units without leaving a lone high surrogate at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

function orderStatuses(list: readonly string[]): InboxTicketStatus[] {
  const set = new Set(list);
  return TICKET_STATUSES.filter((s) => set.has(s));
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TICKET_LIST_LIMIT;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TICKET_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

/**
 * Lenient URL parser: unknown statuses and views are dropped, statuses deduplicated and put in
 * enum order, empty tag/cf/q omitted, q and the cf value cut to 200 characters, over-long ids
 * dropped, and limit clamped to 1..MAX_LIST_LIMIT (non-numeric or below 1 gives the default).
 * The result is then validated with ticketListFiltersSchema.
 */
export function parseUrlFilters(source: SearchParamsLike): {
  filters: InboxFilters;
  limit: number;
} {
  const view = readParam(source, "view");
  const status = readParam(source, "status");
  const tag = readParam(source, "tag");
  const cfRaw = readParam(source, "cf");
  const q = readParam(source, "q");

  const candidate: Record<string, unknown> = {
    view: view === "unassigned" || view === "mine" ? view : "all",
    statuses: status ? orderStatuses(status.split(",")) : [],
  };
  if (tag && tag.length <= MAX_ID_LENGTH) candidate.tagId = tag;
  if (cfRaw) {
    const cf = parseCfParam(cfRaw);
    if (cf.definitionId && cf.definitionId.length <= MAX_ID_LENGTH) {
      candidate.cf = { definitionId: cf.definitionId, value: cut(cf.value, MAX_TEXT_LENGTH) };
    }
  }
  if (q) candidate.q = cut(q, MAX_TEXT_LENGTH);

  const parsed = ticketListFiltersSchema.safeParse(candidate);
  const filters: InboxFilters = parsed.success ? parsed.data : { view: "all", statuses: [] };
  return { filters, limit: parseLimit(readParam(source, "limit")) };
}

/** Canonical URL form: view (only when not all), status (enum order), tag, cf, q. Never limit. */
export function filtersToSearchParams(filters: InboxFiltersInput): URLSearchParams {
  const params = new URLSearchParams();
  const view = filters.view ?? "all";
  if (view !== "all") params.set("view", view);
  const statuses = orderStatuses(filters.statuses ?? []);
  if (statuses.length > 0) params.set("status", statuses.join(","));
  if (filters.tagId) params.set("tag", filters.tagId);
  if (filters.cf) params.set("cf", serializeCfParam(filters.cf.definitionId, filters.cf.value));
  if (filters.q) params.set("q", filters.q);
  return params;
}

/** Equality on the filter grammar: status order, limit, empty statuses and empty q are ignored. */
export function filtersEqual(a: InboxFiltersInput, b: InboxFiltersInput): boolean {
  return filtersToSearchParams(a).toString() === filtersToSearchParams(b).toString();
}

/** False only for view all with nothing else set. */
export function hasAnyFilter(filters: InboxFiltersInput): boolean {
  return filtersToSearchParams(filters).toString() !== "";
}

/**
 * The stored JSON shape: exactly { version: 1, view, statuses, and tagId, cf, q only when set }.
 * Throws a ZodError when the filters do not satisfy ticketListFiltersSchema.
 */
export function toStoredFilters(filters: InboxFiltersInput): StoredViewFilters {
  const { limit: _limit, ...rest } = filters;
  const parsed = ticketListFiltersSchema.parse(rest);
  const stored: StoredViewFilters = { version: 1, view: parsed.view, statuses: parsed.statuses };
  if (parsed.tagId !== undefined) stored.tagId = parsed.tagId;
  if (parsed.cf !== undefined) stored.cf = parsed.cf;
  if (parsed.q !== undefined) stored.q = parsed.q;
  return stored;
}

/** Returns the stored filters, or null for anything that is not a valid version 1 shape. */
export function parseStoredFilters(raw: unknown): StoredViewFilters | null {
  const parsed = storedViewFiltersSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
