/**
 * AIDA-36 (D-14, 09-UI-SPEC Surface 5): every rendered app route state has exactly one <h1>,
 * owned by the page inside <main>. The top-bar title is a <p>, never a heading.
 *
 * Every assertion here runs against a page rendered in the browser; nothing reads source files.
 *
 * Own organization (the kb-proposals.spec.ts pattern): the file seeds an organization of its own
 * with an owner, a plain member and a member whose row is deleted after sign-in, plus a user with
 * no membership at all, all signed in through the real login page. The empty states are rendered
 * before that organization has any content; then one ticket (with its contact), one article and
 * one draft proposal are seeded and every route is rendered again. The shared E2E organization is
 * only read (the first case), so later files see it unchanged.
 *
 * A member whose row was deleted and a user with no membership at all are redirected to /no-access
 * from every route they open (Phase 10, V-27: requirePageAccess runs first in the (app) layout and
 * in every page); that page is under (auth), has no <main>, and owns the document's one <h1>.
 *
 * Error and loading states are rendered through the E2E fault hook (src/lib/testing/e2e-fault.ts),
 * which acts only on the E2E dev server (global-setup.ts sets its flag) and only for a request that
 * carries the `aida-e2e-fault` cookie naming a fault point: a page point makes the page throw, so
 * the route's error.tsx renders; the list delay point holds TicketListPanel, so the /tickets
 * Suspense fallback is visible for a few seconds.
 *
 * APP_PAGE_ROUTES is the page list of src/app/(app) (`git ls-files 'src/app/(app)/**\/page.tsx'`
 * at the time of writing). The last case fails when a listed route was not rendered by any case.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  NOT_ALLOWED_HEADING,
  NOT_FOUND_HEADING,
  PROPOSALS_PAGE_TITLE,
  REVIEW_PAGE_TITLE,
} from "../../src/lib/kb/proposal-copy";
import type { E2EFaultPoint } from "../../src/lib/testing/e2e-fault";
import { STATUS_PAGE_TITLE } from "../../src/lib/tickets/state-copy";
import { prisma } from "./support/db";
import { baseURL } from "./support/test-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, ".auth");
const ADMIN_STORAGE = path.join(AUTH_DIR, "admin.json");
const OWNER_STORAGE = path.join(AUTH_DIR, "single-h1-owner.json");
const MEMBER_STORAGE = path.join(AUTH_DIR, "single-h1-member.json");
const ENDED_STORAGE = path.join(AUTH_DIR, "single-h1-ended.json");
const NO_WORKSPACE_STORAGE = path.join(AUTH_DIR, "single-h1-no-workspace.json");

const OWN_PASSWORD = "E2E-single-h1-password-1!";
/** The fault hook's cookie (E2E_FAULT_COOKIE); a literal here so this file never loads next/headers. */
const FAULT_COOKIE = "aida-e2e-fault";
/** The one h1 of /no-access (src/app/(auth)/no-access/page.tsx, UI-SPEC Surface 6). */
const NO_ACCESS_HEADING = "You don't have access to this workspace";

/** The page routes of src/app/(app); every one must be rendered by at least one case below. */
const APP_PAGE_ROUTES = [
  "/tickets",
  "/tickets/[id]",
  "/contacts",
  "/contacts/[id]",
  "/kb",
  "/kb/new",
  "/kb/[id]",
  "/kb/proposals",
  "/kb/proposals/[id]",
  "/insights",
  "/settings",
  "/settings/backups",
  "/settings/branding",
  "/settings/custom-fields",
  "/settings/email",
  "/settings/notifications",
  "/settings/sla",
  "/settings/statuses",
  "/settings/tags",
  "/settings/team",
] as const;
type AppPageRoute = (typeof APP_PAGE_ROUTES)[number];

/** Every route state rendered and asserted in this file, by route pattern. */
const rendered = new Map<AppPageRoute, string[]>();

interface Row {
  route: AppPageRoute;
  state: string;
  url: string;
  h1: string | RegExp;
}

let orgId: string;
let ownerId: string;
let memberId: string;
let endedUserId: string;
let endedMemberRow: { id: string; organizationId: string; userId: string; role: string };
let noWorkspaceUserId: string;

function fixtures() {
  return import("../support/kb-proposal-fixtures");
}

/** First-hit compile-race guard: next dev can answer 404 before a route's first compile. */
async function gotoWarm(page: Page, urlPath: string): Promise<void> {
  await expect
    .poll(
      async () => (await page.goto(urlPath, { waitUntil: "load", timeout: 45_000 }))?.status() ?? 0,
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe(404);
}

/**
 * The AIDA-36 assertion on the page as it is rendered now: exactly one h1 in the document (zero
 * and two both fail), that h1 is inside main, its text matches when given, and it is the first
 * heading inside main in DOM order.
 */
async function expectSingleH1(page: Page, text?: string | RegExp): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  const mainH1 = page.locator("main h1");
  await expect(mainH1).toHaveCount(1);
  if (text !== undefined) await expect(mainH1).toHaveText(text);
  const firstHeadingTag = await page
    .locator("main")
    .locator("h1, h2, h3, h4, h5, h6")
    .first()
    .evaluate((element) => element.tagName);
  expect(firstHeadingTag).toBe("H1");
}

/** Warms the route, then asserts the single h1 on the rendered page. */
async function expectRouteSingleH1(page: Page, url: string, text?: string | RegExp) {
  await gotoWarm(page, url);
  await expectSingleH1(page, text);
}

/**
 * Opens `url` and asserts the redirect to /no-access (V-27): the final URL is /no-access, the
 * document has exactly one h1, it is the no-access title, and it is the first heading in DOM order.
 * /no-access is an (auth) page, so there is no <main> to look inside.
 */
async function expectNoAccess(page: Page, url: string): Promise<void> {
  await gotoWarm(page, url);
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText(NO_ACCESS_HEADING);
  const firstHeadingTag = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .first()
    .evaluate((element) => element.tagName);
  expect(firstHeadingTag).toBe("H1");
}

/** Opens each route in turn, expects /no-access, and records it against its route pattern. */
async function expectNoAccessRows(
  page: Page,
  state: string,
  rows: readonly { route: AppPageRoute; url: string }[],
): Promise<void> {
  for (const row of rows) {
    await test.step(`${state}: ${row.url} -> /no-access`, async () => {
      await expectNoAccess(page, row.url);
    });
    rendered.set(row.route, [...(rendered.get(row.route) ?? []), state]);
  }
}

/** Renders each row in turn and records it against its route pattern. */
async function expectRows(page: Page, rows: readonly Row[]): Promise<void> {
  for (const row of rows) {
    await test.step(`${row.state}: ${row.url}`, async () => {
      await expectRouteSingleH1(page, row.url, row.h1);
    });
    rendered.set(row.route, [...(rendered.get(row.route) ?? []), row.state]);
  }
}

async function setPassword(userId: string): Promise<void> {
  const { hashPassword } = await import("better-auth/crypto");
  const now = new Date();
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(OWN_PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * Signs a user in through the real login page and saves the session to storagePath. The login form
 * sends the user to /tickets; a user with no membership lands on /no-access instead (V-27).
 */
async function signIn(
  browser: Browser,
  userId: string,
  storagePath: string,
  landing: RegExp = /\/tickets/,
): Promise<void> {
  const { email } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  // A fresh context with no cookies, never the shared admin storage state.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await gotoWarm(page, "/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(OWN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(landing, { timeout: 60_000 });
  await context.storageState({ path: storagePath });
  await context.close();
}

test.describe("AIDA-36 single h1: shared organization", () => {
  test.use({ storageState: ADMIN_STORAGE });

  test("/tickets: one sr-only h1 'Tickets' inside main, the top bar title is not a heading", async ({
    page,
  }) => {
    await expectRouteSingleH1(page, "/tickets", "Tickets");
    // The top bar still shows the same words, as text.
    await expect(page.locator("header p", { hasText: "Tickets" })).toHaveCount(1);
  });
});

test.describe
  .serial("AIDA-36 single h1: every app route state", () => {
    let ticket: { id: string; subject: string; contactId: string; contactEmail: string };
    let articleId: string;
    let articleTitle: string;
    let proposalId: string;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(180_000);
      const { seedOrgWithMembers } = await fixtures();
      const seeded = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
      orgId = seeded.orgId;
      const [owner, member, ended] = seeded.users;
      ownerId = owner.id;
      memberId = member.id;
      endedUserId = ended.id;

      // A user with an email-and-password credential and no member row at all.
      noWorkspaceUserId = randomUUID();
      const now = new Date();
      await prisma.user.create({
        data: {
          id: noWorkspaceUserId,
          name: "Fixture no workspace",
          email: `fx-${noWorkspaceUserId}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      for (const id of [ownerId, memberId, endedUserId, noWorkspaceUserId]) await setPassword(id);
      await signIn(browser, ownerId, OWNER_STORAGE);
      await signIn(browser, memberId, MEMBER_STORAGE);
      await signIn(browser, endedUserId, ENDED_STORAGE);
      await signIn(browser, noWorkspaceUserId, NO_WORKSPACE_STORAGE, /\/no-access$/);

      // The ended member's row goes after sign-in, so its session keeps the active organization.
      endedMemberRow = await prisma.member.findFirstOrThrow({
        where: { organizationId: orgId, userId: endedUserId },
        select: { id: true, organizationId: true, userId: true, role: true },
      });
      await prisma.member.delete({ where: { id: endedMemberRow.id } });
    });

    test("empty states, before the organization has any content", async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ storageState: OWNER_STORAGE });
      const page = await context.newPage();
      await expectRows(page, [
        { route: "/tickets", state: "empty inbox", url: "/tickets", h1: "Tickets" },
        { route: "/contacts", state: "empty list", url: "/contacts", h1: "Contacts" },
        { route: "/kb", state: "empty list", url: "/kb", h1: "Knowledge Base" },
        {
          route: "/kb/proposals",
          state: "empty list",
          url: "/kb/proposals",
          h1: PROPOSALS_PAGE_TITLE,
        },
        { route: "/insights", state: "not generated yet", url: "/insights", h1: "AIDA Insight" },
      ]);
      // The empty inbox heading stays an h2 after the page's h1 (the ordering is asserted above).
      await gotoWarm(page, "/tickets");
      await expect(
        page.getByRole("main").getByRole("heading", { level: 2, name: "Your inbox is empty" }),
      ).toHaveCount(1);
      await context.close();
    });

    test("normal, search-with-no-match and not-found states (owner)", async ({ browser }) => {
      test.setTimeout(300_000);
      const { seedTicket, seedProposal } = await fixtures();
      const seededTicket = await seedTicket(orgId);
      const row = await prisma.ticket.findUniqueOrThrow({
        where: { id: seededTicket.id },
        select: { subject: true, contact: { select: { id: true, email: true } } },
      });
      ticket = {
        id: seededTicket.id,
        subject: row.subject,
        contactId: row.contact.id,
        contactEmail: row.contact.email,
      };
      const tag = randomUUID();
      articleTitle = `Single h1 article ${tag.slice(0, 8)}`;
      const article = await prisma.kbArticle.create({
        data: {
          organizationId: orgId,
          title: articleTitle,
          slug: `single-h1-${tag}`,
          bodyMarkdown: "Single h1 fixture body",
          bodyHtml: "<p>Single h1 fixture body</p>",
        },
        select: { id: true },
      });
      articleId = article.id;
      const proposal = await seedProposal(orgId, {
        status: "DRAFT",
        ticketIds: [ticket.id],
        requestedByUserId: ownerId,
      });
      proposalId = proposal.id;

      const missing = randomUUID();
      const noMatch = `nomatch${tag.replaceAll("-", "")}`;

      const context = await browser.newContext({ storageState: OWNER_STORAGE });
      const page = await context.newPage();
      await expectRows(page, [
        { route: "/tickets", state: "list", url: "/tickets", h1: "Tickets" },
        {
          route: "/tickets",
          state: "search with no match",
          url: `/tickets?q=${noMatch}`,
          h1: "Tickets",
        },
        {
          route: "/tickets/[id]",
          state: "found",
          url: `/tickets/${ticket.id}`,
          h1: ticket.subject,
        },
        {
          route: "/tickets/[id]",
          state: "not found",
          url: `/tickets/${missing}`,
          h1: "Ticket not found",
        },
        { route: "/contacts", state: "list", url: "/contacts", h1: "Contacts" },
        {
          route: "/contacts",
          state: "search with no match",
          url: `/contacts?q=${noMatch}`,
          h1: "Contacts",
        },
        {
          route: "/contacts/[id]",
          state: "found",
          url: `/contacts/${ticket.contactId}`,
          h1: ticket.contactEmail,
        },
        {
          route: "/contacts/[id]",
          state: "not found",
          url: `/contacts/${missing}`,
          h1: "Contact not found",
        },
        { route: "/kb", state: "list", url: "/kb", h1: "Knowledge Base" },
        { route: "/kb/new", state: "form", url: "/kb/new", h1: "New article" },
        { route: "/kb/[id]", state: "found", url: `/kb/${articleId}`, h1: articleTitle },
        { route: "/kb/[id]", state: "not found", url: `/kb/${missing}`, h1: "Article not found" },
        { route: "/kb/proposals", state: "list", url: "/kb/proposals", h1: PROPOSALS_PAGE_TITLE },
        {
          route: "/kb/proposals/[id]",
          state: "draft",
          url: `/kb/proposals/${proposalId}`,
          h1: REVIEW_PAGE_TITLE,
        },
        {
          route: "/kb/proposals/[id]",
          state: "not found",
          url: `/kb/proposals/${missing}`,
          h1: NOT_FOUND_HEADING,
        },
        { route: "/insights", state: "page", url: "/insights", h1: "AIDA Insight" },
        { route: "/settings", state: "AI features", url: "/settings", h1: "AI Features" },
        { route: "/settings/branding", state: "page", url: "/settings/branding", h1: "Branding" },
        { route: "/settings/sla", state: "page", url: "/settings/sla", h1: "SLA Policies" },
        {
          route: "/settings/statuses",
          state: "page",
          url: "/settings/statuses",
          h1: STATUS_PAGE_TITLE,
        },
        { route: "/settings/tags", state: "page", url: "/settings/tags", h1: "Tags" },
        {
          route: "/settings/custom-fields",
          state: "page",
          url: "/settings/custom-fields",
          h1: "Custom Fields",
        },
        { route: "/settings/email", state: "page", url: "/settings/email", h1: "Email" },
        { route: "/settings/backups", state: "page", url: "/settings/backups", h1: "Backups" },
        { route: "/settings/team", state: "page", url: "/settings/team", h1: "Team" },
        {
          route: "/settings/notifications",
          state: "page",
          url: "/settings/notifications",
          h1: "Notifications",
        },
      ]);

      // UI duplicate title: on /kb the top bar shows "Knowledge Base" and the page h1 is sr-only, so
      // the words are on screen once; the "New article" action is still in the page header row.
      await gotoWarm(page, "/kb");
      await expect(page.locator("main h1")).toHaveClass(/\bsr-only\b/);
      await expect(page.getByRole("main").getByRole("link", { name: "New article" })).toBeVisible();
      await context.close();
    });

    test("error states, rendered through the fault hook", async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ storageState: OWNER_STORAGE });
      const page = await context.newPage();
      const errorRows: readonly (Row & { point: E2EFaultPoint; copy: string })[] = [
        {
          route: "/tickets",
          state: "error",
          url: "/tickets",
          h1: "Tickets",
          point: "tickets-page",
          copy: "Couldn't load tickets.",
        },
        {
          route: "/tickets/[id]",
          state: "error",
          url: `/tickets/${ticket.id}`,
          h1: "Tickets",
          point: "ticket-detail-page",
          copy: "Couldn't load tickets.",
        },
        {
          route: "/contacts",
          state: "error",
          url: "/contacts",
          h1: "Contacts",
          point: "contacts-page",
          copy: "Couldn't load contacts.",
        },
        {
          // No error.tsx of its own: the error state is the inherited contacts/error.tsx.
          route: "/contacts/[id]",
          state: "error",
          url: `/contacts/${ticket.contactId}`,
          h1: "Contacts",
          point: "contact-detail-page",
          copy: "Couldn't load contacts.",
        },
        {
          // No error.tsx under /kb: the app-level src/app/(app)/error.tsx (K147, review c-WR-02).
          route: "/kb",
          state: "error (app-level boundary)",
          url: "/kb",
          h1: "Knowledge Base",
          point: "kb-page",
          copy: "Couldn't load this page.",
        },
        {
          // No error.tsx under /settings: the app-level boundary, inside the app shell.
          route: "/settings/backups",
          state: "error (app-level boundary)",
          url: "/settings/backups",
          h1: "Settings",
          point: "settings-backups-page",
          copy: "Couldn't load this page.",
        },
      ];
      for (const row of errorRows) {
        await test.step(`${row.state}: ${row.url}`, async () => {
          // Warm without the cookie, so a first-hit compile is not mistaken for the fault.
          await gotoWarm(page, row.url);
          await expect(page.getByText(row.copy)).toHaveCount(0);
          await context.addCookies([{ name: FAULT_COOKIE, value: row.point, url: baseURL }]);
          await page.goto(row.url);
          await expect(page.getByRole("main").getByText(row.copy)).toBeVisible();
          await expectSingleH1(page, row.h1);
          // The error state keeps the app shell: the sidebar and the top bar are still there.
          await expect(page.locator("header")).toHaveCount(1);
          await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
          await context.clearCookies({ name: FAULT_COOKIE });
        });
        rendered.set(row.route, [...(rendered.get(row.route) ?? []), row.state]);
      }
      // With the cookie cleared the route renders normally again.
      await gotoWarm(page, "/tickets");
      await expect(page.getByText("Couldn't load tickets.")).toHaveCount(0);
      await context.close();
    });

    test("loading state: the /tickets Suspense fallback, rendered through the fault hook", async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ storageState: OWNER_STORAGE });
      const page = await context.newPage();
      await gotoWarm(page, "/tickets");
      await context.addCookies([
        { name: FAULT_COOKIE, value: "tickets-list-delay" satisfies E2EFaultPoint, url: baseURL },
      ]);
      const skeleton = page.locator('main [data-slot="skeleton"]').first();
      const listPanel = page.locator("main #ticket-list-panel");

      await page.goto("/tickets", { waitUntil: "commit" });
      await expect(skeleton).toBeVisible();
      await expect(listPanel).toHaveCount(0);
      await expectSingleH1(page, "Tickets");
      // Still the fallback after the assertion: the h1 was counted while the skeleton was showing.
      await expect(listPanel).toHaveCount(0);
      await expect(skeleton).toBeVisible();

      // The held panel streams in after the delay; the page still has its one h1.
      await expect(listPanel).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('main [data-slot="skeleton"]')).toHaveCount(0);
      await expect(listPanel.getByText(ticket.subject)).toBeVisible();
      await expectSingleH1(page, "Tickets");
      await context.clearCookies({ name: FAULT_COOKIE });
      rendered.set("/tickets", [...(rendered.get("/tickets") ?? []), "loading"]);
      await context.close();
    });

    test("a plain member: the owner-only proposal pages", async ({ browser }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ storageState: MEMBER_STORAGE });
      const page = await context.newPage();
      await expectRows(page, [
        {
          route: "/kb/proposals",
          state: "not allowed (member)",
          url: "/kb/proposals",
          h1: NOT_ALLOWED_HEADING,
        },
        {
          route: "/kb/proposals/[id]",
          state: "not allowed (member)",
          url: `/kb/proposals/${proposalId}`,
          h1: NOT_ALLOWED_HEADING,
        },
        {
          route: "/settings/backups",
          state: "admins only (member)",
          url: "/settings/backups",
          h1: "Backups",
        },
        {
          route: "/settings/statuses",
          state: "read only (member)",
          url: "/settings/statuses",
          h1: STATUS_PAGE_TITLE,
        },
        {
          route: "/settings/team",
          state: "read only (member)",
          url: "/settings/team",
          h1: "Team",
        },
        {
          route: "/settings/notifications",
          state: "own preferences (member)",
          url: "/settings/notifications",
          h1: "Notifications",
        },
      ]);
      await context.close();
    });

    test("a member whose row was deleted: every route redirects to /no-access", async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      // The session still names the organization; the member row is gone (beforeAll).
      await expect(
        prisma.member.count({ where: { organizationId: orgId, userId: endedUserId } }),
      ).resolves.toBe(0);
      const context = await browser.newContext({ storageState: ENDED_STORAGE });
      const page = await context.newPage();
      await expectNoAccessRows(page, "no access (row deleted)", [
        { route: "/tickets", url: "/tickets" },
        { route: "/tickets/[id]", url: `/tickets/${ticket.id}` },
        { route: "/contacts", url: "/contacts" },
        { route: "/contacts/[id]", url: `/contacts/${ticket.contactId}` },
        { route: "/kb", url: "/kb" },
        { route: "/kb/new", url: "/kb/new" },
        { route: "/kb/[id]", url: `/kb/${articleId}` },
        { route: "/kb/proposals", url: "/kb/proposals" },
        { route: "/kb/proposals/[id]", url: `/kb/proposals/${proposalId}` },
        { route: "/insights", url: "/insights" },
        { route: "/settings", url: "/settings" },
        { route: "/settings/backups", url: "/settings/backups" },
        { route: "/settings/branding", url: "/settings/branding" },
        { route: "/settings/custom-fields", url: "/settings/custom-fields" },
        { route: "/settings/email", url: "/settings/email" },
        { route: "/settings/sla", url: "/settings/sla" },
        { route: "/settings/statuses", url: "/settings/statuses" },
        { route: "/settings/tags", url: "/settings/tags" },
        { route: "/settings/team", url: "/settings/team" },
        { route: "/settings/notifications", url: "/settings/notifications" },
      ]);
      await context.close();
    });

    test("a signed-in user with no workspace: redirected to /no-access", async ({ browser }) => {
      test.setTimeout(180_000);
      // The database holds no member row for this user.
      await expect(prisma.member.count({ where: { userId: noWorkspaceUserId } })).resolves.toBe(0);
      const context = await browser.newContext({ storageState: NO_WORKSPACE_STORAGE });
      const page = await context.newPage();
      await expectNoAccessRows(page, "no access (no workspace)", [
        { route: "/tickets", url: "/tickets" },
        { route: "/tickets/[id]", url: `/tickets/${ticket.id}` },
        { route: "/contacts", url: "/contacts" },
        { route: "/kb/new", url: "/kb/new" },
        { route: "/settings", url: "/settings" },
        { route: "/settings/backups", url: "/settings/backups" },
      ]);
      // The old app-shell fallback is gone.
      await expect(page.getByText("No workspace found.")).toHaveCount(0);
      await context.close();
    });

    test("every app page route was rendered by a case above", () => {
      const missing = APP_PAGE_ROUTES.filter((route) => !rendered.has(route));
      expect(missing).toEqual([]);
    });

    test.afterAll(async () => {
      // Puts the ended member's row back, so the fixture organization is whole again.
      if (endedMemberRow) {
        await prisma.member.upsert({
          where: { id: endedMemberRow.id },
          create: { ...endedMemberRow, createdAt: new Date() },
          update: {},
        });
      }
    });
  });
