// Phase 12.2 D-14, pattern finding C4: every adapter failure maps to CONFIGURATION,
// INVALID_OUTPUT or TRANSIENT by class and numeric status only, and the existing throw sites
// throw the typed classes with their previous messages. No network: the OpenAI and Anthropic
// SDK clients are replaced by fakes (their error classes stay real), the Ollama case stubs the
// global fetch.
import {
  AuthenticationError as AnthropicAuthenticationError,
  APIConnectionTimeoutError as AnthropicConnectionTimeoutError,
  RateLimitError as AnthropicRateLimitError,
} from "@anthropic-ai/sdk";
import {
  AuthenticationError as OpenAiAuthenticationError,
  APIConnectionTimeoutError as OpenAiConnectionTimeoutError,
  RateLimitError as OpenAiRateLimitError,
} from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { resolveActiveProvider } from "../../src/lib/llm/active-provider";
import {
  classifyLlmError,
  LlmConfigurationError,
  LlmOutputError,
  LlmTimeoutError,
} from "../../src/lib/llm/errors";
import { completeAnthropic } from "../../src/lib/llm/providers/anthropic";
import { completeOllama } from "../../src/lib/llm/providers/ollama";
import { completeOpenAi } from "../../src/lib/llm/providers/openai";
import type { SettingDb } from "../../src/lib/llm/settings";

// Fake SDK clients whose structured-output call returns no parsed value. The rest of each
// package (its error classes, helpers) stays the real module.
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    chat = {
      completions: {
        parse: async () => ({ choices: [{ message: { parsed: null } }] }),
      },
    };
  }
  return { ...actual, default: FakeOpenAI };
});

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    messages = {
      parse: async () => ({ parsed_output: null }),
    };
  }
  return { ...actual, default: FakeAnthropic };
});

const schema = z.object({ answer: z.string() });

function zodErrorOf(): unknown {
  const result = schema.safeParse({ unexpected: 1 });
  if (result.success) throw new Error("expected a failed parse");
  return result.error;
}

function syntaxErrorOf(): unknown {
  try {
    JSON.parse("not json");
  } catch (err) {
    return err;
  }
  throw new Error("expected a SyntaxError");
}

describe("classifyLlmError", () => {
  it("CONFIGURATION: the typed class and statuses 400, 401, 403, 404, 422", () => {
    expect(classifyLlmError(new LlmConfigurationError("x"))).toBe("CONFIGURATION");
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyLlmError({ status })).toBe("CONFIGURATION");
    }
  });

  it("CONFIGURATION: status_code 404 (the Ollama ResponseError shape)", () => {
    expect(classifyLlmError({ status_code: 404 })).toBe("CONFIGURATION");
  });

  it("TRANSIENT: statuses 408, 409, 429, 500 and 503", () => {
    for (const status of [408, 409, 429, 500, 503]) {
      expect(classifyLlmError({ status })).toBe("TRANSIENT");
    }
  });

  it("INVALID_OUTPUT: LlmOutputError, a ZodError from a failed parse and a SyntaxError", () => {
    expect(classifyLlmError(new LlmOutputError("x"))).toBe("INVALID_OUTPUT");
    expect(classifyLlmError(zodErrorOf())).toBe("INVALID_OUTPUT");
    expect(classifyLlmError(syntaxErrorOf())).toBe("INVALID_OUTPUT");
    expect(classifyLlmError(new SyntaxError("x"))).toBe("INVALID_OUTPUT");
  });

  it("TRANSIENT: timeout, abort, connection failure, a string and undefined", () => {
    expect(classifyLlmError(new LlmTimeoutError())).toBe("TRANSIENT");
    expect(classifyLlmError(new DOMException("aborted", "AbortError"))).toBe("TRANSIENT");
    expect(classifyLlmError(new TypeError("fetch failed"))).toBe("TRANSIENT");
    expect(classifyLlmError("boom")).toBe("TRANSIENT");
    expect(classifyLlmError(undefined)).toBe("TRANSIENT");
  });

  it("reads the status, never the message text", () => {
    const misleading = Object.assign(new Error("401 Unauthorized invalid api key"), {
      status: 429,
    });
    expect(classifyLlmError(misleading)).toBe("TRANSIENT");
    expect(classifyLlmError(new Error("400 bad request"))).toBe("TRANSIENT");
  });

  it("real OpenAI SDK errors: 401 CONFIGURATION, 429 and a connection timeout TRANSIENT", () => {
    const headers = new Headers();
    expect(classifyLlmError(new OpenAiAuthenticationError(401, {}, "auth", headers))).toBe(
      "CONFIGURATION",
    );
    expect(classifyLlmError(new OpenAiRateLimitError(429, {}, "rate", headers))).toBe("TRANSIENT");
    expect(classifyLlmError(new OpenAiConnectionTimeoutError())).toBe("TRANSIENT");
  });

  it("real Anthropic SDK errors: 401 CONFIGURATION, 429 and a connection timeout TRANSIENT", () => {
    const headers = new Headers();
    expect(classifyLlmError(new AnthropicAuthenticationError(401, {}, "auth", headers))).toBe(
      "CONFIGURATION",
    );
    expect(classifyLlmError(new AnthropicRateLimitError(429, {}, "rate", headers))).toBe(
      "TRANSIENT",
    );
    expect(classifyLlmError(new AnthropicConnectionTimeoutError())).toBe("TRANSIENT");
  });
});

describe("typed throw sites keep their messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../../src/lib/llm/active-provider");
    vi.resetModules();
  });

  it("resolveActiveProvider throws LlmConfigurationError 'No LLM provider configured'", async () => {
    const db = { setting: { findMany: async () => [] } } as unknown as SettingDb;
    const error = await resolveActiveProvider(db).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmConfigurationError);
    expect((error as Error).message).toBe("No LLM provider configured");
    expect(classifyLlmError(error)).toBe("CONFIGURATION");
  });

  it("complete() throws LlmConfigurationError 'Unsupported provider: …' for an unknown provider", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/llm/active-provider", () => ({
      resolveActiveProvider: async () => ({
        provider: "bogus",
        model: "m",
        apiKey: "",
        ollamaBaseUrl: "",
      }),
    }));
    const { complete } = await import("../../src/lib/llm/complete");
    const errors = await import("../../src/lib/llm/errors");
    const db = { setting: { findMany: async () => [] } } as unknown as SettingDb;
    const error = await complete(db, {
      system: "s",
      prompt: "p",
      schema,
      schemaName: "answer",
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(errors.LlmConfigurationError);
    expect((error as Error).name).toBe("LlmConfigurationError");
    expect((error as Error).message).toBe("Unsupported provider: bogus");
    expect(errors.classifyLlmError(error)).toBe("CONFIGURATION");
  });

  it("completeOpenAi throws LlmOutputError 'openai: structured output parse failed'", async () => {
    const error = await completeOpenAi({
      apiKey: "fake-key",
      model: "gpt-5.4-mini",
      system: "s",
      prompt: "p",
      schema,
      schemaName: "answer",
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).toBe("openai: structured output parse failed");
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
  });

  it("completeAnthropic throws LlmOutputError 'anthropic: structured output parse failed'", async () => {
    const error = await completeAnthropic({
      apiKey: "fake-key",
      model: "claude-haiku-4-5",
      system: "s",
      prompt: "p",
      schema,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).toBe("anthropic: structured output parse failed");
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
  });

  it("an Ollama 404 (a real ResponseError, status_code) is CONFIGURATION", async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "model not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const error = await completeOllama({
      baseUrl: "http://127.0.0.1:11434",
      model: "missing-model",
      system: "s",
      prompt: "p",
      schema,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect((error as { name?: string }).name).toBe("ResponseError");
    expect((error as { status_code?: number }).status_code).toBe(404);
    expect(classifyLlmError(error)).toBe("CONFIGURATION");
  });
});
