import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTicket, orgId, prisma, stateIdFor } from "./support/db";
import { expect, requireBrowser, test } from "./support/fixtures";

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
      data: { stateId: await stateIdFor("RESOLVED"), resolvedAt: new Date() },
    });

    await page.goto(`/status/${ticket.statusToken}`);
    // The public chip shows the fixed label of the ticket's group, never the state name (D-13).
    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: /^Resolved$/ }),
    ).toBeVisible();
    await page.getByPlaceholder("Write a follow-up…").fill("Actually, I still need help.");
    await page.getByRole("button", { name: "Send Follow-up" }).click();

    await expect(page.getByText("Actually, I still need help.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Ticket reopened — new reply from/)).toBeVisible({
      timeout: 15_000,
    });

    const agentPage = await requireBrowser(context).newPage({ storageState: ADMIN_STORAGE });
    await agentPage.goto(`/tickets/${ticket.id}`);
    await expect(
      agentPage.getByRole("button", { name: "Change status" }).getByText("Open", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(agentPage.getByText(/Ticket reopened — new reply from/)).toBeVisible({
      timeout: 15_000,
    });
    await agentPage.close();
  });

  test("the follow-up form refuses more than 10 files and an over-long message in plain English (K128, K129)", async ({
    page,
  }) => {
    const ticket = await createTicket(orgId, {
      subject: `E2E Public Status Limits ${ts}`,
      priority: "NORMAL",
      body: "Original request body.",
      contact: { email: `status-limits-${ts}@example.com` },
      direction: "INBOUND",
    });
    let posted = 0;
    page.on("request", (request) => {
      if (request.url().includes("/follow-up")) posted++;
    });
    await page.goto(`/status/${ticket.statusToken}`);
    const tooMany = page.getByText("You can attach up to 10 files to one follow-up.");
    const tooLong = page.getByText("Your message is too long. The limit is 50,000 characters.");
    const gif = (i: number) => ({
      name: `g${i}.gif`,
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a"),
    });

    await page
      .locator('input[type="file"]')
      .setInputFiles(Array.from({ length: 11 }, (_, i) => gif(i)));
    await expect(tooMany).toBeVisible();

    await page.getByPlaceholder("Write a follow-up…").fill("m".repeat(50_001));
    await page.getByRole("button", { name: "Send Follow-up" }).click();
    await expect(tooLong).toBeVisible();
    expect(posted).toBe(0);

    // The server's answers get the same sentences.
    await page.locator('input[type="file"]').setInputFiles([gif(0)]);
    await expect(tooMany).not.toBeVisible();
    await page.getByPlaceholder("Write a follow-up…").fill("A short follow-up.");
    await expect(tooLong).not.toBeVisible();
    await page.route("**/follow-up", (route) =>
      route.fulfill({ status: 413, json: { error: "too_many_files" } }),
    );
    await page.getByRole("button", { name: "Send Follow-up" }).click();
    await expect(tooMany).toBeVisible();
    await page.unroute("**/follow-up");
    await page.route("**/follow-up", (route) =>
      route.fulfill({
        status: 400,
        json: {
          error: "validation_failed",
          issues: [
            {
              code: "too_big",
              path: ["message"],
              message: "Message must be at most 50,000 characters.",
            },
          ],
        },
      }),
    );
    await page.getByRole("button", { name: "Send Follow-up" }).click();
    await expect(tooLong).toBeVisible();
    await expect(page.getByText("Couldn't send your follow-up. Try again.")).not.toBeVisible();
  });

  test("a server 413 too_many_parts gets its own plain-English sentence on the follow-up form (K135)", async ({
    page,
  }) => {
    const ticket = await createTicket(orgId, {
      subject: `E2E Public Status Parts ${ts}`,
      priority: "NORMAL",
      body: "Original request body.",
      contact: { email: `status-parts-${ts}@example.com` },
      direction: "INBOUND",
    });
    await page.goto(`/status/${ticket.statusToken}`);
    await page.route("**/follow-up", (route) =>
      route.fulfill({ status: 413, json: { error: "too_many_parts" } }),
    );
    await page.getByPlaceholder("Write a follow-up…").fill("A short follow-up.");
    await page.getByRole("button", { name: "Send Follow-up" }).click();
    await expect(
      page.getByText(
        "Your follow-up has too many parts to send. Attach at most 10 files and try again.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Couldn't send your follow-up. Try again.")).not.toBeVisible();
  });

  test("an invalid token shows the dead-end state", async ({ page }) => {
    await page.goto("/status/this-token-does-not-exist");
    await expect(page.getByRole("heading", { name: "We couldn't find that ticket" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Submit a new request" })).toBeVisible();
  });
});
