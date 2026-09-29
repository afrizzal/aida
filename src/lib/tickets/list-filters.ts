// The ONE inbox filter grammar (Phase 11, D-03; Phase 12.1 D-09), shared by the URL parser and
// saved views. Statuses are state ids of the active organization (stateIds); stored saved-view
// filters are version 2.
//
// Frozen URL contract (D-09, D-19, UI-SPEC Assumption 6): the status filter is the `state`
// parameter holding state ids joined by "," in code-unit order. Only an ABSENT parameter means no
// state filter. A present one fails closed: empty tokens are dropped, a malformed token becomes
// LEGACY_UNMAPPED_STATE_ID (never dropped), and when nothing is left the result is
// [LEGACY_UNMAPPED_STATE_ID], so a present parameter never widens the list (review C1).
//
// Client-safe: imports zod and the pure cf-param helpers only. FilterChipRow and the saved-view
// dialog import this module, so it must never pull a database or server module into the
// client bundle.
//
// `limit` is page size, never a filter: it is parsed from the URL beside the filters, clamped
// to MAX_LIST_LIMIT, and never stored in a saved view. `mine` always means the viewer; the
// grammar stores the word, never a user id.
import { z } from "zod/v4";
import { cut } from "../text/cut";
import { parseCfParam, serializeCfParam } from "./cf-param";

/** The five legacy status keys of old `status=` URLs; used only by the compatibility mapper. */
export const LEGACY_STATUS_KEYS = ["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"] as const;
export type LegacyStatusParamKey = (typeof LEGACY_STATUS_KEYS)[number];

/**
 * The sentinel state id for a token that names no state (malformed, unknown legacy value, a
 * present but empty parameter). It matches no ticket and always counts as a missing state.
 */
export const LEGACY_UNMAPPED_STATE_ID = "unmapped-legacy-status";

export const INBOX_VIEWS = ["all", "unassigned", "mine"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const DEFAULT_TICKET_LIST_LIMIT = 50;
/** Ten "Load more" steps of 50; larger URL values are clamped, not rejected (UI-SPEC Assumption 12). */
export const MAX_LIST_LIMIT = 500;

const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 200;
/** A well-formed state id token in the URL. */
const STATE_ID_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

const filterShape = {
  view: z.enum(INBOX_VIEWS).default("all"),
  stateIds: z
    .array(z.string().min(1).max(MAX_ID_LENGTH))
    .refine((list) => new Set(list).size === list.length, { message: "stateIds must be unique" })
    .default([]),
  tagId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  cf: z
    .strictObject({
      definitionId: z.string().min(1).max(MAX_ID_LENGTH),
      value: z.string().max(MAX_TEXT_LENGTH),
    })
    .optional(),
  q: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
  /**
   * Phase 12 D-16: true shows only snoozed tickets; absent (the default) hides them. Only the
   * literal true is valid, so a stored view without the field parses unchanged.
   */
  snoozed: z.literal(true).optional(),
};

/** Inbox filters as used by the URL and the list query. Unknown keys (including limit) are refused. */
export const ticketListFiltersSchema = z.strictObject(filterShape);

/** Stored saved-view filters: the same grammar plus `version: 2` (D-09; version 1 is refused). */
export const storedViewFiltersSchema = z.strictObject({ version: z.literal(2), ...filterShape });

export type InboxFilters = z.output<typeof ticketListFiltersSchema>;
/** Looser input form: view and stateIds may be absent; limit is tolerated and ignored. */
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

/** De-duplicated and sorted in code-unit order: the canonical order of state ids. */
function canonicalIds(list: readonly string[]): string[] {
  return [...new Set(list)].sort();
}

/**
 * Parses a PRESENT `state` parameter value (review C1, D-09 fail-closed): split on ",", trim,
 * drop empty tokens, replace each malformed token by the sentinel, de-duplicate and sort; when
 * nothing is left the result is [LEGACY_UNMAPPED_STATE_ID], never an empty list.
 */
function parseStateParam(raw: string): string[] {
  const ids = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => (STATE_ID_TOKEN.test(token) ? token : LEGACY_UNMAPPED_STATE_ID));
  return ids.length > 0 ? canonicalIds(ids) : [LEGACY_UNMAPPED_STATE_ID];
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TICKET_LIST_LIMIT;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TICKET_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

/**
 * Lenient URL parser: an unknown view becomes all, empty tag/cf/q are omitted, q and the cf value
 * are cut to 200 characters, over-long tag and field ids are dropped, and limit is clamped to
 * 1..MAX_LIST_LIMIT (non-numeric or below 1 gives the default). The state parameter is never
 * lenient in the widening direction: when it is absent there is no state filter; when it is
 * present but empty, whitespace only or malformed it fails closed (malformed tokens become
 * LEGACY_UNMAPPED_STATE_ID, and nothing left gives [LEGACY_UNMAPPED_STATE_ID]), so it narrows the
 * list instead of widening it (review C1). The result is validated with ticketListFiltersSchema;
 * when that fails the fallback is an unfiltered view that still keeps
 * [LEGACY_UNMAPPED_STATE_ID] whenever the state parameter was present.
 */
export function parseUrlFilters(source: SearchParamsLike): {
  filters: InboxFilters;
  limit: number;
} {
  const view = readParam(source, "view");
  const state = readParam(source, "state");
  const tag = readParam(source, "tag");
  const cfRaw = readParam(source, "cf");
  const q = readParam(source, "q");
  const snoozed = readParam(source, "snoozed");

  const candidate: Record<string, unknown> = {
    view: view === "unassigned" || view === "mine" ? view : "all",
    stateIds: state === undefined ? [] : parseStateParam(state),
  };
  if (tag && tag.length <= MAX_ID_LENGTH) candidate.tagId = tag;
  if (cfRaw) {
    const cf = parseCfParam(cfRaw);
    if (cf.definitionId && cf.definitionId.length <= MAX_ID_LENGTH) {
      candidate.cf = { definitionId: cf.definitionId, value: cut(cf.value, MAX_TEXT_LENGTH) };
    }
  }
  if (q) candidate.q = cut(q, MAX_TEXT_LENGTH);
  if (snoozed === "1") candidate.snoozed = true;

  const parsed = ticketListFiltersSchema.safeParse(candidate);
  const filters: InboxFilters = parsed.success
    ? parsed.data
    : { view: "all", stateIds: state === undefined ? [] : [LEGACY_UNMAPPED_STATE_ID] };
  return { filters, limit: parseLimit(readParam(source, "limit")) };
}

/**
 * Canonical URL form: view (only when not all), state (ids sorted in code-unit order; no
 * parameter for an empty list), tag, cf, q, then snoozed=1 only when true. Never limit.
 */
export function filtersToSearchParams(filters: InboxFiltersInput): URLSearchParams {
  const params = new URLSearchParams();
  const view = filters.view ?? "all";
  if (view !== "all") params.set("view", view);
  const stateIds = canonicalIds(filters.stateIds ?? []);
  if (stateIds.length > 0) params.set("state", stateIds.join(","));
  if (filters.tagId) params.set("tag", filters.tagId);
  if (filters.cf) params.set("cf", serializeCfParam(filters.cf.definitionId, filters.cf.value));
  if (filters.q) params.set("q", filters.q);
  if (filters.snoozed === true) params.set("snoozed", "1");
  return params;
}

/** Equality on the filter grammar: state id order, limit, empty stateIds and empty q are ignored. */
export function filtersEqual(a: InboxFiltersInput, b: InboxFiltersInput): boolean {
  return filtersToSearchParams(a).toString() === filtersToSearchParams(b).toString();
}

/** False only for view all with nothing else set. */
export function hasAnyFilter(filters: InboxFiltersInput): boolean {
  return filtersToSearchParams(filters).toString() !== "";
}

/**
 * The stored JSON shape: exactly { version: 2, view, stateIds (sorted), and tagId, cf, q, snoozed
 * only when set }.
 * Throws a ZodError when the filters do not satisfy ticketListFiltersSchema.
 */
export function toStoredFilters(filters: InboxFiltersInput): StoredViewFilters {
  const { limit: _limit, ...rest } = filters;
  const parsed = ticketListFiltersSchema.parse(rest);
  const stored: StoredViewFilters = {
    version: 2,
    view: parsed.view,
    stateIds: canonicalIds(parsed.stateIds),
  };
  if (parsed.tagId !== undefined) stored.tagId = parsed.tagId;
  if (parsed.cf !== undefined) stored.cf = parsed.cf;
  if (parsed.q !== undefined) stored.q = parsed.q;
  if (parsed.snoozed === true) stored.snoozed = true;
  return stored;
}

/** Returns the stored filters, or null for anything that is not a valid version 2 shape. */
export function parseStoredFilters(raw: unknown): StoredViewFilters | null {
  const parsed = storedViewFiltersSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Compatibility mapper for old `status=<ENUM,...>` URLs (D-09). `legacy` is the active
 * organization's map from legacy key to state id, supplied by the server (this module stays
 * client-safe). Keys are matched case-insensitively. A value that is not one of the five keys, or
 * whose state is soft-deleted (null in the map), becomes LEGACY_UNMAPPED_STATE_ID: never dropped,
 * never widened. A present value that names nothing gives [LEGACY_UNMAPPED_STATE_ID], the same
 * floor as the state parser (review C1).
 */
export function mapLegacyStatusParam(
  raw: string,
  legacy: Readonly<Record<LegacyStatusParamKey, string | null>>,
): string[] {
  const ids = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => {
      const key = token.toUpperCase();
      const id = (LEGACY_STATUS_KEYS as readonly string[]).includes(key)
        ? legacy[key as LegacyStatusParamKey]
        : null;
      return id ?? LEGACY_UNMAPPED_STATE_ID;
    });
  return ids.length > 0 ? canonicalIds(ids) : [LEGACY_UNMAPPED_STATE_ID];
}

/** The entries of a Next.js searchParams record or a URLSearchParams, in order. */
function searchEntries(
  source: Record<string, string | string[] | undefined> | URLSearchParams,
): [string, string][] {
  if (source instanceof URLSearchParams) return [...source.entries()];
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) entries.push([key, item]);
  }
  return entries;
}

/**
 * The canonical query string for a URL that still carries the old `status` parameter (a present
 * but empty one counts as present), or null when it carries none. `status` is removed and
 * `state` holds the sorted union of the URL's own state ids and the mapped ids, in the slot of
 * whichever of the two came first; every other parameter is kept as it was. The caller redirects
 * to its own base path plus this string, so no host or path comes from the input (T-12.1-40).
 */
export function legacyRedirectSearch(
  searchParams: Record<string, string | string[] | undefined> | URLSearchParams,
  legacy: Readonly<Record<LegacyStatusParamKey, string | null>>,
): string | null {
  const status = readParam(searchParams, "status");
  if (status === undefined) return null;
  const state = readParam(searchParams, "state");
  const merged = canonicalIds([
    ...(state === undefined ? [] : parseStateParam(state)),
    ...mapLegacyStatusParam(status, legacy),
  ]);
  const out = new URLSearchParams();
  let stateWritten = false;
  for (const [key, value] of searchEntries(searchParams)) {
    if (key === "status" || key === "state") {
      if (!stateWritten) out.set("state", merged.join(","));
      stateWritten = true;
      continue;
    }
    out.append(key, value);
  }
  return out.toString();
}

/**
 * The filter's state ids that are not among the organization's active state ids, in filter
 * order. LEGACY_UNMAPPED_STATE_ID is always missing.
 */
export function missingStateIds(
  filters: { stateIds?: readonly string[] },
  activeIds: readonly string[],
): string[] {
  const active = new Set(activeIds);
  return (filters.stateIds ?? []).filter(
    (id) => id === LEGACY_UNMAPPED_STATE_ID || !active.has(id),
  );
}
