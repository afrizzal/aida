// Phase 11, plan 11-06: row selection and the bulk action bar (AIDA-48, D-08, D-10, D-23;
// UI-SPEC Surface 3). Every case seeds its own tickets with a unique search token and opens the
// inbox filtered by it, so other specs' tickets never appear. Assertions are observed outcomes:
// what the bar shows and what the database holds afterwards, including the audit rows.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
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

function rowCheckbox(page: Page, subject: string) {
  return page.getByRole("checkbox", { name: new RegExp(`: ${subject}$`) });
}

/** Opens the inbox filtered by the token; polls past a first-hit 404 while the route compiles. */
async function openInbox(page: Page, query: string, firstSubject: string) {
  await expect
    .poll(async () => {
      await page.goto(`/tickets?${query}`);
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
});
