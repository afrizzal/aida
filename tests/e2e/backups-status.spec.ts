/**
 * Settings -> Backups through the real UI (Phase 9 plan 09-08, AIDA-33, D-04, UI-SPEC Surface 4).
 *
 * Each test writes the instance-wide `backup:lastRun` SystemSetting directly through the E2E
 * database helper, in exactly the four-key shape scripts/backup/lib.sh records, then reads the page
 * as an admin or a member. Covered: no record, a succeeded run, a failed run with a known category,
 * a failed run with an unknown category, a failed run that published no set, a malformed record,
 * and the member view. Every state asserts that no stored value other than the set id reaches the
 * page. A colour-contrast scan (axe, WCAG AA) runs on the succeeded and failed cards in both
 * themes; the visual and dark-mode review itself stays a manual item.
 *
 * Shared state: the record is instance-wide, so afterAll removes it and later spec files see none.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { prisma } from "./support/db";
import { expect, requireBrowser, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");
const MEMBER_STORAGE = path.resolve(__dirname, ".auth/member.json");

const KEY = "backup:lastRun";
const ROUTE = "/settings/backups";
const SET_ID = "20261112T020001Z-a1b2c3";
// A raw marker that must never be rendered: a category the UI does not know.
const RAW_CATEGORY = "aidae2erawcategorymarker";
const MALFORMED_MARKER = "aidae2emalformedmarker";

const COPY = {
  subtitle:
    "AIDA backs up its database and uploaded files on this server on a schedule. This page shows the most recent run. The schedule, retention and the off switch are server settings described in docs/OPERATIONS.md.",
  adminOnly: "Only workspace admins can see backup status.",
  emptyHeading: "No backup has run yet",
  emptyBody:
    "The first backup runs at its next scheduled time. If backups are turned off on this server, nothing appears here.",
  nextStep:
    "Check the backup service logs with docker compose logs backup. The next scheduled run tries again on its own.",
  dump: "The database dump failed.",
  unknown: "The run stopped with an unexpected error.",
  unreadable: "Backup status could not be read. Check the backup service logs.",
  noSet: "None — this run did not publish a set",
};

test.use({ storageState: ADMIN_STORAGE });

/** A finishedAt two hours ago, in the exact form lib.sh writes (UTC, milliseconds). */
function twoHoursAgo(): string {
  const date = new Date(Date.now() - 2 * 3600 * 1000);
  date.setUTCSeconds(41, 123);
  return date.toISOString();
}

async function setRecord(value: string | null): Promise<void> {
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key: KEY } });
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    update: { value },
    create: { key: KEY, value },
  });
}

const record = (fields: {
  finishedAt: string;
  result: string;
  setId: string | null;
  category: string | null;
}) => JSON.stringify(fields);

/** First hit of the route may be the router compiling (404): poll until it answers 200. */
async function open(page: Page): Promise<Locator> {
  await expect
    .poll(async () => (await page.goto(ROUTE, { waitUntil: "domcontentloaded" }))?.status() ?? 0, {
      timeout: 60_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(200);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Backups" })).toBeVisible();
  await expect(main.getByText(COPY.subtitle, { exact: true })).toBeVisible();
  return main;
}

/** The dd that follows a dt with this label in the "Last backup" card. */
function row(card: Locator, label: string): Locator {
  return card.locator(`dt:text-is("${label}") + dd`);
}

async function expectNoAction(main: Locator): Promise<void> {
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.locator("form")).toHaveCount(0);
  await expect(main.locator("input, select, textarea")).toHaveCount(0);
}

test.afterAll(async () => {
  await setRecord(null);
});

test.describe("Settings -> Backups (D-04, Surface 4)", () => {
  // Phase 10 (V-19, UI-SPEC amendment A2) appends Team and Notifications after Backups, so Backups
  // is no longer the last tab: the full order is pinned instead, and Backups is the active one.
  test("the Backups tab follows Email, precedes Team, and is active on its page", async ({
    page,
  }) => {
    await setRecord(null);
    await open(page);
    const tabs = page.getByRole("main").getByRole("navigation").getByRole("link");
    await expect(tabs).toHaveText([
      "AI Features",
      "Branding",
      "SLA Policies",
      "Statuses",
      "Tags",
      "Custom Fields",
      "Email",
      "Backups",
      "Team",
      "Notifications",
    ]);
    const backups = tabs.filter({ hasText: /^Backups$/ });
    await expect(backups).toHaveAttribute("href", ROUTE);
    await expect(backups).toHaveClass(/bg-primary\/10/);
  });

  test("none: no record shows the empty state and nothing else", async ({ page }) => {
    await setRecord(null);
    const main = await open(page);
    await expect(main.getByRole("heading", { level: 2, name: COPY.emptyHeading })).toBeVisible();
    await expect(main.getByText(COPY.emptyBody, { exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Last backup" })).toHaveCount(0);
    await expect(main.getByRole("status")).toHaveCount(0);
    await expect(main.locator("dl")).toHaveCount(0);
    await expectNoAction(main);
  });

  test("succeeded: the Last backup card with the badge, the times and the set id", async ({
    page,
  }) => {
    const finishedAt = twoHoursAgo();
    await setRecord(record({ finishedAt, result: "succeeded", setId: SET_ID, category: null }));
    const main = await open(page);
    const card = main.locator("[data-slot='card']");
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("heading", { level: 2, name: "Last backup" })).toBeVisible();

    const result = row(card, "Result");
    await expect(result).toHaveText("Succeeded");
    await expect(result.locator("[data-slot='badge']")).toHaveClass(/bg-success\/10/);
    await expect(result.locator("[data-slot='badge']")).toHaveClass(/text-success/);

    const finished = row(card, "Finished");
    const time = finished.locator("time");
    await expect(time).toHaveAttribute("datetime", finishedAt);
    await expect(time).toHaveText("2h ago");
    await expect(finished.locator("span.text-\\[12px\\]")).toHaveText(
      /·\s*\d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC/,
    );

    const set = row(card, "Backup set");
    await expect(set).toHaveText(SET_ID);
    await expect(set.locator(".font-mono")).toHaveText(SET_ID);

    await expect(card.locator("dt")).toHaveText(["Result", "Finished", "Backup set"]);
    await expect(main.getByRole("status")).toHaveCount(0);
    // Exactly one run: no history list.
    await expect(main.locator("dl")).toHaveCount(1);
    await expect(main.locator("ul, ol, table")).toHaveCount(0);
    await expectNoAction(main);
    // The ISO time stays in the attribute; the visible text shows only the formatted times.
    await expect(main).not.toContainText(finishedAt);
  });

  test("failed (known category): Failed badge, the dump sentence and the next-step callout", async ({
    page,
  }) => {
    const finishedAt = twoHoursAgo();
    await setRecord(record({ finishedAt, result: "failed", setId: null, category: "dump" }));
    const main = await open(page);
    const card = main.locator("[data-slot='card']");

    const result = row(card, "Result");
    await expect(result).toHaveText("Failed");
    await expect(result.locator("[data-slot='badge']")).toHaveClass(/bg-destructive\/10/);
    await expect(row(card, "Failure reason")).toHaveText(COPY.dump);
    await expect(card.locator("dt")).toHaveText([
      "Result",
      "Finished",
      "Backup set",
      "Failure reason",
    ]);

    const callout = main.getByRole("status");
    await expect(callout).toHaveCount(1);
    await expect(callout).toHaveText(COPY.nextStep);
    await expect(callout.locator("code")).toHaveText("docker compose logs backup");
    await expectNoAction(main);
  });

  test("failed (unknown category): the generic sentence, and the raw category never appears", async ({
    page,
  }) => {
    await setRecord(
      record({ finishedAt: twoHoursAgo(), result: "failed", setId: null, category: RAW_CATEGORY }),
    );
    const main = await open(page);
    const card = main.locator("[data-slot='card']");
    await expect(row(card, "Result")).toHaveText("Failed");
    await expect(row(card, "Failure reason")).toHaveText(COPY.unknown);
    await expect(main.getByRole("status")).toHaveText(COPY.nextStep);
    expect(await page.content()).not.toContain(RAW_CATEGORY);
  });

  test("partial: a failed run that published no set says so", async ({ page }) => {
    await setRecord(
      record({ finishedAt: twoHoursAgo(), result: "failed", setId: null, category: "storage" }),
    );
    const main = await open(page);
    const card = main.locator("[data-slot='card']");
    await expect(row(card, "Backup set")).toHaveText(COPY.noSet);
    await expect(row(card, "Backup set").locator(".font-mono")).toHaveCount(0);
  });

  test("unreadable: a malformed record shows only the unreadable callout", async ({ page }) => {
    await setRecord(
      JSON.stringify({
        finishedAt: twoHoursAgo(),
        result: "succeeded",
        setId: SET_ID,
        category: null,
        error: MALFORMED_MARKER,
      }),
    );
    const main = await open(page);
    const callout = main.getByRole("status");
    await expect(callout).toHaveCount(1);
    await expect(callout).toHaveText(COPY.unreadable);
    await expect(main.locator("[data-slot='card']")).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Last backup" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: COPY.emptyHeading })).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(MALFORMED_MARKER);
    expect(html).not.toContain(SET_ID);
    await expectNoAction(main);
  });

  test("unreadable: a value that is not JSON shows only the unreadable callout", async ({
    page,
  }) => {
    await setRecord(`not json ${MALFORMED_MARKER}`);
    const main = await open(page);
    await expect(main.getByRole("status")).toHaveText(COPY.unreadable);
    expect(await page.content()).not.toContain(MALFORMED_MARKER);
  });

  test("member: only the admin-only line, even when a record exists", async ({
    context,
    baseURL,
  }) => {
    await setRecord(
      record({ finishedAt: twoHoursAgo(), result: "failed", setId: SET_ID, category: "dump" }),
    );
    const memberContext = await requireBrowser(context).newContext({
      baseURL,
      storageState: MEMBER_STORAGE,
    });
    try {
      const memberPage = await memberContext.newPage();
      const main = await open(memberPage);
      await expect(main.getByText(COPY.adminOnly, { exact: true })).toBeVisible();
      await expect(main.locator("[data-slot='card']")).toHaveCount(0);
      await expect(main.getByRole("status")).toHaveCount(0);
      await expect(main.getByRole("heading", { name: COPY.emptyHeading })).toHaveCount(0);
      const html = await memberPage.content();
      expect(html).not.toContain(SET_ID);
      expect(html).not.toContain(COPY.dump);
      await expectNoAction(main);
    } finally {
      await memberContext.close();
    }
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`Settings -> Backups colour contrast (${theme})`, () => {
    test.use({ storageState: ADMIN_STORAGE, colorScheme: theme });

    async function scan(page: Page): Promise<void> {
      const results = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const contrast = results.violations.filter((v) => v.id === "color-contrast");
      expect(contrast, JSON.stringify(contrast, null, 2)).toEqual([]);
    }

    test(`succeeded card has no contrast violation (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await setRecord(
        record({ finishedAt: twoHoursAgo(), result: "succeeded", setId: SET_ID, category: null }),
      );
      await open(page);
      await scan(page);
    });

    test(`failed card and callout have no contrast violation (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await setRecord(
        record({
          finishedAt: twoHoursAgo(),
          result: "failed",
          setId: null,
          category: "verification",
        }),
      );
      await open(page);
      await scan(page);
    });
  });
}
