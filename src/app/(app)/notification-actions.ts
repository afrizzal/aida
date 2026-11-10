"use server";

import { AccessDeniedError } from "@/lib/membership";
import { archive, markAllRead, markRead } from "@/lib/notifications/store";
import { getScopedDb } from "@/lib/session";

// The bell's writes (Phase 10, AIDA-44, D-19, UI-SPEC Surface 3, T-10-44, K141). Server actions
// rather than a POST in the route, so Next's built-in action origin check applies.
//
// Each action validates its untrusted input, reads the session ONCE through the membership gate
// (fresh session, then the caller's member rows in the active organization) and calls
// src/lib/notifications/store.ts with that organization and the session user as the recipient:
// the store's updates are recipient-filtered, so an id of another member's or organization's
// notification changes nothing (D-15). A non-member gets `membership_ended`; an unauthenticated
// caller is redirected to /login by the gate (that throw is not caught here).
//
// Nothing is revalidated: the bell reads its own data by fetch, and a route re-render would only
// cost the page its client state (R10-1). Raw error text never reaches the browser.

export type NotificationActionError = "invalid" | "membership_ended" | "unknown";

export type MarkNotificationResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: NotificationActionError };

export type MarkAllNotificationsResult =
  | { ok: true; count: number }
  | { ok: false; error: NotificationActionError };

/** Longer than any id the schema generates; anything longer is not a notification id. */
const MAX_ID_LENGTH = 128;

/**
 * The gate's AccessDeniedError (no member row, no active organization) becomes null; every other
 * throw, including the gate's redirect to /login, propagates.
 */
function onlyAccessDenied(err: unknown): null {
  if (err instanceof AccessDeniedError) return null;
  throw err;
}

function isNotificationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/** Marks one of the caller's notifications read; `changed` is false when it was already read. */
export async function markNotificationReadAction(id: unknown): Promise<MarkNotificationResult> {
  if (!isNotificationId(id)) return { ok: false, error: "invalid" };
  const scope = await getScopedDb().catch(onlyAccessDenied);
  if (!scope) return { ok: false, error: "membership_ended" };
  try {
    const changed = await markRead(scope.orgId, scope.session.user.id, id);
    return { ok: true, changed };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Marks every unread, not archived notification of the caller read; returns how many changed. */
export async function markAllNotificationsReadAction(): Promise<MarkAllNotificationsResult> {
  const scope = await getScopedDb().catch(onlyAccessDenied);
  if (!scope) return { ok: false, error: "membership_ended" };
  try {
    const count = await markAllRead(scope.orgId, scope.session.user.id);
    return { ok: true, count };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Archives one of the caller's notifications; `changed` is false when it was already archived. */
export async function archiveNotificationAction(id: unknown): Promise<MarkNotificationResult> {
  if (!isNotificationId(id)) return { ok: false, error: "invalid" };
  const scope = await getScopedDb().catch(onlyAccessDenied);
  if (!scope) return { ok: false, error: "membership_ended" };
  try {
    const changed = await archive(scope.orgId, scope.session.user.id, id);
    return { ok: true, changed };
  } catch {
    return { ok: false, error: "unknown" };
  }
}
