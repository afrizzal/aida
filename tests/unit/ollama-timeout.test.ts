// Phase 12.2 D-14 and review C4: the Ollama call is bounded at 30 s from the request to the end of
// the response body. Fake timers (setTimeout and clearTimeout only; streams and microtasks stay
// real), a stubbed global fetch, the real ollama client; never a network call, never a real wait.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { classifyLlmError, LlmOutputError, LlmTimeoutError } from "../../src/lib/llm/errors";
import {
  completeOllama,
  OLLAMA_TIMEOUT_MS,
  withDeadline,
} from "../../src/lib/llm/providers/ollama";

type Settled = { state: "pending" | "resolved" | "rejected"; value?: unknown; error?: unknown };

function track<T>(promise: Promise<T>): Settled {
  const settled: Settled = { state: "pending" };
  promise.then(
    (value) => {
      settled.state = "resolved";
      settled.value = value;
    },
    (error) => {
      settled.state = "rejected";
      settled.error = error;
    },
  );
  return settled;
}

/** A fetch that never answers and rejects only when its request signal aborts. */
function hangingFetch() {
  const calls: { url: string; aborted: boolean }[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), aborted: false };
    calls.push(call);
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (!signal) return; // never settles; the test would see no abort recorded
      signal.addEventListener(
        "abort",
        () => {
          call.aborted = true;
          reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    });
  });
  return { fetchStub, calls };
}

/** A fetch that answers 200 at once with a body that never enqueues and errors on abort. */
function stalledBodyFetch() {
  const record = { calls: 0, url: "", bodyAborted: false };
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    record.calls += 1;
    record.url = String(input);
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        signal?.addEventListener(
          "abort",
          () => {
            record.bodyAborted = true;
            streamController.error(signal.reason);
          },
          { once: true },
        );
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fetchStub, record };
}

/** A fetch that answers a complete chat envelope whose message content is `content`. */
function answeringFetch(content: string) {
  const record = { calls: 0, url: "" };
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    record.calls += 1;
    record.url = String(input);
    const envelope = {
      model: "llama3.1",
      created_at: "2026-11-09T00:00:00Z",
      message: { role: "assistant", content },
      done: true,
      done_reason: "stop",
    };
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchStub, record };
}

const schema = z.object({ answer: z.string() });

function callOllama() {
  return completeOllama({
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.1",
    system: "system text",
    prompt: "prompt text",
    schema,
  });
}

describe("withDeadline and completeOllama (D-14, review C4)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses a 30 s deadline", () => {
    expect(OLLAMA_TIMEOUT_MS).toBe(30_000);
  });

  it("rejects a request without an answer at 30 s with LlmTimeoutError, classified TRANSIENT", async () => {
    const { fetchStub, calls } = hangingFetch();
    const promise = withDeadline(
      OLLAMA_TIMEOUT_MS,
      (fetch) => fetch("http://127.0.0.1:11434/api/chat"),
      fetchStub,
    );
    const settled = track(promise);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled.state).toBe("pending");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(settled.state).toBe("rejected");
    expect(classifyLlmError(settled.error)).toBe("TRANSIENT");
    expect(calls[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a call whose headers arrived and whose body stalls, at 30 s (review C4)", async () => {
    const { fetchStub, record } = stalledBodyFetch();
    vi.stubGlobal("fetch", fetchStub);
    const promise = callOllama();
    const settled = track(promise);

    await vi.advanceTimersByTimeAsync(29_999);
    // The real ollama client reached the stubbed fetch and received the headers.
    expect(record.calls).toBe(1);
    expect(record.url).toContain("/api/chat");
    expect(settled.state).toBe("pending");
    expect(record.bodyAborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(record.bodyAborted).toBe(true);
    expect(classifyLlmError(settled.error)).toBe("TRANSIENT");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves a complete answer before the deadline with the parsed output and leaves no timer", async () => {
    const { fetchStub, record } = answeringFetch(JSON.stringify({ answer: "ok" }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(callOllama()).resolves.toEqual({ answer: "ok" });
    expect(record.calls).toBe(1);
    expect(record.url).toContain("/api/chat");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts the request when a signal passed in the request init aborts first", async () => {
    const { fetchStub, calls } = hangingFetch();
    const caller = new AbortController();
    const promise = withDeadline(
      OLLAMA_TIMEOUT_MS,
      (fetch) => fetch("http://127.0.0.1:11434/api/chat", { signal: caller.signal }),
      fetchStub,
    );
    const settled = track(promise);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled.state).toBe("pending");
    caller.abort(new DOMException("caller aborted", "AbortError"));

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(settled.error).not.toBeInstanceOf(LlmTimeoutError);
    expect(calls[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports content that is not JSON as LlmOutputError with a fixed message and no content", async () => {
    const content = "SECRET-NOT-JSON model said this";
    const { fetchStub } = answeringFetch(content);
    vi.stubGlobal("fetch", fetchStub);

    const error = await callOllama().then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).toBe("ollama: structured output parse failed");
    expect((error as Error).message).not.toContain("SECRET-NOT-JSON");
    expect(classifyLlmError(error)).toBe("INVALID_OUTPUT");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports content that fails the schema as LlmOutputError with a fixed message and no content", async () => {
    const content = JSON.stringify({ unexpected: "SECRET-SCHEMA-MISS" });
    const { fetchStub } = answeringFetch(content);
    vi.stubGlobal("fetch", fetchStub);

    const error = await callOllama().then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).toBe("ollama: structured output parse failed");
    expect((error as Error).message).not.toContain("SECRET-SCHEMA-MISS");
    expect(vi.getTimerCount()).toBe(0);
  });
});
