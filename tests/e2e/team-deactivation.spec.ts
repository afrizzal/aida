/**
 * AIDA-43 acceptance in the browser (Phase 10, plan 10-13 Task 2; V-27, C6, V-03, O-5, D-09,
 * R2-4, O-10).
 *
 * Every case builds its own organizations and people (tests/e2e/support/team.ts); the seeded E2E
 * owner and member are never deactivated or demoted (T-10-48b).
 *
 * - An open session of a member who is deactivated loses everything on its next request: six page
 *   URLs land on /no-access, a server action from the already-open ticket page changes nothing,
 *   two API routes answer 403 and the attachment route 404. Each refusal is preceded by the same
 *   request succeeding while the member was still a member (presence before absence).
 * - The Better Auth organization and admin routes are closed over HTTP (C4, V-03, O-5): every
 *   path answers 403 to every caller, and the database shows no membership, role, invitation,
 *   organization or active-organization change.
 * - The owner floor (D-09 as amended, R2-4, O-10): the only owner's row has no Deactivate control
 *   and no role select, for the owner and for an admin; with two owners on stale Team pages the
 *   second change is refused and exactly one owner remains.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { createTicket, prisma } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  addMember,
  createOrg,
  gotoWarm,
  memberCount,
  signedInContext,
  type TeamOrg,
  type TeamUser,
  uniqueEmail,
} from "./support/team";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PNG = fs.readFileSync(path.resolve(__dirname, "fixtures/sample.png"));
const BASE_URL = "http://localhost:3100";
const NO_ACCESS_HEADING = "You don't have access to this workspace";
/** The proxy's refusal text for both plugin prefixes (src/proxy.ts, TEAM_CHANGES_ERROR). */
const TEAM_CHANGES_ERROR = "Team changes are made in AIDA under Settings → Team.";

test.describe.configure({ timeout: 240_000 });

async function seedTicket(org: TeamOrg, label: string) {
  const subject = `${label} ticket ${org.orgId.slice(0, 8)}`;
  const ticket = await createTicket(org.orgId, {
    subject,
    priority: "NORMAL",
    body: `${label} body`,
    contact: { email: uniqueEmail("contact") },
    direction: "INBOUND",
  });
  return { id: ticket.id, subject };
}

/** The row of one person on the Team page, found by the address only that row shows. */
function teamRow(page: Page, user: TeamUser) {
  return page.getByRole("listitem").filter({ hasText: user.email });
}

/** The owner deactivates `target` through Settings -> Team, keeping their tickets assigned. */
async function deactivateThroughTeamPage(page: Page, target: TeamUser) {
  await gotoWarm(page, "/settings/team");
  const dialog = page.getByRole("dialog", { name: `Remove ${target.name} from this workspace?` });
  await expect(async () => {
    await teamRow(page, target).getByRole("button", { name: "Deactivate member" }).click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Deactivate member" }).click();
  await expect(page.getByText(`${target.name} was removed from the workspace.`)).toBeVisible({
    timeout: 20_000,
  });
}

/** Opens `url` and asserts the redirect to /no-access with its one h1 (V-27). */
async function expectNoAccess(page: Page, url: string) {
  await gotoWarm(page, url);
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText(NO_ACCESS_HEADING);
}

/** An internal note with one attachment, posted with the context's cookies. */
function postNoteWithFile(request: APIRequestContext, ticketId: string, body: string) {
  return request.post(`/api/tickets/${ticketId}/messages`, {
    multipart: {
      mode: "internal",
      body,
      file: { name: "sample.png", mimeType: "image/png", buffer: PNG },
    },
  });
}

test.describe("AIDA-43: deactivating a member", () => {
  test("V-27, C6: an open session lands on /no-access on six pages, its server action changes nothing, the API answers 403 and the attachment 404", async ({
    browser,
  }) => {
    const org = await createOrg("Deactivate Workspace", [
      { role: "owner", name: "Deactivate Owner" },
      { role: "member", name: "Deactivated Member" },
    ]);
    const [owner, member] = org.users;
    const ticket = await seedTicket(org, "Deactivate");

    const memberSession = await signedInContext(browser, member.email);
    const request = memberSession.page.request;

    // While a member: the note with a file is stored, the file and the bell count are readable.
    await expect
      .poll(async () => (await postNoteWithFile(request, ticket.id, "Member note")).status(), {
        timeout: 60_000,
      })
      .toBe(200);
    const attachment = await prisma.attachment.findFirstOrThrow({
      where: { organizationId: org.orgId, message: { ticketId: ticket.id } },
    });
    expect((await request.get(`/api/attachments/${attachment.id}`)).status()).toBe(200);
    expect((await request.get("/api/notifications?view=count")).status()).toBe(200);

    // The ticket page the member keeps open while being deactivated.
    const openPage = memberSession.page;
    await gotoWarm(openPage, `/tickets/${ticket.id}`);
    const header = openPage.locator("h1", { hasText: ticket.subject }).locator("xpath=..");
    await expect(header.getByRole("button", { name: /Unassigned/ })).toBeVisible();
    // Another tab of the same session, for the navigations.
    const nav = await memberSession.context.newPage();
    await gotoWarm(nav, "/tickets");
    await expect(nav.getByText(ticket.subject).first()).toBeVisible();

    const owned = await signedInContext(browser, owner.email);
    await deactivateThroughTeamPage(owned.page, member);
    expect(await memberCount(org.orgId, member.id)).toBe(0);

    // Pages: each next navigation of the open session lands on /no-access.
    for (const url of [
      "/tickets",
      `/tickets/${ticket.id}`,
      "/kb",
      "/contacts",
      "/settings",
      "/settings/team",
    ]) {
      await test.step(`${url} -> /no-access`, () => expectNoAccess(nav, url));
    }

    // A server action from the already-open ticket page: the assignment is refused.
    const messagesBefore = await prisma.message.count({ where: { ticketId: ticket.id } });
    await header.getByRole("button", { name: /Unassigned/ }).click();
    const action = openPage.waitForResponse(
      (res) => res.request().method() === "POST" && !!res.request().headers()["next-action"],
    );
    await openPage.getByRole("menuitemradio", { name: owner.name }).click();
    await action;
    await expect
      .poll(
        async () =>
          (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId,
      )
      .toBeNull();
    const audit = await prisma.ticketAuditEvent.count({
      where: { ticketId: ticket.id, actorUserId: member.id },
    });
    expect(audit).toBe(0);

    // API routes: the same requests that worked before are refused now.
    const refusedPost = await postNoteWithFile(request, ticket.id, "After deactivation");
    expect(refusedPost.status()).toBe(403);
    const refusedCount = await request.get("/api/notifications?view=count");
    expect(refusedCount.status()).toBe(403);
    const refusedFile = await request.get(`/api/attachments/${attachment.id}`);
    expect(refusedFile.status()).toBe(404);
    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(messagesBefore);
    // The session still exists and is signed in; it names no organization (D-07).
    const sessions = await prisma.session.findMany({ where: { userId: member.id } });
    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) expect(session.activeOrganizationId).toBeNull();

    await memberSession.context.close();
    await owned.context.close();
  });

  test("C4, V-03, O-5: the organization and admin plugin routes answer 403 over HTTP to every caller and change nothing", async ({
    browser,
    playwright,
  }) => {
    const orgA = await createOrg("Plugin Workspace", [
      { role: "owner", name: "Plugin Owner" },
      { role: "member", name: "Plugin Member" },
      { role: "member", name: "Plugin Stale" },
    ]);
    const orgB = await createOrg("Plugin Other", [{ role: "owner", name: "Plugin Other Owner" }]);
    const [owner, member, stale] = orgA.users;
    const otherOwner = orgB.users[0];
    const { id: invitationId } = await prisma.invitation.create({
      data: {
        id: `inv-${orgB.orgId}`,
        organizationId: orgB.orgId,
        email: uniqueEmail("plugin-invitee"),
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        inviterId: otherOwner.id,
      },
    });

    const contexts: BrowserContext[] = [];
    async function storageOf(email: string) {
      const signed = await signedInContext(browser, email);
      contexts.push(signed.context);
      return signed.context.storageState();
    }
    const ownerState = await storageOf(owner.email);
    const memberState = await storageOf(member.email);
    const staleState = await storageOf(stale.email);
    // The stale cookie: saved while a member, then the member is deactivated in the UI.
    const owned = await signedInContext(browser, owner.email);
    contexts.push(owned.context);
    await deactivateThroughTeamPage(owned.page, stale);

    const orgIds = [orgA.orgId, orgB.orgId];
    async function snapshot() {
      return {
        organizations: await prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true, slug: true },
          orderBy: { id: "asc" },
        }),
        members: await prisma.member.findMany({
          where: { organizationId: { in: orgIds } },
          select: { id: true, organizationId: true, userId: true, role: true },
          orderBy: { id: "asc" },
        }),
        invitations: await prisma.invitation.findMany({
          where: { organizationId: { in: orgIds } },
          select: { id: true, status: true, role: true },
          orderBy: { id: "asc" },
        }),
        sessions: await prisma.session.findMany({
          where: { userId: { in: [owner.id, member.id, stale.id, otherOwner.id] } },
          select: { id: true, userId: true, activeOrganizationId: true },
          orderBy: { id: "asc" },
        }),
        users: await prisma.user.count({
          where: { id: { in: [owner.id, member.id, stale.id, otherOwner.id] } },
        }),
      };
    }
    const before = await snapshot();
    expect(before.organizations).toHaveLength(2);
    expect(before.users).toBe(4);

    const PATHS = [
      "/api/auth/organization/accept-invitation",
      "/api/auth/organization/set-active",
      "/api/auth/organization/update-member-role",
      "/api/auth/organization/get-invitation",
      "/api/auth/organization/remove-member",
      "/api/auth/organization/leave",
      "/api/auth/organization/delete",
      "/api/auth/admin/remove-user",
    ];
    // A body that names the other organization and every id these routes read.
    const hostileBody = {
      organizationId: orgB.orgId,
      invitationId,
      id: invitationId,
      memberIdOrEmail: otherOwner.email,
      memberId: otherOwner.id,
      userId: otherOwner.id,
      role: "owner",
    };
    const callers: Array<{
      label: string;
      state?: Awaited<ReturnType<typeof storageOf>>;
      body?: object;
    }> = [
      { label: "no cookie" },
      { label: "owner cookie", state: ownerState, body: { organizationId: orgA.orgId } },
      { label: "member cookie", state: memberState, body: { organizationId: orgA.orgId } },
      {
        label: "deactivated member's stale cookie",
        state: staleState,
        body: { organizationId: orgA.orgId },
      },
      { label: "owner cookie, body naming organization B", state: ownerState, body: hostileBody },
    ];

    let requests = 0;
    for (const caller of callers) {
      const api = await playwright.request.newContext({
        baseURL: BASE_URL,
        storageState: caller.state ?? { cookies: [], origins: [] },
        // Same origin as the app, so the proxy block (not an Origin check) is what refuses.
        extraHTTPHeaders: { origin: BASE_URL },
      });
      for (const urlPath of PATHS) {
        await test.step(`${caller.label}: POST and GET ${urlPath}`, async () => {
          const post = await api.post(urlPath, { data: caller.body ?? {}, maxRedirects: 0 });
          expect(post.status(), `POST ${urlPath}`).toBe(403);
          await expect(post.json()).resolves.toEqual({ error: TEAM_CHANGES_ERROR });
          const query = new URLSearchParams({
            organizationId: orgB.orgId,
            id: invitationId,
          }).toString();
          const get = await api.get(`${urlPath}?${query}`, { maxRedirects: 0 });
          expect(get.status(), `GET ${urlPath}`).toBe(403);
          await expect(get.json()).resolves.toEqual({ error: TEAM_CHANGES_ERROR });
          requests += 2;
        });
      }
      await api.dispose();
    }
    expect(requests).toBe(PATHS.length * callers.length * 2);

    // Nothing changed: memberships, roles, invitations, sessions and both organizations.
    expect(await snapshot()).toEqual(before);
    for (const context of contexts) await context.close();
  });

  test("D-09, O-10: the only owner's row shows a Badge and no Deactivate control, for the owner and for an admin", async ({
    browser,
  }) => {
    const org = await createOrg("Floor Workspace", [
      { role: "owner", name: "Floor Owner" },
      { role: "admin", name: "Floor Admin" },
      { role: "member", name: "Floor Member" },
    ]);
    const [owner, admin, member] = org.users;

    const owned = await signedInContext(browser, owner.email);
    await gotoWarm(owned.page, "/settings/team");
    // Presence: the owner has controls on the other rows.
    await expect(
      teamRow(owned.page, admin).getByRole("button", { name: "Deactivate member" }),
    ).toBeVisible();
    await expect(
      owned.page.getByRole("combobox", { name: `Role for ${member.name}` }),
    ).toBeVisible();
    // Absence on the owner's own row: a Badge, no select, no Deactivate.
    const ownRow = teamRow(owned.page, owner);
    await expect(ownRow.getByText("Owner", { exact: true })).toBeVisible();
    await expect(ownRow.getByText("You", { exact: true })).toBeVisible();
    await expect(ownRow.getByRole("combobox")).toHaveCount(0);
    await expect(ownRow.getByRole("button", { name: "Deactivate member" })).toHaveCount(0);

    const adminSession = await signedInContext(browser, admin.email);
    await gotoWarm(adminSession.page, "/settings/team");
    await expect(
      teamRow(adminSession.page, member).getByRole("button", { name: "Deactivate member" }),
    ).toBeVisible();
    const ownerRow = teamRow(adminSession.page, owner);
    await expect(ownerRow.getByText("Owner", { exact: true })).toBeVisible();
    await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
    await expect(ownerRow.getByRole("button", { name: "Deactivate member" })).toHaveCount(0);
    // The owner row's badge explains why, on focus.
    await ownerRow.getByText("Owner", { exact: true }).focus();
    await expect(
      adminSession.page.getByText("Only an owner can change another owner."),
    ).toBeVisible();

    expect(await prisma.member.count({ where: { organizationId: org.orgId, role: "owner" } })).toBe(
      1,
    );
    await owned.context.close();
    await adminSession.context.close();
  });

  test("K162, V-26: a user with an owner row and another row is shown as Owner and protected for an admin; an owner still gets the controls", async ({
    browser,
  }) => {
    const org = await createOrg("Mixed Workspace", [
      { role: "owner", name: "Mixed Owner" },
      { role: "admin", name: "Mixed Admin" },
      { role: "owner", name: "Mixed Owner Admin" },
      { role: "owner", name: "Mixed Owner Member" },
    ]);
    const [owner, admin, ownerAdmin, ownerMember] = org.users;
    // Duplicate rows (O-4 default: no constraint), written the way only a migration or a bug would.
    await addMember(org.orgId, ownerAdmin.id, "admin");
    await addMember(org.orgId, ownerMember.id, "member");

    const adminSession = await signedInContext(browser, admin.email);
    await gotoWarm(adminSession.page, "/settings/team");
    // Presence first: the admin has no control on these rows only because of the owner row.
    for (const target of [ownerAdmin, ownerMember]) {
      const row = teamRow(adminSession.page, target);
      await expect(row.getByText("Owner", { exact: true }), target.name).toBeVisible();
      await expect(row.getByRole("combobox"), target.name).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Deactivate member" }), target.name).toHaveCount(
        0,
      );
    }
    // The owner-row users are listed among the owners, before the admin.
    const order = await adminSession.page.getByRole("listitem").allInnerTexts();
    const index = (user: TeamUser) => order.findIndex((text) => text.includes(user.email));
    expect(index(ownerMember)).toBeLessThan(index(admin));
    expect(index(ownerAdmin)).toBeLessThan(index(admin));

    // An owner whose every row is owner keeps the controls on those rows (the server allows it).
    const ownerSession = await signedInContext(browser, owner.email);
    await gotoWarm(ownerSession.page, "/settings/team");
    await expect(
      ownerSession.page.getByRole("combobox", { name: `Role for ${ownerAdmin.name}` }),
    ).toBeVisible();
    await expect(
      teamRow(ownerSession.page, ownerMember).getByRole("button", { name: "Deactivate member" }),
    ).toBeVisible();
    await adminSession.context.close();
    await ownerSession.context.close();
  });

  test("R2-4: with two owners on stale Team pages, A demotes B, then B's change to A is refused and exactly one owner remains", async ({
    browser,
  }) => {
    const org = await createOrg("Race Workspace", [
      { role: "owner", name: "Race Owner A" },
      { role: "owner", name: "Race Owner B" },
    ]);
    const [ownerA, ownerB] = org.users;
    const sessionA = await signedInContext(browser, ownerA.email);
    const sessionB = await signedInContext(browser, ownerB.email);
    // Both Team pages are loaded before either change.
    await gotoWarm(sessionA.page, "/settings/team");
    await gotoWarm(sessionB.page, "/settings/team");
    const selectForB = sessionA.page.getByRole("combobox", { name: `Role for ${ownerB.name}` });
    const selectForA = sessionB.page.getByRole("combobox", { name: `Role for ${ownerA.name}` });
    await expect(selectForB).toHaveText("Owner");
    await expect(selectForA).toHaveText("Owner");

    // A makes B an Admin.
    await expect(async () => {
      await selectForB.click();
      await expect(sessionA.page.getByRole("option", { name: "Admin", exact: true })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await sessionA.page.getByRole("option", { name: "Admin", exact: true }).click();
    await expect(sessionA.page.getByText(`${ownerB.name} is now admin.`)).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(async () =>
        (
          await prisma.member.findMany({ where: { organizationId: org.orgId, userId: ownerB.id } })
        ).map((m) => m.role),
      )
      .toEqual(["admin"]);

    // B, without reloading, tries to make A an Admin.
    await expect(async () => {
      await selectForA.click();
      await expect(sessionB.page.getByRole("option", { name: "Admin", exact: true })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await sessionB.page.getByRole("option", { name: "Admin", exact: true }).click();
    // The card's callout (Next's route announcer is an empty alert too, so filter by text).
    await expect(
      sessionB.page
        .getByRole("alert")
        .filter({ hasText: "You can't make this change with your role." }),
    ).toHaveText("You can't make this change with your role.", { timeout: 20_000 });
    // The select falls back to the stored role.
    await expect(selectForA).toHaveText("Owner");

    const owners = await prisma.member.findMany({
      where: { organizationId: org.orgId, role: "owner" },
      select: { userId: true },
    });
    expect(owners).toEqual([{ userId: ownerA.id }]);
    await sessionA.context.close();
    await sessionB.context.close();
  });
});
