import { test as base } from "@playwright/test";
import { prisma } from "./db";

// Public routes (intake, status follow-up) share a rate-limit bucket keyed by IP, and all
// Playwright traffic comes from one machine/IP — reset between tests so specs don't trip the
// limiter (max 5/hour, see src/lib/rate-limit/check-rate-limit.ts).
export const test = base.extend<{ resetRateLimit: void }>({
  resetRateLimit: [
    async ({}, use) => {
      await prisma.rateLimitHit.deleteMany({});
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
