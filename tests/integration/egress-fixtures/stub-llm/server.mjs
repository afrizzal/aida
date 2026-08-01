// Minimal Ollama-protocol stub for the egress-isolation test (07-09.1 Task 1). No npm
// dependencies (node:http is a builtin) — this is a standalone, always-on fixture container
// (unlike tests/e2e/support/llm-stub.ts, which is reconfigured live by whichever spec is
// driving it, this container just runs once for the whole `docker compose up` and must answer
// every caller autonomously). Implements the same three real Ollama routes the app's provider
// adapter calls (GET /api/tags, POST /api/embed, POST /api/chat — see src/lib/llm/providers/
// ollama.ts and src/lib/rag/providers/ollama-embed.ts), and picks the right canned /api/chat
// response by inspecting the incoming request's JSON-schema `format` field (which every one of
// this project's `complete<T>()` callers sends — triage, draft generation, and AIDA Insight's
// cluster-labeling + narrative calls each ask for a structurally different schema) rather than
// needing per-test reconfiguration.
import http from "node:http";

const CHAT_MODEL = "llama3.1";
const EMBED_MODEL = "nomic-embed-text";
const EMBEDDING_DIMENSIONS = 768; // src/lib/rag/types.ts's EMBEDDING_DIMENSIONS

// A fixed, identical vector for every input: cosine distance between any two embeddings is
// exactly 0, so the KB retrieval step in generate-draft.ts always finds the article "relevant"
// (well within MAX_COSINE_DISTANCE) regardless of the exact probe text used.
const FIXED_EMBEDDING = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

/** Picks a schema-appropriate canned response by inspecting the requested JSON-schema's
 * top-level property names — see this file's header comment. */
function buildChatResponse(properties, userContent) {
  const keys = new Set(Object.keys(properties ?? {}));

  if (keys.has("category") && keys.has("sentiment")) {
    return { category: "TECHNICAL", priority: "NORMAL", sentiment: "NEUTRAL", language: "en" };
  }
  if (keys.has("clusters")) {
    return { clusters: [] }; // schema-valid "nothing reached the reporting threshold"
  }
  if (keys.has("draftMarkdown")) {
    // Resolve the REAL chunkId(s) the prompt actually offered (fenced as `[chunkId: <id>]` by
    // src/lib/rag/draft-prompt.ts's buildDraftUserPrompt) — a genuine grounded citation, not a
    // fabricated one, proving the retrieval->citation wiring end to end.
    const matches = [...(userContent ?? "").matchAll(/\[chunkId: ([^\]]+)\]/g)].map((m) => m[1]);
    if (matches.length > 0) {
      return {
        grounded: true,
        draftMarkdown: "Stubbed grounded reply for the egress-isolation probe [1].",
        citations: [{ marker: "1", chunkId: matches[0] }],
      };
    }
    return { grounded: false, draftMarkdown: "No relevant sources.", citations: [] };
  }
  if (keys.has("summary")) {
    return { summary: "Stubbed insight narrative for the egress-isolation probe." };
  }
  return { note: "stub-llm: unrecognized schema", properties: [...keys] };
}

const server = http.createServer(async (req, res) => {
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
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    const embeddings = body.input.map(() => FIXED_EMBEDDING);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: EMBED_MODEL, embeddings }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    const userMessage = Array.isArray(body.messages)
      ? body.messages.find((m) => m.role === "user")?.content
      : undefined;
    const chatResponse = buildChatResponse(body.format?.properties, userMessage);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: CHAT_MODEL,
        created_at: new Date().toISOString(),
        message: { role: "assistant", content: JSON.stringify(chatResponse) },
        done: true,
      }),
    );
    return;
  }

  res.writeHead(404).end();
});

server.listen(11434, "0.0.0.0", () => {
  console.log("[stub-llm] listening on 0.0.0.0:11434");
});
