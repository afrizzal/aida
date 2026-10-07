// Ollama adapter — native `/api/chat` endpoint with the `format` JSON-Schema parameter
// (constrained decoding). D-03: reached via an operator-supplied base URL only, no bundled
// service in docker-compose.yml.
//
// Deliberately NOT using the OpenAI-compat `/v1` route: Ollama's OpenAI-compatibility shim has
// had a documented gap translating OpenAI's nested `response_format: {type: "json_schema", ...}`
// wire shape to Ollama's own flatter `format` parameter (ollama/ollama#10001), and current status
// is unverified. The native client's `format` option is Ollama's first-party, fully-supported
// structured-output mechanism. A future "collapse to one HTTP client" refactor MUST re-verify
// structured-output compliance against the OpenAI-compat route before relying on it.
//
// Relative imports only (no path alias) — worker-bundleable via esbuild.
import { Ollama } from "ollama";
import { z } from "zod/v4";
import { LlmOutputError, LlmTimeoutError } from "../errors";

/**
 * The default call deadline (Phase 12.2 D-14). Run decision K55: 120 s, because a local model on
 * a CPU can need more than the hosted adapters' 30 s for triage and drafts (unbounded before this
 * phase). A caller may pass its own deadline (KB proposal generation passes 180 s).
 */
export const OLLAMA_TIMEOUT_MS = 120_000;

/**
 * Runs `run` under one deadline that covers the whole call, from the request to the end of the
 * response body (Phase 12.2 review C4: the non-streamed Ollama client reads the body with
 * `response.json()` after `fetch` resolves, so a timer cleared when `fetch` settles would leave a
 * stalled body unbounded).
 *
 * One AbortController and one timer: the fetch given to `run` links the controller's signal (and
 * any signal the caller passes in the request init) to every request, so an expired deadline
 * aborts the request and its body. The call is also raced against the deadline, so a fetch
 * implementation that does not end a stalled body on abort is bounded too. The timer is cleared
 * in a `finally`; an abort caused by the timer surfaces as `LlmTimeoutError`. `setTimeout` and
 * `AbortController` (not `AbortSignal.timeout`) so fake timers control the tests.
 */
export async function withDeadline<T>(
  ms: number,
  run: (fetch: typeof globalThis.fetch) => Promise<T>,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const reason = new LlmTimeoutError();
      controller.abort(reason);
      reject(reason);
    }, ms);
  });
  const boundedFetch: typeof globalThis.fetch = (input, init) => {
    const signal = init?.signal
      ? AbortSignal.any([controller.signal, init.signal])
      : controller.signal;
    return baseFetch(input, { ...init, signal });
  };
  const call = (async () => run(boundedFetch))();
  // The losing promise of the race must never surface as an unhandled rejection.
  call.catch(() => {});
  deadline.catch(() => {});
  try {
    return await Promise.race([call, deadline]);
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason instanceof LlmTimeoutError) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface CompleteOllamaParams<T> {
  baseUrl: string;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Optional output-token cap; applied only when provided (no default cap for Ollama). */
  maxOutputTokens?: number;
  /** Optional call deadline in ms; OLLAMA_TIMEOUT_MS when absent (run decision K55). */
  timeoutMs?: number;
  /**
   * Optional context window (`num_ctx`), sent only when provided (review a2-WR-05). Without it the
   * server's default window applies, and Ollama drops input that does not fit without an error.
   */
  contextTokens?: number;
}

export async function completeOllama<T>(params: CompleteOllamaParams<T>): Promise<T> {
  // Deadline over the whole chat call, headers and body; pg-boss owns retry, not the SDK.
  const response = await withDeadline(params.timeoutMs ?? OLLAMA_TIMEOUT_MS, (fetch) =>
    new Ollama({ host: params.baseUrl, fetch }).chat({
      model: params.model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
      format: z.toJSONSchema(params.schema),
      options: {
        temperature: 0, // lower temperature = more reliable schema compliance
        ...(params.maxOutputTokens ? { num_predict: params.maxOutputTokens } : {}),
        ...(params.contextTokens ? { num_ctx: params.contextTokens } : {}),
      },
    }),
  );
  // Defense-in-depth re-validation — the constrained decoder is vendor-claimed compliant, but we
  // never trust an external process's output without re-validating it against our own schema.
  // A failure is reported with a fixed message: the model text never reaches the error.
  try {
    return params.schema.parse(JSON.parse(response.message.content));
  } catch {
    throw new LlmOutputError("ollama: structured output parse failed");
  }
}
