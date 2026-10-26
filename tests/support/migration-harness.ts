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
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { startLabeledPostgres } from "./docker-test-resources";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (tests/support is two levels deep). */
export const PROJECT_ROOT = path.resolve(__dirname, "../..");
export const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "prisma", "migrations");

/** Starts the harness container (test values, as global-setup.ts uses). */
export async function startMigrationContainer(): Promise<StartedPostgreSqlContainer> {
  return startLabeledPostgres({
    kind: "migration",
    database: "aida_migration",
    username: "migration",
    password: "migration",
  });
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

/** Double-quotes a catalog identifier for interpolation (identifiers come from the catalog). */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export interface TableSnapshot {
  /** Columns per table, in ordinal order, after exclusions. */
  columns: Record<string, string[]>;
  /** Rows per table, ordered by the primary key, each the to_jsonb text of the listed columns. */
  rows: Record<string, string[]>;
}

/**
 * Snapshot of every base table of the public schema except _prisma_migrations (review C8): per table
 * the rows ordered by the primary key (pg_index indisprimary; tables without one are ordered by the
 * row text), each as to_jsonb text of the columns read from information_schema.columns. `exclude`
 * leaves out "Table.column" pairs; `restrictTo` limits the snapshot to the tables and columns of an
 * earlier snapshot, so an after-snapshot compares only what existed before.
 */
export async function snapshotTables(
  client: pg.Client,
  options: { exclude?: string[]; restrictTo?: Record<string, string[]> } = {},
): Promise<TableSnapshot> {
  const exclude = new Set(options.exclude ?? []);
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
     ORDER BY table_name`,
  );
  const snapshot: TableSnapshot = { columns: {}, rows: {} };
  for (const { table_name: table } of tables.rows) {
    if (options.restrictTo && !(table in options.restrictTo)) continue;
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    let columns = cols.rows.map((r) => r.column_name).filter((c) => !exclude.has(`${table}.${c}`));
    if (options.restrictTo) {
      const allowed = new Set(options.restrictTo[table]);
      columns = columns.filter((c) => allowed.has(c));
    }
    const pk = await client.query<{ attname: string }>(
      `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ('public.' || quote_ident($1))::regclass AND i.indisprimary
       ORDER BY array_position(i.indkey, a.attnum)`,
      [table],
    );
    // The primary key orders the outer query; without one the row text itself orders it.
    const order = pk.rows.length
      ? pk.rows.map((r) => `t.${quoteIdent(r.attname)}::text COLLATE "C"`).join(", ")
      : "1";
    const list = columns.map((c) => `t.${quoteIdent(c)}`).join(", ");
    const result = columns.length
      ? await client.query<{ row: string }>(
          `SELECT (SELECT to_jsonb(x) FROM (SELECT ${list}) x)::text AS row
           FROM ${quoteIdent(table)} t ORDER BY ${order}`,
        )
      : { rows: [] as { row: string }[] };
    snapshot.columns[table] = columns;
    snapshot.rows[table] = result.rows.map((r) => r.row);
  }
  return snapshot;
}

const TIMESTAMP_TYPES = new Set([
  "timestamp without time zone",
  "timestamp with time zone",
  "date",
]);
// Volatile default expressions are never evaluated for the comparison (review R2-3). nextval( is
// listed too: evaluating it would advance a sequence.
const VOLATILE_DEFAULT =
  /current_timestamp|localtimestamp|now\(\)|clock_timestamp\(\)|statement_timestamp\(\)|transaction_timestamp\(\)|random\(\)|gen_random_uuid\(\)|nextval\(/i;

/**
 * Fixture coverage of the named tables (review C8, review R2-3). Returns every uncovered column as
 * "Table.column: reason"; an empty array means every column is covered. A column is uncovered when:
 *  (a) its data_type is a timestamp or date type and no row holds a value, or any row holds a
 *      non-null value outside fixtureTimestamps (compared as instants, epoch milliseconds), so a
 *      value filled in at insertion by CURRENT_TIMESTAMP or now() is reported, never passed;
 *  (b) it is not a timestamp or date column, its column_default is a volatile expression
 *      (CURRENT_TIMESTAMP, LOCALTIMESTAMP, now(), clock_timestamp(), statement_timestamp(),
 *      transaction_timestamp(), random(), gen_random_uuid(), nextval()), and explicitValues has no
 *      entry for Table.column, or no row holds a value, or a non-null row value (as text) lies
 *      outside that entry: the volatile default is never evaluated, because its value at check
 *      time says nothing about the value at insertion;
 *  (c) otherwise, no row holds a value that is non-null and, when information_schema.columns gives
 *      a column_default, distinct from that default expression (the expression text comes from
 *      the catalog, never from input).
 */
export async function assertFixtureCoverage(
  client: pg.Client,
  tables: string[],
  options: { fixtureTimestamps: readonly string[]; explicitValues?: Record<string, string[]> },
): Promise<string[]> {
  const fixtureMs = options.fixtureTimestamps.map((iso) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`invalid fixture timestamp: ${iso}`);
    return String(ms);
  });
  const uncovered: string[] = [];
  for (const table of tables) {
    const cols = await client.query<{
      column_name: string;
      data_type: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    if (cols.rows.length === 0) uncovered.push(`${table}: table not found`);
    for (const { column_name: column, data_type: dataType, column_default: def } of cols.rows) {
      const key = `${table}.${column}`;
      const col = quoteIdent(column);
      const from = quoteIdent(table);
      if (TIMESTAMP_TYPES.has(dataType)) {
        const r = await client.query<{ nonnull: number; outside: number }>(
          `SELECT count(*) FILTER (WHERE ${col} IS NOT NULL)::int AS nonnull,
                  count(*) FILTER (WHERE ${col} IS NOT NULL AND NOT (
                    round(extract(epoch FROM ${col}) * 1000)::bigint = ANY($1::bigint[])))::int AS outside
           FROM ${from}`,
          [fixtureMs],
        );
        if (r.rows[0].nonnull === 0) uncovered.push(`${key}: no row holds a value`);
        else if (r.rows[0].outside > 0)
          uncovered.push(`${key}: ${r.rows[0].outside} value(s) outside the fixture timestamps`);
        continue;
      }
      if (def !== null && VOLATILE_DEFAULT.test(def)) {
        const allowed = options.explicitValues?.[key];
        if (!allowed) {
          uncovered.push(`${key}: volatile default and no explicit values`);
          continue;
        }
        const r = await client.query<{ nonnull: number; outside: number }>(
          `SELECT count(*) FILTER (WHERE ${col} IS NOT NULL)::int AS nonnull,
                  count(*) FILTER (WHERE ${col} IS NOT NULL AND NOT (${col}::text = ANY($1::text[])))::int AS outside
           FROM ${from}`,
          [allowed],
        );
        if (r.rows[0].nonnull === 0) uncovered.push(`${key}: no row holds a value`);
        else if (r.rows[0].outside > 0)
          uncovered.push(`${key}: value(s) outside the explicit values`);
        continue;
      }
      const condition =
        def === null
          ? `${col} IS NOT NULL`
          : `${col} IS NOT NULL AND ${col} IS DISTINCT FROM (${def})`;
      const r = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${from} WHERE ${condition}`,
      );
      if (r.rows[0].n === 0) {
        uncovered.push(
          `${key}: no row holds a non-null${def === null ? "" : " non-default"} value`,
        );
      }
    }
  }
  return uncovered;
}
