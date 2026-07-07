// Resolves the ONE globally-active provider+model (D-02) — the single resolution point every
// AI feature (triage now; RAG/Insight in later phases) calls through.
//
// Relative imports only (no `@/`) — worker-bundleable via esbuild, same convention as the rest
// of src/lib/llm.
import { type LlmSettings, type SettingDb, getLlmSettings, isProviderConfigured } from "./settings";

/**
 * Returns the fully configured active LlmSettings, or throws if no provider is configured yet
 * (D-02: exactly one globally-active provider; never a silent fallback).
 */
export async function resolveActiveProvider(db: SettingDb): Promise<LlmSettings> {
  const settings = await getLlmSettings(db);
  if (!isProviderConfigured(settings)) {
    throw new Error("No LLM provider configured");
  }
  return settings;
}
