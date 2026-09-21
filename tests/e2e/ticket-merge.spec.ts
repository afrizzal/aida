import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
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

async function openMergeDialog(page: Page) {
  await page.getByRole("button", { name: "More ticket actions" }).click();
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
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.mergedIntoTicketId).toBeNull();
  });
});
