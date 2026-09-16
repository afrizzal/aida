// Phase 11, plan 11-07: the command palette (AIDA-49, D-11, D-12, D-23; UI-SPEC Surface 4).
// Each case asserts what an agent observes in the palette and where a choice lands, never a
// keystroke script. Tickets carry a token unique to the run, so other specs' rows never match.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { createTicket, orgId } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function seedTicket(token: string) {
  const subject = `E2E Palette ${token} subject`;
  const ticket = await createTicket(orgId, {
    subject,
    priority: "NORMAL",
    body: `Seed body ${token}`,
    contact: { email: `palette-${token}@example.com` },
    direction: "INBOUND",
  });
  return { id: ticket.id, number: ticket.number, subject };
}

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

/**
 * next dev compiles /api/palette/tickets on its first hit and can answer a transient 404 before
 * that; the palette would then show its search-error row. Warm it with the page's session first.
 */
async function warmPaletteSearch(page: Page) {
  await expect
    .poll(async () => (await page.request.get("/api/palette/tickets?q=warm")).status())
    .toBe(200);
}

/** Opens the palette from the top-bar trigger. */
async function openPalette(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Search" }).click();
  await expect(palette(page)).toBeVisible();
}

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await warmPaletteSearch(page);
  });

  test("finds a ticket from the top-bar trigger and opens it", async ({ page }) => {
    const token = `paltracer${ts}`;
    const ticket = await seedTicket(token);

    await openRoute(page, "/tickets");
    await openPalette(page);
    await palette(page).getByRole("combobox").fill(token);

    const option = palette(page).getByRole("option").filter({ hasText: ticket.subject });
    await expect(option).toBeVisible();
    await expect(option).toContainText(`#${ticket.number}`);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
    await expect(palette(page)).toBeHidden();
  });
});
