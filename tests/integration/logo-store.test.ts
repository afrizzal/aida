// Phase 9 plan 09-05 (AIDA-34, D-07, U-11, review P10): the logo store on a real Postgres through
// Testcontainers. UPLOADS_DIR is set to a fresh temporary uploads directory (with the database's
// uploads volume marker, tests/support/file-fence-fixtures.ts) before the dynamic imports that
// read it (local-file-storage.ts reads it when the module loads).
//
// The deletion queue is swept over every organization, so this file owns ProjectFileCleanup while
// it runs: every case starts from an empty table. That wipe is safe only because integration files
// run one at a time (vitest.integration.config.ts sets fileParallelism: false, and
// docs/ops/local-dev.md allows one test process at a time).
//
// Interleavings are forced, never timed: each run's backend PID is recorded from inside its own
// transaction through the store's test hooks, and a waiter is released only after
// waitForBlockedBy saw it blocked by the holder of the organization's logo lock.
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { FileStorage } from "@/lib/attachments/file-storage";
import type { LogoStoreHooks } from "@/lib/branding/logo-store";
import { prisma } from "@/lib/db";
import { sweepProjectFileCleanup } from "@/lib/projects/file-cleanup";
import {
  type BackupEmulator,
  backupEmulator,
  deleteBackupLease,
  testFenceProvider,
  testUploadsDir,
  trackFence,
} from "../support/file-fence-fixtures";
import { backendPid, type Deferred, deferred, waitForBlockedBy } from "../support/lock-wait";
import { jpegBytes, pngBytes, webpVp8xBytes } from "../support/logo-images";
import { seedOrgWithMembers } from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let store: typeof import("@/lib/branding/logo-store");
let storage: FileStorage;

beforeAll(async () => {
  dir = await testUploadsDir("aida-logo-store-");
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  store = await import("@/lib/branding/logo-store");
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

async function fileExists(orgId: string, key: string): Promise<boolean> {
  try {
    await stat(path.join(dir, orgId, key));
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return false;
    throw err;
  }
}

/** Every file stored under the organization's directory, sorted. */
async function storedKeys(orgId: string): Promise<string[]> {
  try {
    return (await readdir(path.join(dir, orgId))).sort();
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

async function logoRow(orgId: string): Promise<Record<string, unknown> | null> {
  const row = await prisma.setting.findFirst({
    where: { organizationId: orgId, key: "branding:logo" },
    select: { value: true },
  });
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
}

async function referencedKey(orgId: string): Promise<string | null> {
  const row = await logoRow(orgId);
  return row ? (row.storageKey as string) : null;
}

async function queueKeys(orgId: string): Promise<string[]> {
  const rows = await prisma.projectFileCleanup.findMany({
    where: { organizationId: orgId },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey).sort();
}

/**
 * The P10 invariant: the referenced key (if any) has its file, and every other stored key of the
 * organization has a queue row. Returns the referenced key.
 */
async function expectReferencedFileAndQueuedRest(orgId: string): Promise<string | null> {
  const referenced = await referencedKey(orgId);
  if (referenced !== null) expect(await fileExists(orgId, referenced)).toBe(true);
  const unreferenced = (await storedKeys(orgId)).filter((k) => k !== referenced);
  expect(await queueKeys(orgId)).toEqual(unreferenced);
  return referenced;
}

async function orgWithLogo(): Promise<{ orgId: string; key: string; version: string }> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  const result = await store.replaceLogo({ orgId, bytes: pngBytes(64, 32) });
  if (!result.ok) throw new Error(`replaceLogo refused: ${result.code}`);
  return { orgId, key: (await referencedKey(orgId)) as string, version: result.version };
}

async function sweep() {
  const tracked = trackFence(testFenceProvider(dir));
  const result = await sweepProjectFileCleanup({ client: prisma, fence: tracked.fence, storage });
  await tracked.allClosed();
  return result;
}

describe("logo store tracer", () => {
  it("replace with no logo set stores the file under the organization and writes branding:logo", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const bytes = pngBytes(64, 32);

    const result = await store.replaceLogo({ orgId, bytes });

    expect(result).toEqual({ ok: true, replaced: false, version: expect.any(String) });
    if (!result.ok) throw new Error("unreachable");
    expect(result.version).toMatch(/^[0-9a-f]{12}$/);
    const setting = await logoRow(orgId);
    expect(setting).toEqual({
      storageKey: expect.stringMatching(/^[0-9a-f]{32}\.png$/),
      mimeType: "image/png",
      version: result.version,
    });
    const key = setting?.storageKey as string;
    expect(await fileExists(orgId, key)).toBe(true);
    expect(Buffer.compare(await readFile(path.join(dir, orgId, key)), bytes)).toBe(0);
    expect(await queueKeys(orgId)).toEqual([]);

    const served = await store.readCurrentLogo({ orgId, version: result.version });
    expect(served?.mimeType).toBe("image/png");
    expect(served && Buffer.compare(served.bytes, bytes)).toBe(0);
  });
});

describe("replace and remove", () => {
  it("a refused upload (SVG, too many pixels) stores no file and writes no setting", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    expect(await store.replaceLogo({ orgId, bytes: Buffer.from("<svg/>") })).toEqual({
      ok: false,
      code: "svg",
    });
    expect(await store.replaceLogo({ orgId, bytes: pngBytes(1025, 1) })).toEqual({
      ok: false,
      code: "too_many_pixels",
    });
    expect(await storedKeys(orgId)).toEqual([]);
    expect(await logoRow(orgId)).toBeNull();
  });

  it("the key's extension and the stored MIME type come from the sniffed bytes", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    await store.replaceLogo({ orgId, bytes: jpegBytes(10, 10) });
    expect(await logoRow(orgId)).toMatchObject({
      storageKey: expect.stringMatching(/\.jpg$/),
      mimeType: "image/jpeg",
    });
    await store.replaceLogo({ orgId, bytes: webpVp8xBytes(10, 10) });
    expect(await logoRow(orgId)).toMatchObject({
      storageKey: expect.stringMatching(/\.webp$/),
      mimeType: "image/webp",
    });
  });

  it("replace writes a new key and version and commits a queue row for the previous key; the old file stays until the sweep", async () => {
    const { orgId, key: first, version: firstVersion } = await orgWithLogo();

    const result = await store.replaceLogo({ orgId, bytes: jpegBytes(40, 40) });

    expect(result).toEqual({ ok: true, replaced: true, version: expect.any(String) });
    if (!result.ok) throw new Error("unreachable");
    expect(result.version).not.toBe(firstVersion);
    const second = await referencedKey(orgId);
    expect(second).not.toBe(first);
    expect(await queueKeys(orgId)).toEqual([first]);
    expect(await fileExists(orgId, first)).toBe(true);
    expect(await fileExists(orgId, second as string)).toBe(true);
    // Only the current version is served.
    expect(await store.readCurrentLogo({ orgId, version: firstVersion })).toBeNull();
    expect(await store.readCurrentLogo({ orgId, version: result.version })).not.toBeNull();
  });

  it("a replace whose transaction fails leaves the setting, no queue row, and discards the new file", async () => {
    const { orgId, key: first } = await orgWithLogo();
    const failing: LogoStoreHooks = {
      afterLock: async () => {
        throw new Error("injected failure after the lock");
      },
    };

    await expect(
      store.replaceLogo({ orgId, bytes: pngBytes(8, 8), hooks: failing }),
    ).rejects.toThrow("injected failure after the lock");

    expect(await referencedKey(orgId)).toBe(first);
    expect(await queueKeys(orgId)).toEqual([]);
    expect(await storedKeys(orgId)).toEqual([first]);
  });

  it("remove deletes the setting and enqueues its key in one transaction; a second remove changes nothing", async () => {
    const { orgId, key, version } = await orgWithLogo();

    expect(await store.removeLogo({ orgId })).toEqual({ removed: true });
    expect(await logoRow(orgId)).toBeNull();
    expect(await queueKeys(orgId)).toEqual([key]);
    expect(await fileExists(orgId, key)).toBe(true);
    expect(await store.readCurrentLogo({ orgId, version })).toBeNull();

    expect(await store.removeLogo({ orgId })).toEqual({ removed: false });
    expect(await queueKeys(orgId)).toEqual([key]);
  });

  it("a remove whose transaction fails keeps the setting and writes no queue row", async () => {
    const { orgId, key } = await orgWithLogo();
    await expect(
      store.removeLogo({
        orgId,
        hooks: {
          afterLock: async () => {
            throw new Error("injected remove failure");
          },
        },
      }),
    ).rejects.toThrow("injected remove failure");
    expect(await referencedKey(orgId)).toBe(key);
    expect(await queueKeys(orgId)).toEqual([]);
  });
});

describe("fenced cleanup (U-11, U-12)", () => {
  it("fence held: while a backup holds the fence the sweep leaves the replaced file; after release it removes it and keeps the current one", async () => {
    const { orgId, key: first } = await orgWithLogo();
    await store.replaceLogo({ orgId, bytes: pngBytes(16, 16) });
    const current = (await referencedKey(orgId)) as string;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const backup = await backupEmulator();
    emulators.push(backup);
    await backup.holdFence();
    expect(await sweep()).toEqual({
      deleted: 0,
      missing: 0,
      failed: 0,
      skipped: "backup-archiving",
    });
    expect(await fileExists(orgId, first)).toBe(true);
    expect(await queueKeys(orgId)).toEqual([first]);

    await backup.release();
    expect(await sweep()).toMatchObject({ deleted: 1, failed: 0 });
    expect(await fileExists(orgId, first)).toBe(false);
    expect(await queueKeys(orgId)).toEqual([]);
    expect(await fileExists(orgId, current)).toBe(true);
    expect(await storedKeys(orgId)).toEqual([current]);
  });

  it("fence held: a removed logo's file stays while the fence is held and is removed after release", async () => {
    const { orgId, key } = await orgWithLogo();
    await store.removeLogo({ orgId });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const backup = await backupEmulator();
    emulators.push(backup);
    await backup.holdFence();
    expect((await sweep()).skipped).toBe("backup-archiving");
    expect(await fileExists(orgId, key)).toBe(true);

    await backup.release();
    expect(await sweep()).toMatchObject({ deleted: 1 });
    expect(await storedKeys(orgId)).toEqual([]);
    expect(await queueKeys(orgId)).toEqual([]);
  });
});

interface Parked {
  /** Resolves when the call reached the hook. */
  reached: Deferred<void>;
  /** Resolve to let the call continue. */
  release: Deferred<void>;
}

function parked(): Parked {
  return { reached: deferred(), release: deferred() };
}

/** Hooks that park a call after staging and after the lock, recording its backend PID. */
function interleavingHooks(afterStaged: Parked, afterLock: Parked, pid: Deferred<number>) {
  return {
    afterStaged: async () => {
      afterStaged.reached.resolve();
      await afterStaged.release.promise;
    },
    beforeLock: async (tx: Prisma.TransactionClient) => {
      pid.resolve(await backendPid(tx));
    },
    afterLock: async () => {
      afterLock.reached.resolve();
      await afterLock.release.promise;
    },
  } satisfies LogoStoreHooks;
}

describe("P10 interleavings", () => {
  for (const order of ["A then B", "B then A"] as const) {
    it(`both orders (${order}): two replaces parked after staging end with the setting on an existing file and a queue row for every other stored key`, async () => {
      const { orgId, key: original } = await orgWithLogo();
      const runs = {
        A: { staged: parked(), locked: parked(), pid: deferred<number>(), bytes: pngBytes(20, 20) },
        B: {
          staged: parked(),
          locked: parked(),
          pid: deferred<number>(),
          bytes: jpegBytes(30, 30),
        },
      };
      const calls = {
        A: store.replaceLogo({
          orgId,
          bytes: runs.A.bytes,
          hooks: interleavingHooks(runs.A.staged, runs.A.locked, runs.A.pid),
        }),
        B: store.replaceLogo({
          orgId,
          bytes: runs.B.bytes,
          hooks: interleavingHooks(runs.B.staged, runs.B.locked, runs.B.pid),
        }),
      };
      // Both files are stored before either transaction starts.
      await Promise.all([runs.A.staged.reached.promise, runs.B.staged.reached.promise]);
      expect(await storedKeys(orgId)).toHaveLength(3);

      const [first, second] = order === "A then B" ? (["A", "B"] as const) : (["B", "A"] as const);
      // The first call takes the organization's lock and parks holding it.
      runs[first].staged.release.resolve();
      await runs[first].locked.reached.promise;
      const holder = await runs[first].pid.promise;
      // The second call starts its transaction and waits for that lock.
      runs[second].staged.release.resolve();
      const waiter = await runs[second].pid.promise;
      await waitForBlockedBy(prisma, holder, [waiter]);
      expect(await queueKeys(orgId)).toEqual([]);

      runs[first].locked.release.resolve();
      runs[second].locked.release.resolve();
      const results = { A: await calls.A, B: await calls.B };
      expect(results[first]).toMatchObject({ ok: true, replaced: true });
      expect(results[second]).toMatchObject({ ok: true, replaced: true });

      // The later commit wins; its predecessor's key and the original key are queued.
      const referenced = await expectReferencedFileAndQueuedRest(orgId);
      const keys = await storedKeys(orgId);
      expect(keys).toHaveLength(3);
      expect(referenced).not.toBe(original);
      expect(await queueKeys(orgId)).toHaveLength(2);
      expect(await queueKeys(orgId)).toContain(original);
      const served = await store.readCurrentLogo({
        orgId,
        version: (results[second] as { version: string }).version,
      });
      expect(served && Buffer.compare(served.bytes, runs[second].bytes)).toBe(0);
    });
  }

  for (const holderIs of ["replace", "remove"] as const) {
    it(`remove during replace (${holderIs} holds the lock first): no referenced key is left without its file and every dereferenced key is queued`, async () => {
      const { orgId, key: original } = await orgWithLogo();
      const replaceRun = { staged: parked(), locked: parked(), pid: deferred<number>() };
      const removeRun = { locked: parked(), pid: deferred<number>() };
      const replacing = store.replaceLogo({
        orgId,
        bytes: pngBytes(50, 50),
        hooks: interleavingHooks(replaceRun.staged, replaceRun.locked, replaceRun.pid),
      });
      await replaceRun.staged.reached.promise;
      const removeHooks: LogoStoreHooks = {
        beforeLock: async (tx) => {
          removeRun.pid.resolve(await backendPid(tx));
        },
        afterLock: async () => {
          removeRun.locked.reached.resolve();
          await removeRun.locked.release.promise;
        },
      };

      let removing: Promise<{ removed: boolean }>;
      if (holderIs === "replace") {
        replaceRun.staged.release.resolve();
        await replaceRun.locked.reached.promise;
        removing = store.removeLogo({ orgId, hooks: removeHooks });
        await waitForBlockedBy(prisma, await replaceRun.pid.promise, [await removeRun.pid.promise]);
        replaceRun.locked.release.resolve();
        removeRun.locked.release.resolve();
      } else {
        removing = store.removeLogo({ orgId, hooks: removeHooks });
        await removeRun.locked.reached.promise;
        replaceRun.staged.release.resolve();
        await waitForBlockedBy(prisma, await removeRun.pid.promise, [await replaceRun.pid.promise]);
        removeRun.locked.release.resolve();
        replaceRun.locked.release.resolve();
      }
      const replaced = await replacing;
      const removed = await removing;

      expect(removed).toEqual({ removed: true });
      const referenced = await expectReferencedFileAndQueuedRest(orgId);
      expect(await storedKeys(orgId)).toHaveLength(2);
      if (holderIs === "replace") {
        // Replace committed first, then remove dereferenced the new logo: nothing is referenced.
        expect(replaced).toMatchObject({ ok: true, replaced: true });
        expect(referenced).toBeNull();
        expect(await queueKeys(orgId)).toHaveLength(2);
      } else {
        // Remove committed first, then the replace found no logo and set its own.
        expect(replaced).toMatchObject({ ok: true, replaced: false });
        expect(referenced).not.toBeNull();
        expect(await queueKeys(orgId)).toEqual([original]);
      }
    });
  }
});
