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
import type { Page, Response } from "@playwright/test";
import { expect, test } from "./support/fixtures";

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
