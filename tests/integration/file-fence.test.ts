// Phase 9 plan 09-04: the backup fence of the file cleanup sweep (U-12), the uploads volume
// identity (review Q7, R3) and immutable storage keys (D-02(1)), on a real Postgres through
// Testcontainers. The backup side is the SQL-level emulator of tests/support/file-fence-fixtures.ts,
// which issues the statements plan 09-06's shell issues. Each case asserts the sweep result
// (including `skipped`), which files exist, which rows exist, and who holds the fence lock
// (pg_locks).
//
// This file owns the ProjectFileCleanup table while it runs (every case starts from an empty
// table) and the `backup:lease` row (every case that writes one deletes it in finally). Safe only
// because integration files run one at a time (vitest.integration.config.ts sets
// fileParallelism: false, and docs/ops/local-dev.md allows one test process at a time).
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { prisma } from "@/lib/db";
import { sweepProjectFileCleanup } from "@/lib/projects/file-cleanup";
import {
  type BackupEmulator,
  backupEmulator,
  deleteBackupLease,
  fenceLocks,
  testFenceProvider,
  testUploadsDir,
  trackFence,
} from "../support/file-fence-fixtures";
import { seedFileCleanup, seedOrgWithMembers } from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let storage: FileStorage;

beforeAll(async () => {
  dir = await testUploadsDir("aida-file-fence-");
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  storage = (await import("@/lib/attachments/local-file-storage")).localFileStorage;
});

afterAll(async () => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  await rm(dir, { recursive: true, force: true });
});

const emulators: BackupEmulator[] = [];

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM "ProjectFileCleanup"`;
  await deleteBackupLease();
});

afterEach(async () => {
  for (const emulator of emulators.splice(0)) await emulator.release();
  await deleteBackupLease();
  vi.restoreAllMocks();
});

async function emulator(): Promise<BackupEmulator> {
  const created = await backupEmulator();
  emulators.push(created);
  return created;
}

const T0 = new Date("2031-03-01T00:00:00.000Z");

let keySeq = 0;
function newKey(ext = "txt"): string {
  keySeq += 1;
  return `${Date.now().toString(16)}${keySeq.toString(16).padStart(6, "0")}.${ext}`;
}

async function fileExistsIn(root: string, orgId: string, key: string): Promise<boolean> {
  try {
    await stat(path.join(root, orgId, key));
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return false;
    throw err;
  }
}

function fileExists(orgId: string, key: string): Promise<boolean> {
  return fileExistsIn(dir, orgId, key);
}

async function rowKeys(orgId: string): Promise<string[]> {
  const rows = await prisma.projectFileCleanup.findMany({
    where: { organizationId: orgId },
    select: { storageKey: true },
    orderBy: { storageKey: "asc" },
  });
  return rows.map((r) => r.storageKey);
}

/** An organization with stored files, each queued for cleanup and due at T0. */
async function queuedFiles(count: number): Promise<{ orgId: string; keys: string[] }> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = newKey();
    await storage.save({ orgId, key, data: Buffer.from(`file ${i}`) });
    await seedFileCleanup(prisma, orgId, key, { nextAttemptAt: T0 });
    keys.push(key);
  }
  keys.sort();
  return { orgId, keys };
}

describe("backup fence tracer", () => {
  it("G1: while a backup holds the exclusive fence the sweep deletes nothing (backup-archiving); after release the next run deletes the file and the row", async () => {
    const { orgId, keys } = await queuedFiles(1);
    const [key] = keys as [string];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const backup = await emulator();
    await backup.holdFence();
    expect(await fenceLocks()).toEqual([
      {
        pid: backup.pid,
        applicationName: "aida-backup-fence",
        mode: "ExclusiveLock",
        granted: true,
      },
    ]);

    const tracked = trackFence(testFenceProvider(dir));
    const refused = await sweepProjectFileCleanup({
      client: prisma,
      fence: tracked.fence,
      storage,
      now: T0,
    });
    expect(refused).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "backup-archiving" });
    expect(await fileExists(orgId, key)).toBe(true);
    expect(await rowKeys(orgId)).toEqual([key]);
    expect(tracked.handles).toHaveLength(0);
    // The refused run left no shared lock and no fence connection behind.
    expect(await fenceLocks()).toEqual([
      {
        pid: backup.pid,
        applicationName: "aida-backup-fence",
        mode: "ExclusiveLock",
        granted: true,
      },
    ]);

    await backup.release();
    expect(await fenceLocks()).toEqual([]);

    const swept = await sweepProjectFileCleanup({
      client: prisma,
      fence: tracked.fence,
      storage,
      now: T0,
    });
    expect(swept).toEqual({ deleted: 1, missing: 0, failed: 0 });
    expect(await fileExists(orgId, key)).toBe(false);
    expect(await rowKeys(orgId)).toEqual([]);
    await tracked.allClosed();
    expect(tracked.handles).toHaveLength(1);
    expect(await fenceLocks()).toEqual([]);
  });
});
