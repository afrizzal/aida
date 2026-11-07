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

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "UNKNOWN";
}

/** Queues the keys for the fenced, reference-checked sweep. Never throws and never unlinks. */
export async function queueStagedFilesAfterUncertainCommit(
  orgId: string,
  storageKeys: readonly string[],
): Promise<void> {
  if (storageKeys.length === 0) return;
  try {
    await prisma.$transaction((tx) =>
      enqueueFileCleanupInTx(tx, orgId, storageKeys, {
        delayMinutes: UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES,
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
