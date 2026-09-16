// Phase 11, plan 11-05: saved views in the interface (AIDA-47, D-03 to D-06, D-23; UI-SPEC
// Surfaces 1 and 2). Every permission is decided by the 11-03 service; these cases assert what an
// agent observes in the sidebar, the filter row, the strip and the dialogs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function userIdOf(email: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

async function seedTicket(label: string, status: "OPEN" | "PENDING") {
  const subject = `E2E Saved views ${label} ${ts}`;
  const ticket = await createTicket(orgId, {
    subject,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email: `saved-views-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status } });
  return { id: ticket.id, subject };
}

/** Every view a case creates, through prisma or the UI, is removed after the suite by name. */
const createdNames: string[] = [];
function viewName(label: string) {
  const name = `E2E view ${label} ${ts}`;
  createdNames.push(name);
  return name;
}

test.describe
  .serial("Saved views", () => {
    test.afterAll(async () => {
      await prisma.savedView.deleteMany({
        where: { organizationId: orgId, name: { in: createdNames } },
      });
    });

    test("a stored private view opens from the sidebar with its filters applied", async ({
      page,
    }) => {
      const open = await seedTicket("open", "OPEN");
      const pending = await seedTicket("pending", "PENDING");
      const name = viewName("tracer");
      const view = await prisma.savedView.create({
        data: {
          organizationId: orgId,
          ownerUserId: await userIdOf(ADMIN_EMAIL),
          name,
          visibility: "PRIVATE",
          filters: { version: 1, view: "all", statuses: ["OPEN"] },
          position: 0,
        },
        select: { id: true },
      });

      await page.goto("/tickets");
      const privateGroup = page.getByRole("list", { name: "Private" });
      const row = privateGroup.getByRole("link", { name });
      await expect(row).toBeVisible();

      await row.click();
      await expect(page).toHaveURL(new RegExp(`sv=${view.id}`));
      await expect(page).toHaveURL(/status=OPEN/);
      await expect(row).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("link", { name: open.subject })).toBeVisible();
      await expect(page.getByRole("link", { name: pending.subject })).toHaveCount(0);
    });
  });
