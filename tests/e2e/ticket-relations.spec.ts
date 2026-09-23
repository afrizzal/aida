import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { addRelation } from "../../src/lib/tickets/relations";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function seedTicket(label: string) {
  const ticket = await createTicket(orgId, {
    subject: `E2E Relations ${label} ${ts}`,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email: `relations-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  return prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { id: true, number: true },
  });
}

async function adminActor() {
  const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
  return { userId: admin.id, orgId };
}

/** The first hit on a route may 404 while Next compiles it; poll instead of loosening. */
async function openTicket(page: Page, ticketId: string) {
  await expect
    .poll(async () => (await page.goto(`/tickets/${ticketId}`))?.status(), { timeout: 60_000 })
    .toBe(200);
}

function linkedRow(page: Page) {
  return page.getByRole("region", { name: "Linked tickets" });
}

function menuTrigger(page: Page) {
  return page.getByRole("button", { name: "More ticket actions" });
}

async function openLinkDialog(page: Page) {
  await page.getByRole("button", { name: "More ticket actions" }).click();
  await page.getByRole("menuitem", { name: "Link a ticket…" }).click();
  const dialog = page.getByRole("dialog", { name: "Link a ticket" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseLinkType(page: Page, label: string) {
  await page.getByRole("combobox", { name: "This ticket" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

function pickerRow(page: Page, number: number) {
  return page.getByRole("dialog").getByRole("option", { name: new RegExp(`^#${number}\\b`) });
}

async function relationCounts(ticketIds: string[]) {
  return {
    childOf: await prisma.ticketRelation.count({
      where: { type: "CHILD_OF", fromTicketId: { in: ticketIds }, toTicketId: { in: ticketIds } },
    }),
    added: await prisma.ticketAuditEvent.count({
      where: { ticketId: { in: ticketIds }, action: "RELATION_ADDED" },
    }),
  };
}

test.describe("Ticket relations", () => {
  test("a stored link shows on both tickets and can be removed with an audited result", async ({
    page,
  }) => {
    const a = await seedTicket("tracer-a");
    const b = await seedTicket("tracer-b");
    const seeded = await addRelation(prisma, await adminActor(), {
      ticketId: a.id,
      otherTicketId: b.id,
      choice: "is a duplicate of",
    });
    expect(seeded.ok).toBe(true);

    await openTicket(page, a.id);
    const rowOnA = linkedRow(page);
    await expect(rowOnA.getByRole("listitem")).toHaveCount(1);
    await expect(rowOnA.getByRole("listitem")).toContainText("Duplicate of");
    await expect(rowOnA.getByRole("link", { name: new RegExp(`#${b.number}\\b`) })).toBeVisible();

    await openTicket(page, b.id);
    const rowOnB = linkedRow(page);
    await expect(rowOnB.getByRole("listitem")).toContainText("Has duplicate");
    await expect(rowOnB.getByRole("link", { name: new RegExp(`#${a.number}\\b`) })).toBeVisible();

    await openTicket(page, a.id);
    await linkedRow(page)
      .getByRole("button", { name: `Remove the link "Duplicate of #${b.number}"` })
      .click();
    await expect(page.getByText("Link removed.")).toBeVisible();
    await expect(linkedRow(page)).toHaveCount(0);

    await expect
      .poll(() =>
        prisma.ticketRelation.count({
          where: { OR: [{ fromTicketId: a.id }, { toTicketId: a.id }] },
        }),
      )
      .toBe(0);
    for (const ticketId of [a.id, b.id]) {
      expect(
        await prisma.ticketAuditEvent.count({ where: { ticketId, action: "RELATION_REMOVED" } }),
      ).toBe(1);
    }
  });

  test("the dialog links A as the parent of B, and B then shows as already linked", async ({
    page,
  }) => {
    const a = await seedTicket("parent-a");
    const b = await seedTicket("parent-b");

    await openTicket(page, a.id);
    const dialog = await openLinkDialog(page);
    await expect(page.getByRole("combobox", { name: "This ticket" })).toHaveText("is related to");
    await expect(
      dialog.getByText("Type a ticket number, or at least 2 letters of the subject."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Link tickets" })).toBeDisabled();

    await chooseLinkType(page, "is the parent of");
    await dialog.getByPlaceholder("Search by number or subject…").fill(String(b.number));
    await pickerRow(page, b.number).click();
    await dialog.getByRole("button", { name: "Link tickets" }).click();

    await expect(page.getByText("Link added.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page)).toBeFocused();
    const chipOnA = linkedRow(page).getByRole("listitem");
    await expect(chipOnA).toContainText("Parent of");
    await expect(chipOnA.getByRole("link", { name: new RegExp(`#${b.number}\\b`) })).toBeVisible();

    await openTicket(page, b.id);
    const chipOnB = linkedRow(page).getByRole("listitem");
    await expect(chipOnB).toContainText("Child of");
    await expect(chipOnB.getByRole("link", { name: new RegExp(`#${a.number}\\b`) })).toBeVisible();

    // The two-ticket case is a picker case (review C4): the pair is linked, so B is disabled.
    await openTicket(page, a.id);
    const again = await openLinkDialog(page);
    await again.getByPlaceholder("Search by number or subject…").fill(String(b.number));
    const row = pickerRow(page, b.number);
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(row).toContainText("Already linked");
    await expect(again.getByRole("button", { name: "Link tickets" })).toBeDisabled();
  });

  test("a three-ticket cycle is refused with the cycle copy and nothing changes", async ({
    page,
  }) => {
    const a = await seedTicket("cycle-a");
    const b = await seedTicket("cycle-b");
    const c = await seedTicket("cycle-c");
    const actor = await adminActor();
    for (const [child, parent] of [
      [c, b],
      [b, a],
    ]) {
      const stored = await addRelation(prisma, actor, {
        ticketId: child.id,
        otherTicketId: parent.id,
        choice: "is a child of",
      });
      expect(stored.ok).toBe(true);
    }
    const ids = [a.id, b.id, c.id];
    const before = await relationCounts(ids);
    expect(before.childOf).toBe(2);

    await openTicket(page, a.id);
    const dialog = await openLinkDialog(page);
    await chooseLinkType(page, "is a child of");
    await dialog.getByPlaceholder("Search by number or subject…").fill(String(c.number));
    const row = pickerRow(page, c.number);
    await expect(row).not.toHaveAttribute("aria-disabled", "true");
    await row.click();
    await dialog.getByRole("button", { name: "Link tickets" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "This link would make a ticket its own parent or ancestor. Pick another ticket.",
    );
    await expect(dialog).toBeVisible();
    expect(await relationCounts(ids)).toEqual(before);
  });

  test("closing the Link dialog returns focus to the menu trigger (review UI-WR-03)", async ({
    page,
  }) => {
    const a = await seedTicket("focus-close-a");
    await openTicket(page, a.id);

    const dialog = await openLinkDialog(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page)).toBeFocused();

    const again = await openLinkDialog(page);
    await page.keyboard.press("Escape");
    await expect(again).toBeHidden();
    await expect(menuTrigger(page)).toBeFocused();
  });

  test("the picker asks for more input and reports no match", async ({ page }) => {
    const a = await seedTicket("picker-a");
    await openTicket(page, a.id);
    const dialog = await openLinkDialog(page);
    const input = dialog.getByPlaceholder("Search by number or subject…");
    await input.fill("z");
    await expect(
      dialog.getByText("Type a ticket number, or at least 2 letters of the subject."),
    ).toBeVisible();
    await input.fill(`zzqx${ts}`);
    await expect(dialog.getByText(`No tickets match "zzqx${ts}".`)).toBeVisible();
  });
});
