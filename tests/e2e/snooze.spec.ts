import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { snoozeWakeHandler } from "../../src/lib/worker/jobs/snooze-wake";
import { ADMIN_EMAIL } from "./global-setup";
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
  // Review UI-IN-06: the popover dialog is named by its heading.
  await expect(page.getByRole("dialog", { name: "Snooze until" })).toBeVisible();
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
    await expect(page.getByRole("dialog", { name: "Change snooze" })).toBeVisible();
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

// UI-SPEC 4a (D-12), review UI-WR-01 and UI-WR-02: the browser is in Asia/Jakarta (UTC+7, no
// daylight saving). The E2E server may run in another zone (CI and containers run in UTC), so
// every assertion is what the browser user sees after mount, in the browser's zone.
test.describe("Snooze times in the viewer's time zone", () => {
  const ZONE = "Asia/Jakarta";
  test.use({ timezoneId: ZONE });

  const SHORT: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };

  /** Two days ahead at 02:00 UTC, which is 09:00 in Jakarta. */
  function deadline() {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() + 2);
    at.setUTCHours(2, 0, 0, 0);
    return at;
  }

  test("the snoozed chip's accessible name gives the deadline in the viewer's zone (review UI-WR-01)", async ({
    page,
  }) => {
    const ticket = await seedTicket("tz-chip");
    const until = deadline();
    await prisma.ticket.update({ where: { id: ticket.id }, data: { snoozedUntil: until } });
    const local = new Intl.DateTimeFormat("en-US", { ...SHORT, timeZone: ZONE }).format(until);
    expect(local).toMatch(/, 09:00$/);

    await open(page, `/tickets/${ticket.id}`);
    await expect(snoozedChipTrigger(page)).toContainText(`Snoozed until ${local}`);
    await expect(snoozedChipTrigger(page)).toHaveAccessibleName(
      `Snoozed until ${local}. Change or wake.`,
    );
  });
});

// UI-SPEC Surface 5 (D-16): the Snoozed toggle in the filter row, its saved views and its
// empty line.
test.describe("Snoozed filter", () => {
  const word = `Sfilter${ts}`;

  async function seedFilterTicket(label: string, snoozed: boolean) {
    const subject = `E2E ${word} ${label}`;
    const ticket = await createTicket(orgId, {
      subject,
      priority: "NORMAL",
      body: `Seed body for ${label}`,
      contact: { email: `snooze-filter-${label}-${ts}@example.com` },
      direction: "INBOUND",
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "OPEN",
        snoozedUntil: snoozed ? new Date(Date.now() + 3 * 3600_000) : null,
      },
    });
    return { id: ticket.id, subject };
  }

  function toggle(page: Page) {
    return page.getByRole("button", { name: "Snoozed", exact: true });
  }

  test("the toggle shows only snoozed tickets and saves as a view that reopens with it on", async ({
    page,
  }) => {
    const asleep = await seedFilterTicket("asleep", true);
    const awake = await seedFilterTicket("awake", false);
    const name = `E2E snoozed view ${ts}`;

    await open(page, `/tickets?q=${encodeURIComponent(word)}`);
    await expect(row(page, awake.id)).toBeVisible();
    await expect(row(page, asleep.id)).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

    await toggle(page).click();
    await expect(page).toHaveURL(/[?&]snoozed=1/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, asleep.id)).toBeVisible();
    await expect(row(page, asleep.id)).toContainText("Snoozed until");
    await expect(row(page, awake.id)).toHaveCount(0);

    await page.getByRole("button", { name: "Save these filters as a view" }).click();
    const dialog = page.getByRole("dialog", { name: "Save view" });
    await expect(
      dialog.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Snoozed" }) }),
    ).toContainText("Only snoozed tickets");
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByText("View saved.")).toBeVisible();

    await open(page, "/tickets");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("list", { name: "Private" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(/[?&]snoozed=1/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, asleep.id)).toBeVisible();
    await expect(row(page, awake.id)).toHaveCount(0);
  });

  test("a stored view without the snoozed field still opens unchanged", async ({ page }) => {
    const awake = await seedFilterTicket("legacy", false);
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const name = `E2E legacy view ${ts}`;
    await prisma.savedView.create({
      data: {
        organizationId: orgId,
        ownerUserId: admin.id,
        name,
        visibility: "PRIVATE",
        filters: { version: 1, view: "all", statuses: ["OPEN"], q: word },
        position: 0,
      },
    });

    await open(page, "/tickets");
    await page.getByRole("list", { name: "Private" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(/status=OPEN/);
    await expect(page).not.toHaveURL(/snoozed=/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(row(page, awake.id)).toBeVisible();
  });

  test("a filtered empty list with the toggle on shows the snoozed empty line", async ({
    page,
  }) => {
    await open(page, `/tickets?q=${encodeURIComponent(`Nomatch${ts}`)}&snoozed=1`);
    await expect(page.getByText("No snoozed tickets match these filters.")).toBeVisible();
    await expect(page.getByText("Nothing here — no tickets match this view.")).toHaveCount(0);
  });
});
