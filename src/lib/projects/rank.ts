// Phase 14, contract section 8 (D-10): rank math for tasks (per status group or per parent) and
// for the organization-wide project order. Pure, relative imports only. A rank is an integer from
// 0 to RANK_MAX; order is (rank, id). Every function returns null when the caller must rebalance
// the group first (no integer strictly between, or an append past RANK_MAX); the caller then
// renumbers the group with rebalancedRanks in (rank, id) order under the lock section 8 names and
// computes again. Callers that may not rebalance (an append without the project's FOR UPDATE lock)
// use min(largest + 1, RANK_MAX) instead, as section 8 says.
import { RANK_GAP, RANK_MAX } from "./contract";

/** The rank after the group's largest rank (null for an empty group), or null past RANK_MAX. */
export function appendRank(maxRank: number | null): number | null {
  if (maxRank === null) return RANK_GAP;
  const next = maxRank + RANK_GAP;
  return next > RANK_MAX ? null : next;
}

/**
 * The rank between two neighbours: before null means "first in the group" (the floor is 0),
 * after null means "last in the group" (an append). Null when no integer lies strictly between.
 */
export function rankBetween(before: number | null, after: number | null): number | null {
  if (after === null) return appendRank(before);
  if (before === null) {
    const candidate = Math.floor(after / 2);
    return candidate >= 0 && candidate < after ? candidate : null;
  }
  const candidate = Math.floor((before + after) / 2);
  return candidate > before && candidate < after ? candidate : null;
}

/** The ranks of a rebalanced group of `count` items, in (rank, id) order: (i + 1) * RANK_GAP. */
export function rebalancedRanks(count: number): number[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Invalid rebalance count");
  return Array.from({ length: count }, (_, i) => (i + 1) * RANK_GAP);
}
