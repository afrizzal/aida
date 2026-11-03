// Phase 14 attachment-file cleanup outbox and sweep (contract section 12; D-07, run decisions K66
// and K68, review C12).
//
// - enqueueFileCleanupInTx runs inside the caller's delete transaction (lock class 6 of contract
//   section 3): one ProjectFileCleanup row per storage key, idempotent through
//   ON CONFLICT ("organizationId", "storageKey") DO NOTHING. A delete that commits therefore always
//   leaves a durable record of the files to remove; a delete that rolls back leaves none.
// - sweepProjectFileCleanup is the scheduled worker job's body. In one transaction it selects up
//   to PROJECT_FILE_CLEANUP_BATCH due rows (nextAttemptAt not after now, oldest first) with
//   FOR UPDATE SKIP LOCKED, so two overlapping runs never handle the same row; deletes each file
//   through FileStorage with the row's own organization; removes the row on success or ENOENT
//   (a missing file counts as done, C10); on any other error keeps the row with attempts + 1,
//   lastErrorCode and nextAttemptAt = now + min(2^attempts, 60) minutes.
// - Bounds (review b-IN-05): a row that failed PROJECT_FILE_CLEANUP_MAX_ATTEMPTS times is no longer
//   selected and stays as the operator's report (attempts and lastErrorCode); the file I/O of one
//   run stops after PROJECT_FILE_CLEANUP_IO_BUDGET_MS, under the transaction timeout: a delete that
//   has not settled by then is recorded as ETIMEDOUT and the rows not reached stay untouched.
//
// This is the one cross-organization reader of ProjectFileCleanup (like the snooze-wake system
// job): every statement after the select names the row's own organizationId. It writes no
// activity (the outbox is bookkeeping, not a project change, contract section 5) and is
// idempotent: a second run over the same rows changes nothing. Logs carry the storage key and the
// error code only, never file content or an error message.
//
// Phase 9 (plan 09-04):
// - U-11, one deletion queue: ProjectFileCleanup and this sweep are the one deletion path for
//   every stored file, ticket attachments, logos and project files alike. Every path that
//   dereferences a stored file enqueues its key in the dereferencing transaction; no other code
//   deletes a file that a committed row ever referenced (the U-13 inventory,
//   tests/unit/file-delete-callers.test.ts).
// - U-12, the backup fence (src/lib/storage/file-fence.ts): a run first opens the fence, which
//   verifies the uploads volume (mount point plus marker equal to `uploads:volume-id`) and takes
//   the shared side of the session-level fence lock with no unexpired backup lease. A refusal
//   returns zeros with `skipped` and touches no row and no file. The fence is opened before the
//   select, every storage.delete promise is tracked by it, and it is released in the background
//   only after the transaction ended and every tracked delete settled, including one the I/O
//   budget already reported as ETIMEDOUT. ENOENT counts as done only inside such a verified run.
//
// Relative imports only: the worker bundles this module.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { FileStorage } from "../attachments/file-storage";
import type { DeleteFence, FenceRefusal, FenceRefusalReason } from "../storage/file-fence";
import {
  PROJECT_FILE_CLEANUP_BATCH,
  PROJECT_FILE_CLEANUP_IO_BUDGET_MS,
  PROJECT_FILE_CLEANUP_MAX_ATTEMPTS,
  PROJECT_FILE_CLEANUP_MAX_BACKOFF_MINUTES,
  TRANSACTION_OPTIONS,
} from "./contract";

const MINUTE_MS = 60_000;

/**
 * Inserts one ProjectFileCleanup row per storage key of the organization, inside the caller's
 * transaction. A key already queued for the organization is left as it is. Returns the number of
 * rows inserted.
 */
export async function enqueueFileCleanupInTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  storageKeys: readonly string[],
): Promise<number> {
  const keys = [...new Set(storageKeys)];
  if (keys.length === 0) return 0;
  const ids = keys.map(() => randomUUID());
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "ProjectFileCleanup" (id, "organizationId", "storageKey")
    SELECT k.id, ${orgId}, k.key
    FROM unnest(${ids}::text[], ${keys}::text[]) AS k(id, key)
    ON CONFLICT ("organizationId", "storageKey") DO NOTHING
    RETURNING id
  `;
  return inserted.length;
}

export interface FileCleanupSweepResult {
  /** Files deleted and their rows removed. */
  deleted: number;
  /** Rows removed because the file was already gone (ENOENT). */
  missing: number;
  /** Rows kept for a later attempt because the delete failed with another error. */
  failed: number;
  /** Set when the fence refused the run: nothing was selected, deleted or changed (U-12). */
  skipped?: FenceRefusalReason;
}

export interface FileCleanupSweepOptions {
  client: PrismaClient;
  storage: FileStorage;
  /** The backup fence and uploads volume check (U-12); required, opened before the select. */
  fence: { open(): Promise<DeleteFence | FenceRefusal> };
  now?: Date;
  limit?: number;
  /** Milliseconds of file I/O per run (default PROJECT_FILE_CLEANUP_IO_BUDGET_MS). */
  ioBudgetMs?: number;
  /**
   * Test hook only (the "test hook where the run is production code" of
   * tests/support/lock-wait.ts): awaited right after the FOR UPDATE SKIP LOCKED select and before
   * the first storage call, with the run's transaction and the storage keys it locked. Production
   * and the worker handler never pass it.
   */
  onLocked?: (tx: Prisma.TransactionClient, lockedStorageKeys: readonly string[]) => Promise<void>;
}

interface DueRow {
  id: string;
  organizationId: string;
  storageKey: string;
  attempts: number;
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "UNKNOWN";
}

/** The retry delay after a failure, from the attempts recorded before it. */
export function fileCleanupBackoffMinutes(previousAttempts: number): number {
  return Math.min(2 ** Math.max(0, previousAttempts), PROJECT_FILE_CLEANUP_MAX_BACKOFF_MINUTES);
}

function logFailure(key: string, code: string): void {
  try {
    console.error(`[project-file-cleanup] file delete failed: key=${key} code=${code}`);
  } catch {
    // Logging never changes the sweep's outcome.
  }
}

class IoBudgetExceeded extends Error {
  readonly code = "ETIMEDOUT";
}

/** Settles with the delete, or rejects with ETIMEDOUT after ms (the delete may still finish). */
async function withinBudget(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IoBudgetExceeded("file I/O budget exceeded")), ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function logSkipped(reason: FenceRefusalReason): void {
  try {
    console.error(`[project-file-cleanup] sweep skipped: ${reason}`);
  } catch {
    // Logging never changes the sweep's outcome.
  }
}

function logStopped(key: string, code: string): void {
  try {
    console.error(
      `[project-file-cleanup] retries stopped after ${PROJECT_FILE_CLEANUP_MAX_ATTEMPTS} attempts: key=${key} code=${code}`,
    );
  } catch {
    // Logging never changes the sweep's outcome.
  }
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const value = rows[0]?.now;
  return value instanceof Date ? value : new Date();
}

/** One run of the scheduled sweep (contract section 12, K66). */
export async function sweepProjectFileCleanup(
  opts: FileCleanupSweepOptions,
): Promise<FileCleanupSweepResult> {
  const limit = opts.limit ?? PROJECT_FILE_CLEANUP_BATCH;
  const budgetMs = opts.ioBudgetMs ?? PROJECT_FILE_CLEANUP_IO_BUDGET_MS;
  const { storage } = opts;

  // U-12: the fence is taken before any due row is selected, and a refusal touches nothing.
  const fence = await opts.fence.open();
  if ("refused" in fence) {
    logSkipped(fence.refused);
    return { deleted: 0, missing: 0, failed: 0, skipped: fence.refused };
  }

  try {
    return await sweepInsideFence(opts, fence, limit, budgetMs, storage);
  } finally {
    // Background release: the job returns as before, the lock outlives every tracked delete.
    fence.close();
  }
}

async function sweepInsideFence(
  opts: FileCleanupSweepOptions,
  fence: DeleteFence,
  limit: number,
  budgetMs: number,
  storage: FileStorage,
): Promise<FileCleanupSweepResult> {
  return opts.client.$transaction(async (tx) => {
    // Without an injected clock the run reads the database clock, the clock that wrote
    // nextAttemptAt's default, so a worker clock behind the database's never skips a due row.
    const now = opts.now ?? (await databaseNow(tx));
    const due = await tx.$queryRaw<DueRow[]>`
      SELECT id, "organizationId", "storageKey", attempts
      FROM "ProjectFileCleanup"
      WHERE "nextAttemptAt" <= ${now} AND attempts < ${PROJECT_FILE_CLEANUP_MAX_ATTEMPTS}
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;

    if (opts.onLocked)
      await opts.onLocked(
        tx,
        due.map((row) => row.storageKey),
      );

    const result: FileCleanupSweepResult = { deleted: 0, missing: 0, failed: 0 };
    const deadline = Date.now() + budgetMs;
    for (const row of due) {
      const remaining = deadline - Date.now();
      // Out of budget: the rows not reached stay as they are for the next run.
      if (remaining <= 0) break;
      let code: string | null = null;
      let outOfBudget = false;
      try {
        const work = storage.delete({ orgId: row.organizationId, key: row.storageKey });
        // Tracked before the race: a delete that outlives its budget still holds the fence.
        fence.track(work);
        await withinBudget(work, remaining);
      } catch (err) {
        code = errorCode(err);
        outOfBudget = err instanceof IoBudgetExceeded;
      }

      if (code === null || code === "ENOENT") {
        await tx.$executeRaw`
          DELETE FROM "ProjectFileCleanup"
          WHERE id = ${row.id} AND "organizationId" = ${row.organizationId}
        `;
        if (code === null) result.deleted += 1;
        else result.missing += 1;
        continue;
      }

      const attempts = Number(row.attempts);
      const nextAttemptAt = new Date(
        now.getTime() + fileCleanupBackoffMinutes(attempts) * MINUTE_MS,
      );
      await tx.$executeRaw`
        UPDATE "ProjectFileCleanup"
        SET attempts = attempts + 1, "lastErrorCode" = ${code}, "nextAttemptAt" = ${nextAttemptAt}
        WHERE id = ${row.id} AND "organizationId" = ${row.organizationId}
      `;
      logFailure(row.storageKey, code);
      if (attempts + 1 >= PROJECT_FILE_CLEANUP_MAX_ATTEMPTS) logStopped(row.storageKey, code);
      result.failed += 1;
      if (outOfBudget) break;
    }
    return result;
  }, TRANSACTION_OPTIONS);
}
