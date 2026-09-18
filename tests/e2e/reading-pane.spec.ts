import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, MEMBER_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
const SUBJECT = `E2E Reading Pane ${ts}`;

let ticketId: string;

test.beforeAll(async () => {
  const ticket = await createTicket(orgId, {
    subject: SUBJECT,
    priority: "NORMAL",
    body: "Initial inbound message",
    contact: { email: `reading-pane-${ts}@example.com` },
    direction: "INBOUND",
  });
  ticketId = ticket.id;
});

test("posts a public reply rendered from markdown", async ({ page }) => {
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole("button", { name: "Public Reply" }).click();
  await page.getByPlaceholder("Write a reply…").fill("This is a **bold** public reply.");
  await page.getByRole("button", { name: "Send Reply" }).click();

  await expect(page.locator("strong", { hasText: "bold" })).toBeVisible();
});

test("posts an internal note with distinct amber styling, separate from public replies", async ({
  page,
}) => {
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole("button", { name: "Internal Note" }).click();
  await page.getByPlaceholder("Write an internal note…").fill("Internal-only note text.");
  await page.getByRole("button", { name: "Save Internal Note" }).click();

  const noteMessage = page.locator(".border-l-warning");
  await expect(noteMessage).toContainText("Internal-only note text.");
  await expect(noteMessage.getByText("Internal Note", { exact: true })).toBeVisible();
});

test.describe("A member whose row was deleted (Codex diff critique round 2, E1)", () => {
  test.use({ storageState: path.resolve(__dirname, ".auth/member.json") });

  test("cannot read a known ticket: the page shows the access-ended state, no ticket data and no filter row", async ({
    page,
  }) => {
    const member = await prisma.member.findFirstOrThrow({
      where: { organizationId: orgId, user: { email: MEMBER_EMAIL } },
    });
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });

    // While the member row exists, the member reads the ticket (polls past a first-hit 404
    // while next dev compiles the route).
    await expect
      .poll(async () => (await page.goto(`/tickets/${ticketId}`))?.status() ?? 0)
      .toBe(200);
    await expect(page.getByText(SUBJECT).first()).toBeVisible();

    // The member is removed; the session cookie (with its active organization) stays valid.
    await prisma.member.delete({ where: { id: member.id } });
    try {
      const response = await page.goto(`/tickets/${ticketId}`);
      expect(response?.status()).toBe(200);
      // The whole streamed response, RSC payload included: no subject, no message text and no
      // roster name reaches the browser.
      const html = (await response?.text()) ?? "";
      expect(html).not.toContain(SUBJECT);
      expect(html).not.toContain("Initial inbound message");
      expect(html).not.toContain(owner.name);

      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Your access to this workspace has ended." }),
      ).toBeVisible();
      await expect(main.getByText("Sign out, then sign in again.").first()).toBeVisible();
      // Not the error boundary.
      await expect(page.getByText("Couldn't load tickets.")).toHaveCount(0);
      // The membership-ended panel has no filter row and no create-ticket control.
      await expect(page.getByRole("button", { name: "New Ticket" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Unassigned", exact: true })).toHaveCount(0);
      await expect(page.getByPlaceholder("Search tickets…")).toHaveCount(0);
    } finally {
      await prisma.member.create({
        data: {
          id: member.id,
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
        },
      });
    }
  });
});
