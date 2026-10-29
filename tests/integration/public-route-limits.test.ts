// Public routes limit before any token or body work (plan 08-11, D-21, D-22, AIDA-30, F-12).
// Route handlers are called in-process against real Postgres; the identity comes from
// X-Forwarded-For through getRateLimitIdentity (08-10).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as attachmentGet } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { prisma } from "@/lib/db";

beforeAll(async () => {
  process.env.RATE_LIMIT_PEPPER ||= `test-pepper-${randomUUID()}`;
  await prisma.rateLimitHit.deleteMany({
    where: {
      scope: { in: ["status-attachment", "status-csat", "status-follow-up", "public-intake"] },
    },
  });
});

function expectRetryAfter(response: Response, windowSeconds: number): number {
  const value = response.headers.get("Retry-After");
  expect(value).toMatch(/^\d+$/);
  const seconds = Number(value);
  expect(seconds).toBeGreaterThanOrEqual(1);
  expect(seconds).toBeLessThanOrEqual(windowSeconds);
  return seconds;
}

describe("status attachment throttle (D-21)", () => {
  it("answers 404 for 120 requests and 429 with Retry-After on the 121st", async () => {
    const token = `tok-${randomUUID()}`;
    const id = randomUUID();
    const call = () =>
      attachmentGet(
        new Request(`http://localhost/api/public/status/${token}/attachments/${id}`, {
          headers: { "x-forwarded-for": "203.0.113.30" },
        }),
        { params: Promise.resolve({ token, id }) },
      );
    for (let i = 0; i < 120; i++) {
      expect((await call()).status).toBe(404);
    }
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    const seconds = expectRetryAfter(limited, 60);
    console.info(`[08-11] observed attachment Retry-After: ${seconds}`);
  });
});
