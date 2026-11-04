/**
 * AIDA-36 (D-14, 09-UI-SPEC Surface 5): every rendered app route state has exactly one <h1>,
 * owned by the page inside <main>. The top-bar title is a <p>, never a heading.
 *
 * Every assertion here runs against a page rendered in the browser; nothing reads source files.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");

/** First-hit compile-race guard: next dev can answer 404 before a route's first compile. */
async function gotoWarm(page: Page, urlPath: string): Promise<void> {
  await expect
    .poll(
      async () => (await page.goto(urlPath, { waitUntil: "load", timeout: 45_000 }))?.status() ?? 0,
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe(404);
}

/**
 * The AIDA-36 assertion on the page as it is rendered now: exactly one h1 in the document (zero
 * and two both fail), that h1 is inside main, its text matches when given, and it is the first
 * heading inside main in DOM order.
 */
async function expectSingleH1(page: Page, text?: string | RegExp): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  const mainH1 = page.locator("main h1");
  await expect(mainH1).toHaveCount(1);
  if (text !== undefined) await expect(mainH1).toHaveText(text);
  const firstHeadingTag = await page
    .locator("main")
    .locator("h1, h2, h3, h4, h5, h6")
    .first()
    .evaluate((element) => element.tagName);
  expect(firstHeadingTag).toBe("H1");
}

/** Warms the route, then asserts the single h1 on the rendered page. */
async function expectRouteSingleH1(page: Page, url: string, text?: string | RegExp) {
  await gotoWarm(page, url);
  await expectSingleH1(page, text);
}

test.describe("AIDA-36 single h1: shared organization", () => {
  test.use({ storageState: ADMIN_STORAGE });

  test("/tickets: one sr-only h1 'Tickets' inside main, the top bar title is not a heading", async ({
    page,
  }) => {
    await expectRouteSingleH1(page, "/tickets", "Tickets");
    // The top bar still shows the same words, as text.
    await expect(page.locator("header p", { hasText: "Tickets" })).toHaveCount(1);
  });
});
