// In-process Ollama-protocol stub server — extracted from tests/e2e/phase5-rag.spec.ts (07-09.1
// Task 2) so every e2e spec that needs a fake LLM/embedding provider shares ONE implementation
// instead of a third copy. Answers the three real Ollama routes the app's provider adapter
// actually calls (verified against node_modules/ollama's dist/browser.mjs, per phase5-rag.spec.ts's
// original comment):
//   - GET  /api/tags   — Settings "Test Connection" + model-list lookup
//   - POST /api/embed  — the embedding provider (src/lib/rag/embed.ts)
//   - POST /api/chat   — the completion provider (src/lib/llm/providers/ollama.ts), used by
//     triage, draft-generation, and AIDA Insight's cluster-labeling + narrative calls alike —
//     they all go through the same `complete()` port, so one stub route serves every caller.
import http from "node:http";
import { EMBEDDING_DIMENSIONS } from "../../../src/lib/rag/types";

export const CHAT_MODEL = "llama3.1"; // MODEL_CATALOG.ollama[0]
export const EMBED_MODEL = "nomic-embed-text"; // EMBEDDING_MODEL_CATALOG.ollama[0]

export type EmbedFn = (text: string) => number[];

/**
 * `chatResponse` and `embedFn` are mutable so a test can reconfigure the stub's answer between
 * UI actions without restarting the server (mirrors phase5-rag.spec.ts's original
 * `stub.draftResponse` mutation pattern, generalized to `unknown` since different callers'
 * `complete<T>()` re-parses this same JSON string against their own zod schema — DraftResult,
 * InsightNarrative, ClusterLabelsResult, etc. are all valid `chatResponse` shapes).
 */
export interface LlmStub {
  server: http.Server | null;
  url: string;
  chatCalls: number;
  embedMode: "ok" | "fail";
  chatResponse: unknown;
  /** Computes the embedding vector returned for one /api/embed input string. Override per test —
   * the default returns an all-zero vector of the real embedding dimensionality, adequate only
   * for callers that never inspect embedding content (e.g. a chat-only narrative test). */
  embedFn: EmbedFn;
  start(): Promise<void>;
  stop(): void;
}

export function createLlmStub(): LlmStub {
  const stub: LlmStub = {
    server: null,
    url: "",
    chatCalls: 0,
    embedMode: "ok",
    chatResponse: {
      grounded: false,
      draftMarkdown: "stub default — no test configured a chatResponse yet",
      citations: [],
    },
    embedFn: () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),

    start(): Promise<void> {
      return new Promise((resolve) => {
        stub.server = http.createServer((req, res) => {
          if (req.method === "GET" && req.url?.startsWith("/api/tags")) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                models: [
                  { name: CHAT_MODEL, model: CHAT_MODEL },
                  { name: EMBED_MODEL, model: EMBED_MODEL },
                ],
              }),
            );
            return;
          }

          if (req.method === "POST" && req.url?.startsWith("/api/embed")) {
            if (stub.embedMode === "fail") {
              // Mirrors a real Ollama "model not pulled" error — a clear, specific message, never
              // a generic 500 — so the settings UI's failure branch has real content to surface.
              res.writeHead(404, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  error: `model "${EMBED_MODEL}" not found, try pulling it first`,
                }),
              );
              return;
            }
            let raw = "";
            req.on("data", (chunk: Buffer) => {
              raw += chunk.toString();
            });
            req.on("end", () => {
              const body = JSON.parse(raw) as { model: string; input: string[] };
              const embeddings = body.input.map((text) => stub.embedFn(text));
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ model: EMBED_MODEL, embeddings }));
            });
            return;
          }

          if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
            stub.chatCalls += 1;
            req.on("data", () => {});
            req.on("end", () => {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  model: CHAT_MODEL,
                  created_at: new Date().toISOString(),
                  message: { role: "assistant", content: JSON.stringify(stub.chatResponse) },
                  done: true,
                }),
              );
            });
            return;
          }

          res.writeHead(404).end();
        });
        stub.server.listen(0, "127.0.0.1", () => {
          const addr = stub.server?.address();
          if (addr && typeof addr === "object") stub.url = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    },

    stop(): void {
      stub.server?.close();
    },
  };
  return stub;
}
