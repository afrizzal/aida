// OpenAI adapter — Chat Completions with Structured Outputs (D-16: no function/tool-calling
// fields anywhere; a pure structured-output classification call).
import OpenAI from "openai";
import { ContentFilterFinishReasonError, LengthFinishReasonError } from "openai/error";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod/v4";
import { LlmOutputError } from "../errors";

/** The default call deadline (Phase 12.2 D-14); a caller may pass its own (run decision K55). */
export const OPENAI_TIMEOUT_MS = 30_000;

export interface CompleteOpenAiParams<T> {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  schemaName: string;
  /** Optional output-token cap; applied only when provided (no default cap for OpenAI). */
  maxOutputTokens?: number;
  /** Optional call deadline in ms; OPENAI_TIMEOUT_MS when absent (run decision K55). */
  timeoutMs?: number;
}

/**
 * Review a2-WR-01: the SDK's own refusals of an answer it received (finish_reason "length" or
 * "content_filter") are an unusable answer, so they become an LlmOutputError with a fixed
 * message (INVALID_OUTPUT, never retried). By class only; any other error is returned as it is.
 */
export function toOpenAiOutputError(err: unknown): unknown {
  if (err instanceof LengthFinishReasonError || err instanceof ContentFilterFinishReasonError) {
    return new LlmOutputError("openai: structured output unusable");
  }
  return err;
}

export async function completeOpenAi<T>(params: CompleteOpenAiParams<T>): Promise<T> {
  // timeout/maxRetries: pg-boss owns retry (the caller's job queue), not the SDK.
  const client = new OpenAI({
    apiKey: params.apiKey,
    timeout: params.timeoutMs ?? OPENAI_TIMEOUT_MS,
    maxRetries: 0,
  });
  const completion = await client.chat.completions
    .parse({
      model: params.model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
      response_format: zodResponseFormat(params.schema, params.schemaName),
      ...(params.maxOutputTokens ? { max_completion_tokens: params.maxOutputTokens } : {}),
    })
    .catch((err: unknown) => {
      throw toOpenAiOutputError(err);
    });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new LlmOutputError("openai: structured output parse failed");
  return parsed;
}
