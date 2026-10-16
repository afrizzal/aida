// Phase 14 project file cleanup (contract section 12, K66, C10, C12), on a real Postgres through
// Testcontainers. The worker handler and the sweep are called directly; pg-boss is not started.
// UPLOADS_DIR is set to a fresh temporary directory before the dynamic imports that read it
// (local-file-storage.ts reads it when the module loads).
//
// The sweep is the one cross-organization reader of ProjectFileCleanup, so this file owns the
// table: every case starts from an empty table. Time-dependent cases inject `now`. The overlap
// case proves FOR UPDATE SKIP LOCKED with parking, backend PIDs and counts on a one-connection
// observer client (tests/support/lock-wait.ts); nothing here waits by time.
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { prisma } from "@/lib/db";
import { PROJECT_FILE_CLEANUP_MAX_ATTEMPTS } from "@/lib/projects/contract";
import { enqueueFileCleanupInTx, sweepProjectFileCleanup } from "@/lib/projects/file-cleanup";
import { backendPid, type Deferred, deferred } from "../support/lock-wait";
import { seedFileCleanup, seedOrgWithMembers } from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let storage: FileStorage;
let handler: typeof import("@/lib/worker/jobs/project-file-cleanup").projectFileCleanupHandler;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aida-project-cleanup-"));
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  storage = (await import("@/lib/attachments/local-file-storage")).localFileStorage;
  handler = (await import("@/lib/worker/jobs/project-file-cleanup")).projectFileCleanupHandler;
});

afterAll(async () => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  await rm(dir, { recursive: true, force: true });
});

// Review c-IN-01: this wipe, and the sweeps below that run over every organization, are safe only
// because integration files run one at a time (vitest.integration.config.ts sets
// fileParallelism: false, and docs/ops/local-dev.md allows one test process at a time). With files
// in parallel, or a second process on the same database, the wipe would delete outbox rows that
// project-delete.test.ts and project-comments-attachments.test.ts assert on, and the exact counts
// here would change.
beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM "ProjectFileCleanup"`;
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

async function newOrg(): Promise<string> {
  return (await seedOrgWithMembers(prisma, ["owner"])).orgId;
}

let keySeq = 0;
function newKey(ext = "txt"): string {
  keySeq += 1;
  return `${Date.now().toString(16)}${keySeq.toString(16).padStart(6, "0")}.${ext}`;
}

describe("project file cleanup tracer", () => {
  it("a cleanup row written in a committed transaction is swept by the worker handler, deleting the file and the row", async () => {
    const orgA = await newOrg();
    const key = newKey("pdf");
    await storage.save({ orgId: orgA, key, data: Buffer.from("tracer file") });
    expect(await fileExists(orgA, key)).toBe(true);

    const inserted = await prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, [key]));
    expect(inserted).toBe(1);

    const summary = await handler([]);
    expect(summary).toEqual({ deleted: 1, missing: 0, failed: 0 });
    expect(await fileExists(orgA, key)).toBe(false);
    expect(await prisma.projectFileCleanup.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it("enqueueFileCleanupInTx called twice for the same key leaves one row", async () => {
    const orgA = await newOrg();
    const key = newKey();
    const first = await prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, [key]));
    const second = await prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, [key, key]));
    expect(first).toBe(1);
    expect(second).toBe(0);
    const rows = await prisma.projectFileCleanup.findMany({
      where: { organizationId: orgA },
      select: { storageKey: true, attempts: true },
    });
    expect(rows).toEqual([{ storageKey: key, attempts: 0 }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Edge cases (Task 2): injected clock, FileStorage stubs and a local one-connection observer.

const T0 = new Date("2031-03-01T00:00:00.000Z");
const MINUTE = 60_000;

const pendingDeferreds: Deferred<void>[] = [];
let observer: { client: PrismaClient; close: () => Promise<void> } | null = null;

/** A one-connection client for pg_stat_activity and pg_blocking_pids reads (race harness shape). */
function createObserverClient(): { client: PrismaClient; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    client,
    close: async () => {
      await client.$disconnect();
      await pool.end();
    },
  };
}

function trackedDeferred(): Deferred<void> {
  const d = deferred<void>();
  pendingDeferreds.push(d);
  return d;
}

afterEach(async () => {
  for (const d of pendingDeferreds.splice(0)) d.resolve();
  if (observer) {
    const current = observer;
    observer = null;
    await current.close();
  }
  vi.restoreAllMocks();
});

function stubStorage(onDelete: (key: string, orgId: string) => Promise<void>): FileStorage {
  return {
    async save() {
      throw new Error("stub storage: save is not used");
    },
    async read() {
      throw new Error("stub storage: read is not used");
    },
    async delete({ orgId, key }) {
      await onDelete(key, orgId);
    },
  };
}

function codedError(code: string, message = "storage refused"): Error {
  return Object.assign(new Error(message), { code });
}

async function cleanupRow(orgId: string, storageKey: string) {
  return prisma.projectFileCleanup.findUnique({
    where: { organizationId_storageKey: { organizationId: orgId, storageKey } },
    select: { attempts: true, lastErrorCode: true, nextAttemptAt: true },
  });
}

describe("project file cleanup sweep edge cases", () => {
  it("a row whose file does not exist (ENOENT) is removed and counted as missing", async () => {
    const orgA = await newOrg();
    const key = newKey();
    await seedFileCleanup(prisma, orgA, key, { nextAttemptAt: T0 });
    expect(await fileExists(orgA, key)).toBe(false);

    const result = await sweepProjectFileCleanup({ client: prisma, storage, now: T0 });
    expect(result).toEqual({ deleted: 0, missing: 1, failed: 0 });
    expect(await cleanupRow(orgA, key)).toBeNull();
  });

  it("an EACCES failure keeps the row with backoff min(2^attempts, 60) minutes", async () => {
    const orgA = await newOrg();
    const key = newKey();
    await seedFileCleanup(prisma, orgA, key, { nextAttemptAt: T0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = stubStorage(async () => {
      throw codedError("EACCES");
    });

    // First failure: attempts 1, one minute after the injected now.
    expect(await sweepProjectFileCleanup({ client: prisma, storage: failing, now: T0 })).toEqual({
      deleted: 0,
      missing: 0,
      failed: 1,
    });
    expect(await cleanupRow(orgA, key)).toEqual({
      attempts: 1,
      lastErrorCode: "EACCES",
      nextAttemptAt: new Date(T0.getTime() + MINUTE),
    });

    // A sweep before nextAttemptAt skips the row.
    const early = new Date(T0.getTime() + 30_000);
    expect(await sweepProjectFileCleanup({ client: prisma, storage: failing, now: early })).toEqual(
      { deleted: 0, missing: 0, failed: 0 },
    );
    expect((await cleanupRow(orgA, key))?.attempts).toBe(1);

    // Failures 2 to 8: the delay doubles from the attempts before the failure, capped at 60.
    const expectedDelays = [2, 4, 8, 16, 32, 60, 60];
    let now = new Date(T0.getTime() + MINUTE);
    for (const [index, delay] of expectedDelays.entries()) {
      expect(await sweepProjectFileCleanup({ client: prisma, storage: failing, now })).toEqual({
        deleted: 0,
        missing: 0,
        failed: 1,
      });
      const row = await cleanupRow(orgA, key);
      const attempts = index + 2;
      expect(row).toEqual({
        attempts,
        lastErrorCode: "EACCES",
        nextAttemptAt: new Date(now.getTime() + delay * MINUTE),
      });
      if (attempts === 3) expect(row?.nextAttemptAt).toEqual(new Date(now.getTime() + 4 * MINUTE));
      now = row?.nextAttemptAt as Date;
    }
    // After 7 failures (and the 8th) the delay stays at 60 minutes.
    expect((await cleanupRow(orgA, key))?.attempts).toBe(8);

    // A later success removes the row.
    const ok = stubStorage(async () => {});
    expect(await sweepProjectFileCleanup({ client: prisma, storage: ok, now })).toEqual({
      deleted: 1,
      missing: 0,
      failed: 0,
    });
    expect(await cleanupRow(orgA, key)).toBeNull();
  });

  it("two overlapping sweeps never handle the same row (FOR UPDATE SKIP LOCKED): parked sweep 1 holds 10 locks, sweep 2 deletes the other 20 without waiting", async () => {
    const orgA = await newOrg();
    const keys: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const key = newKey();
      keys.push(key);
      await seedFileCleanup(prisma, orgA, key, { nextAttemptAt: T0 });
    }
    observer = createObserverClient();
    const observerClient = observer.client;

    const deletions = new Map<string, number>();
    const countDeletion = (key: string) => deletions.set(key, (deletions.get(key) ?? 0) + 1);

    // Sweep 1: limit 10; parks inside its transaction on its first storage call.
    const parked = trackedDeferred();
    const release = trackedDeferred();
    let sweep1Pid = 0;
    let sweep1Locked: string[] = [];
    let sweep1FirstCall = true;
    const sweep1 = sweepProjectFileCleanup({
      client: prisma,
      now: T0,
      limit: 10,
      storage: stubStorage(async (key) => {
        countDeletion(key);
        if (sweep1FirstCall) {
          sweep1FirstCall = false;
          parked.resolve();
          await release.promise;
        }
      }),
      onLocked: async (tx, lockedStorageKeys) => {
        sweep1Pid = await backendPid(tx);
        sweep1Locked = [...lockedStorageKeys];
      },
    });
    await Promise.race([
      parked.promise,
      sweep1.then(() => {
        throw new Error("sweep 1 finished without parking");
      }),
    ]);

    expect(sweep1Pid).toBeGreaterThan(0);
    expect(sweep1Locked).toHaveLength(10);
    const sweep1State = await observerClient.$queryRaw<{ state: string | null }[]>`
      SELECT state FROM pg_stat_activity WHERE pid = ${sweep1Pid}::int
    `;
    expect(["idle in transaction", "active"]).toContain(sweep1State[0]?.state);

    // Sweep 2: limit 100, its own counting stub; completes while sweep 1 is still parked.
    // Review c-IN-03: while sweep 2 runs, the observer checks without pause for any backend that
    // sweep 1 blocks. A SKIP LOCKED regression makes sweep 2 wait on sweep 1's rows; the watchdog
    // then fails at once naming the blocked PID, instead of the test hanging until its timeout.
    let sweep2Pid = 0;
    let sweep2Settled = false;
    let watchdogChecks = 0;
    const sweep2Seen: string[] = [];
    const sweep2Run = sweepProjectFileCleanup({
      client: prisma,
      now: T0,
      limit: 100,
      storage: stubStorage(async (key) => {
        sweep2Seen.push(key);
        countDeletion(key);
      }),
      onLocked: async (tx) => {
        sweep2Pid = await backendPid(tx);
      },
    }).finally(() => {
      sweep2Settled = true;
    });
    const blockedBehindSweep1 = (async (): Promise<void> => {
      while (!sweep2Settled) {
        const rows = await observerClient.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE ${sweep1Pid}::int = ANY(pg_blocking_pids(pid))
        `;
        watchdogChecks++;
        if (rows.length > 0) {
          release.resolve();
          throw new Error(
            `sweep 2 blocked behind sweep 1: PID(s) ${rows.map((r) => Number(r.pid)).join(", ")} wait on ${sweep1Pid}`,
          );
        }
      }
    })();
    const sweep2 = await Promise.race([sweep2Run, blockedBehindSweep1.then(() => sweep2Run)]);
    await blockedBehindSweep1;
    expect(watchdogChecks).toBeGreaterThan(0);
    expect(sweep2).toEqual({ deleted: 20, missing: 0, failed: 0 });
    expect(sweep2Pid).toBeGreaterThan(0);
    expect(sweep2Pid).not.toBe(sweep1Pid);
    const notLockedBySweep1 = keys.filter((key) => !sweep1Locked.includes(key));
    expect([...sweep2Seen].sort()).toEqual([...notLockedBySweep1].sort());
    expect(sweep2Seen.some((key) => sweep1Locked.includes(key))).toBe(false);

    // Release sweep 1: it deletes its own 10.
    release.resolve();
    expect(await sweep1).toEqual({ deleted: 10, missing: 0, failed: 0 });
    expect(deletions.size).toBe(30);
    for (const key of keys) expect(deletions.get(key)).toBe(1);
    expect(await prisma.projectFileCleanup.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it("rows of organization A and B are deleted under their own organization's directory", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const shared = newKey("png");
    const onlyB = newKey("pdf");
    await storage.save({ orgId: orgA, key: shared, data: Buffer.from("a") });
    await storage.save({ orgId: orgB, key: shared, data: Buffer.from("b") });
    await storage.save({ orgId: orgB, key: onlyB, data: Buffer.from("b2") });
    await seedFileCleanup(prisma, orgA, shared, { nextAttemptAt: T0 });
    await seedFileCleanup(prisma, orgB, onlyB, { nextAttemptAt: T0 });

    const result = await sweepProjectFileCleanup({ client: prisma, storage, now: T0 });
    expect(result).toEqual({ deleted: 2, missing: 0, failed: 0 });
    expect(await fileExists(orgA, shared)).toBe(false);
    expect(await fileExists(orgB, shared)).toBe(true);
    expect(await fileExists(orgB, onlyB)).toBe(false);
  });

  it("a key that does not match the safe key shape cannot be queued (CHECK of plan 14-02)", async () => {
    const orgA = await newOrg();
    await expect(seedFileCleanup(prisma, orgA, "../escape.txt")).rejects.toThrow();
    await expect(
      prisma.$transaction((tx) => enqueueFileCleanupInTx(tx, orgA, ["a/b.txt"])),
    ).rejects.toThrow(/ProjectFileCleanup_storage_key_check/);
    expect(await prisma.projectFileCleanup.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it("a row whose nextAttemptAt is in the future is not touched, and an empty table returns zeros", async () => {
    expect(await sweepProjectFileCleanup({ client: prisma, storage, now: T0 })).toEqual({
      deleted: 0,
      missing: 0,
      failed: 0,
    });
    const orgA = await newOrg();
    const key = newKey();
    await storage.save({ orgId: orgA, key, data: Buffer.from("later") });
    await seedFileCleanup(prisma, orgA, key, { nextAttemptAt: new Date(T0.getTime() + MINUTE) });

    expect(await sweepProjectFileCleanup({ client: prisma, storage, now: T0 })).toEqual({
      deleted: 0,
      missing: 0,
      failed: 0,
    });
    expect(await fileExists(orgA, key)).toBe(true);
    expect(await cleanupRow(orgA, key)).toEqual({
      attempts: 0,
      lastErrorCode: null,
      nextAttemptAt: new Date(T0.getTime() + MINUTE),
    });
  });

  it("the failure log carries the key and the error code and no file content", async () => {
    const orgA = await newOrg();
    const key = newKey();
    const marker = "FILE-CONTENT-MARKER-7f3a";
    await seedFileCleanup(prisma, orgA, key, { nextAttemptAt: T0 });
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    const failing = stubStorage(async () => {
      throw codedError("EACCES", `cannot unlink: ${marker}`);
    });

    await sweepProjectFileCleanup({ client: prisma, storage: failing, now: T0 });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(key);
    expect(logged[0]).toContain("EACCES");
    expect(logged.join("\n")).not.toContain(marker);
  });
});

describe("b-IN-05: bounded sweep", () => {
  it("a permanent failure stops after PROJECT_FILE_CLEANUP_MAX_ATTEMPTS attempts and stays in the row as a report", async () => {
    const orgA = await newOrg();
    const key = newKey();
    await seedFileCleanup(prisma, orgA, key, {
      nextAttemptAt: T0,
      attempts: PROJECT_FILE_CLEANUP_MAX_ATTEMPTS - 1,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const failing = stubStorage(async () => {
      calls += 1;
      throw codedError("EACCES");
    });
    expect(await sweepProjectFileCleanup({ client: prisma, storage: failing, now: T0 })).toEqual({
      deleted: 0,
      missing: 0,
      failed: 1,
    });
    expect(await cleanupRow(orgA, key)).toMatchObject({
      attempts: PROJECT_FILE_CLEANUP_MAX_ATTEMPTS,
      lastErrorCode: "EACCES",
    });
    // Much later: the row is no longer selected and stays as it is.
    const later = new Date(T0.getTime() + 30 * 24 * 60 * MINUTE);
    expect(await sweepProjectFileCleanup({ client: prisma, storage: failing, now: later })).toEqual(
      { deleted: 0, missing: 0, failed: 0 },
    );
    expect(calls).toBe(1);
    expect(await cleanupRow(orgA, key)).toMatchObject({
      attempts: PROJECT_FILE_CLEANUP_MAX_ATTEMPTS,
      lastErrorCode: "EACCES",
    });
  });

  it("a storage delete that does not settle within the I/O budget is a failure, and the run ends inside the budget", async () => {
    const orgA = await newOrg();
    const stuck = newKey();
    const next = newKey();
    await seedFileCleanup(prisma, orgA, stuck, { nextAttemptAt: T0 });
    await seedFileCleanup(prisma, orgA, next, { nextAttemptAt: T0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const touched: string[] = [];
    const hanging = stubStorage((k) => {
      touched.push(k);
      return new Promise<void>(() => {});
    });
    expect(
      await sweepProjectFileCleanup({ client: prisma, storage: hanging, now: T0, ioBudgetMs: 300 }),
    ).toEqual({ deleted: 0, missing: 0, failed: 1 });
    expect(touched).toHaveLength(1);
    const first = touched[0] as string;
    const other = first === stuck ? next : stuck;
    expect(await cleanupRow(orgA, first)).toMatchObject({
      attempts: 1,
      lastErrorCode: "ETIMEDOUT",
    });
    expect(await cleanupRow(orgA, other)).toMatchObject({ attempts: 0, lastErrorCode: null });
  });
});
