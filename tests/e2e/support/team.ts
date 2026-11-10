// Phase 10 E2E support (plan 10-13): organizations, people, invitations, signed-in contexts and
// email settings for the team, notification and mention specs.
//
// Shared state (V-13): every helper here creates new rows. Nothing touches the seeded E2E owner
// and member or the shared organization, so the other specs see them unchanged. Each spec builds
// its own organizations with createOrg and its own people with createUser.
//
// Accounts get an email-and-password credential whose hash comes from Better Auth's own
// hashPassword (the single-h1.spec.ts pattern), so they sign in through the real /login page and
// the in-process sign-up (which needs the dev server's secret) is not required. The invitee
// account of a join path is never made here: the invitation page creates it.
//
// Invitations: insertInvitation stores only the SHA-256 hash of a known token, exactly as
// createInvitation does (src/lib/workspace-members/invite-token.ts), so a spec can open the link
// without going through the Team page when the case is about the page, not the dialog.
//
// Email: writeFakeSmtpSettings points an organization at a loopback fake SMTP with no SMTP user
// and no password, so no APP_ENCRYPTION_KEY is needed in this process (V-15). Only 127.0.0.1 is
// ever configured; no real email is sent (T-10-47).
import { randomUUID } from "node:crypto";
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { EMAIL_SETTING_KEYS } from "../../../src/lib/channels/email/settings";
import {
  createInviteToken,
  hashInviteToken,
} from "../../../src/lib/workspace-members/invite-token";
import { prisma } from "./db";

/** The password of every account made here. */
export const TEAM_PASSWORD = "E2E-team-password-1!";

export type TeamRole = "owner" | "admin" | "member";

export interface TeamUser {
  id: string;
  name: string;
  email: string;
}

export interface TeamOrg {
  orgId: string;
  name: string;
  users: TeamUser[];
}

/** A unique, lower-case address on the reserved .test domain. */
export function uniqueEmail(tag: string): string {
  return `${tag}-${randomUUID().slice(0, 8)}@team.e2e.test`;
}

/** A user with an email-and-password credential and no member row. */
export async function createUser(name: string, email: string = uniqueEmail("user")) {
  const { hashPassword } = await import("better-auth/crypto");
  const id = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: { id, name, email, emailVerified: true, createdAt: now, updatedAt: now },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(TEAM_PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, name, email } satisfies TeamUser;
}

/** One member row for an existing user. */
export async function addMember(orgId: string, userId: string, role: TeamRole): Promise<string> {
  const id = randomUUID();
  await prisma.member.create({
    data: { id, organizationId: orgId, userId, role, createdAt: new Date() },
  });
  return id;
}

/**
 * A new organization with one member per entry, in order, each a new user with a credential. The
 * organization name is unique, so a spec can assert "Join {name}" and "Welcome to {name}."
 */
export async function createOrg(
  label: string,
  people: ReadonlyArray<{ role: TeamRole; name: string }>,
): Promise<TeamOrg> {
  const orgId = randomUUID();
  const suffix = orgId.slice(0, 6);
  const name = `${label} ${suffix}`;
  await prisma.organization.create({
    data: { id: orgId, name, slug: `team-e2e-${orgId}`, createdAt: new Date() },
  });
  const users: TeamUser[] = [];
  for (const person of people) {
    const user = await createUser(person.name, uniqueEmail(person.role));
    await addMember(orgId, user.id, person.role);
    users.push(user);
  }
  return { orgId, name, users };
}

/** First-hit compile guard: next dev can answer 404 before a route's first compile finishes. */
export async function gotoWarm(page: Page, urlPath: string): Promise<void> {
  await expect
    .poll(
      async () => (await page.goto(urlPath, { waitUntil: "load", timeout: 45_000 }))?.status() ?? 0,
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe(404);
}

/** A fresh browser context with no cookies, never a shared storage state. */
export function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

/** Fills and submits the real /login form; the caller waits for the landing it expects. */
export async function submitLogin(page: Page, email: string, password = TEAM_PASSWORD) {
  await gotoWarm(page, "/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Signs a user in through the real /login page in a fresh context and returns the context with
 * one page left on the landing. Users with a member row land on /tickets; users with none on
 * /no-access (V-27).
 */
export async function signedInContext(
  browser: Browser,
  email: string,
  landing: RegExp = /\/tickets/,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await freshContext(browser);
  const page = await context.newPage();
  await submitLogin(page, email);
  await page.waitForURL(landing, { timeout: 60_000 });
  return { context, page };
}

/** The link the inviter would send: the configured origin (BETTER_AUTH_URL), never the Host. */
export function invitePath(token: string): string {
  return `/invite/${token}`;
}

/**
 * Inserts a pending invitation with a known token (only its hash is stored) and returns the token.
 * expiresAt defaults to seven days ahead; a past date makes an expired link.
 */
export async function insertInvitation(input: {
  orgId: string;
  email: string;
  role: TeamRole;
  inviterId: string;
  expiresAt?: Date;
  status?: string;
}): Promise<{ id: string; token: string }> {
  const token = createInviteToken();
  const id = randomUUID();
  const now = new Date();
  await prisma.invitation.create({
    data: {
      id,
      organizationId: input.orgId,
      email: input.email,
      role: input.role,
      status: input.status ?? "pending",
      tokenHash: hashInviteToken(token),
      expiresAt: input.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      inviterId: input.inviterId,
    },
  });
  return { id, token };
}

/** The member rows of a user in an organization (duplicates counted, V-06). */
export function memberCount(orgId: string, userId: string): Promise<number> {
  return prisma.member.count({ where: { organizationId: orgId, userId } });
}

/** The user rows with this address (case-insensitive, as the invitation lookup compares). */
export function userCountByEmail(email: string): Promise<number> {
  return prisma.user.count({ where: { email: { equals: email, mode: "insensitive" } } });
}

/**
 * Points the organization's outgoing email at a loopback fake SMTP: enabled, a from address, host
 * 127.0.0.1, the given port, plain TCP, no SMTP user and no stored password. The fake must be
 * started with `advertiseAuth: false`, so nodemailer sends without AUTH.
 */
export async function writeFakeSmtpSettings(orgId: string, port: number): Promise<void> {
  const values: Array<[string, string]> = [
    [EMAIL_SETTING_KEYS.enabled, "true"],
    [EMAIL_SETTING_KEYS.fromAddress, "support@team.e2e.test"],
    [EMAIL_SETTING_KEYS.smtpHost, "127.0.0.1"],
    [EMAIL_SETTING_KEYS.smtpPort, String(port)],
    [EMAIL_SETTING_KEYS.smtpSecure, "false"],
    [EMAIL_SETTING_KEYS.smtpUser, ""],
  ];
  for (const [key, value] of values) {
    await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: orgId, key } },
      create: { organizationId: orgId, key, value },
      update: { value },
    });
  }
}

/** The notification rows of a recipient in an organization, newest first. */
export function notificationsFor(orgId: string, userId: string) {
  return prisma.notification.findMany({
    where: { organizationId: orgId, recipientUserId: userId },
    orderBy: { createdAt: "desc" },
  });
}
