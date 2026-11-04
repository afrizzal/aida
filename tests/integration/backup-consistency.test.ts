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
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FileStorage } from "@/lib/attachments/file-storage";
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

const CASE_TIMEOUT = 180_000;
const POOL_KEY = Symbol.for("aida.db.pool");
const PRISMA_KEY = Symbol.for("aida.db.prisma");

let iso: IsolatedDatabase | null = null;
let prisma: PrismaClient;
let fence: FenceFixtures;
let fx: ProjectFixtures;
let runner: BackupRunner | null = null;
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

  runner = await startBackupRunner({
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    uploadsRoot,
    backupsRoot,
    pauseRoot,
  });
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

afterEach(async () => {
  vi.restoreAllMocks();
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
  return activeRunner().runBackup({
    uploads: c.uploadsName,
    backups: c.backupsName,
    pauseAt: opts.pauseAt,
    env: opts.env,
  });
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
