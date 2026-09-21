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
});
