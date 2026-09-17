// Phase 11, plan 11-08: keyboard shortcuts (AIDA-49, AIDA-50, D-11, D-13, D-23; UI-SPEC
// Surface 5). Each case asserts what the agent observes (an open or closed dialog, the page the
// browser lands on, the text in a field), never only that a key was pressed. Chromium on macOS
// reports ⌘ as Meta.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Command palette" });
}

/** Opens a route, polling past a first-hit 404 while next dev compiles it. */
async function openRoute(page: Page, route: string) {
  await expect
    .poll(async () => {
      const response = await page.goto(route);
      return response?.status() ?? 0;
    })
    .toBe(200);
}

/** Warms a page route, so a later client navigation to it does not wait on its first compile. */
async function warmRoute(page: Page, route: string) {
  await expect.poll(async () => (await page.request.get(route)).status()).toBe(200);
}

/**
 * Waits until the dispatcher listens: a key pressed before hydration has no handler yet, so
 * Meta+k is retried until the palette opens, then the palette is closed with Escape.
 */
async function waitForShortcuts(page: Page) {
  await expect(async () => {
    if (!(await palette(page).isVisible())) await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
}

function pathnameOf(page: Page): string {
  return new URL(page.url()).pathname;
}

test("Meta+k opens the command palette on /tickets and Meta+k again closes it", async ({
  page,
}) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeHidden();
});

test("Control+k opens the command palette", async ({ page }) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
});

test("Meta+k opens the palette while focus is in the inbox search input", async ({ page }) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  const search = page.getByPlaceholder("Search tickets…");
  await search.click();
  await expect(search).toBeFocused();
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
});

test("Meta+k does nothing while the New Ticket dialog is open", async ({ page }) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  await page.getByRole("button", { name: "New Ticket" }).click();
  const newTicket = page.getByRole("dialog", { name: "New Ticket" });
  await expect(newTicket).toBeVisible();

  await page.keyboard.press("Meta+k");
  // Give a wrongly opened palette time to appear before asserting it never did.
  await page.waitForTimeout(500);
  await expect(palette(page)).toBeHidden();
  await expect(newTicket).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("g then c from the inbox lands on Contacts", async ({ page }) => {
  await warmRoute(page, "/contacts");
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect.poll(() => pathnameOf(page)).toBe("/contacts");
});

test("g then c typed into the inbox search input stays in the input", async ({ page }) => {
  await warmRoute(page, "/contacts");
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  const search = page.getByPlaceholder("Search tickets…");
  await search.click();
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(search).toHaveValue(/gc/);
  // Past the chord's one second: the dispatcher never navigated. (The search box's own
  // debounce may add ?q=gc to the inbox URL; the page stays the inbox.)
  await page.waitForTimeout(1_500);
  expect(pathnameOf(page)).toBe("/tickets");
  await expect(search).toHaveValue(/gc/);
});
