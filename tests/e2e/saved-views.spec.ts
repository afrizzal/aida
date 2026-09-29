// Phase 11, plan 11-05: saved views in the interface (AIDA-47, D-03 to D-06, D-23; UI-SPEC
// Surfaces 1 and 2). Every permission is decided by the 11-03 service; these cases assert what an
// agent observes in the sidebar, the filter row, the strip and the dialogs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma, stateIdFor } from "./support/db";
import { requireBrowser } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

/** The canonical state= value for the given state ids: sorted in code-unit order (12.1-10). */
function stateParam(...ids: string[]): string {
  return [...ids].sort().join(",");
}

/** Matches state=<ids> in a URL whether the comma is written raw or encoded. */
function stateParamPattern(...ids: string[]): string {
  return `state=${[...ids].sort().join("(?:,|%2C)")}`;
}

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
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { stateId: await stateIdFor(status) },
  });
  return { id: ticket.id, subject };
}

function saveButton(page: Page) {
  return page.getByRole("button", { name: "Save these filters as a view" });
}

function summaryValue(dialog: Locator, label: string) {
  return dialog
    .locator("dl > div")
    .filter({ has: dialog.page().locator("dt", { hasText: label }) })
    .locator("dd");
}

/** Seeds a view for the admin straight into the database and returns its id. */
async function seedAdminView(
  name: string,
  visibility: "PRIVATE" | "SHARED",
  filters: Record<string, unknown>,
  position = 100,
) {
  const view = await prisma.savedView.create({
    data: {
      organizationId: orgId,
      ownerUserId: await userIdOf(ADMIN_EMAIL),
      name,
      visibility,
      filters: { version: 2, view: "all", stateIds: [], ...filters },
      position,
    },
    select: { id: true },
  });
  return view.id;
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
    const createdTagNames: string[] = [];
    test.afterAll(async () => {
      await prisma.savedView.deleteMany({
        where: { organizationId: orgId, name: { in: createdNames } },
      });
      await prisma.tag.deleteMany({
        where: { organizationId: orgId, name: { in: createdTagNames } },
      });
    });

    test("a stored private view opens from the sidebar with its filters applied", async ({
      page,
    }) => {
      const open = await seedTicket("open", "OPEN");
      const pending = await seedTicket("pending", "PENDING");
      const name = viewName("tracer");
      const openId = await stateIdFor("OPEN");
      const view = await prisma.savedView.create({
        data: {
          organizationId: orgId,
          ownerUserId: await userIdOf(ADMIN_EMAIL),
          name,
          visibility: "PRIVATE",
          filters: { version: 2, view: "all", stateIds: [openId] },
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
      await expect(page).toHaveURL(new RegExp(stateParamPattern(openId)));
      await expect(row).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("link", { name: open.subject })).toBeVisible();
      await expect(page.getByRole("link", { name: pending.subject })).toHaveCount(0);
    });

    test("the save button is disabled until a filter is set", async ({ page }) => {
      await page.goto("/tickets");
      await expect(saveButton(page)).toBeDisabled();
    });

    test("an agent saves the on-screen filters as a private view and lands on it", async ({
      page,
    }) => {
      const name = viewName("saved private");
      await page.goto(`/tickets?state=${await stateIdFor("OPEN")}`);
      await saveButton(page).click();

      const dialog = page.getByRole("dialog", { name: "Save view" });
      await expect(summaryValue(dialog, "Status")).toHaveText("Open");
      await dialog.getByLabel("Name", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "Save view" }).click();

      await expect(page.getByText("View saved.")).toBeVisible();
      await expect(page).toHaveURL(/[?&]sv=/);
      const row = page.getByRole("list", { name: "Private" }).getByRole("link", { name });
      await expect(row).toHaveAttribute("aria-current", "page");
    });

    test("sharing a view with search text shows the warning first and lists it under Shared", async ({
      page,
    }) => {
      const name = viewName("shared search");
      const token = `svq${ts}`;
      await page.goto(`/tickets?q=${token}`);
      await saveButton(page).click();

      const dialog = page.getByRole("dialog", { name: "Save view" });
      await dialog.getByLabel("Name", { exact: true }).fill(name);
      await expect(dialog.getByRole("status")).toHaveCount(0);
      await dialog.getByRole("combobox", { name: "Who can see it" }).click();
      await page.getByRole("option", { name: "Everyone in this workspace" }).click();
      await expect(dialog.getByRole("status")).toContainText(
        `This view includes the search text "${token}". Everyone in this workspace will be able to see it.`,
      );
      await dialog.getByRole("button", { name: "Save view" }).click();

      await expect(page.getByText("View saved.")).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Shared" }).getByRole("link", { name }),
      ).toBeVisible();
    });

    test("a duplicate private name keeps the dialog open with one error", async ({ page }) => {
      const name = viewName("duplicate");
      const ownerUserId = await userIdOf(ADMIN_EMAIL);
      await prisma.savedView.create({
        data: {
          organizationId: orgId,
          ownerUserId,
          name,
          visibility: "PRIVATE",
          filters: { version: 2, view: "all", stateIds: [await stateIdFor("PENDING")] },
          position: 50,
        },
      });

      await page.goto(`/tickets?state=${await stateIdFor("OPEN")}`);
      await saveButton(page).click();
      const dialog = page.getByRole("dialog", { name: "Save view" });
      await dialog.getByLabel("Name", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "Save view" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(
        `You already have a view named "${name}". Choose another name.`,
      );
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(name);
    });
    test("changing a chip shows Filters changed and Reset returns to the stored filters", async ({
      page,
    }) => {
      const name = viewName("changed");
      const openId = await stateIdFor("OPEN");
      const pendingId = await stateIdFor("PENDING");
      const id = await seedAdminView(name, "PRIVATE", { stateIds: [openId] });
      await page.goto(`/tickets?sv=${id}&state=${openId}`);
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Filters changed")).toHaveCount(0);

      await page.getByRole("button", { name: /^Status/ }).click();
      await page.getByRole("menuitemcheckbox", { name: "Pending" }).click();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(new RegExp(stateParamPattern(openId, pendingId)));
      await expect(page.getByText("Filters changed")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`sv=${id}`));

      await page.getByRole("link", { name: "Reset" }).click();
      await expect(page).toHaveURL(new RegExp(`sv=${id}&state=${openId}$`));
      await expect(page.getByText("Filters changed")).toHaveCount(0);
    });

    test("a different status order alone does not show Filters changed", async ({ page }) => {
      const name = viewName("status order");
      const openId = await stateIdFor("OPEN");
      const pendingId = await stateIdFor("PENDING");
      const sorted = [openId, pendingId].sort();
      const reversed = [...sorted].reverse();
      // Stored in non-canonical order, the way a direct write could leave it.
      const id = await seedAdminView(name, "PRIVATE", { stateIds: reversed });

      await page.goto(`/tickets?sv=${id}&state=${reversed.join(",")}`);
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Filters changed")).toHaveCount(0);

      await page.goto(`/tickets?sv=${id}&state=${stateParam(...sorted)}`);
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Filters changed")).toHaveCount(0);
    });

    test("a deleted tag shows the broken-reference notice until the view is edited", async ({
      page,
    }) => {
      const tagName = `e2e-sv-tag-${ts}`;
      createdTagNames.push(tagName);
      const tag = await prisma.tag.create({
        data: { organizationId: orgId, name: tagName },
        select: { id: true },
      });
      const name = viewName("broken tag");

      await page.goto(`/tickets?tag=${tag.id}`);
      await saveButton(page).click();
      const saveDialog = page.getByRole("dialog", { name: "Save view" });
      await expect(summaryValue(saveDialog, "Tag")).toHaveText(tagName);
      await saveDialog.getByLabel("Name", { exact: true }).fill(name);
      await saveDialog.getByRole("button", { name: "Save view" }).click();
      await expect(page.getByText("View saved.")).toBeVisible();

      await prisma.tag.delete({ where: { id: tag.id } });

      await page.goto("/tickets");
      await page.getByRole("list", { name: "Private" }).getByRole("link", { name }).click();
      const notice = page.getByRole("status").filter({ hasText: "no longer exists" });
      await expect(notice).toContainText(
        "This view filters on a tag that no longer exists. Edit the view to remove it.",
      );
      await expect(page).toHaveURL(new RegExp(`tag=${tag.id}`));

      await notice.getByRole("button", { name: "Edit view" }).click();
      const editDialog = page.getByRole("dialog", { name: "Edit view" });
      await expect(summaryValue(editDialog, "Tag")).toContainText("No longer exists");
      await editDialog.getByRole("button", { name: "Remove the Tag filter" }).click();
      await expect(editDialog.getByText("No longer exists")).toHaveCount(0);
      await editDialog.getByRole("button", { name: "Save changes" }).click();

      await expect(page.getByText("View updated.")).toBeVisible();
      await expect(page.getByText("Edit the view to remove it.")).toHaveCount(0);
      await expect(page).not.toHaveURL(/tag=/);
    });

    test("a member sees the admin's shared view without options, never the private one", async ({
      context,
    }) => {
      const sharedName = viewName("for everyone");
      const privateName = viewName("admin only");
      const pendingId = await stateIdFor("PENDING");
      const sharedId = await seedAdminView(sharedName, "SHARED", {
        stateIds: [await stateIdFor("OPEN")],
      });
      const privateId = await seedAdminView(privateName, "PRIVATE", { stateIds: [pendingId] });

      const memberContext = await requireBrowser(context).newContext({
        storageState: path.resolve(__dirname, ".auth/member.json"),
      });
      try {
        const page = await memberContext.newPage();
        await page.goto("/tickets");
        const sharedRow = page.getByRole("list", { name: "Shared" }).getByRole("link", {
          name: sharedName,
        });
        await expect(sharedRow).toBeVisible();
        await expect(page.getByRole("link", { name: privateName })).toHaveCount(0);

        await sharedRow.click();
        await expect(page).toHaveURL(new RegExp(`sv=${sharedId}`));
        await expect(sharedRow).toHaveAttribute("aria-current", "page");
        await expect(page.getByText("Shared", { exact: true }).last()).toBeVisible();
        await expect(page.getByRole("button", { name: "View options" })).toHaveCount(0);

        await page.goto(`/tickets?sv=${privateId}&state=${pendingId}`);
        await expect(
          page.getByText("This view was deleted or is not shared with you."),
        ).toBeVisible();
        await expect(page.getByText(privateName)).toHaveCount(0);
        await page.getByRole("link", { name: "Clear" }).click();
        await expect(page).toHaveURL(new RegExp(`/tickets\\?state=${pendingId}$`));
      } finally {
        await memberContext.close();
      }
    });

    test("the admin deletes a view from the strip menu", async ({ page }) => {
      const name = viewName("to delete");
      const openId = await stateIdFor("OPEN");
      const id = await seedAdminView(name, "PRIVATE", { stateIds: [openId] });
      await page.goto(`/tickets?sv=${id}&state=${openId}`);
      await expect(
        page.getByRole("list", { name: "Private" }).getByRole("link", { name }),
      ).toBeVisible();

      await page.getByRole("button", { name: "View options" }).click();
      await page.getByRole("menuitem", { name: "Delete view" }).click();
      const dialog = page.getByRole("dialog", { name: `Delete the view "${name}"?` });
      await expect(dialog).toContainText("It disappears from your sidebar. No tickets change.");
      await dialog.getByRole("button", { name: "Delete view" }).click();

      await expect(page.getByText("View deleted.")).toBeVisible();
      await expect(page).not.toHaveURL(/sv=/);
      // UI-SPEC 2d: focus lands on a control inside the list panel, not on the page body or on
      // the panel's own scroll container.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement;
            const panel = document.getElementById("ticket-list-panel");
            return Boolean(panel && active && active !== panel && panel.contains(active));
          }),
        )
        .toBe(true);
      await expect(page).toHaveURL(new RegExp(stateParamPattern(openId)));
      await expect(page.getByRole("link", { name })).toHaveCount(0);
      await expect.poll(() => prisma.savedView.count({ where: { id } })).toBe(0);
    });

    test("an old Open status bookmark lands on the Open state's state= URL", async ({ page }) => {
      const open = await seedTicket("legacy open", "OPEN");
      const pending = await seedTicket("legacy pending", "PENDING");
      const openId = await stateIdFor("OPEN");

      await page.goto("/tickets?status=OPEN");
      await expect(page).toHaveURL(new RegExp(`/tickets\\?state=${openId}$`));
      expect(new URL(page.url()).searchParams.has("status")).toBe(false);
      await expect(page.getByRole("link", { name: open.subject })).toBeVisible();
      await expect(page.getByRole("link", { name: pending.subject })).toHaveCount(0);
    });
  });
