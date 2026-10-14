// The every-minute project file cleanup job (Phase 14, contract section 12, K66).
//
// Runs one sweep of the ProjectFileCleanup outbox with the base client and the local file
// storage (UPLOADS_DIR, shared with the app through the uploads volume, K68). The queue has
// policy singleton, and the sweep's FOR UPDATE SKIP LOCKED keeps two overlapping runs apart
// anyway. Idempotent; writes no activity; sends nothing to anyone.
//
// Relative imports only: the worker bundles this module.
import { localFileStorage } from "../../attachments/local-file-storage";
import { prisma } from "../../db";
import { type FileCleanupSweepResult, sweepProjectFileCleanup } from "../../projects/file-cleanup";

/** The pg-boss handler; the scheduled payload is empty and is not read. */
export async function projectFileCleanupHandler(_jobs?: unknown): Promise<FileCleanupSweepResult> {
  return sweepProjectFileCleanup({ client: prisma, storage: localFileStorage });
}
