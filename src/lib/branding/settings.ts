// Typed branding-settings module over the existing key/value `Setting` model (zero schema
// change). D-16 scope: the workspace name; Phase 9 plan 09-05 (AIDA-34, D-07) adds the logo
// reference `branding:logo`. No subtitle field, no colour.
//
// The logo reference is JSON { storageKey, mimeType, version }. It is parsed strictly
// (parseLogoSetting): a key in the storage-key shape, a MIME type from LOGO_MIME_TYPES and a
// 12-character lowercase hex version, or the whole value counts as no logo. The file itself is
// written, replaced and removed only by src/lib/branding/logo-store.ts; this module never touches
// a file and stays free of Node imports (a client component imports it).
//
// Imported by BOTH the Next.js app (settings actions/page, app layout — via
// `@/lib/branding/settings`) AND the worker (outbound-send job — via a relative path,
// esbuild-bundled). Therefore this file's OWN internal imports MUST stay relative (no `@/`)
// so esbuild can bundle it for the worker. `scopedDb` is a type-only import (erased at
// compile time — safe for esbuild's runtime bundle of the worker).
import type { scopedDb } from "../scoped-db";

// The `branding:*` keys: the workspace name (D-16) and the logo reference (09-05, D-07).
export const BRANDING_SETTING_KEYS = {
  workspaceName: "branding:workspaceName",
  logo: "branding:logo",
} as const;

/** The only logo types (D-08): sniffed from the bytes, never taken from a name or a header. */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/** The `branding:logo` value: an immutable stored file and the version in its public URL. */
export interface LogoSetting {
  storageKey: string;
  mimeType: LogoMimeType;
  version: string;
}

// The storage-key shape of local-file-storage.ts (random id, dot, short extension), lowercase.
const LOGO_STORAGE_KEY = /^[a-z0-9]+\.[a-z0-9]{1,8}$/;
const LOGO_VERSION = /^[0-9a-f]{12}$/;

export function isLogoMimeType(value: unknown): value is LogoMimeType {
  return typeof value === "string" && (LOGO_MIME_TYPES as readonly string[]).includes(value);
}

/** Strict parse of a stored `branding:logo` value; anything malformed is no logo (null). */
export function parseLogoSetting(value: string | null | undefined): LogoSetting | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { storageKey, mimeType, version } = parsed as Record<string, unknown>;
  if (typeof storageKey !== "string" || !LOGO_STORAGE_KEY.test(storageKey)) return null;
  if (!isLogoMimeType(mimeType)) return null;
  if (typeof version !== "string" || !LOGO_VERSION.test(version)) return null;
  return { storageKey, mimeType, version };
}

/** The versioned public URL of a logo (served by src/app/api/public/logo/[orgId]/[version]). */
export function logoPublicUrl(orgId: string, version: string): string {
  return `/api/public/logo/${encodeURIComponent(orgId)}/${encodeURIComponent(version)}`;
}

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

/** The organization's current logo reference, or null when none (or a malformed one) is set. */
export async function getLogoSetting(db: SettingDb): Promise<LogoSetting | null> {
  const row = await db.setting.findFirst({ where: { key: BRANDING_SETTING_KEYS.logo } });
  return parseLogoSetting(row?.value);
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
