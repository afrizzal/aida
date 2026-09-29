// Phase 12, plan 12-05: the snoozed field of the one inbox filter grammar (D-16).
import { describe, expect, it } from "vitest";
import {
  filtersEqual,
  filtersToSearchParams,
  hasAnyFilter,
  type InboxFilters,
  parseStoredFilters,
  parseUrlFilters,
  toStoredFilters,
} from "@/lib/tickets/list-filters";

describe("snoozed in the URL grammar", () => {
  it("parses snoozed=1 to true and anything else to no field", () => {
    expect(parseUrlFilters({ snoozed: "1" }).filters).toEqual({
      view: "all",
      stateIds: [],
      snoozed: true,
    });
    for (const raw of ["0", "true", "", undefined]) {
      const { filters } = parseUrlFilters({ snoozed: raw });
      expect(filters).toEqual({ view: "all", stateIds: [] });
      expect("snoozed" in filters).toBe(false);
    }
  });

  it("emits snoozed=1 after q only when true, and round-trips", () => {
    const f: InboxFilters = {
      view: "mine",
      stateIds: ["st_open"],
      q: "printer",
      snoozed: true,
    };
    expect(filtersToSearchParams(f).toString()).toBe("view=mine&state=st_open&q=printer&snoozed=1");
    expect(parseUrlFilters(filtersToSearchParams(f)).filters).toEqual(f);
    expect(filtersToSearchParams({ view: "all", stateIds: [] }).toString()).toBe("");
  });

  it("filtersEqual and hasAnyFilter count the field", () => {
    expect(
      filtersEqual({ view: "all", stateIds: [], snoozed: true }, { view: "all", stateIds: [] }),
    ).toBe(false);
    expect(filtersEqual({ view: "all", stateIds: [], snoozed: true }, { snoozed: true })).toBe(
      true,
    );
    expect(hasAnyFilter({ view: "all", stateIds: [], snoozed: true })).toBe(true);
    expect(hasAnyFilter({ view: "all", stateIds: [] })).toBe(false);
  });
});

describe("snoozed in stored saved views", () => {
  it("version 2: a view without the field parses unchanged, one with true parses", () => {
    const old = { version: 2, view: "unassigned", stateIds: ["st_new"], q: "vpn" };
    expect(parseStoredFilters(old)).toEqual(old);
    const withField = { version: 2, view: "all", stateIds: [], snoozed: true };
    expect(parseStoredFilters(withField)).toEqual(withField);
    expect(toStoredFilters({ view: "all", stateIds: [], snoozed: true })).toEqual(withField);
    expect(toStoredFilters({ view: "all", stateIds: [] })).toEqual({
      version: 2,
      view: "all",
      stateIds: [],
    });
  });

  it("refuses snoozed false or the string 1 (only the literal true is stored)", () => {
    expect(
      parseStoredFilters({ version: 2, view: "all", stateIds: [], snoozed: false }),
    ).toBeNull();
    expect(parseStoredFilters({ version: 2, view: "all", stateIds: [], snoozed: "1" })).toBeNull();
  });
});
