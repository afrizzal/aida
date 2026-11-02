// The limiter's "denied until" memory is bounded and swept (K136). Pure: no database, no timers;
// every case passes `now` explicitly.
import { describe, expect, it } from "vitest";
import { createDenialMemory } from "@/lib/rate-limit/denial-memory";

const MAX = 5;
const WINDOW = 60_000;

describe("createDenialMemory (K136)", () => {
  it("answers the stored time before it and nothing from it on, and drops the expired entry", () => {
    const memory = createDenialMemory({ maxKeys: 10, sweepIntervalMs: 1000 });
    memory.record("s:a", MAX, WINDOW, 5000, 1000);
    expect(memory.deniedUntil("s:a", MAX, WINDOW, 1000)).toBe(5000);
    expect(memory.deniedUntil("s:a", MAX, WINDOW, 4999)).toBe(5000);
    expect(memory.deniedUntil("s:a", MAX, WINDOW, 5000)).toBeNull();
    expect(memory.size()).toBe(0);
  });

  it("is per key, and a call with other limits for the same key is not answered from memory", () => {
    const memory = createDenialMemory({ maxKeys: 10, sweepIntervalMs: 1000 });
    memory.record("s:a", MAX, WINDOW, 5000, 1000);
    expect(memory.deniedUntil("s:b", MAX, WINDOW, 1000)).toBeNull();
    expect(memory.deniedUntil("t:a", MAX, WINDOW, 1000)).toBeNull();
    expect(memory.deniedUntil("s:a", MAX + 1, WINDOW, 1000)).toBeNull();
    expect(memory.deniedUntil("s:a", MAX, WINDOW + 1, 1000)).toBeNull();
    expect(memory.deniedUntil("s:a", MAX, WINDOW, 1000)).toBe(5000);
  });

  it("never stores a denial that has already ended", () => {
    const memory = createDenialMemory({ maxKeys: 10, sweepIntervalMs: 1000 });
    memory.record("s:a", MAX, WINDOW, 1000, 1000);
    memory.record("s:b", MAX, WINDOW, 999, 1000);
    expect(memory.size()).toBe(0);
  });

  it("holds at most maxKeys entries and evicts the oldest-inserted first", () => {
    const memory = createDenialMemory({ maxKeys: 3, sweepIntervalMs: 1000 });
    for (let i = 0; i < 1000; i++) memory.record(`s:${i}`, MAX, WINDOW, 1_000_000, 1);
    expect(memory.size()).toBe(3);
    expect(memory.deniedUntil("s:996", MAX, WINDOW, 1)).toBeNull();
    for (const i of [997, 998, 999]) {
      expect(memory.deniedUntil(`s:${i}`, MAX, WINDOW, 1), `s:${i}`).toBe(1_000_000);
    }
  });

  it("a re-recorded key moves to the end of the eviction order", () => {
    const memory = createDenialMemory({ maxKeys: 2, sweepIntervalMs: 1000 });
    memory.record("s:a", MAX, WINDOW, 9000, 1);
    memory.record("s:b", MAX, WINDOW, 9000, 1);
    memory.record("s:a", MAX, WINDOW, 9500, 2);
    memory.record("s:c", MAX, WINDOW, 9000, 3);
    expect(memory.deniedUntil("s:b", MAX, WINDOW, 3)).toBeNull();
    expect(memory.deniedUntil("s:a", MAX, WINDOW, 3)).toBe(9500);
    expect(memory.deniedUntil("s:c", MAX, WINDOW, 3)).toBe(9000);
  });

  it("the sweep drops every expired entry, so live ones are not evicted for them", () => {
    const memory = createDenialMemory({ maxKeys: 3, sweepIntervalMs: 1000 });
    memory.record("s:live", MAX, WINDOW, 100_000, 0);
    memory.record("s:old1", MAX, WINDOW, 2000, 0);
    memory.record("s:old2", MAX, WINDOW, 2000, 0);
    // At capacity, after both short denials ended and the sweep interval passed.
    memory.record("s:new", MAX, WINDOW, 100_000, 5000);
    expect(memory.size()).toBe(2);
    expect(memory.deniedUntil("s:live", MAX, WINDOW, 5000)).toBe(100_000);
    expect(memory.deniedUntil("s:new", MAX, WINDOW, 5000)).toBe(100_000);
  });

  it("sweeps at most once per interval", () => {
    const memory = createDenialMemory({ maxKeys: 10, sweepIntervalMs: 1000 });
    memory.record("s:a", MAX, WINDOW, 1500, 1000); // sweeps (first record), then stores
    memory.record("s:b", MAX, WINDOW, 1500, 1100); // inside the interval: no sweep
    memory.record("s:c", MAX, WINDOW, 9000, 1600); // inside the interval: s:a and s:b stay
    expect(memory.size()).toBe(3);
    memory.record("s:d", MAX, WINDOW, 9000, 2000); // interval passed: both expired are dropped
    expect(memory.size()).toBe(2);
  });

  it("reset forgets everything", () => {
    const memory = createDenialMemory({ maxKeys: 10, sweepIntervalMs: 1000 });
    memory.record("s:a", MAX, WINDOW, 5000, 1000);
    memory.reset();
    expect(memory.deniedUntil("s:a", MAX, WINDOW, 1000)).toBeNull();
    expect(memory.size()).toBe(0);
  });
});
