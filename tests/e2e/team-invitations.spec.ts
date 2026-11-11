/**
 * AIDA-42 acceptance in the browser (Phase 10, plan 10-13 Task 1; V-13, V-15, V-23, V-24, C9,
 * R2-2, R3-1, D-04, D-05, D-06).
 *
 * Every case builds its own organizations and people (tests/e2e/support/team.ts), so the seeded
 * E2E owner and member are never changed; the seeded member is only read (the mismatch case).
 * Every join runs in a fresh browser context through the real invitation page and its accept
 * route, and each result is checked in the browser and in the database: the member row, the
 * session's active organization, and the user row of the address.
 *
 * Email: the global setup configures no SMTP, so invitations made in the Team page take the
 * copyable-link path. The fake-SMTP case starts a loopback fake in this process and writes the
 * organization's email settings with no password (V-15); no real email is sent.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, BrowserContextOptions, Page } from "@playwright/test";
import { simpleParser } from "mailparser";
import { INVITATION_EMAIL_SUBJECT } from "../../src/lib/workspace-members/invite-email";
import { startFakeSmtp } from "../support/fake-smtp";
import { MEMBER_EMAIL } from "./global-setup";
import { createTicket, prisma } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  createOrg,
  createUser,
  gotoWarm,
  insertInvitation,
  invitePath,
  memberCount,
  signedInContext,
  submitLogin,
  TEAM_PASSWORD,
  type TeamOrg,
  uniqueEmail,
  userCountByEmail,
  writeFakeSmtpSettings,
} from "./support/team";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMBER_STORAGE = path.resolve(__dirname, ".auth/member.json");

/** A context with no cookies at all (never a shared storage state). */
const NO_COOKIES: BrowserContextOptions = { storageState: { cookies: [], origins: [] } };

const INVALID_HEADING = "This invitation link is not valid";
const MISMATCH_HEADING = "This invitation is for a different email";

test.describe.configure({ timeout: 180_000 });

/** The accept route of a link. */
function acceptPath(token: string): string {
  return `${invitePath(token)}/accept`;
}

/**
 * Polls the accept route until it is compiled, with a request that carries no Origin: the route
 * refuses it before it reads anything (V-24), with a 303 back to the card (K161), so the poll
 * changes nothing.
 */
async function warmAcceptRoute(request: APIRequestContext, token: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await request.post(acceptPath(token), { maxRedirects: 0 })).headers().location ?? "",
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(`${invitePath(token)}?error=origin`);
}

/**
 * K161: a refused accept post answers 303 back to the card with a readable state, never a JSON
 * body the browser would show as text.
 */
async function expectCardRefusal(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  token: string,
  state: string,
) {
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe(`${invitePath(token)}?error=${state}`);
  expect(response.headers()["content-type"] ?? "").not.toContain("json");
  expect(await response.text()).toBe("");
}

/** The pending invitation's token from a link (the token is the last path segment). */
function tokenOf(link: string): string {
  const match = /\/invite\/([A-Za-z0-9_-]{43})$/.exec(link);
  if (!match) throw new Error(`not an invitation link: ${link}`);
  return match[1];
}

/** The ticket subjects seeded per organization, for the landing checks. */
async function seedTicket(org: TeamOrg, label: string): Promise<{ id: string; subject: string }> {
  const subject = `${label} ticket ${org.orgId.slice(0, 8)}`;
  const created = await createTicket(org.orgId, {
    subject,
    priority: "NORMAL",
    body: `${label} body`,
    contact: { email: uniqueEmail("contact") },
    direction: "INBOUND",
  });
  return { id: created.id, subject };
}

/**
 * The owner invites `email` with the given role through Settings -> Team. Returns the dialog after
 * the server answered (the copy-link view or the closed dialog after a sent email).
 */
async function inviteThroughTeamPage(page: Page, email: string, role: "Member" | "Admin") {
  await gotoWarm(page, "/settings/team");
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Invite a member" });
  // Hydration-robust: a click before hydration does nothing, so retry until the dialog opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Invite member" }).click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.getByLabel("Email").fill(email);
  if (role !== "Member") {
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: role, exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  return dialog;
}

/** The copy-link view of the invite dialog: the notice, then the link it shows once. */
async function copyLinkFromDialog(page: Page, email: string): Promise<string> {
  const dialog = page.getByRole("dialog", { name: "Invite a member" });
  await expect(dialog.getByRole("status")).toHaveText(
    `Email is not set up on this server, so no email was sent. Copy this link and send it to ${email} yourself. It works once and expires in 7 days.`,
  );
  const link = await dialog.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:3100\/invite\/[A-Za-z0-9_-]{43}$/);
  return link;
}

/**
 * The create-account card of a link, filled and submitted in `page`; resolves when the browser is
 * on /tickets with the welcome toast for `workspaceName`.
 */
async function createAccountAndJoin(
  page: Page,
  token: string,
  workspaceName: string,
  name: string,
) {
  await gotoWarm(page, invitePath(token));
  await expect(
    page.getByRole("heading", { level: 1, name: `Join ${workspaceName}` }),
  ).toBeVisible();
  await warmAcceptRoute(page.request, token);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(TEAM_PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await page.waitForURL(/\/tickets/, { timeout: 60_000 });
  await expect(page.getByText(`Welcome to ${workspaceName}.`)).toBeVisible();
}

/** The session rows of a user, with the active organization each one names. */
function sessionsOf(userId: string) {
  return prisma.session.findMany({ where: { userId }, select: { activeOrganizationId: true } });
}

test.describe("AIDA-42: invitations in the browser", () => {
  test("tracer: the owner invites with email off, a fresh browser creates the account, lands in the workspace and the Team page lists the Member", async ({
    browser,
  }) => {
    const org = await createOrg("Tracer Workspace", [{ role: "owner", name: "Tracer Owner" }]);
    const [owner] = org.users;
    const owned = await signedInContext(browser, owner.email);
    const email = uniqueEmail("tracer-invitee");

    await inviteThroughTeamPage(owned.page, email, "Member");
    const link = await copyLinkFromDialog(owned.page, email);
    const token = tokenOf(link);

    // A fresh browser opens the link: the card names the workspace and shows the address read-only.
    const invitee = await browser.newContext(NO_COOKIES);
    const page = await invitee.newPage();
    await gotoWarm(page, link);
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();
    await expect(
      page.getByText("You were invited as Member. Create your account to join."),
    ).toBeVisible();
    const emailField = page.getByLabel("Email");
    await expect(emailField).toHaveValue(email);
    await expect(emailField).toHaveAttribute("readonly", "");

    await createAccountAndJoin(page, token, org.name, "Tracer Invitee");
    // The welcome parameter is dropped from the URL without a navigation.
    await expect(page).toHaveURL(/\/tickets$/);

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    await expect.poll(() => memberCount(org.orgId, user.id)).toBe(1);
    const row = await prisma.member.findFirstOrThrow({
      where: { organizationId: org.orgId, userId: user.id },
    });
    expect(row.role).toBe("member");

    // The owner's Team page lists the person with the invited role.
    await gotoWarm(owned.page, "/settings/team");
    await expect(owned.page.getByText("Tracer Invitee", { exact: true })).toBeVisible();
    await expect(owned.page.getByRole("combobox", { name: "Role for Tracer Invitee" })).toHaveText(
      "Member",
    );

    await invitee.close();
    await owned.context.close();
  });

  test("fake SMTP (V-15): the invitation email reaches the invited address and its link joins in a fresh browser", async ({
    browser,
  }) => {
    const smtp = await startFakeSmtp({ advertiseAuth: false });
    try {
      const org = await createOrg("Mail Workspace", [{ role: "owner", name: "Mail Owner" }]);
      const [owner] = org.users;
      await writeFakeSmtpSettings(org.orgId, smtp.port);
      const owned = await signedInContext(browser, owner.email);
      const email = uniqueEmail("mail-invitee");

      await inviteThroughTeamPage(owned.page, email, "Admin");
      await expect(owned.page.getByText(`Invitation sent to ${email}.`)).toBeVisible({
        timeout: 20_000,
      });
      // No copy-link view: the link was delivered, so it is not shown.
      await expect(owned.page.getByLabel("Invitation link")).toHaveCount(0);

      // The captured message, before its link is opened.
      await expect.poll(() => smtp.messages.length).toBe(1);
      const [message] = smtp.messages;
      expect(message.recipients).toEqual([email]);
      const mail = await simpleParser(message.raw);
      expect(mail.subject).toBe(INVITATION_EMAIL_SUBJECT);
      const text = mail.text ?? "";
      expect(text).toContain(`invited you to join ${org.name} on AIDA as admin.`);
      const linkMatch = /http:\/\/localhost:3100\/invite\/[A-Za-z0-9_-]{43}/.exec(text);
      expect(linkMatch, text).not.toBeNull();
      const link = linkMatch?.[0] ?? "";

      const invitee = await browser.newContext(NO_COOKIES);
      const page = await invitee.newPage();
      await createAccountAndJoin(page, tokenOf(link), org.name, "Mail Invitee");
      const user = await prisma.user.findFirstOrThrow({ where: { email } });
      const row = await prisma.member.findFirstOrThrow({
        where: { organizationId: org.orgId, userId: user.id },
      });
      expect(row.role).toBe("admin");
      await invitee.close();
      await owned.context.close();
    } finally {
      await smtp.stop();
    }
  });

  test("C9 (a): a new account made through the link starts in the invited workspace's /tickets with its ticket, active organization set", async ({
    browser,
  }) => {
    const org = await createOrg("Landing Workspace", [{ role: "owner", name: "Landing Owner" }]);
    const ticket = await seedTicket(org, "Landing");
    const email = uniqueEmail("landing");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email,
      role: "member",
      inviterId: org.users[0].id,
    });

    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await createAccountAndJoin(page, token, org.name, "Landing Invitee");
    await expect(page.getByText(ticket.subject).first()).toBeVisible();

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    await expect(sessionsOf(user.id)).resolves.toEqual([{ activeOrganizationId: org.orgId }]);
    expect(await memberCount(org.orgId, user.id)).toBe(1);
    await context.close();
  });

  test("C9 (b): an account of another organization signs in through the card and lands in the inviting organization, not /no-access", async ({
    browser,
  }) => {
    const orgA = await createOrg("Inviting Workspace", [{ role: "owner", name: "Inviting Owner" }]);
    const orgB = await createOrg("Home Workspace", [{ role: "owner", name: "Home Owner" }]);
    const ticketA = await seedTicket(orgA, "Inviting");
    const ticketB = await seedTicket(orgB, "Home");
    const visitor = orgB.users[0];
    const { token } = await insertInvitation({
      orgId: orgA.orgId,
      email: visitor.email,
      role: "member",
      inviterId: orgA.users[0].id,
    });

    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: `Join ${orgA.name}` })).toBeVisible();
    await expect(page.getByText("You were invited as Member. Sign in to join.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(visitor.email);
    await warmAcceptRoute(page.request, token);
    await page.getByLabel("Password", { exact: true }).fill(TEAM_PASSWORD);
    await page.getByRole("button", { name: "Sign in and join" }).click();
    await page.waitForURL(/\/tickets/, { timeout: 60_000 });
    expect(new URL(page.url()).pathname).toBe("/tickets");
    await expect(page.getByText(`Welcome to ${orgA.name}.`)).toBeVisible();
    // The inviting organization's inbox, not the home one.
    await expect(page.getByText(ticketA.subject).first()).toBeVisible();
    await expect(page.getByText(ticketB.subject)).toHaveCount(0);

    await expect(sessionsOf(visitor.id)).resolves.toEqual([{ activeOrganizationId: orgA.orgId }]);
    expect(await memberCount(orgA.orgId, visitor.id)).toBe(1);
    expect(await memberCount(orgB.orgId, visitor.id)).toBe(1);
    await context.close();
  });

  test("R3-1 (c): a link revoked while the create-account card is open shows the invalid card and creates no account; a new invitation then joins", async ({
    browser,
  }) => {
    const org = await createOrg("Revoked Workspace", [{ role: "owner", name: "Revoked Owner" }]);
    const owned = await signedInContext(browser, org.users[0].email);
    const email = uniqueEmail("revoked");

    await inviteThroughTeamPage(owned.page, email, "Member");
    const first = tokenOf(await copyLinkFromDialog(owned.page, email));

    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await gotoWarm(page, invitePath(first));
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();
    await warmAcceptRoute(page.request, first);

    // Revoked in the database after the card rendered, before the form is submitted.
    const revoked = await prisma.invitation.updateMany({
      where: { organizationId: org.orgId, email, status: "pending" },
      data: { status: "canceled" },
    });
    expect(revoked.count).toBe(1);
    await page.getByLabel("Name").fill("Revoked Invitee");
    await page.getByLabel("Password", { exact: true }).fill(TEAM_PASSWORD);
    await page.getByRole("button", { name: "Create account and join" }).click();
    await expect(page.getByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).pathname).toBe(invitePath(first));
    // Validation runs before sign-up: no account exists for the address.
    expect(await userCountByEmail(email)).toBe(0);
    await context.close();

    // The owner issues a new invitation for the same address; a fresh browser joins through it.
    await owned.page.keyboard.press("Escape");
    await inviteThroughTeamPage(owned.page, email, "Member");
    const second = tokenOf(await copyLinkFromDialog(owned.page, email));
    expect(second).not.toBe(first);
    const retry = await browser.newContext(NO_COOKIES);
    const retryPage = await retry.newPage();
    await createAccountAndJoin(retryPage, second, org.name, "Revoked Invitee");
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(await memberCount(org.orgId, user.id)).toBe(1);
    await retry.close();
    await owned.context.close();
  });

  test("R2-2: a session deleted after the accept card rendered gets the sign-in state of the same link and no membership; signing in through the card joins", async ({
    browser,
  }) => {
    const orgA = await createOrg("Session Workspace", [{ role: "owner", name: "Session Owner" }]);
    const orgB = await createOrg("Session Home", [{ role: "owner", name: "Session Visitor" }]);
    const ticketA = await seedTicket(orgA, "Session");
    const visitor = orgB.users[0];
    const { token } = await insertInvitation({
      orgId: orgA.orgId,
      email: visitor.email,
      role: "member",
      inviterId: orgA.users[0].id,
    });

    const { context, page } = await signedInContext(browser, visitor.email);
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: `Join ${orgA.name}` })).toBeVisible();
    await expect(
      page.getByText(`You were invited as Member. You are signed in as ${visitor.email}.`),
    ).toBeVisible();
    await warmAcceptRoute(page.request, token);
    // The browser keeps its cookies; the session row behind them is gone.
    expect((await context.cookies()).length).toBeGreaterThan(0);
    const deleted = await prisma.session.deleteMany({ where: { userId: visitor.id } });
    expect(deleted.count).toBe(1);

    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByText("You were invited as Member. Sign in to join.")).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).pathname).toBe(invitePath(token));
    expect(await memberCount(orgA.orgId, visitor.id)).toBe(0);
    const pending = await prisma.invitation.findFirstOrThrow({
      where: { organizationId: orgA.orgId, email: visitor.email },
    });
    expect(pending.status).toBe("pending");

    await page.getByLabel("Password", { exact: true }).fill(TEAM_PASSWORD);
    await page.getByRole("button", { name: "Sign in and join" }).click();
    await page.waitForURL(/\/tickets/, { timeout: 60_000 });
    await expect(page.getByText(ticketA.subject).first()).toBeVisible();
    expect(await memberCount(orgA.orgId, visitor.id)).toBe(1);
    await expect(sessionsOf(visitor.id)).resolves.toEqual([{ activeOrganizationId: orgA.orgId }]);
    await context.close();
  });

  test("V-24, K161: an accept POST without an Origin header is refused back to the card and creates no membership", async ({
    browser,
  }) => {
    const orgA = await createOrg("Origin Workspace", [{ role: "owner", name: "Origin Owner" }]);
    const orgB = await createOrg("Origin Home", [{ role: "owner", name: "Origin Visitor" }]);
    const visitor = orgB.users[0];
    const { token } = await insertInvitation({
      orgId: orgA.orgId,
      email: visitor.email,
      role: "member",
      inviterId: orgA.users[0].id,
    });
    const { context, page } = await signedInContext(browser, visitor.email);
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();

    // The signed-in session's cookies go with the request; only the Origin header is missing.
    const response = await page.request.post(acceptPath(token), {
      form: { intent: "accept" },
      maxRedirects: 0,
    });
    await expectCardRefusal(response, token, "origin");
    expect(await memberCount(orgA.orgId, visitor.id)).toBe(0);
    await context.close();
  });

  test("V-24, K161: an accept POST with a foreign Origin is refused back to the card and creates no membership; the same session then accepts through the card", async ({
    browser,
  }) => {
    const orgA = await createOrg("Foreign Workspace", [{ role: "owner", name: "Foreign Owner" }]);
    const orgB = await createOrg("Foreign Home", [{ role: "owner", name: "Foreign Visitor" }]);
    const visitor = orgB.users[0];
    const { token } = await insertInvitation({
      orgId: orgA.orgId,
      email: visitor.email,
      role: "member",
      inviterId: orgA.users[0].id,
    });
    const { context, page } = await signedInContext(browser, visitor.email);
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();

    const response = await page.request.post(acceptPath(token), {
      form: { intent: "accept" },
      headers: { Origin: "http://evil.test" },
      maxRedirects: 0,
    });
    await expectCardRefusal(response, token, "origin");
    expect(await memberCount(orgA.orgId, visitor.id)).toBe(0);

    // The refusal was the Origin, not the session: the card's own same-origin post accepts.
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL(/\/tickets/, { timeout: 60_000 });
    await expect(page.getByText(`Welcome to ${orgA.name}.`)).toBeVisible();
    expect(await memberCount(orgA.orgId, visitor.id)).toBe(1);
    await context.close();
  });

  test("K161: a refused form post of the card lands on the card with the server-error callout, never raw JSON; a throttled refusal reads the same", async ({
    browser,
  }) => {
    const org = await createOrg("Refusal Workspace", [{ role: "owner", name: "Refusal Owner" }]);
    const email = uniqueEmail("refusal");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email,
      role: "member",
      inviterId: org.users[0].id,
    });
    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();
    await warmAcceptRoute(page.request, token);

    // Two extra fields make the browser's own post five parts, which the route refuses (V-24).
    await page.evaluate(() => {
      const form = document.querySelector("form");
      for (const name of ["extra-1", "extra-2"]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = "x";
        form?.appendChild(input);
      }
    });
    await page.getByLabel("Name").fill("Refused Invitee");
    await page.getByLabel("Password", { exact: true }).fill(TEAM_PASSWORD);
    await page.getByRole("button", { name: "Create account and join" }).click();
    await page.waitForURL((url) => url.searchParams.get("error") === "request", {
      timeout: 60_000,
    });
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toHaveText(
      "Something went wrong while joining. Wait a moment and try again.",
    );
    expect(await page.locator("body").innerText()).not.toContain('"error"');
    expect(await userCountByEmail(email)).toBe(0);

    // The throttled refusal's target reads the same, and the card still offers its form.
    await page.goto(`${invitePath(token)}?error=throttled`);
    await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toHaveText(
      "Something went wrong while joining. Wait a moment and try again.",
    );
    await expect(page.getByRole("button", { name: "Create account and join" })).toBeVisible();
    await context.close();
  });

  test("an expired invitation shows the invalid card and creates nothing", async ({ browser }) => {
    const org = await createOrg("Expired Workspace", [{ role: "owner", name: "Expired Owner" }]);
    const email = uniqueEmail("expired");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email,
      role: "member",
      inviterId: org.users[0].id,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible();
    // No join form is offered, and nothing names the workspace or the address.
    await expect(page.getByRole("button", { name: "Create account and join" })).toHaveCount(0);
    await expect(page.getByText(org.name)).toHaveCount(0);
    await expect(page.getByText(email)).toHaveCount(0);
    expect(await userCountByEmail(email)).toBe(0);
    await context.close();
  });

  test("D-05: a signed-in account with another email sees the mismatch card and gets no membership", async ({
    browser,
  }) => {
    const org = await createOrg("Mismatch Workspace", [{ role: "owner", name: "Mismatch Owner" }]);
    const invited = uniqueEmail("mismatch");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email: invited,
      role: "member",
      inviterId: org.users[0].id,
    });
    const seededMember = await prisma.user.findUniqueOrThrow({ where: { email: MEMBER_EMAIL } });

    // The seeded member's saved session, only read here.
    const context = await browser.newContext({ storageState: MEMBER_STORAGE });
    const page = await context.newPage();
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: MISMATCH_HEADING })).toBeVisible();
    await expect(
      page.getByText(
        `You are signed in as ${MEMBER_EMAIL}. Sign out, then open the invitation link again.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    // The invited address is never shown to a different account.
    await expect(page.getByText(invited)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    expect(await memberCount(org.orgId, seededMember.id)).toBe(0);
    const pending = await prisma.invitation.findFirstOrThrow({ where: { email: invited } });
    expect(pending.status).toBe("pending");
    await context.close();
  });

  test("isolation: an invitation to organization B grants B only; neither side reaches the other's ticket", async ({
    browser,
  }) => {
    const orgA = await createOrg("Isolation A", [
      { role: "owner", name: "Isolation Owner A" },
      { role: "member", name: "Isolation Member A" },
    ]);
    const orgB = await createOrg("Isolation B", [{ role: "owner", name: "Isolation Owner B" }]);
    const ticketA = await seedTicket(orgA, "Isolation A");
    const ticketB = await seedTicket(orgB, "Isolation B");
    const email = uniqueEmail("isolation");
    const { token } = await insertInvitation({
      orgId: orgB.orgId,
      email,
      role: "member",
      inviterId: orgB.users[0].id,
    });

    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await createAccountAndJoin(page, token, orgB.name, "Isolation Invitee");
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(await memberCount(orgB.orgId, user.id)).toBe(1);
    expect(await prisma.member.count({ where: { userId: user.id } })).toBe(1);
    expect(await memberCount(orgA.orgId, user.id)).toBe(0);

    // The invitee reads B's ticket (presence) and not A's (absence).
    await gotoWarm(page, `/tickets/${ticketB.id}`);
    await expect(page.getByRole("heading", { level: 1, name: ticketB.subject })).toBeVisible();
    await gotoWarm(page, `/tickets/${ticketA.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ticket not found" })).toBeVisible();
    await expect(page.getByText(ticketA.subject)).toHaveCount(0);
    await context.close();

    // A's member reads A's ticket and not B's.
    const memberA = await signedInContext(browser, orgA.users[1].email);
    await gotoWarm(memberA.page, `/tickets/${ticketA.id}`);
    await expect(
      memberA.page.getByRole("heading", { level: 1, name: ticketA.subject }),
    ).toBeVisible();
    await gotoWarm(memberA.page, `/tickets/${ticketB.id}`);
    await expect(
      memberA.page.getByRole("heading", { level: 1, name: "Ticket not found" }),
    ).toBeVisible();
    await expect(memberA.page.getByText(ticketB.subject)).toHaveCount(0);
    await memberA.context.close();
  });

  test("D-04 (amended by K159): the invitation page sends Referrer-Policy same-origin and never shows the token; an unknown token gets the invalid card", async ({
    browser,
  }) => {
    const org = await createOrg("Header Workspace", [{ role: "owner", name: "Header Owner" }]);
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email: uniqueEmail("header"),
      role: "member",
      inviterId: org.users[0].id,
    });
    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await gotoWarm(page, invitePath(token));
    const valid = await page.goto(invitePath(token));
    expect(valid?.status()).toBe(200);
    expect(valid?.headers()["referrer-policy"]).toBe("same-origin");
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();
    // The token is only in the URL and the form action, never in the page text.
    expect(await page.locator("body").innerText()).not.toContain(token);

    const unknown = await page.goto(invitePath("A".repeat(43)));
    expect(unknown?.headers()["referrer-policy"]).toBe("same-origin");
    await expect(page.getByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible();
    await context.close();
  });

  test("K159: the card's own form post carries the page's real Origin and joins; a navigation to another origin sends no Referer with the token", async ({
    browser,
  }) => {
    const org = await createOrg("Referrer Workspace", [{ role: "owner", name: "Referrer Owner" }]);
    const email = uniqueEmail("referrer");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email,
      role: "member",
      inviterId: org.users[0].id,
    });
    const context = await browser.newContext(NO_COOKIES);
    const page = await context.newPage();
    await gotoWarm(page, invitePath(token));
    const view = await page.goto(invitePath(token));
    // The policy that keeps the token from every other origin (D-04 as amended by K159).
    expect.soft(view?.headers()["referrer-policy"]).toBe("same-origin");
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();

    // AIDA loads nothing from another origin, so a navigation the page itself starts towards
    // another origin stands in for any third party: 127.0.0.1 is another origin than localhost.
    const otherOrigin = `http://127.0.0.1:${new URL(page.url()).port}/login`;
    const crossRequest = page.waitForRequest((r) => r.url().startsWith(otherOrigin));
    await page
      .evaluate((url) => {
        window.location.assign(url);
      }, otherOrigin)
      .catch(() => undefined);
    const crossHeaders = await (await crossRequest).allHeaders();
    expect.soft(crossHeaders.referer).toBeUndefined();
    expect.soft(JSON.stringify(crossHeaders)).not.toContain(token);
    // Let that navigation finish before the next one, so neither interrupts the other.
    await page.waitForURL((url) => url.hostname === "127.0.0.1", { timeout: 45_000 });

    // Back on the card: its own post carries the page's real Origin and joins.
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: `Join ${org.name}` })).toBeVisible();
    await warmAcceptRoute(page.request, token);
    await page.getByLabel("Name").fill("Origin Invitee");
    await page.getByLabel("Password", { exact: true }).fill(TEAM_PASSWORD);
    const acceptRequest = page.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === acceptPath(token),
    );
    await page.getByRole("button", { name: "Create account and join" }).click();
    const acceptHeaders = await (await acceptRequest).allHeaders();
    expect.soft(acceptHeaders.origin).toBe(new URL(page.url()).origin);
    await page.waitForURL(/\/tickets/, { timeout: 60_000 });
    await expect(page.getByText(`Welcome to ${org.name}.`)).toBeVisible();
    const user = await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
    expect(await memberCount(org.orgId, user.id)).toBe(1);
    await context.close();
  });

  test("a link works once: after a join, the same link in another fresh browser is the invalid card", async ({
    browser,
  }) => {
    const org = await createOrg("Once Workspace", [{ role: "owner", name: "Once Owner" }]);
    const email = uniqueEmail("once");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email,
      role: "member",
      inviterId: org.users[0].id,
    });
    const first = await browser.newContext(NO_COOKIES);
    const firstPage = await first.newPage();
    await createAccountAndJoin(firstPage, token, org.name, "Once Invitee");
    await first.close();

    const second = await browser.newContext(NO_COOKIES);
    const page = await second.newPage();
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible();
    // Signing in elsewhere does not reopen it either: the account is a member already.
    await submitLogin(page, email);
    await page.waitForURL(/\/tickets/, { timeout: 60_000 });
    await gotoWarm(page, invitePath(token));
    await expect(page.getByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible();
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(await memberCount(org.orgId, user.id)).toBe(1);
    await second.close();
  });

  test("an existing account with no workspace, signed in, joins through the accept card", async ({
    browser,
  }) => {
    const org = await createOrg("Loner Workspace", [{ role: "owner", name: "Loner Owner" }]);
    const loner = await createUser("Loner Person");
    const { token } = await insertInvitation({
      orgId: org.orgId,
      email: loner.email,
      role: "member",
      inviterId: org.users[0].id,
    });
    // Signed in through /login first: with no member row the account lands on /no-access.
    const { context, page } = await signedInContext(browser, loner.email, /\/no-access$/);
    await gotoWarm(page, invitePath(token));
    await warmAcceptRoute(page.request, token);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL(/\/tickets/, { timeout: 60_000 });
    await expect(page.getByText(`Welcome to ${org.name}.`)).toBeVisible();
    expect(await memberCount(org.orgId, loner.id)).toBe(1);
    await expect(sessionsOf(loner.id)).resolves.toEqual([{ activeOrganizationId: org.orgId }]);
    await context.close();
  });
});
