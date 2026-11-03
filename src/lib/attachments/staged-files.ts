// Staged attachment saving (Phase 12, reviews C7, R2-3 and R3-2). A request that stores files
// before its database transaction must not leave them behind when it ends without a committed
// row: a refusal (for example 409 MERGED_SOURCE), a rolled-back transaction, or a save that
// fails part-way.
//
// - Each key joins the cleanup list BEFORE its save is called, so a save that throws after
//   writing part of a file is cleaned up together with every earlier key (R2-3).
// - On a save failure every listed key's delete is attempted and the original save error is
//   rethrown unchanged. Exception (Phase 9 plan 09-04, D-02(1) and U-13): saves are exclusive
//   create, so a save that fails with EEXIST wrote nothing and its key holds a file this request
//   did not write, possibly one a committed row references; that key is never deleted here.
// - discard() attempts every saved key once and never throws, so a refusal keeps its own
//   response and a transaction error keeps its own error.
//
// Cleanup is BEST-EFFORT, not absolute (R3-2): a delete that fails with ENOENT is ignored (the
// file is already gone); a delete the storage refuses for any other reason leaves that file on
// disk, and the only record is one console.error line with the key and the error code, never
// file content. No retry or reconciliation of such files is built here.
//
// Relative imports only.
import type { FileStorage } from "./file-storage";

export interface StagedFileInput {
  /** A server-generated storage key (buildStorageKey). */
  key: string;
  data: Buffer;
}

export interface StagedFiles {
  /** The keys saved, in order. */
  saved: readonly string[];
  /** Deletes every saved key once (best-effort); a second call deletes nothing. Never throws. */
  discard(): Promise<void>;
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "UNKNOWN";
}

/** Attempts the delete of every key; logs a refused delete by key and error code only. */
async function deleteEach(
  storage: FileStorage,
  orgId: string,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.delete({ orgId, key });
    } catch (err) {
      const code = errorCode(err);
      if (code === "ENOENT") continue;
      try {
        console.error(`[attachments] staged file delete failed: key=${key} code=${code}`);
      } catch {
        // Logging must never replace the request's own response or error.
      }
    }
  }
}

/**
 * Saves the files in order through the FileStorage interface. On a save failure deletes every
 * attempted key (best-effort) and rethrows the original error; on success returns the saved
 * keys and a discard() for a request that ends without a committed row.
 */
export async function saveStagedFiles(
  storage: FileStorage,
  orgId: string,
  files: readonly StagedFileInput[],
): Promise<StagedFiles> {
  const attempted: string[] = [];
  try {
    for (const file of files) {
      attempted.push(file.key);
      await storage.save({ orgId, key: file.key, data: file.data });
    }
  } catch (err) {
    // The key whose save failed with EEXIST belongs to someone else: only this request's own
    // writes are cleaned up.
    const own = errorCode(err) === "EEXIST" ? attempted.slice(0, -1) : attempted;
    await deleteEach(storage, orgId, own);
    throw err;
  }

  const saved = [...attempted];
  let discarded = false;
  return {
    saved,
    async discard() {
      if (discarded) return;
      discarded = true;
      await deleteEach(storage, orgId, saved);
    },
  };
}
