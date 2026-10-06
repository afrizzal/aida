/**
 * Phase 12.2 plan 11: end-to-end proof of AIDA-18 (KB article proposals from resolved tickets)
 * through the real UI, the shared Ollama-protocol LLM stub (127.0.0.1 only, never a real
 * provider) and a real worker process.
 *
 * Every case seeds its own tickets and proposals and sets the chat mode and AI switch it needs;
 * afterEach releases any chat hold, resets the chat mode to "ok" and turns AI back on, so the
 * cases do not depend on each other's order. Chat calls and recorded chat requests are read as
 * deltas from values taken at the start of a case. Waiting is Playwright's auto-waiting
 * assertions and expect.poll only, never a fixed sleep.
 *
 * Cross-file cleanup: this file sorts before phase4-ai.spec.ts and phase5-rag.spec.ts in the
 * shared, single-container e2e run. phase4-ai asserts the AI toggle is disabled before a provider
 * is configured, and phase5-rag's first test asserts the KB empty state at zero articles, so
 * afterAll removes every Setting row, proposal and article this file created (see cleanUp).
 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  APPROVE_AND_PUBLISH_CTA,
  CUSTOMER_CONTENT_NOTICE,
  GENERATE_PROPOSAL_CTA,
  GENERATING_BODY,
  OPEN_ARTICLE,
  PROPOSE_KB_ARTICLE_ENTRY,
  PUBLISH_ARTICLE_CTA,
  PUBLISH_CONFIRM_CHECKBOX,
  PUBLISH_TITLE,
  PUBLISHED_TOAST,
  SAVE_DRAFT_CTA,
  SAVED_TOAST,
  START_INPUTS_LINE,
  START_TITLE,
  STARTED_TOAST,
} from "../../src/lib/kb/proposal-copy";
import { PROPOSAL_SYSTEM_PROMPT } from "../../src/lib/kb/proposal-prompt";
import { EMBEDDING_DIMENSIONS } from "../../src/lib/rag/types";
import { createTicket, orgId, prisma, stateIdFor } from "./support/db";
import { CHAT_MODEL, type ChatRequestRecord, createLlmStub, EMBED_MODEL } from "./support/llm-stub";
import { databaseUrl } from "./support/test-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");

test.use({ storageState: ADMIN_STORAGE });
// One budget for every case and hook of this file: the worker's cold start (tsx and pg-boss), the
// first compile of each route under next dev, and the review page's 5 s polling. Set here so the
// file needs no per-case timeout call.
test.describe.configure({ timeout: 180_000 });

const ts = Date.now();

/**
 * The proposal fixtures import src/lib/db, which reads DATABASE_URL when it is first evaluated.
 * A static import could be ordered before ./support/db (and so before ./support/test-env sets
 * the variable), so the module is loaded on first use, after test-env has run.
 */
function proposalFixtures() {
  return import("../support/kb-proposal-fixtures");
}

// ---------------------------------------------------------------------------
// Deterministic embedding vectors: two mutually orthogonal patterns (cosine distance exactly 1),
// routed by a literal token as in phase5-rag.spec.ts.
// ---------------------------------------------------------------------------
const RAG_TOKEN = `aidakbpragtoken${ts}`;
const HALF = EMBEDDING_DIMENSIONS / 2;
const CANONICAL_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 1 : 0,
);
const UNRELATED_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 0 : 1,
);

const stub = createLlmStub();
stub.embedFn = (text) => (text.includes(RAG_TOKEN) ? CANONICAL_VECTOR : UNRELATED_VECTOR);

/** The release function of the hold a case started, if any; afterEach calls it. */
let releaseHold: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Worker process: owns the kb-proposal-generate, kb-embed-article and insight-run queues for this
// file (phase5-rag.spec.ts's startWorker). No timer: the beforeAll timeout bounds the start.
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
    worker.stdout?.on("data", (chunk: Buffer) => {
      workerLog += chunk.toString();
      if (workerLog.includes("[worker] started")) resolve();
    });
    worker.stderr?.on("data", (chunk: Buffer) => {
      workerLog += chunk.toString();
    });
    worker.on("close", (code) => {
      if (!workerLog.includes("[worker] started")) {
        reject(new Error(`worker exited early (code ${code}):\n${workerLog}`));
      }
    });
  });
}

function stopWorker(): void {
  if (!worker?.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${worker.pid} /t /f`);
    } catch {
      // already gone
    }
    return;
  }
  worker.kill("SIGTERM");
}

// ---------------------------------------------------------------------------
// Settings: the workspace's chat and embedding providers point at the stub; AI on.
// ---------------------------------------------------------------------------
const SETTING_KEYS_TO_RESET = [
  "aiEnabled",
  "llm:provider",
  "llm:model",
  "llm:ollamaBaseUrl",
  "llm:embeddingProvider",
  "llm:embeddingModel",
  "llm:embeddingOllamaBaseUrl",
];

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
}

async function setAiEnabled(on: boolean): Promise<void> {
  await setSetting("aiEnabled", on ? "true" : "false");
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** First-hit compile-race guard: next dev can answer 404 before a route's first compile. */
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

function main(page: Page) {
  return page.getByRole("main");
}

function rowCheckbox(page: Page, subject: string) {
  return page.getByRole("checkbox", { name: new RegExp(`: ${subject}$`) });
}

function bulkBar(page: Page) {
  return page.getByRole("region", { name: "Bulk actions" });
}

/** Opens the inbox filtered by a search token and waits for the first seeded row. */
async function openInbox(page: Page, token: string, firstSubject: string): Promise<void> {
  await gotoWarm(page, `/tickets?q=${token}`);
  await expect(rowCheckbox(page, firstSubject)).toBeVisible({ timeout: 15_000 });
}

/** The proposal id of the review page the browser is on. */
async function proposalIdFromUrl(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/kb\/proposals\/[^/?#]+$/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(id).not.toBe("");
  return id;
}

/** A status chip label on the review page, matched exactly. */
function statusChip(page: Page, label: string) {
  return main(page).getByText(label, { exact: true });
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * createTicket enqueues AI triage when AI is on at creation, and triage calls the same stub
 * /api/chat route. The cases here count and hold chat requests, so seeded tickets are created
 * with AI off (no triage job is enqueued at all) and the switch is put back afterwards.
 */
async function createTicketWithoutTriage(
  input: Parameters<typeof createTicket>[1],
): Promise<Awaited<ReturnType<typeof createTicket>>> {
  const where = { organizationId_key: { organizationId: orgId, key: "aiEnabled" } };
  const before = await prisma.setting.findUnique({ where });
  await setAiEnabled(false);
  try {
    return await createTicket(orgId, input);
  } finally {
    if (before) await setSetting("aiEnabled", before.value);
    else await prisma.setting.deleteMany({ where: { organizationId: orgId, key: "aiEnabled" } });
  }
}

interface SeededTicket {
  id: string;
  number: number;
  subject: string;
  replyBody: string;
}

/**
 * A ticket through the real createTicket path in the state of a legacy key, with one PUBLIC
 * outbound reply. The subject and the customer message carry the token so the inbox search finds
 * the ticket; no proposal marker is ever put into a ticket.
 */
async function seedTicketWithReply(
  token: string,
  label: string,
  status: "RESOLVED" | "CLOSED" | "OPEN" = "RESOLVED",
  replyBody = `Reply ${label} ${ts}: reset the profile from Settings, then sign in again.`,
): Promise<SeededTicket> {
  const subject = `KB proposal ${token} ${label}`;
  const ticket = await createTicketWithoutTriage({
    subject,
    priority: "NORMAL",
    body: `Customer question ${token} ${label}`,
    contact: { email: `kbp-${label}-${ts}@example.com` },
    direction: "INBOUND",
  });
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { stateId: await stateIdFor(status) },
  });
  const { seedPublicMessage } = await proposalFixtures();
  await seedPublicMessage(orgId, ticket.id, replyBody, { direction: "OUTBOUND" });
  return { id: ticket.id, number: ticket.number, subject, replyBody };
}

/** The ticket_content blocks of a proposal prompt, as raw text. */
function ticketContentBlocks(prompt: string): string[] {
  return [...prompt.matchAll(/<ticket_content id="T\d+">([\s\S]*?)<\/ticket_content>/g)].map(
    (match) => match[1] ?? "",
  );
}

function messageOf(request: ChatRequestRecord, role: string): string {
  return request.messages.find((message) => message.role === role)?.content ?? "";
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
let specStart = new Date();

async function warmRoutes(browser: Browser): Promise<void> {
  const context = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await context.newPage();
  for (const route of ["/kb", "/kb/proposals", "/kb/proposals/warmup", "/tickets"]) {
    await gotoWarm(page, route);
  }
  await context.close();
}

test.beforeAll(async ({ browser }) => {
  specStart = new Date();
  await stub.start();
  for (const [key, value] of [
    ["llm:provider", "ollama"],
    ["llm:model", CHAT_MODEL],
    ["llm:ollamaBaseUrl", stub.url],
    ["llm:embeddingProvider", "ollama"],
    ["llm:embeddingModel", EMBED_MODEL],
    ["llm:embeddingOllamaBaseUrl", stub.url],
  ] as const) {
    await setSetting(key, value);
  }
  await setAiEnabled(true);
  await startWorker();
  await warmRoutes(browser);
});

test.afterEach(async () => {
  releaseHold?.();
  releaseHold = null;
  stub.chatMode = "ok";
  stub.chatRawContent = "";
  await setAiEnabled(true);
});

/**
 * Removes what this file created in the shared E2E organization. Every proposal created since
 * the file started is removed with its sources, then the articles those proposals published.
 *
 * A generated proposal has a KB_PROPOSAL_GENERATED AuditEvent that references it with a
 * restricting foreign key, and AuditEvent is append-only by a trigger (it refuses DELETE). In
 * this disposable Testcontainers database, and only for those rows, the delete runs in one
 * transaction with session_replication_role = replica (the e2e user is the container's
 * superuser), which skips that trigger for this transaction only; the role goes back to origin
 * before the other deletes, so their foreign keys are enforced. Without it the article published
 * through the UI would stay and break phase5-rag's KB empty state in a full run.
 */
async function cleanUp(): Promise<void> {
  await prisma.setting.deleteMany({
    where: { organizationId: orgId, key: { in: SETTING_KEYS_TO_RESET } },
  });

  const proposals = await prisma.kbProposal.findMany({
    where: { organizationId: orgId, createdAt: { gte: specStart } },
    select: { id: true, publishedArticleId: true },
  });
  const proposalIds = proposals.map((proposal) => proposal.id);
  const articleIds = proposals
    .map((proposal) => proposal.publishedArticleId)
    .filter((id): id is string => id !== null);
  if (proposalIds.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw`DELETE FROM "AuditEvent" WHERE "organizationId" = ${orgId} AND "kbProposalId" = ANY(${proposalIds})`;
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await tx.kbProposalSource.deleteMany({
        where: { organizationId: orgId, proposalId: { in: proposalIds } },
      });
      await tx.kbProposal.deleteMany({ where: { organizationId: orgId, id: { in: proposalIds } } });
      await tx.kbArticle.deleteMany({ where: { organizationId: orgId, id: { in: articleIds } } });
    });
  }
  // The cleanup itself is checked, so a later file never meets this file's rows silently.
  expect(
    await prisma.kbProposal.count({
      where: { organizationId: orgId, createdAt: { gte: specStart } },
    }),
  ).toBe(0);
  expect(await prisma.kbArticle.count({ where: { id: { in: articleIds } } })).toBe(0);
}

test.afterAll(async () => {
  releaseHold?.();
  stopWorker();
  stub.stop();
  await cleanUp();
});

// ---------------------------------------------------------------------------
// Task 1 (tracer): inbox selection to a published article, through the stub and the worker.
// ---------------------------------------------------------------------------
test("happy path: two resolved tickets from the inbox become a reviewed, edited and published article", async ({
  page,
}) => {
  const token = `kbphappy${ts}`;
  const first = await seedTicketWithReply(token, "one");
  const second = await seedTicketWithReply(
    token,
    "two",
    "RESOLVED",
    `Reply two ${ts}: clear the cached token, then reconnect.`,
  );
  const resolvedState = await prisma.ticketState.findUniqueOrThrow({
    where: { id: await stateIdFor("RESOLVED") },
    select: { name: true },
  });

  const proposalTitle = `Reset a stuck VPN profile ${ts}`;
  stub.chatResponse = {
    title: proposalTitle,
    bodyMarkdown:
      "## Cause\n\nThe stored VPN profile goes stale after a password change.\n\n## Steps\n\nOpen Settings, reset the VPN profile, then sign in again.",
    citations: [
      { source: "T1", section: "Cause" },
      { source: "T2", section: "Steps" },
    ],
  };
  const requestsBefore = stub.chatRequests.length;
  const callsBefore = stub.chatCalls;

  // --- Select both tickets in the inbox and open the entry.
  await openInbox(page, token, first.subject);
  await rowCheckbox(page, first.subject).click();
  await rowCheckbox(page, second.subject).click();
  const bar = bulkBar(page);
  await expect(bar.getByText("2 tickets selected")).toBeVisible();
  // "Propose KB article…" (PROPOSE_KB_ARTICLE_ENTRY)
  const entry = bar.getByRole("button", { name: PROPOSE_KB_ARTICLE_ENTRY });
  await expect(entry).toBeEnabled();
  await entry.click();

  // --- The Start dialog lists both tickets with their status chips and the notices.
  const dialog = page.getByRole("dialog", { name: START_TITLE });
  await expect(dialog).toBeVisible();
  for (const ticket of [first, second]) {
    const row = dialog.getByRole("listitem").filter({ hasText: ticket.subject });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`#${ticket.number}`);
    await expect(row.getByText(resolvedState.name, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText(CUSTOMER_CONTENT_NOTICE)).toBeVisible();
  await expect(dialog.getByText(START_INPUTS_LINE)).toBeVisible();

  // --- Generate with the stub's answer held, so Generating is observed deterministically.
  releaseHold = stub.holdChat();
  // "Generate proposal" (GENERATE_PROPOSAL_CTA)
  const generate = dialog.getByRole("button", { name: GENERATE_PROPOSAL_CTA });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByText(STARTED_TOAST)).toBeVisible();
  const proposalId = await proposalIdFromUrl(page);
  await expect.poll(() => stub.heldChatCount, { timeout: 30_000 }).toBe(1);
  await expect(statusChip(page, "Generating")).toBeVisible({ timeout: 15_000 });
  await expect(main(page).getByText(GENERATING_BODY)).toBeVisible();

  // Released well inside the Ollama adapter's 30 s deadline; the page polls on its own.
  releaseHold();
  releaseHold = null;
  await expect(statusChip(page, "Draft")).toBeVisible({ timeout: 30_000 });
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toHaveValue(proposalTitle);

  // --- The one chat request of this proposal: fixed system prompt, ticket text fenced in the
  // user prompt only.
  expect(stub.chatCalls - callsBefore).toBe(1);
  const requests = stub.chatRequests
    .slice(requestsBefore)
    .filter((recorded) => messageOf(recorded, "system") === PROPOSAL_SYSTEM_PROMPT);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request.model).toBe(CHAT_MODEL);
  const system = messageOf(request, "system");
  const user = messageOf(request, "user");
  expect(system).toBe(PROPOSAL_SYSTEM_PROMPT);
  for (const ticket of [first, second]) {
    expect(system).not.toContain(ticket.subject);
    expect(system).not.toContain(ticket.replyBody);
  }
  const blocks = ticketContentBlocks(user);
  expect(blocks).toHaveLength(2);
  for (const ticket of [first, second]) {
    expect(blocks.filter((block) => block.includes(ticket.subject))).toHaveLength(1);
  }

  // --- Edit the title and save: the draft is saved, never published.
  const editedTitle = `Reset a stuck VPN profile (edited) ${ts}`;
  await titleField.fill(editedTitle);
  await page.getByRole("button", { name: SAVE_DRAFT_CTA }).click();
  await expect(page.getByText(SAVED_TOAST)).toBeVisible();
  await expect(titleField).toHaveValue(editedTitle);

  // Nothing is in the knowledge base before the admin publishes (D-05, D-06).
  const kbPage = await page.context().newPage();
  await gotoWarm(kbPage, "/kb");
  await expect(
    kbPage.getByRole("main").getByRole("heading", { name: "Knowledge Base" }),
  ).toBeVisible();
  await expect(kbPage.getByRole("main").getByText(editedTitle)).toHaveCount(0);
  expect(
    await prisma.kbArticle.count({ where: { organizationId: orgId, title: editedTitle } }),
  ).toBe(0);
  expect(
    (await prisma.kbProposal.findUniqueOrThrow({ where: { id: proposalId } })).publishedArticleId,
  ).toBeNull();

  // --- Approve and publish: one confirmation with a required checkbox.
  // "Approve and publish…" (APPROVE_AND_PUBLISH_CTA)
  const publishTrigger = page.getByRole("button", { name: APPROVE_AND_PUBLISH_CTA });
  await expect(publishTrigger).toBeEnabled();
  await publishTrigger.click();
  const publishDialog = page.getByRole("dialog", { name: PUBLISH_TITLE });
  await expect(publishDialog).toBeVisible();
  // "Publish article" (PUBLISH_ARTICLE_CTA) stays disabled until the checkbox is checked.
  const confirm = publishDialog.getByRole("button", { name: PUBLISH_ARTICLE_CTA });
  await expect(confirm).toBeDisabled();
  await publishDialog.getByRole("checkbox", { name: PUBLISH_CONFIRM_CHECKBOX }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(PUBLISHED_TOAST)).toBeVisible();
  await expect(statusChip(page, "Published")).toBeVisible();
  const openArticle = main(page).getByRole("link", { name: OPEN_ARTICLE });
  await expect(openArticle).toBeVisible();

  const published = await prisma.kbProposal.findUniqueOrThrow({ where: { id: proposalId } });
  expect(published.status).toBe("PUBLISHED");
  expect(published.publishedArticleId).not.toBeNull();
  await expect(openArticle).toHaveAttribute("href", `/kb/${published.publishedArticleId}`);

  // --- The article is listed on /kb with the edited title.
  await kbPage.reload();
  await expect(kbPage.getByRole("main").getByText(editedTitle, { exact: true })).toBeVisible();
  await kbPage.close();
});
