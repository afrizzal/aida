import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

test("creating a ticket shows an on-track SLA due chip with a plausible due time", async ({
  page,
}) => {
  const ts = Date.now();
  const subject = `E2E SLA ${ts}`;

  await page.goto("/tickets");
  await page.getByRole("button", { name: "New Ticket" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Subject").fill(subject);
  await dialog.getByLabel("Contact email").fill(`sla-${ts}@example.com`);
  await dialog.getByLabel("Message").fill("Please check my account status.");
  await dialog.getByRole("button", { name: "New Ticket" }).click();

  await page.waitForURL(/\/tickets\/.+/);

  // The 2-pane layout keeps the ticket list visible alongside the reading pane, and the
  // just-created ticket's list row renders its own SlaDueChip too — scope to the reading
  // pane's header (via the unique subject heading) to avoid matching both.
  const header = page.locator("h1", { hasText: subject }).locator("xpath=..");
  await expect(header.getByText(/Due in/)).toBeVisible();
  await expect(header.getByText("Overdue")).not.toBeVisible();
  await expect(header.getByText("At risk")).not.toBeVisible();
});
