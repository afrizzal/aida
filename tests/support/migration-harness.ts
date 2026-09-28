// Migration harness for Phase 12.1 (D-10 amended, review C2).
//
// The shared integration setup (tests/integration/global-setup.ts) can only migrate its container to
// the newest migration, so the migration tests start their own Testcontainers container from the
// same image and create one isolated database per case. Each migration folder's migration.sql is
// applied with a single pg client.query(sqlText) call: the simple query protocol runs a
// multi-statement string as one implicit transaction.
//
// This harness never runs the Prisma CLI, so it never writes _prisma_migrations. It proves nothing
// about how `prisma migrate deploy` applies a file: tests/integration/ticket-states-deploy.test.ts
// covers that path with the real CLI (review C2).
//
// Test-only module: relative imports only, never imported by application code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (tests/support is two levels deep). */
export const PROJECT_ROOT = path.resolve(__dirname, "../..");
export const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "prisma", "migrations");

/** Starts the harness container (test values, as global-setup.ts uses). */
export async function startMigrationContainer(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("aida_migration")
    .withUsername("migration")
    .withPassword("migration")
    .start();
}

/** Connection URL of one database of the harness container. */
export function databaseUrl(container: StartedPostgreSqlContainer, name: string): string {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  return url.toString();
}

/** Opens a connected pg client on the named database of the harness container. */
export async function connect(
  container: StartedPostgreSqlContainer,
  name: string,
): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl(container, name) });
  await client.connect();
  return client;
}

/** Creates one isolated database; the name is a test constant, checked before it is quoted. */
export async function createDatabase(adminClient: pg.Client, name: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`invalid test database name: ${name}`);
  }
  await adminClient.query(`CREATE DATABASE "${name}"`);
}

/** Migration folder names of prisma/migrations, directories only, sorted by name. */
export function listMigrationFolders(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((entry) => statSync(path.join(dir, entry)).isDirectory())
    .sort();
}

/**
 * Applies migration folders in name order, each with one client.query call. `through` stops after
 * the named folder; `only` applies just the named folder. An unknown name throws before anything
 * is applied.
 */
export async function applyMigrations(
  client: pg.Client,
  options: { through?: string; only?: string } = {},
): Promise<string[]> {
  const folders = listMigrationFolders();
  for (const name of [options.through, options.only]) {
    if (name !== undefined && !folders.includes(name)) {
      throw new Error(`unknown migration folder: ${name}`);
    }
  }
  let selected = folders;
  if (options.only !== undefined) {
    selected = [options.only];
  } else if (options.through !== undefined) {
    selected = folders.slice(0, folders.indexOf(options.through) + 1);
  }
  for (const folder of selected) {
    const sqlText = readFileSync(path.join(MIGRATIONS_DIR, folder, "migration.sql"), "utf8");
    await client.query(sqlText);
  }
  return selected;
}
