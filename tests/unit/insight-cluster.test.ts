import { describe, expect, it } from "vitest";
import { l2Normalize, leaderCluster } from "../../src/lib/insight/cluster";
import type { ClusterItem } from "../../src/lib/insight/cluster";

describe("l2Normalize", () => {
  it("normalizes a non-zero vector to unit length", () => {
    expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
  });

  it("returns the zero vector unchanged (zero-vector guard, no divide-by-zero)", () => {
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });
});

describe("leaderCluster", () => {
  it("returns [] for an empty input", () => {
    expect(leaderCluster([], 0.8)).toEqual([]);
  });

  it("collapses three near-identical unit vectors into ONE cluster at threshold 0.99, members in input order", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    const items: ClusterItem[] = [
      { id: "t1", embedding: [Math.cos(deg(0)), Math.sin(deg(0))] },
      { id: "t2", embedding: [Math.cos(deg(1)), Math.sin(deg(1))] },
      { id: "t3", embedding: [Math.cos(deg(2)), Math.sin(deg(2))] },
    ];

    const result = leaderCluster(items, 0.99);

    expect(result).toHaveLength(1);
    expect(result[0].memberIds).toEqual(["t1", "t2", "t3"]);
  });

  it("splits two orthogonal-ish vector families into TWO clusters at threshold 0.8", () => {
    const s = Math.sqrt(1 - 0.85 * 0.85);
    const items: ClusterItem[] = [
      { id: "a1", embedding: [1, 0, 0] },
      { id: "a2", embedding: [0.85, s, 0] },
      { id: "b1", embedding: [0, 1, 0] },
      { id: "b2", embedding: [0, 0.85, s] },
    ];

    const result = leaderCluster(items, 0.8);

    expect(result).toHaveLength(2);
    expect(result[0].memberIds).toEqual(["a1", "a2"]);
    expect(result[1].memberIds).toEqual(["b1", "b2"]);
  });

  it("is deterministic: two calls on the same input yield byte-identical memberIds arrays", () => {
    const items: ClusterItem[] = [
      { id: "x1", embedding: [1, 0, 0] },
      { id: "x2", embedding: [0, 1, 0] },
      { id: "x3", embedding: [0.9, Math.sqrt(1 - 0.81), 0] },
      { id: "x4", embedding: [0, 0, 1] },
    ];

    const first = leaderCluster(items, 0.8);
    const second = leaderCluster(items, 0.8);

    expect(second).toEqual(first);
  });

  it("first match wins: an item joins the FIRST clearing cluster even if a later cluster would score higher", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    const items: ClusterItem[] = [
      { id: "c1", embedding: [1, 0] }, // seeds cluster 0
      { id: "c2", embedding: [0, 1] }, // seeds cluster 1
      // 50 degrees from the x-axis: dot with cluster0 (cos 50 ~= 0.643) clears 0.5 first;
      // dot with cluster1 (sin 50 ~= 0.766) is HIGHER but must NOT be chosen (best-match).
      { id: "c3", embedding: [Math.cos(deg(50)), Math.sin(deg(50))] },
    ];

    const result = leaderCluster(items, 0.5);

    expect(result).toHaveLength(2);
    expect(result[0].memberIds).toEqual(["c1", "c3"]);
    expect(result[1].memberIds).toEqual(["c2"]);
  });
});
