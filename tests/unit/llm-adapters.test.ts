// Phase 12.2 code review fixes on the OpenAI and Anthropic adapters, with the REAL SDK clients and
// a stubbed global fetch (never a network call, never a real provider):
//   * review a2-WR-01: an answer the SDK itself refuses (OpenAI LengthFinishReasonError and
//     ContentFilterFinishReasonError, an Anthropic structured-output parse failure) is an
//     LlmOutputError with a fixed message, so it is INVALID_OUTPUT (terminal), never TRANSIENT.
//     Classified by class only; the model text never reaches the error.
//   * run decision K55 (review a2-WR-02): a caller deadline replaces the 30 s default, and
//     complete() passes the deadline and the context size through to every adapter.
// The SDK client classes are subclassed only to record their constructor options.
import { afterEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  openai: [] as Record<string, unknown>[],
  anthropic: [] as Record<string, unknown>[],
}));

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class RecordingOpenAI extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      recorded.openai.push({ ...options });
    }
  }
  return { ...actual, default: RecordingOpenAI };
});

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class RecordingAnthropic extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      recorded.anthropic.push({ ...options });
    }
  }
  return { ...actual, default: RecordingAnthropic };
});

import {
  APIConnectionTimeoutError as AnthropicConnectionTimeoutError,
  AnthropicError,
  RetryableError as AnthropicRetryableError,
} from "@anthropic-ai/sdk";
import { ContentFilterFinishReasonError, LengthFinishReasonError } from "openai/error";
import { z } from "zod/v4";
import { classifyLlmError, LlmOutputError } from "../../src/lib/llm/errors";
import { completeAnthropic, toAnthropicOutputError } from "../../src/lib/llm/providers/anthropic";
import { completeOpenAi, toOpenAiOutputError } from "../../src/lib/llm/providers/openai";
import type { SettingDb } from "../../src/lib/llm/settings";

const schema = z.object({ answer: z.string() });
const SECRET_OUTPUT = "MODEL-TEXT-7f3a";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function openAiCompletion(finishReason: string, content: string) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 0,
    model: "gpt-5.4-mini",
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        logprobs: null,
        message: { role: "assistant", content, refusal: null },
      },
    ],
  };
}

function anthropicMessage(text: string) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "max_tokens",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

const openAiParams = {
  apiKey: "sk-test-DUMMYKEY0000000000000000",
  model: "gpt-5.4-mini",
  system: "s",
  prompt: "p",
  schema,
  schemaName: "answer",
};

const anthropicParams = {
  apiKey: "sk-ant-test-DUMMYKEY000000000000",
  model: "claude-haiku-4-5",
  system: "s",
  prompt: "p",
  schema,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/lib/llm/active-provider");
  vi.resetModules();
  recorded.openai.length = 0;
  recorded.anthropic.length = 0;
});

describe("review a2-WR-01: answers the SDK refuses are INVALID_OUTPUT, by class", () => {
  it("OpenAI finish_reason 'length' (a real LengthFinishReasonError) becomes LlmOutputError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(openAiCompletion("length", `{"answer":"${SECRET_OUTPUT}`))),
    );
    const error = await caught(completeOpenAi(openAiParams));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).toBe("openai: structured output unusable");
    expect((error as Error).message).not.toContain(SECRET_OUTPUT);
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
  });

  it("OpenAI finish_reason 'content_filter' becomes LlmOutputError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(openAiCompletion("content_filter", ""))),
    );
    const error = await caught(completeOpenAi(openAiParams));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
  });

  it("the OpenAI mapping is by class: the two SDK classes map, anything else passes through", () => {
    expect(toOpenAiOutputError(new LengthFinishReasonError())).toBeInstanceOf(LlmOutputError);
    expect(toOpenAiOutputError(new ContentFilterFinishReasonError())).toBeInstanceOf(
      LlmOutputError,
    );
    const other = new Error("Could not parse response content as the length limit was reached");
    expect(toOpenAiOutputError(other)).toBe(other);
  });

  it("an Anthropic answer that is not JSON (a real SDK parse failure) becomes LlmOutputError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(anthropicMessage(`{"answer": "${SECRET_OUTPUT}`))),
    );
    const error = await caught(completeAnthropic(anthropicParams));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).toBe("anthropic: structured output parse failed");
    expect((error as Error).message).not.toContain(SECRET_OUTPUT);
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
  });

  it("an Anthropic answer that fails the schema becomes LlmOutputError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(anthropicMessage(JSON.stringify({ wrong: SECRET_OUTPUT })))),
    );
    const error = await caught(completeAnthropic(anthropicParams));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
  });

  it("the Anthropic mapping keeps API, connection and retryable errors as they are", () => {
    expect(toAnthropicOutputError(new AnthropicError("Failed to parse"))).toBeInstanceOf(
      LlmOutputError,
    );
    const timeout = new AnthropicConnectionTimeoutError();
    expect(toAnthropicOutputError(timeout)).toBe(timeout);
    expect(classifyLlmError(toAnthropicOutputError(timeout))).toBe("TRANSIENT");
    const retryable = new AnthropicRetryableError("retry");
    expect(toAnthropicOutputError(retryable)).toBe(retryable);
    const plain = new TypeError("fetch failed");
    expect(toAnthropicOutputError(plain)).toBe(plain);
  });

  it("a 503 from either SDK stays TRANSIENT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "overloaded" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    expect(classifyLlmError(await caught(completeOpenAi(openAiParams)))).toBe("TRANSIENT");
    expect(classifyLlmError(await caught(completeAnthropic(anthropicParams)))).toBe("TRANSIENT");
  });
});

describe("run decision K55: the caller's deadline reaches every adapter", () => {
  it("OpenAI and Anthropic keep 30 s by default and take a caller deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("anthropic")
          ? jsonResponse(anthropicMessage(JSON.stringify({ answer: "ok" })))
          : jsonResponse(openAiCompletion("stop", JSON.stringify({ answer: "ok" }))),
      ),
    );
    await completeOpenAi(openAiParams);
    await completeOpenAi({ ...openAiParams, timeoutMs: 180_000 });
    await completeAnthropic(anthropicParams);
    await completeAnthropic({ ...anthropicParams, timeoutMs: 180_000 });
    expect(recorded.openai.map((o) => [o.timeout, o.maxRetries])).toEqual([
      [30_000, 0],
      [180_000, 0],
    ]);
    expect(recorded.anthropic.map((o) => [o.timeout, o.maxRetries])).toEqual([
      [30_000, 0],
      [180_000, 0],
    ]);
  });

  it("complete() passes timeoutMs and contextTokens to the adapter of the active provider", async () => {
    const seen: Record<string, unknown>[] = [];
    vi.resetModules();
    vi.doMock("../../src/lib/llm/active-provider", () => ({
      resolveActiveProvider: async () => ({
        provider: "ollama",
        model: "llama3.1",
        apiKey: "",
        ollamaBaseUrl: "http://127.0.0.1:11434",
      }),
    }));
    vi.doMock("../../src/lib/llm/providers/ollama", () => ({
      completeOllama: async (params: Record<string, unknown>) => {
        seen.push(params);
        return { answer: "ok" };
      },
    }));
    const { complete } = await import("../../src/lib/llm/complete");
    const db = { setting: { findMany: async () => [] } } as unknown as SettingDb;
    await complete(db, {
      system: "s",
      prompt: "p",
      schema,
      schemaName: "answer",
      timeoutMs: 180_000,
      contextTokens: 32_768,
    });
    await complete(db, { system: "s", prompt: "p", schema, schemaName: "answer" });
    vi.doUnmock("../../src/lib/llm/providers/ollama");
    expect(seen[0]).toMatchObject({ timeoutMs: 180_000, contextTokens: 32_768 });
    expect(seen[1]?.timeoutMs).toBeUndefined();
    expect(seen[1]?.contextTokens).toBeUndefined();
  });
});
