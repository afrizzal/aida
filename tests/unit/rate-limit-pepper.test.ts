import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../../src/lib/rate-limit/check-rate-limit";

/**
 * 07-09 FIX 3 / GAP 3: RATE_LIMIT_PEPPER must be mandatory. `??` doesn't replace an empty
 * string, and docker-compose.yml injects `RATE_LIMIT_PEPPER: ${RATE_LIMIT_PEPPER:-}` — an
 * operator who never sets it gets the var defined as "". Both the unset and the empty-string
 * case must throw before any IP is hashed, never silently fall back to an unsalted hash.
 */
describe("checkRateLimit — pepper guard (07-09 GAP 3)", () => {
  it("throws when RATE_LIMIT_PEPPER is unset", async () => {
    const saved = process.env.RATE_LIMIT_PEPPER;
    delete process.env.RATE_LIMIT_PEPPER;
    try {
      await expect(checkRateLimit("test-scope", "203.0.113.1")).rejects.toThrow(
        /RATE_LIMIT_PEPPER is required/,
      );
    } finally {
      if (saved !== undefined) process.env.RATE_LIMIT_PEPPER = saved;
    }
  });

  it("throws when RATE_LIMIT_PEPPER is the empty string (docker-compose ${VAR:-} default)", async () => {
    const saved = process.env.RATE_LIMIT_PEPPER;
    process.env.RATE_LIMIT_PEPPER = "";
    try {
      await expect(checkRateLimit("test-scope", "203.0.113.1")).rejects.toThrow(
        /RATE_LIMIT_PEPPER is required/,
      );
    } finally {
      if (saved !== undefined) process.env.RATE_LIMIT_PEPPER = saved;
      else delete process.env.RATE_LIMIT_PEPPER;
    }
  });
});
