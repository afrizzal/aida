// Phase 9 plan 09-13 (AIDA-33, AIDA-38): the backup core under failure, retention, overlap and a
// restore in progress. The real script, scripts/backup/aida-backup.sh, runs in rule-J labelled
// pgvector/pgvector:pg16 containers (tests/integration/support/backup-runner.ts) against this
// run's Testcontainers Postgres and repo-local temporary directories (D-06).
//
// Like backup-consistency.test.ts, this file owns an isolated database on the same server: the
// script dumps its whole database, and a dump of the shared database would reference other
// files' attachments. Every case gets its own uploads directory (with the database identity's
// marker) and its own backups directory, and ends with no `backup:lease` row, no fence lock, no
// fence session and no `.restore-lock` (afterEach).
//
// Failure causes are real (review P11): a held ACCESS EXCLUSIVE lock past the dump's lock
// timeout, a directory uid 1000 cannot read, a read-only backups mount, a closed database port.
// Each case asserts its own exit code, `backup:lastRun`, status-unrecorded file, stderr line,
// published set count and leftover temporary directories (review R4).
//
// One test process at a time (vitest.integration.config.ts, fileParallelism: false).
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  type BackupRun,
  type BackupRunner,
  makeTestDir,
  type PausePoint,
  type RunResult,
  SET_ID_PATTERN,
  startBackupRunner,
  TEST_TMP_ROOT,
} from "./support/backup-runner";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";

type FenceFixtures = typeof import("../support/file-fence-fixtures");

const CASE_TIMEOUT = 240_000;
const POOL_KEY = Symbol.for("aida.db.pool");
const PRISMA_KEY = Symbol.for("aida.db.prisma");
const BACKUP_FENCE = "aida-backup-fence";

let iso: IsolatedDatabase | null = null;
let prisma: PrismaClient;
let fence: FenceFixtures;
let runner: BackupRunner | null = null;
let runnerOptions: Parameters<typeof startBackupRunner>[0];
let dbPassword = "";
let testRoot = "";
let uploadsRoot = "";
let backupsRoot = "";
let pauseRoot = "";
const savedEnv: Record<string, string | undefined> = {};
const savedGlobals: { pool?: unknown; prisma?: unknown } = {};

beforeAll(async () => {
  testRoot = await makeTestDir(TEST_TMP_ROOT, "backup-failures-");
  uploadsRoot = await makeTestDir(testRoot, "uploads-");
  backupsRoot = await makeTestDir(testRoot, "backups-");
  pauseRoot = await makeTestDir(testRoot, "pause-");

  iso = await createIsolatedDatabase();
  const url = new URL(iso.url);
  savedEnv.DATABASE_URL = process.env.DATABASE_URL;
  savedEnv.UPLOADS_DIR = process.env.UPLOADS_DIR;
  process.env.DATABASE_URL = iso.url;
  process.env.UPLOADS_DIR = uploadsRoot;
  const g = globalThis as unknown as Record<symbol, unknown>;
  savedGlobals.pool = g[POOL_KEY];
  savedGlobals.prisma = g[PRISMA_KEY];
  delete g[POOL_KEY];
  delete g[PRISMA_KEY];
  ({ prisma } = await import("@/lib/db"));
  const current = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  expect(current[0]?.db).toBe(url.pathname.slice(1));
  fence = await import("../support/file-fence-fixtures");

  dbPassword = decodeURIComponent(url.password);
  runnerOptions = {
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: dbPassword,
    uploadsRoot,
    backupsRoot,
    pauseRoot,
  };
  runner = await startBackupRunner(runnerOptions);
}, 300_000);

afterAll(async () => {
  await runner?.stop();
  const g = globalThis as unknown as Record<symbol, unknown>;
  try {
    await prisma?.$disconnect();
    await (g[POOL_KEY] as { end(): Promise<void> } | undefined)?.end();
  } finally {
    g[POOL_KEY] = savedGlobals.pool;
    g[PRISMA_KEY] = savedGlobals.prisma;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await iso?.drop();
    if (testRoot) await rm(testRoot, { recursive: true, force: true });
  }
}, 120_000);

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key IN ('backup:lease', 'backup:lastRun')`;
});

/** Every run a case started; afterEach lets each one finish before it checks for leftovers. */
const openRuns: BackupRun[] = [];

afterEach(async () => {
  for (const run of openRuns.splice(0)) {
    await run.releaseAll();
    await run.done;
  }
  // Shared database hygiene: no case leaves a lease, a fence lock, a fence session or a
  // restore lock of its own behind.
  const leases = await prisma.systemSetting.count({ where: { key: "backup:lease" } });
  const locks = await fence.fenceLocks();
  const sessions = await fence.backendsNamed(BACKUP_FENCE);
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = 'backup:lease'`;
  expect({ leases, locks, sessions }).toEqual({ leases: 0, locks: [], sessions: [] });
  expect(await findRestoreLocks(backupsRoot)).toEqual([]);
});

async function findRestoreLocks(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".restore-lock") found.push(path.join(dir, entry.name));
    else if (entry.isDirectory())
      found.push(...(await findRestoreLocks(path.join(dir, entry.name))));
  }
  return found;
}

function activeRunner(): BackupRunner {
  if (!runner) throw new Error("no runner");
  return runner;
}

// ---------------------------------------------------------------------------------------------
// Case directories and inspection

interface Case {
  uploads: string;
  backups: string;
  uploadsName: string;
  backupsName: string;
}

async function newCase(): Promise<Case> {
  const uploads = await makeTestDir(uploadsRoot, "u-");
  const backups = await makeTestDir(backupsRoot, "b-");
  const identity = await fence.testVolumeIdentity();
  await writeFile(path.join(uploads, ".aida-uploads-volume"), `${identity}\n`, { flag: "wx" });
  return {
    uploads,
    backups,
    uploadsName: path.basename(uploads),
    backupsName: path.basename(backups),
  };
}

async function entries(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

async function publishedSets(c: Case): Promise<string[]> {
  return (await entries(c.backups)).filter((name) => SET_ID_PATTERN.test(name));
}

async function tmpDirs(c: Case): Promise<string[]> {
  return (await entries(c.backups)).filter((name) => name.startsWith(".tmp-"));
}

async function lastRunRaw(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "backup:lastRun" } });
  return row ? row.value : null;
}

async function lastRun(): Promise<Record<string, unknown> | null> {
  const raw = await lastRunRaw();
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

function runIn(
  c: Case,
  opts: {
    pauseAt?: readonly PausePoint[];
    env?: Record<string, string>;
    on?: BackupRunner;
    closedDatabasePort?: boolean;
  } = {},
): BackupRun {
  const run = (opts.on ?? activeRunner()).runBackup({
    uploads: c.uploadsName,
    backups: c.backupsName,
    pauseAt: opts.pauseAt,
    env: opts.env,
    closedDatabasePort: opts.closedDatabasePort,
  });
  openRuns.push(run);
  return run;
}

/** Waits until the wall clock is in a later second than now, so set ids order by run. */
async function nextSecond(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1_100));
}

/** A valid set id at a fixed early time, for planted entries that must sort as oldest. */
function plantedSetId(n: number): string {
  return `20200101T0000${String(n).padStart(2, "0")}Z-${(0xa00000 + n).toString(16)}`;
}

async function plantDir(c: Case, name: string, files: Record<string, string> = {}): Promise<void> {
  const dir = path.join(c.backups, name);
  await mkdir(dir);
  await chmod(dir, 0o777);
  for (const [file, text] of Object.entries(files)) {
    await writeFile(path.join(dir, file), text);
    await chmod(path.join(dir, file), 0o666);
  }
}

function expectSucceeded(result: RunResult): string {
  expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  const match = /\[backup\] backup succeeded: (\S+)/.exec(result.stdout);
  expect(match, result.stdout).not.toBeNull();
  return (match as RegExpExecArray)[1] as string;
}

// ---------------------------------------------------------------------------------------------
// Task 1: retention through fenced_action (D-03, P6, Q8)

describe("retention (D-03)", () => {
  it(
    "retention keeps the 7 newest successful sets, removes stale temporary directories, and leaves every other entry alone",
    async () => {
      const c = await newCase();
      const staleId = plantedSetId(1);
      const unrecordedId = plantedSetId(2);
      await plantDir(c, `.tmp-${staleId}`, { holder: `${plantedSetId(3)}\n` });
      await plantDir(c, "keep-me", { "note.txt": "not a set\n" });
      await plantDir(c, ".restore-staging-x", { "staged.txt": "restore staging\n" });
      const unrecordedFile = `status-unrecorded-${unrecordedId}.json`;
      const unrecordedText = `${JSON.stringify({
        finishedAt: "2020-01-01T00:00:02.000Z",
        result: "failed",
        setId: null,
        category: "unknown",
      })}\n`;
      await writeFile(path.join(c.backups, unrecordedFile), unrecordedText);

      const env = { BACKUP_RETENTION: "7" };
      const created: string[] = [];
      for (let i = 0; i < 9; i += 1) {
        if (i === 5) {
          // One failed run in the middle: a held ACCESS EXCLUSIVE lock past the dump timeout.
          const failed = await prisma.$transaction(
            async (tx) => {
              await tx.$executeRawUnsafe('LOCK TABLE "Attachment" IN ACCESS EXCLUSIVE MODE');
              return runIn(c, { env: { ...env, BACKUP_DUMP_LOCK_TIMEOUT: "2s" } }).done;
            },
            { timeout: 120_000, maxWait: 10_000 },
          );
          expect(failed.exitCode, failed.stdout).toBe(2);
          expect(failed.stdout).toContain("[backup] backup failed: dump");
          await nextSecond();
        }
        const setId = expectSucceeded(await runIn(c, { env }).done);
        created.push(setId);
        await nextSecond();
      }

      expect([...created].sort()).toEqual(created);
      expect(await publishedSets(c)).toEqual(created.slice(2));
      expect(await tmpDirs(c)).toEqual([]);
      expect(await entries(c.backups)).toEqual(
        [...created.slice(2), "keep-me", ".restore-staging-x", unrecordedFile].sort(),
      );
      expect(await readFile(path.join(c.backups, unrecordedFile), "utf8")).toBe(unrecordedText);
      expect(await entries(path.join(c.backups, "keep-me"))).toEqual(["note.txt"]);
      expect(await entries(path.join(c.backups, ".restore-staging-x"))).toEqual(["staged.txt"]);
      expect(await lastRun()).toEqual({
        finishedAt: expect.any(String),
        result: "succeeded",
        setId: created[8],
        category: null,
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "retention setting: BACKUP_RETENTION 0 fails the run with category unknown before the fence, touching no set",
    async () => {
      const c = await newCase();
      const kept = plantedSetId(4);
      await plantDir(c, kept, { "manifest.json": "{}\n" });
      const result = await runIn(c, { env: { BACKUP_RETENTION: "0" } }).done;
      expect(result.exitCode, result.stdout).toBe(2);
      expect(result.stdout).toContain("[backup] invalid setting");
      expect(result.stdout).toContain("[backup] backup failed: unknown");
      expect(await entries(c.backups)).toEqual([kept]);
      expect(await lastRun()).toEqual({
        finishedAt: expect.any(String),
        result: "failed",
        setId: null,
        category: "unknown",
      });
      expect(await fence.backendsNamed(BACKUP_FENCE)).toEqual([]);
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// Task 2: failure categories with real causes, status ownership and the unrecorded-status
// fallback (D-04, P6, P11, Q8, R4)

const UNRECORDED_LINE = /^AIDA_BACKUP_STATUS_UNRECORDED (\{.*\})$/;
const UNRECORDED_FILE = /^status-unrecorded-([0-9]{8}T[0-9]{6}Z-[0-9a-f]{6})\.json$/;
const STATUS_KEYS = ["finishedAt", "result", "setId", "category"];
const FINISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The JSON of every AIDA_BACKUP_STATUS_UNRECORDED line on stderr. */
function unrecordedLines(result: RunResult): Record<string, unknown>[] {
  return result.stderr
    .split("\n")
    .map((line) => UNRECORDED_LINE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => JSON.parse(m[1] as string) as Record<string, unknown>);
}

async function unrecordedFiles(c: Case): Promise<string[]> {
  return (await entries(c.backups)).filter((name) => UNRECORDED_FILE.test(name));
}

/** A status record written by an earlier run, to prove a later run leaves it unchanged. */
const EARLIER_STATUS = JSON.stringify({
  finishedAt: "2026-01-01T00:00:00.000Z",
  result: "succeeded",
  setId: "20260101T000000Z-0a0b0c",
  category: null,
});

async function seedEarlierStatus(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
    VALUES (gen_random_uuid()::text, 'backup:lastRun', ${EARLIER_STATUS}, now())`;
}

/** Runs one backup while this test holds ACCESS EXCLUSIVE on "Attachment" (the dump cause). */
async function runWithAttachmentLocked(
  c: Case,
  env: Record<string, string> = {},
): Promise<RunResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "Attachment" IN ACCESS EXCLUSIVE MODE');
      return runIn(c, { env: { BACKUP_DUMP_LOCK_TIMEOUT: "2s", ...env } }).done;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/** Output that names no password and no path beyond the set id (D-04, T-09-19a). */
function expectPrivateOutput(c: Case, result: RunResult): void {
  const text = `${result.stdout}\n${result.stderr}`;
  expect(dbPassword.length).toBeGreaterThan(0);
  expect(text).not.toContain(dbPassword);
  for (const fragment of [
    "/backups",
    "/data/uploads",
    "/opt/aida-backup",
    "/pause",
    "/tmp",
    ".tmp-",
    c.backupsName,
    c.uploadsName,
    "127.0.0.1",
  ]) {
    expect(text).not.toContain(fragment);
  }
  expect(text).not.toMatch(/postgres(ql)?:\/\//);
  expect(text).not.toMatch(/ERROR|FATAL|denied|No such file/);
  for (const line of result.stdout.split("\n").filter((l) => l !== "")) {
    expect(line).toMatch(/^\[backup\] /);
  }
}

let readOnly: BackupRunner | null = null;

/** A second runner with the backups root mounted read-only (started once, stopped in afterAll). */
async function readOnlyRunner(): Promise<BackupRunner> {
  readOnly ??= await startBackupRunner({ ...runnerOptions, backupsReadOnly: true });
  return readOnly;
}

afterAll(async () => {
  await readOnly?.stop();
}, 120_000);

describe("failure categories with real causes (P11)", () => {
  it(
    "dump: with ACCESS EXCLUSIVE held on Attachment past BACKUP_DUMP_LOCK_TIMEOUT 2s the run exits 2 and records failed, category dump",
    async () => {
      const c = await newCase();
      const result = await runWithAttachmentLocked(c);
      expect(result.exitCode, result.stdout).toBe(2);
      expect(result.stdout).toContain("[backup] backup failed: dump");
      expect(await lastRun()).toEqual({
        finishedAt: expect.stringMatching(FINISHED_AT),
        result: "failed",
        setId: null,
        category: "dump",
      });
      expect(await unrecordedFiles(c)).toEqual([]);
      expect(unrecordedLines(result)).toEqual([]);
      expect(result.stderr).toBe("");
      expect(await publishedSets(c)).toEqual([]);
      expect(await tmpDirs(c)).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "archive: an organization directory that uid 1000 cannot read makes the run exit 2 and record failed, category archive",
    async () => {
      const c = await newCase();
      const r = activeRunner();
      expect((await r.exec(["id", "-u"])).stdout.trim()).toBe("1000");
      const dir = path.join(c.uploads, "org-unreadable");
      await mkdir(dir);
      await writeFile(path.join(dir, "abc123.txt"), "unreadable\n");
      await chmod(dir, 0o000);
      try {
        // The real cause, seen from inside the runner: uid 1000 cannot list the directory.
        const probe = await r.exec([
          "sh",
          "-c",
          'ls -- "$1" >/dev/null 2>&1',
          "sh",
          `/data/uploads/${c.uploadsName}/org-unreadable`,
        ]);
        expect(probe.exitCode).not.toBe(0);
        const result = await runIn(c).done;
        expect(result.exitCode, result.stdout).toBe(2);
        expect(result.stdout).toContain("[backup] backup failed: archive");
        expect(await lastRun()).toEqual({
          finishedAt: expect.stringMatching(FINISHED_AT),
          result: "failed",
          setId: null,
          category: "archive",
        });
        expect(await unrecordedFiles(c)).toEqual([]);
        expect(unrecordedLines(result)).toEqual([]);
        expect(result.stderr).toBe("");
        expect(await publishedSets(c)).toEqual([]);
        expect(await tmpDirs(c)).toEqual([]);
      } finally {
        await chmod(dir, 0o755);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "storage: with the backups directory mounted read-only the run exits 2, records failed, category storage in the database, and writes no unrecorded file",
    async () => {
      const c = await newCase();
      const ro = await readOnlyRunner();
      const probe = await ro.exec([
        "sh",
        "-c",
        ': >"$1/.probe" 2>/dev/null',
        "sh",
        `/backups/${c.backupsName}`,
      ]);
      expect(probe.exitCode).not.toBe(0);
      const result = await runIn(c, { on: ro }).done;
      expect(result.exitCode, result.stdout).toBe(2);
      expect(result.stdout).toContain("[backup] backup failed: storage");
      expect(await lastRun()).toEqual({
        finishedAt: expect.stringMatching(FINISHED_AT),
        result: "failed",
        setId: null,
        category: "storage",
      });
      expect(await unrecordedFiles(c)).toEqual([]);
      expect(unrecordedLines(result)).toEqual([]);
      expect(result.stderr).toBe("");
      expect(await publishedSets(c)).toEqual([]);
      expect(await tmpDirs(c)).toEqual([]);
      expect(await entries(c.backups)).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "database unreachable: with PGPORT at a closed port the run exits 5, leaves backup:lastRun unchanged, prints the stderr line and writes status-unrecorded-<setId>.json with the four keys",
    async () => {
      const c = await newCase();
      await seedEarlierStatus();
      const result = await runIn(c, { closedDatabasePort: true }).done;
      expect(result.exitCode, result.stdout).toBe(5);
      expect(result.stdout).toContain("[backup] database not reachable");
      expect(result.stdout).toContain("[backup] backup status not recorded");
      expect(await lastRunRaw()).toBe(EARLIER_STATUS);
      const lines = unrecordedLines(result);
      expect(lines).toEqual([
        {
          finishedAt: expect.stringMatching(FINISHED_AT),
          result: "failed",
          setId: null,
          category: "unknown",
        },
      ]);
      expect(Object.keys(lines[0] ?? {})).toEqual(STATUS_KEYS);
      expect(result.stderr.split("\n").filter((l) => l !== "")).toHaveLength(1);
      const files = await unrecordedFiles(c);
      expect(files).toHaveLength(1);
      const recorded = JSON.parse(await readFile(path.join(c.backups, files[0] as string), "utf8"));
      expect(Object.keys(recorded)).toEqual(STATUS_KEYS);
      expect(recorded).toEqual(lines[0]);
      expect(await publishedSets(c)).toEqual([]);
      expect(await tmpDirs(c)).toEqual([]);
      expect(await entries(c.backups)).toEqual(files);
    },
    CASE_TIMEOUT,
  );

  it(
    "both unwritable: with the database unreachable and the backups directory read-only the run prints the stderr line, writes no file and exits 5",
    async () => {
      const c = await newCase();
      await seedEarlierStatus();
      const ro = await readOnlyRunner();
      const result = await runIn(c, { on: ro, closedDatabasePort: true }).done;
      expect(result.exitCode, result.stdout).toBe(5);
      expect(result.stdout).toContain("[backup] backup status record file not written");
      expect(await lastRunRaw()).toBe(EARLIER_STATUS);
      const lines = unrecordedLines(result);
      expect(lines).toEqual([
        {
          finishedAt: expect.stringMatching(FINISHED_AT),
          result: "failed",
          setId: null,
          category: "unknown",
        },
      ]);
      expect(Object.keys(lines[0] ?? {})).toEqual(STATUS_KEYS);
      expect(await unrecordedFiles(c)).toEqual([]);
      expect(await publishedSets(c)).toEqual([]);
      expect(await entries(c.backups)).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "a later successful run leaves the earlier status-unrecorded file in place, unchanged",
    async () => {
      const c = await newCase();
      const failed = await runIn(c, { closedDatabasePort: true }).done;
      expect(failed.exitCode, failed.stdout).toBe(5);
      const files = await unrecordedFiles(c);
      expect(files).toHaveLength(1);
      const before = await readFile(path.join(c.backups, files[0] as string), "utf8");

      await nextSecond();
      const result = await runIn(c, { env: { BACKUP_RETENTION: "1" } }).done;
      const setId = expectSucceeded(result);
      expect(unrecordedLines(result)).toEqual([]);
      expect(await lastRun()).toEqual({
        finishedAt: expect.stringMatching(FINISHED_AT),
        result: "succeeded",
        setId,
        category: null,
      });
      expect(await unrecordedFiles(c)).toEqual(files);
      expect(await readFile(path.join(c.backups, files[0] as string), "utf8")).toBe(before);
      expect(await publishedSets(c)).toEqual([setId]);
      expect(await tmpDirs(c)).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "lease lost writes no status: with the holder overwritten at after-archive the run exits 2, writes no backup:lastRun and no unrecorded file",
    async () => {
      const c = await newCase();
      const run = runIn(c, { pauseAt: ["after-archive"] });
      await run.waitReached("after-archive");
      const [tmp] = await tmpDirs(c);
      expect(tmp).toMatch(/^\.tmp-/);
      await prisma.$executeRaw`
        UPDATE "SystemSetting"
        SET value = json_build_object(
          'holder', 'another-backup',
          'expiresAt', to_char((now() + interval '120 seconds') AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,
            "updatedAt" = now()
        WHERE key = 'backup:lease'`;
      await run.go("after-archive");
      const result = await run.done;
      expect(result.exitCode, result.stdout).toBe(2);
      expect(result.stdout).toContain("[backup] backup aborted: lease lost");
      expect(result.stdout).toContain("[backup] backup failed: unknown");
      expect(await lastRun()).toBeNull();
      expect(await unrecordedFiles(c)).toEqual([]);
      expect(unrecordedLines(result)).toEqual([]);
      expect(result.stderr).toBe("");
      expect(await publishedSets(c)).toEqual([]);
      expect(await tmpDirs(c)).toEqual([]);
      const lease = await prisma.systemSetting.findUniqueOrThrow({
        where: { key: "backup:lease" },
      });
      expect(JSON.parse(lease.value)).toMatchObject({ holder: "another-backup" });
      await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = 'backup:lease'`;
    },
    CASE_TIMEOUT,
  );
});

describe("privacy of the record and the output (D-04, T-09-19a)", () => {
  it(
    "privacy (success): the record has exactly the four keys and the output names no password and no path beyond the set id",
    async () => {
      const c = await newCase();
      const result = await runIn(c).done;
      const setId = expectSucceeded(result);
      expectPrivateOutput(c, result);
      const raw = await lastRunRaw();
      const record = JSON.parse(raw as string) as Record<string, unknown>;
      expect(Object.keys(record)).toEqual(STATUS_KEYS);
      expect(record).toEqual({
        finishedAt: expect.stringMatching(FINISHED_AT),
        result: "succeeded",
        setId,
        category: null,
      });
      expect(raw).not.toContain(dbPassword);
      expect(await publishedSets(c)).toEqual([setId]);
      expect(await tmpDirs(c)).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "privacy (dump): the failed record has exactly the four keys and the output names no password, no path and no raw error text",
    async () => {
      const c = await newCase();
      const result = await runWithAttachmentLocked(c);
      expect(result.exitCode, result.stdout).toBe(2);
      expectPrivateOutput(c, result);
      expect(result.stdout).not.toMatch(/lock|timeout|Attachment/i);
      const raw = await lastRunRaw();
      const record = JSON.parse(raw as string) as Record<string, unknown>;
      expect(Object.keys(record)).toEqual(STATUS_KEYS);
      expect(record).toEqual({
        finishedAt: expect.stringMatching(FINISHED_AT),
        result: "failed",
        setId: null,
        category: "dump",
      });
      expect(raw).not.toContain(dbPassword);
      expect(await publishedSets(c)).toEqual([]);
      expect(await tmpDirs(c)).toEqual([]);
    },
    CASE_TIMEOUT,
  );
});
