import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
const EMAIL_MIXED = `Contact-${ts}@Example.com`;
const EMAIL_LOWER = `contact-${ts}@example.com`;
const SUBJECT_ONE = `E2E Contacts First ${ts}`;
const SUBJECT_TWO = `E2E Contacts Second ${ts}`;

test.describe("Contacts", () => {
  test.beforeAll(async () => {
    await createTicket(orgId, {
      subject: SUBJECT_ONE,
      priority: "NORMAL",
      body: "First ticket from this contact",
      contact: { email: EMAIL_MIXED, name: "Case Variant Contact" },
      direction: "INBOUND",
    });
    await createTicket(orgId, {
      subject: SUBJECT_TWO,
      priority: "NORMAL",
      body: "Second ticket from the same contact, different email casing",
      contact: { email: EMAIL_LOWER },
      direction: "INBOUND",
    });
  });

  test("case-variant emails dedupe to a single contact with both tickets in history", async ({
    page,
  }) => {
    const contacts = await prisma.contact.findMany({
      where: { organizationId: orgId, email: { equals: EMAIL_LOWER, mode: "insensitive" } },
    });
    expect(contacts).toHaveLength(1);
    const contactId = contacts[0].id;

    await page.goto("/contacts");
    await page.getByLabel("Search contacts").fill(EMAIL_LOWER);
    await expect(page.getByRole("link", { name: new RegExp(EMAIL_LOWER, "i") })).toHaveCount(1);

    await page.goto(`/contacts/${contactId}`);
    await expect(page.getByRole("link", { name: new RegExp(SUBJECT_ONE) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(SUBJECT_TWO) })).toBeVisible();
  });

  test("a navigation that clears the search is not reverted by the search box (review WR-01)", async ({
    page,
  }) => {
    await page.goto("/contacts");
    const search = page.getByLabel("Search contacts");
    // Typing reaches the URL through the client router, which also proves hydration, so the
    // sidebar click below is a client-side navigation that keeps ContactSearch mounted.
    await search.fill(EMAIL_LOWER);
    await expect(page).toHaveURL(/\/contacts\?q=/);

    await page.locator("aside").getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(search).toHaveValue("");

    // The debounced replace runs 300 ms after a change; wait well past it and check that the
    // old query did not come back.
    await page.waitForTimeout(900);
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(search).toHaveValue("");

    // Typing still drives the URL after the outside navigation.
    await search.fill("case variant");
    await expect(page).toHaveURL(/\/contacts\?q=case\+variant$/);
  });

  test("a navigation started inside the 300 ms debounce is not overridden by the search (Codex diff critique D4)", async ({
    page,
  }) => {
    await page.goto("/contacts");
    const search = page.getByLabel("Search contacts");
    // Typing reaches the URL through the client router, which proves hydration.
    await search.fill(EMAIL_LOWER);
    await expect(page).toHaveURL(/\/contacts\?q=/);

    // Hold the destination's requests for one second, well past the debounce: /contacts stays
    // mounted (the navigation has not committed) when the pending search would fire.
    let held = 0;
    await page.route(
      (url) => url.pathname === "/tickets",
      async (route) => {
        held++;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        await route.fallback();
      },
    );

    await search.fill(`late ${ts}`);
    await page.locator("aside").getByRole("link", { name: "Tickets", exact: true }).click();
    await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });
    expect(held).toBeGreaterThan(0);

    // Wait well past the debounce: the typed text must not send the browser back to Contacts.
    await page.waitForTimeout(900);
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByLabel("Search contacts")).toHaveCount(0);
  });

  test("notes autosave on blur and survive reload", async ({ page }) => {
    const contact = await prisma.contact.findFirstOrThrow({
      where: { organizationId: orgId, email: { equals: EMAIL_LOWER, mode: "insensitive" } },
    });
    const noteText = `E2E note ${ts}`;

    await page.goto(`/contacts/${contact.id}`);
    await page.getByLabel("Notes").fill(noteText);
    await page.getByLabel("Notes").blur();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Notes")).toHaveValue(noteText);
  });
});
