// Phase 14, plan 14-03 (contract section 7, D-09): the pure recurrence date rules. Injected Date
// values only, never the current clock; the complexity bound is proven by an iteration count.
import { describe, expect, it } from "vitest";
import type { RecurrenceRule } from "../../src/lib/projects/contract";
import {
  addDays,
  initialAnchor,
  nextOccurrence,
  nextOccurrenceDetailed,
  occurrenceBase,
  sequenceDate,
  successorDates,
} from "../../src/lib/projects/recurrence-rules";

describe("sequenceDate", () => {
  it("clamps MONTHLY to the month's last day, computed from the anchor each time", () => {
    expect([0, 1, 2, 3, 4].map((k) => sequenceDate("2026-01-31", "MONTHLY", k))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(sequenceDate("2028-01-31", "MONTHLY", 1)).toBe("2028-02-29");
    expect(sequenceDate("2026-01-30", "MONTHLY", 1)).toBe("2026-02-28");
    expect(sequenceDate("2026-01-30", "MONTHLY", 2)).toBe("2026-03-30");
  });

  it("steps one day (DAILY) and seven days (WEEKLY), across a year end", () => {
    expect(sequenceDate("2026-12-31", "DAILY", 1)).toBe("2027-01-01");
    expect(sequenceDate("2026-12-28", "WEEKLY", 1)).toBe("2027-01-04");
    expect(sequenceDate("2026-11-30", "MONTHLY", 1)).toBe("2026-12-30");
    expect(sequenceDate("2026-11-30", "MONTHLY", 2)).toBe("2027-01-30");
  });
});

describe("nextOccurrence and nextOccurrenceDetailed", () => {
  const cases: [string, RecurrenceRule, string, string][] = [
    ["2026-01-05", "WEEKLY", "2026-01-07", "2026-01-12"],
    ["2026-01-05", "WEEKLY", "2026-01-12", "2026-01-19"],
    ["2026-01-05", "WEEKLY", "2025-12-01", "2026-01-05"],
    ["2026-12-31", "DAILY", "2026-12-31", "2027-01-01"],
    ["2026-12-31", "MONTHLY", "2026-12-31", "2027-01-31"],
    ["1970-01-01", "DAILY", "2999-12-30", "2999-12-31"],
    ["1970-01-31", "MONTHLY", "2999-11-30", "2999-12-31"],
    ["2026-03-07", "DAILY", "2026-03-08", "2026-03-09"],
    ["2026-03-01", "WEEKLY", "2026-03-08", "2026-03-15"],
    ["2026-01-31", "MONTHLY", "2026-02-28", "2026-03-31"],
    ["2026-01-31", "MONTHLY", "2026-02-27", "2026-02-28"],
  ];

  it.each(cases)("anchor %s %s after base %s is %s", (anchor, rule, base, expected) => {
    expect(nextOccurrence(anchor, rule, base)).toBe(expected);
  });

  it.each(
    cases,
  )("anchor %s %s base %s: the detailed result agrees, with steps at most 2", (anchor, rule, base, expected) => {
    const detailed = nextOccurrenceDetailed(anchor, rule, base);
    expect(detailed.date).toBe(expected);
    expect(detailed.date).toBe(nextOccurrence(anchor, rule, base));
    expect(sequenceDate(anchor, rule, detailed.index)).toBe(detailed.date);
    expect(detailed.steps).toBeLessThanOrEqual(2);
  });

  it("reaches the far cases arithmetically: index from the distance, steps at most 2", () => {
    const daily = nextOccurrenceDetailed("1970-01-01", "DAILY", "2999-12-30");
    expect(daily.date).toBe("2999-12-31");
    expect(daily.index).toBeGreaterThan(375_000);
    expect(daily.steps).toBeLessThanOrEqual(2);
    const monthly = nextOccurrenceDetailed("1970-01-31", "MONTHLY", "2999-11-30");
    expect(monthly.date).toBe("2999-12-31");
    expect(monthly.index).toBe((2999 - 1970) * 12 + 11);
    expect(monthly.steps).toBeLessThanOrEqual(2);
  });

  it("is strictly after the base, never on it", () => {
    for (const rule of ["DAILY", "WEEKLY", "MONTHLY"] as const) {
      const anchor = "2026-05-31";
      for (let k = 0; k < 6; k += 1) {
        const onSequence = sequenceDate(anchor, rule, k);
        expect(nextOccurrence(anchor, rule, onSequence)).toBe(sequenceDate(anchor, rule, k + 1));
      }
    }
  });

  it("throws when the next occurrence would pass 2999-12-31", () => {
    expect(() => nextOccurrence("2999-12-01", "MONTHLY", "2999-12-01")).toThrow(RangeError);
  });
});

describe("occurrenceBase", () => {
  const noDates = { dueDate: null, startDate: null };

  it("takes a task without dates in the series time zone from the injected clock", () => {
    const now = new Date("2026-03-31T17:30:00Z");
    expect(occurrenceBase(noDates, "Asia/Jakarta", now)).toBe("2026-04-01");
    expect(occurrenceBase(noDates, "UTC", now)).toBe("2026-03-31");
  });

  it("uses the dueDate whatever the clock, else the startDate", () => {
    const now = new Date("2026-03-31T17:30:00Z");
    expect(occurrenceBase({ dueDate: "2026-01-10", startDate: "2026-01-07" }, "UTC", now)).toBe(
      "2026-01-10",
    );
    expect(occurrenceBase({ dueDate: "2026-01-10", startDate: null }, "Asia/Jakarta", now)).toBe(
      "2026-01-10",
    );
    expect(occurrenceBase({ dueDate: null, startDate: "2026-01-07" }, "Asia/Jakarta", now)).toBe(
      "2026-01-07",
    );
  });

  it("follows the zone database across a daylight-saving change (America/New_York)", () => {
    // 2026-03-08T07:00:00Z: New York moves from UTC-5 to UTC-4.
    expect(occurrenceBase(noDates, "America/New_York", new Date("2026-03-08T04:30:00Z"))).toBe(
      "2026-03-07",
    );
    // 00:30 local under UTC-4; a fixed UTC-5 offset would give 2026-03-08.
    expect(occurrenceBase(noDates, "America/New_York", new Date("2026-03-09T04:30:00Z"))).toBe(
      "2026-03-09",
    );
  });
});

describe("successorDates", () => {
  it("keeps the start-to-due gap when both dates existed", () => {
    expect(
      successorDates({ dueDate: "2026-01-10", startDate: "2026-01-07" }, "2026-01-17"),
    ).toEqual({ startDate: "2026-01-14", dueDate: "2026-01-17" });
  });

  it("moves the one date that existed, and gives a dateless task a dueDate", () => {
    expect(successorDates({ dueDate: "2026-01-10", startDate: null }, "2026-01-17")).toEqual({
      startDate: null,
      dueDate: "2026-01-17",
    });
    expect(successorDates({ dueDate: null, startDate: "2026-01-07" }, "2026-01-14")).toEqual({
      startDate: "2026-01-14",
      dueDate: null,
    });
    expect(successorDates({ dueDate: null, startDate: null }, "2026-01-14")).toEqual({
      startDate: null,
      dueDate: "2026-01-14",
    });
  });
});

describe("initialAnchor", () => {
  const now = new Date("2026-03-31T17:30:00Z");

  it("uses anchorDate, else dueDate, else startDate, else today in the time zone", () => {
    const all = { anchorDate: "2026-02-01", dueDate: "2026-02-10", startDate: "2026-02-05" };
    expect(initialAnchor(all, "UTC", now)).toBe("2026-02-01");
    expect(initialAnchor({ ...all, anchorDate: null }, "UTC", now)).toBe("2026-02-10");
    expect(
      initialAnchor({ anchorDate: null, dueDate: null, startDate: "2026-02-05" }, "UTC", now),
    ).toBe("2026-02-05");
    expect(
      initialAnchor({ anchorDate: null, dueDate: null, startDate: null }, "Asia/Jakarta", now),
    ).toBe("2026-04-01");
    expect(initialAnchor({}, "UTC", now)).toBe("2026-03-31");
  });
});

describe("addDays", () => {
  it("adds and subtracts whole days on calendar dates", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("refusals (the services validate first and never pass these)", () => {
  const now = new Date("2026-03-31T17:30:00Z");

  it("throws on an invalid calendar date", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => sequenceDate("2026-13-01", "DAILY", 0)).toThrow(RangeError);
    expect(() => nextOccurrence("2026-01-05", "WEEKLY", "not-a-date")).toThrow(RangeError);
    expect(() => nextOccurrenceDetailed("1969-12-31", "DAILY", "2026-01-01")).toThrow(RangeError);
    expect(() => occurrenceBase({ dueDate: "2026-02-29", startDate: null }, "UTC", now)).toThrow(
      RangeError,
    );
    expect(() => successorDates({ dueDate: "2026-1-1", startDate: null }, "2026-01-17")).toThrow(
      RangeError,
    );
    expect(() => successorDates({ dueDate: null, startDate: null }, "3000-01-01")).toThrow(
      RangeError,
    );
    expect(() => initialAnchor({ anchorDate: "2026-04-31" }, "UTC", now)).toThrow(RangeError);
  });

  it("throws on an invalid rule, index, day count, time zone or clock", () => {
    const badRule = "YEARLY" as unknown as RecurrenceRule;
    expect(() => sequenceDate("2026-01-05", badRule, 1)).toThrow(RangeError);
    expect(() => nextOccurrence("2026-01-05", badRule, "2026-01-07")).toThrow(RangeError);
    expect(() => sequenceDate("2026-01-05", "DAILY", -1)).toThrow(RangeError);
    expect(() => sequenceDate("2026-01-05", "DAILY", 1.5)).toThrow(RangeError);
    expect(() => addDays("2026-01-05", 0.5)).toThrow(RangeError);
    expect(() => occurrenceBase({ dueDate: null, startDate: null }, "Mars/Base", now)).toThrow(
      RangeError,
    );
    expect(() =>
      occurrenceBase({ dueDate: null, startDate: null }, "UTC", new Date("invalid")),
    ).toThrow(RangeError);
  });
});
