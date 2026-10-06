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
  /** How /api/chat answers (Phase 12.2 plan 11). "ok" (the default) is the original answer:
   * status 200 with JSON.stringify(chatResponse) as message.content. "notFound" answers HTTP 404
   * with a real Ollama "model not pulled" error body. "rawContent" answers 200 with chatRawContent
   * verbatim (not JSON-encoded) as message.content. */
  chatMode: ChatMode;
  /** message.content of a "rawContent" answer, used verbatim. */
  chatRawContent: string;
  /** Every /api/chat request body, in arrival order, one entry per chatCalls increment. A body
   * that does not parse is recorded as model "" with no messages, so the entries stay aligned. */
  chatRequests: ChatRequestRecord[];
  /** The /api/chat requests currently waiting on an active hold (0 when no hold is active). */
  heldChatCount: number;
  /** Starts a hold: from now on every /api/chat request is recorded and counted in heldChatCount,
   * but its answer is deferred. The returned function answers every held request with the
   * chatMode, chatRawContent and chatResponse current at release time and ends the hold; calling
   * it again does nothing. Calling holdChat while a hold is active keeps that hold. */
  holdChat(): () => void;
  start(): Promise<void>;
  stop(): void;
}

export type ChatMode = "ok" | "notFound" | "rawContent";

export interface ChatRequestRecord {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

/** Reads the model and messages of one /api/chat request body; never throws. */
function parseChatRequest(raw: string): ChatRequestRecord {
  try {
    const body = JSON.parse(raw) as { model?: unknown; messages?: unknown };
    const messages = Array.isArray(body.messages)
      ? body.messages.map((message: { role?: unknown; content?: unknown }) => ({
          role: typeof message?.role === "string" ? message.role : "",
          content: typeof message?.content === "string" ? message.content : "",
        }))
      : [];
    return { model: typeof body.model === "string" ? body.model : "", messages };
  } catch {
    return { model: "", messages: [] };
  }
}

export function createLlmStub(): LlmStub {
  /** The responses waiting on the active hold; null while no hold is active. */
  let heldResponses: http.ServerResponse[] | null = null;

  /** Writes one /api/chat answer for the stub's current chatMode. */
  function answerChat(res: http.ServerResponse): void {
    if (res.destroyed || res.writableEnded) return; // the client gave up while it was held
    if (stub.chatMode === "notFound") {
      // Mirrors a real Ollama "model not pulled" error, shaped like the embedMode "fail" branch.
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `model "${CHAT_MODEL}" not found, try pulling it first` }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: CHAT_MODEL,
        created_at: new Date().toISOString(),
        message: {
          role: "assistant",
          content:
            stub.chatMode === "rawContent"
              ? stub.chatRawContent
              : JSON.stringify(stub.chatResponse),
        },
        done: true,
      }),
    );
  }

  /** Answers every held request and ends the hold. */
  function releaseHeld(): void {
    const pending = heldResponses ?? [];
    heldResponses = null;
    stub.heldChatCount = 0;
    for (const res of pending) answerChat(res);
  }

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
    chatMode: "ok",
    chatRawContent: "",
    chatRequests: [],
    heldChatCount: 0,

    holdChat(): () => void {
      heldResponses ??= [];
      const hold = heldResponses;
      // Bound to this hold: a stale release function never ends a later hold.
      return () => {
        if (heldResponses === hold) releaseHeld();
      };
    },

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
            let raw = "";
            req.on("data", (chunk: Buffer) => {
              raw += chunk.toString();
            });
            req.on("end", () => {
              stub.chatRequests.push(parseChatRequest(raw));
              if (heldResponses) {
                heldResponses.push(res);
                stub.heldChatCount = heldResponses.length;
                return;
              }
              answerChat(res);
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
      releaseHeld();
      stub.server?.close();
    },
  };
  return stub;
}
