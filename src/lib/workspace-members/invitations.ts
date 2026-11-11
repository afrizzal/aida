// The invitation service (Phase 10, AIDA-42; D-02, D-03, D-04, D-06, C2, V-23, V-26). AIDA owns
// create, revoke and accept on Better Auth's existing `invitation` table; no Better Auth
// invitation or member endpoint is called (their HTTP routes are closed by plan 10-15). The Team
// page (10-10) and the invitation page (10-08) are thin layers over this module.
//
// The link token (invite-token.ts): 32 random bytes, base64url; only its SHA-256 hex hash is stored
// in invitation.tokenHash. Expiry is 7 days. The link base is BETTER_AUTH_URL (app-url.ts), never
// a request header. Nothing here logs: the token is a bearer credential (threat T-10-21).
//
// Lock protocol (V-25). create, revoke and accept each run in ONE transaction whose first
// statement is lockOrganization (FOR NO KEY UPDATE on the organization row), so they serialise
// with role changes and deactivations of the same organization (member-admin.ts).
//
// Accept (V-23), in this order inside the locked transaction:
//   0. outside the transaction: the organization is resolved from the token hash (unknown → the
//      generic refusal);
//   1. lockOrganization(tx, thatOrgId, hooks);
//   2. the invitation re-read by tokenHash AND organizationId;
//   3. retry path first: status `accepted`, an INVITATION_ACCEPTED row with this invitationId and
//      targetUserId = the user exists, now is before expiresAt, and the user holds a member row
//      here → the session is activated again and the result is `retried: true`; nothing is
//      inserted. The Better Auth table stores no acceptor, so the append-only audit row is the
//      record of who accepted (the only decision this service reads from MemberAuditEvent);
//   4. otherwise: status `pending`; now before expiresAt (at or after it is expired); the invited
//      email equals the user's email after trim and lower-case; the role is owner, admin or
//      member; the inviter's CURRENT rights allow it (isOwner for `owner`, isAdmin otherwise,
//      V-26); the user holds no member row here (V-06: duplicates are never created);
//   5. the status moves pending → accepted by a conditional update that must hit one row; one
//      member row is inserted; INVITATION_ACCEPTED is written; the requesting session is
//      activated (activateSessionInTx). Zero session rows throws SESSION_GONE inside the
//      transaction, so the whole accept rolls back: a member row never exists without the
//      activation accept promised.
// Every other failure is INVALID_INVITATION with one generic message (D-03, threat T-10-19); the
// internal reason reaches only the test seam onRefusal.
//
// `member`, `invitation`, `session` and `user` are Better Auth models outside DOMAIN_MODELS, so
// every query writes the organization term itself.
//
// Relative imports only and no framework import.
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { Prisma } from "../../generated/prisma/client";
import { getAppBaseUrl } from "../app-url";
import { getBrandingSettings } from "../branding/settings";
import { prisma } from "../db";
import { scopedDb } from "../scoped-db";
import {
  InvitationError,
  type InvitationErrorCode,
  MemberAdminError,
  type MemberAdminErrorCode,
} from "./errors";
import { type InvitationEmailStatus, sendInvitationEmail } from "./invite-email";
import { createInviteToken, hashInviteToken, isInviteTokenShape } from "./invite-token";
import { recordMemberAudit } from "./member-audit";
import {
  isMemberRole,
  type MemberRights,
  type MemberRole,
  readMemberRights,
} from "./member-rights";
import { lockOrganization, type OrgLockHooks } from "./org-lock";

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Invitation lifetime (D-04, Claude's discretion: 7 days). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The "invited by" text of a pending invitation whose inviter is no longer a member. */
export const FORMER_MEMBER_LABEL = "a former member";

/** RFC 5321 path limit; also the UI-SPEC's long-email case. */
const MAX_EMAIL_LENGTH = 254;

/** Trimmed and lower-cased, the comparison form of an email address. */
export function normaliseInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Exactly one address that Better Auth's sign-up will also accept (K163, b-WR-4): the invitee's
 * account is created by auth.api.signUpEmail with this address, which refuses anything that
 * fails `z.email()` of the installed zod 4 (better-auth dist/api/routes/sign-up.mjs), so the same
 * schema is applied here, before any write. That rule also refuses address-list syntax (a comma,
 * a semicolon, angle brackets, a display name, a quoted local part, an IP literal), which
 * nodemailer would otherwise read as other or extra recipients. Single-label domains such as
 * `it@intranet` are refused as sign-up refuses them.
 */
const SIGN_UP_EMAIL = z.email();

function isPlausibleEmail(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at >= email.length - 1) return false;
  return SIGN_UP_EMAIL.safeParse(email).success;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** May `rights` grant `role` (D-03, V-26)? `owner` needs isOwner, the others isAdmin. */
function mayGrant(rights: MemberRights, role: MemberRole): boolean {
  return role === "owner" ? rights.isOwner : rights.isAdmin;
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

export interface CreateInvitationInput {
  orgId: string;
  actorUserId: string;
  /** Untrusted: trimmed and lower-cased before any check or write. */
  email: string;
  /** Untrusted: anything outside owner, admin and member is INVALID_ROLE. */
  role: string;
}

/** createInvitation's refusals: the frozen MemberAdminError codes plus a malformed address. */
export type CreateInvitationErrorCode = MemberAdminErrorCode | "INVALID_EMAIL";

export type CreateInvitationFailure = { ok: false; error: CreateInvitationErrorCode };

interface CreatedInvitation {
  ok: true;
  invitationId: string;
  /** The normalised invited address. */
  email: string;
  role: MemberRole;
  expiresAt: Date;
}

/**
 * D-06: the link (BETTER_AUTH_URL base plus `/invite/` plus the raw token) is returned to the
 * inviting owner or admin only when the email was not delivered (smtp_off or send_failed); in no
 * other case. The raw token is never stored and never returned on its own.
 */
export type CreateInvitationSuccess =
  | (CreatedInvitation & { delivery: "sent" })
  | (CreatedInvitation & { delivery: "smtp_off" | "send_failed"; link: string });

/** Test seams of createInvitation (the 10-01 lock seam). Production callers pass none. */
export type CreateInvitationHooks = OrgLockHooks<Tx>;

/**
 * Creates a pending invitation of orgId for `email` with `role` (D-03, D-04): the base URL is
 * resolved first (missing or invalid BETTER_AUTH_URL → INVITE_CONFIG, nothing written); then, in
 * one transaction under the organization lock: the actor must have admin rights (NOT_ALLOWED);
 * only an owner may invite an owner (ROLE_ABOVE_OWN); a user with that email who holds any member
 * row here → ALREADY_MEMBER; an unexpired pending invitation for that email here →
 * PENDING_EXISTS; the row is inserted with only the token's hash, expiring 7 days after `now`, and
 * INVITATION_CREATED is written. After the commit the invitation email is sent through the
 * organization's SMTP settings (invite-email.ts); the link comes back only when it was not
 * delivered (D-06).
 */
export async function createInvitation(
  input: CreateInvitationInput,
  now: Date = new Date(),
  hooks?: CreateInvitationHooks,
): Promise<CreateInvitationSuccess | CreateInvitationFailure> {
  let baseUrl: string;
  try {
    baseUrl = getAppBaseUrl();
  } catch {
    return { ok: false, error: "INVITE_CONFIG" };
  }
  const { orgId, actorUserId } = input;
  if (!isNonEmptyString(orgId) || !isNonEmptyString(actorUserId)) {
    return { ok: false, error: "NOT_ALLOWED" };
  }
  const email = typeof input.email === "string" ? normaliseInviteEmail(input.email) : "";
  if (!isPlausibleEmail(email)) return { ok: false, error: "INVALID_EMAIL" };
  const role = input.role;
  if (!isMemberRole(role)) return { ok: false, error: "INVALID_ROLE" };

  const token = createInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  try {
    const { invitationId, inviterName, orgName } = await prisma.$transaction(async (tx) => {
      if (!(await lockOrganization(tx, orgId, hooks))) throw new MemberAdminError("NOT_ALLOWED");
      const actor = await readMemberRights(tx, orgId, actorUserId);
      if (!actor.isAdmin) throw new MemberAdminError("NOT_ALLOWED");
      if (role === "owner" && !actor.isOwner) throw new MemberAdminError("ROLE_ABOVE_OWN");
      const inviter = await tx.user.findUnique({
        where: { id: actorUserId },
        select: { name: true },
      });
      const organization = await tx.organization.findUnique({
        where: { id: orgId },
        select: { name: true },
      });

      const users = await tx.user.findMany({
        where: { email: { contains: email, mode: "insensitive" } },
        select: { id: true, email: true },
      });
      const userIds = users.filter((u) => normaliseInviteEmail(u.email) === email).map((u) => u.id);
      if (userIds.length > 0) {
        const existing = await tx.member.findFirst({
          where: { organizationId: orgId, userId: { in: userIds } },
          select: { id: true },
        });
        if (existing) throw new MemberAdminError("ALREADY_MEMBER");
      }

      const pending = await tx.invitation.findMany({
        where: {
          organizationId: orgId,
          status: "pending",
          expiresAt: { gt: now },
          email: { contains: email, mode: "insensitive" },
        },
        select: { email: true },
      });
      if (pending.some((p) => normaliseInviteEmail(p.email) === email)) {
        throw new MemberAdminError("PENDING_EXISTS");
      }

      const id = randomUUID();
      await tx.invitation.create({
        data: {
          id,
          organizationId: orgId,
          email,
          role,
          status: "pending",
          tokenHash,
          expiresAt,
          createdAt: now,
          inviterId: actorUserId,
        },
      });
      await recordMemberAudit(tx, orgId, {
        actorUserId,
        action: "INVITATION_CREATED",
        invitationId: id,
        newRole: role,
      });
      return {
        invitationId: id,
        inviterName: inviter?.name.trim() ?? "",
        orgName: organization?.name ?? "",
      };
    }, TRANSACTION_OPTIONS);

    const link = `${baseUrl}/invite/${token}`;
    const delivery = await deliverInvitation(orgId, {
      to: email,
      inviterName,
      orgName,
      role,
      link,
      expiresAt,
    });
    const base: CreatedInvitation = { ok: true, invitationId, email, role, expiresAt };
    return delivery === "sent" ? { ...base, delivery } : { ...base, delivery, link };
  } catch (err) {
    if (err instanceof MemberAdminError) return { ok: false, error: err.code };
    throw err;
  }
}

/**
 * Sends the committed invitation's email. Never throws: the invitation already exists, so any
 * failure here (the branding read included) is send_failed and the caller returns the link.
 */
async function deliverInvitation(
  orgId: string,
  input: {
    to: string;
    inviterName: string;
    orgName: string;
    role: MemberRole;
    link: string;
    expiresAt: Date;
  },
): Promise<InvitationEmailStatus> {
  try {
    const db = scopedDb(orgId);
    const branding = await getBrandingSettings(db, input.orgName);
    return await sendInvitationEmail(db, {
      to: input.to,
      inviterName: input.inviterName || "A workspace admin",
      workspaceName: branding.workspaceName,
      role: input.role,
      link: input.link,
      expiresAt: input.expiresAt,
    });
  } catch {
    return "send_failed";
  }
}

// ---------------------------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------------------------

export interface RevokeInvitationInput {
  orgId: string;
  actorUserId: string;
  invitationId: string;
}

/** NOT_PENDING: no pending invitation with that id in this organization. */
export type RevokeInvitationErrorCode = "NOT_ALLOWED" | "NOT_PENDING";

export type RevokeInvitationResult = { ok: true } | { ok: false; error: RevokeInvitationErrorCode };

/** Test seams of revokeInvitation (the 10-01 lock seam). Production callers pass none. */
export type RevokeInvitationHooks = OrgLockHooks<Tx>;

/**
 * Cancels a pending invitation of orgId, under the organization lock: the actor must have admin
 * rights (NOT_ALLOWED); only a pending invitation of this organization moves to `canceled`
 * (NOT_PENDING otherwise, changing nothing); INVITATION_REVOKED is written.
 */
export async function revokeInvitation(
  { orgId, actorUserId, invitationId }: RevokeInvitationInput,
  hooks?: RevokeInvitationHooks,
): Promise<RevokeInvitationResult> {
  if (!isNonEmptyString(orgId) || !isNonEmptyString(actorUserId)) {
    return { ok: false, error: "NOT_ALLOWED" };
  }
  if (!isNonEmptyString(invitationId)) return { ok: false, error: "NOT_PENDING" };

  return prisma.$transaction(async (tx): Promise<RevokeInvitationResult> => {
    if (!(await lockOrganization(tx, orgId, hooks))) return { ok: false, error: "NOT_ALLOWED" };
    const actor = await readMemberRights(tx, orgId, actorUserId);
    if (!actor.isAdmin) return { ok: false, error: "NOT_ALLOWED" };
    const { count } = await tx.invitation.updateMany({
      where: { id: invitationId, organizationId: orgId, status: "pending" },
      data: { status: "canceled" },
    });
    if (count !== 1) return { ok: false, error: "NOT_PENDING" };
    await recordMemberAudit(tx, orgId, {
      actorUserId,
      action: "INVITATION_REVOKED",
      invitationId,
    });
    return { ok: true };
  }, TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------------------------

/** The session to activate: its id (from the fresh session read) or its token (just signed in). */
export type SessionRef = { id: string } | { token: string };

export interface ActivateSessionInput {
  userId: string;
  orgId: string;
  session: SessionRef;
  now: Date;
}

/**
 * Sets activeOrganizationId = orgId on exactly the requesting session row: matched by its id or
 * token, owned by userId, and not expired at `now`. Any count other than one throws
 * InvitationError SESSION_GONE inside the caller's transaction, so the caller's whole transaction
 * rolls back (V-23).
 */
export async function activateSessionInTx(
  tx: Tx,
  { userId, orgId, session, now }: ActivateSessionInput,
): Promise<void> {
  const ref =
    "id" in session && isNonEmptyString(session.id)
      ? { id: session.id }
      : "token" in session && isNonEmptyString(session.token)
        ? { token: session.token }
        : null;
  if (!ref || !isNonEmptyString(userId) || !isNonEmptyString(orgId)) {
    throw new InvitationError("SESSION_GONE", "no-session");
  }
  const { count } = await tx.session.updateMany({
    where: { ...ref, userId, expiresAt: { gt: now } },
    data: { activeOrganizationId: orgId },
  });
  if (count !== 1) throw new InvitationError("SESSION_GONE", "session-gone");
}

export interface AcceptInvitationInput {
  /** The raw link token. */
  token: string;
  userId: string;
  /** The signed-in user's email (from the fresh session read). */
  userEmail: string;
  session: SessionRef;
}

/** Test seams of acceptInvitation. Production callers pass none. */
export interface AcceptInvitationHooks extends OrgLockHooks<Tx> {
  /** Called once with the internal reason of a refusal (tests only; never shown or logged). */
  onRefusal?(reason: string | undefined, code: InvitationErrorCode): void;
}

export type AcceptInvitationResult =
  | { ok: true; orgId: string; role: MemberRole; retried: boolean }
  | { ok: false; error: InvitationErrorCode };

/** Throws the one generic refusal with an internal reason (D-03). */
function refuse(reason: string): never {
  throw new InvitationError("INVALID_INVITATION", reason);
}

/**
 * Accepts the invitation behind `token` for userId and activates `session` on its organization,
 * all in one transaction under the organization lock (see the header for the order). Returns
 * `{ ok: true, orgId, role, retried }` or `{ ok: false, error }` with INVALID_INVITATION (one
 * generic refusal) or SESSION_GONE (sign in again; nothing was accepted).
 */
export async function acceptInvitation(
  { token, userId, userEmail, session }: AcceptInvitationInput,
  hooks?: AcceptInvitationHooks,
  now: Date = new Date(),
): Promise<AcceptInvitationResult> {
  try {
    if (!isInviteTokenShape(token)) refuse("unknown");
    if (!isNonEmptyString(userId) || typeof userEmail !== "string") refuse("no-user");
    const tokenHash = hashInviteToken(token);

    // Resolve the organization outside the transaction, so the lock is taken on the right row.
    const located = await prisma.invitation.findUnique({
      where: { tokenHash },
      select: { organizationId: true },
    });
    if (!located) refuse("unknown");
    const orgId = located.organizationId;

    return await prisma.$transaction(async (tx): Promise<AcceptInvitationResult> => {
      if (!(await lockOrganization(tx, orgId, hooks))) refuse("unknown");
      const found = await tx.invitation.findFirst({
        where: { tokenHash, organizationId: orgId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          inviterId: true,
        },
      });
      if (!found) refuse("unknown");
      const invitation = found;
      const rights = await readMemberRights(tx, orgId, userId);

      // Retry path (V-23): a response lost after commit. Activate again; never insert.
      if (invitation.status === "accepted") {
        const acceptedByUser = await tx.memberAuditEvent.findFirst({
          where: {
            organizationId: orgId,
            action: "INVITATION_ACCEPTED",
            invitationId: invitation.id,
            targetUserId: userId,
          },
          select: { id: true },
        });
        if (!acceptedByUser) refuse("used");
        // Bounded by the link's own expiry (review b-IN-5): the email promises a link that
        // expires, so an accepted link is no permanent "switch organization" handle.
        if (now.getTime() >= invitation.expiresAt.getTime()) refuse("expired");
        if (!rights.isMember) refuse("member-gone");
        await activateSessionInTx(tx, { userId, orgId, session, now });
        const role = isMemberRole(invitation.role) ? invitation.role : "member";
        return { ok: true, orgId, role, retried: true };
      }

      if (invitation.status !== "pending") refuse("not-pending");
      if (now.getTime() >= invitation.expiresAt.getTime()) refuse("expired");

      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) refuse("no-user");
      const invited = normaliseInviteEmail(invitation.email);
      if (
        invited !== normaliseInviteEmail(user.email) ||
        invited !== normaliseInviteEmail(userEmail)
      ) {
        refuse("email-mismatch");
      }
      const role = invitation.role;
      if (!isMemberRole(role)) refuse("role");

      const inviter = await readMemberRights(tx, orgId, invitation.inviterId);
      if (!mayGrant(inviter, role)) refuse("inviter");
      if (rights.isMember) refuse("already-member");

      const { count } = await tx.invitation.updateMany({
        where: { id: invitation.id, organizationId: orgId, status: "pending" },
        data: { status: "accepted" },
      });
      if (count !== 1) refuse("not-pending");
      await tx.member.create({
        data: { id: randomUUID(), organizationId: orgId, userId, role, createdAt: now },
      });
      await recordMemberAudit(tx, orgId, {
        actorUserId: userId,
        action: "INVITATION_ACCEPTED",
        targetUserId: userId,
        invitationId: invitation.id,
        newRole: role,
      });
      await activateSessionInTx(tx, { userId, orgId, session, now });
      return { ok: true, orgId, role, retried: false };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof InvitationError) {
      hooks?.onRefusal?.(err.reason, err.code);
      return { ok: false, error: err.code };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export type InvitationView =
  | {
      state: "valid";
      /** The workspace display name: the branding name, else the organization name. */
      workspaceName: string;
      role: MemberRole;
      /** The invited address (normalised as stored). */
      email: string;
      /** A user with that email exists (the page offers sign-in instead of sign-up). */
      accountExists: boolean;
      expiresAt: Date;
    }
  | { state: "invalid" };

/**
 * What the invitation page shows for `token`: the valid view only for a pending, unexpired
 * invitation with a known role whose inviter may still grant it; `{ state: "invalid" }` for every
 * other case, identical whatever the reason (D-03).
 */
export async function getInvitationView(
  token: string,
  now: Date = new Date(),
): Promise<InvitationView> {
  const invalid = { state: "invalid" } as const;
  if (!isInviteTokenShape(token)) return invalid;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      organizationId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      inviterId: true,
      organization: { select: { name: true } },
    },
  });
  if (invitation?.status !== "pending") return invalid;
  if (now.getTime() >= invitation.expiresAt.getTime()) return invalid;
  const role = invitation.role;
  if (!isMemberRole(role)) return invalid;
  const orgId = invitation.organizationId;
  if (!mayGrant(await readMemberRights(prisma, orgId, invitation.inviterId), role)) return invalid;

  const email = normaliseInviteEmail(invitation.email);
  const candidates = await prisma.user.findMany({
    where: { email: { contains: email, mode: "insensitive" } },
    select: { email: true },
  });
  const branding = await getBrandingSettings(scopedDb(orgId), invitation.organization.name);
  return {
    state: "valid",
    workspaceName: branding.workspaceName,
    role,
    email,
    accountExists: candidates.some((u) => normaliseInviteEmail(u.email) === email),
    expiresAt: invitation.expiresAt,
  };
}

export interface PendingInvitation {
  invitationId: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
  /** The inviter's name while they are a member here, else FORMER_MEMBER_LABEL. */
  invitedBy: string;
}

/**
 * The pending, unexpired invitations of orgId, newest first. The caller gates access (owners and
 * admins); this reads with the explicit organization term. A row whose role is unknown is listed
 * as `member`, never as admin or owner.
 */
export async function listPendingInvitations(
  orgId: string,
  now: Date = new Date(),
): Promise<PendingInvitation[]> {
  if (!isNonEmptyString(orgId)) return [];
  const rows = await prisma.invitation.findMany({
    where: { organizationId: orgId, status: "pending", expiresAt: { gt: now } },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      inviterId: true,
      user: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const inviterIds = [...new Set(rows.map((r) => r.inviterId))];
  const memberRows =
    inviterIds.length === 0
      ? []
      : await prisma.member.findMany({
          where: { organizationId: orgId, userId: { in: inviterIds } },
          select: { userId: true },
        });
  const stillMembers = new Set(memberRows.map((m) => m.userId));
  return rows.map((r) => {
    const name = r.user.name.trim();
    return {
      invitationId: r.id,
      email: r.email,
      role: isMemberRole(r.role) ? r.role : "member",
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      invitedBy: stillMembers.has(r.inviterId) && name !== "" ? name : FORMER_MEMBER_LABEL,
    };
  });
}
