// Anthropic adapter — native structured output via `output_config.format` + `messages.parse()`.
// D-16: older patterns forced a function-calling round-trip to fake JSON mode — this SDK version
// ships a native, non-function-calling structured-output API instead. This adapter must never
// gain any function/tool-calling configuration field.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod/v4";

export interface CompleteAnthropicParams<T> {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  /** Optional output-token cap; defaults to 1024 (backward-compat with triage callers). */
  maxOutputTokens?: number;
}

export async function completeAnthropic<T>(params: CompleteAnthropicParams<T>): Promise<T> {
  // timeout/maxRetries: pg-boss owns retry (the caller's job queue), not the SDK.
  const client = new Anthropic({ apiKey: params.apiKey, timeout: 30_000, maxRetries: 0 });
  const message = await client.messages.parse({
    model: params.model,
    max_tokens: params.maxOutputTokens ?? 1024,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
    output_config: { format: zodOutputFormat(params.schema) },
  });
  if (!message.parsed_output) throw new Error("anthropic: structured output parse failed");
  return message.parsed_output;
}
