// The database-backed limiter is atomic (plan 08-11, D-23, AIDA-30). Real Postgres, no mocks.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as attachmentGet } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  consumeRateLimit,
  RATE_LIMIT_MAX_WINDOW_MS,
  rateLimitLockKey,
  setRateLimitLockObserverForTests,
} from "@/lib/rate-limit/check-rate-limit";
import { PUBLIC_RATE_LIMITS } from "@/lib/rate-limit/public-limits";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

beforeAll(() => {
  process.env.RATE_LIMIT_PEPPER ||= `test-pepper-${randomUUID()}`;
});

const scopeFor = (label: string) => `test-${label}-${randomUUID()}`;

describe("consumeRateLimit (D-23)", () => {
  it("allows exactly max of 20 parallel calls and stores exactly max rows", async () => {
    const scope = scopeFor("parallel");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(scope, "203.0.113.20", { max: 5, windowMs: 60_000 }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(5);
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
