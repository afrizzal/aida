// The refusals of the Phase 10 workspace-member services (membership administration and
// invitations). Same contract as tickets/ticket-state-admin.ts: a service throws one of these
// INSIDE its transaction, so the whole transaction rolls back, and returns `{ ok: false, error }`
// OUTSIDE it; the error is never rethrown to the caller.
//
// Relative imports only and no framework import: the worker may bundle it.

/** Frozen for the Team page and the later Phase 10 plans. */
export type MemberAdminErrorCode =
  | "LAST_OWNER"
  | "NOT_ALLOWED"
  | "NOT_A_MEMBER"
  | "INVALID_ROLE"
  | "SELF_CHANGE"
  | "INVALID_REASSIGNEE"
  | "INVITE_CONFIG"
  | "ROLE_ABOVE_OWN"
  | "ALREADY_MEMBER"
  | "PENDING_EXISTS"
  | "MEMBERSHIP_ENDED";

export const MEMBER_ADMIN_ERROR_CODES: readonly MemberAdminErrorCode[] = [
  "LAST_OWNER",
  "NOT_ALLOWED",
  "NOT_A_MEMBER",
  "INVALID_ROLE",
  "SELF_CHANGE",
  "INVALID_REASSIGNEE",
  "INVITE_CONFIG",
  "ROLE_ABOVE_OWN",
  "ALREADY_MEMBER",
  "PENDING_EXISTS",
  "MEMBERSHIP_ENDED",
];

/** A refusal by a membership administration service. Rolled back and returned, never rethrown. */
export class MemberAdminError extends Error {
  readonly code: MemberAdminErrorCode;

  constructor(code: MemberAdminErrorCode) {
    super(`Member administration refused: ${code}`);
    this.name = "MemberAdminError";
    this.code = code;
  }
}

export type MemberAdminFailure = { ok: false; error: MemberAdminErrorCode };

/**
 * INVALID_INVITATION: the link is unknown, reused, expired, revoked, for another email or for an
 * inviter who may no longer invite; the user sees one generic message that reveals nothing about
 * the invitation or other organizations (D-03).
 * SESSION_GONE: the requesting session was signed out or deleted before accept committed, so
 * accept rolled back and the user must sign in again (V-23, review R2-2).
 */
export type InvitationErrorCode = "INVALID_INVITATION" | "SESSION_GONE";

export const INVITATION_ERROR_CODES: readonly InvitationErrorCode[] = [
  "INVALID_INVITATION",
  "SESSION_GONE",
];

/**
 * The one user-facing text of INVALID_INVITATION, whatever the internal reason: the title of
 * UI-SPEC's "Invite page: invalid" card (one generic message for every failure kind).
 */
export const INVALID_INVITATION_MESSAGE = "This invitation link is not valid";

/** The user-facing text of SESSION_GONE. */
export const SESSION_GONE_MESSAGE =
  "Your session has ended. Sign in again to accept the invitation.";

/**
 * A refusal by the invitation services. `message` is the user-facing text only. `reason` says
 * which check refused (for example "expired" or "email-mismatch"); it is read only by tests and is
 * never shown, logged with the token, or returned to the client.
 */
export class InvitationError extends Error {
  readonly code: InvitationErrorCode;
  readonly reason: string | undefined;

  constructor(code: InvitationErrorCode, reason?: string) {
    super(code === "INVALID_INVITATION" ? INVALID_INVITATION_MESSAGE : SESSION_GONE_MESSAGE);
    this.name = "InvitationError";
    this.code = code;
    this.reason = reason;
  }
}

export type InvitationFailure = { ok: false; error: InvitationErrorCode };
