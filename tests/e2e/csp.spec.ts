/**
 * CSP zero-violation acceptance (AIDA-28, D-11 to D-15, plan 08-08).
 *
 * src/proxy.ts sets a per-response nonce policy with 'strict-dynamic' (src/lib/security/csp.ts).
 * This spec proves the policy is enforced (the header is `content-security-policy`, never the
 * report-only variant) and that the core pages run under it without a single blocked script or
 * style: every `securitypolicyviolation` event and every console message naming the Content
 * Security Policy is collected and must be empty.
 *
 * The spec makes no assumption that only holds under `next dev`, so the production-mode run
 * (`next start`) can execute the same file unchanged (review C6).
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Response } from "@playwright/test";
import { createTicket, orgId } from "./support/db";
import { expect, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");
const ts = Date.now();

// One ticket for the status page and the ticket page. It is new, unique by subject, and no other
// spec reads it, so it is left in place (the spec changes no other shared data).
let ticket: { id: string; statusToken: string };

test.beforeAll(async () => {
  ticket = await createTicket(orgId, {
    subject: `E2E CSP ticket ${ts}`,
    priority: "NORMAL",
    body: "CSP acceptance ticket body.",
    contact: { email: `csp-${ts}@example.com` },
    direction: "INBOUND",
  });
});

type Violation = {
  violatedDirective: string;
  effectiveDirective: string;
  blockedURI: string;
  sample: string;
  sourceFile: string;
  lineNumber: number;
  disposition: string;
};

declare global {
  interface Window {
    __cspViolations?: Violation[];
  }
}

type CspCollector = { consoleErrors: string[]; devToolingConsole: number };

/**
 * Next.js's development overlay (the `next-devtools` chunk, served only by `next dev`) injects
 * its own <style> tags through a bundled style-loader whose nonce comes from that chunk's private
 * webpack runtime, which the app cannot reach. It is absent from `next build` output, and no CSP
 * source allows it narrowly: dropping the nonce or adding 'unsafe-inline' would also hide every
 * real app violation (D-11). So the spec excludes only violations whose source file is that
 * chunk, and logs how many it excluded. Under `next start` the filter never matches (C6).
 */
const DEV_TOOLING_SOURCE = /\/_next\/static\/chunks\/[^/]*next-devtools[^/]*\.js/;

/** Registers both collectors. Call before the first navigation of the page. */
async function collectCsp(page: Page): Promise<CspCollector> {
  const collector: CspCollector = { consoleErrors: [], devToolingConsole: 0 };
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations?.push({
        violatedDirective: e.violatedDirective,
        effectiveDirective: e.effectiveDirective,
        blockedURI: e.blockedURI,
        sample: e.sample,
        sourceFile: e.sourceFile,
        lineNumber: e.lineNumber,
        disposition: e.disposition,
      });
    });
  });
  page.on("console", (msg) => {
    const text = msg.text();
    if (!text.includes("Content Security Policy")) return;
    if (DEV_TOOLING_SOURCE.test(msg.location().url)) collector.devToolingConsole += 1;
    else collector.consoleErrors.push(text);
  });
  return collector;
}

async function expectNoViolations(page: Page, collector: CspCollector): Promise<void> {
  await page.waitForLoadState("networkidle");
  const all = await page.evaluate(() => window.__cspViolations ?? []);
  const violations = all.filter((v) => !DEV_TOOLING_SOURCE.test(v.sourceFile));
  console.log(
    `CSP-DEV-TOOLING-EXCLUDED ${JSON.stringify({ url: page.url(), events: all.length - violations.length, console: collector.devToolingConsole })}`,
  );
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  expect(collector.consoleErrors, JSON.stringify(collector.consoleErrors, null, 2)).toEqual([]);
}

/** The enforced policy carries a nonce and 'strict-dynamic'; no report-only header is used. */
function expectEnforcedCsp(response: Response): void {
  const headers = response.headers();
  const csp = headers["content-security-policy"];
  expect(csp, `no content-security-policy header on ${response.url()}`).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("'nonce-");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
}

/** Asserts the CSP header on a response that is expected to be an error (no violation check). */
function expectCspHeader(headers: Record<string, string>): void {
  const csp = headers["content-security-policy"];
  expect(csp, "no content-security-policy header").toBeTruthy();
  expect(csp).toContain("'nonce-");
  expect(csp).toContain("'strict-dynamic'");
}

/** A 404 can need a compile on first hit too; poll until the router answers 404. */
async function goto404(page: Page, urlPath: string): Promise<Response> {
  let response: Response | null = null;
  await expect
    .poll(
      async () => {
        response = await page.goto(urlPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
        return response?.status() ?? 0;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(404);
  if (!response) throw new Error(`no navigation response for ${urlPath}`);
  return response;
}

/** Clicks the theme toggle and waits until the `dark` class on <html> flips. */
async function toggleTheme(page: Page): Promise<void> {
  const html = page.locator("html");
  const wasDark = await html.evaluate((el) => el.classList.contains("dark"));
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  await expect.poll(() => html.evaluate((el) => el.classList.contains("dark"))).toBe(!wasDark);
}

/**
 * The first request to a route can 404 while the router compiles it; poll past that and return
 * the navigation response (same technique as gotoWarm in a11y-contrast.spec.ts).
 */
async function gotoWarm(page: Page, urlPath: string): Promise<Response> {
  let response: Response | null = null;
  await expect
    .poll(
      async () => {
        response = await page.goto(urlPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
        return response?.status() ?? 0;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe(404);
  if (!response) throw new Error(`no navigation response for ${urlPath}`);
  return response;
}

test.describe("CSP: anonymous pages", () => {
  test("login page carries the enforced nonce policy with zero violations", async ({ page }) => {
    const collector = await collectCsp(page);
    const response = await gotoWarm(page, "/login");
    expectEnforcedCsp(response);
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expectNoViolations(page, collector);
  });
});

test.describe("CSP: anonymous public pages", () => {
  test("public request page has zero violations", async ({ page }) => {
    const collector = await collectCsp(page);
    const response = await gotoWarm(page, "/request");
    expectEnforcedCsp(response);
    await expect(page.locator("form")).toBeVisible();
    await expectNoViolations(page, collector);
  });

  test("public status page has zero violations and sends no referrer", async ({ page }) => {
    const collector = await collectCsp(page);
    const response = await gotoWarm(page, `/status/${ticket.statusToken}`);
    expectEnforcedCsp(response);
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByText("CSP acceptance ticket body.")).toBeVisible();
    await expectNoViolations(page, collector);
  });

  test("C13: 404 pages carry the CSP (anonymous, public prefix)", async ({ page }) => {
    const response = await goto404(page, `/request/${randomUUID()}`);
    expect(response.status()).toBe(404);
    expectCspHeader(response.headers());
  });

  test("C13: an error response that passes through the proxy carries the CSP", async ({ page }) => {
    const response = await page.request.post("/api/public/intake", {
      headers: { "content-type": "text/plain" },
      data: "x",
    });
    expect(response.status()).toBe(400);
    expectCspHeader(response.headers());
  });

  // K125: a malformed percent-encoded path reaches the proxy, whose first branch answers it with a
  // plain-text 400 under a static deny-all policy. Next.js would otherwise render its HTML 400 page
  // with framework scripts and without the proxy's response headers (the original 08-08 blocker).
  test("C13-boundary: an error produced before the proxy is recorded", async ({ page }) => {
    for (const urlPath of ["/status/%E0%A4%A", "/status/%C3%28"]) {
      const response = await page.request.get(urlPath);
      const headers = response.headers();
      const contentType = headers["content-type"] ?? "";
      const body = await response.text();
      const hasCsp = Boolean(headers["content-security-policy"]);
      const hasScript = body.includes("<script");
      console.log(
        `PRE-PROXY-BOUNDARY ${JSON.stringify({ urlPath, status: response.status(), contentType, hasCsp, hasScript })}`,
      );
      expect(response.status(), urlPath).toBe(400);
      expect(contentType, urlPath).toBe("text/plain; charset=utf-8");
      expect(contentType.includes("html"), urlPath).toBe(false);
      expect(hasScript, urlPath).toBe(false);
      expect(headers["content-security-policy"], urlPath).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(headers["content-security-policy-report-only"], urlPath).toBeUndefined();
      expect(headers["x-content-type-options"], urlPath).toBe("nosniff");
      expect(headers["x-frame-options"], urlPath).toBe("DENY");
      expect(headers["referrer-policy"], urlPath).toBe("no-referrer");
    }
  });

  test("C13-boundary control: a valid escaped path gets the normal nonce policy", async ({
    page,
  }) => {
    const response = await page.request.get("/status/abc%20def");
    expect(response.status()).not.toBe(400);
    const headers = response.headers();
    expectCspHeader(headers);
    expect(headers["content-security-policy"]).not.toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("CSP: admin pages", () => {
  test.use({ storageState: ADMIN_STORAGE });

  test("inbox has zero violations, including after switching the theme and back", async ({
    page,
  }) => {
    const collector = await collectCsp(page);
    const response = await gotoWarm(page, "/tickets");
    expectEnforcedCsp(response);
    await expect(page.getByText(`E2E CSP ticket ${ts}`).first()).toBeVisible();
    await toggleTheme(page);
    await toggleTheme(page);
    await expectNoViolations(page, collector);
  });

  test("ticket page has zero violations, including after opening the status dropdown", async ({
    page,
  }) => {
    const collector = await collectCsp(page);
    const response = await gotoWarm(page, `/tickets/${ticket.id}`);
    expectEnforcedCsp(response);
    const menu = page.getByRole("menu");
    // Hydration-robust: a click before hydration does nothing, so retry until the menu opens.
    await expect(async () => {
      await page.getByRole("button", { name: "Change status" }).click();
      await expect(menu).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expectNoViolations(page, collector);
  });

  test("C13: 404 pages carry the CSP (admin, unknown path)", async ({ page }) => {
    const response = await goto404(page, `/${randomUUID()}`);
    expect(response.status()).toBe(404);
    expectCspHeader(response.headers());
  });
});
