import { type ChildProcess, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { NO_RELEVANT_CONTENT_MESSAGE } from "../../src/lib/rag/draft-prompt";
import { EMBEDDING_DIMENSIONS } from "../../src/lib/rag/types";
import { createTicket, orgId, prisma } from "./support/db";
import { databaseUrl } from "./support/test-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const VISUAL_DIR = path.join(PROJECT_ROOT, "test-results", "phase5-visual");

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();
// Present in BOTH the KB article's content and the "grounded" ticket's inbound message —
// never in the "ungrounded" ticket's message. The embedding stub below keys off this literal
// substring (not real semantic similarity) to deterministically control which pgvector cosine
// distances land inside/outside generate-draft.ts's MAX_COSINE_DISTANCE gate, with zero flake.
const MARKER = `aida-e2e-kb-marker-${ts}`;
const CHAT_MODEL = "llama3.1"; // MODEL_CATALOG.ollama[0]
const EMBED_MODEL = "nomic-embed-text"; // EMBEDDING_MODEL_CATALOG.ollama[0]

// ---------------------------------------------------------------------------
// Deterministic embedding vectors — two mutually orthogonal patterns (disjoint halves of the
// dimension space), so cosine distance between them is EXACTLY 1 (comfortably beyond the 0.5
// groundedness threshold) with no randomness and no probabilistic flake risk.
// ---------------------------------------------------------------------------
const HALF = EMBEDDING_DIMENSIONS / 2;
const CANONICAL_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 1 : 0,
);
const UNRELATED_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 0 : 1,
);

interface StubDraftResponse {
  grounded: boolean;
  draftMarkdown: string;
  citations: { marker: string; chunkId: string }[];
}

// ---------------------------------------------------------------------------
// Ollama stub — extends phase4-ai.spec.ts's stub pattern with the embedding endpoint
// (`/api/embed`, the real Ollama `client.embed()` route — verified against
// node_modules/ollama's dist/browser.mjs) alongside the existing `/api/chat` completion route.
// One server answers both the chat provider AND the embedding provider (mirrors how a single
// real Ollama instance serves both in production).
// ---------------------------------------------------------------------------
const stub = {
  server: null as http.Server | null,
  url: "",
  chatCalls: 0,
  embedMode: "ok" as "ok" | "fail",
  draftResponse: {
    grounded: false,
    draftMarkdown: "stub default — no test configured a draftResponse yet",
    citations: [],
  } as StubDraftResponse,
};

function startStub(): Promise<void> {
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
          // Mirrors a real Ollama "model not pulled" error — a clear, specific message (Pitfall
          // 8), never a generic 500 — so the settings UI's failure branch has real content to
          // surface, not just an opaque status code.
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `model "${EMBED_MODEL}" not found, try pulling it first` }));
          return;
        }
        let raw = "";
        req.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        req.on("end", () => {
          const body = JSON.parse(raw) as { model: string; input: string[] };
          const embeddings = body.input.map((text) =>
            text.includes(MARKER) ? CANONICAL_VECTOR : UNRELATED_VECTOR,
          );
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
              message: { role: "assistant", content: JSON.stringify(stub.draftResponse) },
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
}

// ---------------------------------------------------------------------------
// Worker process — owns the kb-embed-article queue (mirrors phase4-ai.spec.ts's startWorker
// exactly; a fresh child process per spec file, started after the previous spec file's own
// worker was torn down in its afterAll).
// ---------------------------------------------------------------------------
let worker: ChildProcess | null = null;
let workerLog = "";

function readEnvVar(name: string): string {
  const envFile = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf-8");
  const match = envFile.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function startWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tsxCli = path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    worker = spawn(process.execPath, [tsxCli, path.join("src", "lib", "worker", "index.ts")], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        APP_ENCRYPTION_KEY: readEnvVar("APP_ENCRYPTION_KEY"),
      },
      stdio: "pipe",
    });
    const timer = setTimeout(
      () => reject(new Error(`worker did not start; log so far:\n${workerLog}`)),
      120_000,
    );
    worker.stdout?.on("data", (chunk: Buffer) => {
      workerLog += chunk.toString();
      if (workerLog.includes("[worker] started")) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.stderr?.on("data", (chunk: Buffer) => {
      workerLog += chunk.toString();
    });
    worker.on("close", (code) => {
      if (!workerLog.includes("[worker] started")) {
        clearTimeout(timer);
        reject(new Error(`worker exited early (code ${code}):\n${workerLog}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// First-hit compile-race guard (project pitfall: next dev can transiently 404 a route before
// its first compile finishes). `/kb` and `/kb/new` are never touched by any earlier spec file in
// the run, so THIS spec's first navigation to each is a genuine cold hit — poll on status rather
// than trusting a single page.goto, per global-setup.ts's comment (~line 127) and
// attachments.spec.ts's precedent for the same race on a different route shape.
// ---------------------------------------------------------------------------
async function gotoWarm(page: Page, urlPath: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.goto(urlPath);
        return res?.status() ?? 0;
      },
      { timeout: 15_000 },
    )
    .not.toBe(404);
}

test.beforeAll(async () => {
  test.setTimeout(180_000); // worker cold start (tsx + pg-boss schema install) can be slow
  fs.mkdirSync(VISUAL_DIR, { recursive: true });
  await startStub();
  await startWorker();
});

test.afterAll(async () => {
  if (worker?.pid) {
    try {
      execSync(`taskkill /pid ${worker.pid} /t /f`);
    } catch {
      // already gone
    }
  }
  stub.server?.close();
});

// ---------------------------------------------------------------------------
// 05-VERIFICATION.md item 3 support (visual pass) — /kb empty state, MUST run before any KB
// article exists, i.e. before every other test in this file.
// ---------------------------------------------------------------------------
test("KB empty state: halo+icon-box EmptyState renders at zero articles", async ({ page }) => {
  await gotoWarm(page, "/kb");

  await expect(page.getByRole("heading", { name: "No articles yet" })).toBeVisible();
  await expect(
    page.getByText("Create knowledge base articles so AIDA can draft grounded, cited replies."),
  ).toBeVisible();
  // The shared EmptyState component's halo + icon-box wrapper (token-only: bg-primary/10 +
  // border-primary/15) — DESIGN-SYSTEM.md's mandated empty-state pattern.
  await expect(
    page.locator('div[class*="bg-primary/10"][class*="border-primary/15"]'),
  ).toBeVisible();

  await page.screenshot({ path: path.join(VISUAL_DIR, "kb-empty-state.png"), fullPage: true });
});

// ---------------------------------------------------------------------------
// 05-VERIFICATION.md human_verification item 2 — Settings: configure BOTH the chat/completion
// provider and the (independent, Decision 5) embedding provider, pointed at the stub, and prove
// they persist. Both forms share "Provider"/"Model"/"Base URL" labels on the same page, so every
// locator below is scoped to its own <form> via a `hasText` filter on that card's heading text.
// ---------------------------------------------------------------------------
test("Settings: LLM + Embedding providers save and round-trip pointed at the RAG stub", async ({
  page,
}) => {
  await page.goto("/settings");

  const llmCard = page.locator("form").filter({ hasText: "AI Provider" });
  const embedCard = page.locator("form").filter({ hasText: "Embedding Provider" });

  await llmCard.getByLabel("Provider").click();
  await page.getByRole("option", { name: "Ollama" }).click();
  await expect(llmCard.getByLabel("Model")).toContainText(CHAT_MODEL);
  await llmCard.getByLabel("Base URL").fill(stub.url);
  await llmCard.getByRole("button", { name: "Save AI provider" }).click();
  await expect(page.getByText("AI provider settings saved.")).toBeVisible();

  await embedCard.getByLabel("Provider").click();
  await page.getByRole("option", { name: "Ollama" }).click();
  await expect(embedCard.getByLabel("Model")).toContainText(EMBED_MODEL);
  await embedCard.getByLabel("Base URL").fill(stub.url);
  await embedCard.getByRole("button", { name: "Save embedding provider" }).click();
  await expect(page.getByText("Embedding provider settings saved.")).toBeVisible();

  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "llm:provider" } });
      return row?.value ?? null;
    })
    .toBe("ollama");
  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "llm:embeddingProvider" } });
      return row?.value ?? null;
    })
    .toBe("ollama");

  await page.reload();
  await expect(llmCard.getByLabel("Provider")).toContainText("Ollama");
  await expect(llmCard.getByLabel("Base URL")).toHaveValue(stub.url);
  await expect(embedCard.getByLabel("Provider")).toContainText("Ollama");
  await expect(embedCard.getByLabel("Base URL")).toHaveValue(stub.url);
});

// ---------------------------------------------------------------------------
// 05-VERIFICATION.md human_verification item 2 — Test Connection success + a SPECIFIC failure
// message (not a generic 500), mirroring phase4-ai.spec.ts's T3 pattern for the LLM provider.
// ---------------------------------------------------------------------------
test("Settings: Embedding Test Connection succeeds against the stub, fails with a specific error", async ({
  page,
}) => {
  await page.goto("/settings");
  const embedCard = page.locator("form").filter({ hasText: "Embedding Provider" });

  await embedCard.getByRole("button", { name: "Test connection" }).click();
  await expect(embedCard.getByText("Connected successfully")).toBeVisible({ timeout: 15_000 });

  stub.embedMode = "fail";
  await embedCard.getByRole("button", { name: "Test connection" }).click();
  await expect(
    embedCard.getByText(`Connection failed: model "${EMBED_MODEL}" not found, try pulling it first`),
  ).toBeVisible({ timeout: 15_000 });
  stub.embedMode = "ok"; // reset — later tests need real embed() calls to succeed
});

// ---------------------------------------------------------------------------
// 05-VERIFICATION.md success criterion 1 — KB authoring through the real UI, worker-driven
// chunk+embed pipeline, embeddingStatus PENDING -> COMPLETED observed via polling (never a sleep).
// ---------------------------------------------------------------------------
let articleId = "";
let articleTitle = "";

test("KB authoring: creating an article embeds it via the worker; chip shows Indexed", async ({
  page,
}) => {
  test.setTimeout(60_000);
  articleTitle = `VPN Reset Guide ${MARKER}`;

  await gotoWarm(page, "/kb/new");
  await page.getByLabel("Title").fill(articleTitle);
  await page
    .getByLabel("Body (Markdown)")
    .fill(
      `# ${articleTitle}\n\nTo fix VPN connectivity issues, open Settings, go to Network, and click "Reset VPN Profile". This resolves the vast majority of dropped-connection issues within a minute.`,
    );
  await page.getByRole("button", { name: "Create article" }).click();

  // Negative lookahead excludes "/kb/new" itself — that literal segment otherwise satisfies
  // `[a-zA-Z0-9]+$` and waitForURL would resolve immediately against the CURRENT (pre-redirect)
  // URL instead of waiting for the real post-create redirect to `/kb/{articleId}`.
  await page.waitForURL(/\/kb\/(?!new$)[a-zA-Z0-9]+$/, { timeout: 20_000 });
  articleId = page.url().split("/kb/")[1] ?? "";
  expect(articleId).not.toBe("");

  // Confirms the redirect landed on a real, compiled 200 (first-ever hit to this dynamic route).
  await gotoWarm(page, `/kb/${articleId}`);

  // The worker picks the kb-embed-article job up and the stub answers instantly — poll for the
  // COMPLETED end-state (mirrors phase4-ai.spec.ts T5's triageStatus poll), never a fixed sleep.
  await expect
    .poll(
      async () => {
        const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
        return article.embeddingStatus;
      },
      { timeout: 30_000 },
    )
    .toBe("COMPLETED");

  await page.reload();
  await expect(page.getByText("Indexed")).toBeVisible();

  const chunk = await prisma.kbChunk.findFirstOrThrow({ where: { articleId } });
  expect(chunk.content).toContain(MARKER);

  await page.screenshot({ path: path.join(VISUAL_DIR, "kb-article-view.png"), fullPage: true });
});

// ---------------------------------------------------------------------------
// 05-VERIFICATION.md human_verification item 1 — grounded draft: cited DraftCard, editable
// Insert into the Composer, Send through the existing route, AI Activity shows DRAFT_GENERATED
// then DRAFT_APPROVED with the actual actionType values (not just a non-empty section).
// ---------------------------------------------------------------------------
let groundedTicketId = "";

test("Grounded draft: cites the KB article, Insert stays editable, Send audits DRAFT_GENERATED then DRAFT_APPROVED", async ({
  page,
}) => {
  test.setTimeout(60_000);
  expect(articleId).not.toBe("");

  const ticket = await createTicket(orgId, {
    subject: `E2E Phase5 grounded draft ${ts}`,
    priority: "NORMAL",
    body: `My VPN keeps dropping every few minutes, how do I fix it? ${MARKER}`,
    contact: { email: `phase5-grounded-${ts}@example.com` },
    direction: "INBOUND",
  });
  groundedTicketId = ticket.id;

  const chunk = await prisma.kbChunk.findFirstOrThrow({ where: { articleId } });
  const draftMarkdown =
    'Thanks for reaching out! To fix VPN connectivity, open Settings, go to Network, and click "Reset VPN Profile" [1]. Let us know if that resolves it.';
  stub.draftResponse = {
    grounded: true,
    draftMarkdown,
    citations: [{ marker: "1", chunkId: chunk.id }],
  };

  await page.goto(`/tickets/${groundedTicketId}`);
  await page.getByRole("button", { name: "Generate draft" }).click();

  await expect(page.getByText("AI Draft")).toBeVisible();
  await expect(page.getByText(draftMarkdown)).toBeVisible();

  const citationLink = page.getByRole("link", { name: articleTitle });
  await expect(citationLink).toBeVisible();
  await expect(citationLink).toHaveAttribute("href", `/kb/${articleId}`);

  await page.screenshot({
    path: path.join(VISUAL_DIR, "ticket-draft-grounded.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Insert into reply" }).click();
  const textarea = page.getByPlaceholder("Write a reply…");
  await expect(textarea).toHaveValue(draftMarkdown);
  await expect(textarea).toBeEditable();

  const editedSuffix = `(edited by agent ${ts})`;
  await textarea.fill(`${draftMarkdown} ${editedSuffix}`);

  const messagesPostUrl = `/api/tickets/${groundedTicketId}/messages`;
  const [postRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(messagesPostUrl) && res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Send Reply" }).click(),
  ]);
  expect(postRes.status()).toBe(200);
  await expect(page.getByText(editedSuffix)).toBeVisible();

  const summary = page.getByText("AI Activity");
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(page.getByText("Draft generated").first()).toBeVisible();
  await expect(page.getByText("Draft approved").first()).toBeVisible();

  // The actionType values themselves, not just a non-empty section — DRAFT_GENERATED recorded
  // before DRAFT_APPROVED, matching generate-draft.ts's write happening before the send's audit.
  const events = await prisma.auditEvent.findMany({
    where: { ticketId: groundedTicketId, actionType: { in: ["DRAFT_GENERATED", "DRAFT_APPROVED"] } },
    orderBy: { createdAt: "asc" },
  });
  expect(events.map((e) => e.actionType)).toEqual(["DRAFT_GENERATED", "DRAFT_APPROVED"]);
});

// ---------------------------------------------------------------------------
// 05-VERIFICATION.md success criterion 4 — groundedness gate at the UI layer: zero relevant
// chunks -> explicit "no relevant sources" DraftCard state, zero citations, and the completion
// endpoint is NEVER called (mirrors phase4-ai.spec.ts T8/T9's stub.chatCalls-unchanged technique).
// ---------------------------------------------------------------------------
test("Ungrounded draft: explicit no-relevant-sources state, zero citations, completion endpoint never called", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const ticket = await createTicket(orgId, {
    subject: `E2E Phase5 ungrounded draft ${ts}`,
    priority: "NORMAL",
    body: "What are your support hours on weekends?", // deliberately marker-free — unrelated to the KB article
    contact: { email: `phase5-ungrounded-${ts}@example.com` },
    direction: "INBOUND",
  });

  const chatCallsBefore = stub.chatCalls;

  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole("button", { name: "Generate draft" }).click();

  await expect(page.getByText("AI Draft")).toBeVisible();
  await expect(page.getByText("No relevant sources found")).toBeVisible();
  await expect(page.getByText(NO_RELEVANT_CONTENT_MESSAGE)).toBeVisible();

  await expect(page.getByRole("button", { name: "Insert into reply" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(page.getByRole("link", { name: articleTitle })).toHaveCount(0);

  expect(stub.chatCalls).toBe(chatCallsBefore); // the completion endpoint was never called

  await page.screenshot({
    path: path.join(VISUAL_DIR, "ticket-draft-ungrounded.png"),
    fullPage: true,
  });

  const draftEvent = await prisma.auditEvent.findFirst({
    where: { ticketId: ticket.id, actionType: "DRAFT_GENERATED" },
    orderBy: { createdAt: "desc" },
  });
  expect(draftEvent).not.toBeNull();
  expect(draftEvent?.provider).toBe("none"); // the code-level gate, not an LLM self-report
});
