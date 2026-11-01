// Better Auth's client IP follows the proxy-written identity header (plan 08-10, D-18, AIDA-29).
//
// src/proxy.ts overwrites `x-aida-client-ip` with getClientIp() on every forwarded request, and
// src/lib/auth.ts tells Better Auth to read only that header. This in-process test proves the
// stored session IP comes from it and that a raw X-Forwarded-For is ignored. It does not prove
// the limiter over real HTTP or that a client cannot inject the header through the proxy; plan
// 08-21 proves that against `next start` (review C7). Real Better Auth, real Postgres, no mocks;
// src/ is imported dynamically after DATABASE_URL points at an isolated database.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedDatabase, type IsolatedDatabase } from "./support/isolated-database";

type Auth = typeof import("../../src/lib/auth")["auth"];
type Prisma = typeof import("../../src/lib/db")["prisma"];

const ENV_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const EMAIL = `ip-source-${randomUUID()}@example.test`;
const PASSWORD = randomUUID();

let db: IsolatedDatabase | null = null;
let auth: Auth;
let prisma: Prisma;
let userId: string;

async function signInAndReadSessionIp(headers: Record<string, string>): Promise<string | null> {
  const result = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    headers: new Headers(headers),
  });
  expect(result.user.id).toBe(userId);
  // The session this sign-in created, by its own token, not the latest of the user (d-IN-d1).
  expect(result.token).toEqual(expect.any(String));
  const session = await prisma.session.findUnique({ where: { token: result.token } });
  expect(session?.userId).toBe(userId);
  return session?.ipAddress ?? null;
}

// Better Auth 1.4's getIp (dist/utils/get-request-ip.mjs) returns 127.0.0.1 when none of the
// configured headers holds a valid address and NODE_ENV is test or development; in production it
// returns null and the session stores "". Vitest runs with NODE_ENV=test.
const BETTER_AUTH_TEST_FALLBACK_IP = "127.0.0.1";

describe("Better Auth IP source (D-18)", () => {
  beforeAll(async () => {
    db = await createIsolatedDatabase({});
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.DATABASE_URL = db.url;
    process.env.BETTER_AUTH_SECRET = randomUUID() + randomUUID();
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ auth } = await import("../../src/lib/auth"));
    ({ prisma } = await import("../../src/lib/db"));
    const signUp = await auth.api.signUpEmail({
      body: { name: "IP Source", email: EMAIL, password: PASSWORD },
    });
    userId = signUp.user.id;
  });

  afterAll(async () => {
    await db?.drop();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("D-18: Better Auth is configured to read only x-aida-client-ip", () => {
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(["x-aida-client-ip"]);
  });

  it("D-18: the session IP is the proxy-written identity, not X-Forwarded-For", async () => {
    const ip = await signInAndReadSessionIp({
      "x-aida-client-ip": "203.0.113.50",
      "x-forwarded-for": "198.51.100.9",
    });
    expect(ip).toBe("203.0.113.50");
  });

  it("D-18: a raw X-Forwarded-For alone never becomes the session IP", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    const ip = await signInAndReadSessionIp({ "x-forwarded-for": "198.51.100.9" });
    // Exactly Better Auth's no-header fallback: the X-Forwarded-For value was not read at all.
    expect(ip).toBe(BETTER_AUTH_TEST_FALLBACK_IP);
    expect(ip).not.toBe("198.51.100.9");
    // The same value as a sign-in with no address header at all.
    expect(await signInAndReadSessionIp({})).toBe(BETTER_AUTH_TEST_FALLBACK_IP);
  });
});
