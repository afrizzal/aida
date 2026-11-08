// The ONE write path into MemberAuditEvent (Phase 10, D-12). Every membership change
// (invitation created, revoked or accepted, role changed, member deactivated) records one row
// through this module, inside the same transaction as the change itself.
//
// Privacy (AIDA-43 prohibition): a row holds ids, an action, roles and a timestamp only. Never
// pass an invitation token, an email address, an email body or any customer text. The entry type
// below accepts no other field, and the writer copies only the named fields.
//
// The table is append-only at the database level (trigger aida_member_audit_event_immutable);
// this module only ever INSERTs. actorUserId and targetUserId are plain text with no user
// relation, so removing a user never touches an audit row (V-14).
//
// Relative imports only and no framework import: the worker may bundle it.
import type { MemberAuditAction } from "../../generated/prisma/client";

export interface MemberAuditEntry {
  actorUserId: string;
  action: MemberAuditAction;
  targetUserId?: string | null;
  invitationId?: string | null;
  oldRole?: string | null;
  newRole?: string | null;
}

/**
 * The transaction client recordMemberAudit needs. Typed structurally so the global prisma
 * client, a scopedDb client and either one's interactive transaction client all fit.
 * organizationId is always written explicitly, so the unscoped client is safe too.
 */
export interface MemberAuditTx {
  memberAuditEvent: {
    create(args: {
      data: {
        organizationId: string;
        actorUserId: string;
        action: MemberAuditAction;
        targetUserId: string | null;
        invitationId: string | null;
        oldRole: string | null;
        newRole: string | null;
      };
      select: { id: true };
    }): PromiseLike<{ id: string }>;
  };
}

/** Inserts one MemberAuditEvent row and returns its id. Accepts no other fields (D-12). */
export async function recordMemberAudit(
  tx: MemberAuditTx,
  orgId: string,
  entry: MemberAuditEntry,
): Promise<{ id: string }> {
  if (!orgId) throw new Error("recordMemberAudit requires a non-empty organizationId");
  if (!entry.actorUserId) throw new Error("recordMemberAudit requires a non-empty actorUserId");
  return tx.memberAuditEvent.create({
    data: {
      organizationId: orgId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      invitationId: entry.invitationId ?? null,
      oldRole: entry.oldRole ?? null,
      newRole: entry.newRole ?? null,
    },
    select: { id: true },
  });
}
