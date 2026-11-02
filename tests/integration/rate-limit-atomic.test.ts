// The database-backed limiter is atomic (plan 08-11, D-23, AIDA-30). Real Postgres, no mocks.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as attachmentGet } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { dbPoolWaitingCount, prisma } from "@/lib/db";
import {
  checkRateLimit,
  consumeRateLimit,
  RATE_LIMIT_MAX_CONCURRENT,
  RATE_LIMIT_MAX_WINDOW_MS,
  rateLimitIdentitiesInFlight,
  rateLimitLockKey,
  rateLimitTransactionsInFlight,
  setRateLimitAdmissionLimitForTests,
  setRateLimitLockObserverForTests,
  setRateLimitPerIdentityLimitForTests,
} from "@/lib/rate-limit/check-rate-limit";
import { rateLimitKeyForIp } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS } from "@/lib/rate-limit/public-limits";
import { uniqueClientIp } from "../support/client-ip";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

beforeAll(() => {
  process.env.RATE_LIMIT_PEPPER ||= `test-pepper-${randomUUID()}`;
});

const scopeFor = (label: string) => `test-${label}-${randomUUID()}`;

describe("consumeRateLimit (D-23)", () => {
  afterEach(() => {
    setRateLimitAdmissionLimitForTests(null);
    setRateLimitPerIdentityLimitForTests(null);
  });

  // The atomicity proof needs 20 transactions of one identity to race, so it lifts the K132
  // admission limit (which would refuse 17 of them before they start) and the K136 one-slot-per-
  // identity limit (which would refuse 19); the assertion is the one it always had.
  it("allows exactly max of 20 parallel calls and stores exactly max rows", async () => {
    setRateLimitAdmissionLimitForTests(20);
    setRateLimitPerIdentityLimitForTests(20);
    const scope = scopeFor("parallel");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(scope, "203.0.113.20", { max: 5, windowMs: 60_000 }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(5);
  });

  it("with the shipped admission limit, 20 parallel calls admit at most the limit and store one row per allowed call", async () => {
    const scope = scopeFor("parallel-admission");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(scope, "203.0.113.30", { max: 5, windowMs: 60_000 }),
      ),
    );
    const allowed = results.filter((r) => r.allowed);
    expect(allowed.length).toBeGreaterThanOrEqual(1);
    expect(allowed.length).toBeLessThanOrEqual(RATE_LIMIT_MAX_CONCURRENT);
    for (const r of results.filter((r) => !r.allowed)) expect(r.retryAfterSeconds).toBe(1);
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(allowed.length);
  });

  it("denies the 6th sequential call with an integer Retry-After from 1 to the window", async () => {
    const scope = scopeFor("sequential");
    for (let i = 0; i < 5; i++) {
      const r = await consumeRateLimit(scope, "203.0.113.21", { max: 5, windowMs: 60_000 });
      expect(r).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    const denied = await consumeRateLimit(scope, "203.0.113.21", { max: 5, windowMs: 60_000 });
    expect(denied.allowed).toBe(false);
    expect(Number.isInteger(denied.retryAfterSeconds)).toBe(true);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
    console.info(`[08-11] observed retryAfterSeconds (60 s window): ${denied.retryAfterSeconds}`);
  });

  it("refuses a window past the 48-hour cleanup retention and a max below 1", async () => {
    expect(RATE_LIMIT_MAX_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    await expect(
      consumeRateLimit(scopeFor("window"), "203.0.113.22", {
        windowMs: RATE_LIMIT_MAX_WINDOW_MS + 1,
      }),
    ).rejects.toThrow(/windowMs/);
    await expect(consumeRateLimit(scopeFor("max"), "203.0.113.22", { max: 0 })).rejects.toThrow(
      /max/,
    );
  });

  it("checkRateLimit returns consumeRateLimit's allowed flag", async () => {
    const scope = scopeFor("compat");
    expect(await checkRateLimit(scope, "203.0.113.23", { max: 1, windowMs: 60_000 })).toBe(true);
    expect(await checkRateLimit(scope, "203.0.113.23", { max: 1, windowMs: 60_000 })).toBe(false);
  });
});

// K130 (b-WR-b1): the limiter bounds its wait. A limiter call that cannot get its advisory lock or
// a pool connection within a short limit answers 429 with Retry-After, never a 500 and never an
// unbounded wait. The bound below is the test's own deadline, well above the limiter's limits.
const BOUND_MS = 3000;

async function withinBound<T>(work: Promise<T>, ms = BOUND_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`limiter gave no answer within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Opens a transaction on its own backend and keeps it open until release(). */
async function holdTransaction(
  work?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>,
) {
  const started = deferred<number>();
  const release = deferred();
  const done = prisma.$transaction(
    async (tx) => {
      const pid = await backendPid(tx);
      if (work) await work(tx);
      started.resolve(pid);
      await release.promise;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  const pid = await started.promise;
  return {
    pid,
    release: async () => {
      release.resolve();
      await done;
    },
  };
}

describe("bounded wait (K130, b-WR-b1)", () => {
  afterEach(() => {
    setRateLimitLockObserverForTests(null);
  });

  it("the advisory lock held by another backend: the route answers 429 with Retry-After within the bound and records no hit; the normal path still counts", async () => {
    const ip = "203.0.113.25";
    const { scope } = PUBLIC_RATE_LIMITS.statusAttachment;
    const lockKey = rateLimitLockKey(scope, ip);
    const ipHash = lockKey.slice(scope.length + 1);
    const hits = () => prisma.rateLimitHit.count({ where: { scope, ipHash } });
    const token = `tok-${randomUUID()}`;
    const id = randomUUID();
    const call = () =>
      attachmentGet(
        new Request(`http://localhost/api/public/status/${token}/attachments/${id}`, {
          headers: { "x-forwarded-for": ip },
        }),
        { params: Promise.resolve({ token, id }) },
      );

    const before = await hits();
    const holder = await holdTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
    });
    const waiterPids: number[] = [];
    setRateLimitLockObserverForTests({
      beforeLock: async (tx) => {
        waiterPids.push(await backendPid(tx));
      },
    });
    try {
      const startedAt = Date.now();
      const pending = call();
      pending.catch(() => {});
      await vi.waitFor(() => expect(waiterPids).toHaveLength(1), { timeout: 2000, interval: 10 });
      // The limiter's own backend, bound by PID, waits on exactly this holder.
      await waitForBlockedBy(prisma, holder.pid, waiterPids, { timeoutMs: 2000 });
      const res = await withinBound(pending);
      const elapsed = Date.now() - startedAt;
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "rate_limited" });
      expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect(elapsed).toBeLessThan(BOUND_MS);
      expect(await hits()).toBe(before);
      console.info(`[08-F3] lock-wait 429 after ${elapsed} ms`);
    } finally {
      setRateLimitLockObserverForTests(null);
      await holder.release();
    }

    // Control: with the lock free, the same call takes the normal path and counts one hit.
    const ok = await call();
    expect(ok.status).toBe(404);
    expect(await hits()).toBe(before + 1);
  });

  it("no free pool connection: the limiter answers 429 with Retry-After within the bound, not a P2028 error; the normal path still counts", async () => {
    const poolSize = Number(process.env.DB_POOL_MAX) || 10;
    const scope = scopeFor("pool");
    const holders = await Promise.all(Array.from({ length: poolSize }, () => holdTransaction()));
    try {
      const startedAt = Date.now();
      const result = await withinBound(
        consumeRateLimit(scope, "203.0.113.26", { max: 5, windowMs: 60_000 }),
      );
      const elapsed = Date.now() - startedAt;
      expect(result.allowed).toBe(false);
      expect(Number.isInteger(result.retryAfterSeconds)).toBe(true);
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(elapsed).toBeLessThan(BOUND_MS);
      console.info(`[08-F3] pool-wait 429 after ${elapsed} ms`);
    } finally {
      await Promise.all(holders.map((h) => h.release()));
    }
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(0);

    // Control: with the pool free again, the normal path counts.
    expect(await consumeRateLimit(scope, "203.0.113.26", { max: 5, windowMs: 60_000 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(1);
  });
});

// K132 (Codex 1 diff critique, item 2): admission control in front of the pool. At most
// RATE_LIMIT_MAX_CONCURRENT limiter transactions run at once in this process; a call over that is
// answered "busy" (429 with Retry-After) at once and never asks the pool for a connection. A
// flood therefore cannot fill the pool or its waiter queue through the limiter, and the rest of
// the app keeps its connections.
describe("admission limit in front of the pool (K132)", () => {
  afterEach(() => {
    setRateLimitLockObserverForTests(null);
  });

  /** Fast enough that the call cannot have waited on the 500 ms lock or the 1 s pool limit. */
  const AT_ONCE_MS = 200;

  it("is a small fixed share of the 10-connection pool", () => {
    expect(RATE_LIMIT_MAX_CONCURRENT).toBe(3);
    expect(RATE_LIMIT_MAX_CONCURRENT).toBeLessThan((Number(process.env.DB_POOL_MAX) || 10) / 2);
  });

  // Since K136 one identity holds at most one slot, so the flood comes from FLOOD identities, each
  // with its advisory lock held by the same backend (before K136 this case used one identity,
  // which then took all three slots).
  it("a flood while another backend holds the advisory lock: only the limit reaches the pool, the rest get 429 with Retry-After at once, an unrelated query stays prompt, then it recovers", async () => {
    const FLOOD = 30;
    const ips = Array.from({ length: FLOOD }, () => uniqueClientIp());
    const { scope } = PUBLIC_RATE_LIMITS.statusAttachment;
    const lockKeys = ips.map((ip) => rateLimitLockKey(scope, rateLimitKeyForIp(ip)));
    const ipHashes = lockKeys.map((key) => key.slice(scope.length + 1));
    const hits = () => prisma.rateLimitHit.count({ where: { scope, ipHash: { in: ipHashes } } });
    const token = `tok-${randomUUID()}`;
    const id = randomUUID();
    const call = (ip: string) =>
      attachmentGet(
        new Request(`http://localhost/api/public/status/${token}/attachments/${id}`, {
          headers: { "x-forwarded-for": ip },
        }),
        { params: Promise.resolve({ token, id }) },
      );

    const before = await hits();
    const holder = await holdTransaction(async (tx) => {
      for (const lockKey of lockKeys) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
      }
    });
    let reachedPool = 0;
    const waiterPids: number[] = [];
    setRateLimitLockObserverForTests({
      beforeTransaction: () => {
        reachedPool += 1;
      },
      beforeLock: async (tx) => {
        waiterPids.push(await backendPid(tx));
      },
    });
    try {
      const timed = ips.map((ip) => {
        const startedAt = Date.now();
        return call(ip).then((res) => ({ res, ms: Date.now() - startedAt }));
      });
      for (const t of timed) t.catch(() => {});

      // The admitted calls really wait on this holder (bound by PID), so they hold their slots.
      await vi.waitFor(() => expect(waiterPids).toHaveLength(RATE_LIMIT_MAX_CONCURRENT), {
        timeout: 2000,
        interval: 10,
      });
      await waitForBlockedBy(prisma, holder.pid, waiterPids, { timeoutMs: 2000 });
      expect(rateLimitTransactionsInFlight()).toBe(RATE_LIMIT_MAX_CONCURRENT);
      expect(rateLimitIdentitiesInFlight()).toBe(RATE_LIMIT_MAX_CONCURRENT);

      // An unrelated query on the same pool, while the admitted calls still wait on the lock.
      const queryStartedAt = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const queryMs = Date.now() - queryStartedAt;
      expect(queryMs).toBeLessThan(300);

      const results = await withinBound(Promise.all(timed));
      expect(reachedPool).toBe(RATE_LIMIT_MAX_CONCURRENT);
      expect(new Set(waiterPids).size).toBe(RATE_LIMIT_MAX_CONCURRENT);
      for (const { res } of results) {
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      }
      const atOnce = results.filter(({ ms }) => ms < AT_ONCE_MS);
      expect(atOnce.length).toBeGreaterThanOrEqual(FLOOD - RATE_LIMIT_MAX_CONCURRENT);
      expect(await hits()).toBe(before);
      console.info(
        `[08-F6] flood of ${FLOOD}: ${reachedPool} reached the pool, ${atOnce.length} answered under ${AT_ONCE_MS} ms, unrelated query ${queryMs} ms`,
      );
    } finally {
      setRateLimitLockObserverForTests(null);
      await holder.release();
    }

    // Recovery: every slot is free again and the same call takes the normal path.
    expect(rateLimitTransactionsInFlight()).toBe(0);
    expect(rateLimitIdentitiesInFlight()).toBe(0);
    const ok = await call(ips[0]);
    expect(ok.status).toBe(404);
    expect(await hits()).toBe(before + 1);
  });

  it("does not queue behind abandoned pool waiters: with the limit's worth of waiters already queued, a call is refused at once without asking the pool", async () => {
    const poolSize = Number(process.env.DB_POOL_MAX) || 10;
    const scope = scopeFor("pool-waiters");
    let reachedPool = 0;
    setRateLimitLockObserverForTests({
      beforeTransaction: () => {
        reachedPool += 1;
      },
    });
    const holders = await Promise.all(Array.from({ length: poolSize }, () => holdTransaction()));
    try {
      // Each of these gives up after maxWait; its pool connect stays queued in pg-pool. One
      // identity each, since K136 lets one identity hold only one slot.
      const timedOut = await withinBound(
        Promise.all(
          Array.from({ length: RATE_LIMIT_MAX_CONCURRENT }, () =>
            consumeRateLimit(scope, rateLimitKeyForIp(uniqueClientIp()), {
              max: 5,
              windowMs: 60_000,
            }),
          ),
        ),
      );
      for (const r of timedOut) expect(r.allowed).toBe(false);
      expect(reachedPool).toBe(RATE_LIMIT_MAX_CONCURRENT);
      expect(rateLimitTransactionsInFlight()).toBe(0);
      expect(dbPoolWaitingCount()).toBeGreaterThanOrEqual(RATE_LIMIT_MAX_CONCURRENT);

      const startedAt = Date.now();
      const refused = await consumeRateLimit(scope, "203.0.113.28", { max: 5, windowMs: 60_000 });
      const elapsed = Date.now() - startedAt;
      expect(refused).toEqual({ allowed: false, retryAfterSeconds: 1 });
      expect(elapsed).toBeLessThan(AT_ONCE_MS);
      expect(reachedPool).toBe(RATE_LIMIT_MAX_CONCURRENT);
    } finally {
      setRateLimitLockObserverForTests(null);
      await Promise.all(holders.map((h) => h.release()));
    }

    // Recovery: the abandoned connects are served (and rolled back), then the limiter counts.
    await vi.waitFor(() => expect(dbPoolWaitingCount()).toBe(0), { timeout: 3000, interval: 20 });
    expect(await consumeRateLimit(scope, "203.0.113.28", { max: 5, windowMs: 60_000 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(1);
  });

  it("releases the slot on every error path", async () => {
    const scope = scopeFor("release");
    const ip = "203.0.113.29";
    // An error inside the transaction (not a lock or pool timeout) still propagates as before.
    setRateLimitLockObserverForTests({
      beforeLock: () => {
        throw new Error("boom inside the transaction");
      },
    });
    // One identity each (K136 lets one identity hold only one slot).
    const inside = await Promise.allSettled(
      Array.from({ length: RATE_LIMIT_MAX_CONCURRENT * 2 }, () =>
        consumeRateLimit(scope, rateLimitKeyForIp(uniqueClientIp()), { max: 5, windowMs: 60_000 }),
      ),
    );
    expect(inside.filter((r) => r.status === "rejected")).toHaveLength(RATE_LIMIT_MAX_CONCURRENT);
    expect(rateLimitTransactionsInFlight()).toBe(0);
    expect(rateLimitIdentitiesInFlight()).toBe(0);

    // An error before the transaction starts.
    setRateLimitLockObserverForTests({
      beforeTransaction: () => {
        throw new Error("boom before the transaction");
      },
    });
    for (let i = 0; i < RATE_LIMIT_MAX_CONCURRENT + 1; i++) {
      await expect(consumeRateLimit(scope, ip, { max: 5, windowMs: 60_000 })).rejects.toThrow(
        "boom before the transaction",
      );
    }
    expect(rateLimitTransactionsInFlight()).toBe(0);
    expect(rateLimitIdentitiesInFlight()).toBe(0);
    setRateLimitLockObserverForTests(null);

    // A lock timeout (55P03), handled as busy.
    const lockKey = rateLimitLockKey(scope, ip);
    const holder = await holdTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
    });
    try {
      expect(await consumeRateLimit(scope, ip, { max: 5, windowMs: 60_000 })).toEqual({
        allowed: false,
        retryAfterSeconds: 1,
      });
    } finally {
      await holder.release();
    }
    expect(rateLimitTransactionsInFlight()).toBe(0);
    expect(rateLimitIdentitiesInFlight()).toBe(0);

    // The identity that went through every error path is admitted and counted again (K136).
    expect(await consumeRateLimit(scope, ip, { max: 5, windowMs: 60_000 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    // Every slot is free: the limit's worth of parallel calls (one identity each) are all
    // admitted and counted.
    const results = await Promise.all(
      Array.from({ length: RATE_LIMIT_MAX_CONCURRENT }, () =>
        consumeRateLimit(scope, rateLimitKeyForIp(uniqueClientIp()), { max: 5, windowMs: 60_000 }),
      ),
    );
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(
      RATE_LIMIT_MAX_CONCURRENT + 1,
    );
    expect(rateLimitIdentitiesInFlight()).toBe(0);
  });
});

// K136 (Codex diff critique round 2, item 1): fairness in front of the shared slots. One identity
// (scope plus client-IP hash) holds at most one admission slot, so a flood from one identity
// cannot take the slots another identity needs. A check that denies remembers until when, and
// that identity's later calls before then are answered 429 without a transaction.
describe("fairness per identity (K136)", () => {
  afterEach(() => {
    setRateLimitLockObserverForTests(null);
  });

  /** Fast enough that the call cannot have waited on the 500 ms lock or the 1 s pool limit. */
  const AT_ONCE_MS = 200;

  it("one identity flooding while another backend holds its advisory lock holds one slot; a second identity is still admitted and counted", async () => {
    const { scope } = PUBLIC_RATE_LIMITS.statusAttachment;
    const ipA = uniqueClientIp();
    const ipB = uniqueClientIp();
    const lockKeyOf = (ip: string) => rateLimitLockKey(scope, rateLimitKeyForIp(ip));
    const hits = (ip: string) =>
      prisma.rateLimitHit.count({
        where: { scope, ipHash: lockKeyOf(ip).slice(scope.length + 1) },
      });
    const token = `tok-${randomUUID()}`;
    const id = randomUUID();
    const call = (ip: string) =>
      attachmentGet(
        new Request(`http://localhost/api/public/status/${token}/attachments/${id}`, {
          headers: { "x-forwarded-for": ip },
        }),
        { params: Promise.resolve({ token, id }) },
      );
    const FLOOD = 30;
    const lockKeyA = lockKeyOf(ipA);

    const holder = await holdTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeyA}::text))`;
    });
    let reachedPool = 0;
    const waiterPids: number[] = [];
    setRateLimitLockObserverForTests({
      beforeTransaction: () => {
        reachedPool += 1;
      },
      beforeLock: async (tx) => {
        waiterPids.push(await backendPid(tx));
      },
    });
    try {
      const timed = Array.from({ length: FLOOD }, () => {
        const startedAt = Date.now();
        return call(ipA).then((res) => ({ res, ms: Date.now() - startedAt }));
      });
      for (const t of timed) t.catch(() => {});

      // A's one admitted call really waits on the holder (bound by PID), so it holds its slot.
      await vi.waitFor(() => expect(waiterPids).toHaveLength(1), { timeout: 2000, interval: 10 });
      await waitForBlockedBy(prisma, holder.pid, waiterPids, { timeoutMs: 2000 });
      expect(reachedPool).toBe(1);
      expect(rateLimitTransactionsInFlight()).toBe(1);
      expect(rateLimitIdentitiesInFlight()).toBe(1);

      // B, while A's call still waits on the lock: admitted at once and counted.
      const startedAt = Date.now();
      const b = await withinBound(call(ipB));
      const bMs = Date.now() - startedAt;
      expect(b.status).toBe(404);
      expect(bMs).toBeLessThan(AT_ONCE_MS);
      expect(await hits(ipB)).toBe(1);
      expect(reachedPool).toBe(2);

      const results = await withinBound(Promise.all(timed));
      for (const { res } of results) {
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      }
      const atOnce = results.filter(({ ms }) => ms < AT_ONCE_MS);
      expect(atOnce.length).toBeGreaterThanOrEqual(FLOOD - 1);
      expect(reachedPool).toBe(2);
      expect(await hits(ipA)).toBe(0);
      console.info(
        `[08-F7] one-identity flood of ${FLOOD}: ${atOnce.length} answered under ${AT_ONCE_MS} ms; second identity admitted in ${bMs} ms`,
      );
    } finally {
      setRateLimitLockObserverForTests(null);
      await holder.release();
    }

    // Recovery: every slot and identity entry is free again, and A counts on the normal path.
    expect(rateLimitTransactionsInFlight()).toBe(0);
    expect(rateLimitIdentitiesInFlight()).toBe(0);
    expect((await call(ipA)).status).toBe(404);
    expect(await hits(ipA)).toBe(1);
  });

  it("a denied identity's next calls inside Retry-After make no transaction; another identity still reaches the database; after Retry-After the database decides again", async () => {
    const scope = scopeFor("denied-until");
    const key = rateLimitKeyForIp(uniqueClientIp());
    const otherKey = rateLimitKeyForIp(uniqueClientIp());
    const opts = { max: 1, windowMs: 2000 };
    const rows = (k: string) =>
      prisma.rateLimitHit.count({
        where: { scope, ipHash: rateLimitLockKey(scope, k).slice(scope.length + 1) },
      });
    let transactions = 0;
    setRateLimitLockObserverForTests({
      beforeTransaction: () => {
        transactions += 1;
      },
    });

    expect(await consumeRateLimit(scope, key, opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const denied = await consumeRateLimit(scope, key, opts);
    expect(denied.allowed).toBe(false);
    expect(transactions).toBe(2);

    // Inside Retry-After: sequential and concurrent calls are all denied without a transaction.
    for (let i = 0; i < 10; i++) {
      const r = await consumeRateLimit(scope, key, opts);
      expect(r.allowed).toBe(false);
      expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(r.retryAfterSeconds).toBeLessThanOrEqual(2);
    }
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(scope, key, opts)),
    );
    expect(concurrent.every((r) => !r.allowed && r.retryAfterSeconds >= 1)).toBe(true);
    expect(transactions).toBe(2);
    expect(await rows(key)).toBe(1);

    // The memory is per identity: another identity in the same scope is decided by the database.
    expect(await consumeRateLimit(scope, otherKey, opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(transactions).toBe(3);

    // After Retry-After the database decides again: a call reaches a transaction and is allowed.
    await vi.waitFor(
      async () => {
        expect((await consumeRateLimit(scope, key, opts)).allowed).toBe(true);
      },
      { timeout: 8000, interval: 100 },
    );
    expect(transactions).toBeGreaterThan(3);
    expect(await rows(key)).toBe(2);
  });
});
