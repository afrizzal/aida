// Anthropic adapter — native structured output via `output_config.format` + `messages.parse()`.
// D-16: older patterns forced a function-calling round-trip to fake JSON mode — this SDK version
// ships a native, non-function-calling structured-output API instead. This adapter must never
// gain any function/tool-calling configuration field.
import Anthropic, { AnthropicError, APIError, RetryableError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod/v4";
import { LlmOutputError } from "../errors";

/** The default call deadline (Phase 12.2 D-14); a caller may pass its own (run decision K55). */
export const ANTHROPIC_TIMEOUT_MS = 30_000;

export interface CompleteAnthropicParams<T> {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  /** Optional output-token cap; defaults to 1024 (backward-compat with triage callers). */
  maxOutputTokens?: number;
  /** Optional call deadline in ms; ANTHROPIC_TIMEOUT_MS when absent (run decision K55). */
  timeoutMs?: number;
}

/**
 * Review a2-WR-01: `messages.parse` wraps every JSON or schema failure of the answer (including
 * an answer cut off at max_tokens) in a plain AnthropicError, whose message carries model text.
 * Every AnthropicError that is not an APIError (HTTP, connection, timeout and user-abort errors
 * all extend APIError) and not a RetryableError is therefore an unusable answer: an
 * LlmOutputError with a fixed message (INVALID_OUTPUT, never retried). By class only; any other
 * error is returned as it is. The SDK's remaining non-API AnthropicErrors are pre-flight usage
 * errors that a retry would not fix either.
 */
export function toAnthropicOutputError(err: unknown): unknown {
  if (
    err instanceof AnthropicError &&
    !(err instanceof APIError) &&
    !(err instanceof RetryableError)
  ) {
    return new LlmOutputError("anthropic: structured output parse failed");
  }
  return err;
}

export async function completeAnthropic<T>(params: CompleteAnthropicParams<T>): Promise<T> {
  // timeout/maxRetries: pg-boss owns retry (the caller's job queue), not the SDK.
  const client = new Anthropic({
    apiKey: params.apiKey,
    timeout: params.timeoutMs ?? ANTHROPIC_TIMEOUT_MS,
    maxRetries: 0,
  });
  const message = await client.messages
    .parse({
      model: params.model,
      max_tokens: params.maxOutputTokens ?? 1024,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
      output_config: { format: zodOutputFormat(params.schema) },
    })
    .catch((err: unknown) => {
      throw toAnthropicOutputError(err);
    });
  if (!message.parsed_output) throw new LlmOutputError("anthropic: structured output parse failed");
  return message.parsed_output;
}
