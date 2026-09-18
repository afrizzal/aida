// Phase 11, plan 11-08: keyboard shortcuts (AIDA-49, AIDA-50, D-11, D-13, D-23; UI-SPEC
// Surface 5). Each case asserts what the agent observes (an open or closed dialog, the page the
// browser lands on, the text in a field), never only that a key was pressed. Chromium on macOS
// reports ⌘ as Meta.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { createTicket, orgId } from "./support/db";

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

const ts = Date.now();

/** Seeds tickets carrying a token unique to one case, so the filtered inbox shows only them. */
async function seedTickets(label: string, count: number) {
  const token = `keys${label}${ts}`;
  const seeded: { id: string; subject: string }[] = [];
  for (let index = 1; index <= count; index++) {
    const subject = `E2E Keys ${token} ticket ${index}`;
    const ticket = await createTicket(orgId, {
      subject,
      priority: "NORMAL",
      body: `Seed body ${token} number ${index}`,
      contact: { email: `keys-${token}-${index}@example.com` },
      direction: "INBOUND",
    });
    seeded.push({ id: ticket.id, subject });
  }
  return { token, seeded };
}

function rowLinks(page: Page) {
  return page.locator('a[id^="ticket-row-"]');
}

/** Opens a URL and polls past a first-hit 404 until the list shows the expected rows. */
async function openList(page: Page, route: string, rows: number) {
  await expect
    .poll(async () => {
      await page.goto(route);
      return rowLinks(page).count();
    })
    .toBe(rows);
}

/** Moves focus back to the page body, as when the agent clicks on empty page space. */
async function blurFocus(page: Page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
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

test("the chord hint shows after g and disappears on its own, and a late c does not navigate", async ({
  page,
}) => {
  await warmRoute(page, "/contacts");
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);
  await blurFocus(page);

  const hint = page.getByText("then a letter");
  await page.keyboard.press("g");
  await expect(hint).toBeVisible();
  // No further key: the dispatcher's chord timer clears the chord and the hint (Codex C9).
  await expect(hint).toBeHidden({ timeout: 2_500 });

  await page.keyboard.press("c");
  await page.waitForTimeout(500);
  expect(pathnameOf(page)).toBe("/tickets");
});

test("a filter navigation on the same page cancels a pending g, so the next letter does not navigate (Codex diff critique D7)", async ({
  page,
}) => {
  await warmRoute(page, "/contacts");
  await warmRoute(page, "/tickets?view=unassigned");
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);
  await blurFocus(page);

  const hint = page.getByText("then a letter");
  await page.keyboard.press("g");
  const chordStartedAt = Date.now();
  await expect(hint).toBeVisible();

  // A query-only navigation: same pathname, new search params.
  await page.getByRole("button", { name: "Unassigned", exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\?view=unassigned$/);
  // The hint goes at once, still inside the chord's one second, so only the navigation can
  // have ended the chord (its own timer would end it one second after g).
  await expect(hint).toBeHidden({ timeout: 500 });
  expect(Date.now() - chordStartedAt).toBeLessThan(1_000);
  await page.keyboard.press("c");
  await page.waitForTimeout(500);
  expect(pathnameOf(page)).toBe("/tickets");
});

test("Control+k inside the open palette closes it", async ({ page }) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await expect(palette(page).getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeHidden();
});

test("? opens the help modal with every section, and the palette's Help item opens it too", async ({
  page,
}) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);
  await blurFocus(page);

  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  for (const heading of ["General", "Go to", "Ticket list", "Ticket page"]) {
    await expect(help.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(help.getByText("Go to Contacts", { exact: true })).toBeVisible();
  await expect(help.getByText("Write an internal note", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await expect(palette(page).getByText("for all shortcuts")).toBeVisible();
  await palette(page)
    .getByRole("group", { name: "Help" })
    .getByRole("option", { name: "Show keyboard shortcuts", exact: true })
    .click();
  await expect(help).toBeVisible();
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("j and k move focus through the loaded rows without wrapping, x selects, Esc clears, Enter opens", async ({
  page,
}) => {
  const { token } = await seedTickets("list", 3);
  await openList(page, `/tickets?q=${token}`, 3);
  await waitForShortcuts(page);
  await blurFocus(page);

  const rows = rowLinks(page);
  await page.keyboard.press("j");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(2)).toBeFocused();
  // Past the last loaded row: no wrap, nothing more is loaded.
  await page.keyboard.press("j");
  await expect(rows.nth(2)).toBeFocused();
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("k");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();

  // The row container holds the row link and its checkbox side by side.
  const firstCheckbox = rows.nth(0).locator("xpath=..").getByRole("checkbox");
  const bulkBar = page.getByRole("region", { name: "Bulk actions" });
  await page.keyboard.press("x");
  await expect(firstCheckbox).toBeChecked();
  await expect(page.getByText("1 ticket selected")).toBeVisible();
  await expect(bulkBar).toContainText("1 ticket selected");
  await page.keyboard.press("Escape");
  await expect(firstCheckbox).not.toBeChecked();
  await expect(page.getByText("1 ticket selected")).toHaveCount(0);
  await expect(bulkBar).toHaveCount(0);

  // Esc cleared the selection only; the cursor row keeps focus and Enter opens it.
  await expect(rows.nth(0)).toBeFocused();
  const firstId = ((await rows.nth(0).getAttribute("id")) ?? "").replace("ticket-row-", "");
  await page.keyboard.press("Enter");
  await expect.poll(() => pathnameOf(page)).toBe(`/tickets/${firstId}`);
});

test("with a ticket open, j starts at the open ticket's row", async ({ page }) => {
  const { token, seeded } = await seedTickets("open", 3);
  const rows = rowLinks(page);
  await openList(page, `/tickets/${seeded[1].id}?q=${token}`, 3);
  await waitForShortcuts(page);
  await blurFocus(page);

  await page.keyboard.press("j");
  await expect(page.locator(`#ticket-row-${seeded[1].id}`)).toBeFocused();
  await expect(rows).toHaveCount(3);
});

test("on the ticket page s, a and t open their controls, and r and n focus the composer", async ({
  page,
}) => {
  const { token, seeded } = await seedTickets("page", 1);
  await openList(page, `/tickets/${seeded[0].id}?q=${token}`, 1);
  await waitForShortcuts(page);
  await blurFocus(page);

  // s: the status menu opens with focus on the current status.
  await page.keyboard.press("s");
  const current = page.getByRole("menuitemradio", { name: "New", exact: true });
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Pending", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // a: the assignee menu opens with focus on the current value (unassigned).
  await blurFocus(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("menuitemradio", { name: "Unassign", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // t: the add-tag picker opens with focus in its search input.
  await blurFocus(page);
  await page.keyboard.press("t");
  const tagSearch = page.getByPlaceholder("Search or create tag…");
  await expect(tagSearch).toBeFocused();
  await expect(tagSearch).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(tagSearch).toHaveCount(0);

  // r: the composer in Public Reply mode; the key itself is not typed.
  await blurFocus(page);
  await page.keyboard.press("r");
  const reply = page.getByPlaceholder("Write a reply…");
  await expect(reply).toBeFocused();
  await expect(reply).toHaveValue("");
  await page.keyboard.type("Draft text");

  // n: Internal Note mode, the text is kept and the caret is at the end.
  await blurFocus(page);
  await page.keyboard.press("n");
  const note = page.getByPlaceholder("Write an internal note…");
  await expect(note).toBeFocused();
  await expect(note).toHaveValue("Draft text");
  expect(await note.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(
    "Draft text".length,
  );
});

test("the palette's This ticket group runs the same handlers as the keys", async ({ page }) => {
  const { token, seeded } = await seedTickets("palette", 1);
  await openList(page, `/tickets/${seeded[0].id}?q=${token}`, 1);
  await waitForShortcuts(page);

  await page.keyboard.press("Meta+k");
  const thisTicket = palette(page).getByRole("group", { name: "This ticket" });
  await expect(thisTicket.getByRole("option")).toHaveText([
    /Assign this ticket/,
    /Change status/,
    /Add a tag/,
    /Reply to the customer/,
    /Write an internal note/,
  ]);
  await thisTicket.getByRole("option", { name: "Write an internal note", exact: true }).click();
  await expect(palette(page)).toBeHidden();
  // Focus stays where the command put it after the palette has closed.
  const note = page.getByPlaceholder("Write an internal note…");
  await expect(note).toBeFocused();
  await page.waitForTimeout(500);
  await expect(note).toBeFocused();
});

// Plan 11-09 (D-23): the cases below complete the phase's keyboard evidence. The cases above
// (from 11-08) are reused as they stand, with two assertions added in 11-09: the Bulk actions
// region in the list case and the "Pending" item in the ticket-page case.

test("j and k on an empty list focus nothing", async ({ page }) => {
  await openRoute(page, `/tickets?q=keysnomatch${ts}zz`);
  await expect(page.getByPlaceholder("Search tickets…")).toHaveValue(`keysnomatch${ts}zz`);
  await waitForShortcuts(page);
  await blurFocus(page);

  await page.keyboard.press("j");
  await page.keyboard.press("k");
  // Give a wrongly moved focus time to land before asserting it never did.
  await page.waitForTimeout(300);
  await expect(rowLinks(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("letters typed into the internal-note composer stay in it", async ({ page }) => {
  const { token, seeded } = await seedTickets("type", 1);
  await openList(page, `/tickets/${seeded[0].id}?q=${token}`, 1);
  await waitForShortcuts(page);
  await blurFocus(page);

  await page.keyboard.press("n");
  const note = page.getByPlaceholder("Write an internal note…");
  await expect(note).toBeFocused();
  await page.keyboard.type("s");
  await page.waitForTimeout(300);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(note).toBeFocused();
  await expect(note).toHaveValue(/s$/);
});

test("? typed into the inbox search input opens no dialog", async ({ page }) => {
  await openRoute(page, "/tickets");
  await waitForShortcuts(page);

  const search = page.getByPlaceholder("Search tickets…");
  await search.click();
  await expect(search).toBeFocused();
  await page.keyboard.type("?");
  await expect(search).toHaveValue(/\?/);
  // Give a wrongly opened dialog time to appear before asserting it never did.
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the palette's Change status opens the status menu, and Show keyboard shortcuts opens help", async ({
  page,
}) => {
  const { token, seeded } = await seedTickets("status", 1);
  await openList(page, `/tickets/${seeded[0].id}?q=${token}`, 1);
  await waitForShortcuts(page);

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await palette(page)
    .getByRole("group", { name: "This ticket" })
    .getByRole("option", { name: "Change status", exact: true })
    .click();
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole("menuitemradio", { name: "Pending", exact: true })).toBeVisible();

  // Meta+k does nothing inside an open menu (Codex C4), so the menu is closed first.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await palette(page)
    .getByRole("group", { name: "Help" })
    .getByRole("option", { name: "Show keyboard shortcuts", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});
