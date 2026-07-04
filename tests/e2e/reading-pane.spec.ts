import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createTicket, orgId } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
const SUBJECT = `E2E Reading Pane ${ts}`;

let ticketId: string;

test.beforeAll(async () => {
  const ticket = await createTicket(orgId, {
    subject: SUBJECT,
    priority: "NORMAL",
    body: "Initial inbound message",
    contact: { email: `reading-pane-${ts}@example.com` },
    direction: "INBOUND",
  });
  ticketId = ticket.id;
});

test("posts a public reply rendered from markdown", async ({ page }) => {
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole("button", { name: "Public Reply" }).click();
  await page.getByPlaceholder("Write a reply…").fill("This is a **bold** public reply.");
  await page.getByRole("button", { name: "Send Reply" }).click();

  await expect(page.locator("strong", { hasText: "bold" })).toBeVisible();
});

test("posts an internal note with distinct amber styling, separate from public replies", async ({
  page,
}) => {
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole("button", { name: "Internal Note" }).click();
  await page.getByPlaceholder("Write an internal note…").fill("Internal-only note text.");
  await page.getByRole("button", { name: "Save Internal Note" }).click();

  const noteMessage = page.locator(".border-l-warning");
  await expect(noteMessage).toContainText("Internal-only note text.");
  await expect(noteMessage.getByText("Internal Note", { exact: true })).toBeVisible();
});
