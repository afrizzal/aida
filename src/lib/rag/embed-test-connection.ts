// Connectivity probe for the embedding provider (mirrors src/lib/llm/test-connection.ts) — a
// trivial real embed() call (not just a models.list()) so a not-pulled Ollama model fails at
// "Test Connection" time (category connection_failed, K127) instead of later during chunk
// embedding (Pitfall 8). The Ollama reply must have Ollama's embed shape, and a 401 or 403 from the
// Ollama URL is connection_failed (K131).
import { Ollama } from "ollama";
import OpenAI from "openai";
import { fetchWithDeadline } from "../connection-test/deadline-fetch";
import { UncredentialedProbeError, UnexpectedResponseError } from "../connection-test/errors";
import type { EmbeddingProviderName } from "./types";

/** The Settings action's probe budget; the tests pass a shorter one through the same option. */
export const EMBEDDING_PROBE_TIMEOUT_MS = 10_000;

export interface EmbeddingTestConnectionConfig {
  provider: EmbeddingProviderName;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
}

/**
 * Throws on failure (bad key, unreachable host, model not pulled, timeout). Resolves on success.
 * Both providers have the same deadline: the SDK's own timeout for OpenAI, an aborting fetch for
 * Ollama (c-WR-03).
 */
export async function testEmbeddingConnection(
  config: EmbeddingTestConnectionConfig,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? EMBEDDING_PROBE_TIMEOUT_MS;
  switch (config.provider) {
    case "openai": {
      const client = new OpenAI({ apiKey: config.apiKey, timeout: timeoutMs, maxRetries: 0 });
      await client.embeddings.create({ model: config.model, input: ["ping"], dimensions: 768 });
      return;
    }
    case "ollama": {
      // AIDA sends Ollama no credential, so every failure is wrapped: a 401 or 403 from that URL
      // is connection_failed, never authentication_failed (K131).
      try {
        const client = new Ollama({
          host: config.ollamaBaseUrl,
          fetch: fetchWithDeadline(timeoutMs),
        });
        const input = ["ping"];
        assertOllamaEmbedShape(await client.embed({ model: config.model, input }), input.length);
      } catch (e) {
        throw new UncredentialedProbeError(e);
      }
      return;
    }
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}

/**
 * Passes only when the /api/embed reply has Ollama's shape: an `embeddings` array with one
 * non-empty array of finite numbers per input. Any other 200 is some other service at the URL
 * (K131).
 */
export function assertOllamaEmbedShape(reply: unknown, inputs: number): void {
  const embeddings =
    reply !== null && typeof reply === "object"
      ? (reply as { embeddings?: unknown }).embeddings
      : undefined;
  const valid =
    Array.isArray(embeddings) &&
    embeddings.length === inputs &&
    embeddings.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length > 0 &&
        vector.every((x) => typeof x === "number" && Number.isFinite(x)),
    );
  if (!valid) {
    throw new UnexpectedResponseError("the /api/embed reply has no embeddings of numbers");
  }
}
