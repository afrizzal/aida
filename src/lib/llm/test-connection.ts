// Connectivity probe (D-04) — mirrors Settings -> Email's testImapConnection/testSmtpConnection
// pattern exactly: a cheap, cost-free call with a 10s timeout that throws on failure. Used by the
// settings UI's per-provider "Test Connection" button, never as a gate on the AI-enabled toggle
// (D-21 — a persisted result would go stale the moment a key is revoked or Ollama goes down).
import Anthropic from "@anthropic-ai/sdk";
import { Ollama } from "ollama";
import OpenAI from "openai";
import type { LlmProviderName } from "./types";

export interface TestConnectionConfig {
  provider: LlmProviderName;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
}

/** Throws on failure (bad key, unreachable host, timeout). Resolves on success. */
export async function testProviderConnection(config: TestConnectionConfig): Promise<void> {
  switch (config.provider) {
    case "openai": {
      const client = new OpenAI({ apiKey: config.apiKey, timeout: 10_000, maxRetries: 0 });
      await client.models.list();
      return;
    }
    case "anthropic": {
      const client = new Anthropic({ apiKey: config.apiKey, timeout: 10_000, maxRetries: 0 });
      await client.models.list();
      return;
    }
    case "ollama": {
      const client = new Ollama({ host: config.ollamaBaseUrl });
      await client.list();
      return;
    }
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}
