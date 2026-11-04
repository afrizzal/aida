// Phase 9 plan 09-08 (AIDA-33, D-01, U-16): the `backup` and `backup-init` services as
// `docker compose config` renders them.
//
// Renders docker-compose.yml with temporary env files and parses the JSON in memory. Starts no
// container and creates no Docker resource (rule J, U-15): `docker compose config` only reads
// files. The password is synthetic. Assertions pass only a service name and a boolean to `expect`,
// so a failure can never print the password or a host path. Running the service in a real stack is
// specified by plan 09-11: not run (waiting for the Phase 8.1 harness and the owner).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const COMPOSE_FILE = path.join(PROJECT_ROOT, "docker-compose.yml");

type Mount = { type: string; source?: string; target: string; read_only?: boolean };
type Service = {
  image?: string;
  build?: unknown;
  user?: string;
  entrypoint?: string[] | null;
  environment?: Record<string, string | null>;
  volumes?: Mount[];
  tmpfs?: string[];
  network_mode?: string;
  read_only?: boolean;
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  depends_on?: Record<string, { condition: string }>;
};

let tmpDir = "";

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aida-compose-backup-"));
});

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

/** The shell environment wins over --env-file, so no BACKUP_* or POSTGRES_* may reach compose. */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const key of ["HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "TMPDIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

let fileCounter = 0;

async function render(vars: Record<string, string>): Promise<Record<string, Service>> {
  const all: Record<string, string> = {
    BETTER_AUTH_SECRET: "test-only-secret",
    BETTER_AUTH_URL: "http://localhost",
    NEXT_PUBLIC_APP_URL: "http://localhost",
    ...vars,
  };
  for (const value of Object.values(all)) {
    if (value.includes("'")) throw new Error("env file values must not contain a single quote");
  }
  fileCounter += 1;
  const envFile = path.join(tmpDir, `case-${fileCounter}.env`);
  const body = Object.entries(all)
    .map(([key, value]) => `${key}='${value}'`)
    .join("\n");
  await fs.writeFile(envFile, `${body}\n`, { mode: 0o600 });
  let stdout: string;
  try {
    stdout = execFileSync(
      "docker",
      ["compose", "--env-file", envFile, "-f", COMPOSE_FILE, "config", "--format", "json"],
      {
        cwd: PROJECT_ROOT,
        env: cliEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch {
    // The error would carry compose's stdout and stderr; never rethrow it.
    throw new Error("docker compose config failed");
  }
  return (JSON.parse(stdout) as { services: Record<string, Service> }).services;
}

const password = () => `${randomBytes(8).toString("hex")}/@:#?${randomBytes(8).toString("hex")}`;

function mount(service: Service, target: string): Mount | undefined {
  return (service.volumes ?? []).find((m) => m.target === target);
}

describe("docker compose config renders the backup services (D-01, U-16)", () => {
  it("defaults: backup runs as 1000:1000 with the documented settings and libpq variables", async () => {
    const pw = password();
    const services = await render({ POSTGRES_PASSWORD: pw });
    const backup = services.backup;
    const env = backup?.environment ?? {};
    const checks: Record<string, boolean> = {
      present: backup !== undefined,
      image: backup?.image === "pgvector/pgvector:pg16",
      noBuild: backup?.build === undefined,
      user: backup?.user === "1000:1000",
      entrypoint: JSON.stringify(backup?.entrypoint) === '["sh","/opt/aida-backup/scheduler.sh"]',
      enabled: env.BACKUP_ENABLED === "true",
      schedule: env.BACKUP_SCHEDULE === "02:00",
      retention: env.BACKUP_RETENTION === "7",
      leaseTtl: env.BACKUP_LEASE_TTL_SECONDS === "900",
      fenceWait: env.BACKUP_FENCE_WAIT_SECONDS === "300",
      backupDir: env.BACKUP_DIR === "/backups",
      uploadsDir: env.UPLOADS_DIR === "/data/uploads",
      pgHost: env.PGHOST === "db",
      pgPort: env.PGPORT === "5432",
      pgUser: env.PGUSER === "aida",
      pgDatabase: env.PGDATABASE === "aida",
      // The raw password, not percent-encoded: libpq reads PGPASSWORD as it is.
      pgPassword: env.PGPASSWORD === pw,
      noUrl: !Object.values(env).some((v) => typeof v === "string" && /postgres(ql)?:\/\//.test(v)),
      noDatabaseUrl: !("DATABASE_URL" in env),
      noTestHook: !Object.keys(env).some((k) => k.startsWith("BACKUP_TEST_")),
    };
    for (const [name, ok] of Object.entries(checks)) expect(ok, `backup ${name}`).toBe(true);
  });

  it("mounts: uploads, scripts and package.json read-only, backups_data writable, tmpfs on the data VOLUME", async () => {
    const backup = (await render({ POSTGRES_PASSWORD: password() })).backup ?? {};
    const uploads = mount(backup, "/data/uploads");
    const scripts = mount(backup, "/opt/aida-backup");
    const meta = mount(backup, "/opt/aida-backup-meta/package.json");
    const backups = mount(backup, "/backups");
    const checks: Record<string, boolean> = {
      count: (backup.volumes ?? []).length === 4,
      uploadsVolume: uploads?.type === "volume" && uploads.source === "uploads_data",
      uploadsReadOnly: uploads?.read_only === true,
      scriptsBindReadOnly: scripts?.type === "bind" && scripts.read_only === true,
      scriptsSource: scripts?.source === path.join(PROJECT_ROOT, "scripts", "backup"),
      metaBindReadOnly: meta?.type === "bind" && meta.read_only === true,
      metaSource: meta?.source === path.join(PROJECT_ROOT, "package.json"),
      backupsVolume: backups?.type === "volume" && backups.source === "backups_data",
      backupsWritable: backups?.read_only !== true,
      tmpfs: JSON.stringify(backup.tmpfs) === '["/var/lib/postgresql/data"]',
    };
    for (const [name, ok] of Object.entries(checks)) expect(ok, `backup ${name}`).toBe(true);
  });

  it("depends on db healthy, migrate completed and backup-init completed", async () => {
    const backup = (await render({ POSTGRES_PASSWORD: password() })).backup ?? {};
    const deps = backup.depends_on ?? {};
    const checks: Record<string, boolean> = {
      db: deps.db?.condition === "service_healthy",
      migrate: deps.migrate?.condition === "service_completed_successfully",
      backupInit: deps["backup-init"]?.condition === "service_completed_successfully",
      onlyThree: Object.keys(deps).sort().join(",") === "backup-init,db,migrate",
    };
    for (const [name, ok] of Object.entries(checks))
      expect(ok, `backup depends_on ${name}`).toBe(true);
  });

  it("backup-init mounts only backups_data and has no network, a read-only root and CAP_CHOWN only", async () => {
    const services = await render({ POSTGRES_PASSWORD: password() });
    const init = services["backup-init"];
    const volumes = init?.volumes ?? [];
    const checks: Record<string, boolean> = {
      present: init !== undefined,
      image: init?.image === "pgvector/pgvector:pg16",
      user: init?.user === "0:0",
      onlyBackups:
        volumes.length === 1 &&
        volumes[0].type === "volume" &&
        volumes[0].source === "backups_data" &&
        volumes[0].target === "/backups",
      noUploads: !volumes.some((m) => m.source === "uploads_data"),
      networkNone: init?.network_mode === "none",
      readOnlyRoot: init?.read_only === true,
      capDropAll: JSON.stringify(init?.cap_drop) === '["ALL"]',
      capAddChown: JSON.stringify(init?.cap_add) === '["CHOWN"]',
      noNewPrivileges: JSON.stringify(init?.security_opt) === '["no-new-privileges:true"]',
      tmpfs: JSON.stringify(init?.tmpfs) === '["/var/lib/postgresql/data"]',
      noEnvironment: Object.keys(init?.environment ?? {}).length === 0,
      noRecursion: !(init?.entrypoint ?? []).some((part) => /\s-R\b|--recursive/.test(part)),
    };
    for (const [name, ok] of Object.entries(checks)) expect(ok, `backup-init ${name}`).toBe(true);
  });

  it("operator settings from the env file reach the service; BACKUP_ENABLED=false turns it off", async () => {
    const backup =
      (
        await render({
          POSTGRES_PASSWORD: password(),
          POSTGRES_USER: "aida_ops",
          POSTGRES_DB: "aida_ops_db",
          BACKUP_ENABLED: "false",
          BACKUP_SCHEDULE: "23:15",
          BACKUP_RETENTION: "30",
          BACKUP_LEASE_TTL_SECONDS: "1200",
          BACKUP_FENCE_WAIT_SECONDS: "60",
        })
      ).backup ?? {};
    const env = backup.environment ?? {};
    const checks: Record<string, boolean> = {
      enabled: env.BACKUP_ENABLED === "false",
      schedule: env.BACKUP_SCHEDULE === "23:15",
      retention: env.BACKUP_RETENTION === "30",
      leaseTtl: env.BACKUP_LEASE_TTL_SECONDS === "1200",
      fenceWait: env.BACKUP_FENCE_WAIT_SECONDS === "60",
      pgUser: env.PGUSER === "aida_ops",
      pgDatabase: env.PGDATABASE === "aida_ops_db",
    };
    for (const [name, ok] of Object.entries(checks)) expect(ok, `backup ${name}`).toBe(true);
  });

  it("no other service mounts backups_data, and app and worker keep uploads writable", async () => {
    const services = await render({ POSTGRES_PASSWORD: password() });
    for (const [name, service] of Object.entries(services)) {
      const mountsBackups = (service.volumes ?? []).some((m) => m.source === "backups_data");
      expect(mountsBackups === (name === "backup" || name === "backup-init"), name).toBe(true);
    }
    for (const name of ["app", "worker"]) {
      const uploads = mount(services[name] ?? {}, "/data/uploads");
      expect(uploads !== undefined && uploads.read_only !== true, `${name} uploads writable`).toBe(
        true,
      );
    }
  });
});
