// Typed llm-settings module over the existing key/value `Setting` model (zero schema change).
// Mirrors src/lib/channels/email/settings.ts structurally (D-05).
//
// Relative imports ONLY (no `@/`) — this module is worker-bundleable via esbuild (a future
// triage worker job resolves the active provider the same way the app does). `scopedDb` is a
// type-only import (erased at compile time — safe for esbuild's runtime bundle of the worker).
import { decryptSecret, encryptSecret } from "../crypto/secret-box";
import type { scopedDb } from "../scoped-db";
import type { LlmProviderName } from "./types";

export const LLM_SETTING_KEYS = {
  provider: "llm:provider",
  model: "llm:model",
  apiKeyEnc: "llm:apiKeyEnc",
  ollamaBaseUrl: "llm:ollamaBaseUrl",
} as const;

export interface LlmSettings {
  provider: LlmProviderName | "";
  model: string;
  /** Decrypted; "" when unset. Never round-tripped in plaintext back to the UI. */
  apiKey: string;
  ollamaBaseUrl: string;
}

/**
 * Narrowed to just the delegate this module needs (mirrors src/lib/channels/email/settings.ts's
 * `SettingDb` precedent) — both a full `scopedDb()` client and an in-flight interactive
 * `$transaction` `tx` client satisfy this structurally. Exported for reuse by
 * ./active-provider.ts and ./complete.ts so the whole `lib/llm` module family shares one
 * narrow db-param type.
 */
export type SettingDb = Pick<ReturnType<typeof scopedDb>, "setting">;

/** Input for saveLlmSettings — every field optional; only provided keys are written. */
export interface SaveLlmSettingsInput {
  provider?: LlmProviderName;
  model?: string;
  /** Empty/undefined = keep the existing stored key (never round-trips plaintext to the UI). */
  apiKey?: string;
  ollamaBaseUrl?: string;
}

function isLlmProviderName(value: string): value is LlmProviderName {
  return value === "openai" || value === "anthropic" || value === "ollama";
}

async function loadSettingMap(db: SettingDb): Promise<Map<string, string>> {
  const rows = await db.setting.findMany({}); // scopedDb injects organizationId
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.key, row.value);
  return map;
}

/**
 * Reads all llm:* Setting rows and returns a fully typed, decrypted LlmSettings object.
 * Never logs the decrypted key or raw Setting values (SECURITY.md: credentials never logged).
 */
export async function getLlmSettings(db: SettingDb): Promise<LlmSettings> {
  const map = await loadSettingMap(db);

  const rawProvider = map.get(LLM_SETTING_KEYS.provider) ?? "";
  const provider: LlmProviderName | "" = isLlmProviderName(rawProvider) ? rawProvider : "";

  const apiKeyEnc = map.get(LLM_SETTING_KEYS.apiKeyEnc);

  return {
    provider,
    model: map.get(LLM_SETTING_KEYS.model) ?? "",
    apiKey: apiKeyEnc ? decryptSecret(apiKeyEnc) : "",
    ollamaBaseUrl: map.get(LLM_SETTING_KEYS.ollamaBaseUrl) ?? "",
  };
}

/** findFirst + conditional create/update — never `.upsert()` (see scoped-db.ts). */
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
 * Writes only the provided fields to the Setting table. `apiKey` is ONLY written when a
 * non-empty string is supplied — an empty/undefined apiKey means "keep the existing stored
 * value" so the UI never has to round-trip the decrypted key back into the form. Never logs the
 * decrypted key or raw Setting values.
 */
export async function saveLlmSettings(
  db: SettingDb,
  orgId: string,
  input: SaveLlmSettingsInput,
): Promise<void> {
  const writes: Array<[string, string]> = [];

  if (input.provider !== undefined) writes.push([LLM_SETTING_KEYS.provider, input.provider]);
  if (input.model !== undefined) writes.push([LLM_SETTING_KEYS.model, input.model]);
  if (input.apiKey) {
    writes.push([LLM_SETTING_KEYS.apiKeyEnc, encryptSecret(input.apiKey)]);
  }
  if (input.ollamaBaseUrl !== undefined) {
    writes.push([LLM_SETTING_KEYS.ollamaBaseUrl, input.ollamaBaseUrl]);
  }

  for (const [key, value] of writes) {
    await upsertSetting(db, orgId, key, value);
  }
}

/** True once a provider+model is selected and the provider-specific credential is present. */
export function isProviderConfigured(s: LlmSettings): boolean {
  return !!s.provider && !!s.model && (s.provider === "ollama" ? !!s.ollamaBaseUrl : !!s.apiKey);
}
