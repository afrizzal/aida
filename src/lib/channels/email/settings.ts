// Typed email-settings module over the existing key/value `Setting` model (zero schema change).
//
// Imported by BOTH the Next.js app (settings actions, messages route — via
// `@/lib/channels/email/settings`) AND the worker (poll job — via a relative path,
// esbuild-bundled). Therefore this file's OWN internal imports MUST stay relative (no `@/`)
// so esbuild can bundle it for the worker.
import { decryptSecret, encryptSecret } from "../../crypto/secret-box";

// The exact 14 `email:*` keys (see 03-RESEARCH.md "Settings key scheme").
export const EMAIL_SETTING_KEYS = {
  enabled: "email:enabled",
  fromAddress: "email:fromAddress",
  imapHost: "email:imapHost",
  imapPort: "email:imapPort",
  imapSecure: "email:imapSecure",
  imapUser: "email:imapUser",
  imapPasswordEnc: "email:imapPasswordEnc",
  smtpHost: "email:smtpHost",
  smtpPort: "email:smtpPort",
  smtpSecure: "email:smtpSecure",
  smtpUser: "email:smtpUser",
  smtpPasswordEnc: "email:smtpPasswordEnc",
  lastPollAt: "email:lastPollAt",
  lastPollError: "email:lastPollError",
} as const;

export interface EmailSettings {
  enabled: boolean;
  fromAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  lastPollAt: string | null;
  lastPollError: string | null;
}

/**
 * Minimal db shape this module needs — works with any scopedDb client (Next.js app or worker),
 * without coupling to generated Prisma types across the two different bundling contexts.
 */
type SettingDb = {
  setting: {
    findMany: (a: unknown) => Promise<Array<{ key: string; value: string; id: string }>>;
    findFirst: (a: unknown) => Promise<{ id: string } | null>;
    create: (a: unknown) => Promise<unknown>;
    update: (a: unknown) => Promise<unknown>;
  };
};

/** Input for saveEmailSettings — every field optional; only provided keys are written. */
export interface SaveEmailSettingsInput {
  enabled?: boolean;
  fromAddress?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  /** Empty/undefined = keep the existing stored password (never round-trips plaintext to the UI). */
  imapPassword?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  /** Empty/undefined = keep the existing stored password (never round-trips plaintext to the UI). */
  smtpPassword?: string;
}

async function loadSettingMap(db: SettingDb): Promise<Map<string, string>> {
  const rows = await db.setting.findMany({}); // scopedDb injects organizationId
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.key, row.value);
  return map;
}

/**
 * Reads all email:* Setting rows and returns a fully typed, decrypted EmailSettings object.
 * Never logs decrypted passwords or raw Setting values (SECURITY.md: credentials never logged).
 */
export async function getEmailSettings(db: SettingDb): Promise<EmailSettings> {
  const map = await loadSettingMap(db);

  const boolValue = (key: string, fallback: boolean): boolean => {
    const raw = map.get(key);
    return raw === undefined ? fallback : raw === "true";
  };

  const imapPasswordEnc = map.get(EMAIL_SETTING_KEYS.imapPasswordEnc);
  const smtpPasswordEnc = map.get(EMAIL_SETTING_KEYS.smtpPasswordEnc);

  return {
    enabled: boolValue(EMAIL_SETTING_KEYS.enabled, false),
    fromAddress: map.get(EMAIL_SETTING_KEYS.fromAddress) ?? "",
    imapHost: map.get(EMAIL_SETTING_KEYS.imapHost) ?? "",
    imapPort: Number(map.get(EMAIL_SETTING_KEYS.imapPort)) || 993,
    imapSecure: boolValue(EMAIL_SETTING_KEYS.imapSecure, true),
    imapUser: map.get(EMAIL_SETTING_KEYS.imapUser) ?? "",
    imapPassword: imapPasswordEnc ? decryptSecret(imapPasswordEnc) : "",
    smtpHost: map.get(EMAIL_SETTING_KEYS.smtpHost) ?? "",
    smtpPort: Number(map.get(EMAIL_SETTING_KEYS.smtpPort)) || 587,
    smtpSecure: boolValue(EMAIL_SETTING_KEYS.smtpSecure, true),
    smtpUser: map.get(EMAIL_SETTING_KEYS.smtpUser) ?? "",
    smtpPassword: smtpPasswordEnc ? decryptSecret(smtpPasswordEnc) : "",
    lastPollAt: map.get(EMAIL_SETTING_KEYS.lastPollAt) ?? null,
    lastPollError: map.get(EMAIL_SETTING_KEYS.lastPollError) ?? null,
  };
}

/** findFirst + conditional create/update — mirrors settings/actions.ts; never `.upsert()` (see scopedDb.ts). */
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
 * Writes only the provided fields to the Setting table. Password fields are ONLY written when
 * a non-empty password string is supplied — an empty/undefined password means "keep the existing
 * stored value" so the UI never has to round-trip the plaintext password. Never logs decrypted
 * passwords or raw Setting values.
 */
export async function saveEmailSettings(
  db: SettingDb,
  orgId: string,
  input: SaveEmailSettingsInput,
): Promise<void> {
  const writes: Array<[string, string]> = [];

  if (input.enabled !== undefined) writes.push([EMAIL_SETTING_KEYS.enabled, String(input.enabled)]);
  if (input.fromAddress !== undefined) writes.push([EMAIL_SETTING_KEYS.fromAddress, input.fromAddress]);
  if (input.imapHost !== undefined) writes.push([EMAIL_SETTING_KEYS.imapHost, input.imapHost]);
  if (input.imapPort !== undefined) writes.push([EMAIL_SETTING_KEYS.imapPort, String(input.imapPort)]);
  if (input.imapSecure !== undefined)
    writes.push([EMAIL_SETTING_KEYS.imapSecure, String(input.imapSecure)]);
  if (input.imapUser !== undefined) writes.push([EMAIL_SETTING_KEYS.imapUser, input.imapUser]);
  if (input.imapPassword) {
    writes.push([EMAIL_SETTING_KEYS.imapPasswordEnc, encryptSecret(input.imapPassword)]);
  }
  if (input.smtpHost !== undefined) writes.push([EMAIL_SETTING_KEYS.smtpHost, input.smtpHost]);
  if (input.smtpPort !== undefined) writes.push([EMAIL_SETTING_KEYS.smtpPort, String(input.smtpPort)]);
  if (input.smtpSecure !== undefined)
    writes.push([EMAIL_SETTING_KEYS.smtpSecure, String(input.smtpSecure)]);
  if (input.smtpUser !== undefined) writes.push([EMAIL_SETTING_KEYS.smtpUser, input.smtpUser]);
  if (input.smtpPassword) {
    writes.push([EMAIL_SETTING_KEYS.smtpPasswordEnc, encryptSecret(input.smtpPassword)]);
  }

  for (const [key, value] of writes) {
    await upsertSetting(db, orgId, key, value);
  }
}

/**
 * Writes poll-health fields (used by the inbound poll job — plan 04). A successful poll clears
 * the error by writing lastPollError: "".
 */
export async function updateEmailHealth(
  db: SettingDb,
  orgId: string,
  health: { lastPollAt?: string; lastPollError?: string },
): Promise<void> {
  if (health.lastPollAt !== undefined) {
    await upsertSetting(db, orgId, EMAIL_SETTING_KEYS.lastPollAt, health.lastPollAt);
  }
  if (health.lastPollError !== undefined) {
    await upsertSetting(db, orgId, EMAIL_SETTING_KEYS.lastPollError, health.lastPollError);
  }
}
