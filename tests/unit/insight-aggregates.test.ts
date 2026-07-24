import { describe, expect, it } from "vitest";
import { periodMath, zipDelta } from "../../src/lib/insight/volume-drivers";

describe("periodMath", () => {
  it("returns contiguous, non-overlapping 7-day current/previous windows", () => {
    const fixedNow = new Date("2026-07-24T00:00:00.000Z");
    const { periodStart, periodEnd, previousPeriodStart, previousPeriodEnd } = periodMath(
      7,
      fixedNow,
    );

    expect(periodEnd).toEqual(fixedNow);
    expect(periodStart).toEqual(new Date("2026-07-17T00:00:00.000Z"));
    // previous period ends exactly where the current period starts (contiguous, no gap/overlap)
    expect(previousPeriodEnd).toEqual(periodStart);
    expect(previousPeriodStart).toEqual(new Date("2026-07-10T00:00:00.000Z"));
  });
});

describe("zipDelta", () => {
  it("computes delta = count - previousCount for a matching key", () => {
    expect(zipDelta([{ key: "A", count: 5 }], [{ key: "A", count: 2 }])).toEqual([
      { key: "A", count: 5, previousCount: 2, delta: 3 },
    ]);
  });

  it("defaults previousCount to 0 and delta to count when the key is absent from the previous period", () => {
    expect(zipDelta([{ key: "B", count: 4 }], [])).toEqual([
      { key: "B", count: 4, previousCount: 0, delta: 4 },
    ]);
  });

  it("preserves current-desc order and handles multiple keys independently", () => {
    const current = [
      { key: "A", count: 10 },
      { key: "B", count: 3 },
    ];
    const previous = [
      { key: "A", count: 6 },
      { key: "C", count: 1 },
    ];
    expect(zipDelta(current, previous)).toEqual([
      { key: "A", count: 10, previousCount: 6, delta: 4 },
      { key: "B", count: 3, previousCount: 0, delta: 3 },
    ]);
  });
});
