// Phase 9 plan 09-05 (AIDA-34, D-09, U-02): the public logo route, called in-process against real
// Postgres. It limits first (scope public-logo), then serves only the organization's currently
// referenced logo; every miss answers the same 404. UPLOADS_DIR is set before the dynamic imports
// that read it.
import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PUBLIC_RATE_LIMITS } from "@/lib/rate-limit/public-limits";
import { uniqueClientIp } from "../support/client-ip";
import { testUploadsDir } from "../support/file-fence-fixtures";
import { pngBytes } from "../support/logo-images";
import { seedOrgWithMembers } from "../support/project-fixtures";

let dir = "";
let previousUploadsDir: string | undefined;
let store: typeof import("@/lib/branding/logo-store");
let GET: typeof import("@/app/api/public/logo/[orgId]/[version]/route").GET;

beforeAll(async () => {
  process.env.RATE_LIMIT_PEPPER ||= `test-pepper-${randomUUID()}`;
  dir = await testUploadsDir("aida-logo-routes-");
  previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  store = await import("@/lib/branding/logo-store");
  GET = (await import("@/app/api/public/logo/[orgId]/[version]/route")).GET;
});

afterAll(async () => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function call(orgId: string, version: string, ip = uniqueClientIp()): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/public/logo/${orgId}/${version}`, {
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ orgId, version }) },
  );
}

async function expectNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  // A miss carries none of the logo's caching or content headers.
  expect(response.headers.get("cache-control")).toBeNull();
  expect(response.headers.get("content-disposition")).toBeNull();
}

async function orgWithLogo(): Promise<{ orgId: string; version: string; bytes: Buffer }> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  const bytes = pngBytes(120, 40);
  const result = await store.replaceLogo({ orgId, bytes });
  if (!result.ok) throw new Error(`replaceLogo refused: ${result.code}`);
  return { orgId, version: result.version, bytes };
}

describe("public logo route", () => {
  it("serves the current version with the stored MIME type, nosniff, inline and immutable caching", async () => {
    const { orgId, version, bytes } = await orgWithLogo();

    const response = await call(orgId, version);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(body, bytes)).toBe(0);
  });

  it("answers 404 not_found for another version of an organization that has a logo", async () => {
    const { orgId, version } = await orgWithLogo();
    let other = randomBytes(6).toString("hex");
    while (other === version) other = randomBytes(6).toString("hex");
    await expectNotFound(await call(orgId, other));
  });

  it("answers 404 not_found for an unknown organization", async () => {
    const { version } = await orgWithLogo();
    await expectNotFound(await call(randomUUID(), version));
  });

  it("answers 404 not_found for an organization without a logo", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    await expectNotFound(await call(orgId, randomBytes(6).toString("hex")));
  });

  it("answers 404 not_found for malformed parameters, even with a real organization", async () => {
    const { orgId, version } = await orgWithLogo();
    for (const [o, v] of [
      [orgId, version.toUpperCase()],
      [orgId, `${version}0`],
      [orgId, version.slice(1)],
      [orgId, "../../etc/pass"],
      [`${orgId}/..`, version],
      ["a".repeat(65), version],
      ["", version],
    ] as const) {
      await expectNotFound(await call(o, v));
    }
  });

  it("answers 429 with Retry-After on the 301st request of one identity inside the window", async () => {
    // The limiter's window start is Date.now() minus the window; frozen at the first call, all 301
    // calls fall in one window however slow the host is (as public-route-limits.test.ts does).
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const { max, windowMs, scope } = PUBLIC_RATE_LIMITS.logo;
    expect({ scope, max, windowMs }).toEqual({ scope: "public-logo", max: 300, windowMs: 60_000 });
    const ip = uniqueClientIp();
    const orgId = randomUUID();
    const version = randomBytes(6).toString("hex");
    for (let i = 0; i < max; i += 1) {
      expect((await call(orgId, version, ip)).status).toBe(404);
    }
    const limited = await call(orgId, version, ip);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(windowMs / 1000);
    // Another identity is not limited by it.
    expect((await call(orgId, version)).status).toBe(404);
  });
});
