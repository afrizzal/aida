// Typed branding-settings module over the existing key/value `Setting` model (zero schema
// change). D-16 scope: NAME ONLY — one key, no logo, no tagline, no colour.
//
// Imported by BOTH the Next.js app (settings actions/page, app layout — via
// `@/lib/branding/settings`) AND the worker (outbound-send job — via a relative path,
// esbuild-bundled). Therefore this file's OWN internal imports MUST stay relative (no `@/`)
// so esbuild can bundle it for the worker. `scopedDb` is a type-only import (erased at
// compile time — safe for esbuild's runtime bundle of the worker).
import type { scopedDb } from "../scoped-db";

// The single `branding:*` key this plan ships (D-16: name-only scope).
export const BRANDING_SETTING_KEYS = {
  workspaceName: "branding:workspaceName",
} as const;

export interface BrandingSettings {
  /** Display name shown in the sidebar, on public pages and as the outbound email from-name. */
  workspaceName: string;
}

/** Input for saveBrandingSettings — the field is optional; it's only written when provided. */
export interface SaveBrandingSettingsInput {
  workspaceName?: string;
}

/**
 * Narrowed to just the delegate this module needs (mirrors src/lib/channels/email/settings.ts's
 * `SettingDb` precedent) — both a full `scopedDb()` client (Next.js app + worker) and an
 * in-flight interactive-`$transaction` `tx` client satisfy this structurally.
 */
type SettingDb = Pick<ReturnType<typeof scopedDb>, "setting">;

/** Pure, DB-free — shared by the Server Action and the client form so both validate identically. */
export const MAX_WORKSPACE_NAME_LENGTH = 60;

async function loadSettingMap(db: SettingDb): Promise<Map<string, string>> {
  const rows = await db.setting.findMany({}); // scopedDb injects organizationId
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.key, row.value);
  return map;
}

/**
 * Reads the branding:* Setting row and returns a fully typed BrandingSettings object.
 *
 * `fallbackName` is the organization's own name (D-16: workspace display name defaults to
 * the organization name). Callers pass `organization.name`. An empty/whitespace stored value
 * falls back too — it must never render blank.
 */
export async function getBrandingSettings(
  db: SettingDb,
  fallbackName: string,
): Promise<BrandingSettings> {
  const map = await loadSettingMap(db);
  const stored = (map.get(BRANDING_SETTING_KEYS.workspaceName) ?? "").trim();

  return {
    workspaceName: stored || fallbackName,
  };
}

/** findFirst + conditional create/update — never `.upsert()` (see scopedDb.ts). */
async function upsertSetting(
  db: SettingDb,
  orgId: string,
  key: string,
  value: string,
): Promise<void> {
  const existing = await db.setting.findFirst({ where: { key } });
  if (existing) {
    await db.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await db.setting.create({ data: { organizationId: orgId, key, value } });
  }
}

/**
 * Writes the workspaceName key only when provided, trimming the value first.
 * No HTML is ever produced here — the value is rendered as plain text by React
 * (no `dangerouslySetInnerHTML` anywhere in this module or its callers).
 */
export async function saveBrandingSettings(
  db: SettingDb,
  orgId: string,
  input: SaveBrandingSettingsInput,
): Promise<void> {
  if (input.workspaceName !== undefined) {
    await upsertSetting(db, orgId, BRANDING_SETTING_KEYS.workspaceName, input.workspaceName.trim());
  }
}
