// The /setup Server Action on the upgraded Better Auth (plan 08-03, decision D-02).
//
// completeSetup runs against its own freshly migrated database through the real Better Auth and
// the real Postgres. Only next/navigation's redirect is replaced, because outside a Next.js
// request it can only throw; the stand-in throws a recognisable error instead. The database and
// Better Auth are never mocked.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

type Actions = typeof import("../../src/app/(auth)/setup/actions");
type Auth = typeof import("../../src/lib/auth")["auth"];
type Prisma = typeof import("../../src/lib/db")["prisma"];

const ENV_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const PASSWORD = randomUUID();
const VALID_INPUT = {
  orgName: "Setup Org",
  slug: "setup-org",
  adminName: "Setup Admin",
  email: "setup-admin@example.test",
  password: PASSWORD,
  confirmPassword: PASSWORD,
};

let db: IsolatedDatabase | null = null;
let completeSetup: Actions["completeSetup"];
let auth: Auth;
let prisma: Prisma;

describe("completeSetup (/setup) on the upgraded better-auth (D-02)", () => {
  beforeAll(async () => {
    db = await createIsolatedDatabase({});
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.DATABASE_URL = db.url;
    process.env.BETTER_AUTH_SECRET = randomUUID() + randomUUID();
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ completeSetup } = await import("../../src/app/(auth)/setup/actions"));
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

  it("D-02: invalid input returns an error and creates nothing", async () => {
    const result = await completeSetup({
      ...VALID_INPUT,
      password: "short",
      confirmPassword: "short",
    });
    expect(result).toEqual({ error: expect.any(String) });
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.organization.count()).toBe(0);
  });

  it("D-02: valid input creates the admin and workspace, then redirects to /login?setup=complete", async () => {
    await expect(completeSetup(VALID_INPUT)).rejects.toThrow("NEXT_REDIRECT:/login?setup=complete");

    expect(await prisma.user.count()).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: VALID_INPUT.email } });
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "setup-org" },
    });
    expect(organization.name).toBe("Setup Org");
    expect(await prisma.member.findMany()).toEqual([
      expect.objectContaining({ userId: user.id, organizationId: organization.id, role: "owner" }),
    ]);
    const setting = await prisma.systemSetting.findUnique({ where: { key: "setupComplete" } });
    expect(setting?.value).toBe("true");
  });

  it("D-02: the admin created by /setup can sign in", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: VALID_INPUT.email } });
    const result = await auth.api.signInEmail({
      body: { email: VALID_INPUT.email, password: PASSWORD },
    });
    expect(result.user.id).toBe(user.id);
  });

  it("D-02: a second call is refused and creates nothing", async () => {
    const result = await completeSetup({ ...VALID_INPUT, email: "second-admin@example.test" });
    expect(result).toEqual({ error: "Setup has already been completed. Please sign in." });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.organization.count()).toBe(1);
  });
});
