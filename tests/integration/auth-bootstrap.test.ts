// Headless first-run bootstrap on the upgraded Better Auth (plan 08-03, decision D-02).
//
// bootstrapFromEnv runs against its own freshly migrated database (no shared state with other
// files) through the real Better Auth and the real Postgres; nothing is mocked. src/ is imported
// dynamically after DATABASE_URL points at that database, because src/lib/db.ts builds its pool
// at import time.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";

type Bootstrap = typeof import("../../src/lib/bootstrap");
type Auth = typeof import("../../src/lib/auth")["auth"];
type Prisma = typeof import("../../src/lib/db")["prisma"];

const ADMIN_EMAIL = "bootstrap-admin@example.test";
const ADMIN_PASSWORD = randomUUID();
const ENV_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "ADMIN_NAME",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: IsolatedDatabase | null = null;
let bootstrapFromEnv: Bootstrap["bootstrapFromEnv"];
let auth: Auth;
let prisma: Prisma;

async function counts() {
  const [users, organizations, members, setupComplete] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.member.count(),
    prisma.systemSetting.findUnique({ where: { key: "setupComplete" } }),
  ]);
  return { users, organizations, members, setupComplete: setupComplete?.value ?? null };
}

describe("bootstrapFromEnv on the upgraded better-auth (D-02)", () => {
  beforeAll(async () => {
    db = await createIsolatedDatabase({});
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.DATABASE_URL = db.url;
    process.env.BETTER_AUTH_SECRET = randomUUID() + randomUUID();
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.ADMIN_NAME = "Bootstrap Admin";
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ bootstrapFromEnv } = await import("../../src/lib/bootstrap"));
    ({ auth } = await import("../../src/lib/auth"));
    ({ prisma } = await import("../../src/lib/db"));
  });

  afterAll(async () => {
    await db?.drop();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("D-02: the first call creates one admin, the aida organization, an owner membership and setupComplete", async () => {
    expect(await counts()).toEqual({ users: 0, organizations: 0, members: 0, setupComplete: null });

    await bootstrapFromEnv();

    expect(await counts()).toEqual({
      users: 1,
      organizations: 1,
      members: 1,
      setupComplete: "true",
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    expect(user.name).toBe("Bootstrap Admin");
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "aida" } });
    const members = await prisma.member.findMany();
    expect(members).toEqual([
      expect.objectContaining({ userId: user.id, organizationId: organization.id, role: "owner" }),
    ]);
  });

  it("D-02: a second call changes nothing", async () => {
    const before = await counts();
    await bootstrapFromEnv();
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ users: 1, organizations: 1, members: 1, setupComplete: "true" });
  });

  it("D-02: the bootstrapped admin can sign in", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const result = await auth.api.signInEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(result.user.id).toBe(user.id);
    expect(result.token).toBeTruthy();
  });
});
