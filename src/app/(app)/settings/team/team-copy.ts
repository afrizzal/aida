// The Copywriting Contract rows of Settings -> Team (Phase 10, UI-SPEC Surface 1, AIDA-42, AIDA-43),
// verbatim, plus amendment A7 (reassignment counts and retry, plan 10-10). One module so the page,
// the client components and the server actions use the same text; it holds no data and reads
// nothing. The server actions map each service error code to exactly one of the error keys below,
// and the client renders the key; raw error text never reaches the browser.

import { MEMBERSHIP_ENDED } from "@/lib/tickets/state-copy";

export type TeamRole = "owner" | "admin" | "member";

/** "Role labels". */
export const ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** The roles an actor may grant (D-03): owners all three, admins Member and Admin, members none. */
export function grantableRoles(actorRole: TeamRole): TeamRole[] {
  if (actorRole === "owner") return ["member", "admin", "owner"];
  if (actorRole === "admin") return ["member", "admin"];
  return [];
}

// Page ----------------------------------------------------------------------------------------

export const TEAM_TITLE = "Team";
export const TEAM_SUBTITLE = "People in this workspace and the role each one has.";
export const MEMBERS_HEADING = "Members";
export const MEMBERS_ADMIN_ONLY =
  "Only workspace owners and admins can invite people or change members.";
export const PENDING_HEADING = "Pending invitations";
export const PENDING_EMPTY = "No pending invitations.";
export const YOU_BADGE = "You";
export const OWNER_ROW_TOOLTIP = "Only an owner can change another owner.";

/** "Members count": "{N} people" / "1 person". */
export function membersCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** "Pending row meta": "{Role} · invited by {inviter name} · expires {relative time}". */
export function pendingRowMeta(role: TeamRole, invitedBy: string, expiresIn: string): string {
  return `${ROLE_LABELS[role]} · invited by ${invitedBy} · expires ${expiresIn}`;
}

/** "{relative time}" of the pending row meta, future-facing ("in 6 days", "in 3 hours"). */
export function expiresInText(expiresAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "in 1 minute" : `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

// Role change ---------------------------------------------------------------------------------

/** aria-label of a row's role Select: "Role for {name}". */
export function roleSelectLabel(name: string): string {
  return `Role for ${name}`;
}

/** "Role changed toast": "{Name} is now {role}." */
export function roleChangedToast(name: string, role: TeamRole): string {
  return `${name} is now ${ROLE_LABELS[role].toLowerCase()}.`;
}

export type RoleErrorKey = "last_owner" | "not_allowed" | "membership_ended" | "unknown";

export const ROLE_ERRORS: Readonly<Record<RoleErrorKey, string>> = {
  last_owner: "A workspace needs at least one owner. Make someone else an owner first.",
  not_allowed: "You can't make this change with your role.",
  // K164: the app's one MEMBERSHIP_ENDED sentence (src/lib/tickets/state-copy.ts), no new copy.
  membership_ended: MEMBERSHIP_ENDED,
  unknown: "The role could not be changed. Wait a moment and try again.",
};

// Deactivate ----------------------------------------------------------------------------------

export const DEACTIVATE_TRIGGER = "Deactivate member";
export const DEACTIVATE_CONFIRM = "Deactivate member";
export const DEACTIVATE_KEEP = "Keep member";
export const DEACTIVATING = "Deactivating…";
export const DEACTIVATE_DESCRIPTION =
  "They lose access right away, including any session that is open now. Their account stays, and they can rejoin only with a new invitation. Invitations they sent that nobody accepted are revoked.";
export const REASSIGN_LABEL = "Reassign their open tickets to";
export const REASSIGN_KEEP = "Keep them assigned";

export function deactivateTitle(name: string): string {
  return `Remove ${name} from this workspace?`;
}

/** "Deactivate: open tickets line". */
export function openTicketsLine(name: string, n: number): string {
  return `${name} has ${n} open tickets assigned.`;
}

/** "Deactivated toast". */
export function deactivatedToast(name: string): string {
  return `${name} was removed from the workspace.`;
}

/** Amendment A7: appended to the deactivated toast when reassignment skipped tickets. */
export function reassignSkippedText(m: number): string {
  return `${m} tickets were left as they are because someone changed them first.`;
}

/** Amendment A7: the warning callout when some open tickets could not be reassigned. */
export function reassignFailedText(name: string, k: number): string {
  return `${name} was removed. ${k} open tickets could not be reassigned.`;
}

/** Amendment A7: the retry button of the reassignment callout. */
export const REASSIGN_RETRY = "Try again";

export type DeactivateErrorKey = "last_owner" | "not_allowed" | "membership_ended" | "unknown";

/** `not_allowed` reuses the role-change refusal copy (K162): a permanent refusal, no "try again". */
export function deactivateError(key: DeactivateErrorKey, name: string): string {
  if (key === "last_owner") {
    return "This would leave the workspace without an owner or admin. Change another member's role first.";
  }
  if (key === "not_allowed") return ROLE_ERRORS.not_allowed;
  if (key === "membership_ended") return MEMBERSHIP_ENDED;
  return `${name} could not be removed. Wait a moment and try again.`;
}

// Invite --------------------------------------------------------------------------------------

export const INVITE_BUTTON = "Invite member";
export const INVITE_TITLE = "Invite a member";
export const INVITE_DESCRIPTION =
  "They get an email with a link that works for 7 days. They join with the role you pick here.";
export const INVITE_EMAIL_LABEL = "Email";
export const INVITE_ROLE_LABEL = "Role";
export const INVITE_ROLE_HELP =
  "Admins can invite people and change members. Only owners can add or change owners.";
export const INVITE_SUBMIT = "Send invitation";
export const INVITE_SENDING = "Sending…";
export const INVITE_DISMISS_FORM = "Close without sending";
export const INVITE_DISMISS_RESULT = "Return to team";
export const COPY_LINK = "Copy link";
export const COPIED = "Copied";
export const INVITATION_LINK_LABEL = "Invitation link";

export function inviteSentToast(email: string): string {
  return `Invitation sent to ${email}.`;
}

export function copyLinkNotice(delivery: "smtp_off" | "send_failed", email: string): string {
  const lead =
    delivery === "smtp_off"
      ? "Email is not set up on this server, so no email was sent."
      : "The invitation email could not be sent.";
  return `${lead} Copy this link and send it to ${email} yourself. It works once and expires in 7 days.`;
}

export type InviteErrorKey =
  | "invalid_email"
  | "already_member"
  | "pending_exists"
  | "role_above_own"
  | "not_allowed"
  | "membership_ended"
  | "unknown";

export function inviteError(key: InviteErrorKey, email: string): string {
  switch (key) {
    case "invalid_email":
      return "Enter a valid email address.";
    case "already_member":
      return `${email} is already a member of this workspace.`;
    case "pending_exists":
      return `${email} already has a pending invitation. Revoke it first to send a new one.`;
    case "role_above_own":
      return "You can only invite people with a role up to your own.";
    case "not_allowed":
      return "Only workspace owners and admins can invite people.";
    case "membership_ended":
      return MEMBERSHIP_ENDED;
    default:
      return "The invitation could not be created. Wait a moment and try again.";
  }
}

// Revoke --------------------------------------------------------------------------------------

export const REVOKE_TRIGGER = "Revoke invitation";
export const REVOKE_CONFIRM = "Revoke invitation";
export const REVOKE_KEEP = "Keep invitation";
export const REVOKING = "Revoking…";
export const REVOKE_DESCRIPTION =
  "The link stops working at once. You can send a new invitation later.";
export const REVOKED_TOAST = "Invitation revoked.";
export const REVOKE_ERROR = "The invitation could not be revoked. Wait a moment and try again.";

export function revokeTitle(email: string): string {
  return `Revoke the invitation for ${email}?`;
}

// Identity ------------------------------------------------------------------------------------

/** The name line: the display name, or the email when the member has none (E1 partial). */
export function displayName(name: string, email: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? email : trimmed;
}

/** Up to two initials from the display name, or from the email's local part (E1 partial). */
export function initialsOf(name: string, email: string): string {
  const trimmed = name.trim();
  const source = trimmed === "" ? (email.split("@")[0] ?? "") : trimmed;
  const parts = source.split(trimmed === "" ? /[\s._+-]+/ : /\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
  return initials === "" ? "?" : initials;
}
