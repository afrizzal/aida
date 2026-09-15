// The ONE write path into TicketAuditEvent (Phase 11, D-07). Each ticket mutation (assign,
// status, priority, tag add/remove, auto-close) records one row per ticket through this module,
// inside the same transaction as the change itself.
//
// Privacy (AIDA-48 prohibition): `before` and `after` hold ids, enum values and booleans only.
// Never pass ticket subjects, message text, search text or any other free text. The flat
// value type below rejects nested objects and numbers at compile time.
//
// The table is append-only at the database level (trigger aida_ticket_audit_event_immutable);
// this module only ever INSERTs.
//
// Relative imports only (no path alias): the worker bundles this module through the auto-close job.
import type { TicketAuditAction, TicketAuditActorType } from "../../generated/prisma/client";

/** A flat record of ids, enum values and booleans. No free text, no nesting. */
export type TicketAuditValue = string | boolean | null;
export type TicketAuditSnapshot = Readonly<Record<string, TicketAuditValue>>;

interface TicketAuditEntryBase {
  ticketId: string;
  action: TicketAuditAction;
  before: TicketAuditSnapshot;
  after: TicketAuditSnapshot;
  /** Shared by every row of one bulk action; omitted (null) for a single action. */
  batchId?: string | null;
}

export type TicketAuditEntry =
  | (TicketAuditEntryBase & {
      actorType: Extract<TicketAuditActorType, "USER">;
      actorUserId: string;
    })
  | (TicketAuditEntryBase & {
      actorType: Extract<TicketAuditActorType, "SYSTEM">;
      actorUserId: null;
    });

/**
 * The transaction client recordTicketAudit needs. Typed structurally so the global prisma
 * client, a scopedDb client and either one's interactive transaction client all fit.
 * organizationId is always written explicitly, so the unscoped client is safe too.
 */
export interface TicketAuditTx {
  ticketAuditEvent: {
    create(args: {
      data: {
        organizationId: string;
        ticketId: string;
        actorType: TicketAuditActorType;
        actorUserId: string | null;
        action: TicketAuditAction;
        before: TicketAuditSnapshot;
        after: TicketAuditSnapshot;
        batchId: string | null;
      };
      select: { id: true };
    }): PromiseLike<{ id: string }>;
  };
}

/** Inserts one TicketAuditEvent row and returns its id. Accepts no other fields (D-07). */
export async function recordTicketAudit(
  tx: TicketAuditTx,
  orgId: string,
  entry: TicketAuditEntry,
): Promise<{ id: string }> {
  if (!orgId) throw new Error("recordTicketAudit requires a non-empty organizationId");
  return tx.ticketAuditEvent.create({
    data: {
      organizationId: orgId,
      ticketId: entry.ticketId,
      actorType: entry.actorType,
      actorUserId: entry.actorUserId,
      action: entry.action,
      before: { ...entry.before },
      after: { ...entry.after },
      batchId: entry.batchId ?? null,
    },
    select: { id: true },
  });
}
