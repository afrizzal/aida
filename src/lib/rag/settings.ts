// Typed embedding-settings module over the existing key/value `Setting` model (zero schema
// change). Mirrors src/lib/llm/settings.ts structurally, but embedding config is an INDEPENDENT
// capability with its own Setting keys — falling back to the chat provider's credential only
// when the embedding provider equals the chat provider (Decision 5; Pitfall 1: Anthropic has no
// embeddings API, so an Anthropic-for-chat org must configure embeddings separately).
//
// Relative imports ONLY (no `@/`) — this module is worker-bundleable via esbuild (05-03's embed
// job and 05-04's retrieval both call through here from the worker).
import { decryptSecret, encryptSecret } from "../crypto/secret-box";
import { getLlmSettings } from "../llm/settings";
import type { EmbeddingProviderName } from "./types";

export const EMBEDDING_SETTING_KEYS = {
  provider: "llm:embeddingProvider",
  model: "llm:embeddingModel",
  apiKeyEnc: "llm:embeddingApiKeyEnc",
  ollamaBaseUrl: "llm:embeddingOllamaBaseUrl",
} as const;

/**
 * Narrowed to just the delegate this module needs — shares the SAME narrow db-param type as
 * lib/llm/settings.ts (re-exported here for DRY; both a full `scopedDb()` client and an
 * in-flight interactive `$transaction` `tx` client satisfy this structurally).
 */
import type { SettingDb } from "../llm/settings";

export type { SettingDb } from "../llm/settings";

export interface EmbeddingSettings {
  provider: EmbeddingProviderName | "";
  model: string;
  /** Decrypted; "" when unset. Never round-tripped in plaintext back to the UI. */
  apiKey: string;
  ollamaBaseUrl: string;
}

/** Input for saveEmbeddingSettings — every field optional; only provided keys are written. */
export interface SaveEmbeddingSettingsInput {
  provider?: EmbeddingProviderName;
  model?: string;
  /** Empty/undefined = keep the existing stored key (never round-trips plaintext to the UI). */
  apiKey?: string;
  ollamaBaseUrl?: string;
}

export interface ResolvedEmbedding {
  provider: EmbeddingProviderName;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
}

function isEmbeddingProviderName(value: string): value is EmbeddingProviderName {
  return value === "openai" || value === "ollama";
}

async function loadSettingMap(db: SettingDb): Promise<Map<string, string>> {
  const rows = await db.setting.findMany({}); // scopedDb injects organizationId
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.key, row.value);
  return map;
}

/**
 * Reads all llm:embedding* Setting rows and returns a fully typed, decrypted EmbeddingSettings
 * object. Never logs the decrypted key or raw Setting values (SECURITY.md: credentials never
 * logged).
 */
export async function getEmbeddingSettings(db: SettingDb): Promise<EmbeddingSettings> {
  const map = await loadSettingMap(db);

  const rawProvider = map.get(EMBEDDING_SETTING_KEYS.provider) ?? "";
  const provider: EmbeddingProviderName | "" = isEmbeddingProviderName(rawProvider)
    ? rawProvider
    : "";

  const apiKeyEnc = map.get(EMBEDDING_SETTING_KEYS.apiKeyEnc);

  return {
    provider,
    model: map.get(EMBEDDING_SETTING_KEYS.model) ?? "",
    apiKey: apiKeyEnc ? decryptSecret(apiKeyEnc) : "",
    ollamaBaseUrl: map.get(EMBEDDING_SETTING_KEYS.ollamaBaseUrl) ?? "",
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
export async function saveEmbeddingSettings(
  db: SettingDb,
  orgId: string,
  input: SaveEmbeddingSettingsInput,
): Promise<void> {
  const writes: Array<[string, string]> = [];

  if (input.provider !== undefined) writes.push([EMBEDDING_SETTING_KEYS.provider, input.provider]);
  if (input.model !== undefined) writes.push([EMBEDDING_SETTING_KEYS.model, input.model]);
  if (input.apiKey) {
    writes.push([EMBEDDING_SETTING_KEYS.apiKeyEnc, encryptSecret(input.apiKey)]);
  }
  if (input.ollamaBaseUrl !== undefined) {
    writes.push([EMBEDDING_SETTING_KEYS.ollamaBaseUrl, input.ollamaBaseUrl]);
  }

  for (const [key, value] of writes) {
    await upsertSetting(db, orgId, key, value);
  }
}

/**
 * Resolves the fully configured active embedding provider, applying the chat-credential fallback
 * (Decision 5): when the embedding provider equals the chat provider AND the embedding-specific
 * credential is blank, borrow the chat credential (apiKey for openai, ollamaBaseUrl for ollama).
 * Throws when provider+model+resolved-credential are not all present — never a silent fallback.
 */
export async function resolveEmbeddingProvider(db: SettingDb): Promise<ResolvedEmbedding> {
  const s = await getEmbeddingSettings(db);

  if (!s.provider || !s.model) {
    throw new Error("No embedding provider configured");
  }

  let apiKey = s.apiKey;
  let ollamaBaseUrl = s.ollamaBaseUrl;

  const credentialMissing = s.provider === "ollama" ? !ollamaBaseUrl : !apiKey;
  if (credentialMissing) {
    const chat = await getLlmSettings(db);
    if (chat.provider === s.provider) {
      if (s.provider === "ollama") {
        ollamaBaseUrl = chat.ollamaBaseUrl;
      } else {
        apiKey = chat.apiKey;
      }
    }
  }

  const stillMissing = s.provider === "ollama" ? !ollamaBaseUrl : !apiKey;
  if (stillMissing) {
    throw new Error("No embedding provider configured");
  }

  return { provider: s.provider, model: s.model, apiKey, ollamaBaseUrl };
}

/** True once resolveEmbeddingProvider would succeed (provider+model+credential all resolvable). */
export async function isEmbeddingConfigured(db: SettingDb): Promise<boolean> {
  try {
    await resolveEmbeddingProvider(db);
    return true;
  } catch {
    return false;
  }
}

/** Per-chunk `embeddingModel` tag string used for storage + retrieval filtering (Pitfall 5). */
export function embeddingModelId(r: ResolvedEmbedding): string {
  return `${r.provider}:${r.model}`;
}
