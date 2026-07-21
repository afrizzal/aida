// The ONE port entrypoint (D-02/D-14/D-16): redact -> resolve active provider -> dispatch ->
// return { output, redactedPrompt, provider, model }. Every current and future AI feature
// (triage now; Phase 5 RAG drafts, Phase 6 Insight later) calls through here — redaction is
// unconditional (no opt-out param exists), so it is structurally impossible to skip.
//
// Relative imports only (no `@/`) — worker-bundleable via esbuild.
import { resolveActiveProvider } from "./active-provider";
import { completeAnthropic } from "./providers/anthropic";
import { completeOllama } from "./providers/ollama";
import { completeOpenAi } from "./providers/openai";
import { redactSecrets } from "./redact";
import type { SettingDb } from "./settings";
import type { CompleteParams, CompleteResult } from "./types";

export async function complete<T>(
  db: SettingDb,
  params: CompleteParams<T>,
): Promise<CompleteResult<T>> {
  const redactedPrompt = redactSecrets(params.prompt); // D-13/D-14 — unconditional, no opt-out
  const s = await resolveActiveProvider(db); // D-02 — the one globally-active provider+model

  const base = {
    model: s.model,
    system: params.system,
    prompt: redactedPrompt,
    schema: params.schema,
    maxOutputTokens: params.maxOutputTokens,
  };

  let output: T;
  switch (s.provider) {
    case "openai":
      output = await completeOpenAi({ apiKey: s.apiKey, schemaName: params.schemaName, ...base });
      break;
    case "anthropic":
      output = await completeAnthropic({ apiKey: s.apiKey, ...base });
      break;
    case "ollama":
      output = await completeOllama({ baseUrl: s.ollamaBaseUrl, ...base });
      break;
    default:
      throw new Error(`Unsupported provider: ${s.provider}`);
  }

  return { output, redactedPrompt, provider: s.provider, model: s.model };
}
