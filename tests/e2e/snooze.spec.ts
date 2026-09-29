import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { snoozeTicket } from "../../src/lib/tickets/snooze";
import { snoozeWakeHandler } from "../../src/lib/worker/jobs/snooze-wake";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma, stateIdFor } from "./support/db";

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
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { stateId: await stateIdFor("OPEN") },
  });
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
  // Review UI-WR-04: the trigger is one element, so focus survives the revalidation.
  await expect(snoozedChipTrigger(page)).toBeFocused();
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
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { stateId: await stateIdFor("CLOSED") },
    });

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
    await expect(page.getByRole("button", { name: "Snooze", exact: true })).toBeFocused();
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
        async () => (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).stateId,
      )
      .toBe(await stateIdFor("CLOSED"));

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
    await expect(page.getByRole("button", { name: `Snooze. ${CLOSED_REASON}` })).toBeFocused();

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.stateId).toBe(await stateIdFor("CLOSED"));
    expect(stored.snoozedUntil).toBeNull();
    const woken = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: ticket.id, action: "WOKEN" },
    });
    expect(woken).toHaveLength(1);
    expect(woken[0]?.actorType).toBe("USER");
  });

  test("a refused snooze keeps focus on the chosen preset (review UI-WR-04)", async ({ page }) => {
    const ticket = await seedTicket("refused-focus");
    await open(page, `/tickets/${ticket.id}`);
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const preset = dialog.getByRole("button", { name: /^In 3 hours/ });
    await expect(preset).toBeFocused();

    // Closed behind the agent's back: the server refuses, the page is not revalidated.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { stateId: await stateIdFor("CLOSED") },
    });
    await preset.click();
    await expect(dialog.getByRole("alert")).toHaveText(CLOSED_REASON);
    await expect(preset).toBeEnabled();
    await expect(preset).toBeFocused();
    // Review UI-WR-08: a refusal keeps the popover open and shows no success toast.
    await expect(page.getByRole("dialog", { name: "Snooze until" })).toBeVisible();
    await expect(page.getByText(/It is hidden from the inbox until then\.$/)).toHaveCount(0);
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.snoozedUntil).toBeNull();
  });

  test("a snooze call that never returns shows the outcome unknown callout (review UI-WR-08)", async ({
    page,
  }) => {
    const ticket = await seedTicket("unknown");
    await open(page, `/tickets/${ticket.id}`);
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Snooze until" });
    const preset = dialog.getByRole("button", { name: /^In 3 hours/ });
    await expect(preset).toBeFocused();

    // The server action posts to the page URL; aborting it makes the call reject (no code).
    await page.route(`**/tickets/${ticket.id}`, (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await preset.click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "The result is not known. The change may have been saved. Refresh the page to check before you try again.",
    );
    await expect(dialog).toBeVisible();
    await expect(preset).toBeEnabled();
    await expect(preset).toBeFocused();
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.snoozedUntil).toBeNull();
  });

  test("a custom time that is too soon is announced on both fields and clears on edit (review UI-IN-03)", async ({
    page,
  }) => {
    const ticket = await seedTicket("too-soon");
    await open(page, `/tickets/${ticket.id}`);
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Snooze until" })).toBeVisible();

    // The current minute in the browser's zone: less than 5 minutes ahead.
    const now = await page.evaluate(() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      };
    });
    const date = dialog.getByLabel("Date");
    const time = dialog.getByLabel("Time");
    await date.fill(now.date);
    await time.fill(now.time);
    await dialog.getByRole("button", { name: "Snooze ticket" }).click();

    const tooSoon = "Pick a time at least 5 minutes from now.";
    await expect(dialog.getByRole("alert")).toHaveText(tooSoon);
    for (const field of [date, time]) {
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(new RegExp(tooSoon.replace(/\./g, "\\.")));
    }

    await time.fill(now.time === "23:55" ? "23:50" : "23:55");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    for (const field of [date, time]) {
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
    }
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.snoozedUntil).toBeNull();
  });

  test("a custom time more than 365 days ahead is refused on the client (review UI-WR-08)", async ({
    page,
  }) => {
    const ticket = await seedTicket("too-far");
    await open(page, `/tickets/${ticket.id}`);
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Snooze until" });

    // 400 days ahead in the browser's zone, past the 365-day bound.
    const far = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 400);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
    const date = dialog.getByLabel("Date");
    const time = dialog.getByLabel("Time");
    await date.fill(far);
    await time.fill("09:00");
    await dialog.getByRole("button", { name: "Snooze ticket" }).click();

    const tooFar = "Pick a time within the next 365 days.";
    await expect(dialog.getByRole("alert")).toHaveText(tooFar);
    for (const field of [date, time]) {
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(new RegExp(tooFar.replace(/\./g, "\\.")));
    }
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.snoozedUntil).toBeNull();
  });
});

// UI-SPEC 4a (D-12), review UI-WR-01 and UI-WR-02: the browser runs in a viewer zone that shows
// the deadline differently from the host zone. The E2E server inherits the host zone, so a label
// rendered on the server in its own zone and never corrected after hydration fails here on any
// host (review UI-WR-08: Asia/Jakarta, or Pacific/Honolulu when the host already shows Jakarta's
// time). Both zones have no daylight saving. Every assertion is what the browser user sees after
// mount, in the viewer's zone.
const SHORT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};
const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Two days ahead at the given UTC hour, which is 09:00 in the matching viewer zone. */
function deadlineAt(utcHour: number) {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + 2);
  at.setUTCHours(utcHour, 0, 0, 0);
  return at;
}

const VIEWER = [
  { zone: "Asia/Jakarta", utcHour: 2 },
  { zone: "Pacific/Honolulu", utcHour: 19 },
].find(({ zone, utcHour }) => {
  const at = deadlineAt(utcHour);
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-US", { ...SHORT, timeZone }).format(at);
  return format(zone) !== format(HOST_ZONE);
}) ?? { zone: "Asia/Jakarta", utcHour: 2 };

test.describe("Snooze times in the viewer's time zone", () => {
  const ZONE = VIEWER.zone;
  test.use({ timezoneId: ZONE });

  function deadline() {
    return deadlineAt(VIEWER.utcHour);
  }

  test("the viewer zone shows the deadline differently from the host zone", () => {
    const at = deadline();
    const format = (timeZone: string) =>
      new Intl.DateTimeFormat("en-US", { ...SHORT, timeZone }).format(at);
    expect(format(ZONE)).not.toBe(format(HOST_ZONE));
  });

  test("the snoozed chip's accessible name gives the deadline in the viewer's zone (review UI-WR-01)", async ({
    page,
  }) => {
    const ticket = await seedTicket("tz-chip");
    const until = deadline();
    await prisma.ticket.update({ where: { id: ticket.id }, data: { snoozedUntil: until } });
    const local = new Intl.DateTimeFormat("en-US", { ...SHORT, timeZone: ZONE }).format(until);
    expect(local).toMatch(/, 09:00$/);
    // The server renders in the host zone: this is the string a regression would announce.
    const hostText = new Intl.DateTimeFormat("en-US", { ...SHORT, timeZone: HOST_ZONE }).format(
      until,
    );
    expect(hostText).not.toBe(local);

    await open(page, `/tickets/${ticket.id}`);
    await expect(snoozedChipTrigger(page)).toContainText(`Snoozed until ${local}`);
    await expect(snoozedChipTrigger(page)).toHaveAccessibleName(
      `Snoozed until ${local}. Change or wake.`,
    );
  });

  test("the feed's event time tooltip gives the full time in the viewer's zone (review UI-WR-02)", async ({
    page,
  }) => {
    const ticket = await seedTicket("tz-feed");
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const snoozed = await snoozeTicket(
      prisma,
      { userId: admin.id, orgId },
      { ticketId: ticket.id, until: deadline() },
    );
    expect(snoozed.ok).toBe(true);
    const event = await prisma.ticketAuditEvent.findFirstOrThrow({
      where: { ticketId: ticket.id, action: "SNOOZED" },
    });
    const full = new Intl.DateTimeFormat("en-US", {
      ...SHORT,
      year: "numeric",
      timeZone: ZONE,
      timeZoneName: "short",
    }).format(event.createdAt);

    await open(page, `/tickets/${ticket.id}`);
    const row = page
      .getByRole("list", { name: "Ticket activity" })
      .locator(":scope > li")
      .filter({ hasText: "snoozed this ticket until" });
    await expect(row).toHaveCount(1);
    await expect(row.locator(`time[datetime="${event.createdAt.toISOString()}"]`)).toHaveAttribute(
      "title",
      full,
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
        stateId: await stateIdFor("OPEN"),
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
    const openId = await stateIdFor("OPEN");
    await prisma.savedView.create({
      data: {
        organizationId: orgId,
        ownerUserId: admin.id,
        name,
        visibility: "PRIVATE",
        filters: { version: 2, view: "all", stateIds: [openId], q: word },
        position: 0,
      },
    });

    await open(page, "/tickets");
    await page.getByRole("list", { name: "Private" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`state=${openId}`));
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
