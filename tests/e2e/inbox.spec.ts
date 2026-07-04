import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
const ALPHA_SUBJECT = `E2E Inbox Alpha ${ts}`;
const BETA_SUBJECT = `E2E Inbox Beta ${ts}`;
const GAMMA_SUBJECT = `E2E Inbox Gamma ${ts}`;
const UNIQUE_BODY_TOKEN = `unique-body-alpha-${ts}`;
const TAG_NAME = `e2e-tag-${ts}`;
const FIELD_LABEL = `E2E Field ${ts}`;
const FIELD_VALUE = `e2e-value-${ts}`;

test.describe("Inbox filters and search", () => {
  test.beforeAll(async () => {
    await createTicket(orgId, {
      subject: ALPHA_SUBJECT,
      priority: "NORMAL",
      body: `${UNIQUE_BODY_TOKEN} needs assistance`,
      contact: { email: `alpha-${ts}@example.com` },
      direction: "INBOUND",
    });

    const beta = await createTicket(orgId, {
      subject: BETA_SUBJECT,
      priority: "NORMAL",
      body: "Beta ticket body",
      contact: { email: `beta-${ts}@example.com` },
      direction: "INBOUND",
    });
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.ticket.update({
      where: { id: beta.id },
      data: { status: "OPEN", assigneeId: adminUser.id },
    });

    const gamma = await createTicket(orgId, {
      subject: GAMMA_SUBJECT,
      priority: "NORMAL",
      body: "Gamma ticket body",
      contact: { email: `gamma-${ts}@example.com` },
      direction: "INBOUND",
    });
    await prisma.ticket.update({ where: { id: gamma.id }, data: { status: "PENDING" } });

    const tag = await prisma.tag.create({ data: { organizationId: orgId, name: TAG_NAME } });
    await prisma.ticketTag.create({ data: { ticketId: gamma.id, tagId: tag.id } });

    const definition = await prisma.customFieldDefinition.create({
      data: { organizationId: orgId, label: FIELD_LABEL, type: "TEXT" },
    });
    await prisma.customFieldValue.create({
      data: {
        organizationId: orgId,
        ticketId: gamma.id,
        customFieldDefinitionId: definition.id,
        valueText: FIELD_VALUE,
      },
    });
  });

  test("Unassigned view shows the unassigned ticket, not the assigned one", async ({ page }) => {
    await page.goto("/tickets");
    await page.getByRole("button", { name: "Unassigned" }).click();
    await expect(page.getByRole("link", { name: new RegExp(ALPHA_SUBJECT) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(BETA_SUBJECT) })).not.toBeVisible();
  });

  test("Mine view shows the ticket assigned to the current agent", async ({ page }) => {
    await page.goto("/tickets");
    await page.getByRole("button", { name: "Mine" }).click();
    await expect(page.getByRole("link", { name: new RegExp(BETA_SUBJECT) })).toBeVisible();
  });

  test("Status filter narrows the list to the selected status", async ({ page }) => {
    await page.goto("/tickets");
    await page.getByRole("button", { name: "Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Pending" }).click();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("link", { name: new RegExp(GAMMA_SUBJECT) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(ALPHA_SUBJECT) })).not.toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(BETA_SUBJECT) })).not.toBeVisible();
  });

  test("Tag filter narrows the list to tickets carrying that tag", async ({ page }) => {
    await page.goto("/tickets");
    await page.getByRole("button", { name: "Tag" }).click();
    await page.getByPlaceholder("Search tags…").fill(TAG_NAME);
    await page.getByRole("option", { name: TAG_NAME }).click();

    await expect(page.getByRole("link", { name: new RegExp(GAMMA_SUBJECT) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(ALPHA_SUBJECT) })).not.toBeVisible();
  });

  test("Custom field filter narrows the list to tickets with a matching value", async ({
    page,
  }) => {
    await page.goto("/tickets");
    await page.getByRole("button", { name: "Custom field" }).click();
    await page.getByRole("menuitemradio", { name: FIELD_LABEL }).click();
    await page.getByPlaceholder("Value…").fill(FIELD_VALUE);
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page.getByRole("link", { name: new RegExp(GAMMA_SUBJECT) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(ALPHA_SUBJECT) })).not.toBeVisible();
  });

  test("Full-text search finds a ticket by body text", async ({ page }) => {
    await page.goto("/tickets");
    await page.getByPlaceholder("Search tickets…").fill(UNIQUE_BODY_TOKEN);

    await expect(page.getByRole("link", { name: new RegExp(ALPHA_SUBJECT) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(BETA_SUBJECT) })).not.toBeVisible();
  });
});
