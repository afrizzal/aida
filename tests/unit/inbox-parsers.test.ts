import { describe, expect, it } from "vitest";
import { MAX_AUTO_CLOSE_DAYS, parseAutoCloseDays } from "@/lib/tickets/auto-close-days";
import {
  DEFAULT_TICKET_LIST_LIMIT,
  filtersEqual,
  filtersToSearchParams,
  hasAnyFilter,
  type InboxFilters,
  LEGACY_UNMAPPED_STATE_ID,
  MAX_LIST_LIMIT,
  parseStoredFilters,
  parseUrlFilters,
  storedViewFiltersSchema,
  ticketListFiltersSchema,
  toStoredFilters,
} from "@/lib/tickets/list-filters";
import { DEFAULT_TICKET_LIST_LIMIT as LIST_QUERY_DEFAULT } from "@/lib/tickets/list-query";

const FULL: InboxFilters = {
  view: "mine",
  stateIds: ["st_open", "st_pending"],
  tagId: "tag_1",
  cf: { definitionId: "def_1", value: "a:b" },
  q: "printer jam",
};

describe("parseUrlFilters", () => {
  it("maps a malformed state token to the sentinel, deduplicates and sorts the ids", () => {
    expect(parseUrlFilters({ state: "st_open,bad id,st_open,st_new" }).filters.stateIds).toEqual([
      "st_new",
      "st_open",
      LEGACY_UNMAPPED_STATE_ID,
    ]);
  });

  it("maps an unknown view to all and keeps unassigned and mine", () => {
    expect(parseUrlFilters({ view: "everything" }).filters.view).toBe("all");
    expect(parseUrlFilters({}).filters.view).toBe("all");
    expect(parseUrlFilters({ view: "unassigned" }).filters.view).toBe("unassigned");
    expect(parseUrlFilters({ view: "mine" }).filters.view).toBe("mine");
  });

  it("omits empty tag, cf and q", () => {
    const { filters } = parseUrlFilters({ tag: "", cf: "", q: "" });
    expect(filters).toEqual({ view: "all", stateIds: [] });
    expect("tagId" in filters).toBe(false);
    expect("cf" in filters).toBe(false);
    expect("q" in filters).toBe(false);
  });

  it("cuts a 250-character q and cf value to 200 characters", () => {
    const long = "x".repeat(250);
    const { filters } = parseUrlFilters({ q: long, cf: `def_1:${long}` });
    expect(filters.q).toHaveLength(200);
    expect(filters.cf).toEqual({ definitionId: "def_1", value: "x".repeat(200) });
  });

  it("reads the first value of a repeated parameter and accepts URLSearchParams", () => {
    expect(parseUrlFilters({ view: ["mine", "all"] }).filters.view).toBe("mine");
    const sp = new URLSearchParams("view=unassigned&state=st_new,st_closed&tag=t9&limit=120");
    expect(parseUrlFilters(sp)).toEqual({
      filters: { view: "unassigned", stateIds: ["st_closed", "st_new"], tagId: "t9" },
      limit: 120,
    });
  });

  it("output always satisfies ticketListFiltersSchema", () => {
    const { filters } = parseUrlFilters({
      view: "mine",
      state: "st_resolved,st_open",
      tag: "t",
      cf: "d:v",
      q: "hi",
    });
    expect(ticketListFiltersSchema.safeParse(filters).success).toBe(true);
  });
});

describe("parseUrlFilters limit clamp (D-03, UI-SPEC Assumption 12)", () => {
  it.each([
    [undefined, 50],
    ["abc", 50],
    ["0", 50],
    ["-3", 50],
    ["", 50],
    ["120", 120],
    ["500", 500],
    ["501", 500],
    ["100000", 500],
    ["50.9", 50],
  ])("limit %s gives %i", (raw, expected) => {
    const sp: Record<string, string | undefined> = raw === undefined ? {} : { limit: raw };
    expect(parseUrlFilters(sp).limit).toBe(expected);
  });

  it("exports the default and cap", () => {
    expect(DEFAULT_TICKET_LIST_LIMIT).toBe(50);
    expect(MAX_LIST_LIMIT).toBe(500);
    expect(LIST_QUERY_DEFAULT).toBe(50);
  });
});

describe("filtersToSearchParams", () => {
  it("emits view, state, tag, cf and q in that order, without limit", () => {
    const sp = filtersToSearchParams({ ...FULL, stateIds: ["st_pending", "st_open"] });
    expect([...sp.keys()]).toEqual(["view", "state", "tag", "cf", "q"]);
    expect(sp.get("state")).toBe("st_open,st_pending");
    expect(sp.get("cf")).toBe("def_1:a:b");
    expect(sp.has("limit")).toBe(false);
  });

  it("omits view all and empty parts", () => {
    expect(filtersToSearchParams({ view: "all", stateIds: [] }).toString()).toBe("");
  });

  it("round-trips through parseUrlFilters for a filter set with every field", () => {
    expect(parseUrlFilters(filtersToSearchParams(FULL)).filters).toEqual(FULL);
  });
});

describe("filtersEqual and hasAnyFilter", () => {
  it("ignores state id order and limit", () => {
    expect(
      filtersEqual(
        { ...FULL, stateIds: ["st_pending", "st_open"], limit: 100 },
        { ...FULL, stateIds: ["st_open", "st_pending"] },
      ),
    ).toBe(true);
  });

  it("treats missing q and an empty stateIds list as equal to absent ones", () => {
    expect(filtersEqual({ view: "all", stateIds: [], q: "" }, { view: "all" })).toBe(true);
    expect(filtersEqual({ view: "all", stateIds: [] }, {})).toBe(true);
  });

  it("detects a real difference", () => {
    expect(filtersEqual(FULL, { ...FULL, q: "other" })).toBe(false);
    expect(filtersEqual(FULL, { ...FULL, cf: { definitionId: "def_1", value: "x" } })).toBe(false);
    expect(filtersEqual(FULL, { ...FULL, view: "all" })).toBe(false);
    expect(filtersEqual(FULL, { ...FULL, tagId: undefined })).toBe(false);
  });

  it("hasAnyFilter is false only for view all with nothing else set", () => {
    expect(hasAnyFilter({ view: "all", stateIds: [] })).toBe(false);
    expect(hasAnyFilter({ view: "mine", stateIds: [] })).toBe(true);
    expect(hasAnyFilter({ view: "all", stateIds: ["st_new"] })).toBe(true);
    expect(hasAnyFilter({ view: "all", stateIds: [], tagId: "t" })).toBe(true);
    expect(hasAnyFilter({ view: "all", stateIds: [], cf: { definitionId: "d", value: "" } })).toBe(
      true,
    );
    expect(hasAnyFilter({ view: "all", stateIds: [], q: "x" })).toBe(true);
  });
});

describe("stored view filters (D-03)", () => {
  it("toStoredFilters adds version 2 and drops nothing else", () => {
    expect(toStoredFilters(FULL)).toEqual({ version: 2, ...FULL });
    expect(toStoredFilters({ view: "all", stateIds: [] })).toEqual({
      version: 2,
      view: "all",
      stateIds: [],
    });
    expect(storedViewFiltersSchema.safeParse(toStoredFilters(FULL)).success).toBe(true);
  });

  it("parseStoredFilters accepts what toStoredFilters wrote", () => {
    expect(parseStoredFilters(toStoredFilters(FULL))).toEqual({ version: 2, ...FULL });
  });

  it.each([
    ["missing version", { view: "all", stateIds: [] }],
    ["version 1 with statuses", { version: 1, view: "all", statuses: ["NEW"] }],
    ["version 1 with stateIds", { version: 1, view: "all", stateIds: [] }],
    ["an empty state id", { version: 2, view: "all", stateIds: [""] }],
    ["a duplicated state id", { version: 2, view: "all", stateIds: ["st_new", "st_new"] }],
    ["a 201-character q", { version: 2, view: "all", stateIds: [], q: "q".repeat(201) }],
    ["a stored limit", { version: 2, view: "all", stateIds: [], limit: 50 }],
    ["a non-object", "view=all"],
    ["null", null],
    ["an array", []],
  ])("parseStoredFilters returns null for %s", (_label, raw) => {
    expect(parseStoredFilters(raw)).toBeNull();
  });
});

describe("parseAutoCloseDays (D-15)", () => {
  it.each([
    ["0", 0],
    ["365", 365],
    [" 12 ", 12],
    ["007", 7],
    [30, 30],
    [0, 0],
  ])("accepts %j as %i", (raw, days) => {
    expect(parseAutoCloseDays(raw)).toEqual({ ok: true, days });
  });

  it.each([
    [""],
    ["  "],
    ["abc"],
    ["1.5"],
    ["1e2"],
    ["+5"],
    ["-1"],
    ["366"],
    ["0366"],
    ["1 2"],
    ["٣"],
    ["１２"],
    ["99999999999999999999999"],
    [366],
    [-1],
    [2.5],
    [Number.NaN],
    [null],
    [undefined],
    [{}],
  ])("refuses %j", (raw) => {
    expect(parseAutoCloseDays(raw)).toEqual({ ok: false });
  });

  it("caps at 365", () => {
    expect(MAX_AUTO_CLOSE_DAYS).toBe(365);
  });
});
