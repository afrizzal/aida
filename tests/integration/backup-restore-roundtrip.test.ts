// Phase 9 plan 09-10 (AIDA-33 restore component, AIDA-38 backup/restore round trip; D-05, D-06,
// U-14, U-16, reviews P5, Q3, Q4, Q7, R3): the real scripts/backup/aida-backup.sh writes a set and
// the real scripts/backup/aida-restore-set.sh restores it, each in a rule-J labelled
// pgvector/pgvector:pg16 container as user 1000:1000 (tests/integration/support/backup-runner.ts).
// No compose stack: the isolated-stack restore is specified by plan 09-11 and is not run (waiting
// for the Phase 8.1 harness and the owner, U-15).
//
// Databases. A dump holds its whole database and every integration file shares one database, so
// the source of every backup is an isolated database on the same server (support/isolated-
// database.ts, migrated to head), pointed at by DATABASE_URL and the Prisma client before any
// module that touches the database is imported (as in backup-consistency.test.ts). A round trip
// restores into a fresh isolated database; the rejection cases share one isolated target and
// compare its full table inventory (support/table-inventory.ts) before and after.
//
// Uploads. The backup reads repo-local directories under .test-tmp/ (each with the identity's
// marker, from fence fixtures). The restore target is one named volume per case, created,
// labelled, recorded and removed by its exact name by the restore runner (rule J, U-07), and
// mounted at a real mount point.
//
// Hygiene (shared database rule): every case ends with no `backup:lease` row and no fence lock in
// the source database, and no `.restore-lock` or `.restore-staging-*` anywhere in this file's
// backups root (afterEach). The set script leaves the restore lock in place by design (the
// wrapper owns its release, scripts/restore.sh), so each case releases its own lock.
//
// One test process at a time (vitest.integration.config.ts, fileParallelism: false).
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FileStorage } from "@/lib/attachments/file-storage";
import {
  type BackupRun,
  type BackupRunner,
  directoryStorage,
  makeTestDir,
  type PausePoint,
  RESTORE_UPLOADS,
  type RestoreRun,
  type RestoreRunner,
  type RunResult,
  SET_ID_PATTERN,
  sha256Hex,
  startBackupRunner,
  startRestoreRunner,
  TEST_TMP_ROOT,
} from "./support/backup-runner";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";
import { countAllTables, type TableInventory } from "./support/table-inventory";

type FenceFixtures = typeof import("../support/file-fence-fixtures");
type ProjectFixtures = typeof import("../support/project-fixtures");
type FileCleanupModule = typeof import("@/lib/projects/file-cleanup");

const CASE_TIMEOUT = 300_000;
const POOL_KEY = Symbol.for("aida.db.pool");
const PRISMA_KEY = Symbol.for("aida.db.prisma");

let source: IsolatedDatabase | null = null;
let prisma: PrismaClient;
let fence: FenceFixtures;
let fx: ProjectFixtures;
let cleanup: FileCleanupModule;
let backupRunner: BackupRunner | null = null;
let credentials: { user: string; password: string };
let testRoot = "";
let uploadsRoot = "";
let backupsRoot = "";
let pauseRoot = "";
const savedEnv: Record<string, string | undefined> = {};
const savedGlobals: { pool?: unknown; prisma?: unknown } = {};

/** Every isolated database and restore runner a case opened; afterEach closes what is left. */
const openDatabases: IsolatedDatabase[] = [];
const openRestoreRunners: RestoreRunner[] = [];
const openBackupRuns: BackupRun[] = [];
const openRestoreRuns: RestoreRun[] = [];
/** Restore locks a case took; afterEach releases any the case did not release itself. */
const heldLocks: { runner: RestoreRunner; c: Case; holder: string }[] = [];

beforeAll(async () => {
  testRoot = await makeTestDir(TEST_TMP_ROOT, "backup-restore-");
  uploadsRoot = await makeTestDir(testRoot, "uploads-");
  backupsRoot = await makeTestDir(testRoot, "backups-");
  pauseRoot = await makeTestDir(testRoot, "pause-");

  source = await createIsolatedDatabase();
  const url = new URL(source.url);
  savedEnv.DATABASE_URL = process.env.DATABASE_URL;
  savedEnv.UPLOADS_DIR = process.env.UPLOADS_DIR;
  process.env.DATABASE_URL = source.url;
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
  fx = await import("../support/project-fixtures");
  cleanup = await import("@/lib/projects/file-cleanup");

  credentials = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  backupRunner = await startBackupRunner({
    database: url.pathname.slice(1),
    ...credentials,
    uploadsRoot,
    backupsRoot,
    pauseRoot,
  });
}, 300_000);

afterAll(async () => {
  await backupRunner?.stop();
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
    await source?.drop();
    if (testRoot) await rm(testRoot, { recursive: true, force: true });
  }
}, 180_000);

/** Empty file tables in the source: every backup sees only the files its own case wrote. */
async function clearSource(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "Attachment"`;
  await prisma.$executeRaw`DELETE FROM "TaskAttachment"`;
  await prisma.$executeRaw`DELETE FROM "Setting" WHERE key = 'branding:logo'`;
  await prisma.$executeRaw`DELETE FROM "ProjectFileCleanup"`;
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key IN ('backup:lease', 'backup:lastRun')`;
}

beforeEach(clearSource);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const run of openBackupRuns.splice(0)) {
    await run.releaseAll();
    await run.done;
  }
  for (const run of openRestoreRuns.splice(0)) {
    await run.releaseAll();
    await run.done;
  }
  const errors: unknown[] = [];
  for (const { runner, c, holder } of heldLocks.splice(0)) {
    const result = await lib(runner, c, 'restore_lock_release "$1"', holder);
    if (result.exitCode !== 0) errors.push(new Error(`lock of ${c.backupsName} not released`));
  }
  for (const runner of openRestoreRunners.splice(0)) {
    try {
      await runner.stop();
    } catch (err) {
      errors.push(err);
    }
  }
  for (const db of openDatabases.splice(0)) {
    try {
      await db.drop();
    } catch (err) {
      errors.push(err);
    }
  }
  const leases = await prisma.systemSetting.count({ where: { key: "backup:lease" } });
  const locks = await fence.fenceLocks();
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = 'backup:lease'`;
  expect({ leases, locks }).toEqual({ leases: 0, locks: [] });
  expect(await findLeftovers(backupsRoot)).toEqual([]);
  expect(errors).toEqual([]);
}, 180_000);

/** Every `.restore-lock` and `.restore-staging-*` under dir. */
async function findLeftovers(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === ".restore-lock" || entry.name.startsWith(".restore-staging-")) {
      found.push(path.relative(backupsRoot, full));
    } else if (entry.isDirectory()) {
      found.push(...(await findLeftovers(full)));
    }
  }
  return found;
}

function activeBackupRunner(): BackupRunner {
  if (!backupRunner) throw new Error("no backup runner");
  return backupRunner;
}

// ---------------------------------------------------------------------------------------------
// Source world: uploads, rows and files

interface Case {
  uploads: string;
  backups: string;
  uploadsName: string;
  backupsName: string;
  storage: FileStorage;
  /** The bytes of every file the case wrote, by "<orgId>/<key>". */
  originals: Map<string, Buffer>;
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
    storage: directoryStorage(uploads),
    originals: new Map(),
  };
}

let keySeq = 0;
function newKey(ext = "bin"): string {
  keySeq += 1;
  return `${randomUUID().replaceAll("-", "")}${keySeq.toString(16)}.${ext}`;
}

async function storeFile(c: Case, orgId: string, ext = "bin"): Promise<string> {
  const key = newKey(ext);
  const data = Buffer.from(`file ${key} ${randomUUID()} ${randomBytes(64).toString("base64")}`);
  await c.storage.save({ orgId, key, data });
  c.originals.set(`${orgId}/${key}`, data);
  return key;
}

interface World {
  orgId: string;
  ownerId: string;
  messageId: string;
  taskId: string;
}

async function seedWorld(): Promise<World> {
  const { orgId, users } = await fx.seedOrgWithMembers(prisma, ["owner"]);
  const ownerId = (users[0] as { id: string }).id;
  const state = await prisma.ticketState.findFirstOrThrow({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  const contact = await prisma.contact.create({
    data: { organizationId: orgId, email: `rt-${randomUUID()}@example.test` },
    select: { id: true },
  });
  const now = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      organizationId: orgId,
      number: 1,
      statusToken: randomUUID(),
      subject: "Restore fixture",
      stateId: state.id,
      contactId: contact.id,
      firstResponseTargetMinutes: 60,
      resolutionTargetMinutes: 600,
      firstResponseDueAt: now,
      resolutionDueAt: now,
    },
    select: { id: true },
  });
  const message = await prisma.message.create({
    data: {
      organizationId: orgId,
      ticketId: ticket.id,
      direction: "INBOUND",
      bodyMarkdown: "Fixture",
      bodyHtml: "<p>Fixture</p>",
    },
    select: { id: true },
  });
  const project = await fx.seedProject(prisma, orgId, {
    createdByUserId: ownerId,
    managerUserIds: [ownerId],
  });
  const task = await fx.seedTask(prisma, orgId, project.id, { createdByUserId: ownerId });
  return { orgId, ownerId, messageId: message.id, taskId: task.id };
}

async function addTicketAttachment(c: Case, w: World): Promise<string> {
  const key = await storeFile(c, w.orgId, "txt");
  await prisma.attachment.create({
    data: {
      organizationId: w.orgId,
      messageId: w.messageId,
      storageKey: key,
      originalFilename: "fixture.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
    },
  });
  return key;
}

async function addTaskAttachment(c: Case, w: World): Promise<string> {
  const key = await storeFile(c, w.orgId, "png");
  await fx.seedAttachment(prisma, w.orgId, w.taskId, {
    uploadedByUserId: w.ownerId,
    storageKey: key,
  });
  return key;
}

function logoValue(storageKey: string, version: number): string {
  return JSON.stringify({ storageKey, mimeType: "image/png", version });
}

async function setLogo(c: Case, w: World): Promise<string> {
  const key = await storeFile(c, w.orgId, "png");
  await prisma.setting.create({
    data: { organizationId: w.orgId, key: "branding:logo", value: logoValue(key, 1) },
  });
  return key;
}

/** Replaces the logo: new file, then the committed Setting update with the old key enqueued. */
async function replaceLogo(c: Case, w: World, oldKey: string, version: number): Promise<string> {
  const key = await storeFile(c, w.orgId, "png");
  await prisma.$transaction(async (tx) => {
    await tx.setting.update({
      where: { organizationId_key: { organizationId: w.orgId, key: "branding:logo" } },
      data: { value: logoValue(key, version) },
    });
    await cleanup.enqueueFileCleanupInTx(tx, w.orgId, [oldKey]);
  });
  return key;
}

/** Two ticket attachments, one task attachment and a logo. */
async function seedFour(c: Case): Promise<World & { keys: string[] }> {
  const w = await seedWorld();
  const keys = [
    await addTicketAttachment(c, w),
    await addTicketAttachment(c, w),
    await addTaskAttachment(c, w),
    await setLogo(c, w),
  ];
  return { ...w, keys };
}

function runBackup(c: Case, pauseAt?: readonly PausePoint[]): BackupRun {
  const run = activeBackupRunner().runBackup({
    uploads: c.uploadsName,
    backups: c.backupsName,
    pauseAt,
  });
  openBackupRuns.push(run);
  return run;
}

async function backupSucceeded(c: Case, run: BackupRun): Promise<string> {
  const result = await run.done;
  expect(result.exitCode, result.stdout).toBe(0);
  const sets = (await readdir(c.backups)).filter((name) => SET_ID_PATTERN.test(name));
  expect(sets).toHaveLength(1);
  return sets[0] as string;
}

// ---------------------------------------------------------------------------------------------
// Restore side: target database, runner, lock, inspection

async function newTargetDatabase(): Promise<IsolatedDatabase> {
  const db = await createIsolatedDatabase();
  openDatabases.push(db);
  return db;
}

function databaseName(db: IsolatedDatabase): string {
  return new URL(db.url).pathname.slice(1);
}

async function newRestoreRunner(target: IsolatedDatabase): Promise<RestoreRunner> {
  const runner = await startRestoreRunner({
    database: databaseName(target),
    ...credentials,
    backupsRoot,
    pauseRoot,
  });
  openRestoreRunners.push(runner);
  return runner;
}

function newHolder(): string {
  return `restore-${randomBytes(16).toString("hex")}`;
}

async function execOk(runner: RestoreRunner, command: string[], env?: Record<string, string>) {
  const result = await runner.exec(command, env);
  if (result.exitCode !== 0) {
    throw new Error(`restore runner exec failed (${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout;
}

/** Runs one lib.sh snippet in the restore runner with BACKUP_DIR set to the case's directory. */
function lib(runner: RestoreRunner, c: Case, script: string, ...args: string[]) {
  return runner.exec(["sh", "-c", `. /opt/aida-backup/lib.sh; ${script}`, "sh", ...args], {
    BACKUP_DIR: `/backups/${c.backupsName}`,
  });
}

async function acquireLock(runner: RestoreRunner, c: Case, holder: string): Promise<void> {
  const result = await lib(runner, c, 'restore_lock_acquire "$1"', holder);
  expect(result.exitCode, result.stderr).toBe(0);
  heldLocks.push({ runner, c, holder });
}

async function releaseLock(runner: RestoreRunner, c: Case, holder: string): Promise<void> {
  const result = await lib(runner, c, 'restore_lock_release "$1"', holder);
  expect(result.exitCode, result.stderr).toBe(0);
  const i = heldLocks.findIndex((l) => l.runner === runner && l.holder === holder);
  if (i >= 0) heldLocks.splice(i, 1);
}

/** The content of `.restore-lock/target-touched`, or null when there is none. */
async function targetTouched(runner: RestoreRunner, c: Case): Promise<string | null> {
  const file = `/backups/${c.backupsName}/.restore-lock/target-touched`;
  const result = await runner.exec([
    "sh",
    "-c",
    'if [ -e "$1" ]; then cat "$1"; else echo -; fi',
    "sh",
    file,
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  const value = result.stdout.trim();
  return value === "-" ? null : value;
}

function runRestore(
  runner: RestoreRunner,
  c: Case,
  setId: string,
  holder: string,
  opts: {
    uploadsDir?: string;
    env?: Record<string, string>;
    pauseAt?: readonly "validating"[];
  } = {},
): RestoreRun {
  const run = runner.runRestore({ backups: c.backupsName, setId, holder, ...opts });
  openRestoreRuns.push(run);
  return run;
}

/** Every entry under the target as "path|uid:gid|type|size", sorted (root view: sees all). */
async function targetEntries(runner: RestoreRunner, dir = RESTORE_UPLOADS): Promise<string[]> {
  const result = await runner.execAsRoot([
    "find",
    dir,
    "-mindepth",
    "1",
    "-printf",
    "%P|%U:%G|%y|%s\\n",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout
    .split("\n")
    .filter((line) => line !== "")
    .sort();
}

/** sha256 of every regular file under the target, by relative path. */
async function targetHashes(runner: RestoreRunner): Promise<Map<string, string>> {
  const out = await execOk(runner, [
    "sh",
    "-c",
    'cd "$1" && find . -type f ! -name .aida-uploads-volume -printf "%P\\n" | sort | while read -r f; do sha256sum -- "$f"; done',
    "sh",
    RESTORE_UPLOADS,
  ]);
  const hashes = new Map<string, string>();
  for (const line of out.split("\n").filter((l) => l !== "")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!match) throw new Error(`unreadable sha256sum line: ${line}`);
    hashes.set(match[2] as string, match[1] as string);
  }
  return hashes;
}

async function query<T extends pg.QueryResultRow>(db: IsolatedDatabase, sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: db.url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

/** Every "<orgId>/<storageKey>" the database references, by kind (U-14). */
async function databaseReferences(db: IsolatedDatabase): Promise<Record<string, string[]>> {
  const attachments = await query<{ org: string; key: string }>(
    db,
    `SELECT "organizationId" AS org, "storageKey" AS key FROM "Attachment"`,
  );
  const tasks = await query<{ org: string; key: string }>(
    db,
    `SELECT "organizationId" AS org, "storageKey" AS key FROM "TaskAttachment"`,
  );
  const logos = await query<{ org: string; value: string }>(
    db,
    `SELECT "organizationId" AS org, value FROM "Setting" WHERE key = 'branding:logo'`,
  );
  return {
    Attachment: attachments.map((r) => `${r.org}/${r.key}`).sort(),
    TaskAttachment: tasks.map((r) => `${r.org}/${r.key}`).sort(),
    logo: logos
      .map((r) => `${r.org}/${(JSON.parse(r.value) as { storageKey: string }).storageKey}`)
      .sort(),
  };
}

async function volumeIdentity(db: IsolatedDatabase): Promise<string | null> {
  const rows = await query<{ value: string }>(
    db,
    `SELECT value FROM "SystemSetting" WHERE key = 'uploads:volume-id'`,
  );
  return rows[0]?.value ?? null;
}

async function leaseRows(db: IsolatedDatabase): Promise<number> {
  const rows = await query<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM "SystemSetting" WHERE key = 'backup:lease'`,
  );
  return Number(rows[0]?.n);
}

async function marker(runner: RestoreRunner): Promise<string> {
  return (await execOk(runner, ["cat", `${RESTORE_UPLOADS}/.aida-uploads-volume`])).trim();
}

/** The checks every successful restore must pass (U-16, Q4, Q7, R3). */
async function expectRestoredVolume(runner: RestoreRunner, target: IsolatedDatabase) {
  const identity = await volumeIdentity(target);
  expect(identity).toMatch(/^[0-9a-f]{32}$/);
  expect(await marker(runner)).toBe(identity);
  const owners = await targetEntries(runner);
  for (const entry of owners) {
    expect(entry.split("|")[1], entry).toBe("1000:1000");
  }
  expect(await leaseRows(target)).toBe(0);
}

function expectRestoreLog(result: RunResult): void {
  for (const line of result.stdout.split("\n").filter((l) => l !== "")) {
    expect(line).toMatch(/^\[restore\] /);
  }
  expect(result.stdout).not.toMatch(/postgres(ql)?:\/\//);
  expect(`${result.stdout}\n${result.stderr}`).not.toContain(credentials.password);
}

// ---------------------------------------------------------------------------------------------

describe("restore tracer (U-14, U-16, Q4, Q7)", () => {
  it(
    "round trip: ticket attachments, a task attachment and a logo replaced mid-backup come back byte for byte, owned by 1000, with the marker of the restored identity and no lease",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const oldLogo = w.keys[3] as string;

      // The logo is replaced while the backup waits after its dump: the dump keeps the old logo,
      // and the fence keeps the old file for the archive.
      const run = runBackup(c, ["after-dump"]);
      await run.waitReached("after-dump");
      const newLogo = await replaceLogo(c, w, oldLogo, 2);
      await run.go("after-dump");
      const setId = await backupSucceeded(c, run);
      const sourceRefs = {
        Attachment: [w.keys[0], w.keys[1]].map((k) => `${w.orgId}/${k}`).sort(),
        TaskAttachment: [`${w.orgId}/${w.keys[2]}`],
        logo: [`${w.orgId}/${oldLogo}`],
      };

      const target = await newTargetDatabase();
      const runner = await newRestoreRunner(target);
      const holder = newHolder();
      await acquireLock(runner, c, holder);
      const result = await runRestore(runner, c, setId, holder).done;
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      expectRestoreLog(result);
      expect(result.stdout).toContain(`[restore] restore complete: ${setId}`);

      // Every Attachment, TaskAttachment and logo record of the restored database has its file,
      // and the file's sha256 equals the sha256 of the original bytes (AIDA-38, U-14).
      const refs = await databaseReferences(target);
      expect(refs).toEqual(sourceRefs);
      const hashes = await targetHashes(runner);
      for (const ref of Object.values(refs).flat()) {
        const original = c.originals.get(ref);
        expect(original, `original bytes for ${ref}`).toBeDefined();
        expect({ ref, sha256: hashes.get(ref) }).toEqual({
          ref,
          sha256: sha256Hex(original as Buffer),
        });
      }
      // The new logo's file was in the uploads directory when the archive was taken, so it is
      // restored too (an unreferenced file, as it was on the source volume).
      expect(hashes.get(`${w.orgId}/${newLogo}`)).toBe(
        sha256Hex(c.originals.get(`${w.orgId}/${newLogo}`) as Buffer),
      );
      expect([...hashes.keys()].sort()).toEqual([...c.originals.keys()].sort());

      await expectRestoredVolume(runner, target);
      expect(await volumeIdentity(target)).toBe(await fence.testVolumeIdentity());
      expect(await targetTouched(runner, c)).toBe("uploads");
      await releaseLock(runner, c, holder);
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// Task 2: bad sets and unsafe targets are refused before any write (P5, Q4, R3, U-16), the empty
// install round-trips (R3), and the restore lock guards the whole run (Q3).
//
// The rejection cases restore copies of one valid base set into one shared isolated target
// database. Each case asserts its exit code and reason line, an unchanged full table inventory of
// the target, an unchanged entry list of its target volume, no `target-touched` file, no staging
// directory, and the restore lock still held by the case's holder (the set script never releases
// it; the wrapper does).

interface BaseSet {
  c: Case;
  setId: string;
}

let base: BaseSet | null = null;
let sharedTarget: IsolatedDatabase | null = null;

async function baseSet(): Promise<BaseSet> {
  if (base) return base;
  await clearSource();
  const c = await newCase();
  await seedFour(c);
  const setId = await backupSucceeded(c, runBackup(c));
  base = { c, setId };
  return base;
}

async function rejectionTarget(): Promise<IsolatedDatabase> {
  if (!sharedTarget) sharedTarget = await createIsolatedDatabase();
  return sharedTarget;
}

afterAll(async () => {
  await sharedTarget?.drop();
}, 120_000);

/** A new case whose backups directory holds a copy of the base set, made by uid 1000. */
async function copyOfBase(runner: RestoreRunner): Promise<{ c: Case; setId: string }> {
  const b = await baseSet();
  const c = await newCase();
  await execOk(runner, [
    "cp",
    "-R",
    `/backups/${b.c.backupsName}/${b.setId}`,
    `/backups/${c.backupsName}/${b.setId}`,
  ]);
  return { c, setId: b.setId };
}

/** Runs a shell script in the restore runner with SET set to the case's set directory. */
async function inSet(runner: RestoreRunner, c: Case, setId: string, script: string) {
  return execOk(runner, [
    "sh",
    "-c",
    `set -eu\nSET=$1\n${script}`,
    "sh",
    `/backups/${c.backupsName}/${setId}`,
  ]);
}

/** Rewrites the manifest's sha256 and size of one part to match the part as it is now. */
const UPDATE_MANIFEST = String.raw`update_manifest() {
  f="$SET/$1"
  sha=$(sha256sum "$f" | cut -d " " -f 1)
  size=$(stat -c %s "$f")
  re=$(printf %s "$1" | sed "s/\./\\\\./g")
  sed -i -E "s/^(    \"$re\": \{ \"sha256\": \")[0-9a-f]{64}(\", \"size\": )[0-9]+( \},?)\$/\1$sha\2$size\3/" "$SET/manifest.json"
  grep -q "\"sha256\": \"$sha\", \"size\": $size " "$SET/manifest.json"
}
`;

/** Builds a crafted uploads.tar.gz in a scratch directory and makes the manifest agree with it. */
async function craftArchive(runner: RestoreRunner, c: Case, setId: string, build: string) {
  await inSet(
    runner,
    c,
    setId,
    `${UPDATE_MANIFEST}d=$(mktemp -d)\nmkdir -p "$d/orgx"\n${build}\nupdate_manifest uploads.tar.gz\nrm -rf "$d"`,
  );
}

/** Extracts the set's archive to $x and its member list to $x.list (for a rebuild). */
const UNPACK = `x=$(mktemp -d)
tar -tzf "$SET/uploads.tar.gz" > "$x.list"
tar -xzf "$SET/uploads.tar.gz" -C "$x"
first=$(head -n 1 "$x.list")
printf 'changed' >> "$x/$first"
tar -czf "$SET/uploads.tar.gz" -C "$x" --no-recursion --verbatim-files-from -T "$x.list"`;

interface TargetSnapshot {
  inventory: TableInventory;
  volume: string[];
  extra: string[];
}

async function snapshot(
  runner: RestoreRunner,
  target: IsolatedDatabase,
  extraDir?: string,
): Promise<TargetSnapshot> {
  return {
    inventory: await countAllTables(target.url),
    volume: await targetEntries(runner),
    extra: extraDir ? await targetEntries(runner, extraDir) : [],
  };
}

async function stagingDirs(c: Case): Promise<string[]> {
  return (await readdir(c.backups)).filter((name) => name.startsWith(".restore-staging-"));
}

async function lockHolder(runner: RestoreRunner, c: Case): Promise<string | null> {
  const result = await lib(runner, c, "restore_lock_holder");
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function expectRefused(opts: {
  runner: RestoreRunner;
  c: Case;
  setId: string;
  target: IsolatedDatabase;
  exit: 3 | 4 | 6;
  line: string;
  /** The holder the run uses; defaults to the lock's own holder. */
  runHolder?: string;
  uploadsDir?: string;
  before: TargetSnapshot;
  lockHolder: string;
}): Promise<void> {
  const result = await runRestore(
    opts.runner,
    opts.c,
    opts.setId,
    opts.runHolder ?? opts.lockHolder,
    {
      uploadsDir: opts.uploadsDir,
    },
  ).done;
  expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(opts.exit);
  expectRestoreLog(result);
  expect(result.stdout).toContain(`[restore] ${opts.line}`);
  if (opts.exit === 4) expect(result.stdout).toContain("[restore] set failed validation");
  expect(result.stdout).not.toContain("restoring the database");
  expect(await snapshot(opts.runner, opts.target, opts.uploadsDir)).toEqual(opts.before);
  expect(await targetTouched(opts.runner, opts.c)).toBeNull();
  expect(await stagingDirs(opts.c)).toEqual([]);
  expect(await lockHolder(opts.runner, opts.c)).toBe(opts.lockHolder);
}

/** One rejection case: a copy of the base set, changed by `prepare`, then refused. */
async function rejectCase(opts: {
  prepare: (runner: RestoreRunner, c: Case, setId: string) => Promise<void>;
  exit: 4 | 6;
  line: string;
  uploadsDir?: string;
}): Promise<void> {
  const target = await rejectionTarget();
  const runner = await newRestoreRunner(target);
  const { c, setId } = await copyOfBase(runner);
  await opts.prepare(runner, c, setId);
  const holder = newHolder();
  await acquireLock(runner, c, holder);
  const before = await snapshot(runner, target, opts.uploadsDir);
  await expectRefused({
    runner,
    c,
    setId,
    target,
    exit: opts.exit,
    line: opts.line,
    uploadsDir: opts.uploadsDir,
    before,
    lockHolder: holder,
  });
  await releaseLock(runner, c, holder);
}

describe("rejection matrix: a bad set is refused before any write (P5, Q4)", () => {
  it(
    "tampered: one byte of the archive changed, manifest unchanged",
    async () => {
      await rejectCase({
        prepare: async (runner, c, setId) => {
          await inSet(
            runner,
            c,
            setId,
            `b=$(od -An -tu1 -j 40 -N 1 "$SET/uploads.tar.gz" | tr -d ' ')
printf "\\\\$(printf %03o $(( (b + 1) % 256 )))" | dd of="$SET/uploads.tar.gz" bs=1 seek=40 conv=notrunc 2>/dev/null`,
          );
        },
        exit: 4,
        line: "validation: uploads.tar.gz checksum",
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "forged checksum list: uploads.sha256 edited, manifest unchanged",
    async () => {
      await rejectCase({
        prepare: async (runner, c, setId) => {
          await inSet(
            runner,
            c,
            setId,
            `sed -i -E '1s/^0/1/;t;1s/^[0-9a-f]/0/' "$SET/uploads.sha256"`,
          );
        },
        exit: 4,
        line: "validation: uploads.sha256 checksum",
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "forged pair: archive and uploads.sha256 changed consistently, manifest unchanged",
    async () => {
      await rejectCase({
        prepare: async (runner, c, setId) => {
          await inSet(
            runner,
            c,
            setId,
            `${UNPACK}
(cd "$x" && sha256sum $(cat "$x.list")) | sort -k 2 > "$SET/uploads.sha256"`,
          );
        },
        exit: 4,
        line: "validation: uploads.tar.gz checksum",
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "staged mismatch: archive rebuilt with a changed file and its manifest hash updated, uploads.sha256 not",
    async () => {
      await rejectCase({
        prepare: async (runner, c, setId) => {
          await inSet(
            runner,
            c,
            setId,
            `${UPDATE_MANIFEST}${UNPACK}\nupdate_manifest uploads.tar.gz`,
          );
        },
        exit: 4,
        line: "validation: staged checksum",
      });
    },
    CASE_TIMEOUT,
  );

  const crafted: [string, string, string][] = [
    [
      "traversal: a ../x member",
      `mkdir -p "$d/a"; printf x > "$d/x1.txt"; (cd "$d/a" && tar -czPf "$SET/uploads.tar.gz" ../x1.txt)`,
      "validation: member name",
    ],
    [
      "absolute: an absolute member path",
      `printf x > "$d/orgx/a1.txt"; tar -czPf "$SET/uploads.tar.gz" "$d/orgx/a1.txt"`,
      "validation: member name",
    ],
    [
      "symlink: a symbolic link member with a valid name",
      `ln -s /etc/passwd "$d/orgx/l1.txt"; tar -czf "$SET/uploads.tar.gz" -C "$d" orgx/l1.txt`,
      "validation: member type",
    ],
    [
      "hard link: a hard link member with a valid name",
      `printf a > "$d/orgx/a1.txt"; ln "$d/orgx/a1.txt" "$d/orgx/b1.txt"; tar -czf "$SET/uploads.tar.gz" -C "$d" orgx/a1.txt orgx/b1.txt`,
      "validation: member type",
    ],
    [
      "fifo: a FIFO member with a valid name",
      `mkfifo "$d/orgx/f1.txt"; tar -czf "$SET/uploads.tar.gz" -C "$d" orgx/f1.txt`,
      "validation: member type",
    ],
    [
      "special name: a member under a directory named -rf",
      `mkdir "$d/-rf"; printf x > "$d/-rf/a1.txt"; printf -- '-rf/a1.txt\\0' > "$d.list"; tar -czf "$SET/uploads.tar.gz" -C "$d" --null --no-recursion --verbatim-files-from -T "$d.list"`,
      "validation: member name",
    ],
    [
      "newline: a member whose name contains a newline",
      `n=$(printf 'orgx/ab\\ncd.txt'); printf y > "$d/$n"; printf '%s\\0' "$n" > "$d.list"; tar -czf "$SET/uploads.tar.gz" -C "$d" --null --no-recursion --verbatim-files-from -T "$d.list"`,
      "validation: member name",
    ],
    [
      "marker member: the archive carries .aida-uploads-volume",
      `printf 'ffffffffffffffffffffffffffffffff\\n' > "$d/.aida-uploads-volume"; printf a > "$d/orgx/a1.txt"; tar -czf "$SET/uploads.tar.gz" -C "$d" .aida-uploads-volume orgx/a1.txt`,
      "validation: member name",
    ],
  ];
  for (const [name, build, line] of crafted) {
    it(
      name,
      async () => {
        await rejectCase({
          prepare: (runner, c, setId) => craftArchive(runner, c, setId, build),
          exit: 4,
          line,
        });
      },
      CASE_TIMEOUT,
    );
  }

  it(
    "missing identity: the dump holds no uploads:volume-id",
    async () => {
      await rejectCase({
        prepare: async (runner, c, setId) => {
          const dumped = await activeBackupRunner().exec([
            "pg_dump",
            "-Fc",
            '--exclude-table-data="SystemSetting"',
            "-f",
            `/backups/${c.backupsName}/${setId}/db.dump`,
          ]);
          expect(dumped.exitCode, dumped.stderr).toBe(0);
          await inSet(runner, c, setId, `${UPDATE_MANIFEST}update_manifest db.dump`);
        },
        exit: 4,
        line: "validation: volume identity missing from the dump",
      });
    },
    CASE_TIMEOUT,
  );
});

describe("unsafe targets are refused before any write (U-16, Q7)", () => {
  it(
    "foreign owner: the target volume already holds an entry not owned by 1000",
    async () => {
      await rejectCase({
        prepare: async (runner) => {
          const planted = await runner.execAsRoot([
            "sh",
            "-c",
            `mkdir "${RESTORE_UPLOADS}/rootdir" && printf x > "${RESTORE_UPLOADS}/rootdir/x1.txt"`,
          ]);
          expect(planted.exitCode, planted.stderr).toBe(0);
        },
        exit: 6,
        line: "target check failed: uploads target holds an entry not owned by 1000:1000",
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "not a mount point: UPLOADS_DIR is a plain directory",
    async () => {
      await rejectCase({
        prepare: async (runner) => {
          await execOk(runner, ["mkdir", "-p", "/tmp/plain-uploads"]);
        },
        exit: 6,
        line: "target check failed: uploads target is not a mount point",
        uploadsDir: "/tmp/plain-uploads",
      });
    },
    CASE_TIMEOUT,
  );
});

describe("empty round trip (R3)", () => {
  it(
    "empty round trip: an install with the identity and its marker and no file backs up and restores, and the restored marker equals the restored identity",
    async () => {
      const c = await newCase();
      const setId = await backupSucceeded(c, runBackup(c));
      const target = await newTargetDatabase();
      const runner = await newRestoreRunner(target);
      const holder = newHolder();
      await acquireLock(runner, c, holder);
      const result = await runRestore(runner, c, setId, holder).done;
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      expectRestoreLog(result);
      expect(await databaseReferences(target)).toEqual({
        Attachment: [],
        TaskAttachment: [],
        logo: [],
      });
      await expectRestoredVolume(runner, target);
      expect(await volumeIdentity(target)).toBe(await fence.testVolumeIdentity());
      expect((await targetEntries(runner)).map((e) => e.split("|")[0])).toEqual([
        ".aida-uploads-volume",
      ]);
      expect(await stagingDirs(c)).toEqual([]);
      await releaseLock(runner, c, holder);
    },
    CASE_TIMEOUT,
  );
});

describe("restore lock and holder (Q3)", () => {
  it(
    "double acquire: a second restore_lock_acquire fails and the first holder's files are intact",
    async () => {
      const target = await rejectionTarget();
      const runner = await newRestoreRunner(target);
      const c = await newCase();
      const first = newHolder();
      await acquireLock(runner, c, first);
      const read = 'cat "$(restore_lock_dir)/holder" "$(restore_lock_dir)/heartbeat"';
      const before = await lib(runner, c, read);
      const second = await lib(runner, c, 'restore_lock_acquire "$1"', newHolder());
      expect(second.exitCode).not.toBe(0);
      expect(await lib(runner, c, read)).toEqual(before);
      expect(await lockHolder(runner, c)).toBe(first);
      await releaseLock(runner, c, first);
    },
    CASE_TIMEOUT,
  );

  it(
    "foreign holder: the set script with another RESTORE_HOLDER refuses before any target write",
    async () => {
      const target = await rejectionTarget();
      const runner = await newRestoreRunner(target);
      const { c, setId } = await copyOfBase(runner);
      const holder = newHolder();
      await acquireLock(runner, c, holder);
      const before = await snapshot(runner, target);
      await expectRefused({
        runner,
        c,
        setId,
        target,
        exit: 3,
        line: "restore lock not held by this restore",
        runHolder: newHolder(),
        before,
        lockHolder: holder,
      });
      await releaseLock(runner, c, holder);
    },
    CASE_TIMEOUT,
  );

  it(
    "heartbeat swap: another holder written during validation stops the run before any target write",
    async () => {
      const target = await rejectionTarget();
      const runner = await newRestoreRunner(target);
      const { c, setId } = await copyOfBase(runner);
      const holder = newHolder();
      await acquireLock(runner, c, holder);
      const before = await snapshot(runner, target);
      const run = runRestore(runner, c, setId, holder, {
        pauseAt: ["validating"],
        env: { RESTORE_HEARTBEAT_SECONDS: "1" },
      });
      await run.waitReached("validating");
      const intruder = newHolder();
      const swapped = await lib(
        runner,
        c,
        'restore_lock_write "$(restore_lock_dir)" holder "$1"',
        intruder,
      );
      expect(swapped.exitCode, swapped.stderr).toBe(0);
      // From here the lock is the intruder's: afterEach must release it under that holder.
      for (const held of heldLocks) if (held.holder === holder) held.holder = intruder;
      // The run is never released from its pause point: only the heartbeat can end it.
      const result = await run.done;
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(result.stdout).toContain("[restore] restore aborted: restore lock lost");
      expect(result.stdout).not.toContain("set validated");
      expect(await snapshot(runner, target)).toEqual(before);
      expect(await targetTouched(runner, c)).toBeNull();
      expect(await stagingDirs(c)).toEqual([]);
      expect(await lockHolder(runner, c)).toBe(intruder);
      await releaseLock(runner, c, intruder);
    },
    CASE_TIMEOUT,
  );

  it(
    "break stale lock: removed only for the matching holder with a heartbeat older than the limit",
    async () => {
      const target = await rejectionTarget();
      const runner = await newRestoreRunner(target);
      const c = await newCase();
      const holder = newHolder();
      await acquireLock(runner, c, holder);
      const breakStale = (who: string) => lib(runner, c, 'restore_lock_break_stale "$1" 900', who);

      // Fresh heartbeat: refused (3), lock intact.
      expect((await breakStale(holder)).exitCode).toBe(3);
      expect(await lockHolder(runner, c)).toBe(holder);
      // An old heartbeat, but another holder named: refused (2), lock intact.
      const aged = await lib(
        runner,
        c,
        'restore_lock_write "$(restore_lock_dir)" heartbeat "$(( $(date -u +%s) - 1000 ))"',
      );
      expect(aged.exitCode, aged.stderr).toBe(0);
      expect((await lib(runner, c, "restore_lock_age")).stdout.trim()).toMatch(/^10\d\d$/);
      expect((await breakStale(newHolder())).exitCode).toBe(2);
      expect(await lockHolder(runner, c)).toBe(holder);
      // Matching holder and an old heartbeat: removed.
      expect((await breakStale(holder)).exitCode).toBe(0);
      expect(await lockHolder(runner, c)).toBeNull();
      const i = heldLocks.findIndex((l) => l.holder === holder);
      if (i >= 0) heldLocks.splice(i, 1);
      // Nothing to break any more.
      expect((await breakStale(holder)).exitCode).toBe(1);
    },
    CASE_TIMEOUT,
  );
});
