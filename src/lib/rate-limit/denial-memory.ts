// Bounded in-memory "denied until" times for the database-backed limiter (K136).
//
// When the limiter's transaction denies an identity, the database would keep denying it until
// its oldest hit leaves the window, so the limiter remembers that time and answers later calls
// before it with 429 and no transaction. Memory is bounded by `maxKeys`, like the health throttle
// (memory-throttle.ts): an expired entry is dropped when it is read, a sweep drops every expired
// entry at most once per `sweepIntervalMs`, and a new key at capacity evicts the oldest-inserted
// key. Forgetting a denial early is safe: that identity's next call simply asks the database
// again. Keys are a scope plus a peppered address hash; this module never logs or persists them.
//
// No imports: bundleable by both webpack and esbuild.

export type DenialMemory = {
  /** The time the denial ends, or null when there is none for this key, max and window. */
  deniedUntil(key: string, max: number, windowMs: number, now: number): number | null;
  /** Remembers a denial that ends at `until`; one in the past is not stored. */
  record(key: string, max: number, windowMs: number, until: number, now: number): void;
  size(): number;
  reset(): void;
};

type Entry = { until: number; max: number; windowMs: number };

export function createDenialMemory(opts: {
  maxKeys: number;
  sweepIntervalMs: number;
}): DenialMemory {
  const entries = new Map<string, Entry>();
  let lastSweep = Number.NEGATIVE_INFINITY;

  function sweep(now: number): void {
    lastSweep = now;
    for (const [key, entry] of entries) {
      if (entry.until <= now) entries.delete(key);
    }
  }

  return {
    deniedUntil(key, max, windowMs, now) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.until <= now) {
        entries.delete(key);
        return null;
      }
      // A call with other limits for the same key is decided by the database.
      if (entry.max !== max || entry.windowMs !== windowMs) return null;
      return entry.until;
    },
    record(key, max, windowMs, until, now) {
      // Re-inserted at the end, so eviction stays oldest-first.
      entries.delete(key);
      if (until <= now) return;
      if (now - lastSweep >= opts.sweepIntervalMs) sweep(now);
      while (entries.size >= opts.maxKeys) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      entries.set(key, { until, max, windowMs });
    },
    size() {
      return entries.size;
    },
    reset() {
      entries.clear();
      lastSweep = Number.NEGATIVE_INFINITY;
    },
  };
}
