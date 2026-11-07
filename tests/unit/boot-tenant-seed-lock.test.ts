// register() never stops on a tenant seed lock failure, and its lock waits are bounded
// (review a-WR-2, K146).
//
// The real src/instrumentation.ts, src/lib/bootstrap.ts, src/lib/demo/bootstrap-demo.ts and
// src/lib/demo/tenant-guard.ts run. Only withTenantSeedLock is replaced (to inject a failure and
// record the options it receives), plus the modules that would open a database or Better Auth.
// This file checks the options passed; tests/integration/tenant-seed-lock-bounds.test.ts measures
// that withTenantSeedLock really gives up after them, against a held lock and an exhausted pool
// (Codex diff critique round 1, finding 7).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lock = vi.hoisted(() => ({ withTenantSeedLock: vi.fn() }));

vi.mock("@/lib/tenant-seed-lock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-seed-lock")>()),
  withTenantSeedLock: lock.withTenantSeedLock,
}));
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/demo/seed-demo-data", () => ({ seedDemoData: vi.fn() }));
vi.mock("@/lib/rate-limit/pepper-check", () => ({ warnIfRateLimitPepperUnsafe: () => {} }));

const ADMIN_EMAIL = "boot-admin@example.test";
const ADMIN_PASSWORD = "boot-secret-0f3a9c";
const ENV_KEYS = [
  "NEXT_RUNTIME",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "DEMO_MODE",
  "DEMO_ADMIN_EMAIL",
  "DEMO_AGENT_EMAIL",
  "AIDA_EXPECT_DB_PASSWORD",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

/** Stands in for a Prisma error whose message quotes the input, as a P2028 can. */
class PrismaClientKnownRequestError extends Error {
  readonly code = "P2028";
  constructor() {
    super(
      `Transaction API error: unable to start a transaction for ${ADMIN_EMAIL} ${ADMIN_PASSWORD}`,
    );
    this.name = "PrismaClientKnownRequestError";
  }
}

let errors: string[];

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  delete process.env.DEMO_MODE;
  delete process.env.DEMO_ADMIN_EMAIL;
  delete process.env.DEMO_AGENT_EMAIL;
  delete process.env.AIDA_EXPECT_DB_PASSWORD;
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  lock.withTenantSeedLock.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("register() and the tenant seed lock at boot (a-WR-2, K146)", () => {
  it("a failure other than the lock timeout does not throw out of register() and logs one line with no secret", async () => {
    lock.withTenantSeedLock.mockRejectedValue(new PrismaClientKnownRequestError());
    const { register } = await import("../../src/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(lock.withTenantSeedLock).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([
      "[bootstrap] Skipped the headless admin bootstrap after an error (PrismaClientKnownRequestError, P2028); the app starts without it.",
    ]);
    const all = errors.join("\n");
    expect(all.includes(ADMIN_EMAIL)).toBe(false);
    expect(all.includes(ADMIN_PASSWORD)).toBe(false);
  });

  it("a non-Error rejection is logged as an unknown error and does not throw", async () => {
    lock.withTenantSeedLock.mockRejectedValue("connection reset");
    const { register } = await import("../../src/instrumentation");

    await expect(register()).resolves.toBeUndefined();
    expect(errors).toEqual([
      "[bootstrap] Skipped the headless admin bootstrap after an error (unknown error); the app starts without it.",
    ]);
  });

  it("the bootstrap and the demo boot each wait at most 10 s for the pool and 10 s for the lock", async () => {
    const { TenantSeedLockTimeout } =
      await vi.importActual<typeof import("@/lib/tenant-seed-lock")>("@/lib/tenant-seed-lock");
    lock.withTenantSeedLock.mockImplementation(async () => {
      throw new TenantSeedLockTimeout();
    });
    process.env.DEMO_MODE = "true";
    const { register } = await import("../../src/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(lock.withTenantSeedLock).toHaveBeenCalledTimes(2);
    for (const call of lock.withTenantSeedLock.mock.calls) {
      expect(call[1]).toEqual({ lockTimeoutMs: 10_000, maxWaitMs: 10_000 });
    }
    expect(errors).toEqual([
      "[bootstrap] Skipped the headless admin bootstrap: another seed holds the tenant seed lock.",
      "[demo] Skipped the demo seed: another seed holds the tenant seed lock; nothing written.",
    ]);
  });
});
