// Port contracts for the model-agnostic LLM layer (AIDA-13/AIDA-20).
//
// Relative imports only (no `@/`) — this module family is worker-bundleable via esbuild
// (future triage worker job) as well as consumed by the Next.js app.
//
// NOTE: this port surface deliberately has no function/tool-calling fields of any kind. The
// triage call has zero autonomous-action capability by construction (D-16) — a structural
// guarantee, not a convention to remember.
import type { ZodType } from "zod/v4";

export type LlmProviderName = "openai" | "anthropic" | "ollama";

export interface CompleteParams<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  schemaName: string;
  /**
   * Optional output-token cap. Anthropic defaults to 1024 when omitted (backward-compat with
   * triage callers, which pass nothing); OpenAI/Ollama apply it only when provided. RAG drafts
   * (Phase 5) pass a higher value to avoid truncating multi-paragraph replies (Pitfall 3).
   */
  maxOutputTokens?: number;
}

export interface CompleteResult<T> {
  output: T;
  redactedPrompt: string;
  provider: LlmProviderName;
  model: string;
}

// D-01 curated dropdown (custom-ID free-text is the durable escape hatch in the UI).
// Biased toward the cheapest/fastest tier since triage is lightweight classification.
export const MODEL_CATALOG: Record<LlmProviderName, readonly string[]> = {
  openai: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"],
  ollama: ["llama3.1", "qwen2.5", "mistral"],
} as const;
