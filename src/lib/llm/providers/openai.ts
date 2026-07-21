// OpenAI adapter — Chat Completions with Structured Outputs (D-16: no function/tool-calling
// fields anywhere; a pure structured-output classification call).
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod/v4";

export interface CompleteOpenAiParams<T> {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  schemaName: string;
  /** Optional output-token cap; applied only when provided (no default cap for OpenAI). */
  maxOutputTokens?: number;
}

export async function completeOpenAi<T>(params: CompleteOpenAiParams<T>): Promise<T> {
  // timeout/maxRetries: pg-boss owns retry (the caller's job queue), not the SDK.
  const client = new OpenAI({ apiKey: params.apiKey, timeout: 30_000, maxRetries: 0 });
  const completion = await client.chat.completions.parse({
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.prompt },
    ],
    response_format: zodResponseFormat(params.schema, params.schemaName),
    ...(params.maxOutputTokens ? { max_completion_tokens: params.maxOutputTokens } : {}),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("openai: structured output parse failed");
  return parsed;
}
