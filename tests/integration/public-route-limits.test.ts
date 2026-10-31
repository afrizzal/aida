// Public routes limit before any token or body work (plan 08-11, D-21, D-22, AIDA-30, F-12).
// Route handlers are called in-process against real Postgres; the identity comes from
// X-Forwarded-For through getRateLimitIdentity (08-10).
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as intakePost } from "@/app/api/public/intake/route";
import { GET as attachmentGet } from "@/app/api/public/status/[token]/attachments/[id]/route";
import { POST as csatPost } from "@/app/api/public/status/[token]/csat/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { prisma } from "@/lib/db";
import { CONSOLE_METHODS, serializeLogArg } from "../support/console-capture";

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

function statusPost(path: string, ip: string): Request {
  const form = new FormData();
  form.set("message", "hello");
  form.set("score", "5");
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: form,
  });
}

describe("limiter before token lookup and body parsing (D-22)", () => {
  it("csat: 404 five times, then 429 with Retry-After", async () => {
    const token = `tok-${randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      const r = await csatPost(statusPost(`/api/public/status/${token}/csat`, "203.0.113.40"), {
        params: Promise.resolve({ token }),
      });
      expect(r.status).toBe(404);
    }
    const limited = await csatPost(statusPost(`/api/public/status/${token}/csat`, "203.0.113.40"), {
      params: Promise.resolve({ token }),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    console.info(`[08-11] observed csat Retry-After: ${expectRetryAfter(limited, 3600)}`);
  });

  it("follow-up: 404 five times, then 429 with Retry-After", async () => {
    const token = `tok-${randomUUID()}`;
    const path = `/api/public/status/${token}/follow-up`;
    for (let i = 0; i < 5; i++) {
      const r = await followUpPost(statusPost(path, "203.0.113.41"), {
        params: Promise.resolve({ token }),
      });
      expect(r.status).toBe(404);
    }
    const limited = await followUpPost(statusPost(path, "203.0.113.41"), {
      params: Promise.resolve({ token }),
    });
    expect(limited.status).toBe(429);
    console.info(`[08-11] observed follow-up Retry-After: ${expectRetryAfter(limited, 3600)}`);
  });

  it("intake: 400 invalid_form_data five times, then 429 before the body is parsed", async () => {
    const call = () =>
      intakePost(
        new Request("http://localhost/api/public/intake", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.42", "content-type": "text/plain" },
          body: "not a form",
        }),
      );
    for (let i = 0; i < 5; i++) {
      const r = await call();
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_form_data" });
    }
    const limited = await call();
    expect(limited.status).toBe(429);
    console.info(`[08-11] observed intake Retry-After: ${expectRetryAfter(limited, 3600)}`);
  });
});

describe("status token never reaches a log line", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("csat, follow-up and attachment calls log nothing containing the token", async () => {
    const token = `tok-${randomUUID()}`;
    const seen: unknown[] = [];
    for (const method of CONSOLE_METHODS) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        seen.push(...args);
      });
    }
    const id = randomUUID();
    await csatPost(statusPost(`/api/public/status/${token}/csat`, "203.0.113.50"), {
      params: Promise.resolve({ token }),
    });
    await followUpPost(statusPost(`/api/public/status/${token}/follow-up`, "203.0.113.50"), {
      params: Promise.resolve({ token }),
    });
    await attachmentGet(
      new Request(`http://localhost/api/public/status/${token}/attachments/${id}`, {
        headers: { "x-forwarded-for": "203.0.113.50" },
      }),
      { params: Promise.resolve({ token, id }) },
    );
    // Deep serialization: a token inside a nested Error ({ err }) or its cause is seen (d-WR-d2).
    const leaked = seen.filter((arg) => serializeLogArg(arg).includes(token));
    expect(leaked).toEqual([]);
  });
});
