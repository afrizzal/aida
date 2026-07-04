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
