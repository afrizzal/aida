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
      statuses: [],
      snoozed: true,
    });
    for (const raw of ["0", "true", "", undefined]) {
      const { filters } = parseUrlFilters({ snoozed: raw });
      expect(filters).toEqual({ view: "all", statuses: [] });
      expect("snoozed" in filters).toBe(false);
    }
  });

  it("emits snoozed=1 after q only when true, and round-trips", () => {
    const f: InboxFilters = {
      view: "mine",
      statuses: ["OPEN"],
      q: "printer",
      snoozed: true,
    };
    expect(filtersToSearchParams(f).toString()).toBe("view=mine&status=OPEN&q=printer&snoozed=1");
    expect(parseUrlFilters(filtersToSearchParams(f)).filters).toEqual(f);
    expect(filtersToSearchParams({ view: "all", statuses: [] }).toString()).toBe("");
  });

  it("filtersEqual and hasAnyFilter count the field", () => {
    expect(
      filtersEqual({ view: "all", statuses: [], snoozed: true }, { view: "all", statuses: [] }),
    ).toBe(false);
    expect(filtersEqual({ view: "all", statuses: [], snoozed: true }, { snoozed: true })).toBe(
      true,
    );
    expect(hasAnyFilter({ view: "all", statuses: [], snoozed: true })).toBe(true);
    expect(hasAnyFilter({ view: "all", statuses: [] })).toBe(false);
  });
});

describe("snoozed in stored saved views", () => {
  it("keeps version 1: a view without the field parses unchanged, one with true parses", () => {
    const old = { version: 1, view: "unassigned", statuses: ["NEW"], q: "vpn" };
    expect(parseStoredFilters(old)).toEqual(old);
    const withField = { version: 1, view: "all", statuses: [], snoozed: true };
    expect(parseStoredFilters(withField)).toEqual(withField);
    expect(toStoredFilters({ view: "all", statuses: [], snoozed: true })).toEqual(withField);
    expect(toStoredFilters({ view: "all", statuses: [] })).toEqual({
      version: 1,
      view: "all",
      statuses: [],
    });
  });

  it("refuses snoozed false or the string 1 (only the literal true is stored)", () => {
    expect(
      parseStoredFilters({ version: 1, view: "all", statuses: [], snoozed: false }),
    ).toBeNull();
    expect(parseStoredFilters({ version: 1, view: "all", statuses: [], snoozed: "1" })).toBeNull();
  });
});
