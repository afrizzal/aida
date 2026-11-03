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
// own, so a crash mid-seed leaves those rows behind with no marker. The lock only serialises the
// three paths above; the /setup wizard and user sign-up do not take it (stated limit).
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
  /** Upper bound of the open transaction that holds the lock (default 600 s). */
  transactionTimeoutMs?: number;
}

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
  const { lockTimeoutMs = 120_000, transactionTimeoutMs = 600_000 } = opts;
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Transaction-local (`true`): the setting ends with this transaction and never leaks to
        // the next user of the pooled connection.
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`;
        await tx.$executeRawUnsafe(LOCK_STATEMENT);
        return fn(tx);
      },
      { maxWait: 30_000, timeout: transactionTimeoutMs },
    );
  } catch (err) {
    if (isLockTimeout(err)) throw new TenantSeedLockTimeout();
    throw err;
  }
}
