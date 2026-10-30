import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryThrottle } from "@/lib/rate-limit/memory-throttle";

describe("createMemoryThrottle (D-20)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows `limit` calls per window, then denies with an integer Retry-After >= 1", () => {
    const t = createMemoryThrottle({ limit: 3, windowMs: 1000, maxKeys: 2 });
    for (let i = 0; i < 3; i++) expect(t.consume("a").allowed).toBe(true);
    const denied = t.consume("a");
    expect(denied.allowed).toBe(false);
    expect(Number.isInteger(denied.retryAfterSeconds)).toBe(true);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    vi.advanceTimersByTime(1001);
    expect(t.consume("a").allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    const t = createMemoryThrottle({ limit: 1, windowMs: 1000, maxKeys: 10 });
    expect(t.consume("a").allowed).toBe(true);
    expect(t.consume("a").allowed).toBe(false);
    expect(t.consume("b").allowed).toBe(true);
  });

  it("never holds more than maxKeys entries and evicts the oldest first", () => {
    const t = createMemoryThrottle({ limit: 1, windowMs: 1000, maxKeys: 2 });
    t.consume("a");
    t.consume("b");
    t.consume("c");
    expect(t.size()).toBe(2);
    // "a" was evicted, so it starts a fresh window; "b" is still counted.
    expect(t.consume("b").allowed).toBe(false);
    expect(t.consume("a").allowed).toBe(true);
    expect(t.size()).toBe(2);
  });

  it("reset() empties the map", () => {
    const t = createMemoryThrottle({ limit: 1, windowMs: 1000, maxKeys: 2 });
    t.consume("a");
    t.reset();
    expect(t.size()).toBe(0);
    expect(t.consume("a").allowed).toBe(true);
  });
});
