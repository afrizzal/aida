import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { mergeTickets } from "../../src/lib/tickets/merge";
import { addRelation } from "../../src/lib/tickets/relations";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function seedTicket(label: string, contactLabel: string) {
  const ticket = await createTicket(orgId, {
    subject: `E2E Merge ${label} ${ts}`,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email: `merge-${contactLabel}-${ts}@example.com` },
    direction: "INBOUND",
  });
  return prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { id: true, number: true },
  });
}

/** The first hit on a route may 404 while Next compiles it; poll instead of loosening. */
async function openTicket(page: Page, ticketId: string) {
  await expect
    .poll(async () => (await page.goto(`/tickets/${ticketId}`))?.status(), { timeout: 60_000 })
    .toBe(200);
}

function menuTrigger(page: Page) {
  return page.getByRole("button", { name: "More ticket actions" });
}

async function openMergeDialog(page: Page) {
  await menuTrigger(page).click();
  await page.getByRole("menuitem", { name: /Merge into another ticket…/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Merge this ticket into another" }),
  ).toBeVisible();
  return dialog;
}

async function pickTarget(page: Page, number: number) {
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Search by number or subject…").fill(String(number));
  const row = dialog.getByRole("option", { name: new RegExp(`^#${number}\\b`) });
  await expect(row).toBeVisible();
  return row;
}

async function adminActor() {
  const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
  return { userId: admin.id, orgId };
}

/** Opens the confirm step of source into target. */
async function reviewMerge(page: Page, source: { number: number }, target: { number: number }) {
  const dialog = await openMergeDialog(page);
  await (await pickTarget(page, target.number)).click();
  await dialog.getByRole("button", { name: "Review merge" }).click();
  await expect(
    dialog.getByRole("heading", { name: `Merge #${source.number} into #${target.number}?` }),
  ).toBeVisible();
  return dialog;
}

async function snapshot(ticketIds: string[]) {
  return {
    tickets: await prisma.ticket.findMany({
      where: { id: { in: ticketIds } },
      select: { id: true, status: true, mergedIntoTicketId: true },
      orderBy: { id: "asc" },
    }),
    messages: await prisma.message.findMany({
      where: { ticketId: { in: ticketIds } },
      select: { id: true, ticketId: true, mergedFromTicketId: true },
      orderBy: { id: "asc" },
    }),
    relations: await prisma.ticketRelation.count({
      where: { OR: [{ fromTicketId: { in: ticketIds } }, { toTicketId: { in: ticketIds } }] },
    }),
  };
}

test.describe("Ticket merge", () => {
  test("merging after confirmation moves the thread and closes the source", async ({ page }) => {
    const source = await seedTicket("source", "same");
    const target = await seedTicket("target", "same");

    await openTicket(page, source.id);
    const dialog = await openMergeDialog(page);
    await expect(dialog.getByRole("button", { name: "Review merge" })).toBeDisabled();
    await (await pickTarget(page, target.number)).click();
    await dialog.getByRole("button", { name: "Review merge" }).click();

    await expect(
      dialog.getByRole("heading", { name: `Merge #${source.number} into #${target.number}?` }),
    ).toBeVisible();
    await expect(dialog.getByText("A merge can't be undone.")).toBeVisible();
    await dialog.getByRole("button", { name: "Merge tickets" }).click();

    await expect(page).toHaveURL(new RegExp(`/tickets/${target.id}$`));
    await expect(page.getByText(`Merged #${source.number} into #${target.number}.`)).toBeVisible();

    const merged = await prisma.ticket.findUniqueOrThrow({ where: { id: source.id } });
    expect(merged.status).toBe("CLOSED");
    expect(merged.mergedIntoTicketId).toBe(target.id);
    expect(await prisma.message.count({ where: { ticketId: source.id } })).toBe(0);
    expect(
      await prisma.message.count({ where: { ticketId: target.id, mergedFromTicketId: source.id } }),
    ).toBeGreaterThan(0);
  });

  test("tickets of two contacts cannot be picked and nothing changes", async ({ page }) => {
    const source = await seedTicket("contact-a", "first");
    const target = await seedTicket("contact-b", "second");
    const before = await snapshot([source.id, target.id]);

    await openTicket(page, source.id);
    const dialog = await openMergeDialog(page);
    const row = await pickTarget(page, target.number);
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(row).toContainText(
      "Different customer. Tickets of different customers can't be merged.",
    );
    await row.click({ force: true });
    await expect(dialog.getByRole("button", { name: "Review merge" })).toBeDisabled();

    expect(await snapshot([source.id, target.id])).toEqual(before);
  });

  test("a linked pair shows that the merge replaces the link", async ({ page }) => {
    const source = await seedTicket("linked-source", "linked");
    const target = await seedTicket("linked-target", "linked");
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const linked = await addRelation(
      prisma,
      { userId: admin.id, orgId },
      { ticketId: source.id, otherTicketId: target.id, choice: "is related to" },
    );
    expect(linked.ok).toBe(true);

    await openTicket(page, source.id);
    const dialog = await openMergeDialog(page);
    await (await pickTarget(page, target.number)).click();
    await dialog.getByRole("button", { name: "Review merge" }).click();
    await expect(
      dialog.getByText(
        'The current link "Related to" between these tickets is replaced by "Duplicate of".',
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Keep tickets separate" }).click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page)).toBeFocused();
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.mergedIntoTicketId).toBeNull();
  });

  test("closing the merge dialog returns focus to the menu trigger (review UI-WR-03)", async ({
    page,
  }) => {
    const source = await seedTicket("focus-close", "focus-close");
    await openTicket(page, source.id);

    const dialog = await openMergeDialog(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page)).toBeFocused();

    const again = await openMergeDialog(page);
    await page.keyboard.press("Escape");
    await expect(again).toBeHidden();
    await expect(menuTrigger(page)).toBeFocused();
  });

  test("a merge call that never returns moves focus to Keep tickets separate (review UI-WR-04)", async ({
    page,
  }) => {
    const source = await seedTicket("unknown-source", "unknown");
    const target = await seedTicket("unknown-target", "unknown");
    const before = await snapshot([source.id, target.id]);

    await openTicket(page, source.id);
    const dialog = await openMergeDialog(page);
    await (await pickTarget(page, target.number)).click();
    await dialog.getByRole("button", { name: "Review merge" }).click();
    await expect(
      dialog.getByRole("heading", { name: `Merge #${source.number} into #${target.number}?` }),
    ).toBeVisible();

    // The server action posts to the page URL; aborting it makes the call reject (no code).
    await page.route(`**/tickets/${source.id}`, (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await dialog.getByRole("button", { name: "Merge tickets" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "The result is not known. The tickets may have been merged. Refresh the page to check before you try again.",
    );
    await expect(dialog.getByRole("button", { name: "Merge tickets" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Keep tickets separate" })).toBeFocused();
    expect(await snapshot([source.id, target.id])).toEqual(before);
  });

  test("the confirmation names a link added after the page loaded (review UI-WR-06)", async ({
    page,
  }) => {
    const source = await seedTicket("late-link-source", "late-link");
    const target = await seedTicket("late-link-target", "late-link");

    await openTicket(page, source.id);
    await expect(page.getByRole("region", { name: "Linked tickets" })).toHaveCount(0);
    // Another agent links the pair after this page loaded: the source is the child.
    const linked = await addRelation(prisma, await adminActor(), {
      ticketId: source.id,
      otherTicketId: target.id,
      choice: "is a child of",
    });
    expect(linked.ok).toBe(true);

    const dialog = await reviewMerge(page, source, target);
    await expect(
      dialog.getByText(
        'The current link "Child of" between these tickets is replaced by "Duplicate of".',
      ),
    ).toBeVisible();
    await expect(dialog.getByText('The current link "Related to"')).toHaveCount(0);
  });

  test("a merged source shows the banner and no composer", async ({ page }) => {
    const source = await seedTicket("banner-source", "banner");
    const target = await seedTicket("banner-target", "banner");
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const merged = await mergeTickets(
      prisma,
      { userId: admin.id, orgId },
      { sourceTicketId: source.id, targetTicketId: target.id },
    );
    expect(merged.ok).toBe(true);

    await openTicket(page, source.id);
    const banner = page.getByRole("note");
    await expect(banner).toContainText(`This ticket was merged into #${target.number} on`);
    await expect(banner).toContainText("Its conversation continues there.");
    await expect(banner.getByRole("link", { name: `Open #${target.number}` })).toBeVisible();
    await expect(
      page.getByText(`Replies go on #${target.number}, where this conversation continues.`),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /reply/i })).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);

    await openTicket(page, target.id);
    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("each status link shows only what D-09 allows after a merge", async ({ page, browser }) => {
    const source = await seedTicket("token-source", "tokens");
    const target = await seedTicket("token-target", "tokens");
    const tokens = await prisma.ticket.findMany({
      where: { id: { in: [source.id, target.id] } },
      select: { id: true, statusToken: true, subject: true },
    });
    const sourceToken = tokens.find((t) => t.id === source.id)?.statusToken;
    const targetToken = tokens.find((t) => t.id === target.id)?.statusToken;
    const targetSubject = tokens.find((t) => t.id === target.id)?.subject ?? "";
    expect(sourceToken && targetToken).toBeTruthy();

    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const merged = await mergeTickets(
      prisma,
      { userId: admin.id, orgId },
      { sourceTicketId: source.id, targetTicketId: target.id },
    );
    expect(merged.ok).toBe(true);

    // An agent public reply on the target, posted through the real composer after the merge.
    const reply = `Post-merge reply ${ts}`;
    await openTicket(page, target.id);
    await expect(page.getByText(`Moved from #${source.number}`)).toBeVisible();
    await expect(
      page.getByRole("link", { name: `#${source.number}`, exact: true }).first(),
    ).toHaveAttribute("href", `/tickets/${source.id}`);
    await page.getByRole("button", { name: "Public Reply" }).click();
    await page.getByPlaceholder("Write a reply…").fill(reply);
    const [posted] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/tickets/${target.id}/messages`) &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send Reply" }).click(),
    ]);
    expect(posted.status()).toBe(200);
    await expect
      .poll(() => prisma.message.count({ where: { ticketId: target.id, bodyMarkdown: reply } }))
      .toBe(1);

    // The customer's pages are unauthenticated.
    const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const status = await customer.newPage();

    await expect
      .poll(async () => (await status.goto(`/status/${sourceToken}`))?.status(), {
        timeout: 60_000,
      })
      .toBe(200);
    await expect(status.getByText("Combined", { exact: true })).toBeVisible();
    await expect(status.getByRole("note")).toContainText(
      "This request was combined with another one of yours.",
    );
    await expect(status.getByText("Seed body for token-source")).toBeVisible();
    await expect(status.getByText(reply)).toBeVisible();
    await expect(status.getByText("Seed body for token-target")).toHaveCount(0);
    const sourceText = (await status.locator("body").innerText()) ?? "";
    expect(sourceText).not.toContain(`#${target.number}`);
    expect(sourceText).not.toContain(targetSubject);
    expect(sourceText).not.toContain("Moved from");
    await expect(status.locator(`a[href*="${targetToken}"]`)).toHaveCount(0);
    await expect(status.locator(`a[href*="/tickets/"]`)).toHaveCount(0);

    await status.goto(`/status/${targetToken}`);
    await expect(status.getByText("Seed body for token-target")).toBeVisible();
    await expect(status.getByText(reply)).toBeVisible();
    await expect(status.getByText("Seed body for token-source")).toHaveCount(0);
    await expect(status.getByText("Combined", { exact: true })).toHaveCount(0);
    await expect(status.getByRole("note")).toHaveCount(0);
    expect(await status.locator("body").innerText()).not.toContain("Moved from");
    await customer.close();
  });
});
