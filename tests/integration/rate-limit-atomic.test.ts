// The database-backed limiter is atomic (plan 08-11, D-23, AIDA-30). Real Postgres, no mocks.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  consumeRateLimit,
  RATE_LIMIT_MAX_WINDOW_MS,
} from "@/lib/rate-limit/check-rate-limit";

beforeAll(() => {
  process.env.RATE_LIMIT_PEPPER ||= `test-pepper-${randomUUID()}`;
});

const scopeFor = (label: string) => `test-${label}-${randomUUID()}`;

describe("consumeRateLimit (D-23)", () => {
  it("allows exactly max of 20 parallel calls and stores exactly max rows", async () => {
    const scope = scopeFor("parallel");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(scope, "203.0.113.20", { max: 5, windowMs: 60_000 }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await prisma.rateLimitHit.count({ where: { scope } })).toBe(5);
  });

  it("denies the 6th sequential call with an integer Retry-After from 1 to the window", async () => {
    const scope = scopeFor("sequential");
    for (let i = 0; i < 5; i++) {
      const r = await consumeRateLimit(scope, "203.0.113.21", { max: 5, windowMs: 60_000 });
      expect(r).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    const denied = await consumeRateLimit(scope, "203.0.113.21", { max: 5, windowMs: 60_000 });
    expect(denied.allowed).toBe(false);
    expect(Number.isInteger(denied.retryAfterSeconds)).toBe(true);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
    console.info(`[08-11] observed retryAfterSeconds (60 s window): ${denied.retryAfterSeconds}`);
  });

  it("refuses a window past the 48-hour cleanup retention and a max below 1", async () => {
    expect(RATE_LIMIT_MAX_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    await expect(
      consumeRateLimit(scopeFor("window"), "203.0.113.22", {
        windowMs: RATE_LIMIT_MAX_WINDOW_MS + 1,
      }),
    ).rejects.toThrow(/windowMs/);
    await expect(consumeRateLimit(scopeFor("max"), "203.0.113.22", { max: 0 })).rejects.toThrow(
      /max/,
    );
  });

  it("checkRateLimit returns consumeRateLimit's allowed flag", async () => {
    const scope = scopeFor("compat");
    expect(await checkRateLimit(scope, "203.0.113.23", { max: 1, windowMs: 60_000 })).toBe(true);
    expect(await checkRateLimit(scope, "203.0.113.23", { max: 1, windowMs: 60_000 })).toBe(false);
  });
});
