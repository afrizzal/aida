/**
 * Adversarial-stub honesty invariants (07-09.1 Task 2, gap closure on 07-09).
 *
 * 07-09's Task 3 originally asked a HUMAN to judge whether a real model's narrative contradicts
 * the SQL numbers on /insights. That tests the model (non-deterministic, can't run in CI). This
 * file inverts it: the stub is configured to be deliberately DISHONEST, and every assertion below
 * proves the product still tells the truth despite that — a property we control and that the
 * docs actually claim, not a property of whichever model happens to be configured.
 *
 * Two adversarial cases, both driven through the real UI/worker (no shortcuts):
 *
 *  (a) Contradictory Insight narrative — src/app/(app)/insights/sla-csat-card.tsx:23's LOCKED
 *      invariant ("never parsed from narrative.summary") had no test guarding it before this file.
 *      The stub's narrative claims wildly wrong SLA/CSAT figures; the SlaCsatCard must still show
 *      the numbers computed independently by src/lib/insight/sla-csat.ts's SQL aggregates.
 *
 *  (b) Unbacked citation — the stub's draft cites a chunkId that was never in the retrieved set.
 *      src/lib/rag/generate-draft.ts's `citationsResolved` step (read before writing this test)
 *      resolves each returned citation against the retrieved set and silently drops anything that
 *      doesn't match — so an unresolvable citation must never reach DraftCitationList/the DOM.
 *
 *  (c) Zero-retrieval no-hallucination gate — ALREADY COVERED, not duplicated here. See
 *      tests/e2e/phase5-rag.spec.ts's "Ungrounded draft: explicit no-relevant-sources state, zero
 *      citations, completion endpoint never called" test: it asserts a fabricated-citation-free,
 *      completion-endpoint-never-called state on zero relevant KB content, which IS this
 *      invariant. Confirmed against src/lib/rag/generate-draft.ts's code-level groundedness gate
 *      (zero relevant chunks -> deterministic NO_RELEVANT_CONTENT_MESSAGE, `complete()` never
 *      called, `provider: "none"` recorded) before writing this file, per the plan's instruction
 *      to read the real implementation first.
 *
 * Runs in its own describe block with its own stub + worker (mirrors phase5-rag.spec.ts's
 * per-file lifecycle exactly). Because this file sits alphabetically BEFORE phase4-ai.spec.ts and
 * phase5-rag.spec.ts in the shared, single-container e2e run, its afterAll aggressively reverts
 * every piece of shared org-scoped state it touches (Settings rows, the KB article it creates,
 * the InsightRun row it creates) — phase4-ai.spec.ts's T4a asserts the AI toggle is disabled
 * "before a provider is configured", and phase5-rag.spec.ts's first test asserts the KB empty
 * state at zero articles; both would break if this file left its scratch state lying around.
 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { EMBEDDING_DIMENSIONS } from "../../src/lib/rag/types";
import { createTicket, orgId, prisma } from "./support/db";
import { createLlmStub } from "./support/llm-stub";
import { databaseUrl } from "./support/test-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

// ---------------------------------------------------------------------------
// Ollama stub (shared instance, one per test file — mirrors phase5-rag.spec.ts). Case (a) never
// calls /api/embed (embedding stays unconfigured so only the narrative call, not clustering, is
// exercised); case (b) uses embedFn's MARKER routing exactly like phase5-rag.spec.ts.
// ---------------------------------------------------------------------------
const MARKER = `aida-e2e-honesty-marker-${ts}`;
const HALF = EMBEDDING_DIMENSIONS / 2;
const CANONICAL_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 1 : 0,
);
const UNRELATED_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 0 : 1,
);
const stub = createLlmStub();
stub.embedFn = (text) => (text.includes(MARKER) ? CANONICAL_VECTOR : UNRELATED_VECTOR);

// ---------------------------------------------------------------------------
// Worker process — owns the insight-run + kb-embed-article queues this file exercises (mirrors
// phase5-rag.spec.ts's startWorker exactly).
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

// First-hit compile-race guard (next dev can transiently 404 a route before its first compile
// finishes) — this file may run before any other spec has warmed these routes.
async function gotoWarm(page: Page, urlPath: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await page.goto(urlPath, { waitUntil: "domcontentloaded", timeout: 45_000 }))?.status() ??
        0,
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe(404);
}

// ---------------------------------------------------------------------------
// Cross-file cleanup bookkeeping — every row this file creates in shared org-scoped state gets
// deleted in afterAll (see file header comment).
// ---------------------------------------------------------------------------
const SETTING_KEYS_TO_RESET = [
  "aiEnabled",
  "llm:provider",
  "llm:model",
  "llm:apiKeyEnc",
  "llm:ollamaBaseUrl",
  "llm:embeddingProvider",
  "llm:embeddingModel",
  "llm:embeddingApiKeyEnc",
  "llm:embeddingOllamaBaseUrl",
];
let articleIdToDelete = "";
let insightRunIdToDelete = "";
const ticketIdsToDelete: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await stub.start();
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
  stub.stop();

  await prisma.setting.deleteMany({
    where: { organizationId: orgId, key: { in: SETTING_KEYS_TO_RESET } },
  });
  if (articleIdToDelete) {
    await prisma.kbArticle.delete({ where: { id: articleIdToDelete } }).catch(() => {});
  }
  if (insightRunIdToDelete) {
    await prisma.insightRun.delete({ where: { id: insightRunIdToDelete } }).catch(() => {});
  }
  for (const id of ticketIdsToDelete) {
    await prisma.ticket.delete({ where: { id } }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// (a) Contradictory Insight narrative — sla-csat-card.tsx:23's LOCKED invariant.
// ---------------------------------------------------------------------------
test("(a) a hostile Insight narrative cannot move the displayed SLA/CSAT numbers", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // --- Configure the LLM (chat/completion) provider pointed at the stub, and enable AI. Embedding
  // is deliberately left UNCONFIGURED so only the narrative call (canNarrate), not clustering
  // (canCluster), is exercised — src/lib/insight/run-insight.ts's two independent AI gates.
  await gotoWarm(page, "/settings");
  const llmCard = page.locator("form").filter({ hasText: "AI Provider" });
  await llmCard.getByLabel("Provider").click();
  await page.getByRole("option", { name: "Ollama" }).click();
  await llmCard.getByLabel("Base URL").fill(stub.url);
  await llmCard.getByRole("button", { name: "Save AI provider" }).click();
  await expect(page.getByText("AI provider settings saved.")).toBeVisible();

  const aiToggle = page.getByRole("switch", { name: "Enable AI" });
  await expect(aiToggle).toBeEnabled();
  if (!(await aiToggle.isChecked())) await aiToggle.click();
  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "aiEnabled" } });
      return row?.value ?? null;
    })
    .toBe("true");

  // --- Seed two tickets with a KNOWN, non-trivial SLA/CSAT shape: one breached (so breachRate is
  // provably non-zero), one with a single CSAT response (so responseCount is provably not "100").
  const ticketA = await createTicket(orgId, {
    subject: `Honesty invariant A ${ts}`,
    priority: "NORMAL",
    body: "Ticket A body — deliberately breached for this test.",
    contact: { email: `honesty-a-${ts}@example.com` },
    direction: "INBOUND",
  });
  const ticketB = await createTicket(orgId, {
    subject: `Honesty invariant B ${ts}`,
    priority: "NORMAL",
    body: "Ticket B body — deliberately CSAT-rated for this test.",
    contact: { email: `honesty-b-${ts}@example.com` },
    direction: "INBOUND",
  });
  ticketIdsToDelete.push(ticketA.id, ticketB.id);

  const now = new Date();
  await prisma.ticket.update({
    where: { id: ticketA.id },
    data: { isBreached: true, isAtRisk: false, firstRespondedAt: now, resolvedAt: now },
  });
  await prisma.ticket.update({
    where: { id: ticketB.id },
    data: { isBreached: false, isAtRisk: false, firstRespondedAt: now, resolvedAt: now },
  });
  await prisma.csatResponse.create({
    data: { organizationId: orgId, ticketId: ticketB.id, score: 5 },
  });

  // --- The stub's narrative asserts numbers that are simply false: 0% breach rate (we know at
  // least one breach exists) and 100 CSAT responses (we know there's exactly one new one).
  const hostileNarrative =
    "0% breach rate this period, with 100 CSAT responses — full customer delight, zero at-risk tickets.";
  stub.chatResponse = { summary: hostileNarrative };

  await gotoWarm(page, "/insights?period=7");
  const generateButton = page.getByRole("button", { name: "Generate insights" });
  await expect(generateButton).toBeEnabled();
  await generateButton.click();

  await expect
    .poll(
      async () => {
        const row = await prisma.insightRun.findFirst({
          where: { organizationId: orgId, periodDays: 7 },
          orderBy: { createdAt: "desc" },
        });
        return row?.status ?? null;
      },
      { timeout: 60_000 },
    )
    .toBe("COMPLETED");
  const completedRun = await prisma.insightRun.findFirstOrThrow({
    where: { organizationId: orgId, periodDays: 7 },
    orderBy: { createdAt: "desc" },
  });
  insightRunIdToDelete = completedRun.id;

  // --- Ground truth: computed the SAME way the product computes it (src/lib/insight/sla-csat.ts),
  // over the EXACT period boundaries the run itself used — not hardcoded, so this stays correct
  // even though other spec files' tickets from the same shared container may also fall in-window.
  const { computeSlaCsat } = await import("../../src/lib/insight/sla-csat");
  const { scopedDb } = await import("../../src/lib/scoped-db");
  const truth = await computeSlaCsat(
    scopedDb(orgId),
    orgId,
    completedRun.periodStart,
    completedRun.periodEnd,
  );

  // Sanity: our fixture must actually create a real, provable divergence from the hostile claim —
  // otherwise this test would pass vacuously regardless of whether the invariant holds.
  expect(truth.sla.breachRate).toBeGreaterThan(0);
  expect(truth.csat.responseCount).not.toBe(100);

  const expectedBreachPct = `${(truth.sla.breachRate * 100).toFixed(0)}%`;

  await page.reload();
  // The narrative IS rendered honestly as labeled, untrusted commentary...
  await expect(page.getByText("AI summary")).toBeVisible();
  await expect(page.getByText(hostileNarrative, { exact: false })).toBeVisible();
  // ...but the numbers above it are the SQL-derived truth, never the narrative's claims. exact:
  // true matters here — the hostile narrative text itself contains the substring "breach rate"
  // (lowercase), and Playwright's getByText is case-insensitive by default, so a loose match would
  // resolve to both the stat label AND the narrative text (strict-mode violation).
  await expect(page.getByText("Breach rate", { exact: true })).toBeVisible();
  await expect(page.getByText(expectedBreachPct, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`(${truth.csat.responseCount} responses)`, { exact: false }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// (b) Unbacked citation — generate-draft.ts's citationsResolved filter.
// ---------------------------------------------------------------------------
test("(b) a draft citing a chunk that was never retrieved renders no citation for it", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // --- Configure the embedding provider too (independent of the chat provider — Decision 5),
  // pointed at the same stub, so KB embedding + retrieval both work.
  await page.goto("/settings");
  const embedCard = page.locator("form").filter({ hasText: "Embedding Provider" });
  await embedCard.getByLabel("Provider").click();
  await page.getByRole("option", { name: "Ollama" }).click();
  await embedCard.getByLabel("Base URL").fill(stub.url);
  await embedCard.getByRole("button", { name: "Save embedding provider" }).click();
  await expect(page.getByText("Embedding provider settings saved.")).toBeVisible();

  // --- A real, embedded KB article the ticket's message genuinely matches (MARKER-keyed vectors,
  // same deterministic technique as phase5-rag.spec.ts — zero flake risk).
  const articleTitle = `Honesty invariant KB article ${ts}`;
  await gotoWarm(page, "/kb/new");
  await page.getByLabel("Title").fill(articleTitle);
  await page
    .getByLabel("Body (Markdown)")
    .fill(`# ${articleTitle}\n\nGenuine, relevant KB content. ${MARKER}`);
  await page.getByRole("button", { name: "Create article" }).click();
  await page.waitForURL(/\/kb\/(?!new$)[a-zA-Z0-9]+$/, { timeout: 20_000 });
  const articleId = page.url().split("/kb/")[1] ?? "";
  expect(articleId).not.toBe("");
  articleIdToDelete = articleId;

  await expect
    .poll(
      async () => {
        const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
        return article.embeddingStatus;
      },
      { timeout: 30_000 },
    )
    .toBe("COMPLETED");

  const ticket = await createTicket(orgId, {
    subject: `Honesty invariant unbacked-citation ${ts}`,
    priority: "NORMAL",
    body: `Question that matches the KB article. ${MARKER}`,
    contact: { email: `honesty-citation-${ts}@example.com` },
    direction: "INBOUND",
  });
  ticketIdsToDelete.push(ticket.id);

  // --- The stub's draft is grounded (so it reaches the render path, not the zero-retrieval
  // gate), but cites a chunkId that was NEVER in the retrieved set — an unbacked citation, exactly
  // what generate-draft.ts's citationsResolved step (read before writing this assertion) exists to
  // catch: it looks up each returned citation's chunkId in a Map keyed by the retrieved chunks
  // only, and silently drops (flatMap -> []) anything that doesn't resolve.
  const draftMarkdown =
    "Thanks for reaching out! Here is an answer that cites a source you were never given [1].";
  const fabricatedChunkId = "not-a-real-chunk-id-never-retrieved";
  stub.chatResponse = {
    grounded: true,
    draftMarkdown,
    citations: [{ marker: "1", chunkId: fabricatedChunkId }],
  };

  await gotoWarm(page, `/tickets/${ticket.id}`);
  await page.getByRole("button", { name: "Generate draft" }).click();

  await expect(page.getByText("AI Draft")).toBeVisible();
  await expect(page.getByText(draftMarkdown)).toBeVisible();

  // No citation link rendered anywhere on the ticket page — DraftCitationList (the only place a
  // `/kb/` link appears on this page) renders null when its (post-filter) citations array is
  // empty, per src/components/tickets/draft-citation-list.tsx.
  await expect(page.locator('a[href^="/kb/"]')).toHaveCount(0);

  // Proves this is a genuine adversarial case, not a stub that silently never sent a citation:
  // the RAW model output (recorded verbatim in the audit trail, pre-filter) really did contain the
  // fabricated chunkId — the gate rejected it, nothing failed silently upstream.
  const draftEvent = await prisma.auditEvent.findFirst({
    where: { ticketId: ticket.id, actionType: "DRAFT_GENERATED" },
    orderBy: { createdAt: "desc" },
  });
  expect(draftEvent).not.toBeNull();
  expect(draftEvent?.output ?? "").toContain(fabricatedChunkId);
});
