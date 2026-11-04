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
import { STATUS_PAGE_TITLE } from "../../src/lib/tickets/state-copy";
import { prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, ".auth");
const ADMIN_STORAGE = path.join(AUTH_DIR, "admin.json");
const OWNER_STORAGE = path.join(AUTH_DIR, "single-h1-owner.json");
const MEMBER_STORAGE = path.join(AUTH_DIR, "single-h1-member.json");
const ENDED_STORAGE = path.join(AUTH_DIR, "single-h1-ended.json");
const NO_WORKSPACE_STORAGE = path.join(AUTH_DIR, "single-h1-no-workspace.json");

const OWN_PASSWORD = "E2E-single-h1-password-1!";
const ACCESS_ENDED_HEADING = "Your access to this workspace has ended.";

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
  "/settings/sla",
  "/settings/statuses",
  "/settings/tags",
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

/** Signs a user in through the real login page and saves the session to storagePath. */
async function signIn(browser: Browser, userId: string, storagePath: string): Promise<void> {
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
  await page.waitForURL(/\/tickets/, { timeout: 60_000 });
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
      await signIn(browser, noWorkspaceUserId, NO_WORKSPACE_STORAGE);

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
      ]);

      // UI duplicate title: on /kb the top bar shows "Knowledge Base" and the page h1 is sr-only, so
      // the words are on screen once; the "New article" action is still in the page header row.
      await gotoWarm(page, "/kb");
      await expect(page.locator("main h1")).toHaveClass(/\bsr-only\b/);
      await expect(page.getByRole("main").getByRole("link", { name: "New article" })).toBeVisible();
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
      ]);
      await context.close();
    });

    test("a member whose row was deleted: the access-ended states", async ({ browser }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ storageState: ENDED_STORAGE });
      const page = await context.newPage();
      await expectRows(page, [
        { route: "/tickets", state: "access ended", url: "/tickets", h1: "Tickets" },
        {
          route: "/tickets/[id]",
          state: "access ended",
          url: `/tickets/${ticket.id}`,
          h1: ACCESS_ENDED_HEADING,
        },
        {
          route: "/contacts/[id]",
          state: "access ended",
          url: `/contacts/${ticket.contactId}`,
          h1: ACCESS_ENDED_HEADING,
        },
        {
          route: "/kb/proposals",
          state: "access ended",
          url: "/kb/proposals",
          h1: ACCESS_ENDED_HEADING,
        },
        {
          route: "/kb/proposals/[id]",
          state: "access ended",
          url: `/kb/proposals/${proposalId}`,
          h1: ACCESS_ENDED_HEADING,
        },
        {
          route: "/settings/statuses",
          state: "access ended",
          url: "/settings/statuses",
          h1: STATUS_PAGE_TITLE,
        },
      ]);
      await context.close();
    });

    test("the app-shell fallback: a signed-in user with no workspace", async ({ browser }) => {
      test.setTimeout(120_000);
      // The database holds no member row for this user.
      await expect(prisma.member.count({ where: { userId: noWorkspaceUserId } })).resolves.toBe(0);
      const context = await browser.newContext({ storageState: NO_WORKSPACE_STORAGE });
      const page = await context.newPage();
      await gotoWarm(page, "/tickets");
      await expect(
        page.getByText("No workspace found. Please sign out and sign in again."),
      ).toBeVisible();
      await expectSingleH1(page, "Workspace not found");
      await expect(page.locator("main h1")).toHaveClass(/\bsr-only\b/);
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
