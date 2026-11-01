// Review b-IN-b7: a missing or placeholder RATE_LIMIT_PEPPER gets one clear log line per process
// at boot, naming the setting. Boot never fails on it, and the routes keep failing closed
// (rate-limit-pepper.test.ts pins the throw).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bootstrap", () => ({ bootstrapFromEnv: vi.fn(async () => {}) }));
vi.mock("@/lib/demo/bootstrap-demo", () => ({ bootstrapDemoMode: vi.fn(async () => {}) }));

import { register } from "../../src/instrumentation";
import { checkRateLimit } from "../../src/lib/rate-limit/check-rate-limit";
import {
  resetRateLimitPepperWarningForTests,
  warnIfRateLimitPepperUnsafe,
} from "../../src/lib/rate-limit/pepper-check";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRateLimitPepperWarningForTests();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function logged(): string[] {
  return errorSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" "));
}

describe("RATE_LIMIT_PEPPER boot check (b-IN-b7)", () => {
  it.each([
    ["unset", undefined],
    ["empty (compose's blank default)", ""],
  ])("%s: register() logs one line naming RATE_LIMIT_PEPPER and does not throw", async (_label, value) => {
    vi.stubEnv("RATE_LIMIT_PEPPER", value);
    await expect(register()).resolves.toBeUndefined();
    await expect(register()).resolves.toBeUndefined();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toContain("RATE_LIMIT_PEPPER");
    expect(logged()[0]).toContain("is not set");
  });

  it("the .env.example placeholder: one line naming RATE_LIMIT_PEPPER, without echoing the value", async () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "replace-me-with-a-random-pepper");
    await register();
    warnIfRateLimitPepperUnsafe();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toContain("RATE_LIMIT_PEPPER");
    expect(logged()[0]).toContain("placeholder");
    expect(logged()[0]).not.toContain("replace-me-with-a-random-pepper");
  });

  it("a real pepper logs nothing", async () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "c2VjcmV0LXBlcHBlci1mb3ItdGVzdHMtb25seQ==");
    await register();
    warnIfRateLimitPepperUnsafe();
    expect(logged()).toEqual([]);
  });

  it("the edge runtime skips the check", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("RATE_LIMIT_PEPPER", "");
    await register();
    expect(logged()).toEqual([]);
  });

  it("after the log line the limiter still fails closed without a pepper", async () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "");
    await register();
    await expect(checkRateLimit("test-scope", "203.0.113.1")).rejects.toThrow(
      /RATE_LIMIT_PEPPER is required/,
    );
  });
});
