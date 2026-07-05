import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support/fixtures";
import { orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

// UAT gap coverage for Phase 2 — items not exercised by the feature specs.
// Declaration order matters (workers: 1): the empty-inbox assertion must run
// before anything in this file creates a ticket, so run this file against a
// fresh instance (its own `playwright test uat-gaps` invocation).

// ── UAT #11a — brand-new workspace shows the empty-inbox state ──────────────
test("a zero-ticket workspace shows the 'Your inbox is empty' state", async ({ page }) => {
  const ticketCount = await prisma.ticket.count({ where: { organizationId: orgId } });
  expect(ticketCount).toBe(0);

  await page.goto("/tickets");
  await expect(page.getByText("Your inbox is empty")).toBeVisible();
});

// ── UAT #5 (+ #8/#12 evidence) — agent creates a ticket via the New Ticket dialog ──
test("New Ticket dialog creates a ticket that opens in the two-pane layout", async ({ page }) => {
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New Ticket" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New Ticket" })).toBeVisible();
  await dialog.getByLabel("Subject").fill("UAT dialog ticket");
  await dialog.getByLabel("Contact email").fill("uat-dialog@example.com");
  await dialog.getByLabel("Contact name (optional)").fill("UAT Dialog Contact");
  // Priority dropdown: default chip is "Normal" — switch to High
  await dialog.getByRole("button", { name: "Normal" }).click();
  await page.getByRole("menuitemradio", { name: "High" }).click();
  await dialog.getByLabel("Message").fill("Created through the agent New Ticket dialog.");
  await dialog.getByRole("button", { name: "New Ticket" }).click();

  // Server action redirects to /tickets/{id} — reading pane shows the thread
  await page.waitForURL(/\/tickets\/.+/);
  await expect(page.getByText("Created through the agent New Ticket dialog.")).toBeVisible();
  // Two-pane: the list panel (search box) stays visible alongside the thread
  await expect(page.getByPlaceholder("Search tickets…")).toBeVisible();

  // And the new ticket appears in the shared inbox list
  await page.goto("/tickets");
  await expect(page.getByRole("link", { name: /UAT dialog ticket/ })).toBeVisible();
});

// ── UAT #11b — a no-match filter shows 'Nothing here', not an error ─────────
test("a search with no matches shows the 'Nothing here' state", async ({ page }) => {
  await page.goto("/tickets");
  await page.getByPlaceholder("Search tickets…").fill("zzz-nothing-matches-this");
  await expect(page.getByText("Nothing here — no tickets match this view.")).toBeVisible();
});

// ── UAT #26 — contacts list renders and the search box filters it ───────────
test("contacts list shows contacts and filters by search", async ({ page }) => {
  await prisma.contact.create({
    data: {
      organizationId: orgId,
      email: "second-contact@example.com",
      name: "Second Contact",
      company: "Acme Rockets",
    },
  });

  await page.goto("/contacts");
  await expect(page.getByText("UAT Dialog Contact")).toBeVisible();
  await expect(page.getByText("Second Contact")).toBeVisible();
  await expect(page.getByText("Acme Rockets")).toBeVisible();

  await page.getByLabel("Search contacts").fill("Second");
  await expect(page.getByText("Second Contact")).toBeVisible();
  await expect(page.getByText("UAT Dialog Contact")).not.toBeVisible();
});

// ── UAT #22 — admin edits SLA targets and they persist ──────────────────────
test("admin can edit SLA first-response target and it persists", async ({ page }) => {
  await page.goto("/settings/sla");
  const firstResponse = page.locator('input[name="rows.0.firstResponseHours"]');
  await expect(firstResponse).toBeVisible();
  await firstResponse.fill("7.5");
  await page.getByRole("button", { name: "Save SLA Targets" }).click();
  await expect(page.getByText("SLA targets saved.")).toBeVisible();

  await page.reload();
  await expect(page.locator('input[name="rows.0.firstResponseHours"]')).toHaveValue("7.5");
});

// ── UAT #23 — admin renames and deletes a tag (with usage count) ────────────
test("admin can rename a tag inline and delete it after confirming", async ({ page }) => {
  await prisma.tag.create({ data: { organizationId: orgId, name: "uat-tag" } });

  await page.goto("/settings/tags");
  await expect(page.getByText("uat-tag", { exact: true })).toBeVisible();
  await expect(page.getByText("0 tickets")).toBeVisible();

  await page.getByRole("button", { name: "Rename tag uat-tag" }).click();
  // The inline rename input is the only textbox on the tags settings page
  const editInput = page.getByRole("textbox");
  await expect(editInput).toHaveValue("uat-tag");
  await editInput.fill("uat-tag-renamed");
  await editInput.press("Enter");
  await expect(page.getByText("uat-tag-renamed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Delete tag uat-tag-renamed" }).click();
  await expect(page.getByText('Delete tag "uat-tag-renamed"?')).toBeVisible();
  await page.getByRole("button", { name: "Delete tag", exact: true }).click();
  await expect(page.getByText("uat-tag-renamed", { exact: true })).not.toBeVisible();
});

// ── UAT #24 — admin adds, edits, and deletes a custom field definition ──────
test("admin can add, edit, and delete a custom field definition", async ({ page }) => {
  await page.goto("/settings/custom-fields");

  // Create a Dropdown (SELECT) field with two options
  await page.getByRole("button", { name: "Add Field" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Label").fill("UAT Field");
  await dialog.getByRole("button", { name: "Text" }).click();
  await page.getByRole("menuitemradio", { name: "Dropdown" }).click();
  await dialog.getByPlaceholder("Option 1").fill("Red");
  await dialog.getByRole("button", { name: "Add option" }).click();
  await dialog.getByPlaceholder("Option 2").fill("Blue");
  await dialog.getByRole("button", { name: "Create Field" }).click();
  await expect(page.getByText("Custom field created.")).toBeVisible();
  // Scope to main: the closed create-dialog's type trigger can linger in the DOM
  // briefly and also reads "Dropdown" — the row badge is what we're asserting.
  const main = page.locator("main");
  await expect(main.getByText("UAT Field", { exact: true })).toBeVisible();
  await expect(main.getByText("Dropdown", { exact: true })).toBeVisible();

  // Edit the definition's label
  await page.getByRole("button", { name: "Edit field UAT Field" }).click();
  await page.getByRole("dialog").getByLabel("Label").fill("UAT Field 2");
  await page.getByRole("dialog").getByRole("button", { name: "Save Field" }).click();
  await expect(page.getByText("Custom field updated.")).toBeVisible();
  await expect(page.getByText("UAT Field 2", { exact: true })).toBeVisible();

  // Delete after the confirmation dialog
  await page.getByRole("button", { name: "Delete field UAT Field 2" }).click();
  await expect(page.getByText('Delete field "UAT Field 2"?')).toBeVisible();
  await page.getByRole("button", { name: "Delete field", exact: true }).click();
  await expect(page.getByText("UAT Field 2", { exact: true })).not.toBeVisible();
});

// ── UAT #4 — server rejects bad public-intake attachments by real content ───
test("intake API rejects oversized files and content-sniffed disallowed types", async ({
  request,
}) => {
  // 11MB file — over the 10MB per-file cap, under the 30MB request cap
  const oversized = await request.post("/api/public/intake", {
    multipart: {
      name: "UAT Uploader",
      email: "uat-upload@example.com",
      subject: "UAT oversized attachment",
      message: "This should be rejected for size.",
      file: { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024, 65) },
    },
  });
  expect(oversized.status()).toBe(413);
  expect((await oversized.json()).error).toBe("file_too_large");

  // EXE magic bytes disguised with a .png name and image/png content type —
  // the server must sniff the real content, not trust the browser-reported type
  const exeBytes = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(1024, 0)]);
  const disguised = await request.post("/api/public/intake", {
    multipart: {
      name: "UAT Uploader",
      email: "uat-upload@example.com",
      subject: "UAT disguised executable",
      message: "This should be rejected for content type.",
      file: { name: "innocent.png", mimeType: "image/png", buffer: exeBytes },
    },
  });
  expect(disguised.status()).toBe(415);
  expect((await disguised.json()).error).toBe("unsupported_file_type");

  // Neither rejected submission may create a ticket
  const rejected = await prisma.ticket.count({
    where: { subject: { in: ["UAT oversized attachment", "UAT disguised executable"] } },
  });
  expect(rejected).toBe(0);
});

// ── UAT #3 — public intake rate limit: 5 per IP per hour, 6th rejected ──────
// Keep this last: it deliberately exhausts the shared IP bucket (the fixture
// resets rateLimitHit between tests, so it can't leak into other tests anyway).
test("6th intake submission within the window is rate-limited with a message", async ({
  page,
  request,
}) => {
  for (let i = 1; i <= 5; i++) {
    const res = await request.post("/api/public/intake", {
      multipart: {
        name: "UAT Limiter",
        email: "uat-limit@example.com",
        subject: `UAT ratelimit ${i}`,
        message: "Submission inside the allowed window.",
      },
    });
    expect(res.status(), `submission ${i} should pass`).toBe(200);
  }

  const sixth = await request.post("/api/public/intake", {
    multipart: {
      name: "UAT Limiter",
      email: "uat-limit@example.com",
      subject: "UAT ratelimit 6-api",
      message: "This one must be rejected.",
    },
  });
  expect(sixth.status()).toBe(429);
  expect((await sixth.json()).error).toBe("rate_limited");

  // The real form surfaces the rate-limit message instead of a confirmation
  await page.goto("/request");
  await page.getByLabel("Name").fill("UAT Limiter");
  await page.getByLabel("Email").fill("uat-limit@example.com");
  await page.getByLabel("Subject").fill("UAT ratelimit UI");
  await page.getByLabel("Message").fill("Blocked submission through the form.");
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(
    page.getByText("You've submitted a few requests recently. Please wait a bit before trying again."),
  ).toBeVisible();

  const allowed = await prisma.ticket.count({
    where: { organizationId: orgId, subject: { startsWith: "UAT ratelimit " } },
  });
  expect(allowed).toBe(5);
});
