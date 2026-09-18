// Phase 11, plan 11-06: row selection and the bulk action bar (AIDA-48, D-08, D-10, D-23;
// UI-SPEC Surface 3). Every case seeds its own tickets with a unique search token and opens the
// inbox filtered by it, so other specs' tickets never appear. Assertions are observed outcomes:
// what the bar shows and what the database holds afterwards, including the audit rows.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { MEMBER_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

/** A search token unique to one case; the tickets carry it in subject and body. */
function tokenFor(label: string): string {
  return `bulk${label}${ts}`;
}

async function seedTickets(token: string, count: number, status: "NEW" | "OPEN" = "OPEN") {
  const seeded: { id: string; subject: string }[] = [];
  for (let index = 1; index <= count; index++) {
    const subject = `E2E Bulk ${token} ticket ${index}`;
    const ticket = await createTicket(orgId, {
      subject,
      priority: "NORMAL",
      body: `Seed body ${token} number ${index}`,
      contact: { email: `bulk-${token}-${index}@example.com` },
      direction: "INBOUND",
    });
    if (status !== "NEW") {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status } });
    }
    seeded.push({ id: ticket.id, subject });
  }
  return seeded;
}

function bulkBar(page: Page) {
  return page.getByRole("region", { name: "Bulk actions" });
}

/**
 * The bar's open picker. A picker that was just closed stays mounted with data-state="closed"
 * for its exit animation, so locators that must find exactly one option are scoped to this.
 */
function openPickerPopover(page: Page) {
  return page.locator('[data-slot="popover-content"][data-state="open"]');
}

/** A picker popover by its content, open or still animating closed. */
function pickerPopover(page: Page, content: string | RegExp) {
  return page.locator('[data-slot="popover-content"]').filter({ hasText: content });
}

function rowCheckbox(page: Page, subject: string) {
  return page.getByRole("checkbox", { name: new RegExp(`: ${subject}$`) });
}

/**
 * Opens the inbox filtered by the token; polls past a first-hit 404 while the route compiles.
 * The list panel streams in a Suspense boundary, and React 19.2 may reveal a streamed boundary up
 * to ~300 ms after the load event that page.goto waits for, so each attempt gives the row a short
 * moment to appear before counting (otherwise every attempt can count the fallback skeleton).
 */
async function openInbox(page: Page, query: string, firstSubject: string) {
  await expect
    .poll(async () => {
      await page.goto(`/tickets?${query}`);
      await rowCheckbox(page, firstSubject)
        .waitFor({ timeout: 2_000 })
        .catch(() => undefined);
      return rowCheckbox(page, firstSubject).count();
    })
    .toBe(1);
}

test.describe("Bulk actions", () => {
  test("a bulk status change updates exactly the selected tickets with one audit row each in one batch", async ({
    page,
  }) => {
    const token = tokenFor("status");
    const [first, second, third] = await seedTickets(token, 3);
    await openInbox(page, `q=${token}`, first.subject);

    await expect(bulkBar(page)).toHaveCount(0);
    await rowCheckbox(page, first.subject).click();
    await rowCheckbox(page, second.subject).click();

    const bar = bulkBar(page);
    await expect(bar.getByText("2 tickets selected")).toBeVisible();
    await bar.getByRole("button", { name: "Status" }).click();
    await page.getByRole("option", { name: "Resolved" }).click();
    await expect(page.getByText("Applied to 2 tickets.")).toBeVisible();

    await expect
      .poll(async () => {
        const rows = await prisma.ticket.findMany({
          where: { id: { in: [first.id, second.id, third.id] } },
          select: { id: true, status: true },
        });
        return Object.fromEntries(rows.map((row) => [row.id, row.status]));
      })
      .toEqual({ [first.id]: "RESOLVED", [second.id]: "RESOLVED", [third.id]: "OPEN" });

    const audits = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: { in: [first.id, second.id, third.id] }, action: "STATUS_CHANGED" },
    });
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((audit) => audit.ticketId))).toEqual(new Set([first.id, second.id]));
    const batchIds = new Set(audits.map((audit) => audit.batchId));
    expect(batchIds.size).toBe(1);
    expect([...batchIds][0]).not.toBeNull();
  });

  test("a bulk assign sets the member on both tickets with one audit row each in one batch", async ({
    page,
  }) => {
    const token = tokenFor("assign");
    const [first, second] = await seedTickets(token, 2);
    const member = await prisma.user.findFirstOrThrow({
      where: { email: MEMBER_EMAIL },
      select: { id: true, name: true },
    });
    await openInbox(page, `q=${token}`, first.subject);

    await rowCheckbox(page, first.subject).click();
    await rowCheckbox(page, second.subject).click();
    const bar = bulkBar(page);
    await expect(bar.getByText("2 tickets selected")).toBeVisible();
    await bar.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("option", { name: "Unassign" })).toBeVisible();
    await page.getByRole("option", { name: member.name, exact: true }).click();
    await expect(page.getByText("Applied to 2 tickets.")).toBeVisible();

    await expect
      .poll(async () => {
        const rows = await prisma.ticket.findMany({
          where: { id: { in: [first.id, second.id] } },
          select: { assigneeId: true },
        });
        return rows.map((row) => row.assigneeId);
      })
      .toEqual([member.id, member.id]);

    const audits = await prisma.ticketAuditEvent.findMany({
      where: { ticketId: { in: [first.id, second.id] }, action: "ASSIGNEE_CHANGED" },
    });
    expect(audits).toHaveLength(2);
    const batchIds = new Set(audits.map((audit) => audit.batchId));
    expect(batchIds.size).toBe(1);
    expect([...batchIds][0]).not.toBeNull();
  });

  test("a tag added in bulk is offered by Remove tag, and removing it untags both tickets", async ({
    page,
  }) => {
    const token = tokenFor("tags");
    const [first, second] = await seedTickets(token, 2);
    const tag = await prisma.tag.create({
      data: { organizationId: orgId, name: `bulk-tag-${ts}` },
    });
    await openInbox(page, `q=${token}`, first.subject);

    await rowCheckbox(page, first.subject).click();
    await rowCheckbox(page, second.subject).click();
    const bar = bulkBar(page);

    // Nothing to remove yet: the selection carries no tag.
    const emptyRemoveText = "None of the selected tickets has a tag.";
    await bar.getByRole("button", { name: "Remove tag" }).click();
    await expect(openPickerPopover(page).getByText(emptyRemoveText)).toBeVisible();
    await page.keyboard.press("Escape");
    // Wait out the exit animation so the next picker is the only one on the page.
    await expect(pickerPopover(page, emptyRemoveText)).toBeHidden();

    await bar.getByRole("button", { name: "Add tag" }).click();
    const addPicker = openPickerPopover(page);
    await addPicker.getByPlaceholder("Find a tag…").fill(tag.name);
    await addPicker.getByRole("option", { name: tag.name, exact: true }).click();
    await expect(page.getByText("Applied to 2 tickets.")).toBeVisible();
    await expect.poll(() => prisma.ticketTag.count({ where: { tagId: tag.id } })).toBe(2);
    // Picking closed the Add tag picker; it lists the same tag, so wait until it is gone.
    await expect(
      page
        .locator('[data-slot="popover-content"]')
        .filter({ has: page.getByPlaceholder("Find a tag…") }),
    ).toBeHidden();

    // The refreshed list now carries the tag, so Remove tag offers it.
    await expect(bar.getByText("2 tickets selected")).toBeVisible();
    await bar.getByRole("button", { name: "Remove tag" }).click();
    await openPickerPopover(page).getByRole("option", { name: tag.name, exact: true }).click();
    await expect
      .poll(() => prisma.ticketTag.count({ where: { ticketId: { in: [first.id, second.id] } } }))
      .toBe(0);
    const removed = await prisma.ticketAuditEvent.count({
      where: { ticketId: { in: [first.id, second.id] }, action: "TAG_REMOVED" },
    });
    expect(removed).toBe(2);
  });

  test("a refused batch changes nothing, explains why, and keeps the selection", async ({
    page,
  }) => {
    const token = tokenFor("refused");
    const [kept, deleted] = await seedTickets(token, 2);
    await openInbox(page, `q=${token}`, kept.subject);

    await rowCheckbox(page, kept.subject).click();
    await rowCheckbox(page, deleted.subject).click();
    const bar = bulkBar(page);
    await expect(bar.getByText("2 tickets selected")).toBeVisible();

    // The ticket disappears after it was selected; the whole batch must be refused.
    await prisma.ticket.delete({ where: { id: deleted.id } });

    await bar.getByRole("button", { name: "Priority" }).click();
    await page.getByRole("option", { name: "Urgent" }).click();

    const alert = bar.getByRole("alert");
    await expect(alert).toContainText("Nothing was changed.");
    await expect(alert).toContainText(
      "One of the selected tickets is no longer available. Refresh the list and try again.",
    );
    // A refusal is a definite rollback, so it never shows the unknown-outcome copy (D2).
    await expect(alert).not.toContainText("The result is not known.");
    await expect(bar.getByText("2 tickets selected")).toBeVisible();

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.priority).toBe("NORMAL");
    expect(await prisma.ticketAuditEvent.count({ where: { ticketId: kept.id } })).toBe(0);
  });

  test("a lost response after the commit says the result is not known, never that nothing changed (Codex diff critique D2)", async ({
    page,
  }) => {
    const token = tokenFor("lost");
    const [first, second] = await seedTickets(token, 2);
    await openInbox(page, `q=${token}`, first.subject);

    await rowCheckbox(page, first.subject).click();
    await rowCheckbox(page, second.subject).click();
    const bar = bulkBar(page);
    await expect(bar.getByText("2 tickets selected")).toBeVisible();

    // The server action reaches the server and commits; its response never reaches the page.
    let forwarded = false;
    await page.route(
      (url) => url.pathname === "/tickets",
      async (route) => {
        if (route.request().method() !== "POST" || forwarded) return route.fallback();
        forwarded = true;
        await route.fetch();
        await route.abort("connectionfailed");
      },
    );

    await bar.getByRole("button", { name: "Priority" }).click();
    await openPickerPopover(page).getByRole("option", { name: "Urgent" }).click();

    const alert = bar.getByRole("alert");
    await expect(alert).toContainText("The result is not known.");
    await expect(alert).toContainText(
      "The change may have been saved. Refresh the page to check before you try again.",
    );
    await expect(alert).not.toContainText("Nothing was changed.");
    expect(forwarded).toBe(true);
    await expect(bar.getByText("2 tickets selected")).toBeVisible();

    // The batch did commit, which is why "Nothing was changed." would have been false.
    for (const ticket of [first, second]) {
      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.priority).toBe("URGENT");
    }
  });

  test("the unknown-outcome warning stays through selection changes and opening a ticket, blocks bulk actions, and ends only on Dismiss or a refresh (Codex diff critique round 2, E3)", async ({
    page,
  }) => {
    const token = tokenFor("unknownstays");
    const [first, second, third] = await seedTickets(token, 3);
    await openInbox(page, `q=${token}`, first.subject);

    // Every bulk server-action POST reaches the server and commits; its response is lost.
    let lost = 0;
    await page.route(
      (url) => url.pathname.startsWith("/tickets"),
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        lost++;
        await route.fetch();
        await route.abort("connectionfailed");
      },
    );

    await rowCheckbox(page, first.subject).click();
    await rowCheckbox(page, second.subject).click();
    const bar = bulkBar(page);
    const priority = bar.getByRole("button", { name: "Priority" });
    await priority.click();
    await openPickerPopover(page).getByRole("option", { name: "Urgent" }).click();

    const alert = bar.getByRole("alert");
    const dismiss = bar.getByRole("button", { name: "Dismiss" });
    await expect(alert).toContainText("The result is not known.");
    await expect(alert).toContainText(
      "Bulk actions stay off until you refresh the page or dismiss this message.",
    );
    expect(lost).toBe(1);
    // The triggers are off, so focus goes to Dismiss (review IN-04).
    await expect(priority).toBeDisabled();
    await expect(dismiss).toBeFocused();

    // A changed selection keeps the warning and keeps bulk actions off.
    await rowCheckbox(page, second.subject).click();
    await expect(bar.getByText("1 ticket selected")).toBeVisible();
    await expect(alert).toContainText("The result is not known.");
    await rowCheckbox(page, third.subject).click();
    await expect(bar.getByText("2 tickets selected")).toBeVisible();
    await expect(alert).toContainText("The result is not known.");
    await expect(priority).toBeDisabled();

    // A cleared selection still shows the warning.
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar.getByText(/selected$/)).toHaveCount(0);
    await expect(alert).toContainText("The result is not known.");

    // Opening a ticket mounts a new list panel; the warning is still there.
    await page.locator(`#ticket-row-${first.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${first.id}\\?`), { timeout: 15_000 });
    await expect(alert).toContainText("The result is not known.");

    // Dismiss ends it: bulk actions work again.
    await dismiss.click();
    await expect(alert).toHaveCount(0);
    await rowCheckbox(page, third.subject).click();
    await expect(priority).toBeEnabled();

    // A second lost response shows it again; a refresh ends it.
    await priority.click();
    await openPickerPopover(page).getByRole("option", { name: "Low" }).click();
    await expect(alert).toContainText("The result is not known.");
    expect(lost).toBe(2);
    await page.reload();
    await expect(rowCheckbox(page, first.subject)).toBeVisible();
    await expect(page.getByText("The result is not known.")).toHaveCount(0);
  });

  test("after a bulk action, and after a refused one, keyboard focus is back on the picker's trigger (review IN-04)", async ({
    page,
  }) => {
    const token = tokenFor("focus");
    const [first, second] = await seedTickets(token, 2);
    await openInbox(page, `q=${token}`, first.subject);

    // Hold every server-action POST for one second, so the call is still pending when the
    // picker finishes closing (a fast local server would otherwise hide the lost focus).
    await page.route(
      (url) => url.pathname === "/tickets",
      async (route) => {
        if (route.request().method() === "POST") {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        await route.fallback();
      },
    );

    await rowCheckbox(page, first.subject).click();
    await rowCheckbox(page, second.subject).click();
    const bar = bulkBar(page);
    await expect(bar.getByText("2 tickets selected")).toBeVisible();

    const priority = bar.getByRole("button", { name: "Priority" });
    await priority.click();
    await openPickerPopover(page).getByRole("option", { name: "High" }).click();
    await expect(page.getByText("Applied to 2 tickets.")).toBeVisible();
    await expect(priority).toBeEnabled();
    await expect(priority).toBeFocused();

    // A refused batch ends the same way: the alert explains, focus stays on the trigger.
    await prisma.ticket.delete({ where: { id: second.id } });
    const status = bar.getByRole("button", { name: "Status" });
    await status.click();
    await openPickerPopover(page).getByRole("option", { name: "Pending" }).click();
    await expect(bar.getByRole("alert")).toContainText("Nothing was changed.");
    await expect(status).toBeEnabled();
    await expect(status).toBeFocused();
  });

  test("the selection survives opening a ticket and clears when a filter changes", async ({
    page,
  }) => {
    const token = tokenFor("rules");
    const [first, second] = await seedTickets(token, 2);
    await openInbox(page, `q=${token}`, first.subject);

    await rowCheckbox(page, first.subject).click();
    const bar = bulkBar(page);
    await expect(bar.getByText("1 ticket selected")).toBeVisible();

    await page.locator(`#ticket-row-${second.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${second.id}\\?q=${token}$`));
    await expect(bar.getByText("1 ticket selected")).toBeVisible();
    await expect(rowCheckbox(page, first.subject)).toBeChecked();

    // The filter row's Status chip comes before the bar's Status trigger in the panel.
    await page.getByRole("button", { name: "Status", exact: true }).first().click();
    await page.getByRole("menuitemcheckbox", { name: "Open" }).click();
    await expect(page).toHaveURL(/status=OPEN/);
    // Close the modal status menu: while it is open the rest of the page is hidden from the
    // accessibility tree, which would make the checks below pass or fail for the wrong reason.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitemcheckbox", { name: "Open" })).toHaveCount(0);
    await expect(rowCheckbox(page, first.subject)).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expect(rowCheckbox(page, first.subject)).not.toBeChecked();
  });

  test("at 100 selected tickets the other checkboxes are disabled and the cap note shows", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const token = tokenFor("cap");
    const seeded = await seedTickets(token, 101);
    await openInbox(page, `q=${token}&limit=150`, seeded[0].subject);

    const checkboxes = page.getByRole("checkbox", { name: /^Select ticket #/ });
    await expect(checkboxes).toHaveCount(101);
    for (let index = 0; index < 100; index++) {
      await checkboxes.nth(index).click();
    }

    const bar = bulkBar(page);
    await expect(bar.getByText("100 tickets selected")).toBeVisible();
    await expect(bar.getByText("You can select up to 100 tickets at a time.")).toBeVisible();
    await expect(checkboxes.nth(100)).toBeDisabled();
    await expect(checkboxes.nth(100)).not.toBeChecked();
  });
});
