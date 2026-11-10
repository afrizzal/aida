"use server";

import { AccessDeniedError, isAdminRole } from "@/lib/membership";
import { setPreference, setUnassignedSetting } from "@/lib/notifications/preferences";
import { isNotificationType, type NotificationTypeName } from "@/lib/notifications/types";
import { getScopedDb } from "@/lib/session";

// The server actions of /settings/notifications (Phase 10, AIDA-46 D-22, AIDA-44 owner item 11
// V-28 with amendment A3; D-08, K141, T-10-44b).
//
// Each action validates its untrusted input, reads the session ONCE through the membership gate
// (fresh session, then the caller's member rows in the active organization) and writes through
// src/lib/notifications/preferences.ts for the session user only: the user never comes from input.
// The unassigned-ticket switch is refused unless the conservative role is owner or admin, whatever
// the browser showed. A refusal is returned as a key, never thrown; raw error text does not reach
// the browser. Nothing is revalidated: the switch position is the confirmation, a reload reads the
// stored values, and a route re-render would only cost the form its client state (R10-1).

export type PreferenceActionError = "invalid" | "membership_ended" | "not_allowed" | "unknown";

export type SetPreferenceResult =
  | { ok: true; preference: { type: NotificationTypeName; inApp: boolean; digest: boolean } }
  | { ok: false; error: PreferenceActionError };

export type SetUnassignedResult =
  | { ok: true; enabled: boolean }
  | { ok: false; error: PreferenceActionError };

/**
 * The gate's AccessDeniedError (no member row, no active organization) becomes null; every other
 * throw, including the gate's redirect to /login, propagates.
 */
function onlyAccessDenied(err: unknown): null {
  if (err instanceof AccessDeniedError) return null;
  throw err;
}

/** The change shape: only `inApp` and `digest`, each a boolean, at least one present. */
function parseChange(value: unknown): { inApp?: boolean; digest?: boolean } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  const change: { inApp?: boolean; digest?: boolean } = {};
  for (const [key, flag] of entries) {
    if (typeof flag !== "boolean") return null;
    if (key === "inApp") change.inApp = flag;
    else if (key === "digest") change.digest = flag;
    else return null;
  }
  return change;
}

/** Stores the caller's In app and/or Email digest switch of one event type. */
export async function setPreferenceAction(
  type: unknown,
  change: unknown,
): Promise<SetPreferenceResult> {
  if (!isNotificationType(type)) return { ok: false, error: "invalid" };
  const parsed = parseChange(change);
  if (!parsed) return { ok: false, error: "invalid" };
  const scope = await getScopedDb().catch(onlyAccessDenied);
  if (!scope) return { ok: false, error: "membership_ended" };
  try {
    const preference = await setPreference(scope.orgId, scope.session.user.id, type, parsed);
    return { ok: true, preference };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Stores the caller's "Unassigned tickets" switch; owners and admins only (amendment A3). */
export async function setUnassignedSettingAction(enabled: unknown): Promise<SetUnassignedResult> {
  if (typeof enabled !== "boolean") return { ok: false, error: "invalid" };
  const scope = await getScopedDb().catch(onlyAccessDenied);
  if (!scope) return { ok: false, error: "membership_ended" };
  if (!isAdminRole(scope.role)) return { ok: false, error: "not_allowed" };
  try {
    const stored = await setUnassignedSetting(scope.orgId, scope.session.user.id, enabled);
    return { ok: true, enabled: stored };
  } catch {
    return { ok: false, error: "unknown" };
  }
}
