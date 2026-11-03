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
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { prisma } from "@/lib/db";
import { sweepProjectFileCleanup } from "@/lib/projects/file-cleanup";
import { createDeleteFenceProvider } from "@/lib/storage/file-fence";
import {
  isMountPoint,
  UPLOADS_MARKER_NAME,
  UPLOADS_VOLUME_ID_KEY,
} from "@/lib/storage/uploads-volume";
import {
  type BackupEmulator,
  backupEmulator,
  deleteBackupLease,
  fenceLocks,
  testFenceProvider,
  testUploadsDir,
  testVolumeIdentity,
  trackFence,
} from "../support/file-fence-fixtures";
import { deferred, waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  seedAttachment,
  seedFileCleanup,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let storage: FileStorage;
let attachments: typeof import("@/lib/projects/attachments");
const scratchDirs: string[] = [];

beforeAll(async () => {
  dir = await testUploadsDir("aida-file-fence-");
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  storage = (await import("@/lib/attachments/local-file-storage")).localFileStorage;
  attachments = await import("@/lib/projects/attachments");
});

afterAll(async () => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  for (const scratch of [dir, ...scratchDirs]) await rm(scratch, { recursive: true, force: true });
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

// ---------------------------------------------------------------------------------------------
// U-12 interleavings G2 to G6 (G1 is the tracer above).

/** A storage over the module's uploads root whose delete of one key waits for `gate`. */
function gatedStorage(gatedKey: string, gate: Promise<void>, onSettled: () => void): FileStorage {
  return {
    save: (p) => storage.save(p),
    read: (p) => storage.read(p),
    async delete(p) {
      if (p.key === gatedKey) await gate;
      await storage.delete(p);
      if (p.key === gatedKey) onSettled();
    },
  };
}

function deleteFencePid(rows: Awaited<ReturnType<typeof fenceLocks>>): number {
  const own = rows.filter((r) => r.applicationName === "aida-delete-fence");
  if (own.length !== 1) throw new Error(`expected one delete-fence lock, found ${own.length}`);
  return (own[0] as { pid: number }).pid;
}

describe("U-12 fence interleavings", () => {
  it("G2 dropped session: the backup's fence session is gone but its lease is unexpired, so the sweep deletes nothing (backup-lease)", async () => {
    const { orgId, keys } = await queuedFiles(2);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const backup = await emulator();
    await backup.holdFence();
    await backup.writeLease({ holder: "set-g2", expiresInSeconds: 60 });
    await backup.dropSession();
    expect(await fenceLocks()).toEqual([]);

    const tracked = trackFence(testFenceProvider(dir));
    expect(
      await sweepProjectFileCleanup({ client: prisma, fence: tracked.fence, storage, now: T0 }),
    ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "backup-lease" });
    for (const key of keys) expect(await fileExists(orgId, key)).toBe(true);
    expect(await rowKeys(orgId)).toEqual(keys);
    expect(tracked.handles).toHaveLength(0);
    // The refused run released its shared lock before it ended its connection.
    expect(await fenceLocks()).toEqual([]);
  });

  it("G3 paused backup: the lease has expired but the backup's session still holds the exclusive lock, so the sweep deletes nothing (backup-archiving)", async () => {
    const { orgId, keys } = await queuedFiles(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const backup = await emulator();
    await backup.holdFence();
    await backup.writeLease({ holder: "set-g3", expiresInSeconds: -60 });

    const tracked = trackFence(testFenceProvider(dir));
    expect(
      await sweepProjectFileCleanup({ client: prisma, fence: tracked.fence, storage, now: T0 }),
    ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "backup-archiving" });
    for (const key of keys) expect(await fileExists(orgId, key)).toBe(true);
    expect(await rowKeys(orgId)).toEqual(keys);
    expect(tracked.handles).toHaveLength(0);
    expect(await fenceLocks()).toEqual([
      {
        pid: backup.pid,
        applicationName: "aida-backup-fence",
        mode: "ExclusiveLock",
        granted: true,
      },
    ]);
  });

  it("G4 I/O timeout: a delete still running after its budget keeps the shared lock, so the backup's exclusive request waits until that delete settles", async () => {
    const { orgId, keys } = await queuedFiles(1);
    const [key] = keys as [string];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = deferred<void>();
    let deleteSettled = false;
    const tracked = trackFence(testFenceProvider(dir));
    let backupGranted = false;
    let deleteSettledAtGrant: boolean | null = null;
    try {
      const result = await sweepProjectFileCleanup({
        client: prisma,
        fence: tracked.fence,
        storage: gatedStorage(key, gate.promise, () => {
          deleteSettled = true;
        }),
        now: T0,
        ioBudgetMs: 300,
      });
      // The run ended on its budget while the delete still runs.
      expect(result).toEqual({ deleted: 0, missing: 0, failed: 1 });
      expect(deleteSettled).toBe(false);
      expect(await fileExists(orgId, key)).toBe(true);
      expect(
        await prisma.projectFileCleanup.findFirst({
          where: { organizationId: orgId, storageKey: key },
          select: { attempts: true, lastErrorCode: true },
        }),
      ).toEqual({ attempts: 1, lastErrorCode: "ETIMEDOUT" });
      const held = await fenceLocks();
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({
        applicationName: "aida-delete-fence",
        mode: "ShareLock",
        granted: true,
      });
      const sweepFencePid = deleteFencePid(held);

      const backup = await emulator();
      const granted = backup.holdFence().then(() => {
        backupGranted = true;
        deleteSettledAtGrant = deleteSettled;
      });
      await waitForBlockedBy(prisma, sweepFencePid, [backup.pid]);
      expect(backupGranted).toBe(false);
      expect(await fenceLocks()).toEqual(
        [
          {
            pid: sweepFencePid,
            applicationName: "aida-delete-fence",
            mode: "ShareLock",
            granted: true,
          },
          {
            pid: backup.pid,
            applicationName: "aida-backup-fence",
            mode: "ExclusiveLock",
            granted: false,
          },
        ].sort((a, b) => a.pid - b.pid),
      );

      gate.resolve();
      await tracked.allClosed();
      await granted;
      expect(deleteSettledAtGrant).toBe(true);
      expect(await fileExists(orgId, key)).toBe(false);
      expect(await fenceLocks()).toEqual([
        {
          pid: backup.pid,
          applicationName: "aida-backup-fence",
          mode: "ExclusiveLock",
          granted: true,
        },
      ]);
    } finally {
      gate.resolve();
      await tracked.allClosed();
    }
  });

  it("G5 crash: the backup's session is gone and its lease expired, so the next sweep deletes again", async () => {
    const { orgId, keys } = await queuedFiles(2);
    const backup = await emulator();
    await backup.holdFence();
    await backup.writeLease({ holder: "set-g5", expiresInSeconds: -60 });
    await backup.dropSession();
    expect(await fenceLocks()).toEqual([]);

    const tracked = trackFence(testFenceProvider(dir));
    expect(
      await sweepProjectFileCleanup({ client: prisma, fence: tracked.fence, storage, now: T0 }),
    ).toEqual({ deleted: 2, missing: 0, failed: 0 });
    for (const key of keys) expect(await fileExists(orgId, key)).toBe(false);
    expect(await rowKeys(orgId)).toEqual([]);
    await tracked.allClosed();
    expect(tracked.handles).toHaveLength(1);
    expect(await fenceLocks()).toEqual([]);
  });

  it("G6 ordering: a backup that asks for the fence while a sweep is past its fence check and select waits until the sweep's deletes settle, and a snapshot under that fence references none of the deleted keys", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [, manager] = org.users.map((u) => u.id) as [string, string];
    const project = await seedProject(prisma, org.orgId, {
      createdByUserId: manager,
      managerUserIds: [manager],
    });
    const task = await seedTask(prisma, org.orgId, project.id, { createdByUserId: manager });
    const stored: { id: string; storageKey: string }[] = [];
    for (let i = 0; i < 3; i += 1) {
      const key = newKey("png");
      await storage.save({ orgId: org.orgId, key, data: Buffer.from(`attachment ${i}`) });
      stored.push(
        await seedAttachment(prisma, org.orgId, task.id, {
          uploadedByUserId: manager,
          storageKey: key,
        }),
      );
    }
    const [kept, ...removed] = stored as [
      { id: string; storageKey: string },
      ...{ id: string; storageKey: string }[],
    ];
    const actor = actorOf(manager, org.orgId);
    // The dereferencing transactions: each removes the row and enqueues its key (U-11).
    for (const row of removed) {
      expect(await attachments.deleteTaskAttachment(actor, row.id)).toEqual({
        ok: true,
        cleanupQueued: 1,
      });
    }
    const removedKeys = removed.map((r) => r.storageKey).sort();
    expect(await rowKeys(org.orgId)).toEqual(removedKeys);

    const parked = deferred<void>();
    const resume = deferred<void>();
    const tracked = trackFence(testFenceProvider(dir));
    let settledDeletes = 0;
    let settledAtGrant = -1;
    try {
      const sweep = sweepProjectFileCleanup({
        client: prisma,
        fence: tracked.fence,
        storage: {
          save: (p) => storage.save(p),
          read: (p) => storage.read(p),
          async delete(p) {
            await storage.delete(p);
            settledDeletes += 1;
          },
        },
        now: new Date(Date.now() + 60_000),
        onLocked: async (_tx, lockedKeys) => {
          expect([...lockedKeys].sort()).toEqual(removedKeys);
          parked.resolve();
          await resume.promise;
        },
      });
      await Promise.race([
        parked.promise,
        sweep.then(() => {
          throw new Error("the sweep finished without parking");
        }),
      ]);
      const sweepFencePid = deleteFencePid(await fenceLocks());

      const backup = await emulator();
      const granted = backup.holdFence().then(() => {
        settledAtGrant = settledDeletes;
      });
      await waitForBlockedBy(prisma, sweepFencePid, [backup.pid]);

      // While the backup waits, a new sweep run refuses instead of overtaking it.
      expect(
        await sweepProjectFileCleanup({
          client: prisma,
          fence: testFenceProvider(dir),
          storage,
          now: new Date(Date.now() + 60_000),
        }),
      ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "backup-archiving" });

      resume.resolve();
      expect(await sweep).toEqual({ deleted: removed.length, missing: 0, failed: 0 });
      await granted;
      expect(settledAtGrant).toBe(removed.length);

      // Under the granted fence, a new snapshot of the referencing tables, as a dump would read.
      const allKeys = stored.map((r) => r.storageKey);
      const referenced = await prisma.$queryRaw<{ storageKey: string }[]>`
        SELECT "storageKey" FROM "TaskAttachment" WHERE "storageKey" = ANY(${allKeys}::text[])
        UNION ALL
        SELECT "storageKey" FROM "Attachment" WHERE "storageKey" = ANY(${allKeys}::text[])
      `;
      expect(referenced.map((r) => r.storageKey)).toEqual([kept.storageKey]);
      expect(await fileExists(org.orgId, kept.storageKey)).toBe(true);
      for (const key of removedKeys) expect(await fileExists(org.orgId, key)).toBe(false);
      expect(await rowKeys(org.orgId)).toEqual([]);
      await tracked.allClosed();
      expect(await fenceLocks()).toEqual([
        {
          pid: backup.pid,
          applicationName: "aida-backup-fence",
          mode: "ExclusiveLock",
          granted: true,
        },
      ]);
    } finally {
      resume.resolve();
      await tracked.allClosed();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Uploads volume identity (Q7, R3, P3), ENOENT inside a verified run only, immutable keys.

async function scratchDir(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "aida-volume-"));
  scratchDirs.push(created);
  return created;
}

/** A FileStorage over another uploads root (the module's root is fixed when it loads). */
function storageAt(root: string): FileStorage {
  return {
    async save({ orgId, key, data }) {
      await mkdir(path.join(root, orgId), { recursive: true });
      await writeFile(path.join(root, orgId, key), data, { flag: "wx" });
      return { key, sizeBytes: data.byteLength };
    },
    read: ({ orgId, key }) => readFile(path.join(root, orgId, key)),
    delete: ({ orgId, key }) => unlink(path.join(root, orgId, key)),
  };
}

async function identityRow(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM "SystemSetting" WHERE key = ${UPLOADS_VOLUME_ID_KEY}
  `;
  return rows[0]?.value ?? null;
}

async function markerOf(root: string): Promise<string | null> {
  try {
    return (await readFile(path.join(root, UPLOADS_MARKER_NAME), "utf8")).trim();
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

/** Runs fn without the identity row, then puts the original identity back. */
async function withoutIdentity(fn: () => Promise<void>): Promise<void> {
  const original = await testVolumeIdentity();
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = ${UPLOADS_VOLUME_ID_KEY}`;
  try {
    await fn();
  } finally {
    await prisma.$executeRaw`
      INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
      VALUES (gen_random_uuid()::text, ${UPLOADS_VOLUME_ID_KEY}, ${original}, now())
      ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()
    `;
  }
}

/** One queued file under another uploads root. */
async function queuedFileAt(root: string): Promise<{ orgId: string; key: string }> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  const key = newKey();
  await storageAt(root).save({ orgId, key, data: Buffer.from("volume case") });
  await seedFileCleanup(prisma, orgId, key, { nextAttemptAt: T0 });
  return { orgId, key };
}

describe("uploads volume identity", () => {
  it("first run on an empty directory with no identity row: the sweep writes the marker, then the row, both equal, and deletes", async () => {
    await withoutIdentity(async () => {
      const root = await scratchDir();
      const { orgId, key } = await queuedFileAt(root);
      expect(await identityRow()).toBeNull();
      expect(await markerOf(root)).toBeNull();

      const tracked = trackFence(testFenceProvider(root));
      expect(
        await sweepProjectFileCleanup({
          client: prisma,
          fence: tracked.fence,
          storage: storageAt(root),
          now: T0,
        }),
      ).toEqual({ deleted: 1, missing: 0, failed: 0 });
      const marker = await markerOf(root);
      expect(marker).toMatch(/^[0-9a-f]{32}$/);
      expect(await identityRow()).toBe(marker);
      expect(await fileExistsIn(root, orgId, key)).toBe(false);
      expect(await rowKeys(orgId)).toEqual([]);
      await tracked.allClosed();
    });
  });

  it("a copied marker in a directory that is not a mount point (real mount check) is not verified and nothing is deleted", async () => {
    const root = await scratchDir();
    await copyFile(path.join(dir, UPLOADS_MARKER_NAME), path.join(root, UPLOADS_MARKER_NAME));
    expect(await markerOf(root)).toBe(await identityRow());
    expect(await isMountPoint(root)).toBe(false);
    const { orgId, key } = await queuedFileAt(root);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const realFence = createDeleteFenceProvider({
      connectionString: process.env.DATABASE_URL,
      uploadsDir: root,
      client: prisma,
    });
    expect(
      await sweepProjectFileCleanup({
        client: prisma,
        fence: realFence,
        storage: storageAt(root),
        now: T0,
      }),
    ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "uploads-unverified" });
    expect(await fileExistsIn(root, orgId, key)).toBe(true);
    expect(await rowKeys(orgId)).toEqual([key]);
    expect(await fenceLocks()).toEqual([]);
  });

  it("a marker with another id is not verified, nothing is deleted and the marker is left as it is", async () => {
    const root = await scratchDir();
    const other = randomBytes(16).toString("hex");
    await writeFile(path.join(root, UPLOADS_MARKER_NAME), `${other}\n`);
    const identity = await identityRow();
    expect(other).not.toBe(identity);
    const { orgId, key } = await queuedFileAt(root);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await sweepProjectFileCleanup({
        client: prisma,
        fence: testFenceProvider(root),
        storage: storageAt(root),
        now: T0,
      }),
    ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "uploads-unverified" });
    expect(await fileExistsIn(root, orgId, key)).toBe(true);
    expect(await rowKeys(orgId)).toEqual([key]);
    expect(await markerOf(root)).toBe(other);
    expect(await identityRow()).toBe(identity);
  });

  it("a missing marker while the identity row exists is not verified, and the sweep does not recreate the marker", async () => {
    const root = await scratchDir();
    const identity = await identityRow();
    expect(identity).not.toBeNull();
    const { orgId, key } = await queuedFileAt(root);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await sweepProjectFileCleanup({
        client: prisma,
        fence: testFenceProvider(root),
        storage: storageAt(root),
        now: T0,
      }),
    ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "uploads-unverified" });
    expect(await markerOf(root)).toBeNull();
    expect(await fileExistsIn(root, orgId, key)).toBe(true);
    expect(await rowKeys(orgId)).toEqual([key]);
    expect(await identityRow()).toBe(identity);
  });

  it("a crash between marker and row (marker present, no row) is adopted on the next run, which then deletes", async () => {
    await withoutIdentity(async () => {
      const root = await scratchDir();
      const crashed = randomBytes(16).toString("hex");
      await writeFile(path.join(root, UPLOADS_MARKER_NAME), `${crashed}\n`, { flag: "wx" });
      const { orgId, key } = await queuedFileAt(root);

      const tracked = trackFence(testFenceProvider(root));
      expect(
        await sweepProjectFileCleanup({
          client: prisma,
          fence: tracked.fence,
          storage: storageAt(root),
          now: T0,
        }),
      ).toEqual({ deleted: 1, missing: 0, failed: 0 });
      expect(await identityRow()).toBe(crashed);
      expect(await markerOf(root)).toBe(crashed);
      expect(await fileExistsIn(root, orgId, key)).toBe(false);
      await tracked.allClosed();
    });
  });
});

describe("ENOENT inside a verified run only", () => {
  it("inside a verified run a missing file removes its row (Phase 14 behaviour)", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const key = newKey();
    await seedFileCleanup(prisma, orgId, key, { nextAttemptAt: T0 });
    expect(await fileExists(orgId, key)).toBe(false);
    const tracked = trackFence(testFenceProvider(dir));
    expect(
      await sweepProjectFileCleanup({ client: prisma, fence: tracked.fence, storage, now: T0 }),
    ).toEqual({ deleted: 0, missing: 1, failed: 0 });
    expect(await rowKeys(orgId)).toEqual([]);
    await tracked.allClosed();
  });

  it("an unverified run removes no row, even for a file that is missing", async () => {
    const root = await scratchDir();
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const key = newKey();
    await seedFileCleanup(prisma, orgId, key, { nextAttemptAt: T0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await sweepProjectFileCleanup({
        client: prisma,
        fence: testFenceProvider(root),
        storage: storageAt(root),
        now: T0,
      }),
    ).toEqual({ deleted: 0, missing: 0, failed: 0, skipped: "uploads-unverified" });
    expect(await rowKeys(orgId)).toEqual([key]);
  });
});

describe("immutable storage keys (D-02(1))", () => {
  it("saving the same key twice through localFileStorage rejects with EEXIST and leaves the first bytes", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const key = newKey("bin");
    await storage.save({ orgId, key, data: Buffer.from("first bytes") });
    await expect(
      storage.save({ orgId, key, data: Buffer.from("second bytes, longer") }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect((await storage.read({ orgId, key })).toString()).toBe("first bytes");
  });
});
