// Staged uploads after a transaction whose outcome is unknown (run decision K148, Codex diff
// critique round 1, finding 1; supersedes the deferral of review b-WR-3's ambiguous-commit case
// and c-IN-03).
//
// A request that stores files before its referencing transaction removes them at once on a
// refusal or on an error raised before COMMIT was sent: no committed row can reference them.
// After COMMIT was sent, an error (a lost reply, a dropped connection, a timeout reported late)
// does not say whether the rows committed. Unlinking the files then could break a live reference,
// and it would bypass the backup fence. Such files are never unlinked here. Their keys go to the
// one deletion queue (ProjectFileCleanup) instead, due UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES
// later, and the fenced sweep (src/lib/projects/file-cleanup.ts) deletes a key only when no
// committed row references it. The delay lets a COMMIT that is still in flight settle before the
// sweep looks.
//
// Best effort: when the queue insert fails as well (the database is unreachable), the files stay
// on disk as orphans, never as a broken reference, and one line names the organization and the
// key count with the error code, never a message.
//
// Relative imports only.
import { prisma } from "../db";
import { enqueueFileCleanupInTx } from "../projects/file-cleanup";

/** How long a key queued after an unknown outcome waits before the sweep checks it. */
export const UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES = 15;

// K155 (Codex diff critique round 2, finding 4): the delay above is only safe when the server
// itself ends an upload transaction whose COMMIT is still pending. PostgreSQL 16 has no
// whole-transaction timeout (transaction_timeout is PostgreSQL 17). Each of the four upload
// transactions that can reach queueStagedFilesAfterUncertainCommit therefore calls
// boundUploadCommitInTx as its LAST statement, immediately before its commit-sent flag is set.
// It sets idle_in_transaction_session_timeout for the rest of that transaction only
// (set_config(..., true) is SET LOCAL): while the session waits for the COMMIT, the server
// terminates it after UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS, which aborts the transaction, and a
// COMMIT that arrives later finds no session. So UPLOAD_COMMIT_BOUND_SECONDS after that statement
// returned, the server has either started the COMMIT or aborted the transaction. The
// commit-sent flag, the error and the queue insert all come after that statement, and the queue
// row is due UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES after the queue transaction's start
// (database clock), so the sweep's reference check runs at least UNCERTAIN_COMMIT_MARGIN_SECONDS
// after the bound.
//
// What the bound does not cover, and why: a COMMIT the server has started. statement_timeout
// does not bound it (PostgreSQL disables the statement timer before it runs the commit work, as
// tests/integration/upload-commit-bound.test.ts shows), and no other PostgreSQL 16 setting does.
// AIDA's schema has no deferrable constraint and no deferred trigger (the same test checks it),
// so that commit work runs no user code: it writes and flushes the commit record. Its duration
// depends on the database server's storage alone; a storage stall long enough to outlast the
// margin stalls every commit on the server with it. That remaining window is a stated limit, not
// a proven bound.

/** The server ends a session idle inside an upload transaction after this many seconds. */
export const UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS = 30;
/** After boundUploadCommitInTx returns, the COMMIT has started or the transaction is aborted within this. */
export const UPLOAD_COMMIT_BOUND_SECONDS = UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS;
/** How long after the bound the sweep checks a queued key at the earliest (870 s). */
export const UNCERTAIN_COMMIT_MARGIN_SECONDS =
  UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES * 60 - UPLOAD_COMMIT_BOUND_SECONDS;

// K158 (Codex diff critique round 3, finding 3; replaces the time bound above as the safety
// rule): the same last statement also returns the upload transaction's id,
// pg_current_xact_id() (xid8, as decimal text; the transaction has written its rows, so it
// already has one). After an unknown outcome the id is stored with every queued key
// (ProjectFileCleanup.uploadXactId), and the sweep asks the server what became of that
// transaction (pg_xact_status) before it looks for references: "in progress" or unknown keeps the
// file, and only "committed" or "aborted" lets the reference check decide. The 15-minute delay
// and the 30-second idle bound stay as defence in depth.

/** The one statement boundUploadCommitInTx runs (the values are constants, never input). */
export const UPLOAD_COMMIT_BOUND_SQL = `SELECT set_config('idle_in_transaction_session_timeout', '${UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS}s', true) AS bound, pg_current_xact_id()::text AS xact_id`;

/** An xid8 as decimal text (what pg_current_xact_id()::text returns). */
export const UPLOAD_XACT_ID_PATTERN = /^[0-9]{1,20}$/;

/** The transaction client part boundUploadCommitInTx needs (any Prisma transaction client). */
export interface RawExecutor {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
}

/**
 * K155 and K158: the last statement of an upload transaction that can reach the uncertain-commit
 * path. Sets the server-side idle limit above for the rest of the transaction, and returns the
 * transaction's id for queueStagedFilesAfterUncertainCommit (null if the server returned none).
 */
export async function boundUploadCommitInTx(tx: RawExecutor): Promise<string | null> {
  const rows = await tx.$queryRawUnsafe<{ xact_id?: unknown }[]>(UPLOAD_COMMIT_BOUND_SQL);
  const id = Array.isArray(rows) ? rows[0]?.xact_id : undefined;
  return typeof id === "string" && UPLOAD_XACT_ID_PATTERN.test(id) ? id : null;
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "UNKNOWN";
}

/**
 * Queues the keys for the fenced, reference-checked sweep. Never throws and never unlinks.
 * `uploadXactId` is what boundUploadCommitInTx returned in the upload transaction (K158).
 */
export async function queueStagedFilesAfterUncertainCommit(
  orgId: string,
  storageKeys: readonly string[],
  uploadXactId: string | null,
): Promise<void> {
  if (storageKeys.length === 0) return;
  try {
    await prisma.$transaction((tx) =>
      enqueueFileCleanupInTx(tx, orgId, storageKeys, {
        delayMinutes: UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES,
        uploadXactId,
      }),
    );
  } catch (err) {
    try {
      console.error(
        `[attachments] could not queue ${storageKeys.length} staged file(s) after an unknown commit outcome; they stay on disk: org=${orgId} code=${errorCode(err)}`,
      );
    } catch {
      // Logging must never replace the request's own error.
    }
  }
}
