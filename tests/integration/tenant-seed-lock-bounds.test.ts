// Phase 9, Codex diff critique round 1, finding 7 (second half): the boot bound of review a-WR-2
// (K146) measured on a real Postgres. tests/unit/boot-tenant-seed-lock.test.ts proves that the
// boot passes { lockTimeoutMs, maxWaitMs } to withTenantSeedLock, with the lock replaced; this
// file proves that withTenantSeedLock really gives up after those waits:
// - a real held lock: a separate pg client holds the tenant seed lock in an open transaction, and
//   withTenantSeedLock with a short lockTimeoutMs throws TenantSeedLockTimeout after about that
//   long, without running its callback;
// - a real pool wait: the app pool (DB_POOL_MAX=2 for this file) is exhausted by two open
//   transactions, and withTenantSeedLock with a short maxWaitMs rejects after about that long,
//   without running its callback.
// The callbacks write nothing, so no seed can run here even when a bound is broken.
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

const SHORT_MS = 400;
/** Generous slack for a loaded CI host; the defaults (120 s and 30 s) are far above it. */
const UPPER_MS = SHORT_MS + 4_000;

process.env.DB_POOL_MAX = "2";

const { prisma } = await import("@/lib/db");
const { TENANT_SEED_LOCK_KEY_SQL, TenantSeedLockTimeout, withTenantSeedLock } = await import(
  "@/lib/tenant-seed-lock"
);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function timed(work: Promise<unknown>): Promise<{ ms: number; error: unknown }> {
  const started = performance.now();
  try {
    await work;
    return { ms: performance.now() - started, error: null };
  } catch (error) {
    return { ms: performance.now() - started, error };
  }
}

describe("withTenantSeedLock gives up after its short waits (Codex finding 7, K146)", () => {
  it("a lock held by another session: TenantSeedLockTimeout after about lockTimeoutMs, the callback never runs", async () => {
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query(`SELECT pg_advisory_xact_lock(${TENANT_SEED_LOCK_KEY_SQL})`);
    cleanups.push(async () => {
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end().catch(() => {});
    });

    let ran = false;
    const { ms, error } = await timed(
      withTenantSeedLock(
        async () => {
          ran = true;
        },
        { lockTimeoutMs: SHORT_MS, maxWaitMs: SHORT_MS },
      ),
    );
    expect(error).toBeInstanceOf(TenantSeedLockTimeout);
    expect(ran).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(SHORT_MS - 50);
    expect(ms).toBeLessThan(UPPER_MS);
  }, 20_000);

  it("an exhausted pool: a rejection after about maxWaitMs, the callback never runs", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened = 0;
    const holders = [0, 1].map(() =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          opened += 1;
          await gate;
        },
        { maxWait: 10_000, timeout: 60_000 },
      ),
    );
    cleanups.push(async () => {
      release();
      await Promise.allSettled(holders);
    });
    const deadline = Date.now() + 10_000;
    while (opened < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(opened).toBe(2);

    let ran = false;
    const { ms, error } = await timed(
      withTenantSeedLock(
        async () => {
          ran = true;
        },
        { lockTimeoutMs: SHORT_MS, maxWaitMs: SHORT_MS },
      ),
    );
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(TenantSeedLockTimeout);
    expect(ran).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(SHORT_MS - 50);
    expect(ms).toBeLessThan(UPPER_MS);
  }, 20_000);
});
