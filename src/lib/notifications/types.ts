// Shared notification types (Phase 10, AIDA-44, D-14). Entity-generic: a notification names an
// entity by type and id (a ticket now, a task in AIDA-83) and never carries customer text, a
// customer email or a ticket subject; the bell resolves display fields when it reads.
//
// Relative imports only and no framework import: the worker bundles src/lib/notifications.

/** The five event types, in display order (D-14). Mirrors the Prisma enum NotificationType. */
export const NOTIFICATION_TYPES = [
  "ASSIGNED",
  "CUSTOMER_REPLY",
  "MENTION",
  "SLA_AT_RISK",
  "SLA_BREACHED",
] as const;

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number];

const NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

/** True only for one of the five type names. */
export function isNotificationType(value: unknown): value is NotificationTypeName {
  return typeof value === "string" && NOTIFICATION_TYPE_SET.has(value);
}

/** The entity type of ticket notifications. */
export const TICKET_ENTITY = "ticket";

/**
 * One notification to write. The organization is never part of the item: the store writes the
 * organization it is called with on every row (D-15).
 */
export interface NotificationItem {
  recipientUserId: string;
  /** The member who caused the event; null or absent for a customer or the system. */
  actorUserId?: string | null;
  type: NotificationTypeName;
  /** Stable identity of the event; unique per (organization, recipient, type) (D-14). */
  eventKey: string;
  entityType: string;
  entityId: string;
  /** True when the row comes from the unassigned-ticket fallback (V-28). */
  unassignedFallback?: boolean;
}

/** How often the bell polls the unread count (D-19, V-19). */
export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
