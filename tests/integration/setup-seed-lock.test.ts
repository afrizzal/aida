// The /setup wizard takes the tenant seed lock (K145, review a-WR-1).
//
// completeSetup runs in this process through the real Better Auth and Postgres; only
// next/navigation's redirect is replaced (as in auth-setup.test.ts). The seed runs as a child
// process (support/demo-driver.ts), so it races for real on the advisory lock. A pg client holds
// the lock the way a seed does after it classified the database as empty.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { makeGuardEnv, runDriver, tenantState, withClient } from "./support/demo-guard-fixtures";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

type Actions = typeof import("../../src/app/(auth)/setup/actions");

const CASE_TIMEOUT = 600_000;
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('aida:tenant-seed', 0))";
const REDIRECT = "NEXT_REDIRECT:/login?setup=complete";
const ALREADY = { error: "Setup has already been completed. Please sign in." };
const BUSY = { error: "Setup is busy right now. Please try again in a moment." };
const PASSWORD = randomUUID();
const INPUT = {
  orgName: "Setup Org",
  slug: "setup-org",
  adminName: "Setup Admin",
  email: "setup-admin@example.test",
  password: PASSWORD,
  confirmPassword: PASSWORD,
};

const ENV_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
const databases: IsolatedDatabase[] = [];

/** Ends this process's cached pools: Prisma and pg (src/lib/db.ts) and pg-boss. */
async function dropCachedDb(): Promise<void> {
  const g = globalThis as Record<symbol, unknown>;
  const client = g[Symbol.for("aida.db.prisma")] as
    | { $disconnect: () => Promise<void> }
    | undefined;
  const pool = g[Symbol.for("aida.db.pool")] as { end: () => Promise<void> } | undefined;
  await client?.$disconnect().catch(() => {});
  await pool?.end().catch(() => {});
  delete g[Symbol.for("aida.db.prisma")];
  delete g[Symbol.for("aida.db.pool")];
  // src/lib/queue/boss-client.ts caches a pg-boss instance (its own pool) on globalThis.boss.
  const boss = (globalThis as { boss?: Promise<{ stop: (o: object) => Promise<void> }> }).boss;
  await boss?.then((b) => b.stop({ graceful: false, wait: true })).catch(() => {});
  delete (globalThis as { boss?: unknown }).boss;
}

/** A fresh database and a completeSetup whose prisma and Better Auth point at it. */
async function freshSetup(): Promise<{
  db: IsolatedDatabase;
  completeSetup: Actions["completeSetup"];
}> {
  await dropCachedDb();
  vi.resetModules();
  // createIsolatedDatabase keeps DATABASE_URL as its admin URL for drop(): use the shared one.
  process.env.DATABASE_URL = savedEnv.DATABASE_URL;
  const db = await createIsolatedDatabase();
  databases.push(db);
  process.env.DATABASE_URL = db.url;
  process.env.BETTER_AUTH_SECRET = randomUUID() + randomUUID();
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  const { completeSetup } = await import("../../src/app/(auth)/setup/actions");
  return { db, completeSetup };
}

/** Settles a completeSetup call to its result or the redirect marker. */
function settle(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    (r) => r,
    (e: unknown) => (e instanceof Error && e.message === REDIRECT ? REDIRECT : e),
  );
}

async function waitingAdvisoryLocks(url: string): Promise<number> {
  return withClient(url, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_database d ON d.oid = l.database
       WHERE l.locktype = 'advisory' AND NOT l.granted AND d.datname = current_database()`,
    );
    return rows[0].n;
  });
}

async function waitForWaiters(url: string, n: number, limitMs: number): Promise<boolean> {
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    if ((await waitingAdvisoryLocks(url)) >= n) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function holdLock(url: string): Promise<pg.Client> {
  const holder = new pg.Client({ connectionString: url });
  await holder.connect();
  await holder.query("BEGIN");
  await holder.query(LOCK_SQL);
  return holder;
}

async function release(holder: pg.Client): Promise<void> {
  await holder.query("ROLLBACK").catch(() => {});
  await holder.end();
}

afterAll(async () => {
  await dropCachedDb();
  for (const db of databases) await db.drop();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("/setup takes the tenant seed lock (K145, a-WR-1)", () => {
  it(
    "while a seed holds the lock after classifying the database empty, /setup waits and writes nothing; after the release it creates the workspace",
    async () => {
      const { db, completeSetup } = await freshSetup();
      const holder = await holdLock(db.url);
      let pending: Promise<unknown> | null = null;
      try {
        const seen = await holder.query<{ n: number }>(`SELECT count(*)::int AS n FROM "user"`);
        expect(seen.rows[0].n).toBe(0); // the seed's view: empty

        pending = settle(completeSetup(INPUT));
        const waited = await waitForWaiters(db.url, 1, 8_000);
        const whileHeld = await tenantState(db.url);
        expect(waited).toBe(true);
        expect(whileHeld.userEmails).toEqual([]);
        expect(whileHeld.organizations).toEqual([]);
      } finally {
        await release(holder);
      }
      expect(await pending).toBe(REDIRECT);
      const after = await tenantState(db.url);
      expect(after.userEmails).toEqual([INPUT.email]);
      expect(after.organizations.map((o) => o.slug)).toEqual(["setup-org"]);
    },
    CASE_TIMEOUT,
  );

  it(
    "a lock held past the setup wait: /setup answers busy and writes nothing",
    async () => {
      const { db, completeSetup } = await freshSetup();
      const holder = await holdLock(db.url);
      try {
        const started = Date.now();
        expect(await settle(completeSetup(INPUT))).toEqual(BUSY);
        expect(Date.now() - started).toBeLessThan(30_000);
        const state = await tenantState(db.url);
        expect(state.userEmails).toEqual([]);
        expect(state.organizations).toEqual([]);
      } finally {
        await release(holder);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "a seed CLI and /setup contending for the lock on one fresh database: one real workspace or one complete demo, never both",
    async () => {
      const { db, completeSetup } = await freshSetup();
      const guard = makeGuardEnv();
      const holder = await holdLock(db.url);
      let seed: ReturnType<typeof runDriver> | null = null;
      let setup: Promise<unknown> | null = null;
      try {
        seed = runDriver(db.url, guard, ["guarded-seed-cli"]);
        expect(await waitForWaiters(db.url, 1, 120_000)).toBe(true);
        setup = settle(completeSetup(INPUT));
        expect(await waitForWaiters(db.url, 2, 8_000)).toBe(true);
      } finally {
        await release(holder);
      }
      const [seedRun, setupResult] = await Promise.all([seed, setup]);
      const seedOutcome = seedRun?.results[0].outcome;
      const state = await tenantState(db.url);
      expect(state.organizations).toHaveLength(1);

      if (setupResult === REDIRECT) {
        expect(seedOutcome).toBe("refused-foreign");
        expect(state.organizations[0].slug).toBe("setup-org");
        expect(state.userEmails).toEqual([INPUT.email]);
        expect(state.markers).toEqual([]);
        expect(state.tickets).toBe(0);
      } else {
        expect([ALREADY, BUSY]).toContainEqual(setupResult);
        expect(seedOutcome).toBe("seeded");
        expect(state.userEmails).toEqual([guard.adminEmail, guard.agentEmail].sort());
        expect(state.markers).toHaveLength(1);
        expect(state.tickets).toBe(30);
      }
    },
    CASE_TIMEOUT,
  );
});
