import type { BrowserContext } from "@playwright/test";
import { test as base } from "@playwright/test";
import { prisma } from "./db";

// Public routes (intake, status follow-up) share a rate-limit bucket keyed by IP, and all
// Playwright traffic comes from one machine/IP — reset between tests so specs don't trip the
// limiter (max 5/hour, see src/lib/rate-limit/check-rate-limit.ts).
export const test = base.extend<{ resetRateLimit: undefined }>({
  resetRateLimit: [
    async (_fixtures, use) => {
      await prisma.rateLimitHit.deleteMany({});
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

/**
 * `context.browser()` is typed nullable (null for a persistent context), but every e2e spec
 * that calls it needs a real Browser to open a second, unauthenticated page/context. A `!`
 * non-null assertion would compile away the check silently; this throws a clear, specific error
 * instead so the failure mode stays a hard, named assertion rather than a generic "cannot read
 * properties of null" a few lines later (07-09 FIX 5).
 */
export function requireBrowser(context: BrowserContext) {
  const browser = context.browser();
  if (!browser) {
    throw new Error(
      "context.browser() is null — this test needs a real Browser instance, not a persistent context",
    );
  }
  return browser;
}
