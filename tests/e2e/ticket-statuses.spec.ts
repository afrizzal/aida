// Phase 12.1, plan 12.1-16: custom ticket states in the browser (AIDA-97, AIDA-56, AIDA-57).
// Every admin action on /settings/statuses, the top-bar picker with the paused SLA chip (D-18),
// the bulk picker, the public group label (D-13) and the missing-state paths (D-09). Expected
// strings come from the copy modules (state-copy.ts, activity-copy.ts), never re-typed. The
// describe's afterAll puts the five migrated states and every config role back before it removes
// fixtures, so later specs see the defaults.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { BULK_SUFFIX, DELETED_STATUS_MARKER } from "../../src/lib/tickets/activity-copy";
import {
  addStatusAriaLabel,
  CREATE_STATUS_CTA,
  createdToast,
  DEFAULT_BADGE,
  DEFAULT_ERROR_DELETED,
  DEFAULT_UNAVAILABLE_NOT_OPEN,
  DELETE_ERROR_REPLACEMENT_INVALID,
  DELETE_STATUS_BUTTON,
  defaultToast,
  deletedAndMovedToast,
  deletedToast,
  deleteUnavailableLastInGroup,
  EDIT_STATUS_TITLE,
  FORM_CLOSE,
  GROUP_LABELS,
  KEEP_STATUS,
  MEMBERS_NOTE,
  MISSING_STATUS_ITEM,
  MOVE_AND_DELETE_BUTTON,
  moveUpAriaLabel,
  NAME_LABEL,
  pausedChipLabel,
  REPLACE_AND_DELETE_BUTTON,
  REPLACEMENT_LABEL,
  ROW_MENU_DELETE,
  ROW_MENU_EDIT,
  ROW_MENU_SET_DEFAULT,
  removeDeletedStatusesLabel,
  reorderAnnouncement,
  rowOptionsAriaLabel,
  SAVE_CHANGES_CTA,
  SLA_PAUSED_CHIP,
  STATUS_MENU_TRIGGER_LABEL,
  type StateGroupKey,
  savedToast,
  statusFormErrorDuplicate,
  stripMissingSentence,
  URL_MISSING_STATUS_NOTICE,
} from "../../src/lib/tickets/state-copy";
import { createTicket, type LegacyStatusKey, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
/** Every fixture state name ends with this suffix; the afterAll finds fixtures by it. */
const SUFFIX = ` ${ts}`;
const VENDOR = `Waiting on vendor${SUFFIX}`;

/** The seeded values of the five migrated states (12.1-01 backfill). */
const MIGRATED: Record<LegacyStatusKey, { name: string; colorToken: string; sortOrder: number }> = {
  NEW: { name: "New", colorToken: "indigo-filled", sortOrder: 0 },
  OPEN: { name: "Open", colorToken: "indigo", sortOrder: 1 },
  PENDING: { name: "Pending", colorToken: "amber", sortOrder: 2 },
  RESOLVED: { name: "Resolved", colorToken: "green", sortOrder: 3 },
  CLOSED: { name: "Closed", colorToken: "gray", sortOrder: 4 },
};

/** Saved views created by the cases, removed by name in the afterAll. */
const createdViewNames: string[] = [];
/** Shared between cases of the serial describe. */
const shared: { vendorTicketId?: string } = {};

async function migratedId(key: LegacyStatusKey): Promise<string> {
  const row = await prisma.ticketState.findFirstOrThrow({
    where: { organizationId: orgId, legacyStatus: key },
    select: { id: true },
  });
  return row.id;
}

/** Inserts a fixture state at the end of its group (a name without the suffix gets it). */
async function insertState(group: StateGroupKey, name: string, colorToken = "gray") {
  const last = await prisma.ticketState.findFirst({
    where: { organizationId: orgId, group, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return prisma.ticketState.create({
    data: {
      organizationId: orgId,
      name: name.endsWith(SUFFIX) ? name : `${name}${SUFFIX}`,
      colorToken,
      group,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
    select: { id: true, name: true },
  });
}

async function seedTicket(label: string, email = `ticket-statuses-${label}-${ts}@example.com`) {
  const subject = `E2E Statuses ${label} ${ts}`;
  const ticket = await createTicket(orgId, {
    subject,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email },
    direction: "INBOUND",
  });
  return { ...ticket, subject };
}

/** The first hit on a route may 404 while next dev compiles it; poll instead of loosening. */
async function gotoReady(page: Page, url: string) {
  await expect.poll(async () => (await page.goto(url))?.status(), { timeout: 60_000 }).toBe(200);
}

/** The ordered list of a group card on /settings/statuses. */
function groupList(page: Page, group: StateGroupKey) {
  return page.getByRole("list", { name: GROUP_LABELS[group], exact: true });
}

async function chooseTopBarState(page: Page, name: string) {
  await page.getByRole("button", { name: STATUS_MENU_TRIGGER_LABEL }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(page.getByRole("button", { name: STATUS_MENU_TRIGGER_LABEL })).toContainText(name);
}

test.describe
  .serial("Ticket statuses", () => {
    test.afterAll(async () => {
      const ids = {} as Record<LegacyStatusKey, string>;
      // (1) The five migrated states: active, with their seeded names, colours and order.
      for (const key of Object.keys(MIGRATED) as LegacyStatusKey[]) {
        const row = await prisma.ticketState.findFirstOrThrow({
          where: { organizationId: orgId, legacyStatus: key },
          select: { id: true },
        });
        await prisma.ticketState.update({
          where: { id: row.id },
          data: { deletedAt: null, ...MIGRATED[key] },
        });
        ids[key] = row.id;
      }
      // (2) Every role back on the migrated states before any fixture is removed.
      await prisma.ticketStateConfig.update({
        where: { organizationId: orgId },
        data: {
          newStateId: ids.NEW,
          reopenStateId: ids.OPEN,
          resolveStateId: ids.RESOLVED,
          autoCloseStateId: ids.CLOSED,
          mergeCloseStateId: ids.CLOSED,
        },
      });
      const fixtures = await prisma.ticketState.findMany({
        where: { organizationId: orgId, legacyStatus: null, name: { endsWith: SUFFIX } },
        select: { id: true },
      });
      const fixtureIds = fixtures.map((f) => f.id);
      // (3) Tickets in a fixture state move to Open with the SLA running.
      await prisma.ticket.updateMany({
        where: { organizationId: orgId, stateId: { in: fixtureIds } },
        data: { stateId: ids.OPEN, slaPausedAt: null },
      });
      // (4) Fixture saved views.
      if (createdViewNames.length > 0) {
        await prisma.savedView.deleteMany({
          where: { organizationId: orgId, name: { in: createdViewNames } },
        });
      }
      // (5) Unreferenced fixtures are hard-deleted, any other is soft-deleted.
      for (const id of fixtureIds) {
        const tickets = await prisma.ticket.count({ where: { stateId: id } });
        const roles = await prisma.ticketStateConfig.count({
          where: {
            OR: [
              { newStateId: id },
              { reopenStateId: id },
              { resolveStateId: id },
              { autoCloseStateId: id },
              { mergeCloseStateId: id },
            ],
          },
        });
        if (tickets === 0 && roles === 0) await prisma.ticketState.delete({ where: { id } });
        else await prisma.ticketState.update({ where: { id }, data: { deletedAt: new Date() } });
      }
      // (6) The defaults are back.
      const config = await prisma.ticketStateConfig.findUniqueOrThrow({
        where: { organizationId: orgId },
      });
      const newState = await prisma.ticketState.findFirstOrThrow({
        where: { organizationId: orgId, name: "New", legacyStatus: "NEW", deletedAt: null },
        select: { id: true },
      });
      expect(config.newStateId).toBe(newState.id);
      expect(
        await prisma.ticketState.count({ where: { organizationId: orgId, deletedAt: null } }),
      ).toBe(5);
    });

    test("tracer: a team's own Pending state pauses the SLA and stays private", async ({
      page,
    }) => {
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: addStatusAriaLabel(GROUP_LABELS.PENDING) }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(NAME_LABEL, { exact: true }).fill(VENDOR);
      await dialog.getByText("Orange", { exact: true }).click();
      await expect(dialog.getByRole("radio", { name: "Orange" })).toBeChecked();
      await dialog.getByRole("button", { name: CREATE_STATUS_CTA }).click();
      await expect(page.getByText(createdToast(VENDOR))).toBeVisible();
      await expect(groupList(page, "PENDING").getByText(VENDOR, { exact: true })).toBeVisible();

      const ticket = await seedTicket("tracer");
      shared.vendorTicketId = ticket.id;
      await gotoReady(page, `/tickets/${ticket.id}`);
      await chooseTopBarState(page, VENDOR);
      await expect(page.getByText(pausedChipLabel(false), { exact: true }).first()).toBeVisible();

      const { statusToken } = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { statusToken: true, slaPausedAt: true },
      });
      await gotoReady(page, `/status/${statusToken}`);
      await expect(page.getByText(GROUP_LABELS.PENDING, { exact: true }).first()).toBeVisible();
      expect(await page.content()).not.toContain(VENDOR);

      // Back to an Open-group state: the normal SLA chip returns (D-18).
      await gotoReady(page, `/tickets/${ticket.id}`);
      await chooseTopBarState(page, MIGRATED.OPEN.name);
      await expect(page.getByText(SLA_PAUSED_CHIP)).toHaveCount(0);
      await expect(page.getByText(/^(Due in .+|At risk|Overdue)$/).first()).toBeVisible();
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).stateId).toBe(
        await migratedId("OPEN"),
      );
    });

    test("rename and recolour a fixture state; focus returns to its Options button", async ({
      page,
    }) => {
      const state = await insertState("PENDING", "Edit me");
      const renamed = `Renamed${SUFFIX}`;
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(state.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_EDIT }).click();
      const dialog = page.getByRole("dialog", { name: EDIT_STATUS_TITLE });
      await dialog.getByLabel(NAME_LABEL, { exact: true }).fill(renamed);
      await dialog.getByText("Blue", { exact: true }).click();
      await dialog.getByRole("button", { name: SAVE_CHANGES_CTA }).click();
      await expect(page.getByText(savedToast(renamed))).toBeVisible();
      await expect(groupList(page, "PENDING").getByText(renamed, { exact: true })).toBeVisible();
      const options = page.getByRole("button", { name: rowOptionsAriaLabel(renamed) });
      await expect(options).toBeFocused();
      const row = await prisma.ticketState.findUniqueOrThrow({ where: { id: state.id } });
      expect([row.name, row.colorToken]).toEqual([renamed, "blue"]);

      await options.click();
      await page.getByRole("menuitem", { name: ROW_MENU_EDIT }).click();
      await page.getByRole("dialog").getByRole("button", { name: FORM_CLOSE }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(options).toBeFocused();
    });

    test("reorder moves a Pending state up and announces its position", async ({ page }) => {
      const state = await insertState("PENDING", "Reorder me");
      await gotoReady(page, "/settings/statuses");
      const rows = groupList(page, "PENDING").getByRole("listitem");
      await expect(rows.last()).toContainText(state.name);
      const total = await rows.count();
      await page.getByRole("button", { name: moveUpAriaLabel(state.name) }).click();
      // The row moves one place up once the refreshed list arrives (nothing is optimistic).
      await expect(rows.nth(total - 2)).toContainText(state.name);
      await expect(page.locator('p[role="status"][aria-live="polite"]')).toHaveText(
        reorderAnnouncement(state.name, total - 1, total, GROUP_LABELS.PENDING),
      );
      await expect(page.getByRole("button", { name: moveUpAriaLabel(state.name) })).toBeFocused();
    });

    test("an Open state used for new tickets gets the badge and new tickets start in it", async ({
      page,
    }) => {
      const name = `Front desk${SUFFIX}`;
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: addStatusAriaLabel(GROUP_LABELS.OPEN) }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(NAME_LABEL, { exact: true }).fill(name);
      await dialog.getByRole("button", { name: CREATE_STATUS_CTA }).click();
      await expect(page.getByText(createdToast(name))).toBeVisible();

      await page.getByRole("button", { name: rowOptionsAriaLabel(name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_SET_DEFAULT }).click();
      await expect(page.getByText(defaultToast(name))).toBeVisible();
      const row = groupList(page, "OPEN").getByRole("listitem").filter({ hasText: name });
      await expect(row.getByText(DEFAULT_BADGE)).toBeVisible();
      await expect(page.getByText(DEFAULT_BADGE, { exact: true })).toHaveCount(1);

      const state = await prisma.ticketState.findFirstOrThrow({
        where: { organizationId: orgId, name, deletedAt: null },
      });
      const ticket = await seedTicket("after-default");
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).stateId).toBe(
        state.id,
      );
      await gotoReady(page, `/tickets?q=${encodeURIComponent(`after-default ${ts}`)}`);
      await expect(page.locator("p", { hasText: `E2E Statuses after-default ${ts}` })).toHaveClass(
        /\bfont-medium\b/,
      );
    });

    test("a set-default refusal shows the callout and focuses the row's Options button", async ({
      page,
    }) => {
      const before = await prisma.ticketStateConfig.findUniqueOrThrow({
        where: { organizationId: orgId },
      });
      const ghost = await insertState("OPEN", "Ghost default");
      await gotoReady(page, "/settings/statuses");
      await expect(
        page.getByRole("button", { name: rowOptionsAriaLabel(ghost.name) }),
      ).toBeVisible();
      // Deleted where only the server sees it.
      await prisma.ticketState.update({ where: { id: ghost.id }, data: { deletedAt: new Date() } });
      await page.getByRole("button", { name: rowOptionsAriaLabel(ghost.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_SET_DEFAULT }).click();
      const openCard = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: GROUP_LABELS.OPEN, exact: true }) });
      await expect(openCard.getByRole("alert")).toHaveText(DEFAULT_ERROR_DELETED);
      await expect(
        page.getByRole("button", { name: rowOptionsAriaLabel(ghost.name) }),
      ).toBeFocused();
      const after = await prisma.ticketStateConfig.findUniqueOrThrow({
        where: { organizationId: orgId },
      });
      expect(after.newStateId).toBe(before.newStateId);
    });

    test("a duplicate name refused by the server focuses the Name input", async ({ page }) => {
      const name = `Duplicate${SUFFIX}`;
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: addStatusAriaLabel(GROUP_LABELS.PENDING) }).click();
      const dialog = page.getByRole("dialog");
      // Inserted after the page loaded, so the client's duplicate check passes.
      await insertState("PENDING", name);
      const input = dialog.getByLabel(NAME_LABEL, { exact: true });
      await input.fill(name);
      await dialog.getByRole("button", { name: CREATE_STATUS_CTA }).click();
      await expect(dialog.getByText(statusFormErrorDuplicate(name))).toBeVisible();
      await expect(input).toBeFocused();
      expect(await prisma.ticketState.count({ where: { organizationId: orgId, name } })).toBe(1);
    });

    test("delete with a Pending replacement moves the ticket and records it in the feed", async ({
      page,
    }) => {
      const ticketId = shared.vendorTicketId;
      if (!ticketId) throw new Error("the tracer case must run first");
      const vendor = await prisma.ticketState.findFirstOrThrow({
        where: { organizationId: orgId, name: VENDOR, deletedAt: null },
      });
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { stateId: vendor.id, slaPausedAt: new Date() },
      });
      await gotoReady(page, "/settings/statuses");
      const labels = await groupList(page, "PENDING")
        .getByRole("button", { name: /^Options for "/ })
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
      const index = labels.indexOf(rowOptionsAriaLabel(VENDOR));
      expect(index).toBeGreaterThanOrEqual(0);
      const expectedFocus =
        labels[index + 1] ?? labels[index - 1] ?? addStatusAriaLabel(GROUP_LABELS.PENDING);

      await page.getByRole("button", { name: rowOptionsAriaLabel(VENDOR) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_DELETE }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(REPLACEMENT_LABEL).click();
      await page.getByRole("option", { name: MIGRATED.PENDING.name, exact: true }).click();
      await dialog.getByRole("button", { name: MOVE_AND_DELETE_BUTTON }).click();
      await expect(
        page.getByText(deletedAndMovedToast(VENDOR, 1, MIGRATED.PENDING.name)),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: expectedFocus, exact: true })).toBeFocused();

      await gotoReady(page, `/tickets/${ticketId}`);
      await expect(page.getByRole("button", { name: STATUS_MENU_TRIGGER_LABEL })).toHaveText(
        MIGRATED.PENDING.name,
      );
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await expect(
        page
          .getByText(
            new RegExp(`${esc(`${VENDOR} ${DELETED_STATUS_MARKER}`)}.*${esc(BULK_SUFFIX)}`),
          )
          .first(),
      ).toBeVisible();
    });

    test("merge pair and contact page show state chips", async ({ page }) => {
      const email = `ticket-statuses-merge-${ts}@example.com`;
      const source = await seedTicket("merge-source", email);
      const target = await seedTicket("merge-target", email);
      const fixture = await insertState("OPEN", "Merge source state");
      await prisma.ticket.update({ where: { id: source.id }, data: { stateId: fixture.id } });
      const targetRow = await prisma.ticket.findUniqueOrThrow({
        where: { id: target.id },
        select: { contactId: true, state: { select: { name: true } } },
      });

      await gotoReady(page, `/tickets/${source.id}`);
      await page.getByRole("button", { name: "More ticket actions" }).click();
      await page.getByRole("menuitem", { name: /Merge into another ticket…/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByPlaceholder("Search by number or subject…").fill(String(target.number));
      await dialog.getByRole("option", { name: new RegExp(`^#${target.number}\\b`) }).click();
      await dialog.getByRole("button", { name: "Review merge" }).click();
      await expect(
        dialog.getByRole("heading", { name: `Merge #${source.number} into #${target.number}?` }),
      ).toBeVisible();
      await expect(dialog.getByText(fixture.name, { exact: true })).toBeVisible();
      await expect(dialog.getByText(targetRow.state.name, { exact: true }).first()).toBeVisible();
      await dialog.getByRole("button", { name: "Keep tickets separate" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: source.id } });
      expect([after.mergedIntoTicketId, after.stateId]).toEqual([null, fixture.id]);

      await gotoReady(page, `/contacts/${targetRow.contactId}`);
      await expect(
        page.locator(`a[href="/tickets/${source.id}"]`).getByText(fixture.name, { exact: true }),
      ).toBeVisible();
    });

    test("the only Closed state cannot be deleted and says why", async ({ page }) => {
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(MIGRATED.CLOSED.name) }).click();
      const item = page.getByRole("menuitem", { name: ROW_MENU_DELETE });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toContainText(deleteUnavailableLastInGroup(GROUP_LABELS.CLOSED));
      await page.keyboard.press("Escape");
    });

    test.describe("as a member", () => {
      test.use({ storageState: path.resolve(__dirname, ".auth/member.json") });

      test("the Statuses page is read-only with the members note", async ({ page }) => {
        await gotoReady(page, "/settings/statuses");
        await expect(page.getByText(MEMBERS_NOTE)).toBeVisible();
        await expect(groupList(page, "OPEN").getByText(MIGRATED.OPEN.name)).toBeVisible();
        await expect(page.getByRole("button", { name: /^Add a .* status$/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Options for "/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Move ".*" (up|down)$/ })).toHaveCount(0);
      });
    });

    test("the bulk Status picker applies Resolved to two tickets", async ({ page }) => {
      const token = `bulk-${ts}`;
      const first = await seedTicket(`${token} one`);
      const second = await seedTicket(`${token} two`);
      await gotoReady(page, `/tickets?q=${token}`);
      for (const ticket of [first, second]) {
        await page.getByRole("checkbox", { name: new RegExp(`: ${ticket.subject}$`) }).click();
      }
      const bar = page.getByRole("region", { name: "Bulk actions" });
      await expect(bar.getByText("2 tickets selected")).toBeVisible();
      await bar.getByRole("button", { name: "Status" }).click();
      await page.getByRole("option", { name: MIGRATED.RESOLVED.name }).click();
      await expect(page.getByText("Applied to 2 tickets.")).toBeVisible();
      for (const ticket of [first, second]) {
        await expect(page.locator(`#ticket-row-${ticket.id}`)).toContainText(
          MIGRATED.RESOLVED.name,
        );
      }
    });

    test("a URL filter on a deleted state shows the notice until it is removed", async ({
      page,
    }) => {
      const state = await insertState("OPEN", "Filter gone");
      const ticket = await seedTicket("filter-gone");
      await prisma.ticket.update({ where: { id: ticket.id }, data: { stateId: state.id } });
      await gotoReady(page, `/tickets?state=${state.id}`);
      await expect(page.getByRole("link", { name: ticket.subject })).toBeVisible();

      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(state.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_DELETE }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(REPLACEMENT_LABEL).click();
      await page.getByRole("option", { name: MIGRATED.OPEN.name, exact: true }).click();
      await dialog.getByRole("button", { name: MOVE_AND_DELETE_BUTTON }).click();
      await expect(
        page.getByText(deletedAndMovedToast(state.name, 1, MIGRATED.OPEN.name)),
      ).toBeVisible();

      await gotoReady(page, `/tickets?state=${state.id}`);
      await expect(page.getByText(URL_MISSING_STATUS_NOTICE)).toBeVisible();
      await expect(page.getByText("Nothing here — no tickets match this view.")).toBeVisible();
      await page.getByRole("button", { name: removeDeletedStatusesLabel(1) }).click();
      await expect(page.getByText(URL_MISSING_STATUS_NOTICE)).toHaveCount(0);
      await expect(page).not.toHaveURL(new RegExp(`state=${state.id}`));
    });

    // UI-SPEC 4c: focus moves to the Status filter trigger after "Remove deleted status". This case
    // first failed (trigger "inactive": the notice focused the trigger before router.replace and
    // the navigation rendered a new trigger; reported in 12.1-16-SUMMARY.md). Fixed in 3dd5a08:
    // the filter row focuses the trigger once the URL carries the requested state value.
    test("after removing a deleted status the Status filter trigger has focus", async ({
      page,
    }) => {
      const state = await insertState("OPEN", "Focus gone");
      await prisma.ticketState.update({ where: { id: state.id }, data: { deletedAt: new Date() } });
      await gotoReady(page, `/tickets?state=${state.id}`);
      await page.getByRole("button", { name: removeDeletedStatusesLabel(1) }).click();
      await expect(page.getByText(URL_MISSING_STATUS_NOTICE)).toHaveCount(0);
      await expect(page.locator("#inbox-status-filter-trigger")).toBeFocused();
    });

    test("a saved view on a deleted state shows the strip sentence", async ({ page }) => {
      const state = await insertState("OPEN", "View gone");
      const viewName = `E2E statuses view ${ts}`;
      createdViewNames.push(viewName);
      const owner = await prisma.user.findFirstOrThrow({
        where: { email: "owner@e2e.aida.test" },
        select: { id: true },
      });
      await prisma.savedView.create({
        data: {
          organizationId: orgId,
          ownerUserId: owner.id,
          name: viewName,
          visibility: "PRIVATE",
          filters: { version: 2, view: "all", stateIds: [state.id] },
          position: 0,
        },
      });

      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(state.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_DELETE }).click();
      await page.getByRole("dialog").getByRole("button", { name: DELETE_STATUS_BUTTON }).click();
      await expect(page.getByText(deletedToast(state.name))).toBeVisible();

      await gotoReady(page, "/tickets");
      await page
        .getByRole("list", { name: "Private" })
        .getByRole("link", { name: viewName })
        .click();
      await expect(page.getByText(stripMissingSentence({ state: true }))).toBeVisible();
    });

    // Review UI-WR-c1: an unavailable menu item stays focusable (aria-disabled) and reads its
    // reason once, as its description, not as part of its name.
    test("unavailable menu items are reachable by keyboard and read their reason once", async ({
      page,
    }) => {
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(MIGRATED.CLOSED.name) }).focus();
      await page.keyboard.press("Enter");
      const remove = page.getByRole("menuitem", { name: ROW_MENU_DELETE, exact: true });
      await page.keyboard.press("End");
      await expect(remove).toBeFocused();
      await expect(remove).toHaveAttribute("aria-disabled", "true");
      await expect(remove).toHaveAccessibleDescription(
        deleteUnavailableLastInGroup(GROUP_LABELS.CLOSED),
      );
      // Choosing it does nothing: no dialog, and the menu stays open on the item.
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(remove).toBeFocused();

      const setDefault = page.getByRole("menuitem", { name: ROW_MENU_SET_DEFAULT, exact: true });
      await page.keyboard.press("ArrowUp");
      await expect(setDefault).toBeFocused();
      await expect(setDefault).toHaveAttribute("aria-disabled", "true");
      await expect(setDefault).toHaveAccessibleDescription(DEFAULT_UNAVAILABLE_NOT_OPEN);
      await page.keyboard.press("Escape");
    });

    // Review UI-WR-c4: a second "Use for new tickets" while the first is pending is ignored.
    test("Use for new tickets ignores a second request while the first is pending", async ({
      page,
    }) => {
      const first = await insertState("OPEN", "Default race A");
      const second = await insertState("OPEN", "Default race B");
      await gotoReady(page, "/settings/statuses");
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let actionPosts = 0;
      await page.route(
        (url) => url.pathname === "/settings/statuses",
        async (route) => {
          const request = route.request();
          if (request.method() !== "POST" || !request.headers()["next-action"]) {
            return route.fallback();
          }
          actionPosts++;
          await gate;
          return route.fallback();
        },
      );

      await page.getByRole("button", { name: rowOptionsAriaLabel(first.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_SET_DEFAULT, exact: true }).click();
      await expect.poll(() => actionPosts).toBe(1);
      await page.getByRole("button", { name: rowOptionsAriaLabel(second.name) }).click();
      const item = page.getByRole("menuitem", { name: ROW_MENU_SET_DEFAULT, exact: true });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await item.click({ force: true });
      release();
      await expect(page.getByText(defaultToast(first.name))).toBeVisible();
      await expect(page.getByText(defaultToast(second.name))).toHaveCount(0);
      expect(actionPosts).toBe(1);
      const config = await prisma.ticketStateConfig.findUniqueOrThrow({
        where: { organizationId: orgId },
      });
      expect(config.newStateId).toBe(first.id);
      await page.unrouteAll({ behavior: "wait" });
    });

    // Review UI-WR-c5: after REPLACEMENT_INVALID the refused replacement is no longer offered.
    test("a replacement refused as invalid is no longer offered", async ({ page }) => {
      const target = await insertState("PENDING", "Delete refused");
      const gone = await insertState("PENDING", "Replacement gone");
      const ticket = await seedTicket("replacement-gone");
      await prisma.ticket.update({ where: { id: ticket.id }, data: { stateId: target.id } });
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(target.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_DELETE, exact: true }).click();
      const dialog = page.getByRole("dialog");
      // Deleted where only the server sees it.
      await prisma.ticketState.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      const select = dialog.getByLabel(REPLACEMENT_LABEL);
      await select.click();
      await page.getByRole("option", { name: gone.name, exact: true }).click();
      await dialog.getByRole("button", { name: MOVE_AND_DELETE_BUTTON }).click();
      await expect(dialog.getByRole("alert")).toContainText(DELETE_ERROR_REPLACEMENT_INVALID);
      await expect(select).toBeFocused();
      await select.click();
      await expect(
        page.getByRole("option", { name: MIGRATED.PENDING.name, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("option", { name: gone.name, exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await dialog.getByRole("button", { name: KEEP_STATUS }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    // Review UI-IN-c1: case C (roles only) shows its own destructive button.
    test("a status that only holds a role offers Replace and delete", async ({ page }) => {
      const state = await insertState("CLOSED", "Role only");
      await prisma.ticketStateConfig.update({
        where: { organizationId: orgId },
        data: { mergeCloseStateId: state.id },
      });
      await gotoReady(page, "/settings/statuses");
      await page.getByRole("button", { name: rowOptionsAriaLabel(state.name) }).click();
      await page.getByRole("menuitem", { name: ROW_MENU_DELETE, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: REPLACE_AND_DELETE_BUTTON })).toBeDisabled();
      await dialog.getByRole("button", { name: KEEP_STATUS }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await prisma.ticketStateConfig.update({
        where: { organizationId: orgId },
        data: { mergeCloseStateId: await migratedId("CLOSED") },
      });
    });

    // Review UI-WR-c3: unchecking the last deleted status keeps focus on a live item.
    test("unchecking a deleted status in the Status filter keeps focus on a live item", async ({
      page,
    }) => {
      const live = await migratedId("OPEN");
      const state = await insertState("OPEN", "Uncheck gone");
      await prisma.ticketState.update({ where: { id: state.id }, data: { deletedAt: new Date() } });
      await gotoReady(page, `/tickets?state=${[live, state.id].sort().join(",")}`);
      await page.locator("#inbox-status-filter-trigger").focus();
      await page.keyboard.press("Enter");
      const missing = page.getByRole("menuitemcheckbox", { name: MISSING_STATUS_ITEM });
      await page.keyboard.press("End");
      await expect(missing).toBeFocused();
      await page.keyboard.press("Space");
      await expect(page).not.toHaveURL(new RegExp(state.id));
      await expect(missing).toHaveCount(0);
      await expect(page.getByRole("menuitemcheckbox").last()).toBeFocused();
      await page.keyboard.press("Escape");
    });

    // Review UI-WR-c2: the status menu scrolls; opened by s, its current value is scrolled into
    // view. Runs last: the filler states lengthen every later status list.
    test("the status menu opened by s shows its focused current value", async ({ page }) => {
      for (let i = 0; i < 14; i++) await insertState("OPEN", `Scroll filler ${i}`);
      const ticket = await seedTicket("scroll-current");
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { stateId: await migratedId("CLOSED") },
      });
      await gotoReady(page, `/tickets/${ticket.id}`);
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await expect(async () => {
        if (!(await palette.isVisible())) await page.keyboard.press("Meta+k");
        await expect(palette).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      });
      await page.keyboard.press("s");
      const current = page.getByRole("menuitemradio", { name: MIGRATED.CLOSED.name, exact: true });
      await expect(current).toBeFocused();
      await expect(current).toHaveAttribute("aria-checked", "true");
      await expect(current).toBeInViewport();
      await page.keyboard.press("Escape");
    });
  });
