// Better Auth upgrade regression test (plan 08-03, decision D-02; review d-WR-d1).
//
// A database is migrated to the v1 schema (PRE_UPGRADE_MIGRATIONS, which ends at the last
// migration of v1.0.0), populated with the rows better-auth 1.6.22 itself wrote
// (tests/integration/fixtures/better-auth-pre-upgrade.ts), then migrated to head with the real
// `prisma migrate deploy`. The test pins which migrations that deploy applies, so it fails if the
// deploy ever becomes a no-op again. On that database the installed Better Auth must still accept
// the 1.6.22 signed session cookie, the 1.6.22 password hash and the 1.6.22 organization
// membership. Real Postgres, no mocks.
//
// src/ is only imported dynamically, after DATABASE_URL points at the isolated database, because
// src/lib/db.ts builds its pool from DATABASE_URL at import time.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BA_PRE_UPGRADE_FIXTURE, PRE_UPGRADE_MIGRATIONS } from "./fixtures/better-auth-pre-upgrade";
import {
  createIsolatedDatabase,
  deployHeadMigrations,
  type IsolatedDatabase,
} from "./support/isolated-database";

type Auth = typeof import("../../src/lib/auth")["auth"];

const fixture = BA_PRE_UPGRADE_FIXTURE;
const cookieHeader = `${fixture.sessionCookieName}=${fixture.signedSessionCookie}`;
const ENV_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const TABLES = ["user", "account", "organization", "member", "session"] as const;

/** The last migration of v1.0.0 (Phases 1 to 7). D-02's "v1 schema" ends here. */
const V1_LAST_MIGRATION = "20260724171144_insight_aida";

/**
 * Every migration `prisma migrate deploy` must apply on top of the populated v1 database, by
 * name. When a migration is added under prisma/migrations, this test fails until it is listed
 * here, so each new migration also runs on populated auth rows (review d-WR-d1).
 */
const UPGRADE_MIGRATIONS = [
  "20261108140000_inbox",
  "20261109100000_ticket_lifecycle",
  "20261110100000_ticket_states",
  "20261110110000_ticket_state_fk_on_update_restrict",
  "20261111100000_kb_proposals",
  "20261112100000_kb_proposal_final_fence",
  "20261113100000_projects_foundation",
] as const;

let db: IsolatedDatabase | null = null;
let appliedBefore: string[] = [];
let appliedAfter: string[] = [];
let client: pg.Client | null = null;
let auth: Auth;

function conn(): pg.Client {
  if (!client) throw new Error("auth-upgrade: database client not connected");
  return client;
}

async function insertRow(c: pg.Client, table: string, row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row);
  const list = columns.map((column) => `"${column}"`).join(", ");
  const params = columns.map((_, i) => `$${i + 1}`).join(", ");
  await c.query(`INSERT INTO "${table}" (${list}) VALUES (${params})`, Object.values(row));
}

async function appliedMigrations(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query<{ migration_name: string }>(
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name",
  );
  return rows.map((row) => row.migration_name);
}

async function count(table: string): Promise<number> {
  const { rows } = await conn().query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0]?.n ?? -1;
}

describe("better-auth upgrade on a populated pre-upgrade database (D-02)", () => {
  beforeAll(async () => {
    db = await createIsolatedDatabase({ migrations: PRE_UPGRADE_MIGRATIONS });
    client = new pg.Client({ connectionString: db.url });
    await client.connect();

    // timestamp(3) columns have no time zone: Postgres ignores the trailing Z, so the stored
    // values are the fixture's UTC values, exactly as 1.6.22 wrote them.
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await insertRow(client, "user", fixture.user);
    await insertRow(client, "account", fixture.account);
    await insertRow(client, "organization", fixture.organization);
    await insertRow(client, "member", fixture.member);
    await insertRow(client, "session", { ...fixture.session, expiresAt });

    appliedBefore = await appliedMigrations(client);
    await deployHeadMigrations(db.url);
    appliedAfter = await appliedMigrations(client);

    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.DATABASE_URL = db.url;
    process.env.BETTER_AUTH_SECRET = fixture.secret;
    process.env.BETTER_AUTH_URL = fixture.baseURL;
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ auth } = await import("../../src/lib/auth"));
  });

  afterAll(async () => {
    await client?.end();
    await db?.drop();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("D-02: migrate deploy applies more than zero migrations on the populated database, exactly the pinned list", () => {
    const newlyApplied = appliedAfter.filter((name) => !appliedBefore.includes(name));
    expect(newlyApplied.length).toBeGreaterThan(0);
    expect(newlyApplied).toHaveLength(UPGRADE_MIGRATIONS.length);
    expect(newlyApplied).toEqual([...UPGRADE_MIGRATIONS]);
    expect(appliedAfter).toEqual([...appliedBefore, ...UPGRADE_MIGRATIONS]);
  });

  it("D-02: the populated pre-upgrade database is the v1 schema", () => {
    expect(PRE_UPGRADE_MIGRATIONS.at(-1)).toBe(V1_LAST_MIGRATION);
    expect(appliedBefore).toEqual([...PRE_UPGRADE_MIGRATIONS]);
    expect(appliedBefore).not.toContain(UPGRADE_MIGRATIONS[0]);
  });

  it("D-02: the later migrations ran over the populated organization (ticket-state backfill)", async () => {
    // 20261110100000_ticket_states seeds states for every organization that already exists. The
    // fixture organization was inserted before the deploy, so only that backfill can have made
    // these rows.
    const { rows } = await conn().query<{ configs: number; states: number }>(
      `SELECT (SELECT count(*)::int FROM "TicketStateConfig" WHERE "organizationId" = $1) AS configs,
              (SELECT count(*)::int FROM "TicketState" WHERE "organizationId" = $1) AS states`,
      [fixture.organization.id],
    );
    expect(rows[0]?.configs).toBe(1);
    expect(rows[0]?.states).toBeGreaterThan(0);
  });

  it("D-02: every migration is applied on top of the populated pre-upgrade database and the rows survive", async () => {
    const { rows: applied } = await conn().query<{ migration_name: string }>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name",
    );
    expect(applied.map((row) => row.migration_name)).toEqual(
      expect.arrayContaining([...PRE_UPGRADE_MIGRATIONS]),
    );
    for (const table of TABLES) expect(await count(table)).toBe(1);

    const { rows } = await conn().query<Record<string, string>>(
      `SELECT u.id AS "userId", u."createdAt"::text AS "userCreatedAt", a.password, s.token,
              s."activeOrganizationId", m.role, o.slug
         FROM "user" u
         JOIN account a ON a."userId" = u.id
         JOIN session s ON s."userId" = u.id
         JOIN member m ON m."userId" = u.id
         JOIN organization o ON o.id = m."organizationId"`,
    );
    expect(rows).toEqual([
      {
        userId: fixture.user.id,
        userCreatedAt: "2026-11-11 11:33:11.724",
        password: fixture.account.password,
        token: fixture.session.token,
        activeOrganizationId: fixture.organization.id,
        role: fixture.member.role,
        slug: fixture.organization.slug,
      },
    ]);
  });

  it("D-02: the session cookie signed by better-auth 1.6.22 survives the upgrade", async () => {
    const result = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    expect(result?.user.id).toBe(fixture.user.id);
    expect(result?.session.id).toBe(fixture.session.id);
    expect(result?.session.activeOrganizationId).toBe(fixture.organization.id);
  });

  it("D-02: login works against the password hash written by better-auth 1.6.22", async () => {
    const result = await auth.api.signInEmail({
      body: { email: fixture.email, password: fixture.password },
    });
    expect(result.user.id).toBe(fixture.user.id);
    expect(result.token).toBeTruthy();

    await expect(
      auth.api.signInEmail({ body: { email: fixture.email, password: "wrong-password-0000" } }),
    ).rejects.toThrow();
  });

  it("D-02: organization membership written under better-auth 1.6.22 is visible through the new API", async () => {
    const organizations = await auth.api.listOrganizations({
      headers: new Headers({ cookie: cookieHeader }),
    });
    expect(organizations.map((org) => org.id)).toContain(fixture.organization.id);

    const { rows } = await conn().query<{ role: string }>(
      `SELECT role FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
      [fixture.user.id, fixture.organization.id],
    );
    expect(rows).toEqual([{ role: fixture.member.role }]);
  });
});
