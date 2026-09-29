// Phase 11, plan 11-04: the auto-close card on the SLA page (UI-SPEC Surface 6) and the daily job
// run against fixture tickets (AIDA-51, D-15 to D-19, D-23). The E2E server runs without the
// worker, so the spec calls autoCloseHandler directly against the same database.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { autoCloseHandler, createTicket, orgId, prisma, stateIdFor } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const DAYS_KEY = "autoCloseResolvedAfterDays";
const ENABLED_AT_KEY = "autoCloseEnabledAt";
const DAY = 24 * 60 * 60 * 1000;
const ts = Date.now();

async function clearAutoClose() {
  await prisma.setting.deleteMany({
    where: { organizationId: orgId, key: { in: [DAYS_KEY, ENABLED_AT_KEY] } },
  });
}

async function seedResolved(label: string, resolvedDaysAgo: number) {
  const ticket = await createTicket(orgId, {
    subject: `E2E Auto-close ${label} ${ts}`,
    priority: "NORMAL",
    body: `Seed body for ${label}`,
    contact: { email: `auto-close-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      stateId: await stateIdFor("RESOLVED"),
      resolvedAt: new Date(Date.now() - resolvedDaysAgo * DAY),
    },
  });
  return ticket.id;
}

function autoClosedRows(ticketId: string) {
  return prisma.ticketAuditEvent.findMany({ where: { ticketId, action: "AUTO_CLOSED" } });
}

test.describe
  .serial("Auto-close resolved tickets", () => {
    test.beforeAll(clearAutoClose);
    test.afterAll(clearAutoClose);

    test("an admin turns auto-close on from the SLA page", async ({ page }) => {
      await page.goto("/settings/sla");
      await expect(
        page.getByRole("heading", { name: "Auto-close resolved tickets" }),
      ).toBeVisible();
      await expect(page.getByText("Auto-close is off.")).toBeVisible();
      await expect(page.getByText("do not restart it.")).toBeVisible();

      const field = page.getByLabel("Close after (days)");
      await expect(field).toHaveValue("0");
      await field.fill("7");
      await page.getByRole("button", { name: "Save auto-close setting" }).click();

      await expect(page.getByText("Auto-close set to 7 days.")).toBeVisible();
      await expect(
        page.getByText("Auto-close is on: resolved tickets close after 7 days."),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const row = await prisma.setting.findFirst({
            where: { organizationId: orgId, key: DAYS_KEY },
          });
          return row?.value ?? null;
        })
        .toBe("7");
    });

    test("a member sees the card read-only", async ({ browser }) => {
      const context = await browser.newContext({
        storageState: path.resolve(__dirname, ".auth/member.json"),
      });
      try {
        const page = await context.newPage();
        await page.goto("/settings/sla");
        await expect(
          page.getByText("Auto-close is on: resolved tickets close after 7 days."),
        ).toBeVisible();
        await expect(page.getByLabel("Close after (days)")).toBeDisabled();
        await expect(
          page.getByText("Only workspace owners and admins can change this."),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Save auto-close setting" })).toHaveCount(0);
      } finally {
        await context.close();
      }
    });

    test("the daily job closes the quiet fixture ticket once and leaves the recent one", async ({
      page,
    }) => {
      // Simulate time passing since auto-close was enabled.
      await prisma.setting.update({
        where: { organizationId_key: { organizationId: orgId, key: ENABLED_AT_KEY } },
        data: { value: new Date(Date.now() - 30 * DAY).toISOString() },
      });
      const ticketA = await seedResolved("a", 10);
      const ticketB = await seedResolved("b", 2);

      await autoCloseHandler(undefined, { log: () => {} });

      await page.goto(`/tickets/${ticketA}`);
      await expect
        .poll(async () => {
          const status = page.getByRole("button", { name: "Change status" });
          return (await status.count()) > 0 ? status.textContent() : null;
        })
        .toContain("Closed");

      const rows = await autoClosedRows(ticketA);
      expect(rows).toHaveLength(1);
      expect(rows[0].actorType).toBe("SYSTEM");
      expect(rows[0].actorUserId).toBeNull();
      const a = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketA } });
      expect(a.stateId).toBe(await stateIdFor("CLOSED"));
      const b = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketB } });
      expect(b.stateId).toBe(await stateIdFor("RESOLVED"));

      await autoCloseHandler(undefined, { log: () => {} });
      expect(await autoClosedRows(ticketA)).toHaveLength(1);
    });

    test("an admin turns auto-close off again", async ({ page }) => {
      await page.goto("/settings/sla");
      const field = page.getByLabel("Close after (days)");
      await expect(field).toHaveValue("7");
      await field.fill("0");
      await page.getByRole("button", { name: "Save auto-close setting" }).click();

      await expect(page.getByText("Auto-close turned off.")).toBeVisible();
      await expect(page.getByText("Auto-close is off.")).toBeVisible();
    });
  });
