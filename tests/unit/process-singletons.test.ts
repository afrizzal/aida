// K138 (Codex diff critique round 2, item 3): one pg pool, one Prisma client and one limiter
// admission state per process, in production too. A production build may instantiate a module
// once per route bundle; vi.resetModules() plays that here, and NODE_ENV=production exercises the
// production branch. Nothing connects: the pool points at a closed local port and is never used,
// and the limiter cases mock the database module.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const POOL_KEY = Symbol.for("aida.db.pool");
const PRISMA_KEY = Symbol.for("aida.db.prisma");
const ADMISSION_KEY = Symbol.for("aida.rate-limit.admission");
const g = globalThis as unknown as Record<symbol, unknown>;

function forgetSingletons(): void {
  delete g[POOL_KEY];
  delete g[PRISMA_KEY];
  delete g[ADMISSION_KEY];
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:9/unused");
  vi.stubEnv("RATE_LIMIT_PEPPER", "test-pepper-k138");
  forgetSingletons();
  vi.resetModules();
});

afterEach(async () => {
  const pool = g[POOL_KEY] as { end?: () => Promise<void> } | undefined;
  forgetSingletons();
  await pool?.end?.();
  vi.doUnmock("@/lib/db");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("process singletons (K138)", () => {
  it("db: a second module instance shares the pool and the Prisma client under NODE_ENV=production", async () => {
    const first = await import("@/lib/db");
    vi.resetModules();
    const second = await import("@/lib/db");
    expect(second).not.toBe(first);
    // Identity as booleans: a failing toBe on two Prisma clients overflows the diff printer.
    expect(second.prisma === first.prisma, "same Prisma client").toBe(true);

    const pool = g[POOL_KEY];
    expect(pool === undefined, "pool on globalThis").toBe(false);
    expect(g[PRISMA_KEY] === first.prisma, "client on globalThis").toBe(true);
    // Both copies read this very pool object.
    Object.defineProperty(pool, "waitingCount", { get: () => 7, configurable: true });
    expect(first.dbPoolWaitingCount()).toBe(7);
    expect(second.dbPoolWaitingCount()).toBe(7);
  });

  it("limiter: a second module instance shares the slot counters, the per-identity entries, the denial memory and the test limits", async () => {
    let resolveTransaction: (value: unknown) => void = () => {};
    const transaction = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveTransaction = resolve;
        }),
    );
    vi.doMock("@/lib/db", () => ({
      prisma: { $transaction: transaction },
      dbPoolWaitingCount: () => 0,
    }));
    const first = await import("@/lib/rate-limit/check-rate-limit");
    vi.resetModules();
    const second = await import("@/lib/rate-limit/check-rate-limit");
    expect(second).not.toBe(first);
    const opts = { max: 5, windowMs: 60_000 };

    // A call through the first copy takes a slot synchronously and waits in its transaction.
    const held = first.consumeRateLimit("k138", "203.0.113.1", opts);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(second.rateLimitTransactionsInFlight()).toBe(1);
    expect(second.rateLimitIdentitiesInFlight()).toBe(1);
    // The same identity through the second copy is refused at once (K136), without a transaction.
    expect(await second.consumeRateLimit("k138", "203.0.113.1", opts)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(transaction).toHaveBeenCalledTimes(1);

    // The first copy's transaction denies; the second copy remembers it.
    resolveTransaction({
      allowed: false,
      retryAfterSeconds: 30,
      deniedUntilMs: Date.now() + 30_000,
    });
    expect(await held).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(second.rateLimitTransactionsInFlight()).toBe(0);
    expect(second.rateLimitIdentitiesInFlight()).toBe(0);
    expect(second.rateLimitDenialsRemembered()).toBe(1);
    const remembered = await second.consumeRateLimit("k138", "203.0.113.1", opts);
    expect(remembered.allowed).toBe(false);
    expect(remembered.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(transaction).toHaveBeenCalledTimes(1);

    // A test limit set through one copy holds in the other.
    first.setRateLimitAdmissionLimitForTests(0);
    expect(await second.consumeRateLimit("k138", "203.0.113.2", opts)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    second.setRateLimitAdmissionLimitForTests(null);
  });
});
