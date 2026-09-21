import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { createTicket, orgId, prisma } from "./support/db";

// AIDA-55 / D-18 / D-22: the ticket page shows one feed of messages and audit events, oldest
// first, and the order is observed through the real UI.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function seedTicket(label: string) {
  const body = `Customer message ${label} ${ts}`;
  const ticket = await createTicket(orgId, {
    subject: `E2E Feed ${label} ${ts}`,
    priority: "NORMAL",
    body,
    contact: { email: `feed-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "OPEN" } });
  return { id: ticket.id, number: ticket.number, body };
}

/** The first hit on a route may 404 while Next compiles it; poll instead of loosening. */
async function open(page: Page, url: string) {
  await expect.poll(async () => (await page.goto(url))?.status(), { timeout: 60_000 }).toBe(200);
}

function feedItems(page: Page) {
  return page.getByRole("list", { name: "Ticket activity" }).locator(":scope > li");
}

/** Index of the first feed item whose text contains `text`, or -1. */
async function indexOf(page: Page, text: string): Promise<number> {
  const texts = await feedItems(page).allInnerTexts();
  return texts.findIndex((t) => t.includes(text));
}

async function changeStatus(page: Page, ticketId: string, label: string, value: string) {
  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status)
    .toBe(value);
}

async function sendReply(page: Page, ticketId: string, reply: string) {
  await page.getByRole("button", { name: "Public Reply" }).click();
  await page.getByPlaceholder("Write a reply…").fill(reply);
  const [posted] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/tickets/${ticketId}/messages`) &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Send Reply" }).click(),
  ]);
  expect(posted.status()).toBe(200);
}

const STATUS_EVENT = "changed the status from Open to Pending.";

test.describe("Activity feed", () => {
  test("the feed lists the customer message, the status change and the reply in that order", async ({
    page,
  }) => {
    const ticket = await seedTicket("tracer");
    const reply = `Agent reply ${ts}`;
    await open(page, `/tickets/${ticket.id}`);
    await expect(page.getByRole("list", { name: "Ticket activity" })).toBeVisible();

    await changeStatus(page, ticket.id, "Pending", "PENDING");
    await sendReply(page, ticket.id, reply);

    await open(page, `/tickets/${ticket.id}`);
    await expect(feedItems(page).filter({ hasText: reply })).toHaveCount(1);
    const message = await indexOf(page, ticket.body);
    const status = await indexOf(page, STATUS_EVENT);
    const replied = await indexOf(page, reply);
    expect(message).toBeGreaterThanOrEqual(0);
    expect(status).toBeGreaterThan(message);
    expect(replied).toBeGreaterThan(status);
  });
});
