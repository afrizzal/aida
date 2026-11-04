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

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM "Attachment"`;
  await prisma.$executeRaw`DELETE FROM "TaskAttachment"`;
  await prisma.$executeRaw`DELETE FROM "Setting" WHERE key = 'branding:logo'`;
  await prisma.$executeRaw`DELETE FROM "ProjectFileCleanup"`;
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key IN ('backup:lease', 'backup:lastRun')`;
});

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
