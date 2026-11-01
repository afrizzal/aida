import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, requireBrowser, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_ATTACHMENT = path.resolve(__dirname, "fixtures/sample.png");

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

/** A small file the browser reports as image/gif (only the count matters to these cases). */
const gif = (i: number) => ({
  name: `g${i}.gif`,
  mimeType: "image/gif",
  buffer: Buffer.from("GIF89a"),
});

test.describe("Public intake", () => {
  test("submitting the request form creates a ticket visible in the agent inbox", async ({
    page,
    context,
  }) => {
    const subject = `E2E intake ${Date.now()}`;
    const email = `intake-${Date.now()}@example.com`;

    // The request form is public — use a separate unauthenticated context for the submission
    // so the admin storageState on `page` doesn't leak a session cookie into the public flow.
    const publicPage = await requireBrowser(context).newPage();
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
    if (!ticketHref) throw new Error("ticket link is missing an href attribute");
    await page.goto(ticketHref);

    await expect(page.getByText("I need help with my account, please assist.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/sample\.png/)).toBeVisible();
  });

  test("honeypot fill is silently accepted but creates no ticket", async ({ page, context }) => {
    const subject = `E2E honeypot ${Date.now()}`;
    const email = `honeypot-${Date.now()}@example.com`;

    const publicPage = await requireBrowser(context).newPage();
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

  test("more than 10 files: the form says so in plain English, before sending and from the server's answer (K128)", async ({
    context,
  }) => {
    const publicPage = await requireBrowser(context).newPage();
    await publicPage.goto("/request");
    const tooMany = publicPage.getByText("You can attach up to 10 files to one request.");
    const fileInput = publicPage.locator('input[type="file"]');

    await fileInput.setInputFiles(Array.from({ length: 11 }, (_, i) => gif(i)));
    await expect(tooMany).toBeVisible();
    await fileInput.setInputFiles([gif(0)]);
    await expect(tooMany).not.toBeVisible();

    // The server's 413 too_many_files gets the same sentence.
    await publicPage.route("**/api/public/intake", (route) =>
      route.fulfill({ status: 413, json: { error: "too_many_files" } }),
    );
    await publicPage.getByLabel("Name").fill("Ada Requester");
    await publicPage.getByLabel("Email").fill(`files-${Date.now()}@example.com`);
    await publicPage.getByLabel("Subject").fill("Many files");
    await publicPage.getByLabel("Message").fill("See the attachments.");
    await publicPage.getByRole("button", { name: "Submit Request" }).click();
    await expect(tooMany).toBeVisible();
    await expect(publicPage.getByText("Something went wrong. Please try again.")).not.toBeVisible();
    await publicPage.close();
  });

  test("a field over its length limit shows a field error and sends nothing; a server field error shows under its field (K129)", async ({
    context,
  }) => {
    const publicPage = await requireBrowser(context).newPage();
    let posted = 0;
    publicPage.on("request", (request) => {
      if (request.url().includes("/api/public/intake")) posted++;
    });
    await publicPage.goto("/request");
    await publicPage.getByLabel("Name").fill("Ada Requester");
    await publicPage.getByLabel("Email").fill(`long-${Date.now()}@example.com`);
    await publicPage.getByLabel("Subject").fill("A long message");
    await publicPage.getByLabel("Message").fill("m".repeat(50_001));
    await publicPage.getByRole("button", { name: "Submit Request" }).click();
    await expect(publicPage.getByText("Message must be at most 50,000 characters.")).toBeVisible();
    expect(posted).toBe(0);

    await publicPage.getByLabel("Message").fill("A short message.");
    await publicPage.route("**/api/public/intake", (route) =>
      route.fulfill({
        status: 400,
        json: {
          error: "validation_failed",
          issues: [{ path: ["subject"], message: "Subject must be at most 500 characters." }],
        },
      }),
    );
    await publicPage.getByRole("button", { name: "Submit Request" }).click();
    await expect(publicPage.getByText("Subject must be at most 500 characters.")).toBeVisible();
    await expect(publicPage.getByText("Something went wrong. Please try again.")).not.toBeVisible();
    await publicPage.close();
  });
});
