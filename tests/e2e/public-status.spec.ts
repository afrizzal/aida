import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTicket, orgId, prisma } from "./support/db";
import { expect, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");

const ts = Date.now();

test.describe("Public status page", () => {
  test("shows only PUBLIC messages, never internal notes", async ({ page }) => {
    const ticket = await createTicket(orgId, {
      subject: `E2E Public Status Visibility ${ts}`,
      priority: "NORMAL",
      body: "Public initial message visible to the customer.",
      contact: { email: `status-visibility-${ts}@example.com` },
      direction: "INBOUND",
    });

    await prisma.message.create({
      data: {
        organizationId: orgId,
        ticketId: ticket.id,
        direction: "OUTBOUND",
        visibility: "INTERNAL",
        bodyMarkdown: "Internal-only note, never for the customer.",
        bodyHtml: "<p>Internal-only note, never for the customer.</p>",
      },
    });

    await page.goto(`/status/${ticket.statusToken}`);
    await expect(page.getByText("Public initial message visible to the customer.")).toBeVisible();
    await expect(page.getByText("Internal-only note, never for the customer.")).not.toBeVisible();
  });

  test("a follow-up on a resolved ticket auto-reopens it, visible on both pages", async ({
    page,
    context,
  }) => {
    const ticket = await createTicket(orgId, {
      subject: `E2E Public Status Reopen ${ts}`,
      priority: "NORMAL",
      body: "Original request body.",
      contact: { email: `status-reopen-${ts}@example.com`, name: "Reopen Customer" },
      direction: "INBOUND",
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    await page.goto(`/status/${ticket.statusToken}`);
    await page.getByPlaceholder("Write a follow-up…").fill("Actually, I still need help.");
    await page.getByRole("button", { name: "Send Follow-up" }).click();

    await expect(page.getByText("Actually, I still need help.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Ticket reopened — new reply from/)).toBeVisible({
      timeout: 15_000,
    });

    const agentPage = await context.browser()!.newPage({ storageState: ADMIN_STORAGE });
    await agentPage.goto(`/tickets/${ticket.id}`);
    await expect(
      agentPage.getByRole("button", { name: "Change status" }).getByText("Open", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(agentPage.getByText(/Ticket reopened — new reply from/)).toBeVisible({
      timeout: 15_000,
    });
    await agentPage.close();
  });

  test("an invalid token shows the dead-end state", async ({ page }) => {
    await page.goto("/status/this-token-does-not-exist");
    await expect(
      page.getByRole("heading", { name: "We couldn't find that ticket" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Submit a new request" })).toBeVisible();
  });
});
