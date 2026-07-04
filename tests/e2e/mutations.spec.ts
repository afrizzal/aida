import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function seedTicket(label: string) {
  const ticket = await createTicket(orgId, {
    subject: `E2E Mutations ${label} ${ts}`,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email: `mutations-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  return ticket.id;
}

test.describe("Ticket mutations", () => {
  test("status lifecycle new -> open -> pending -> resolved -> closed persists across reload", async ({
    page,
  }) => {
    const ticketId = await seedTicket("status");
    await page.goto(`/tickets/${ticketId}`);

    const statusButton = page.getByRole("button", { name: "Change status" });
    const dbStatus: Record<string, string> = {
      Open: "OPEN",
      Pending: "PENDING",
      Resolved: "RESOLVED",
      Closed: "CLOSED",
    };
    for (const status of ["Open", "Pending", "Resolved", "Closed"]) {
      await statusButton.click();
      await page.getByRole("menuitemradio", { name: status }).click();
      await page.keyboard.press("Escape");

      // Wait for the Server Action to actually persist before reloading — reloading while
      // the mutation's fetch is still in flight can abort it, racing the assertion below.
      await expect
        .poll(async () => {
          const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
          return updated.status;
        })
        .toBe(dbStatus[status]);

      await page.reload();
      await expect(statusButton.getByText(status, { exact: true })).toBeVisible();
    }
  });

  test("changing priority recomputes SLA due timestamps and clears stale flags", async ({
    page,
  }) => {
    const ticketId = await seedTicket("priority");
    await page.goto(`/tickets/${ticketId}`);

    const priorityButton = page.getByRole("button", { name: "Change priority" });
    await priorityButton.click();
    await page.getByRole("menuitemradio", { name: "Urgent" }).click();
    await page.keyboard.press("Escape");

    await expect(priorityButton.getByText("Urgent", { exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
        return updated.firstResponseTargetMinutes;
      })
      .toBe(60);

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(updated.resolutionTargetMinutes).toBe(480);
    expect(updated.isAtRisk).toBe(false);
    expect(updated.isBreached).toBe(false);
  });

  test("assigns a ticket to self", async ({ page }) => {
    const subject = `E2E Mutations assign ${ts}`;
    const ticketId = await seedTicket("assign");
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });

    await page.goto(`/tickets/${ticketId}`);

    // FilterChipRow's "Unassigned" view-pill (still visible in the list panel alongside
    // the reading pane) shares the exact same accessible name as the assignee dropdown's
    // trigger button — scope to the reading pane's header via the unique subject heading.
    const header = page.locator("h1", { hasText: subject }).locator("xpath=..");
    await header.getByRole("button", { name: /Unassigned/ }).click();
    await page.getByRole("menuitemradio", { name: admin.name }).click();
    await page.keyboard.press("Escape");

    await expect(header.getByRole("button", { name: new RegExp(admin.name) })).toBeVisible();

    await expect
      .poll(async () => {
        const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
        return updated.assigneeId;
      })
      .toBe(admin.id);
  });

  test("adds and removes a tag", async ({ page }) => {
    const ticketId = await seedTicket("tag");
    const tagName = `e2e-mutations-tag-${ts}`;

    await page.goto(`/tickets/${ticketId}`);
    await page.getByRole("button", { name: "Add tag" }).click();
    await page.getByPlaceholder("Search or create tag…").fill(tagName);
    await page.keyboard.press("Enter");

    // The 2-pane layout's list row renders the same tag chip (without a remove control) —
    // scope to the meta header's tag section (identified by the "Add tag" button) so this
    // doesn't match both.
    const tagSection = page.getByRole("button", { name: "Add tag" }).locator("xpath=..");
    await expect(tagSection.getByText(tagName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Remove tag ${tagName}` }).click();
    await expect(tagSection.getByText(tagName, { exact: true })).not.toBeVisible();
  });

  test("sets a custom field value that persists across reload", async ({ page }) => {
    const ticketId = await seedTicket("customfield");
    const fieldLabel = `E2E Mutations Field ${ts}`;
    const fieldValue = `e2e-mutations-value-${ts}`;

    await prisma.customFieldDefinition.create({
      data: { organizationId: orgId, label: fieldLabel, type: "TEXT" },
    });

    await page.goto(`/tickets/${ticketId}`);
    await page.getByLabel(fieldLabel).fill(fieldValue);

    await expect
      .poll(
        async () => {
          const value = await prisma.customFieldValue.findFirst({
            where: { ticketId, definition: { label: fieldLabel } },
          });
          return value?.valueText ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(fieldValue);

    await page.reload();
    await expect(page.getByLabel(fieldLabel)).toHaveValue(fieldValue);
  });
});
