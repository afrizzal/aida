// Typed LLM errors and their classification (Phase 12.2 D-14, pattern finding C4).
//
// A job that calls complete() needs to tell three kinds of failure apart without reading raw
// provider text: a configuration problem (terminal), an unusable answer (terminal) and a
// transient failure (bounded retry through pg-boss). classifyLlmError reads only the error's
// class and a numeric status field, never its message.
//
// Relative imports only (no path alias) — worker-bundleable via esbuild.
import { ZodError } from "zod/v4";

/** No provider configured, an unsupported provider, or a refused credential or model. */
export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

/** The provider answered, but the answer is not valid structured output. Fixed messages only. */
export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

/** The provider call did not finish before its deadline. */
export class LlmTimeoutError extends Error {
  constructor(message = "llm: call timed out") {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export type LlmErrorClass = "CONFIGURATION" | "INVALID_OUTPUT" | "TRANSIENT";

/**
 * HTTP statuses that a retry cannot fix: a bad request, a refused credential, a missing model or
 * an unprocessable request. 408, 409, 429 and every 5xx stay transient.
 */
const CONFIGURATION_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * The numeric HTTP status of an SDK error, read structurally: `status` on the OpenAI and
 * Anthropic `APIError`, `status_code` on the Ollama `ResponseError`. Null when absent.
 */
function statusOf(err: object): number | null {
  const record = err as { status?: unknown; status_code?: unknown };
  if (typeof record.status === "number") return record.status;
  if (typeof record.status_code === "number") return record.status_code;
  return null;
}

function isZodError(err: object): boolean {
  if (err instanceof ZodError) return true;
  const record = err as { name?: unknown; issues?: unknown };
  return record.name === "ZodError" && Array.isArray(record.issues);
}

/**
 * Classifies a thrown value from complete() or an adapter. Anything not recognised is TRANSIENT,
 * so an unknown failure is retried a bounded number of times rather than ending a job early.
 */
export function classifyLlmError(err: unknown): LlmErrorClass {
  if (err instanceof LlmTimeoutError) return "TRANSIENT";
  if (err instanceof LlmConfigurationError) return "CONFIGURATION";
  if (err instanceof LlmOutputError) return "INVALID_OUTPUT";
  if (typeof err !== "object" || err === null) return "TRANSIENT";
  if (isZodError(err)) return "INVALID_OUTPUT";
  if (err instanceof SyntaxError) return "INVALID_OUTPUT";
  const status = statusOf(err);
  if (status !== null && CONFIGURATION_STATUSES.has(status)) return "CONFIGURATION";
  return "TRANSIENT";
}
