// The real `pnpm db:seed` behind the tenant seed guard (plan 09-02, AIDA-37, AIDA-38; D-16,
// D-18, D-05, U-04, U-17).
//
// Each case spawns the real CLI as a child process against its own isolated database, with
// DATABASE_URL and every DEMO_* and ADMIN_* variable set explicitly (a random
// DEMO_ADMIN_PASSWORD), output captured in memory. Password checks return booleans only.
// Owner decision 2026-11-11 item 3: the seed refuses and never deletes demo data.
// One test process at a time (vitest.integration.config.ts, fileParallelism: false).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DELETE_ADVICE,
  DOCUMENTED_DEMO_PASSWORD,
  type GuardEnv,
  insertForeignWorkspace,
  makeGuardEnv,
  PROJECT_ROOT,
  passwordLeaks,
  runPnpmDbSeed,
  tenantState,
} from "./support/demo-guard-fixtures";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";
import { countAllTables } from "./support/table-inventory";

const CASE_TIMEOUT = 600_000;

const SEEDED_LINE = "[seed] Demo workspace seeded. Sign in with";
const ALREADY_LINE =
  "[seed] This database already holds the complete demo workspace; nothing written.";
const FOREIGN_LINE =
  "[seed] Refusing to seed: this database already holds a workspace that is not the demo; nothing written. Seed a new, separate database instead (docs/OPERATIONS.md, Demo mode).";

async function withDatabase(fn: (db: IsolatedDatabase) => Promise<void>): Promise<void> {
  const db = await createIsolatedDatabase();
  try {
    await fn(db);
  } finally {
    await db.drop();
  }
}

function expectCleanOutput(output: string, guard: GuardEnv): void {
  expect(passwordLeaks(output, guard)).toEqual({ configured: false, documentedDefault: false });
  expect(DELETE_ADVICE.test(output)).toBe(false);
}

describe("pnpm db:seed behind the tenant seed guard (09-02, AIDA-37)", () => {
  it("the scanned default is the documented one, and the lock key in the tests is the module's", () => {
    const identities = readFileSync(
      path.join(PROJECT_ROOT, "src", "lib", "demo", "identities.ts"),
      "utf8",
    );
    expect(identities).toContain(`DEMO_PASSWORD_DEFAULT = "${DOCUMENTED_DEMO_PASSWORD}"`);
    const lock = readFileSync(path.join(PROJECT_ROOT, "src", "lib", "tenant-seed-lock.ts"), "utf8");
    expect(lock).toContain(`"hashtextextended('aida:tenant-seed', 0)"`);
  });

  it(
    "empty database: seeds (exit 0), prints the summary and the sign-in line, and no password; a second run prints already seeded, exits 0 and writes nothing",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        const first = await runPnpmDbSeed(db.url, guard);
        expect(first.code).toBe(0);
        expect(first.stdout).toMatch(/"tickets":\s*30/);
        expect(first.stdout).toContain(`${SEEDED_LINE} ${guard.adminEmail};`);
        expect(first.stdout).toContain("the password is DEMO_ADMIN_PASSWORD from your environment");
        expectCleanOutput(first.output, guard);

        const state = await tenantState(db.url);
        expect(state.organizations).toHaveLength(1);
        expect(state.markers).toHaveLength(1);
        expect(state.userEmails).toEqual([guard.agentEmail, guard.adminEmail].sort());

        const before = await countAllTables(db.url);
        const second = await runPnpmDbSeed(db.url, guard);
        expect(second.code).toBe(0);
        expect(second.stdout).toContain(ALREADY_LINE);
        expect(second.stdout).not.toContain(SEEDED_LINE);
        expectCleanOutput(second.output, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "a non-demo organization with zero tickets: exit 1, one refusal line, every table count unchanged",
    async () => {
      const guard = makeGuardEnv();
      await withDatabase(async (db) => {
        await insertForeignWorkspace(db.url);
        const before = await countAllTables(db.url);
        expect(before["public.Ticket"]).toBe(0);

        const run = await runPnpmDbSeed(db.url, guard);
        expect(run.code).toBe(1);
        expect(run.stdout).toContain(FOREIGN_LINE);
        expect(run.stdout).not.toContain(SEEDED_LINE);
        expectCleanOutput(run.output, guard);
        expect(await countAllTables(db.url)).toEqual(before);
      });
    },
    CASE_TIMEOUT,
  );
});
