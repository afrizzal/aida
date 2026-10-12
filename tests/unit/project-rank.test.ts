// Phase 14, plan 14-03 (contract section 8, D-10): the rank math for tasks and project order.
// null means "rebalance the group first".
import { describe, expect, it } from "vitest";
import { RANK_GAP, RANK_MAX } from "../../src/lib/projects/contract";
import { appendRank, rankBetween, rebalancedRanks } from "../../src/lib/projects/rank";

describe("appendRank", () => {
  it("starts an empty group at RANK_GAP and appends RANK_GAP after the largest", () => {
    expect(appendRank(null)).toBe(1024);
    expect(appendRank(1024)).toBe(2048);
    expect(appendRank(0)).toBe(RANK_GAP);
  });

  it("is null when the append would pass RANK_MAX", () => {
    expect(appendRank(RANK_MAX - 100)).toBeNull();
    expect(appendRank(RANK_MAX)).toBeNull();
    expect(appendRank(RANK_MAX - RANK_GAP)).toBe(RANK_MAX);
  });
});

describe("rankBetween", () => {
  it("takes the floor of the midpoint when an integer lies strictly between", () => {
    expect(rankBetween(1024, 2048)).toBe(1536);
    expect(rankBetween(1024, 1027)).toBe(1025);
  });

  it("is null when no integer lies strictly between", () => {
    expect(rankBetween(1024, 1025)).toBeNull();
    expect(rankBetween(5, 5)).toBeNull();
    expect(rankBetween(6, 5)).toBeNull();
  });

  it("places before the first item between 0 and its rank", () => {
    expect(rankBetween(null, 1024)).toBe(512);
    expect(rankBetween(null, 1)).toBe(0);
    expect(rankBetween(null, 0)).toBeNull();
  });

  it("places after the last item exactly like an append", () => {
    expect(rankBetween(2048, null)).toBe(appendRank(2048));
    expect(rankBetween(RANK_MAX - 100, null)).toBeNull();
    expect(rankBetween(null, null)).toBe(appendRank(null));
  });
});

describe("rebalancedRanks", () => {
  it("gives (i + 1) times RANK_GAP", () => {
    expect(rebalancedRanks(3)).toEqual([1024, 2048, 3072]);
    expect(rebalancedRanks(0)).toEqual([]);
  });

  it("refuses a negative or fractional count", () => {
    expect(() => rebalancedRanks(-1)).toThrow(RangeError);
    expect(() => rebalancedRanks(1.5)).toThrow(RangeError);
  });
});
