import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { snoozeWakeHandler } from "../../src/lib/worker/jobs/snooze-wake";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
const CLOSED_REASON = "Closed tickets can't be snoozed. Reopen the ticket first.";

async function seedTicket(label: string) {
  const subject = `E2E Snooze ${label} ${ts}`;
  const ticket = await createTicket(orgId, {
    subject,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email: `snooze-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "OPEN" } });
  return { id: ticket.id, subject };
}

/** The first hit on a route may 404 while Next compiles it; poll instead of loosening. */
async function open(page: Page, url: string) {
  await expect.poll(async () => (await page.goto(url))?.status(), { timeout: 60_000 }).toBe(200);
}

function listUrl(subject: string, snoozed = false) {
  const q = encodeURIComponent(subject);
  return snoozed ? `/tickets?q=${q}&snoozed=1` : `/tickets?q=${q}`;
}

function row(page: Page, ticketId: string) {
  return page.locator(`#ticket-row-${ticketId}`);
}

function snoozedChipTrigger(page: Page) {
  return page.getByRole("button", { name: /^Snoozed until .*\. Change or wake\.$/ });
}

async function snoozeInThreeHours(page: Page) {
  await page.getByRole("button", { name: "Snooze", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Snooze until" })).toBeVisible();
  await expect(dialog.getByText(/^Times are in your time zone: .+\.$/)).toBeVisible();
  const preset = dialog.getByRole("button", { name: /^In 3 hours/ });
  await expect(preset).toBeFocused();
  await preset.click();
  await expect(
    page.getByText(/^Snoozed until .*\. It is hidden from the inbox until then\.$/),
  ).toBeVisible();
  await expect(snoozedChipTrigger(page)).toBeVisible();
}

test.describe("Snooze", () => {
  test("snoozing from the popover hides the ticket from the default inbox", async ({ page }) => {
    const ticket = await seedTicket("hide");
    await open(page, `/tickets/${ticket.id}`);
    await snoozeInThreeHours(page);

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.snoozedUntil).not.toBeNull();
    const ahead = (stored.snoozedUntil?.getTime() ?? 0) - Date.now();
    expect(ahead).toBeGreaterThan(3 * 3600_000 - 60_000);
    expect(ahead).toBeLessThanOrEqual(3 * 3600_000 + 5 * 60_000);

    await open(page, listUrl(ticket.subject));
    await expect(row(page, ticket.id)).toHaveCount(0);
    await open(page, listUrl(ticket.subject, true));
    await expect(row(page, ticket.id)).toBeVisible();
    await expect(row(page, ticket.id)).toContainText("Snoozed until");
  });

  test("the wake job brings a ticket whose deadline passed back to the inbox", async ({ page }) => {
    const ticket = await seedTicket("job");
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { snoozedUntil: new Date(Date.now() - 60_000) },
    });

    await open(page, listUrl(ticket.subject));
    await expect(row(page, ticket.id)).toHaveCount(0);

    const result = await snoozeWakeHandler(undefined, { now: new Date() });
    expect(result.woken).toBeGreaterThanOrEqual(1);

    await open(page, listUrl(ticket.subject));
    await expect(row(page, ticket.id)).toBeVisible();
    await expect(row(page, ticket.id)).not.toContainText("Snoozed until");
    const woken = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: ticket.id, action: "WOKEN" },
    });
    expect(woken).toHaveLength(1);
    expect(woken[0]?.actorType).toBe("SYSTEM");
  });

  test("a closed ticket that is not snoozed shows the disabled trigger", async ({ page }) => {
    const ticket = await seedTicket("closed");
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });

    await open(page, `/tickets/${ticket.id}`);
    const trigger = page.getByRole("button", { name: `Snooze. ${CLOSED_REASON}` });
    await expect(trigger).toHaveAttribute("aria-disabled", "true");
    await trigger.hover();
    await expect(page.getByRole("tooltip")).toContainText(CLOSED_REASON);
    await trigger.click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Wake now clears the snoozed chip", async ({ page }) => {
    const ticket = await seedTicket("wake");
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { snoozedUntil: new Date(Date.now() + 2 * 86_400_000) },
    });

    await open(page, `/tickets/${ticket.id}`);
    await snoozedChipTrigger(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Change snooze" })).toBeVisible();
    await dialog.getByRole("button", { name: "Wake now" }).click();
    await expect(page.getByText("Ticket woken.")).toBeVisible();
    await expect(snoozedChipTrigger(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Snooze", exact: true })).toBeVisible();
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.snoozedUntil).toBeNull();
  });

  test("a snoozed ticket closed afterwards is woken from its chip (review C9)", async ({
    page,
  }) => {
    const ticket = await seedTicket("closed-snoozed");
    await open(page, `/tickets/${ticket.id}`);
    await snoozeInThreeHours(page);

    await page.getByRole("button", { name: "Change status" }).click();
    await page.getByRole("menuitemradio", { name: "Closed" }).click();
    await page.keyboard.press("Escape");
    await expect
      .poll(
        async () => (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status,
      )
      .toBe("CLOSED");

    await expect(snoozedChipTrigger(page)).toBeEnabled();
    await snoozedChipTrigger(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(CLOSED_REASON)).toBeVisible();
    for (const label of [/^In 3 hours/, /^Tomorrow, 09:00/, /^Next Monday, 09:00/, /^In 1 week/]) {
      await expect(dialog.getByRole("button", { name: label })).toBeDisabled();
    }
    await expect(dialog.getByLabel("Date")).toBeDisabled();
    await expect(dialog.getByLabel("Time")).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Snooze ticket" })).toBeDisabled();
    const wake = dialog.getByRole("button", { name: "Wake now" });
    await expect(wake).toBeEnabled();
    await wake.click();

    await expect(page.getByText("Ticket woken.")).toBeVisible();
    await expect(snoozedChipTrigger(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Snooze. ${CLOSED_REASON}` })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe("CLOSED");
    expect(stored.snoozedUntil).toBeNull();
    const woken = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: ticket.id, action: "WOKEN" },
    });
    expect(woken).toHaveLength(1);
    expect(woken[0]?.actorType).toBe("USER");
  });
});
