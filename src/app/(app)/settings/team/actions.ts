"use server";

import { revalidatePath } from "next/cache";
import { getSessionActor } from "@/lib/session";
import { createInvitation, revokeInvitation } from "@/lib/workspace-members/invitations";
import {
  changeMemberRole,
  countOpenAssignedTickets,
  deactivateMember,
  reassignOpenTickets,
} from "@/lib/workspace-members/member-admin";
import type { DeactivateErrorKey, InviteErrorKey, RoleErrorKey, TeamRole } from "./team-copy";

// The server actions of /settings/team (Phase 10, AIDA-43, AIDA-42 UI; D-08, V-27, K141). Each
// action reads the session ONCE through the session actor helper (the actor never comes from
// input) and passes the untrusted input to a 10-03 or 10-05 service under
// src/lib/workspace-members/, which re-reads the actor's rights inside its locked transaction: the
// server decides every permission, whatever the browser showed (T-10-39, T-10-41). A refusal is
// returned as one Copywriting key and never thrown; raw error text and codes do not reach the
// browser. The page is revalidated only after a change, so a refusal does not re-render the route
// and the client keeps its state.

const TEAM_PATH = "/settings/team";

export type ChangeRoleResult = { ok: true; role: TeamRole } | { ok: false; error: RoleErrorKey };

/** Changes the role of targetUserId in the actor's organization (changeMemberRole, 10-03). */
export async function changeRoleAction(
  targetUserId: unknown,
  newRole: unknown,
): Promise<ChangeRoleResult> {
  if (typeof targetUserId !== "string" || typeof newRole !== "string") {
    return { ok: false, error: "unknown" };
  }
  const actor = await getSessionActor();
  const result = await changeMemberRole({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    targetUserId,
    newRole,
  });
  if (!result.ok) {
    switch (result.error) {
      case "LAST_OWNER":
        return { ok: false, error: "last_owner" };
      case "NOT_ALLOWED":
      case "SELF_CHANGE":
        return { ok: false, error: "not_allowed" };
      default:
        return { ok: false, error: "unknown" };
    }
  }
  revalidatePath(TEAM_PATH);
  // changeMemberRole accepted newRole, so it is one of the three roles.
  return { ok: true, role: newRole as TeamRole };
}

/**
 * The counts of one reassignment run (amendment A7). `failed` is null only when even the count
 * of what is left could not be read; the dialog then shows the count it already had.
 */
export interface ReassignCounts {
  reassigned: number;
  skipped: number;
  failed: number | null;
}

/**
 * reassignOpenTickets (10-03) for an actor already read by the calling action. A refusal
 * (NOT_ALLOWED, INVALID_REASSIGNEE) or an error before the first batch moved nothing, so every
 * open ticket still assigned to fromUserId counts as failed and a retry picks it up. That count is
 * read only when `mayCount` says the actor was just proven to hold admin rights (the deactivation
 * committed); otherwise a refusal returns null and an error reports `failed: null`, so no member
 * can read another user's open-ticket count through this path (review b-IN-2).
 */
async function runReassignment(
  orgId: string,
  actorUserId: string,
  fromUserId: string,
  toUserId: string,
  mayCount: boolean,
): Promise<ReassignCounts | null> {
  try {
    const result = await reassignOpenTickets({ orgId, actorUserId, fromUserId, toUserId });
    if (result.ok) {
      return { reassigned: result.reassigned, skipped: result.skipped, failed: result.failed };
    }
    if (!mayCount) return null;
  } catch {
    // Falls through: nothing is known to have moved.
    if (!mayCount) return { reassigned: 0, skipped: 0, failed: null };
  }
  const left = await countOpenAssignedTickets(orgId, fromUserId).catch(() => null);
  return { reassigned: 0, skipped: 0, failed: left };
}

export type DeactivateResult =
  | ({ ok: true } & ReassignCounts)
  | { ok: false; error: DeactivateErrorKey };

/**
 * Deactivates targetUserId in the actor's organization (deactivateMember, 10-03, D-07). When a
 * reassignee is given, the target's open tickets move to them AFTER the deactivation committed,
 * through reassignOpenTickets with the same actor: a ticket assigned or resolved in between is
 * skipped, never overwritten (T-10-42). Reassignment is offered, never forced; null keeps them.
 */
export async function deactivateMemberAction(
  targetUserId: unknown,
  reassignToUserId: unknown,
): Promise<DeactivateResult> {
  if (
    typeof targetUserId !== "string" ||
    (reassignToUserId !== null && typeof reassignToUserId !== "string")
  ) {
    return { ok: false, error: "unknown" };
  }
  const actor = await getSessionActor();
  const result = await deactivateMember({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    targetUserId,
  });
  if (!result.ok) {
    switch (result.error) {
      case "LAST_OWNER":
        return { ok: false, error: "last_owner" };
      // A permanent refusal is never phrased as "try again" (K162, b-WR-2).
      case "NOT_ALLOWED":
      case "SELF_CHANGE":
        return { ok: false, error: "not_allowed" };
      default:
        return { ok: false, error: "unknown" };
    }
  }
  revalidatePath(TEAM_PATH);
  if (reassignToUserId === null) return { ok: true, reassigned: 0, skipped: 0, failed: 0 };
  // The deactivation just committed under the actor's admin check, so the count may be read.
  const counts = await runReassignment(
    actor.orgId,
    actor.userId,
    targetUserId,
    reassignToUserId,
    true,
  );
  return { ok: true, ...(counts ?? { reassigned: 0, skipped: 0, failed: null }) };
}

export type ReassignResult = ({ ok: true } & ReassignCounts) | { ok: false };

/** Retries the reassignment of a deactivated member's open tickets (amendment A7). */
export async function reassignTicketsAction(
  fromUserId: unknown,
  toUserId: unknown,
): Promise<ReassignResult> {
  if (typeof fromUserId !== "string" || typeof toUserId !== "string") return { ok: false };
  const actor = await getSessionActor();
  const counts = await runReassignment(actor.orgId, actor.userId, fromUserId, toUserId, false);
  // A refusal changed nothing: no count, and no re-render of the page (review b-IN-2).
  if (counts === null) return { ok: false };
  revalidatePath(TEAM_PATH);
  return { ok: true, ...counts };
}

/** RFC 5321 path limit; createInvitation applies the full address check. */
const MAX_EMAIL_LENGTH = 254;

export type InviteResult =
  | { ok: true; delivery: "sent"; email: string }
  | { ok: true; delivery: "smtp_off" | "send_failed"; email: string; link: string }
  | { ok: false; error: InviteErrorKey };

/**
 * Invites one email with one role into the actor's organization (createInvitation, 10-05, D-03,
 * D-06). The service re-checks the actor's rights and role ceiling under the organization lock.
 * The link is returned only when the email was not delivered (smtp_off, send_failed) and only to
 * this owner or admin; it is never logged and never stored here (T-10-40).
 */
export async function inviteMemberAction(email: unknown, role: unknown): Promise<InviteResult> {
  if (typeof email !== "string" || email.trim().length === 0 || email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, error: "invalid_email" };
  }
  if (typeof role !== "string") return { ok: false, error: "unknown" };
  const actor = await getSessionActor();
  let result: Awaited<ReturnType<typeof createInvitation>>;
  try {
    result = await createInvitation({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      email,
      role,
    });
  } catch {
    // No error text reaches the browser or the log from here.
    return { ok: false, error: "unknown" };
  }
  if (!result.ok) {
    switch (result.error) {
      case "INVALID_EMAIL":
        return { ok: false, error: "invalid_email" };
      case "ALREADY_MEMBER":
        return { ok: false, error: "already_member" };
      case "PENDING_EXISTS":
        return { ok: false, error: "pending_exists" };
      case "ROLE_ABOVE_OWN":
        return { ok: false, error: "role_above_own" };
      case "NOT_ALLOWED":
        return { ok: false, error: "not_allowed" };
      // INVITE_CONFIG (no valid BETTER_AUTH_URL) has no Copywriting row of its own: the unknown row.
      default:
        return { ok: false, error: "unknown" };
    }
  }
  revalidatePath(TEAM_PATH);
  if (result.delivery === "sent") return { ok: true, delivery: "sent", email: result.email };
  return { ok: true, delivery: result.delivery, email: result.email, link: result.link };
}

export type RevokeResult = { ok: boolean };

/** Revokes a pending invitation of the actor's organization (revokeInvitation, 10-05). */
export async function revokeInvitationAction(invitationId: unknown): Promise<RevokeResult> {
  if (typeof invitationId !== "string") return { ok: false };
  const actor = await getSessionActor();
  const result = await revokeInvitation({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    invitationId,
  });
  if (!result.ok) return { ok: false };
  revalidatePath(TEAM_PATH);
  return { ok: true };
}
