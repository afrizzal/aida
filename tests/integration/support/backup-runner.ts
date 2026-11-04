// Test-only runner for scripts/backup/aida-backup.sh (Phase 9 plan 09-06, AIDA-33, AIDA-38).
//
// The real script runs in a pgvector/pgvector:pg16 container, the image of the db service and of
// the integration database, as user 1000:1000 (U-16). Rule J (U-07): the container is named by
// testResourceName("backup", runId), labelled with testLabels(runId) and recorded in the run's
// ledger; Ryuk stays off (docker-test-resources.ts sets it on import); the image's declared VOLUME
// gets a tmpfs, so no anonymous volume exists (K109); it publishes no port and joins no network of
// its own: it shares the network namespace of this run's integration database container
// (`container:<id>`), so the script reaches Postgres at 127.0.0.1:5432. It builds no image and
// pulls nothing: a missing local image is reported as `blocked (image)`. `docker pause`,
// `docker unpause` and `docker kill` are issued only on the id Testcontainers returned for this
// container.
//
// Directories: Colima shares only the home directory with its VM, so every bind-mounted
// directory lives under the repository's gitignored `.test-tmp/` (created with mkdtemp, mode
// 0o777 because the host user and uid 1000 differ; production ownership is plan 09-08's).
// Mounts: scripts/backup read-only at /opt/aida-backup, the uploads root read-only at
// /data/uploads, the backups root at /backups, the pause root at /pause and the repository's
// package.json read-only at /opt/aida-backup-meta/package.json. Each run points UPLOADS_DIR,
// BACKUP_DIR and BACKUP_TEST_PAUSE_DIR at subdirectories of those roots.
//
// Failure options (plan 09-13, review P11, real causes only): `backupsReadOnly` mounts the backups
// root read-only (a bind option of the same runner); `closedDatabasePort` points one run's PGPORT
// at CLOSED_DATABASE_PORT, a port nothing listens on in the database container's network
// namespace, so every connection is refused.
//
// Relative imports only.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FileStorage } from "../../../src/lib/attachments/file-storage";
import {
  recordResource,
  testLabels,
  testResourceName,
  testRunId,
} from "../../support/docker-test-labels";
import { POSTGRES_TEST_IMAGE } from "../../support/docker-test-resources";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, "../../..");
export const TEST_TMP_ROOT = path.join(PROJECT_ROOT, ".test-tmp");
const SCRIPT_DIR = path.join(PROJECT_ROOT, "scripts", "backup");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");

export const PAUSE_POINTS = ["after-fence", "after-dump", "after-list", "after-archive"] as const;
export type PausePoint = (typeof PAUSE_POINTS)[number];

export const SET_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/;

/** A TCP port nothing listens on inside the database container's network namespace. */
export const CLOSED_DATABASE_PORT = "1";

/** A fresh directory under the repository's `.test-tmp/`, writable by uid 1000. */
export async function makeTestDir(parent: string, prefix: string): Promise<string> {
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, prefix));
  await chmod(dir, 0o777);
  return dir;
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/**
 * The id of this run's integration database container: label aida.test.run=<runId>, name
 * aida-test-integration-<runId>-*, and the host port of DATABASE_URL published for 5432.
 */
export async function integrationDatabaseContainerId(): Promise<string> {
  const runId = testRunId();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("backup-runner: DATABASE_URL is not set");
  const port = new URL(url).port;
  const listed = await docker([
    "ps",
    "--filter",
    "label=aida.test=1",
    "--filter",
    `label=aida.test.run=${runId}`,
    "--filter",
    `name=aida-test-integration-${runId}-`,
    "--format",
    "{{.ID}}",
  ]);
  const matches: string[] = [];
  for (const id of listed.split("\n").filter((line) => line.trim() !== "")) {
    const ports = await docker(["port", id, "5432/tcp"]);
    if (ports.split("\n").some((line) => line.trim().endsWith(`:${port}`))) matches.push(id);
  }
  if (matches.length !== 1) {
    throw new Error(
      `backup-runner: expected one integration database container for this run, found ${matches.length}`,
    );
  }
  return matches[0] as string;
}

/** Throws `blocked (image)` when the runner image is not on the host: this suite pulls nothing. */
export async function assertRunnerImagePresent(): Promise<void> {
  try {
    await docker(["image", "inspect", "--format", "{{.Id}}", POSTGRES_TEST_IMAGE]);
  } catch {
    throw new Error(`blocked (image): ${POSTGRES_TEST_IMAGE} is not on the host`);
  }
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BackupRunOptions {
  /** Subdirectory of the uploads root (UPLOADS_DIR inside the container). */
  uploads: string;
  /** Subdirectory of the backups root (BACKUP_DIR inside the container). */
  backups: string;
  /** The points this run waits at; every other point is released in advance. */
  pauseAt?: readonly PausePoint[];
  env?: Record<string, string>;
  /** Points PGPORT at CLOSED_DATABASE_PORT for this run: the database is unreachable. */
  closedDatabasePort?: boolean;
}

export interface BackupRun {
  /** Settles when the script ends (or its container was killed). */
  readonly done: Promise<RunResult>;
  /** Resolves when the script reached the point and waits there. */
  waitReached(point: PausePoint, timeoutMs?: number): Promise<void>;
  /** True when the script has reached the point (no wait). */
  hasReached(point: PausePoint): Promise<boolean>;
  /** Lets the script continue past the point. */
  go(point: PausePoint): Promise<void>;
  /** Releases every pause point (teardown after a failed case). */
  releaseAll(): Promise<void>;
}

export interface BackupRunner {
  readonly id: string;
  readonly name: string;
  readonly uploadsRoot: string;
  readonly backupsRoot: string;
  runBackup(opts: BackupRunOptions): BackupRun;
  /** Runs a command in the runner container as uid 1000, with extra environment variables. */
  exec(command: string[], env?: Record<string, string>): Promise<RunResult>;
  pause(): Promise<void>;
  unpause(): Promise<void>;
  kill(): Promise<void>;
  stop(): Promise<void>;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export interface StartBackupRunnerOptions {
  /** Database name for PGDATABASE (the server is this run's integration database). */
  database: string;
  user: string;
  password: string;
  uploadsRoot: string;
  backupsRoot: string;
  pauseRoot: string;
  /** Mounts the backups root read-only (the storage failure cause). */
  backupsReadOnly?: boolean;
}

/** Starts one runner container per the rules in this file's header. */
export async function startBackupRunner(opts: StartBackupRunnerOptions): Promise<BackupRunner> {
  await assertRunnerImagePresent();
  const dbContainer = await integrationDatabaseContainerId();
  const runId = testRunId();
  const name = testResourceName("backup", runId);
  recordResource(runId, { type: "container", name, state: "planned" });
  const started: StartedTestContainer = await new GenericContainer(POSTGRES_TEST_IMAGE)
    .withName(name)
    .withLabels(testLabels(runId))
    .withTmpFs({ "/var/lib/postgresql/data": "rw" })
    .withNetworkMode(`container:${dbContainer}`)
    .withUser("1000:1000")
    .withEntrypoint(["sleep"])
    .withCommand(["infinity"])
    .withEnvironment({
      PGHOST: "127.0.0.1",
      PGPORT: "5432",
      PGUSER: opts.user,
      PGPASSWORD: opts.password,
      PGDATABASE: opts.database,
    })
    .withBindMounts([
      { source: SCRIPT_DIR, target: "/opt/aida-backup", mode: "ro" },
      { source: PACKAGE_JSON, target: "/opt/aida-backup-meta/package.json", mode: "ro" },
      { source: opts.uploadsRoot, target: "/data/uploads", mode: "ro" },
      { source: opts.backupsRoot, target: "/backups", mode: opts.backupsReadOnly ? "ro" : "rw" },
      { source: opts.pauseRoot, target: "/pause", mode: "rw" },
    ])
    .start();
  const id = started.getId();
  try {
    recordResource(runId, { type: "container", name, id, state: "created" });
  } catch (err) {
    await started.stop();
    throw err;
  }

  let stopped = false;
  let paused = false;
  let runSeq = 0;

  async function exec(command: string[], env?: Record<string, string>): Promise<RunResult> {
    try {
      const result = await started.exec(command, { user: "1000:1000", env });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (err) {
      return { exitCode: -1, stdout: "", stderr: (err as Error).message };
    }
  }

  return {
    id,
    name,
    uploadsRoot: opts.uploadsRoot,
    backupsRoot: opts.backupsRoot,
    exec: (command, env) => exec(command, env),
    runBackup(run) {
      runSeq += 1;
      const pauseName = `run-${runSeq}-${randomBytes(3).toString("hex")}`;
      const hostPauseDir = path.join(opts.pauseRoot, pauseName);
      const prepared = (async () => {
        await mkdir(hostPauseDir);
        await chmod(hostPauseDir, 0o777);
        for (const point of PAUSE_POINTS) {
          if (!run.pauseAt?.includes(point))
            await writeFile(path.join(hostPauseDir, `${point}.go`), "");
        }
      })();
      const done = prepared.then(() =>
        exec(["sh", "/opt/aida-backup/aida-backup.sh"], {
          UPLOADS_DIR: `/data/uploads/${run.uploads}`,
          BACKUP_DIR: `/backups/${run.backups}`,
          BACKUP_TEST_PAUSE_DIR: `/pause/${pauseName}`,
          ...run.env,
          ...(run.closedDatabasePort ? { PGPORT: CLOSED_DATABASE_PORT } : {}),
        }),
      );
      return {
        done,
        async hasReached(point) {
          await prepared;
          return exists(path.join(hostPauseDir, `${point}.reached`));
        },
        async waitReached(point, timeoutMs = 60_000) {
          await prepared;
          const deadline = Date.now() + timeoutMs;
          let finished = false;
          void done.then(() => {
            finished = true;
          });
          for (;;) {
            if (await exists(path.join(hostPauseDir, `${point}.reached`))) return;
            if (finished) {
              const result = await done;
              throw new Error(
                `backup-runner: the run ended (exit ${result.exitCode}) before ${point}: ${result.stdout}`,
              );
            }
            if (Date.now() >= deadline) {
              throw new Error(`backup-runner: ${point} not reached within ${timeoutMs} ms`);
            }
            await new Promise((r) => setTimeout(r, 50));
          }
        },
        async go(point) {
          await prepared;
          await writeFile(path.join(hostPauseDir, `${point}.go`), "");
        },
        async releaseAll() {
          await prepared;
          for (const point of PAUSE_POINTS) {
            await writeFile(path.join(hostPauseDir, `${point}.go`), "");
          }
        },
      };
    },
    async pause() {
      await docker(["pause", id]);
      paused = true;
    },
    async unpause() {
      await docker(["unpause", id]);
      paused = false;
    },
    async kill() {
      await docker(["kill", id]);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (paused) {
        try {
          await docker(["unpause", id]);
        } catch {
          // Already running or gone.
        }
      }
      await started.stop();
    },
  };
}

/** A FileStorage over one uploads directory, written the way local-file-storage.ts writes. */
export function directoryStorage(root: string): FileStorage {
  const safeKey = (key: string): string => {
    if (!/^[a-z0-9]+\.[a-z0-9]{1,8}$/.test(key)) throw new Error("invalid attachment key");
    return key;
  };
  return {
    async save({ orgId, key, data }) {
      const dir = path.join(root, orgId);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, safeKey(key)), data, { flag: "wx" });
      return { key, sizeBytes: data.byteLength };
    },
    async read({ orgId, key }) {
      return readFile(path.join(root, orgId, safeKey(key)));
    },
    async delete({ orgId, key }) {
      await unlink(path.join(root, orgId, safeKey(key)));
    },
  };
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Rows of a pg_restore COPY section: column names and the tab-separated values. */
export function parseCopy(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line.startsWith("COPY "));
  if (header < 0) throw new Error("parseCopy: no COPY section");
  const match = /\((.*)\) FROM stdin;$/.exec(lines[header] as string);
  if (!match) throw new Error("parseCopy: unreadable COPY header");
  const columns = (match[1] as string).split(", ").map((c) => c.replaceAll('"', ""));
  const rows: string[][] = [];
  for (const line of lines.slice(header + 1)) {
    if (line === "\\.") break;
    rows.push(line.split("\t"));
  }
  return { columns, rows };
}
