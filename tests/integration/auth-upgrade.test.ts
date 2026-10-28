// Better Auth upgrade regression test (plan 08-03, decision D-02).
//
// A database is migrated to exactly the migrations that existed under better-auth 1.6.22,
// populated with the rows 1.6.22 itself wrote (tests/integration/fixtures/better-auth-pre-upgrade.ts),
// then migrated to head with the real `prisma migrate deploy`. On that database the installed
// Better Auth must still accept the 1.6.22 signed session cookie, the 1.6.22 password hash and
// the 1.6.22 organization membership. Real Postgres, no mocks.
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

let db: IsolatedDatabase | null = null;
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

    await deployHeadMigrations(db.url);

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
