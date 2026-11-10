// ---------------------------------------------------------------------------
// tenant-seed-lock.ts — the one mutex shared by every path that creates the first tenant
// (Phase 9 plan 09-02, AIDA-37, D-17, U-17): `pnpm db:seed`, the DEMO_MODE boot and
// bootstrapFromEnv.
//
// What it is: a Postgres transaction-level advisory lock on one fixed key, taken inside one
// interactive transaction that stays open from the classification until the caller's last write
// through `tx` (the demo completion marker) commits. A second caller waits for the lock, up to
// `lockTimeoutMs`, and then classifies what the first one committed.
//
// What it is NOT: atomicity. The seed's other writes (Better Auth sign-up and organization
// creation, createTicket, the KB writes) run on their own pooled connections and commit on their
// own, so a crash mid-seed leaves those rows behind with no marker. The lock serialises the three
// paths above and the /setup wizard (K145, review a-WR-1); user sign-up outside /setup does not
// take it (stated limit). That includes invitee sign-up (src/lib/workspace-members/
// invite-onboarding.ts, plan 10-08, V-04): an organization already exists and setupComplete is
// required, so it cannot race the creation of the first tenant.
//
// Relative imports only: src/lib/bootstrap.ts imports this module.
// ---------------------------------------------------------------------------
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./db";

/** The SQL expression of the lock key; a fixed string, never built from input. */
export const TENANT_SEED_LOCK_KEY_SQL = "hashtextextended('aida:tenant-seed', 0)";

const LOCK_STATEMENT = `SELECT pg_advisory_xact_lock(${TENANT_SEED_LOCK_KEY_SQL})`;

export interface TenantSeedLockOptions {
  /** How long to wait for another holder before giving up (default 120 s). */
  lockTimeoutMs?: number;
  /** How long to wait for a pooled connection to open the transaction (default 30 s). */
  maxWaitMs?: number;
  /** Upper bound of the open transaction that holds the lock (default 600 s). */
  transactionTimeoutMs?: number;
}

/**
 * The waits at server start (review a-WR-2, K146), passed only from src/instrumentation.ts.
 * register() runs bootstrapFromEnv and then the demo boot before Next serves a request, so each
 * waits at most 10 s for a pooled connection and 10 s for the lock: at most 40 s in total on the
 * lock and the pool, plus the time of a bootstrap or demo seed that does run. A wait that ends
 * logs one line, and the app starts without that step.
 */
export const BOOT_TENANT_SEED_LOCK_OPTIONS = {
  lockTimeoutMs: 10_000,
  maxWaitMs: 10_000,
} as const satisfies TenantSeedLockOptions;

/** The waits of the /setup wizard's request (K145): a held lock answers "busy" after 10 s. */
export const SETUP_TENANT_SEED_LOCK_OPTIONS = {
  lockTimeoutMs: 10_000,
  maxWaitMs: 10_000,
} as const satisfies TenantSeedLockOptions;

/** The lock was not acquired within `lockTimeoutMs`; nothing was read or written. */
export class TenantSeedLockTimeout extends Error {
  constructor() {
    super("The tenant seed lock was not acquired within the lock timeout");
    this.name = "TenantSeedLockTimeout";
  }
}

// Postgres SQLSTATE 55P03 (lock_not_available): the wait passed `lock_timeout`. Prisma wraps a
// raw-query failure as P2010 and keeps the driver adapter's error, with the SQLSTATE as
// `originalCode`, in `meta.driverAdapterError.cause` (same shape as check-rate-limit.ts).
function isLockTimeout(err: unknown): boolean {
  const e = err as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } };
  };
  const cause = e?.meta?.driverAdapterError?.cause;
  return cause?.originalCode === "55P03" || cause?.code === "55P03" || e?.code === "55P03";
}

/**
 * Runs `fn` while holding the tenant seed lock. `fn` receives the transaction that holds it;
 * whatever `fn` writes through `tx` commits together with the lock release, everything it
 * writes through other clients commits on its own.
 */
export async function withTenantSeedLock<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: TenantSeedLockOptions = {},
): Promise<T> {
  const { lockTimeoutMs = 120_000, maxWaitMs = 30_000, transactionTimeoutMs = 600_000 } = opts;
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Transaction-local (`true`): the setting ends with this transaction and never leaks to
        // the next user of the pooled connection.
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`;
        await tx.$executeRawUnsafe(LOCK_STATEMENT);
        return fn(tx);
      },
      { maxWait: maxWaitMs, timeout: transactionTimeoutMs },
    );
  } catch (err) {
    if (isLockTimeout(err)) throw new TenantSeedLockTimeout();
    throw err;
  }
}
