// The DEMO_MODE boot behind the tenant seed guard (plan 09-02, AIDA-37, AIDA-38; D-15 to D-19,
// U-04, U-17).
//
// Owner decision 2026-11-11 item 3: the seed refuses and never deletes demo data. Every refusal
// case compares the exact row count of every table (countAllTables) taken AFTER the fixture is
// built with the count after the refused run: no tolerance, no worker running, no other writer
// on the test database (each case owns a database from createIsolatedDatabase; AuditEvent is
// append-only, so a database cannot be emptied and is dropped instead).
//
// Every guarded path runs in a child process (support/demo-driver.ts), so its pool, its
// pg-boss instance and its crash are its own. One test process at a time
// (vitest.integration.config.ts, fileParallelism: false).
import { describe, expect, it } from "vitest";
import {
  type GuardEnv,
  insertForeignWorkspace,
  insertUser,
  makeGuardEnv,
  passwordLeaks,
  runDriver,
  tenantState,
  withClient,
} from "./support/demo-guard-fixtures";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";
import { countAllTables } from "./support/table-inventory";

const CASE_TIMEOUT = 600_000;

const SEEDED_LINE = "[demo] Seeded the demo workspace in";
const FOREIGN_LINE =
  "[demo] Refusing to seed: this database already holds a workspace that is not the demo; nothing written.";

async function withDatabase(fn: (db: IsolatedDatabase) => Promise<void>): Promise<void> {
  const db = await createIsolatedDatabase();
  try {
    await fn(db);
  } finally {
    await db.drop();
  }
}

function expectNoPassword(output: string, guard: GuardEnv): void {
  expect(passwordLeaks(output, guard)).toEqual({ configured: false, documentedDefault: false });
}

/** The complete marked demo: one organization holding the marker, only the demo users. */
async function expectCompleteDemo(url: string, guard: GuardEnv): Promise<void> {
  const state = await tenantState(url);
  expect(state.organizations).toHaveLength(1);
  const orgId = state.organizations[0].id;
  expect(state.markers).toEqual([
    { organizationId: orgId, value: JSON.stringify({ dataset: "aida-demo", version: 1 }) },
  ]);
  expect(state.userEmails).toEqual([guard.agentEmail, guard.adminEmail].sort());
  expect(state.tickets).toBe(30);
  // The organization-insert trigger wrote the demo organization's states and configuration;
  // they are part of the demo dataset, never foreign data.
  expect(state.ticketStatesByOrg[orgId]).toBeGreaterThan(0);
  expect(state.ticketStateConfigs).toBe(1);
}

describe("DEMO_MODE boot behind the tenant seed guard (09-02, AIDA-37)", () => {
  it(
    "fresh database: the demo boot seeds one organization holding the marker, both demo users and the trigger-written states, and prints no password",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        const run = await runDriver(db.url, guard, ["demo-boot"]);
        expect(run.results).toEqual([{ mode: "demo-boot", outcome: "returned" }]);
        expect(run.output).toContain(SEEDED_LINE);
        expect(run.output).toContain(guard.adminEmail);
        expectNoPassword(run.output, guard);
        await expectCompleteDemo(db.url, guard);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "a non-demo organization with its owner and zero tickets: the demo boot refuses with one line and every table count is unchanged",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        await insertForeignWorkspace(db.url);
        const before = await countAllTables(db.url);
        expect(before["public.Ticket"]).toBe(0);

        const run = await runDriver(db.url, guard, ["demo-boot"]);
        expect(run.results).toEqual([{ mode: "demo-boot", outcome: "returned" }]);
        expect(run.output).toContain(FOREIGN_LINE);
        expect(run.output).not.toContain(SEEDED_LINE);
        expectNoPassword(run.output, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "only a non-demo user exists: the demo boot refuses and every table count is unchanged",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        await insertUser(db.url, "someone@acme.example.test");
        const before = await countAllTables(db.url);

        const run = await runDriver(db.url, guard, ["demo-boot"]);
        expect(run.output).toContain(FOREIGN_LINE);
        expectNoPassword(run.output, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "the marked demo organization plus one non-demo user is foreign: marker and identities are both required, and the boot refuses without a write",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        const seed = await runDriver(db.url, guard, ["guarded-seed-cli"]);
        expect(seed.results).toEqual([{ mode: "guarded-seed-cli", outcome: "seeded" }]);
        await expectCompleteDemo(db.url, guard);

        await insertUser(db.url, "intruder@acme.example.test");
        const before = await countAllTables(db.url);

        const run = await runDriver(db.url, guard, ["classify", "demo-boot"]);
        expect(run.results[0]).toEqual({ mode: "classify", outcome: "foreign" });
        expect(run.output).toContain(FOREIGN_LINE);
        expectNoPassword(run.output, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "infrastructure-only database (heartbeat SystemSetting, RateLimitHit, migrations, pgboss) is classified empty and seeded",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        await withClient(db.url, (c) =>
          c.query(
            `INSERT INTO "RateLimitHit" (id, scope, "ipHash") VALUES ('fixture-hit', 'intake', 'fixture-hash')`,
          ),
        );
        const infra = await runDriver(db.url, guard, ["pgboss-start", "heartbeat", "classify"]);
        expect(infra.results[2]).toEqual({ mode: "classify", outcome: "empty" });
        const before = await countAllTables(db.url);
        expect(before["public.SystemSetting"]).toBe(1);
        expect(before["public.RateLimitHit"]).toBe(1);
        expect(before["public._prisma_migrations"]).toBeGreaterThan(0);
        expect(Object.keys(before).some((key) => key.startsWith("pgboss."))).toBe(true);
        expect(before["public.organization"]).toBe(0);
        expect(before["public.user"]).toBe(0);

        const run = await runDriver(db.url, guard, ["classify", "demo-boot"]);
        expect(run.results[0]).toEqual({ mode: "classify", outcome: "empty" });
        expect(run.output).toContain(SEEDED_LINE);
        expectNoPassword(run.output, guard);
        await expectCompleteDemo(db.url, guard);
      });
    },
    CASE_TIMEOUT,
  );
});
