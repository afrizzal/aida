import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_ATTACHMENT = path.resolve(__dirname, "fixtures/sample.png");

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

test.describe("Public intake", () => {
  test("submitting the request form creates a ticket visible in the agent inbox", async ({
    page,
    context,
  }) => {
    const subject = `E2E intake ${Date.now()}`;
    const email = `intake-${Date.now()}@example.com`;

    // The request form is public — use a separate unauthenticated context for the submission
    // so the admin storageState on `page` doesn't leak a session cookie into the public flow.
    const publicPage = await context.browser()!.newPage();
    await publicPage.goto("/request");
    await publicPage.getByLabel("Name").fill("Ada Requester");
    await publicPage.getByLabel("Email").fill(email);
    await publicPage.getByLabel("Subject").fill(subject);
    await publicPage.getByLabel("Message").fill("I need help with my account, please assist.");
    await publicPage.locator('input[type="file"]').setInputFiles(SAMPLE_ATTACHMENT);
    await publicPage.getByRole("button", { name: "Submit Request" }).click();

    await expect(publicPage.getByRole("heading", { name: "Request received" })).toBeVisible();
    const statusLink = publicPage.getByRole("link", { name: "View status" });
    await expect(statusLink).toBeVisible();
    const statusHref = await statusLink.getAttribute("href");
    expect(statusHref).toMatch(/^\/status\//);
    await publicPage.close();

    await page.goto("/tickets");
    await page.getByPlaceholder("Search tickets…").fill(subject);
    const ticketLink = page.getByRole("link", { name: new RegExp(subject) });
    await expect(ticketLink).toBeVisible();
    // Not clicking the row here: TicketSearchInput's debounced router.push can still fire
    // after the click (stale `value` vs. fresh `pathname` in its effect — see final report),
    // clobbering the navigation and bouncing back to the search results. Read the href and
    // navigate directly instead, since this scenario is about the ticket's content, not the
    // search-box click interaction.
    const ticketHref = await ticketLink.getAttribute("href");
    await page.goto(ticketHref!);

    await expect(page.getByText("I need help with my account, please assist.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/sample\.png/)).toBeVisible();
  });

  test("honeypot fill is silently accepted but creates no ticket", async ({ page, context }) => {
    const subject = `E2E honeypot ${Date.now()}`;
    const email = `honeypot-${Date.now()}@example.com`;

    const publicPage = await context.browser()!.newPage();
    await publicPage.goto("/request");
    await publicPage.getByLabel("Name").fill("Bot Requester");
    await publicPage.getByLabel("Email").fill(email);
    await publicPage.getByLabel("Subject").fill(subject);
    await publicPage.getByLabel("Message").fill("This should never become a ticket.");
    await publicPage.locator('[name="company_website"]').fill("http://spam.example.com");
    await publicPage.getByRole("button", { name: "Submit Request" }).click();

    await expect(publicPage.getByRole("heading", { name: "Request received" })).toBeVisible();
    await publicPage.close();

    await page.goto("/tickets");
    await page.getByPlaceholder("Search tickets…").fill(subject);
    await expect(page.getByText("Nothing here — no tickets match this view.")).toBeVisible();
  });
});
