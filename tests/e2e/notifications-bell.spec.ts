/**
 * AIDA-44 and AIDA-46 acceptance in the browser (Phase 10, plan 10-13 Task 2; D-16, D-19, D-22,
 * V-10, V-28, owner item 11).
 *
 * Every case builds its own organization (tests/e2e/support/team.ts), so the seeded E2E owner and
 * member never receive a notification from these cases. Each effect is checked in the bell of the
 * right person (its label carries the exact unread count) and in the database, where the UI cannot
 * show an absence. The bell polls every 30 s; opening it refetches the count and the list, so the
 * helper below reloads and opens it until the expected label shows.
 *
 * Customer replies go through the real status page follow-up form in a fresh, signed-out context.
 */
import type { Page } from "@playwright/test";
import { createTicket, prisma } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  createOrg,
  gotoWarm,
  notificationsFor,
  signedInContext,
  type TeamOrg,
  type TeamUser,
  uniqueEmail,
} from "./support/team";

test.describe.configure({ timeout: 240_000 });

interface SeededTicket {
  id: string;
  number: number;
  subject: string;
  statusToken: string;
}

async function seedTicket(org: TeamOrg, label: string): Promise<SeededTicket> {
  const subject = `${label} ticket ${org.orgId.slice(0, 8)}`;
  const ticket = await createTicket(org.orgId, {
    subject,
    priority: "NORMAL",
    body: `${label} body`,
    contact: { email: uniqueEmail("customer") },
    direction: "INBOUND",
  });
  return { id: ticket.id, number: ticket.number, subject, statusToken: ticket.statusToken };
}

function bellLabel(count: number): string {
  return count > 0 ? `Notifications, ${count} unread` : "Notifications";
}

/** The bell's popover (a dialog labelled by its title). */
function bellPopover(page: Page) {
  return page.getByRole("dialog", { name: "Notifications" });
}

/**
 * Reloads `urlPath`, opens the bell (which refetches the count and the list) and waits until the
 * trigger's label carries `count`; leaves the popover open.
 */
async function openBell(page: Page, count: number, urlPath = "/tickets") {
  await expect(async () => {
    await gotoWarm(page, urlPath);
    await page.getByRole("button", { name: /^Notifications(, \d+ unread)?$/ }).click();
    await expect(bellPopover(page)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: bellLabel(count), exact: true })).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 60_000 });
  return bellPopover(page);
}

/** The owner assigns `ticket` to `assignee` from the ticket page's assignee menu. */
async function assignThroughTicketPage(page: Page, ticket: SeededTicket, assignee: TeamUser) {
  await gotoWarm(page, `/tickets/${ticket.id}`);
  const header = page.locator("h1", { hasText: ticket.subject }).locator("xpath=..");
  const menuItem = page.getByRole("menuitemradio", { name: assignee.name });
  await expect(async () => {
    await header.getByRole("button", { name: /Unassigned/ }).click();
    await expect(menuItem).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await menuItem.click();
  await page.keyboard.press("Escape");
  await expect
    .poll(
      async () => (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId,
    )
    .toBe(assignee.id);
}

/** A customer follow-up through the status page form, in a fresh signed-out context. */
async function customerFollowUp(page: Page, ticket: SeededTicket, text: string) {
  await gotoWarm(page, `/status/${ticket.statusToken}`);
  await page.getByPlaceholder("Write a follow-up…").fill(text);
  await page.getByRole("button", { name: "Send Follow-up" }).click();
  await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() =>
      prisma.message.count({
        where: { ticketId: ticket.id, direction: "INBOUND", bodyMarkdown: { contains: text } },
      }),
    )
    .toBe(1);
}

/** A preference switch on Settings -> Notifications, by its accessible name. */
function preferenceSwitch(page: Page, name: string) {
  return page.getByRole("switch", { name, exact: true });
}

/** Turns a switch off and proves the stored value survives a reload. */
async function turnOff(page: Page, name: string) {
  await gotoWarm(page, "/settings/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  const toggle = preferenceSwitch(page, name);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(async () => {
    if ((await toggle.getAttribute("aria-checked")) === "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 2_000 });
    await expect(toggle).toBeEnabled({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await gotoWarm(page, "/settings/notifications");
  await expect(preferenceSwitch(page, name)).toHaveAttribute("aria-checked", "false");
}

test.describe("AIDA-44: the bell", () => {
  test("assignment: a row and a count in the assignee's bell; Mark as read, Archive and Mark all read persist across reload", async ({
    browser,
  }) => {
    const org = await createOrg("Bell Workspace", [
      { role: "owner", name: "Bell Owner" },
      { role: "member", name: "Bell Member" },
    ]);
    const [owner, member] = org.users;
    const first = await seedTicket(org, "Bell first");
    const second = await seedTicket(org, "Bell second");
    const third = await seedTicket(org, "Bell third");

    const owned = await signedInContext(browser, owner.email);
    const memberSession = await signedInContext(browser, member.email);
    const page = memberSession.page;
    // Nothing yet.
    await openBell(page, 0);
    await expect(bellPopover(page).getByText("You're all caught up")).toBeVisible();

    await assignThroughTicketPage(owned.page, first, member);
    let popover = await openBell(page, 1);
    const row = popover.getByRole("listitem").filter({
      hasText: `Ticket #${first.number} was assigned to you`,
    });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(first.subject);
    // The owner assigned it; the owner's own bell has nothing for it.
    expect(await notificationsFor(org.orgId, owner.id)).toEqual([]);

    // Mark as read: the count drops, and the read state is stored.
    await row.getByRole("button", { name: "Mark as read" }).click();
    await expect(page.getByRole("button", { name: bellLabel(0), exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const [assigned] = await notificationsFor(org.orgId, member.id);
    expect(assigned.type).toBe("ASSIGNED");
    expect(assigned.readAt).not.toBeNull();

    // Archive: the row leaves the list and stays gone after a reload.
    await row.getByRole("button", { name: "Archive notification" }).click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => (await notificationsFor(org.orgId, member.id))[0]?.archivedAt ?? null)
      .not.toBeNull();
    popover = await openBell(page, 0);
    await expect(popover.getByText("You're all caught up")).toBeVisible();
    await expect(popover.getByText(`Ticket #${first.number} was assigned to you`)).toHaveCount(0);

    // Two more assignments, then Mark all read clears both; still clear after a reload.
    await assignThroughTicketPage(owned.page, second, member);
    await assignThroughTicketPage(owned.page, third, member);
    popover = await openBell(page, 2);
    await expect(popover.getByText(`Ticket #${second.number} was assigned to you`)).toBeVisible();
    await expect(popover.getByText(`Ticket #${third.number} was assigned to you`)).toBeVisible();
    await popover.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByRole("button", { name: bellLabel(0), exact: true })).toBeVisible({
      timeout: 15_000,
    });
    popover = await openBell(page, 0);
    await expect(popover.getByText(`Ticket #${second.number} was assigned to you`)).toBeVisible();
    const rows = await notificationsFor(org.orgId, member.id);
    expect(rows).toHaveLength(3);
    for (const stored of rows) expect(stored.readAt).not.toBeNull();

    await owned.context.close();
    await memberSession.context.close();
  });

  test("customer replies: the assignee hears about a reply on their ticket; an unassigned ticket's reply goes to the owner, never the member, and stops when the owner turns 'Unassigned tickets' off", async ({
    browser,
  }) => {
    const org = await createOrg("Reply Workspace", [
      { role: "owner", name: "Reply Owner" },
      { role: "member", name: "Reply Member" },
    ]);
    const [owner, member] = org.users;
    const assigned = await seedTicket(org, "Reply assigned");
    const unassigned = await seedTicket(org, "Reply unassigned");
    const later = await seedTicket(org, "Reply later");
    // Assigned in the database, so no assignment notification is part of this case.
    await prisma.ticket.update({ where: { id: assigned.id }, data: { assigneeId: member.id } });

    const owned = await signedInContext(browser, owner.email);
    const memberSession = await signedInContext(browser, member.email);
    const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const customerPage = await customer.newPage();

    // A follow-up on the member's ticket: one row for the member, none for the owner.
    await customerFollowUp(customerPage, assigned, "Customer follow-up on the assigned ticket");
    let popover = await openBell(memberSession.page, 1);
    await expect(
      popover.getByText(`New customer reply on ticket #${assigned.number}`),
    ).toBeVisible();
    expect(await notificationsFor(org.orgId, owner.id)).toEqual([]);

    // A follow-up on an unassigned ticket: the owner's fallback row, nothing new for the member.
    await customerFollowUp(customerPage, unassigned, "Customer follow-up nobody owns");
    popover = await openBell(owned.page, 1);
    await expect(
      popover.getByText(`New customer reply on ticket #${unassigned.number}`),
    ).toBeVisible();
    const ownerRows = await notificationsFor(org.orgId, owner.id);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]).toMatchObject({
      type: "CUSTOMER_REPLY",
      entityId: unassigned.id,
      unassignedFallback: true,
    });
    const memberRows = await notificationsFor(org.orgId, member.id);
    expect(memberRows.map((n) => n.entityId)).toEqual([assigned.id]);
    await openBell(memberSession.page, 1);

    // The owner turns "Unassigned tickets" off; the next unassigned follow-up adds nothing.
    await turnOff(owned.page, "Unassigned tickets: notify me");
    await customerFollowUp(customerPage, later, "Customer follow-up after the opt-out");
    expect(await notificationsFor(org.orgId, owner.id)).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { organizationId: org.orgId, entityId: later.id } }),
    ).toBe(0);
    popover = await openBell(owned.page, 1);
    await expect(popover.getByText(`New customer reply on ticket #${later.number}`)).toHaveCount(0);

    await customer.close();
    await owned.context.close();
    await memberSession.context.close();
  });
});

test.describe("AIDA-46: preferences", () => {
  test("with 'Assigned to me: in app' off, a new assignment adds no row; the switch stays off after reload", async ({
    browser,
  }) => {
    const org = await createOrg("Prefs Workspace", [
      { role: "owner", name: "Prefs Owner" },
      { role: "member", name: "Prefs Member" },
    ]);
    const [owner, member] = org.users;
    const ticket = await seedTicket(org, "Prefs");

    const memberSession = await signedInContext(browser, member.email);
    await turnOff(memberSession.page, "Assigned to me: in app");
    // A plain member has no "Unassigned tickets" switch (owners and admins only).
    await expect(preferenceSwitch(memberSession.page, "Unassigned tickets: notify me")).toHaveCount(
      0,
    );

    const owned = await signedInContext(browser, owner.email);
    await assignThroughTicketPage(owned.page, ticket, member);
    // The assignment committed (presence); no notification was written (absence).
    expect(await notificationsFor(org.orgId, member.id)).toEqual([]);
    const popover = await openBell(memberSession.page, 0);
    await expect(popover.getByText("You're all caught up")).toBeVisible();

    await owned.context.close();
    await memberSession.context.close();
  });
});
