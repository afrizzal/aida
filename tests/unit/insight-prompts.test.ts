import { describe, expect, it } from "vitest";
import type { NearestKbMatch } from "../../src/lib/insight/kb-gap";
import { scoreGap } from "../../src/lib/insight/kb-gap";

function fakeMatch(distance: number): NearestKbMatch {
  return {
    chunkId: "chunk-1",
    articleId: "article-1",
    title: "Fake Article",
    slug: "fake-article",
    distance,
  };
}

describe("scoreGap", () => {
  it("zero KB chunks (null nearest) => always a gap, coverage null", () => {
    expect(scoreGap(null, 0.5)).toEqual({ coverage: null, isGap: true });
  });

  it("coverage above threshold => not a gap", () => {
    // distance 0.3 => coverage 0.7 >= 0.5
    expect(scoreGap(fakeMatch(0.3), 0.5)).toEqual({ coverage: 0.7, isGap: false });
  });

  it("coverage below threshold => is a gap", () => {
    // distance 0.6 => coverage 0.4 < 0.5
    expect(scoreGap(fakeMatch(0.6), 0.5)).toEqual({ coverage: 0.4, isGap: true });
  });

  it("boundary: coverage exactly === gapThreshold is NOT a gap (strict <)", () => {
    // distance 0.5 => coverage 0.5 === gapThreshold 0.5
    const result = scoreGap(fakeMatch(0.5), 0.5);
    expect(result.coverage).toBe(0.5);
    expect(result.isGap).toBe(false);
  });
});
