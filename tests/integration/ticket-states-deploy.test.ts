// Phase 12.1 migration on the path production uses: the real `pnpm prisma migrate deploy` of
// Prisma 7.8.0 (review C2, review R2-1, review R2-4).
//
// Every database lives in this file's own harness container (startMigrationContainer); with the
// global setup's container, which `pnpm test:integration` always starts, these are the only two
// containers of the run, and both are removed afterwards. A pre-12.1 baseline is reached through
// the real CLI by deploying a copy of the migration folders up to 20261109100000_ticket_lifecycle
// with tests/support/prisma-migrate-test.config.ts; every other CLI call uses the repository config
// with only DATABASE_URL set. The host temporary directories holding those copies are removed in
// afterAll. The migration file itself is never edited (final after plan 12.1-01, review R2-1): this
// test observes what the CLI does with it.
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFixtureCoverage,
  connect,
  createDatabase,
  databaseUrl,
  listMigrationFolders,
  MIGRATIONS_DIR,
  PROJECT_ROOT,
  snapshotTables,
  startMigrationContainer,
} from "../support/migration-harness";
import {
  FIXTURE_TIMESTAMP_VALUES,
  FIXTURE_TIMESTAMPS,
  seedPopulatedPre121,
} from "../support/migration-seed";

const BASELINE = "20261109100000_ticket_lifecycle";
const STATES_MIGRATION = "20261110100000_ticket_states";
const TEST_CONFIG = "tests/support/prisma-migrate-test.config.ts";
const CLI_TIMEOUT = 240_000;

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
const clients: pg.Client[] = [];
const tempDirs: string[] = [];

/** Copies every migration folder up to `name` plus migration_lock.toml into a new temp directory. */
function copyMigrationsThrough(name: string): { dir: string; folders: string[] } {
  const folders = listMigrationFolders();
  const index = folders.indexOf(name);
  if (index < 0) throw new Error(`unknown migration folder: ${name}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "aida-p121-03-migrations-"));
  tempDirs.push(dir);
  const copied = folders.slice(0, index + 1);
  for (const folder of copied) {
    cpSync(path.join(MIGRATIONS_DIR, folder), path.join(dir, folder), { recursive: true });
  }
  cpSync(path.join(MIGRATIONS_DIR, "migration_lock.toml"), path.join(dir, "migration_lock.toml"));
  return { dir, folders: copied };
}

interface CliResult {
  status: number | null;
  output: string;
}

/** Runs `pnpm prisma <args>` from the repository root; never throws. */
function runPrisma(args: string[], env: Record<string, string>): CliResult {
  const result = spawnSync("pnpm", ["prisma", ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: CLI_TIMEOUT,
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/**
 * Records one evidence item for the SUMMARY (exit codes, the _prisma_migrations row, CLI output):
 * printed to the console and, when AIDA_P121_03_EVIDENCE names a file, appended to it as one JSON
 * line (the executor reads it; the test itself creates no file otherwise).
 */
function evidence(label: string, value: unknown): void {
  const line = `P121-03-EVIDENCE ${label} ${JSON.stringify(value)}`;
  console.log(line);
  const file = process.env.AIDA_P121_03_EVIDENCE;
  if (file) appendFileSync(file, `${line}\n`);
}

interface MigrationRow {
  migration_name: string;
  checksum: string;
  started_at: Date;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  applied_steps_count: number;
  logs: string | null;
}

async function migrationRows(db: pg.Client): Promise<MigrationRow[]> {
  return (
    await db.query<MigrationRow>(
      `SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count, logs
       FROM "_prisma_migrations" ORDER BY migration_name, started_at`,
    )
  ).rows;
}

/** Schema snapshot: columns of the public schema, public type names and the TicketState table. */
async function schemaSnapshot(db: pg.Client) {
  const columns = await db.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  const types = await db.query(
    `SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace ORDER BY typname`,
  );
  const regclass = await db.query(`SELECT to_regclass('"TicketState"')::text AS r`);
  return { columns: columns.rows, types: types.rows, ticketState: regclass.rows[0].r };
}

/** A fresh database of the harness container brought to the Phase 12 baseline by the real CLI. */
async function cliBaseline(
  name: string,
): Promise<{ db: pg.Client; url: string; folders: string[] }> {
  await createDatabase(admin, name);
  const url = databaseUrl(container, name);
  const { dir, folders } = copyMigrationsThrough(BASELINE);
  const deploy = runPrisma(["migrate", "deploy", "--config", TEST_CONFIG], {
    AIDA_TEST_SCHEMA: path.join(PROJECT_ROOT, "prisma", "schema.prisma"),
    AIDA_TEST_MIGRATIONS_DIR: dir,
    DATABASE_URL: url,
  });
  if (deploy.status !== 0) evidence(`${name}-baseline-output`, deploy.output);
  expect(deploy.status).toBe(0);
  const db = await connect(container, name);
  clients.push(db);
  return { db, url, folders };
}

async function stateOfEveryTicket(db: pg.Client) {
  return (
    await db.query<{
      id: string;
      ticketOrg: string;
      stateOrg: string;
      legacyStatus: string;
      pausedAt: Date | null;
    }>(
      `SELECT t."id", t."organizationId" AS "ticketOrg", s."organizationId" AS "stateOrg", s."legacyStatus",
         t."slaPausedAt" AS "pausedAt"
       FROM "Ticket" t JOIN "TicketState" s ON s."id" = t."stateId" ORDER BY t."id"`,
    )
  ).rows;
}

beforeAll(async () => {
  container = await startMigrationContainer();
  admin = await connect(container, "aida_migration");
}, 120_000);

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await container?.stop();
  // Only the directories mkdtempSync returned to this file (review R2-4).
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("ticket_states migration through the real prisma migrate deploy: failure and recovery", () => {
  let db: pg.Client;
  let url: string;
  let seed: Awaited<ReturnType<typeof seedPopulatedPre121>>;
  const badViewId = "d-view-a-archived";
  let failedRowSeen = false;

  it(
    "baseline: the copied migrations deploy through the test config and _prisma_migrations holds exactly them",
    async () => {
      const baseline = await cliBaseline("deploy_fail");
      db = baseline.db;
      url = baseline.url;
      const rows = await migrationRows(db);
      expect(rows.map((r) => r.migration_name)).toEqual(baseline.folders);
      expect(baseline.folders.at(-1)).toBe(BASELINE);
      for (const row of rows) {
        expect(row.finished_at).not.toBeNull();
        expect(row.rolled_back_at).toBeNull();
      }
    },
    CLI_TIMEOUT,
  );

  it(
    "failure: a malformed saved view makes the deploy exit non-zero with its id and leaves everything as it was",
    async () => {
      seed = await seedPopulatedPre121(db, "d");
      await db.query(
        `INSERT INTO "SavedView" ("id", "organizationId", "ownerUserId", "name", "visibility", "filters",
           "position", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'Archived', 'PRIVATE', $4::jsonb, 9, $5, $6)`,
        [
          badViewId,
          seed.orgs.a,
          seed.users.a1,
          JSON.stringify({ version: 1, view: "all", statuses: ["ARCHIVED"] }),
          FIXTURE_TIMESTAMPS.viewCreated,
          FIXTURE_TIMESTAMPS.viewUpdated,
        ],
      );
      const schemaBefore = await schemaSnapshot(db);
      const tablesBefore = await snapshotTables(db);
      const migrationsBefore = await migrationRows(db);

      const deploy = runPrisma(["migrate", "deploy"], { DATABASE_URL: url });
      evidence("failed-deploy-exit", deploy.status);
      evidence("failed-deploy-output", deploy.output);
      expect(deploy.status).not.toBe(0);
      expect(deploy.output).toContain(badViewId);
      expect(deploy.output).toContain("has an unknown status value");

      expect(await schemaSnapshot(db)).toEqual(schemaBefore);
      expect(await snapshotTables(db)).toEqual(tablesBefore);
      const migrationsAfter = await migrationRows(db);
      expect(migrationsAfter.filter((r) => r.migration_name !== STATES_MIGRATION)).toEqual(
        migrationsBefore,
      );
      const statesRows = migrationsAfter.filter((r) => r.migration_name === STATES_MIGRATION);
      evidence("failed-deploy-migration-row", statesRows);
      expect(statesRows.length).toBeLessThanOrEqual(1);
      for (const row of statesRows) expect(row.finished_at).toBeNull();
      failedRowSeen = statesRows.length === 1;

      const status = runPrisma(["migrate", "status"], { DATABASE_URL: url });
      evidence("failed-status-exit", status.status);
      evidence("failed-status-output", status.output);
    },
    CLI_TIMEOUT,
  );

  it(
    "recovery: after the view is fixed the observed sequence deploys the migration once and converts the view",
    async () => {
      await db.query(`UPDATE "SavedView" SET "filters" = $1::jsonb WHERE "id" = $2`, [
        JSON.stringify({ version: 1, view: "all", statuses: ["OPEN"] }),
        badViewId,
      ]);
      const plain = runPrisma(["migrate", "deploy"], { DATABASE_URL: url });
      evidence("recovery-plain-deploy-exit", plain.status);
      evidence("recovery-plain-deploy-output", plain.output);
      if (failedRowSeen) {
        // A failed row is present: the plain deploy must refuse (P3009), then
        // `pnpm prisma migrate resolve --rolled-back` and a second `pnpm prisma migrate deploy`.
        expect(plain.status).not.toBe(0);
        expect(plain.output).toContain("P3009");
        const resolve = runPrisma(["migrate", "resolve", "--rolled-back", STATES_MIGRATION], {
          DATABASE_URL: url,
        });
        evidence("recovery-resolve-exit", resolve.status);
        evidence("recovery-resolve-output", resolve.output);
        expect(resolve.status).toBe(0);
        const redeploy = runPrisma(["migrate", "deploy"], { DATABASE_URL: url });
        evidence("recovery-redeploy-exit", redeploy.status);
        expect(redeploy.status).toBe(0);
      } else {
        expect(plain.status).toBe(0);
      }

      const rows = (await migrationRows(db)).filter((r) => r.migration_name === STATES_MIGRATION);
      evidence("recovery-migration-rows", rows);
      expect(rows.filter((r) => r.finished_at !== null)).toHaveLength(1);
      expect(rows.filter((r) => r.finished_at !== null)[0].rolled_back_at).toBeNull();

      const status = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'Ticket' AND column_name = 'status'`,
      );
      expect(status.rowCount).toBe(0);
      const tickets = await stateOfEveryTicket(db);
      expect(tickets).toHaveLength(9);
      for (const t of tickets) {
        expect(t.stateOrg).toBe(t.ticketOrg);
        expect(t.legacyStatus).toBe(seed.statusById[t.id]);
      }
      const openA = await db.query<{ id: string }>(
        `SELECT "id" FROM "TicketState" WHERE "organizationId" = $1 AND "legacyStatus" = 'OPEN'`,
        [seed.orgs.a],
      );
      const view = await db.query(`SELECT "filters" FROM "SavedView" WHERE "id" = $1`, [badViewId]);
      expect(view.rows[0].filters).toEqual({
        version: 2,
        view: "all",
        stateIds: [openA.rows[0].id],
      });
    },
    CLI_TIMEOUT,
  );
});

describe("ticket_states migration through the real prisma migrate deploy: success on populated data", () => {
  it(
    "deploys a populated pre-12.1 database with no loss in any pre-existing column",
    async () => {
      const { db, url } = await cliBaseline("deploy_ok");
      const seed = await seedPopulatedPre121(db, "s");
      expect(
        await assertFixtureCoverage(db, ["organization", "Ticket", "SavedView"], {
          fixtureTimestamps: FIXTURE_TIMESTAMP_VALUES,
        }),
      ).toEqual([]);
      const before = await snapshotTables(db, { exclude: ["Ticket.status", "SavedView.filters"] });

      const deploy = runPrisma(["migrate", "deploy"], { DATABASE_URL: url });
      evidence("success-deploy-exit", deploy.status);
      if (deploy.status !== 0) evidence("success-deploy-output", deploy.output);
      expect(deploy.status).toBe(0);

      const rows = (await migrationRows(db)).filter((r) => r.migration_name === STATES_MIGRATION);
      expect(rows).toHaveLength(1);
      expect(rows[0].finished_at).not.toBeNull();
      expect(rows[0].rolled_back_at).toBeNull();

      const after = await snapshotTables(db, { restrictTo: before.columns });
      expect(after.columns).toEqual(before.columns);
      for (const table of Object.keys(before.rows)) {
        expect({ table, rows: after.rows[table] }).toEqual({ table, rows: before.rows[table] });
      }
      expect(before.rows.Ticket).toHaveLength(9);

      const pending = new Set([...seed.tickets.a.PENDING, ...seed.tickets.b.PENDING]);
      const tickets = await stateOfEveryTicket(db);
      expect(tickets).toHaveLength(9);
      for (const t of tickets) {
        expect(t.stateOrg).toBe(t.ticketOrg);
        expect(t.legacyStatus).toBe(seed.statusById[t.id]);
        if (pending.has(t.id)) expect(t.pausedAt).not.toBeNull();
        else expect(t.pausedAt).toBeNull();
      }
    },
    CLI_TIMEOUT,
  );
});
