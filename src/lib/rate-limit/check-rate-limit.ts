import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { dbPoolWaitingCount, prisma } from "@/lib/db";
import { createDenialMemory, type DenialMemory } from "@/lib/rate-limit/denial-memory";

/**
 * Reads the pepper lazily, on every hash — not once at module load — so importing this module
 * (e.g. transitively, in a build or in tests that never call checkRateLimit) never fails just
 * because RATE_LIMIT_PEPPER happens to be unset; only actually hashing an IP requires it. This
 * mirrors src/lib/crypto/secret-box.ts's getKey(), which throws only when APP_ENCRYPTION_KEY is
 * needed, never at import time.
 *
 * `||`, not `??`, is required: docker-compose.yml injects
 * `RATE_LIMIT_PEPPER: ${RATE_LIMIT_PEPPER:-}`, so an operator who never sets it gets the
 * variable defined as `""` — `??` only falls back on null/undefined and would silently leave
 * `""` in place, making `ipHash` an unsalted sha256(ip) reversible over the IPv4 space in
 * minutes (07-09 GAP 3). Throwing here — rather than silently falling back to a public
 * placeholder pepper — is the only way to keep the "raw IPs are never persisted" claim
 * (docs/SECURITY.md) actually true in the shipped Compose path.
 */
function getPepper(): string {
  const pepper = process.env.RATE_LIMIT_PEPPER || "";
  if (!pepper) {
    throw new Error(
      "RATE_LIMIT_PEPPER is required to hash rate-limit identifiers (generate with: openssl rand -base64 32)",
    );
  }
  return pepper;
}

function hashIp(ip: string) {
  return createHash("sha256")
    .update(ip + getPepper())
    .digest("hex");
}

/**
 * Longest window a caller may ask for. src/lib/worker/jobs/rate-limit-cleanup.ts deletes
 * RateLimitHit rows older than 48 hours. A longer window would silently undercount, and keeping
 * rows longer to serve it would let the table grow without bound (D-23).
 */
export const RATE_LIMIT_MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The advisory-lock key of one scope and identity: the lock consumeRateLimit takes. */
export function rateLimitLockKey(scope: string, ip: string): string {
  return `${scope}:${hashIp(ip)}`;
}

/** Test-only hook into the limiter transaction (lock-wait and admission proofs). */
export interface RateLimitLockObserver {
  /** Called once per admitted call, right before it asks the pool for a transaction. */
  beforeTransaction?(): void;
  /** Awaited inside the transaction right before the advisory lock is requested. */
  beforeLock?(tx: Prisma.TransactionClient): Promise<void> | void;
}

let lockObserver: RateLimitLockObserver | null = null;

/**
 * Test seam only (as setCsatWriteObserverForTests): lets a lock-wait test record the backend PID
 * of a limiter transaction. Production never sets it.
 */
export function setRateLimitLockObserverForTests(observer: RateLimitLockObserver | null): void {
  lockObserver = observer;
}

/**
 * Bounded waits (K130, review b-WR-b1). Without them, concurrent requests of one identity queue
 * on the advisory lock while each holds a pool connection, so one address can pin the whole pool
 * and the requests behind it fail later with Prisma P2028, which the routes turn into a 500.
 * - RATE_LIMIT_LOCK_TIMEOUT_MS: `lock_timeout` for the limiter transaction. A same-identity
 *   transaction holds the lock only for a count, a lookup and an insert (a few milliseconds), so
 *   this is generous for a real burst and short for a flood.
 * - RATE_LIMIT_POOL_WAIT_MS: Prisma's `maxWait`, the longest the limiter waits for a pool
 *   connection to start its transaction.
 * Either limit answers "not allowed" with RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS, which the routes
 * send as 429 with Retry-After, and records no hit.
 */
export const RATE_LIMIT_LOCK_TIMEOUT_MS = 500;
export const RATE_LIMIT_POOL_WAIT_MS = 1000;
export const RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS = 1;

/**
 * Admission control in front of the pool (K132, Codex diff critique 1 item 2). The app's pool has
 * 10 connections (DB_POOL_MAX). At most RATE_LIMIT_MAX_CONCURRENT limiter transactions run at
 * once in this process, and none starts while that many connect requests are already queued in
 * the pool (dbPoolWaitingCount: a call that passed maxWait leaves its connect queued until a
 * connection frees). A call over either limit is answered "not allowed" with
 * RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS at once (429 with Retry-After at the routes) and never asks
 * the pool for a connection. So a flood of public requests can hold at most 3 connections and add
 * fewer than 6 queued connects through the limiter, and the other 7 connections stay with the
 * rest of the app.
 *
 * Why 3: a limiter transaction holds its connection for a count, a lookup and an insert (a few
 * milliseconds), so 3 slots serve hundreds of limiter checks per second, far above what the public
 * form, status page, CSAT and attachment routes see on one server. Only a held advisory lock (one
 * identity flooding, bounded by RATE_LIMIT_LOCK_TIMEOUT_MS) or a saturated pool keeps a slot busy
 * long, and that is exactly when the limiter should answer 429 instead of queueing.
 *
 * The count is per app process. AIDA runs one app process (one server, one `app` container;
 * docs/OPERATIONS.md), which this limit relies on: N processes would admit N times as many.
 */
export const RATE_LIMIT_MAX_CONCURRENT = 3;

/**
 * Fairness in front of the shared slots (K136, Codex diff critique 2 item 1). One identity (scope
 * plus client-IP hash, the advisory-lock key) holds at most RATE_LIMIT_MAX_PER_IDENTITY slots, so
 * a flood from one identity cannot take the slots every other identity needs: its second
 * concurrent call is answered busy at once, without a transaction. One identity's calls queue on
 * its advisory lock anyway, so a second slot would only add a second waiter, never throughput.
 * The per-identity entries exist only while a call holds a slot, so there are never more of them
 * than RATE_LIMIT_MAX_CONCURRENT, and each is removed on every path out (`finally`).
 */
export const RATE_LIMIT_MAX_PER_IDENTITY = 1;

/**
 * Denial memory (K136). A check that denies remembers the time the identity's oldest hit leaves
 * the window; until then the database would deny again, so later calls with the same limits are
 * answered 429 from memory, with the same Retry-After, without a transaction. At most
 * RATE_LIMIT_DENIED_MAX_KEYS identities are remembered; expired entries are swept at most once
 * per RATE_LIMIT_DENIED_SWEEP_MS, and at capacity the oldest-inserted entry is evicted first
 * (denial-memory.ts). Forgetting a denial early only sends that identity back to the database.
 * The memory lives in the process, so rows deleted from RateLimitHit by hand (the E2E fixture)
 * do not lift a denial it already remembers; a restart does.
 */
export const RATE_LIMIT_DENIED_MAX_KEYS = 10_000;
export const RATE_LIMIT_DENIED_SWEEP_MS = 1000;

type AdmissionState = {
  admissionLimit: number;
  perIdentityLimit: number;
  inFlight: number;
  identitiesInFlight: Map<string, number>;
  denials: DenialMemory;
};

// One admission state per process (K138, Codex diff critique 2 item 3). A production build may
// instantiate this module once per route bundle; keeping the slot counter, the per-identity
// entries, the denial memory and the test limits on globalThis under a registered symbol (as the
// health state does) makes the limits above hold for the whole process, not per bundle.
const ADMISSION_KEY = Symbol.for("aida.rate-limit.admission");

function admission(): AdmissionState {
  const g = globalThis as typeof globalThis & { [ADMISSION_KEY]?: AdmissionState };
  let state = g[ADMISSION_KEY];
  if (!state) {
    state = {
      admissionLimit: RATE_LIMIT_MAX_CONCURRENT,
      perIdentityLimit: RATE_LIMIT_MAX_PER_IDENTITY,
      inFlight: 0,
      identitiesInFlight: new Map(),
      denials: createDenialMemory({
        maxKeys: RATE_LIMIT_DENIED_MAX_KEYS,
        sweepIntervalMs: RATE_LIMIT_DENIED_SWEEP_MS,
      }),
    };
    g[ADMISSION_KEY] = state;
  }
  return state;
}

/**
 * Test seam only: the atomicity proof runs 20 limiter transactions at once, which the admission
 * limit would otherwise refuse before they could race. `null` restores the shipped limit.
 */
export function setRateLimitAdmissionLimitForTests(limit: number | null): void {
  admission().admissionLimit = limit ?? RATE_LIMIT_MAX_CONCURRENT;
}

/**
 * Test seam only: the atomicity proof races 20 transactions of one identity, which the
 * per-identity limit would otherwise refuse. `null` restores the shipped limit.
 */
export function setRateLimitPerIdentityLimitForTests(limit: number | null): void {
  admission().perIdentityLimit = limit ?? RATE_LIMIT_MAX_PER_IDENTITY;
}

/** Limiter transactions running in this process now. */
export function rateLimitTransactionsInFlight(): number {
  return admission().inFlight;
}

/** Identities holding a limiter slot in this process now. */
export function rateLimitIdentitiesInFlight(): number {
  return admission().identitiesInFlight.size;
}

/** Identities whose denial this process remembers now. */
export function rateLimitDenialsRemembered(): number {
  return admission().denials.size();
}

/**
 * Takes a slot when this identity holds none, one is free and the pool is not already queued;
 * never waits. Synchronous, so no other call can interleave between the checks and the take.
 */
function tryAdmit(state: AdmissionState, lockKey: string): boolean {
  const held = state.identitiesInFlight.get(lockKey) ?? 0;
  if (held >= state.perIdentityLimit) return false;
  if (state.inFlight >= state.admissionLimit) return false;
  if (dbPoolWaitingCount() >= state.admissionLimit) return false;
  state.inFlight += 1;
  state.identitiesInFlight.set(lockKey, held + 1);
  return true;
}

function release(state: AdmissionState, lockKey: string): void {
  state.inFlight -= 1;
  const held = (state.identitiesInFlight.get(lockKey) ?? 1) - 1;
  if (held > 0) state.identitiesInFlight.set(lockKey, held);
  else state.identitiesInFlight.delete(lockKey);
}

function retryAfterFor(untilMs: number, now: number, windowMs: number): number {
  return Math.min(Math.ceil(windowMs / 1000), Math.max(1, Math.ceil((untilMs - now) / 1000)));
}

// Postgres SQLSTATE 55P03 (lock_not_available): the lock wait passed `lock_timeout`. Prisma wraps a
// raw-query failure as P2010 and keeps the driver adapter's error, with the SQLSTATE as
// `originalCode`, in `meta.driverAdapterError.cause`.
function isLockTimeout(err: unknown): boolean {
  const meta = (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } })
    ?.meta;
  return meta?.driverAdapterError?.cause?.originalCode === "55P03";
}

// Prisma's error when no connection could start the transaction within `maxWait`.
function isTransactionStartTimeout(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  return (
    e?.code === "P2028" &&
    typeof e.message === "string" &&
    e.message.includes("Unable to start a transaction in the given time")
  );
}

/**
 * Counts and records one hit atomically (D-23). Under READ COMMITTED a separate count and insert
 * race: parallel requests all see the same count and all insert, passing the quota. A
 * transaction-scoped advisory lock on scope plus IP hash serializes the count and the insert for
 * one identity only; Postgres releases it at commit or rollback, so nothing can leak a lock.
 * `pg_advisory_xact_lock` returns `void`, which Prisma's `$queryRaw` cannot deserialize, so it
 * runs through `$executeRaw`. Both waits are bounded (K130, above), admission in front of the
 * pool is limited (K132, above), and fair per identity, with denials remembered (K136, above).
 */
export async function consumeRateLimit(
  scope: string,
  ip: string,
  opts?: { max?: number; windowMs?: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const max = opts?.max ?? 5;
  const windowMs = opts?.windowMs ?? 60 * 60 * 1000;
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`consumeRateLimit: max must be an integer of at least 1 (got ${max})`);
  }
  if (!Number.isInteger(windowMs) || windowMs < 1 || windowMs > RATE_LIMIT_MAX_WINDOW_MS) {
    throw new Error(
      `consumeRateLimit: windowMs must be an integer from 1 to ${RATE_LIMIT_MAX_WINDOW_MS} (the cleanup job's 48-hour retention; got ${windowMs})`,
    );
  }
  const ipHash = hashIp(ip);
  const lockKey = `${scope}:${ipHash}`;
  const state = admission();
  const remembered = state.denials.deniedUntil(lockKey, max, windowMs, Date.now());
  if (remembered !== null) {
    return { allowed: false, retryAfterSeconds: retryAfterFor(remembered, Date.now(), windowMs) };
  }
  if (!tryAdmit(state, lockKey)) {
    return { allowed: false, retryAfterSeconds: RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS };
  }
  try {
    lockObserver?.beforeTransaction?.();
    const result = await prisma.$transaction(
      async (tx) => {
        // Transaction-local (`true`): the setting ends with this transaction and never leaks to
        // the next user of the pooled connection.
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${RATE_LIMIT_LOCK_TIMEOUT_MS}ms`}, true)`;
        if (lockObserver?.beforeLock) await lockObserver.beforeLock(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
        const now = Date.now();
        const windowStart = new Date(now - windowMs);
        const where = { scope, ipHash, createdAt: { gte: windowStart } };
        const recent = await tx.rateLimitHit.count({ where });
        if (recent >= max) {
          const oldest = await tx.rateLimitHit.findFirst({
            where,
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
          });
          const oldestMs = oldest?.createdAt.getTime() ?? now;
          return {
            allowed: false,
            retryAfterSeconds: retryAfterFor(oldestMs + windowMs, now, windowMs),
            deniedUntilMs: oldest ? oldestMs + windowMs : null,
          };
        }
        await tx.rateLimitHit.create({ data: { scope, ipHash } });
        return { allowed: true, retryAfterSeconds: 0, deniedUntilMs: null };
      },
      { maxWait: RATE_LIMIT_POOL_WAIT_MS, timeout: 5000 },
    );
    if (result.deniedUntilMs !== null) {
      state.denials.record(lockKey, max, windowMs, result.deniedUntilMs, Date.now());
    }
    return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
  } catch (err) {
    // A busy answer is not a quota denial, so nothing is remembered for it.
    if (isLockTimeout(err) || isTransactionStartTimeout(err)) {
      return { allowed: false, retryAfterSeconds: RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS };
    }
    throw err;
  } finally {
    // Every path out of the transaction, including a throw, frees the slot and the identity entry.
    release(state, lockKey);
  }
}

export async function checkRateLimit(
  scope: string,
  ip: string,
  opts?: { max?: number; windowMs?: number },
): Promise<boolean> {
  return (await consumeRateLimit(scope, ip, opts)).allowed;
}
