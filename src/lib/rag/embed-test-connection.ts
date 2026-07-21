// Connectivity probe for the embedding provider (mirrors src/lib/llm/test-connection.ts) — a
// trivial real embed() call (not just a models.list()) so a not-pulled Ollama model surfaces a
// clear "Test Connection" failure instead of a generic 500 later during chunk embedding
// (Pitfall 8).
import { Ollama } from "ollama";
import OpenAI from "openai";
import type { EmbeddingProviderName } from "./types";

export interface EmbeddingTestConnectionConfig {
  provider: EmbeddingProviderName;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
}

/** Throws on failure (bad key, unreachable host, model not pulled, timeout). Resolves on success. */
export async function testEmbeddingConnection(
  config: EmbeddingTestConnectionConfig,
): Promise<void> {
  switch (config.provider) {
    case "openai": {
      const client = new OpenAI({ apiKey: config.apiKey, timeout: 10_000, maxRetries: 0 });
      await client.embeddings.create({ model: config.model, input: ["ping"], dimensions: 768 });
      return;
    }
    case "ollama": {
      const client = new Ollama({ host: config.ollamaBaseUrl });
      await client.embed({ model: config.model, input: ["ping"] });
      return;
    }
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}
