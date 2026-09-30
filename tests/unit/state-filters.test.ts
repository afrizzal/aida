// Phase 12.1, plan 12.1-10 (AIDA-56, D-09, review C1): the inbox filter grammar on state ids, the
// frozen state= URL contract, the compatibility mapper for old status= URLs and the missing-id
// helper. A present state parameter never yields an empty list, so it can never widen the inbox.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filtersEqual,
  filtersToSearchParams,
  LEGACY_UNMAPPED_STATE_ID,
  legacyRedirectSearch,
  mapLegacyStatusParam,
  missingStateIds,
  parseStoredFilters,
  parseUrlFilters,
  storedViewFiltersSchema,
  ticketListFiltersSchema,
  toStoredFilters,
} from "@/lib/tickets/list-filters";

const SENTINEL = LEGACY_UNMAPPED_STATE_ID;

const LEGACY = {
  NEW: "id-new",
  OPEN: "id-open",
  PENDING: "id-pending",
  RESOLVED: "id-resolved",
  CLOSED: null,
};

function stateIdsOf(query: string): string[] {
  return parseUrlFilters(new URLSearchParams(query)).filters.stateIds;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseUrlFilters: the state parameter", () => {
  it("drops empty tokens, de-duplicates and sorts in code-unit order", () => {
    expect(stateIdsOf("state=b,a,,a")).toEqual(["a", "b"]);
  });

  it("maps a token longer than 64 characters to the sentinel instead of dropping it", () => {
    expect(stateIdsOf(`state=a,${"x".repeat(65)}`)).toEqual(["a", SENTINEL].sort());
  });

  it("maps a token with a space to the sentinel", () => {
    expect(stateIdsOf("state=a%20b")).toEqual([SENTINEL]);
  });

  it("an absent state parameter means no state filter", () => {
    expect(stateIdsOf("view=mine")).toEqual([]);
    expect(stateIdsOf("")).toEqual([]);
  });

  it("fails closed for state= (present but empty)", () => {
    expect(stateIdsOf("state=")).toEqual([SENTINEL]);
    expect(parseUrlFilters({ state: "" }).filters.stateIds).toEqual([SENTINEL]);
  });

  it("fails closed for state=,,, (only empty tokens)", () => {
    expect(stateIdsOf("state=,,,")).toEqual([SENTINEL]);
  });

  it("fails closed for a whitespace-only value", () => {
    expect(stateIdsOf("state=%20%20")).toEqual([SENTINEL]);
  });

  it("keeps a valid id next to an invalid token, and ignores blank tokens beside a valid id", () => {
    expect(stateIdsOf("state=a,not%20valid!")).toEqual(["a", SENTINEL]);
    expect(stateIdsOf("state=a,%20,")).toEqual(["a"]);
  });

  it("does not read the old status parameter", () => {
    expect(stateIdsOf("status=OPEN")).toEqual([]);
  });

  it("the schema-failure fallback keeps the sentinel when state was present and [] when absent", () => {
    vi.spyOn(ticketListFiltersSchema, "safeParse").mockReturnValue({
      success: false,
      error: new Error("forced") as never,
    } as never);
    expect(parseUrlFilters(new URLSearchParams("state=a&view=mine")).filters).toEqual({
      view: "all",
      stateIds: [SENTINEL],
    });
    expect(parseUrlFilters(new URLSearchParams("state=")).filters.stateIds).toEqual([SENTINEL]);
    expect(parseUrlFilters(new URLSearchParams("view=mine")).filters).toEqual({
      view: "all",
      stateIds: [],
    });
  });

  it("a sentinel-only filter round-trips to state=unmapped-legacy-status and stays closed", () => {
    const params = filtersToSearchParams({ stateIds: [SENTINEL] });
    expect(params.toString()).toBe("state=unmapped-legacy-status");
    expect(parseUrlFilters(params).filters.stateIds).toEqual([SENTINEL]);
  });
});

describe("canonical order (ordering edge)", () => {
  it("filtersToSearchParams writes the ids sorted", () => {
    expect(filtersToSearchParams({ stateIds: ["b", "a"] }).get("state")).toBe("a,b");
  });

  it("filtersEqual is order-independent", () => {
    expect(filtersEqual({ stateIds: ["a", "b"] }, { stateIds: ["b", "a"] })).toBe(true);
    expect(filtersEqual({ stateIds: ["a"] }, { stateIds: ["a", "b"] })).toBe(false);
  });

  it("two URLs naming the same ids in different orders give the same canonical query", () => {
    const one = filtersToSearchParams(parseUrlFilters(new URLSearchParams("state=b,a")).filters);
    const two = filtersToSearchParams(parseUrlFilters(new URLSearchParams("state=a,b")).filters);
    expect(one.toString()).toBe(two.toString());
  });
});

describe("mapLegacyStatusParam (old status= URLs, D-09)", () => {
  it("maps legacy keys to the organization's ids, sorted", () => {
    expect(mapLegacyStatusParam("PENDING,OPEN", LEGACY)).toEqual(["id-open", "id-pending"]);
  });

  it("maps keys case-insensitively and collapses duplicates", () => {
    expect(mapLegacyStatusParam("open,OPEN, Open ", LEGACY)).toEqual(["id-open"]);
  });

  it("maps an unknown value to the sentinel", () => {
    expect(mapLegacyStatusParam("ARCHIVED", LEGACY)).toEqual([SENTINEL]);
    expect(mapLegacyStatusParam("OPEN,ARCHIVED", LEGACY)).toEqual(["id-open", SENTINEL]);
  });

  it("maps a key whose state is soft-deleted (null) to the sentinel", () => {
    expect(mapLegacyStatusParam("CLOSED", LEGACY)).toEqual([SENTINEL]);
  });

  it("applies the same floor as the state parser for a present but empty value", () => {
    expect(mapLegacyStatusParam("", LEGACY)).toEqual([SENTINEL]);
    expect(mapLegacyStatusParam(" , ", LEGACY)).toEqual([SENTINEL]);
  });
});

describe("legacyRedirectSearch", () => {
  it("replaces status and state with their intersection, keeping other params (D-09, review WR-b1)", () => {
    const search = legacyRedirectSearch(
      new URLSearchParams("view=mine&status=OPEN,PENDING&sv=x&state=c,id-open"),
      LEGACY,
    );
    expect(search).not.toBeNull();
    const params = new URLSearchParams(search ?? "");
    expect(params.get("view")).toBe("mine");
    expect(params.get("state")).toBe("id-open");
    expect(params.get("sv")).toBe("x");
    expect(params.has("status")).toBe(false);
    expect(params.getAll("state")).toHaveLength(1);
  });

  it("never widens a URL with both parameters: no common id yields the sentinel (review WR-b1)", () => {
    const search = legacyRedirectSearch(
      new URLSearchParams("view=mine&status=OPEN&sv=x&state=c"),
      LEGACY,
    );
    const params = new URLSearchParams(search ?? "");
    expect(params.get("state")).toBe(SENTINEL);
    expect(params.get("view")).toBe("mine");
    expect(params.has("status")).toBe(false);
  });

  it("accepts a Next.js searchParams record", () => {
    const search = legacyRedirectSearch({ status: "PENDING,NEW", q: "vpn" }, LEGACY);
    const params = new URLSearchParams(search ?? "");
    expect(params.get("state")).toBe("id-new,id-pending");
    expect(params.get("q")).toBe("vpn");
    expect(params.has("status")).toBe(false);
  });

  it("treats a present but empty status parameter as present and fails closed", () => {
    const search = legacyRedirectSearch(new URLSearchParams("status="), LEGACY);
    expect(new URLSearchParams(search ?? "").get("state")).toBe(SENTINEL);
  });

  it("returns null when there is no status parameter", () => {
    expect(legacyRedirectSearch(new URLSearchParams("view=mine&state=a"), LEGACY)).toBeNull();
    expect(legacyRedirectSearch({ view: "mine" }, LEGACY)).toBeNull();
  });
});

describe("missingStateIds", () => {
  it("returns the ids that are not active", () => {
    expect(missingStateIds({ stateIds: ["a", "z"] }, ["a", "b"])).toEqual(["z"]);
    expect(missingStateIds({ stateIds: [] }, ["a"])).toEqual([]);
  });

  it("always counts the sentinel as missing", () => {
    expect(missingStateIds({ stateIds: [SENTINEL] }, [SENTINEL])).toEqual([SENTINEL]);
  });
});

describe("stored filters version 2", () => {
  it("toStoredFilters writes version 2 with stateIds", () => {
    expect(toStoredFilters({ view: "mine", stateIds: ["b", "a"] })).toEqual({
      version: 2,
      view: "mine",
      stateIds: ["a", "b"],
    });
    expect(storedViewFiltersSchema.safeParse(toStoredFilters({})).success).toBe(true);
  });

  it("parseStoredFilters returns null for a version 1 object", () => {
    expect(parseStoredFilters({ version: 1, view: "all", statuses: ["OPEN"] })).toBeNull();
    expect(parseStoredFilters({ version: 1, view: "all", stateIds: [] })).toBeNull();
    expect(parseStoredFilters({ version: 2, view: "all", stateIds: ["a"] })).toEqual({
      version: 2,
      view: "all",
      stateIds: ["a"],
    });
  });
});
