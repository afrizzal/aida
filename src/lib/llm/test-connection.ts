// Connectivity probe (D-04) — mirrors Settings -> Email's testImapConnection/testSmtpConnection
// pattern exactly: a cheap, cost-free call with a 10s timeout that throws on failure. Used by the
// settings UI's per-provider "Test Connection" button, never as a gate on the AI-enabled toggle
// (D-21 — a persisted result would go stale the moment a key is revoked or Ollama goes down).
import Anthropic from "@anthropic-ai/sdk";
import { Ollama } from "ollama";
import OpenAI from "openai";
import { fetchWithDeadline } from "../connection-test/deadline-fetch";
import type { LlmProviderName } from "./types";

/** The Settings action's probe budget; the tests pass a shorter one through the same option. */
export const PROBE_TIMEOUT_MS = 10_000;

export interface TestConnectionConfig {
  provider: LlmProviderName;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
}

/**
 * Throws on failure (bad key, unreachable host, timeout). Resolves on success. Every provider
 * has the same deadline: the SDK's own timeout for OpenAI and Anthropic, an aborting fetch for
 * Ollama (c-WR-03).
 */
export async function testProviderConnection(
  config: TestConnectionConfig,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? PROBE_TIMEOUT_MS;
  switch (config.provider) {
    case "openai": {
      const client = new OpenAI({ apiKey: config.apiKey, timeout: timeoutMs, maxRetries: 0 });
      await client.models.list();
      return;
    }
    case "anthropic": {
      const client = new Anthropic({ apiKey: config.apiKey, timeout: timeoutMs, maxRetries: 0 });
      await client.models.list();
      return;
    }
    case "ollama": {
      const client = new Ollama({
        host: config.ollamaBaseUrl,
        fetch: fetchWithDeadline(timeoutMs),
      });
      await client.list();
      return;
    }
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}
