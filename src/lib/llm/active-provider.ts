// Resolves the ONE globally-active provider+model (D-02) — the single resolution point every
// AI feature (triage now; RAG/Insight in later phases) calls through.
//
// Relative imports only (no `@/`) — worker-bundleable via esbuild, same convention as the rest
// of src/lib/llm.
import { getLlmSettings, isProviderConfigured, type LlmSettings, type SettingDb } from "./settings";
import type { LlmProviderName } from "./types";

/** LlmSettings with `provider` narrowed to a real LlmProviderName (never ""). */
export type ResolvedProvider = LlmSettings & { provider: LlmProviderName };

/**
 * Returns the fully configured active LlmSettings, or throws if no provider is configured yet
 * (D-02: exactly one globally-active provider; never a silent fallback). `isProviderConfigured`
 * guarantees `provider` is non-empty here, so the cast below reflects a runtime-proven
 * invariant, not an unchecked assertion.
 */
export async function resolveActiveProvider(db: SettingDb): Promise<ResolvedProvider> {
  const settings = await getLlmSettings(db);
  if (!isProviderConfigured(settings)) {
    throw new Error("No LLM provider configured");
  }
  return settings as ResolvedProvider;
}
