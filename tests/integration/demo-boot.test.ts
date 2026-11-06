// The DEMO_MODE boot and the seed CLI behind the tenant seed guard (plan 09-02, AIDA-37,
// AIDA-38; D-15 to D-19, U-04, U-17).
//
// Owner decision 2026-11-11 item 3: the seed refuses and never deletes demo data. Every refusal
// case compares the exact row count of every table (countAllTables) taken AFTER the fixture is
// built with the count after the refused run: no tolerance, no worker running, no other writer
// on the test database (each case owns a database from createIsolatedDatabase; AuditEvent is
// append-only, so a database cannot be emptied and is dropped instead).
//
// Every guarded path runs in a child process (support/demo-driver.ts, or prisma/seed.ts through
// tsx), so its pool, its pg-boss instance and its crash are its own, and two children race for
// real on the advisory lock. One test process at a time (vitest.integration.config.ts,
// fileParallelism: false).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  type ChildRun,
  DELETE_ADVICE,
  type GuardEnv,
  insertForeignWorkspace,
  insertOrganization,
  insertUser,
  makeGuardEnv,
  passwordLeaks,
  runDriver,
  runSeedScript,
  tenantState,
  withClient,
} from "./support/demo-guard-fixtures";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";
import { countAllTables } from "./support/table-inventory";

const CASE_TIMEOUT = 600_000;

const SEEDED_LINE = "[demo] Seeded the demo workspace in";
const ALREADY_LINE = "[demo] The complete demo workspace is already present; nothing written.";
const FOREIGN_LINE =
  "[demo] Refusing to seed: this database already holds a workspace that is not the demo; nothing written.";
const PARTIAL_LINE =
  "[demo] Refusing to seed: this database holds an incomplete demo workspace (no completion marker); nothing written.";
const SEED_FOREIGN_LINE =
  "[seed] Refusing to seed: this database already holds a workspace that is not the demo; nothing written.";
const SEED_PARTIAL_LINE =
  "[seed] Refusing to seed: this database holds an incomplete demo workspace (no completion marker); nothing written.";
const CONFIG_LINE =
  "[demo] Refusing to seed: DEMO_ADMIN_EMAIL and DEMO_AGENT_EMAIL are the same address; nothing written.";
const SEED_CONFIG_LINE =
  "[seed] Refusing to seed: DEMO_ADMIN_EMAIL and DEMO_AGENT_EMAIL are the same address; nothing written.";

/** The committed writes of a demo seed, in order (W1 to W6 in the 09-02 SUMMARY). */
const CRASH_STAGES = [
  "admin-user",
  "organization",
  "setup-complete",
  "agent-user",
  "agent-member",
  "first-ticket",
  "domain-data",
] as const;

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

function expectQuietRefusal(run: ChildRun, guard: GuardEnv): void {
  expectNoPassword(run.output, guard);
  expect(DELETE_ADVICE.test(run.output)).toBe(false);
  expect(run.output).not.toContain(SEEDED_LINE);
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

function realAdmin(): { ADMIN_EMAIL: string; ADMIN_PASSWORD: string; ADMIN_NAME: string } {
  return {
    ADMIN_EMAIL: "real-admin@acme.example.test",
    ADMIN_PASSWORD: `real-${randomBytes(12).toString("hex")}`,
    ADMIN_NAME: "Real Admin",
  };
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
    "repeated boot after the heartbeat wrote SystemSetting: classified demo-complete, skipped, every table count unchanged",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        const first = await runDriver(db.url, guard, ["demo-boot"]);
        expect(first.output).toContain(SEEDED_LINE);

        const beat = await runDriver(db.url, guard, ["heartbeat"]);
        expect(beat.results).toEqual([{ mode: "heartbeat", outcome: "returned" }]);
        const before = await countAllTables(db.url);
        const heartbeat = await withClient(db.url, (c) =>
          c.query(`SELECT 1 FROM "SystemSetting" WHERE key = 'heartbeat:lastRunAt'`),
        );
        expect(heartbeat.rowCount).toBe(1);

        const run = await runDriver(db.url, guard, ["classify", "demo-boot"]);
        expect(run.results[0]).toEqual({ mode: "classify", outcome: "demo-complete" });
        expect(run.output).toContain(ALREADY_LINE);
        expectQuietRefusal(run, guard);
        expect(await countAllTables(db.url)).toEqual(before);
        await expectCompleteDemo(db.url, guard);
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
        expectQuietRefusal(run, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "the marked demo organization plus one extra organization is foreign and refused without a write",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        const seed = await runDriver(db.url, guard, ["guarded-seed-cli"]);
        expect(seed.results).toEqual([{ mode: "guarded-seed-cli", outcome: "seeded" }]);

        await insertOrganization(db.url, "extra");
        const before = await countAllTables(db.url);

        const run = await runDriver(db.url, guard, ["classify", "demo-boot"]);
        expect(run.results[0]).toEqual({ mode: "classify", outcome: "foreign" });
        expect(run.output).toContain(FOREIGN_LINE);
        expectQuietRefusal(run, guard);
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

  describe("refusal matrix: {foreign organization, foreign user} x {seed CLI, demo boot}", () => {
    const fixtures = {
      // A non-demo workspace with zero tickets: an organization and its own owner.
      "foreign organization": (url: string) => insertForeignWorkspace(url),
      "foreign user": async (url: string) => {
        await insertUser(url, "someone@acme.example.test");
      },
    } as const;

    for (const [fixtureName, build] of Object.entries(fixtures)) {
      it(
        `${fixtureName} + seed CLI: exit 1, one refusal line, every table count unchanged`,
        async () => {
          const guard = makeGuardEnv();
          await withDatabase(async (db) => {
            await build(db.url);
            const before = await countAllTables(db.url);
            expect(before["public.Ticket"]).toBe(0);

            const run = await runSeedScript(db.url, guard);
            expect(run.code).toBe(1);
            expect(run.stdout).toContain(SEED_FOREIGN_LINE);
            expectQuietRefusal(run, guard);
            expect(await countAllTables(db.url)).toEqual(before);
          });
        },
        CASE_TIMEOUT,
      );

      it(
        `${fixtureName} + demo boot: one refusal line, a normal return, every table count unchanged`,
        async () => {
          const guard = makeGuardEnv();
          await withDatabase(async (db) => {
            await build(db.url);
            const before = await countAllTables(db.url);
            expect(before["public.Ticket"]).toBe(0);

            const run = await runDriver(db.url, guard, ["demo-boot"]);
            expect(run.results).toEqual([{ mode: "demo-boot", outcome: "returned" }]);
            expect(run.output).toContain(FOREIGN_LINE);
            expectQuietRefusal(run, guard);
            expect(await countAllTables(db.url)).toEqual(before);
          });
        },
        CASE_TIMEOUT,
      );
    }
  });

  it(
    "equal admin and agent demo emails (different case): the seed CLI and the demo boot each refuse before any write, every table count unchanged (a-WR-3)",
    async () => {
      const base = makeGuardEnv();
      const guard = { ...base, agentEmail: base.adminEmail.toUpperCase() };
      await withDatabase(async (db) => {
        const before = await countAllTables(db.url);
        expect(before["public.user"]).toBe(0);

        const cli = await runSeedScript(db.url, guard);
        expect(cli.code).toBe(1);
        expect(cli.stdout).toContain(SEED_CONFIG_LINE);
        expectQuietRefusal(cli, guard);
        expect(await countAllTables(db.url)).toEqual(before);

        const boot = await runDriver(db.url, guard, ["demo-boot"]);
        expect(boot.results).toEqual([{ mode: "demo-boot", outcome: "returned" }]);
        expect(boot.output).toContain(CONFIG_LINE);
        expectQuietRefusal(boot, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );

  describe("crash per stage: no marker, demo-partial, and both paths refuse afterwards (U-04)", () => {
    for (const stage of CRASH_STAGES) {
      it(
        `crash after ${stage}: classified demo-partial; the seed CLI and the demo boot each refuse and write nothing`,
        async () => {
          const guard = makeGuardEnv();
          await withDatabase(async (db) => {
            const crash = await runDriver(db.url, guard, [
              "guarded-seed-cli",
              "classify",
              "--crash-at",
              stage,
            ]);
            expect(crash.results).toEqual([
              { mode: "guarded-seed-cli", outcome: "crashed", stage },
              { mode: "classify", outcome: "demo-partial" },
            ]);
            expectNoPassword(crash.output, guard);
            const after = await tenantState(db.url);
            expect(after.markers).toEqual([]);
            expect(after.userEmails.length).toBeGreaterThan(0);

            const before = await countAllTables(db.url);

            const cli = await runSeedScript(db.url, guard);
            expect(cli.code).toBe(1);
            expect(cli.stdout).toContain(SEED_PARTIAL_LINE);
            expectQuietRefusal(cli, guard);
            expect(await countAllTables(db.url)).toEqual(before);

            const boot = await runDriver(db.url, guard, ["demo-boot"]);
            expect(boot.results).toEqual([{ mode: "demo-boot", outcome: "returned" }]);
            expect(boot.output).toContain(PARTIAL_LINE);
            expectQuietRefusal(boot, guard);
            expect(await countAllTables(db.url)).toEqual(before);
          });
        },
        CASE_TIMEOUT,
      );
    }
  });

  describe("concurrency and ordering (D-17)", () => {
    it(
      "a seed CLI and a demo boot started together on one fresh database: one demo organization, one row per demo identity, one marker",
      async () => {
        const guard = makeGuardEnv();
        await withDatabase(async (db) => {
          const [cli, boot] = await Promise.all([
            runDriver(db.url, guard, ["guarded-seed-cli"]),
            runDriver(db.url, guard, ["guarded-demo-boot"]),
          ]);
          const outcomes = [cli.results[0].outcome, boot.results[0].outcome];
          expect(outcomes.filter((o) => o === "seeded")).toHaveLength(1);
          const other = outcomes.find((o) => o !== "seeded");
          expect(["already-seeded", "lock-timeout"]).toContain(other);
          expectNoPassword(`${cli.output}\n${boot.output}`, guard);
          await expectCompleteDemo(db.url, guard);
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "bootstrapFromEnv first, then the demo boot, in one process (as src/instrumentation.ts runs them): the demo refuses and the real organization is the only one",
      async () => {
        const guard = makeGuardEnv();
        const admin = realAdmin();
        await withDatabase(async (db) => {
          const run = await runDriver(db.url, guard, ["bootstrap-env", "demo-boot"], admin);
          expect(run.results).toEqual([
            { mode: "bootstrap-env", outcome: "returned" },
            { mode: "demo-boot", outcome: "returned" },
          ]);
          expect(run.output).toContain(FOREIGN_LINE);
          expect(run.output).not.toContain(SEEDED_LINE);
          expectNoPassword(run.output, guard);
          expect(run.output.includes(admin.ADMIN_PASSWORD)).toBe(false);

          const state = await tenantState(db.url);
          expect(state.organizations).toHaveLength(1);
          expect(state.userEmails).toEqual([admin.ADMIN_EMAIL]);
          expect(state.markers).toEqual([]);
          expect(state.tickets).toBe(0);
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "bootstrapFromEnv and a seed CLI started together: either one real organization or one marked demo organization, never both",
      async () => {
        const guard = makeGuardEnv();
        const admin = realAdmin();
        await withDatabase(async (db) => {
          const [boot, cli] = await Promise.all([
            runDriver(db.url, guard, ["bootstrap-env"], admin),
            runDriver(db.url, guard, ["guarded-seed-cli"]),
          ]);
          expect(boot.results).toEqual([{ mode: "bootstrap-env", outcome: "returned" }]);
          const combined = `${boot.output}\n${cli.output}`;
          expectNoPassword(combined, guard);
          expect(combined.includes(admin.ADMIN_PASSWORD)).toBe(false);

          const state = await tenantState(db.url);
          expect(state.organizations).toHaveLength(1);
          if (cli.results[0].outcome === "seeded") {
            await expectCompleteDemo(db.url, guard);
          } else {
            expect(["refused-foreign", "lock-timeout"]).toContain(cli.results[0].outcome);
            expect(state.userEmails).toEqual([admin.ADMIN_EMAIL]);
            expect(state.markers).toEqual([]);
            expect(state.tickets).toBe(0);
          }
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "a held tenant seed lock: the guarded demo boot gives up after its lock timeout and writes nothing (T-09-07b)",
      async () => {
        const guard = makeGuardEnv();
        await withDatabase(async (db) => {
          const before = await countAllTables(db.url);
          const holder = new pg.Client({ connectionString: db.url });
          await holder.connect();
          try {
            await holder.query("BEGIN");
            await holder.query(
              "SELECT pg_advisory_xact_lock(hashtextextended('aida:tenant-seed', 0))",
            );
            const run = await runDriver(db.url, guard, [
              "guarded-demo-boot",
              "--lock-timeout-ms",
              "500",
            ]);
            expect(run.results).toEqual([{ mode: "guarded-demo-boot", outcome: "lock-timeout" }]);
            expectNoPassword(run.output, guard);
          } finally {
            await holder.query("ROLLBACK").catch(() => {});
            await holder.end();
          }
          expect(await countAllTables(db.url)).toEqual(before);
        });
      },
      CASE_TIMEOUT,
    );
  });
});
