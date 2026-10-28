// Isolated databases for integration tests that need their own schema state (plan 08-03, D-02).
//
// Each call creates a fresh database on the shared Testcontainers server (the one
// tests/integration/global-setup.ts started and put in DATABASE_URL), migrates it with the real
// `prisma migrate deploy`, and asserts the exact set of applied migration names, so a wrong
// migrations path fails loudly instead of silently testing the wrong schema.
//
// A subset of migrations is deployed from a copy of the listed folders through
// tests/support/prisma-migrate-test.config.ts (the config ticket-states-deploy.test.ts already
// proved: schema and migrations path both come from the environment). Head uses the repository's
// own prisma.config.ts.
//
// Node built-ins plus `pg` only; nothing under src/ is imported here.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "prisma", "migrations");
const SCHEMA_PATH = path.join(PROJECT_ROOT, "prisma", "schema.prisma");
const SUBSET_CONFIG = "tests/support/prisma-migrate-test.config.ts";
const CLI_TIMEOUT = 240_000;

export interface IsolatedDatabase {
  url: string;
  drop: () => Promise<void>;
}

function baseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("isolated-database: DATABASE_URL is not set (global setup did not run)");
  return url;
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Every migration directory under prisma/migrations, sorted the way Prisma applies them. */
function headMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(path.join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort();
}

function runDeploy(url: string, args: string[], extraEnv: Record<string, string> = {}): void {
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy", ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...extraEnv, DATABASE_URL: url },
    encoding: "utf8",
    timeout: CLI_TIMEOUT,
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy exited ${String(result.status)}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

async function assertAppliedMigrations(url: string, expected: readonly string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ migration_name: string }>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name",
    );
    const actual = rows.map((row) => row.migration_name);
    const want = [...expected].sort();
    if (actual.length !== want.length || actual.some((name, i) => name !== want[i])) {
      throw new Error(
        `isolated-database: applied migrations differ from the expected set\nexpected: ${JSON.stringify(want)}\nactual:   ${JSON.stringify(actual)}`,
      );
    }
  } finally {
    await client.end();
  }
}

/** Runs the repository's `prisma migrate deploy` on `url`, then asserts every migration is applied. */
export async function deployHeadMigrations(url: string): Promise<void> {
  runDeploy(url, []);
  await assertAppliedMigrations(url, headMigrationNames());
}

/**
 * Creates a fresh database on the shared test server. With `migrations`, only those folders are
 * deployed (from a temporary copy); without it, the database is migrated to head.
 */
export async function createIsolatedDatabase(
  opts: { migrations?: readonly string[] } = {},
): Promise<IsolatedDatabase> {
  const original = baseUrl();
  const name = `iso_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: original });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(original, name);
  let copyDir: string | null = null;

  const drop = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: original });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
    if (copyDir) rmSync(copyDir, { recursive: true, force: true });
    copyDir = null;
  };

  try {
    if (opts.migrations) {
      const known = new Set(headMigrationNames());
      for (const folder of opts.migrations) {
        if (!known.has(folder))
          throw new Error(`isolated-database: unknown migration folder ${folder}`);
      }
      copyDir = mkdtempSync(path.join(os.tmpdir(), "aida-isolated-db-"));
      for (const folder of opts.migrations) {
        cpSync(path.join(MIGRATIONS_DIR, folder), path.join(copyDir, folder), { recursive: true });
      }
      cpSync(
        path.join(MIGRATIONS_DIR, "migration_lock.toml"),
        path.join(copyDir, "migration_lock.toml"),
      );
      runDeploy(url, ["--config", SUBSET_CONFIG], {
        AIDA_TEST_SCHEMA: SCHEMA_PATH,
        AIDA_TEST_MIGRATIONS_DIR: copyDir,
      });
      await assertAppliedMigrations(url, opts.migrations);
    } else {
      await deployHeadMigrations(url);
    }
  } catch (err) {
    await drop();
    throw err;
  }

  return { url, drop };
}
