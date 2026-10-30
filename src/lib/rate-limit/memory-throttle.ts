// Bounded fixed-window in-memory throttle (D-20, AIDA-30, F-12).
//
// Per process by design: AIDA runs on one server and has no Redis, and the database-backed
// limiter would add the very load this throttle exists to prevent. Memory is bounded by
// `maxKeys`: when a new key arrives at capacity, the oldest-inserted key is evicted first.
// Keys may be client addresses, so this module never logs or persists them.
//
// No imports: bundleable by both webpack and esbuild.

export type MemoryThrottle = {
  consume(key: string): { allowed: boolean; retryAfterSeconds: number };
  size(): number;
  reset(): void;
};

export function createMemoryThrottle(opts: {
  limit: number;
  windowMs: number;
  maxKeys: number;
}): MemoryThrottle {
  const windows = new Map<string, { windowStart: number; count: number }>();

  return {
    consume(key) {
      const now = Date.now();
      const entry = windows.get(key);
      if (!entry || now - entry.windowStart >= opts.windowMs) {
        // A new or expired window re-inserts the key at the end, so eviction stays oldest-first.
        if (entry) windows.delete(key);
        while (windows.size >= opts.maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
        windows.set(key, { windowStart: now, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (entry.count < opts.limit) {
        entry.count++;
        return { allowed: true, retryAfterSeconds: 0 };
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + opts.windowMs - now) / 1000)),
      };
    },
    size() {
      return windows.size;
    },
    reset() {
      windows.clear();
    },
  };
}
