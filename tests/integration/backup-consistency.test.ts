// Phase 9 plan 09-06 (AIDA-33, AIDA-38): the real backup script, scripts/backup/aida-backup.sh, in
// a rule-J labelled pgvector/pgvector:pg16 container (tests/integration/support/backup-runner.ts)
// against this run's Testcontainers Postgres and repo-local temporary directories (D-06). No
// compose stack: the stack-level run of the backup service is specified by plan 09-11 and is not
// run (waiting for the Phase 8.1 harness and the owner, U-15).
//
// The script dumps its whole database, and every integration file shares one database, so a dump
// of the shared database would reference other files' attachments, whose files are not in this
// suite's uploads directories. This file therefore owns an isolated database on the same server
// (support/isolated-database.ts, migrated to head) and points DATABASE_URL and the Prisma client
// at it before it imports any module that touches the database. Every case starts from empty
// Attachment, TaskAttachment, `branding:logo` Setting and ProjectFileCleanup tables, its own
// uploads directory (with the database identity's marker) and its own backups directory, and
// ends with no `backup:lease` row, no fence lock, no fence session and no `.restore-lock`
// (afterEach).
//
// One test process at a time (vitest.integration.config.ts, fileParallelism: false).
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { BACKUP_LEASE_ACTIVE_SQL } from "@/lib/storage/file-fence";
import { deferred, waitForBlockedBy } from "../support/lock-wait";
import {
  type BackupRun,
  type BackupRunner,
  directoryStorage,
  makeTestDir,
  type PausePoint,
  parseCopy,
  type RunResult,
  SET_ID_PATTERN,
  sha256Hex,
  startBackupRunner,
  TEST_TMP_ROOT,
} from "./support/backup-runner";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";

type FenceFixtures = typeof import("../support/file-fence-fixtures");
type ProjectFixtures = typeof import("../support/project-fixtures");
type AttachmentsModule = typeof import("@/lib/projects/attachments");
type FileCleanupModule = typeof import("@/lib/projects/file-cleanup");

const CASE_TIMEOUT = 180_000;
const POOL_KEY = Symbol.for("aida.db.pool");
const PRISMA_KEY = Symbol.for("aida.db.prisma");

let iso: IsolatedDatabase | null = null;
let prisma: PrismaClient;
let fence: FenceFixtures;
let fx: ProjectFixtures;
let attachments: AttachmentsModule;
let cleanup: FileCleanupModule;
let runner: BackupRunner | null = null;
let runnerOptions: Parameters<typeof startBackupRunner>[0];
let testRoot = "";
let uploadsRoot = "";
let backupsRoot = "";
let pauseRoot = "";
const savedEnv: Record<string, string | undefined> = {};
const savedGlobals: { pool?: unknown; prisma?: unknown } = {};

beforeAll(async () => {
  testRoot = await makeTestDir(TEST_TMP_ROOT, "backup-consistency-");
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
  fx = await import("../support/project-fixtures");
  attachments = await import("@/lib/projects/attachments");
  cleanup = await import("@/lib/projects/file-cleanup");

  runnerOptions = {
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
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
  await prisma.$executeRaw`DELETE FROM "Attachment"`;
  await prisma.$executeRaw`DELETE FROM "TaskAttachment"`;
  await prisma.$executeRaw`DELETE FROM "Setting" WHERE key = 'branding:logo'`;
  await prisma.$executeRaw`DELETE FROM "ProjectFileCleanup"`;
  await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key IN ('backup:lease', 'backup:lastRun')`;
});

/** Every run a case started; afterEach lets each one finish before it checks for leftovers. */
const openRuns: BackupRun[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const run of openRuns.splice(0)) {
    await run.releaseAll();
    await run.done;
  }
  // Shared database hygiene: no case leaves a lease, a fence lock, a fence session or a
  // restore lock of its own behind.
  const leases = await prisma.systemSetting.count({ where: { key: "backup:lease" } });
  const locks = await fence.fenceLocks();
  const sessions = await fence.backendsNamed("aida-backup-fence");
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
// Case directories, seeded files and set inspection

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
  const data = Buffer.from(`file ${key} ${randomUUID()}`);
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
    data: { organizationId: orgId, email: `bk-${randomUUID()}@example.test` },
    select: { id: true },
  });
  const now = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      organizationId: orgId,
      number: 1,
      statusToken: randomUUID(),
      subject: "Backup fixture",
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

async function addTaskAttachment(c: Case, w: World): Promise<{ id: string; key: string }> {
  const key = await storeFile(c, w.orgId, "png");
  const row = await fx.seedAttachment(prisma, w.orgId, w.taskId, {
    uploadedByUserId: w.ownerId,
    storageKey: key,
  });
  return { id: row.id, key };
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

/** The base world of the tracer: two ticket attachments, one task attachment and a logo. */
async function seedFour(c: Case): Promise<World & { keys: string[] }> {
  const w = await seedWorld();
  const keys = [
    await addTicketAttachment(c, w),
    await addTicketAttachment(c, w),
    (await addTaskAttachment(c, w)).key,
    await setLogo(c, w),
  ];
  return { ...w, keys };
}

async function entries(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

async function publishedSets(c: Case): Promise<string[]> {
  return (await entries(c.backups)).filter((name) => SET_ID_PATTERN.test(name));
}

async function lastRun(): Promise<Record<string, unknown> | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "backup:lastRun" } });
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
}

async function readManifest(c: Case, setId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(c.backups, setId, "manifest.json"), "utf8"));
}

async function readSums(c: Case, setId: string): Promise<Map<string, string>> {
  const text = await readFile(path.join(c.backups, setId, "uploads.sha256"), "utf8");
  const sums = new Map<string, string>();
  for (const line of text.split("\n").filter((l) => l !== "")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!match) throw new Error(`unreadable checksum line: ${line}`);
    sums.set(match[2] as string, match[1] as string);
  }
  return sums;
}

async function execOk(command: string[]): Promise<string> {
  const result = await activeRunner().exec(command);
  if (result.exitCode !== 0) {
    throw new Error(`runner exec failed (${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout;
}

/** sha256 of every member, computed from the archive's contents inside the runner. */
async function archiveHashes(c: Case, setId: string): Promise<Map<string, string>> {
  const archive = `/backups/${c.backupsName}/${setId}/uploads.tar.gz`;
  const out = await execOk([
    "sh",
    "-c",
    `tar -xzf "$1" --to-command='h=$(sha256sum); printf "%s  %s\\n" "\${h%% *}" "$TAR_FILENAME"'`,
    "sh",
    archive,
  ]);
  const hashes = new Map<string, string>();
  for (const line of out.split("\n").filter((l) => l !== "")) {
    const [hash, name] = line.split("  ");
    hashes.set(name as string, hash as string);
  }
  return hashes;
}

/** Every "<orgId>/<key>" the set's dump references, by table (read with pg_restore). */
async function dumpReferences(c: Case, setId: string): Promise<Record<string, string[]>> {
  const dump = `/backups/${c.backupsName}/${setId}/db.dump`;
  const refs: Record<string, string[]> = {};
  for (const table of ["Attachment", "TaskAttachment", "Setting"]) {
    const { columns, rows } = parseCopy(
      await execOk(["pg_restore", "--data-only", `--table=${table}`, "--file=-", dump]),
    );
    const org = columns.indexOf("organizationId");
    if (table === "Setting") {
      const key = columns.indexOf("key");
      const value = columns.indexOf("value");
      refs[table] = rows
        .filter((r) => r[key] === "branding:logo")
        .map(
          (r) =>
            `${r[org]}/${(JSON.parse(r[value] as string) as { storageKey: string }).storageKey}`,
        )
        .sort();
    } else {
      const sk = columns.indexOf("storageKey");
      refs[table] = rows.map((r) => `${r[org]}/${r[sk]}`).sort();
    }
  }
  return refs;
}

/**
 * The consistency claim of AIDA-33: every Attachment, TaskAttachment and logo record in the set's
 * dump has its file in the set's archive, and both uploads.sha256 and the archived bytes match
 * the sha256 of the original bytes.
 */
async function expectConsistentSet(c: Case, setId: string): Promise<Record<string, string[]>> {
  const refs = await dumpReferences(c, setId);
  const sums = await readSums(c, setId);
  const archived = await archiveHashes(c, setId);
  expect([...archived.keys()].sort()).toEqual([...sums.keys()].sort());
  for (const ref of Object.values(refs).flat()) {
    const original = c.originals.get(ref);
    expect(original, `original bytes for ${ref}`).toBeDefined();
    const want = sha256Hex(original as Buffer);
    expect({ ref, sum: sums.get(ref), archived: archived.get(ref) }).toEqual({
      ref,
      sum: want,
      archived: want,
    });
  }
  return refs;
}

function expectQuietOutput(result: RunResult): void {
  const text = `${result.stdout}\n${result.stderr}`;
  for (const line of result.stdout.split("\n").filter((l) => l !== "")) {
    expect(line).toMatch(/^\[backup\] /);
  }
  expect(result.stderr).toBe("");
  expect(text).not.toContain("/backups");
  expect(text).not.toContain("/data/uploads");
  expect(text).not.toContain("127.0.0.1");
  expect(text).not.toMatch(/postgres(ql)?:\/\//);
  expect(text).not.toMatch(/ERROR|FATAL/);
}

function runIn(
  c: Case,
  opts: { pauseAt?: readonly PausePoint[]; env?: Record<string, string> } = {},
): BackupRun {
  const run = activeRunner().runBackup({
    uploads: c.uploadsName,
    backups: c.backupsName,
    pauseAt: opts.pauseAt,
    env: opts.env,
  });
  openRuns.push(run);
  return run;
}

// ---------------------------------------------------------------------------------------------

describe("backup tracer", () => {
  it(
    "one run publishes one validated set covering ticket attachments, task attachments and the logo, and records succeeded",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const result = await runIn(c).done;
      expect(result.exitCode, result.stdout).toBe(0);
      expectQuietOutput(result);

      const sets = await publishedSets(c);
      expect(sets).toHaveLength(1);
      const setId = sets[0] as string;
      expect(await entries(c.backups)).toEqual([setId]);
      expect(await entries(path.join(c.backups, setId))).toEqual([
        "db.dump",
        "manifest.json",
        "uploads.sha256",
        "uploads.tar.gz",
      ]);
      const manifest = await readManifest(c, setId);
      expect(manifest).toMatchObject({
        setId,
        appVersion: JSON.parse(
          await readFile(path.join(TEST_TMP_ROOT, "..", "package.json"), "utf8"),
        ).version,
        counts: { referencedFiles: 4, archivedFiles: 4, skippedEntries: 1 },
      });
      expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      for (const file of ["db.dump", "uploads.tar.gz", "uploads.sha256"]) {
        const bytes = await readFile(path.join(c.backups, setId, file));
        expect((manifest.files as Record<string, unknown>)[file]).toEqual({
          sha256: sha256Hex(bytes),
          size: bytes.byteLength,
        });
      }
      const refs = await expectConsistentSet(c, setId);
      expect(refs).toEqual({
        Attachment: [`${w.orgId}/${w.keys[0]}`, `${w.orgId}/${w.keys[1]}`].sort(),
        TaskAttachment: [`${w.orgId}/${w.keys[2]}`],
        Setting: [`${w.orgId}/${w.keys[3]}`],
      });
      // The marker is never archived.
      expect([...(await readSums(c, setId)).keys()].sort()).toEqual(
        w.keys.map((k) => `${w.orgId}/${k}`).sort(),
      );

      const status = await lastRun();
      expect(status).toEqual({
        finishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        result: "succeeded",
        setId,
        category: null,
      });
      expect(Object.keys(status ?? {})).toEqual(["finishedAt", "result", "setId", "category"]);
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// Task 2: add, replace and delete while the run waits at each pause point (D-02, AIDA-33), one
// negative control per stored-file kind (U-14), a file nobody references vanishing (U-13), and
// the empty edge.

/** Every queued key is due: the queue's nextAttemptAt defaults to now(). */
const FUTURE = new Date("2031-03-01T00:00:00.000Z");

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return false;
    throw err;
  }
}

function fileOf(c: Case, orgId: string, key: string): string {
  return path.join(c.uploads, orgId, key);
}

/** The real fenced sweep over the case's uploads directory (mount check replaced only). */
async function sweep(c: Case) {
  const tracked = fence.trackFence(fence.testFenceProvider(c.uploads));
  const result = await cleanup.sweepProjectFileCleanup({
    client: prisma,
    storage: c.storage,
    fence: tracked.fence,
    now: FUTURE,
  });
  await tracked.allClosed();
  return result;
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

async function queuedKeys(orgId: string): Promise<string[]> {
  const rows = await prisma.projectFileCleanup.findMany({
    where: { organizationId: orgId },
    select: { storageKey: true },
    orderBy: { storageKey: "asc" },
  });
  return rows.map((r) => r.storageKey);
}

async function expectFailedRun(
  c: Case,
  result: RunResult,
  category: string,
  line: string,
  /**
   * The set id of a run that lost its lease: it writes no backup:lastRun (D-04, P6; plan 09-13),
   * but K143 (F3) makes it leave the unrecorded line and status-unrecorded-<setId>.json, exit 5.
   */
  leaseLostSetId?: string,
): Promise<void> {
  if (leaseLostSetId !== undefined) {
    expect(result.exitCode, result.stdout).toBe(5);
    expectQuietOutput({ ...result, stderr: "" });
    expect(result.stdout).toContain(line);
    expect(result.stdout).toContain(`[backup] backup failed: ${category}`);
    const lines = result.stderr.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    const unrecorded = /^AIDA_BACKUP_STATUS_UNRECORDED (\{.*\})$/.exec(lines[0] as string);
    expect(unrecorded, result.stderr).not.toBeNull();
    const record = { finishedAt: expect.any(String), result: "failed", setId: null, category };
    expect(JSON.parse((unrecorded as RegExpExecArray)[1] as string)).toEqual(record);
    const file = `status-unrecorded-${leaseLostSetId}.json`;
    expect(await entries(c.backups)).toEqual([file]);
    expect(JSON.parse(await readFile(path.join(c.backups, file), "utf8"))).toEqual(record);
    expect(await lastRun()).toBeNull();
    return;
  }
  expect(result.exitCode, result.stdout).toBe(2);
  expectQuietOutput(result);
  expect(result.stdout).toContain(line);
  expect(result.stdout).toContain(`[backup] backup failed: ${category}`);
  expect(await publishedSets(c)).toEqual([]);
  // Nothing published and the run's own temporary directory removed.
  expect(await entries(c.backups)).toEqual([]);
  expect(await lastRun()).toEqual({
    finishedAt: expect.any(String),
    result: "failed",
    setId: null,
    category,
  });
}

async function expectSucceededRun(c: Case, result: RunResult): Promise<string> {
  expect(result.exitCode, result.stdout).toBe(0);
  expectQuietOutput(result);
  const sets = await publishedSets(c);
  expect(sets).toHaveLength(1);
  const setId = sets[0] as string;
  expect(await entries(c.backups)).toEqual([setId]);
  expect(await lastRun()).toEqual({
    finishedAt: expect.any(String),
    result: "succeeded",
    setId,
    category: null,
  });
  return setId;
}

describe("mid-backup add, replace and delete (D-02, AIDA-33)", () => {
  for (const point of ["after-fence", "after-dump", "after-list", "after-archive"] as const) {
    it(
      `${point}: rows and files added, the logo replaced and a task attachment deleted while the run waits; the sweep deletes nothing; every dumped record has its file and checksum in the set`,
      async () => {
        const c = await newCase();
        const w = await seedFour(c);
        const oldLogo = w.keys[3] as string;
        const doomed = await addTaskAttachment(c, w);

        const run = runIn(c, { pauseAt: [point] });
        await run.waitReached(point);

        const addedTicketKey = await addTicketAttachment(c, w);
        const addedTask = await addTaskAttachment(c, w);
        const newLogo = await replaceLogo(c, w, oldLogo, 2);
        expect(
          await attachments.deleteTaskAttachment(fx.actorOf(w.ownerId, w.orgId), doomed.id),
        ).toEqual({ ok: true, cleanupQueued: 1 });
        expect(await queuedKeys(w.orgId)).toEqual([oldLogo, doomed.key].sort());

        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await sweep(c)).toEqual({
          deleted: 0,
          missing: 0,
          failed: 0,
          skipped: "backup-archiving",
        });
        for (const key of [oldLogo, doomed.key]) {
          expect(await exists(fileOf(c, w.orgId, key))).toBe(true);
        }
        expect(await queuedKeys(w.orgId)).toEqual([oldLogo, doomed.key].sort());

        await run.go(point);
        const result = await run.done;
        const setId = await expectSucceededRun(c, result);
        const refs = await expectConsistentSet(c, setId);

        // What the dump holds depends on where the run waited: before the dump it sees the
        // changes, from after-dump on it holds the earlier state, whose files were still there.
        const ticketKeys = [w.keys[0], w.keys[1]].map((k) => `${w.orgId}/${k}`);
        if (point === "after-fence") {
          expect(refs).toEqual({
            Attachment: [...ticketKeys, `${w.orgId}/${addedTicketKey}`].sort(),
            TaskAttachment: [`${w.orgId}/${w.keys[2]}`, `${w.orgId}/${addedTask.key}`].sort(),
            Setting: [`${w.orgId}/${newLogo}`],
          });
        } else {
          expect(refs).toEqual({
            Attachment: ticketKeys.sort(),
            TaskAttachment: [`${w.orgId}/${w.keys[2]}`, `${w.orgId}/${doomed.key}`].sort(),
            Setting: [`${w.orgId}/${oldLogo}`],
          });
        }
        const manifest = await readManifest(c, setId);
        expect((manifest.counts as Record<string, number>).referencedFiles).toBe(
          Object.values(refs).flat().length,
        );

        // After the run the fence and the lease are gone and the sweep deletes the queued keys.
        expect(await sweep(c)).toEqual({ deleted: 2, missing: 0, failed: 0 });
        for (const key of [oldLogo, doomed.key]) {
          expect(await exists(fileOf(c, w.orgId, key))).toBe(false);
        }
        expect(await queuedKeys(w.orgId)).toEqual([]);
      },
      CASE_TIMEOUT,
    );
  }
});

describe("verification covers every stored-file kind (U-14)", () => {
  const kinds = [
    { kind: "ticket attachment", index: 0 },
    { kind: "task attachment", index: 2 },
    { kind: "logo", index: 3 },
  ] as const;
  for (const { kind, index } of kinds) {
    it(
      `negative control, ${kind}: its referenced file removed behind the queue's back at after-dump fails the set with category verification and publishes nothing`,
      async () => {
        const c = await newCase();
        const w = await seedFour(c);
        const run = runIn(c, { pauseAt: ["after-dump"] });
        await run.waitReached("after-dump");
        await unlink(fileOf(c, w.orgId, w.keys[index] as string));
        await run.go("after-dump");
        const result = await run.done;
        await expectFailedRun(
          c,
          result,
          "verification",
          "[backup] verification: 1 referenced files missing from the archive",
        );
      },
      CASE_TIMEOUT,
    );
  }
});

describe("archive tolerance and odd entries (U-13, T-09-21)", () => {
  it(
    "U-13: a file no row references, removed at after-list, leaves the run succeeded and is in neither the archive nor uploads.sha256",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await storeFile(c, w.orgId, "bin");
      const run = runIn(c, { pauseAt: ["after-list"] });
      await run.waitReached("after-list");
      await unlink(fileOf(c, w.orgId, loose));
      await run.go("after-list");
      const result = await run.done;
      const setId = await expectSucceededRun(c, result);
      await expectConsistentSet(c, setId);
      const sums = await readSums(c, setId);
      expect(sums.has(`${w.orgId}/${loose}`)).toBe(false);
      expect((await archiveHashes(c, setId)).has(`${w.orgId}/${loose}`)).toBe(false);
      expect((await readManifest(c, setId)).counts).toEqual({
        referencedFiles: 4,
        archivedFiles: 4,
        skippedEntries: 1,
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "only regular files at <organizationId>/<storageKey> are archived; the marker, links, nested directories and other names are counted as skipped",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const orgDir = path.join(c.uploads, w.orgId);
      await symlink(path.join(orgDir, w.keys[0] as string), path.join(orgDir, "link0.txt"));
      await mkdir(path.join(orgDir, "nested0.dir"));
      await writeFile(path.join(orgDir, "nested0.dir", "deep0.txt"), "deep");
      await writeFile(path.join(orgDir, "UPPER0.txt"), "upper");
      await writeFile(path.join(orgDir, "with space.txt"), "space");
      await writeFile(path.join(c.uploads, "stray0.txt"), "stray");
      await mkdir(path.join(c.uploads, "bad.name"));
      const result = await runIn(c).done;
      const setId = await expectSucceededRun(c, result);
      await expectConsistentSet(c, setId);
      expect([...(await readSums(c, setId)).keys()].sort()).toEqual(
        w.keys.map((k) => `${w.orgId}/${k}`).sort(),
      );
      // Marker, stray0.txt, bad.name at the top; link0.txt, nested0.dir, UPPER0.txt and
      // "with space.txt" inside the organization directory.
      expect((await readManifest(c, setId)).counts).toEqual({
        referencedFiles: 4,
        archivedFiles: 4,
        skippedEntries: 7,
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "empty: no attachment, no logo and an uploads directory holding only the marker give a succeeded set with counts 0",
    async () => {
      const c = await newCase();
      const result = await runIn(c).done;
      const setId = await expectSucceededRun(c, result);
      expect(await expectConsistentSet(c, setId)).toEqual({
        Attachment: [],
        TaskAttachment: [],
        Setting: [],
      });
      expect((await readManifest(c, setId)).counts).toEqual({
        referencedFiles: 0,
        archivedFiles: 0,
        skippedEntries: 1,
      });
      expect(await readSums(c, setId)).toEqual(new Map());
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// Task 3: U-12 with the real script (09-04 fence contract G2 to G4, review P2) and the D-02(5)
// crash rule. Each case asserts, in its own assertion set: the run's exit code, the published
// set count, `backup:lastRun`, whether the sweep deleted, and which fence locks and sessions are
// held (pg_locks and pg_stat_activity by application_name).
//
// Limit L1 of 09-04 is not tested: a run that is paused, has lost its fence session and whose
// lease expired, all at once, lifts the fence by construction. That run aborts on lease loss when
// it resumes, and verification refuses a set missing a referenced file.

const BACKUP_FENCE = "aida-backup-fence";
const DELETE_FENCE = "aida-delete-fence";

async function leaseActive(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ active: boolean }[]>(BACKUP_LEASE_ACTIVE_SQL);
  return rows[0]?.active === true;
}

async function leaseValue(): Promise<Record<string, unknown> | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "backup:lease" } });
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`waitFor: ${what} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The set id of the run's .tmp-<setId> directory in the case's backups directory. */
async function tmpSetId(c: Case): Promise<string> {
  const tmp = (await entries(c.backups)).filter((name) => name.startsWith(".tmp-"));
  expect(tmp).toHaveLength(1);
  const setId = (tmp[0] as string).slice(".tmp-".length);
  expect(setId).toMatch(SET_ID_PATTERN);
  return setId;
}

function backupHoldsFence(pid: number) {
  return [{ pid, applicationName: BACKUP_FENCE, mode: "ExclusiveLock", granted: true }];
}

async function oneBackupFencePid(): Promise<number> {
  const pids = await fence.backendsNamed(BACKUP_FENCE);
  expect(pids).toHaveLength(1);
  return pids[0] as number;
}

/** A file no row references, queued for cleanup (due), as a dereferenced file would be. */
async function queuedLooseFile(c: Case, w: World): Promise<string> {
  const key = await storeFile(c, w.orgId, "bin");
  await fx.seedFileCleanup(prisma, w.orgId, key);
  return key;
}

/** A storage over the case directory whose delete of one key waits for `gate`. */
function gatedStorage(c: Case, gatedKey: string, gate: Promise<void>): FileStorage {
  return {
    save: (p) => c.storage.save(p),
    read: (p) => c.storage.read(p),
    async delete(p) {
      if (p.key === gatedKey) await gate;
      await c.storage.delete(p);
    },
  };
}

describe("U-12 fence with the real script", () => {
  it(
    "G2 dropped session: the run's fence session is terminated; its unexpired lease still blocks the sweep, and the run logs the loss, publishes a consistent set and succeeds",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      // A due queue row whose key the dump references.
      const referenced = w.keys[2] as string;
      await fx.seedFileCleanup(prisma, w.orgId, referenced);
      const run = runIn(c, { pauseAt: ["after-dump"], env: { BACKUP_LEASE_TTL_SECONDS: "30" } });
      await run.waitReached("after-dump");
      const setId = await tmpSetId(c);
      const pid = await oneBackupFencePid();
      expect(await fence.fenceLocks()).toEqual(backupHoldsFence(pid));
      expect(await leaseValue()).toEqual({ holder: setId, expiresAt: expect.any(String) });

      await prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
      await waitFor(async () => (await fence.backendsNamed(BACKUP_FENCE)).length === 0, "gone");
      expect(await fence.fenceLocks()).toEqual([]);
      expect(await leaseActive()).toBe(true);

      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await sweep(c)).toEqual({
        deleted: 0,
        missing: 0,
        failed: 0,
        skipped: "backup-lease",
      });
      expect(await exists(fileOf(c, w.orgId, referenced))).toBe(true);

      await run.go("after-dump");
      const result = await run.done;
      expect(result.stdout).toContain(
        "[backup] fence session lost; the lease still fenced deletions",
      );
      expect(await expectSucceededRun(c, result)).toBe(setId);
      await expectConsistentSet(c, setId);
      expect((await readSums(c, setId)).has(`${w.orgId}/${referenced}`)).toBe(true);
      expect(await leaseValue()).toBeNull();
      expect(await fence.fenceLocks()).toEqual([]);
      expect(await fence.backendsNamed(BACKUP_FENCE)).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "G3 paused: with the runner container paused past its lease TTL, the frozen fence session still blocks the sweep; after unpause the run aborts on lease loss, publishes nothing, leaves the unrecorded line and file (K143), and the next sweep deletes",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await queuedLooseFile(c, w);
      const r = activeRunner();
      const run = runIn(c, { pauseAt: ["after-dump"], env: { BACKUP_LEASE_TTL_SECONDS: "4" } });
      await run.waitReached("after-dump");
      const setId = await tmpSetId(c);
      const pid = await oneBackupFencePid();
      expect(await leaseValue()).toEqual({ holder: setId, expiresAt: expect.any(String) });

      const pausedAt = Date.now();
      await r.pause();
      try {
        await waitFor(async () => !(await leaseActive()), "lease expired", 15_000);
        expect(await leaseValue()).toEqual({ holder: setId, expiresAt: expect.any(String) });
        expect(await fence.fenceLocks()).toEqual(backupHoldsFence(pid));
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await sweep(c)).toEqual({
          deleted: 0,
          missing: 0,
          failed: 0,
          skipped: "backup-archiving",
        });
        expect(await exists(fileOf(c, w.orgId, loose))).toBe(true);
        const left = 10_000 - (Date.now() - pausedAt);
        if (left > 0) await new Promise((res) => setTimeout(res, left));
      } finally {
        await r.unpause();
      }

      await run.go("after-dump");
      const result = await run.done;
      await expectFailedRun(c, result, "unknown", "[backup] backup aborted: lease lost", setId);
      expect(await leaseValue()).toBeNull();
      expect(await fence.fenceLocks()).toEqual([]);
      expect(await fence.backendsNamed(BACKUP_FENCE)).toEqual([]);
      expect(await sweep(c)).toEqual({ deleted: 1, missing: 0, failed: 0 });
      expect(await exists(fileOf(c, w.orgId, loose))).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "G4 io timeout: a sweep delete still running past its I/O budget holds the run at its fence step until the delete settles; then the run succeeds",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await queuedLooseFile(c, w);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const gate = deferred<void>();
      const tracked = fence.trackFence(fence.testFenceProvider(c.uploads));
      try {
        expect(
          await cleanup.sweepProjectFileCleanup({
            client: prisma,
            storage: gatedStorage(c, loose, gate.promise),
            fence: tracked.fence,
            now: FUTURE,
            ioBudgetMs: 300,
          }),
        ).toEqual({ deleted: 0, missing: 0, failed: 1 });
        const held = await fence.fenceLocks();
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({
          applicationName: DELETE_FENCE,
          mode: "ShareLock",
          granted: true,
        });
        const sweepPid = (held[0] as { pid: number }).pid;

        const run = runIn(c, {
          pauseAt: ["after-fence"],
          env: { BACKUP_FENCE_WAIT_SECONDS: "60" },
        });
        await waitFor(async () => (await fence.backendsNamed(BACKUP_FENCE)).length === 1, "fence");
        const backupPid = await oneBackupFencePid();
        await waitForBlockedBy(prisma, sweepPid, [backupPid]);
        const watchUntil = Date.now() + 5_000;
        while (Date.now() < watchUntil) {
          expect(await run.hasReached("after-fence")).toBe(false);
          await new Promise((res) => setTimeout(res, 250));
        }
        expect(await fence.fenceLocks()).toEqual(
          [
            { pid: sweepPid, applicationName: DELETE_FENCE, mode: "ShareLock", granted: true },
            {
              pid: backupPid,
              applicationName: BACKUP_FENCE,
              mode: "ExclusiveLock",
              granted: false,
            },
          ].sort((a, b) => a.pid - b.pid),
        );
        expect(await leaseValue()).toBeNull();
        expect(await exists(fileOf(c, w.orgId, loose))).toBe(true);

        gate.resolve();
        await tracked.allClosed();
        await run.waitReached("after-fence");
        expect(await fence.fenceLocks()).toEqual(backupHoldsFence(backupPid));
        expect(await exists(fileOf(c, w.orgId, loose))).toBe(false);
        await run.go("after-fence");
        const result = await run.done;
        const setId = await expectSucceededRun(c, result);
        await expectConsistentSet(c, setId);
        expect(await fence.fenceLocks()).toEqual([]);
      } finally {
        gate.resolve();
        await tracked.allClosed();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "fence busy: with the delete never settling during the run, the run fails 'file fence busy' after BACKUP_FENCE_WAIT_SECONDS, publishes nothing and leaves no lease",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await queuedLooseFile(c, w);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const gate = deferred<void>();
      const tracked = fence.trackFence(fence.testFenceProvider(c.uploads));
      try {
        expect(
          await cleanup.sweepProjectFileCleanup({
            client: prisma,
            storage: gatedStorage(c, loose, gate.promise),
            fence: tracked.fence,
            now: FUTURE,
            ioBudgetMs: 300,
          }),
        ).toEqual({ deleted: 0, missing: 0, failed: 1 });
        const started = Date.now();
        const result = await runIn(c, { env: { BACKUP_FENCE_WAIT_SECONDS: "3" } }).done;
        expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
        await expectFailedRun(c, result, "unknown", "[backup] file fence busy");
        expect(await leaseValue()).toBeNull();
        expect(await fence.backendsNamed(BACKUP_FENCE)).toEqual([]);
        const held = await fence.fenceLocks();
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({ applicationName: DELETE_FENCE, granted: true });
        expect(await exists(fileOf(c, w.orgId, loose))).toBe(true);
      } finally {
        gate.resolve();
        await tracked.allClosed();
      }
      expect(await fence.fenceLocks()).toEqual([]);
      expect(await exists(fileOf(c, w.orgId, loose))).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "crash (D-02(5)): a killed run releases its fence with the process and publishes nothing; its lease blocks the sweep until the TTL passes; then the sweep deletes and a new runner's run takes the expired lease and succeeds",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await queuedLooseFile(c, w);
      const crashRunner = await startBackupRunner(runnerOptions);
      try {
        const run = crashRunner.runBackup({
          uploads: c.uploadsName,
          backups: c.backupsName,
          pauseAt: ["after-dump"],
          env: { BACKUP_LEASE_TTL_SECONDS: "4" },
        });
        openRuns.push(run);
        await run.waitReached("after-dump");
        const killedSetId = await tmpSetId(c);
        expect(await fence.fenceLocks()).toEqual(backupHoldsFence(await oneBackupFencePid()));

        await crashRunner.kill();
        const killed = await run.done;
        expect(killed.exitCode).not.toBe(0);
        await waitFor(async () => (await fence.fenceLocks()).length === 0, "fence released");
        expect(await fence.backendsNamed(BACKUP_FENCE)).toEqual([]);
        expect(await leaseValue()).toEqual({ holder: killedSetId, expiresAt: expect.any(String) });
        expect(await publishedSets(c)).toEqual([]);
        expect(await entries(c.backups)).toEqual([`.tmp-${killedSetId}`]);
        // The killed run recorded nothing.
        expect(await lastRun()).toBeNull();

        vi.spyOn(console, "error").mockImplementation(() => {});
        if (await leaseActive()) {
          expect(await sweep(c)).toEqual({
            deleted: 0,
            missing: 0,
            failed: 0,
            skipped: "backup-lease",
          });
          expect(await exists(fileOf(c, w.orgId, loose))).toBe(true);
        }
        await waitFor(async () => !(await leaseActive()), "lease expired", 15_000);
        expect(await leaseValue()).toEqual({ holder: killedSetId, expiresAt: expect.any(String) });
        expect(await sweep(c)).toEqual({ deleted: 1, missing: 0, failed: 0 });
        expect(await exists(fileOf(c, w.orgId, loose))).toBe(false);

        const result = await runIn(c).done;
        expect(result.exitCode, result.stdout).toBe(0);
        expectQuietOutput(result);
        const sets = await publishedSets(c);
        expect(sets).toHaveLength(1);
        const setId = sets[0] as string;
        expect(setId).not.toBe(killedSetId);
        // The new run's retention (plan 09-13, D-03) removed the killed run's stale temp directory.
        expect(await entries(c.backups)).toEqual([setId]);
        expect(await lastRun()).toEqual({
          finishedAt: expect.any(String),
          result: "succeeded",
          setId,
          category: null,
        });
        await expectConsistentSet(c, setId);
        expect(await leaseValue()).toBeNull();
      } finally {
        await crashRunner.stop();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "takeover (P2): another holder overwrites the lease while the run waits at after-archive; the run aborts on lease loss, publishes nothing and leaves the other holder's lease unchanged",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await queuedLooseFile(c, w);
      const run = runIn(c, { pauseAt: ["after-archive"] });
      await run.waitReached("after-archive");
      const setId = await tmpSetId(c);
      const pid = await oneBackupFencePid();
      expect(await leaseValue()).toEqual({ holder: setId, expiresAt: expect.any(String) });

      await prisma.$executeRaw`
        UPDATE "SystemSetting"
        SET value = json_build_object(
          'holder', 'another-backup',
          'expiresAt', to_char((now() + interval '120 seconds') AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,
            "updatedAt" = now()
        WHERE key = 'backup:lease'`;
      const takenOver = await prisma.systemSetting.findUniqueOrThrow({
        where: { key: "backup:lease" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await sweep(c)).toEqual({
        deleted: 0,
        missing: 0,
        failed: 0,
        skipped: "backup-archiving",
      });
      expect(await fence.fenceLocks()).toEqual(backupHoldsFence(pid));

      await run.go("after-archive");
      const result = await run.done;
      await expectFailedRun(c, result, "unknown", "[backup] backup aborted: lease lost", setId);
      expect(
        await prisma.systemSetting.findUniqueOrThrow({ where: { key: "backup:lease" } }),
      ).toEqual(takenOver);
      expect(await fence.fenceLocks()).toEqual([]);
      expect(await fence.backendsNamed(BACKUP_FENCE)).toEqual([]);
      // The other holder's unexpired lease still refuses the sweep.
      expect(await sweep(c)).toEqual({
        deleted: 0,
        missing: 0,
        failed: 0,
        skipped: "backup-lease",
      });
      expect(await exists(fileOf(c, w.orgId, loose))).toBe(true);
      await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = 'backup:lease'`;
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// K143 (F3, b-WR-1, b-WR-2): the lease renewal follows the run. A killed main shell lets the lease
// expire; one transient renewal error is retried within the lease margin.

describe("K143 run liveness with the real script", () => {
  it(
    "main killed: with only the script's main shell killed (kill -9 inside the runner) the renewal stops, the lease expires within one TTL, the fence session ends and the next sweep deletes",
    async () => {
      const c = await newCase();
      const w = await seedFour(c);
      const loose = await queuedLooseFile(c, w);
      const r = activeRunner();
      const run = runIn(c, { pauseAt: ["after-dump"], env: { BACKUP_LEASE_TTL_SECONDS: "6" } });
      await run.waitReached("after-dump");
      const setId = await tmpSetId(c);
      expect(await leaseValue()).toEqual({ holder: setId, expiresAt: expect.any(String) });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await sweep(c)).toEqual({
        deleted: 0,
        missing: 0,
        failed: 0,
        skipped: "backup-archiving",
      });

      const pid = await run.mainPid("after-dump");
      const killed = await r.exec(["sh", "-c", `kill -9 ${pid}`]);
      expect(killed.exitCode, killed.stderr).toBe(0);
      const result = await run.done;
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("backup succeeded");

      // The fence session ends with the main shell (its statement FIFO lost the only writer).
      await waitFor(
        async () => (await fence.backendsNamed(BACKUP_FENCE)).length === 0,
        "fence session gone",
      );
      // No renewal after the kill: the lease expires within one TTL (6 s) and stays expired.
      await waitFor(async () => !(await leaseActive()), "lease expired", 12_000);
      const expired = await leaseValue();
      expect(expired).toEqual({ holder: setId, expiresAt: expect.any(String) });
      await new Promise((res) => setTimeout(res, 4_500));
      expect(await leaseValue()).toEqual(expired);
      expect(await fence.fenceLocks()).toEqual([]);

      expect(await sweep(c)).toEqual({ deleted: 1, missing: 0, failed: 0 });
      expect(await exists(fileOf(c, w.orgId, loose))).toBe(false);
      // The killed run released nothing itself: its expired lease row is removed here.
      await prisma.$executeRaw`DELETE FROM "SystemSetting" WHERE key = 'backup:lease'`;
    },
    CASE_TIMEOUT,
  );

  it(
    "one renewal error: with new connections to the database refused across one renewal, the renewal retries, the run keeps its lease, logs the retry and succeeds",
    async () => {
      const c = await newCase();
      await seedFour(c);
      const run = runIn(c, { pauseAt: ["after-dump"], env: { BACKUP_LEASE_TTL_SECONDS: "15" } });
      await run.waitReached("after-dump");
      const setId = await tmpSetId(c);
      // Start right after a confirmed renewal (every 5 s), so the refusal covers the next one.
      const first = (await leaseValue())?.expiresAt;
      await waitFor(async () => (await leaseValue())?.expiresAt !== first, "a renewal", 10_000);
      const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
      const db = (rows[0] as { db: string }).db;
      expect(db).toMatch(/^[A-Za-z0-9_]+$/);
      // Postgres refuses this from a session on the same database: the shared one issues it.
      const admin = new pg.Client({ connectionString: savedEnv.DATABASE_URL });
      await admin.connect();
      try {
        await admin.query(`ALTER DATABASE "${db}" WITH ALLOW_CONNECTIONS false`);
        try {
          await new Promise((res) => setTimeout(res, 6_500));
        } finally {
          await admin.query(`ALTER DATABASE "${db}" WITH ALLOW_CONNECTIONS true`);
        }
      } finally {
        await admin.end();
      }
      expect(await leaseActive()).toBe(true);
      expect(await leaseValue()).toEqual({ holder: setId, expiresAt: expect.any(String) });

      await run.go("after-dump");
      const result = await run.done;
      expect(result.stdout).toContain("[backup] lease renewal failed; retrying");
      expect(await expectSucceededRun(c, result)).toBe(setId);
      await expectConsistentSet(c, setId);
      expect(await leaseValue()).toBeNull();
    },
    CASE_TIMEOUT,
  );
});
