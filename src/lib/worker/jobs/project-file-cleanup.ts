// The every-minute project file cleanup job (Phase 14, contract section 12, K66).
//
// Runs one sweep of the ProjectFileCleanup outbox with the base client and the local file
// storage (UPLOADS_DIR, shared with the app through the uploads volume, K68). The queue has
// policy singleton, and the sweep's FOR UPDATE SKIP LOCKED keeps two overlapping runs apart
// anyway. Idempotent; writes no activity; sends nothing to anyone.
//
// Phase 9 (plan 09-04, U-12): every run goes through the backup fence and the uploads volume
// check on the real UPLOADS_DIR, with the real mount-point test. Outside a container UPLOADS_DIR
// is usually not a mount point, so a local `pnpm worker` deletes no files and logs
// `sweep skipped: uploads-unverified` once a minute.
//
// Relative imports only: the worker bundles this module.
import { localFileStorage, uploadsRoot } from "../../attachments/local-file-storage";
import { prisma } from "../../db";
import { type FileCleanupSweepResult, sweepProjectFileCleanup } from "../../projects/file-cleanup";
import { createDeleteFenceProvider, type DeleteFenceProvider } from "../../storage/file-fence";

// K144 (F3, b-WR-4): one provider per worker process, so a run whose delete still hangs keeps the
// only fence connection, and every later run is refused "delete-pending" until it settles.
let fenceProvider: DeleteFenceProvider | null = null;

/** The pg-boss handler; the scheduled payload is empty and is not read. */
export async function projectFileCleanupHandler(_jobs?: unknown): Promise<FileCleanupSweepResult> {
  fenceProvider ??= createDeleteFenceProvider({
    connectionString: process.env.DATABASE_URL,
    uploadsDir: uploadsRoot(),
    client: prisma,
  });
  return sweepProjectFileCleanup({
    client: prisma,
    storage: localFileStorage,
    fence: fenceProvider,
  });
}
