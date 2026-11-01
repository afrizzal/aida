// Connectivity probe for the embedding provider (mirrors src/lib/llm/test-connection.ts) — a
// trivial real embed() call (not just a models.list()) so a not-pulled Ollama model fails at
// "Test Connection" time (category connection_failed, K127) instead of later during chunk
// embedding (Pitfall 8).
import { Ollama } from "ollama";
import OpenAI from "openai";
import { fetchWithDeadline } from "../connection-test/deadline-fetch";
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
      const client = new Ollama({
        host: config.ollamaBaseUrl,
        fetch: fetchWithDeadline(timeoutMs),
      });
      await client.embed({ model: config.model, input: ["ping"] });
      return;
    }
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}
