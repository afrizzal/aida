// Phase 12.1, plan 12.1-16: custom ticket states in the browser (AIDA-97, AIDA-56, AIDA-57).
// Every admin action on /settings/statuses, the top-bar picker with the paused SLA chip (D-18),
// the bulk picker, the public group label (D-13) and the missing-state paths (D-09). Expected
// strings come from the copy modules (state-copy.ts, activity-copy.ts), never re-typed. The
// describe's afterAll puts the five migrated states and every config role back before it removes
// fixtures, so later specs see the defaults.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  addStatusAriaLabel,
  CREATE_STATUS_CTA,
  createdToast,
  GROUP_LABELS,
  NAME_LABEL,
  pausedChipLabel,
  SLA_PAUSED_CHIP,
  STATUS_MENU_TRIGGER_LABEL,
  type StateGroupKey,
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
  return createTicket(orgId, {
    subject: `E2E Statuses ${label} ${ts}`,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email },
    direction: "INBOUND",
  });
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
  });
