// ---------------------------------------------------------------------------
// scripts/capture-demo-assets.ts — reproducible capture of the AIDA launch
// visual asset set (07-08, AIDA-22/AIDA-23).
//
// Run with tsx (NOT through Playwright's test runner):
//   pnpm demo:capture                 -> five screenshots x {light,dark} under docs/assets/
//   pnpm demo:capture -- --record     -> docs/assets/aida-demo.gif (the hero animation)
//   pnpm demo:capture -- --build      -> force a fresh `next build` even if .next/BUILD_ID exists
//
// Both modes boot an entirely disposable, seeded, PRODUCTION AIDA instance (a throwaway
// pgvector/pgvector:pg16 Testcontainer + `next start`/standalone server on :3300) and tear it
// down in a `finally` — a failed capture never leaks a container, server process, or temp dir.
// Adapts tests/e2e/global-setup.ts's proven container/server-boot sequence; killTree/
// waitForServer/gotoWarm are copied near-verbatim from that file and tests/e2e/phase6-insight.spec.ts.
//
// Honesty contract (CLAUDE.md / 07-CONTEXT.md D-07): every captured frame is the real
// application rendering real seeded data. The screenshot mode (no flags) never configures an
// AI provider — it captures the shipped demo dataset exactly as `pnpm db:seed` produces it
// (AI off, KB chunks unembedded), matching src/lib/demo/seed-demo-data.ts's honesty contract.
//
// The --record mode is the one exception, and it is fully disclosed: to record a LIVE
// "Generate draft" -> cited DraftCard -> Insert -> Send segment (D-07's ideal golden path), it
// points AIDA's real provider abstraction at a LOCAL HTTP server that speaks the Ollama wire
// protocol (mirrors tests/e2e/phase5-rag.spec.ts's proven stub pattern) and embeds the six
// seeded KB articles against it by calling the real kbEmbedArticleHandler job handler directly
// (no worker process). This never touches the shipped seed script and only ever runs inside this
// script's own throwaway container. Plan 07-10's README caption MUST disclose that the model
// behind the recorded draft is a local stub, and that AIDA works with OpenAI, Anthropic, or a
// real local Ollama model — see the 07-08-SUMMARY.md caption-obligation note.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "docs", "assets");

const PORT = 3300;
const BASE_URL = `http://localhost:${PORT}`;

const DEMO_ADMIN_EMAIL = "admin@demo.aida.test";
const DEMO_ADMIN_PASSWORD = "aida-demo-2026";

// The one ticket used for inbox.png/ticket-detail.png AND the GIF: OPEN, at-risk SLA, exactly
// two tags (password-reset, bug), and the seed's own DRAFT_GENERATED -> DRAFT_APPROVED audit
// trail (see src/lib/demo/seed-demo-data.ts's draftScenarios) — the richest single ticket in the
// dataset for a launch screenshot/recording.
const TICKET_SUBJECT_MATCH = "Cannot reset password";
const KB_ARTICLE_TITLE = "Resetting your password";

const RECORD = process.argv.includes("--record");
const FORCE_BUILD = process.argv.includes("--build");

const MIN_PNG_BYTES = 10_000;
const MAX_PNG_BYTES = 500_000;
const MAX_GIF_BYTES = 8 * 1024 * 1024;

function log(message: string): void {
  console.log(`[capture] ${message}`);
}

// Copied verbatim from tests/e2e/global-setup.ts — encodes real cross-platform pain.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"]);
    } catch {
      // process already gone
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // process already gone
  }
}

// Copied verbatim (module-load semantics) from tests/e2e/global-setup.ts.
async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

// Reused per tests/e2e/phase6-insight.spec.ts's gotoWarm (lines ~39-53) — defensive against the
// documented transient first-hit 404 flake, even though this script drives a pre-compiled
// PRODUCTION server (next start / standalone), never the on-demand Turbopack dev compiler.
async function gotoWarm(page: Page, urlPath: string): Promise<void> {
  let lastStatus = 0;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await page.goto(urlPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
    lastStatus = res?.status() ?? 0;
    if (lastStatus !== 404) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`[capture] ${urlPath} kept returning 404 (last status ${lastStatus})`);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  // Force a full compositor repaint before capturing. Observed for real on this machine:
  // headless Chromium occasionally leaves a stale paint tile from the just-completed layout
  // pass, ghosting one ticket-list row's tag chip onto the next row's name. A double
  // requestAnimationFrame plus a tiny scroll jiggle reliably flushes it.
  await page.evaluate(() => {
    window.scrollBy(0, 1);
    window.scrollBy(0, -1);
    // The ticket-list panel scrolls INTERNALLY (its own overflow-y-auto <aside>), not the
    // document — jiggle it too so its tiles get the same forced repaint.
    const aside = document.querySelector("aside");
    if (aside) {
      aside.scrollTop += 1;
      aside.scrollTop -= 1;
    }
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.waitForTimeout(200);
}

// The exact shape BrowserContext.storageState() returns / BrowserNewContextOptions.storageState
// accepts — spelled out explicitly rather than derived via a conditional type (Playwright doesn't
// export this shape as a standalone named type).
interface StorageState {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

// ---------------------------------------------------------------------------
// Task 1 — screenshot capture (default mode, no flags).
// ---------------------------------------------------------------------------

interface ManifestEntry {
  file: string;
  bytes: number;
}

async function writeShot(
  page: Page,
  filename: string,
  manifest: ManifestEntry[],
  fullPage: boolean,
  scale: "css" | "device" = "device",
): Promise<void> {
  const filePath = path.join(ASSETS_DIR, filename);
  await page.screenshot({ path: filePath, fullPage, scale });
  const bytes = fs.statSync(filePath).size;
  manifest.push({ file: filename, bytes });
  log(`Wrote docs/assets/${filename} (${bytes} bytes)`);
}

function validateManifest(manifest: ManifestEntry[]): void {
  console.log("\n[capture] Asset manifest:");
  const bad: string[] = [];
  for (const { file, bytes } of manifest) {
    console.log(`  docs/assets/${file}: ${bytes} bytes`);
    if (bytes < MIN_PNG_BYTES || bytes > MAX_PNG_BYTES) bad.push(`${file} (${bytes} bytes)`);
  }
  if (bad.length > 0) {
    throw new Error(
      `[capture] Asset size budget violated (must be ${MIN_PNG_BYTES}-${MAX_PNG_BYTES} bytes): ${bad.join(", ")}`,
    );
  }
}

async function captureScreenshots(
  browser: Browser,
  storageState: StorageState,
  ticketId: string,
): Promise<void> {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const manifest: ManifestEntry[] = [];

  for (const theme of ["light", "dark"] as const) {
    log(`Capturing ${theme} theme screenshots...`);
    const suffix = theme === "dark" ? "-dark" : "";

    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await context.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
    const page = await context.newPage();

    // inbox.png + ticket-detail.png share one navigation to the ticket (the list panel stays
    // visible by design — TicketListPanel is rendered by both /tickets and /tickets/[id]).
    await gotoWarm(page, `/tickets/${ticketId}`);
    await settle(page);
    await writeShot(page, `inbox${suffix}.png`, manifest, false);

    // AI Activity is a native <details> (collapsed by default) — expand it for ticket-detail.png
    // so the stored Draft generated -> Draft approved sequence is actually visible.
    const aiActivitySummary = page.getByText("AI Activity");
    if (await aiActivitySummary.isVisible().catch(() => false)) {
      await aiActivitySummary.click();
      await page.waitForTimeout(300);
    }
    // scale:"css" (1x CSS pixels, not the context's 2x device pixels) — a fullPage capture of
    // this busy a page at full retina density blows through the 500KB budget; still sharp
    // enough for a launch screenshot, and every OTHER asset stays at full retina density.
    await writeShot(page, `ticket-detail${suffix}.png`, manifest, true, "css");

    await gotoWarm(page, "/insights?period=30");
    await settle(page);
    await writeShot(page, `insights${suffix}.png`, manifest, false);

    await gotoWarm(page, "/kb");
    await settle(page);
    await writeShot(page, `knowledge-base${suffix}.png`, manifest, false);

    await gotoWarm(page, "/settings");
    await settle(page);
    await writeShot(page, `settings-ai${suffix}.png`, manifest, false);

    await context.close();
  }

  validateManifest(manifest);
}

// ---------------------------------------------------------------------------
// Task 2 — golden-path recording + GIF conversion (--record mode).
//
// Variant A (preferred, per 07-08-PLAN.md): a real "Generate draft" click against a LOCAL
// Ollama-protocol stub, embedding the six seeded KB articles first. The embedding "model" below
// is a deterministic keyword-bucket function of the REAL text content (never a hardcoded
// ticket->article lookup) — a legitimate, disclosed stand-in for a real embedding model, driving
// AIDA's genuine pgvector KNN retrieval + groundedness gate against real cosine distances.
// ---------------------------------------------------------------------------

const CHAT_MODEL = "llama3.1";
const EMBED_MODEL = "nomic-embed-text";
const EMBEDDING_DIMENSIONS = 768;

// Six buckets x 128 dims = 768 (exact). Every bucket keyword is literally present in the real
// seeded ticket/KB-article text this recording touches — see src/lib/demo/fixtures.ts.
const TOPIC_BUCKETS: string[][] = [
  ["password", "reset"],
  ["invoice", "billing", "seat"],
  ["slack"],
  ["csv", "export"],
  ["two-factor", "2fa", "authenticat"],
  ["webhook"],
];
const BUCKET_DIM = EMBEDDING_DIMENSIONS / TOPIC_BUCKETS.length;
const BASELINE = 0.01; // keeps every vector non-zero (avoids a cosine-distance NaN on ties)

function topicEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  const vec = new Array(EMBEDDING_DIMENSIONS).fill(BASELINE);
  for (let i = 0; i < TOPIC_BUCKETS.length; i++) {
    if (TOPIC_BUCKETS[i].some((keyword) => lower.includes(keyword))) {
      for (let d = i * BUCKET_DIM; d < (i + 1) * BUCKET_DIM; d++) vec[d] = 1;
    }
  }
  return vec;
}

interface StubHandle {
  server: http.Server;
  url: string;
}

async function startOllamaStub(): Promise<StubHandle> {
  const server = http.createServer((req, res) => {
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
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on("end", () => {
        const body = JSON.parse(raw) as { model: string; input: string[] };
        const embeddings = body.input.map((text) => topicEmbedding(text));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: EMBED_MODEL, embeddings }));
      });
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on("end", () => {
        const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
        const userPrompt = body.messages.find((m) => m.role === "user")?.content ?? "";
        // Extract the REAL chunkId draft-prompt.ts embedded in the prompt ([chunkId: <id>]) so
        // the citation this stub returns always resolves to whichever chunk the real retrieval
        // pipeline actually selected — never a guessed/hardcoded id.
        const chunkIdMatch = userPrompt.match(/\[chunkId:\s*([a-f0-9]+)\]/i);
        const chunkId = chunkIdMatch?.[1] ?? "";
        const draft = {
          grounded: true,
          draftMarkdown:
            "Hi Sofia, I've just sent a fresh password reset link to your email — the earlier ones were likely caught by a spam filter on your end. If this one doesn't arrive within a few minutes, please check your spam folder, and let us know so we can verify the email address on file for your account. [1]",
          citations: chunkId ? [{ marker: "1", chunkId }] : [],
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: CHAT_MODEL,
            created_at: new Date().toISOString(),
            message: { role: "assistant", content: JSON.stringify(draft) },
            done: true,
          }),
        );
      });
      return;
    }

    res.writeHead(404).end();
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(`http://127.0.0.1:${addr.port}`);
      else reject(new Error("Failed to determine stub server address"));
    });
  });

  return { server, url };
}

async function configureOllamaStubProvider(
  prisma: PrismaClient,
  orgId: string,
  stubUrl: string,
): Promise<void> {
  const settings: [string, string][] = [
    ["llm:provider", "ollama"],
    ["llm:model", CHAT_MODEL],
    ["llm:ollamaBaseUrl", stubUrl],
    ["llm:embeddingProvider", "ollama"],
    ["llm:embeddingModel", EMBED_MODEL],
    ["llm:embeddingOllamaBaseUrl", stubUrl],
  ];
  for (const [key, value] of settings) {
    await prisma.setting.create({ data: { organizationId: orgId, key, value } });
  }
}

interface RecordingResult {
  videoPath: string;
  steps: string[];
  durationSeconds: number;
}

async function recordGoldenPath(
  browser: Browser,
  storageState: StorageState,
  videoDir: string,
  ticketId: string,
): Promise<RecordingResult> {
  const steps: string[] = [];
  const start = Date.now();

  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  await context.addInitScript(() => window.localStorage.setItem("theme", "light"));
  const page = await context.newPage();
  const pause = (ms: number) => page.waitForTimeout(ms);

  // Step 1 — shared inbox + a real filter interaction.
  await gotoWarm(page, "/tickets");
  await settle(page);
  await pause(900);
  await page.getByRole("button", { name: "Unassigned" }).click();
  await pause(1000);
  await page.getByRole("button", { name: "All" }).click();
  await pause(800);
  steps.push(
    "1. Landed on /tickets (shared inbox, 30 tickets, SLA chips + filters); clicked the Unassigned view filter, then back to All",
  );

  // Step 2 — open the ticket (real click on the list row, not a deep link).
  await page.locator(`a[href="/tickets/${ticketId}"]`).first().click();
  await page.waitForURL(new RegExp(`/tickets/${ticketId}$`));
  await settle(page);
  await pause(1000);
  steps.push(
    "2. Opened the ticket: status/priority/assignee controls, triage chips (category/sentiment/language), and tags",
  );

  // Step 3 — scroll the thread (inbound message, public reply, internal note).
  const threadContainer = page.locator("div.flex-1.space-y-4.overflow-y-auto");
  await threadContainer.evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(700);
  await threadContainer.evaluate((el) =>
    el.scrollTo({ top: el.scrollHeight / 2, behavior: "smooth" }),
  );
  await pause(700);
  await threadContainer.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  await pause(700);
  steps.push("3. Scrolled the thread: inbound message, agent public reply, amber internal note");

  // Step 4 — reveal the stored AI Activity trail.
  const aiActivitySummary = page.getByText("AI Activity");
  await aiActivitySummary.scrollIntoViewIfNeeded();
  await aiActivitySummary.click();
  await pause(1200);
  steps.push(
    "4. Revealed AI Activity: stored Draft generated -> Draft approved sequence with its citation",
  );

  // Step 4b — LIVE draft generation against the local Ollama-protocol stub (variant A).
  const generateBtn = page.getByRole("button", { name: "Generate draft" });
  await generateBtn.scrollIntoViewIfNeeded();
  await generateBtn.click();
  await page.getByText("AI Draft").waitFor({ state: "visible", timeout: 15_000 });
  await pause(1200);
  await page.getByRole("button", { name: "Insert into reply" }).click();
  await pause(900);
  const [sendRes] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/api/tickets/${ticketId}/messages`) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Send Reply" }).click(),
  ]);
  if (!sendRes.ok()) {
    throw new Error(
      `[capture] Live draft send failed during recording (status ${sendRes.status()})`,
    );
  }
  await pause(1200);
  steps.push(
    "   Generated a LIVE cited draft via a local Ollama-protocol stub, inserted it into the reply, and sent it",
  );

  // Step 5 — /insights.
  await page.getByRole("link", { name: "Insight" }).click();
  await page.waitForURL(/\/insights/);
  await settle(page);
  await pause(1500);
  steps.push(
    "5. Navigated to /insights: four populated cards (recurring issues, KB gaps, volume drivers, SLA & CSAT)",
  );

  const video = page.video();
  await context.close(); // flushes the .webm
  const videoPath = (await video?.path()) ?? "";
  if (!videoPath) throw new Error("[capture] Recording produced no video file");

  const durationSeconds = (Date.now() - start) / 1000;
  return { videoPath, steps, durationSeconds };
}

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", args, { stdio: "inherit", cwd: PROJECT_ROOT });
}

interface GifResult {
  path: string;
  bytes: number;
  settings: string;
}

async function convertToGif(videoPath: string): Promise<GifResult> {
  const paletteFile = path.join(path.dirname(videoPath), "palette.png");
  const outFile = path.join(ASSETS_DIR, "aida-demo.gif");
  const attempts = [
    { fps: 12, scale: 1000 },
    { fps: 10, scale: 880 },
    { fps: 10, scale: 720 },
  ];

  let settings = "";
  let bytes = Number.POSITIVE_INFINITY;
  for (const { fps, scale } of attempts) {
    settings = `fps=${fps},scale=${scale}:-1:flags=lanczos`;
    log(`Converting recording to GIF at ${settings}...`);
    ffmpeg([
      "-y",
      "-i",
      videoPath,
      "-vf",
      `fps=${fps},scale=${scale}:-1:flags=lanczos,palettegen=stats_mode=diff`,
      paletteFile,
    ]);
    ffmpeg([
      "-y",
      "-i",
      videoPath,
      "-i",
      paletteFile,
      "-lavfi",
      `fps=${fps},scale=${scale}:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=3`,
      outFile,
    ]);
    bytes = fs.statSync(outFile).size;
    log(`  -> ${bytes} bytes`);
    if (bytes <= MAX_GIF_BYTES) break;
  }

  if (bytes > MAX_GIF_BYTES) {
    throw new Error(`[capture] aida-demo.gif still exceeds 8MB after all retries (${bytes} bytes)`);
  }
  return { path: outFile, bytes, settings };
}

// ---------------------------------------------------------------------------
// Shared boot sequence + main().
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let container: StartedPostgreSqlContainer | undefined;
  let server: ChildProcess | undefined;
  let uploadsDir: string | undefined;
  let videoDir: string | undefined;
  let stub: StubHandle | undefined;
  let browser: Browser | undefined;
  let pool: pg.Pool | undefined;
  let prisma: PrismaClient | undefined;

  const teardown = async (): Promise<void> => {
    log("Tearing down (server, container, temp dirs)...");
    try {
      await browser?.close();
    } catch {
      // already closed
    }
    try {
      stub?.server.close();
    } catch {
      // already closed
    }
    if (server?.pid) killTree(server.pid);
    try {
      await prisma?.$disconnect();
    } catch {
      // already disconnected
    }
    try {
      await pool?.end();
    } catch {
      // already ended
    }
    try {
      await container?.stop();
    } catch {
      // already stopped
    }
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    if (videoDir) fs.rmSync(videoDir, { recursive: true, force: true });
  };

  try {
    log(
      `Starting disposable pgvector/pgvector:pg16 container (mode: ${RECORD ? "record" : "screenshots"})...`,
    );
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("aida_capture")
      .withUsername("capture")
      .withPassword("capture")
      .start();
    const databaseUrl = container.getConnectionUri();
    // Overrides this SCRIPT PROCESS's own env for any later direct-import of app modules
    // (e.g. kbEmbedArticleHandler in --record mode) — spawned children below always get their
    // own explicit env object, never relying on inheritance for DATABASE_URL.
    process.env.DATABASE_URL = databaseUrl;

    log("Running prisma migrate deploy against the disposable container...");
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });

    log("Seeding the demo dataset...");
    const seedOutput = execFileSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          DEMO_ADMIN_EMAIL,
          DEMO_ADMIN_PASSWORD,
        },
        encoding: "utf-8",
      },
    );
    console.log(seedOutput);
    const ticketCountMatch = seedOutput.match(/"tickets":\s*(\d+)/);
    const ticketCount = ticketCountMatch ? Number(ticketCountMatch[1]) : 0;
    if (ticketCount !== 30) {
      throw new Error(
        `[capture] Seed did not report 30 tickets (parsed: ${ticketCount}). Aborting.`,
      );
    }
    log(`Seed confirmed ${ticketCount} tickets.`);

    pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const org = await prisma.organization.findFirstOrThrow();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { organizationId: org.id, subject: { contains: TICKET_SUBJECT_MATCH } },
    });

    // --- Build once (skip on rerun unless --build is passed, no prior build exists, or the
    // cached build was inlined for a different BASE_URL). NEXT_PUBLIC_APP_URL is a client-bundle
    // env var — Next.js inlines it at BUILD TIME, not runtime — so authClient's baseURL would
    // silently point at whatever port an OLDER, unrelated `next build` used (this was hit for
    // real: a stale build inlined `http://localhost`, making every browser-driven sign-in on
    // :3300 fail with net::ERR_CONNECTION_REFUSED). A small marker file records which BASE_URL
    // the cached build was produced for, so a port/URL mismatch always forces a fresh build.
    const buildIdMarker = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
    const buildMarkerPath = path.join(PROJECT_ROOT, ".next", "capture-build-marker.json");
    let cachedForThisUrl = false;
    if (fs.existsSync(buildMarkerPath)) {
      try {
        const marker = JSON.parse(fs.readFileSync(buildMarkerPath, "utf-8")) as {
          baseUrl?: string;
        };
        cachedForThisUrl = marker.baseUrl === BASE_URL;
      } catch {
        cachedForThisUrl = false;
      }
    }
    if (FORCE_BUILD || !fs.existsSync(buildIdMarker) || !cachedForThisUrl) {
      log(`Building the production bundle (next build) for ${BASE_URL}...`);
      execFileSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          NEXT_PUBLIC_APP_URL: BASE_URL,
          BETTER_AUTH_URL: BASE_URL,
          BETTER_AUTH_TRUSTED_ORIGINS: BASE_URL,
        },
        stdio: "inherit",
      });
      fs.writeFileSync(buildMarkerPath, JSON.stringify({ baseUrl: BASE_URL }));
    } else {
      log(`.next build cached for ${BASE_URL} — skipping (pass --build to force a rebuild).`);
    }

    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "aida-capture-uploads-"));

    const serverEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(PORT),
      HOSTNAME: "localhost",
      NODE_ENV: "production" as const,
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_TRUSTED_ORIGINS: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      BETTER_AUTH_SECRET: `${randomUUID()}${randomUUID()}`,
      RATE_LIMIT_PEPPER: randomUUID(),
      UPLOADS_DIR: uploadsDir,
      // Never let a headless-bootstrap or demo-mode boot path race the seed we already ran.
      ADMIN_EMAIL: "",
      ADMIN_PASSWORD: "",
      ADMIN_NAME: "",
      DEMO_MODE: "",
    };

    // next.config.ts sets `output: "standalone"`. Empirically confirmed on this machine: `next
    // start` boots and its /api/health check even passes, but Next.js itself prints "next start"
    // does not work with "output: standalone" configuration — use "node
    // .next/standalone/server.js" instead", and real page navigations (e.g. /login's sign-in
    // redirect) then hang/time out. So: whenever a standalone build exists, use it directly
    // (mirrors the Dockerfile's COPY --from=builder layout); `next start` is only a fallback for
    // an environment that somehow lacks output:standalone.
    const standaloneServerPath = path.join(PROJECT_ROOT, ".next", "standalone", "server.js");
    let serverMode: "next-start" | "standalone";
    if (fs.existsSync(standaloneServerPath)) {
      serverMode = "standalone";
      log("Preparing the standalone server layout (copying public/ + .next/static)...");
      const standaloneDir = path.join(PROJECT_ROOT, ".next", "standalone");
      fs.cpSync(path.join(PROJECT_ROOT, "public"), path.join(standaloneDir, "public"), {
        recursive: true,
      });
      fs.cpSync(
        path.join(PROJECT_ROOT, ".next", "static"),
        path.join(standaloneDir, ".next", "static"),
        { recursive: true },
      );
      log("Starting the production server via the standalone server.js...");
      server = spawn(process.execPath, ["server.js"], {
        cwd: standaloneDir,
        env: serverEnv as NodeJS.ProcessEnv,
        stdio: "pipe",
      });
    } else {
      serverMode = "next-start";
      log("No .next/standalone build found — starting the production server via `next start`...");
      server = spawn(
        process.execPath,
        ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
        { cwd: PROJECT_ROOT, env: serverEnv as NodeJS.ProcessEnv, stdio: "pipe" },
      );
    }
    server?.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[server] ${chunk}`));
    server?.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`));
    await waitForServer(`${BASE_URL}/api/health`, 60_000);
    log(`Server ready (mode: ${serverMode}).`);

    // --- Log in as the demo admin through the real /login form; reuse the auth state. ---
    browser = await chromium.launch();
    const loginPage = await browser.newPage({ baseURL: BASE_URL });
    await gotoWarm(loginPage, "/login");
    await loginPage.getByLabel("Email address").fill(DEMO_ADMIN_EMAIL);
    await loginPage.getByLabel("Password", { exact: true }).fill(DEMO_ADMIN_PASSWORD);
    await loginPage.getByRole("button", { name: "Sign in" }).click();
    await loginPage.waitForURL(/\/tickets/);
    const storageState = await loginPage.context().storageState();
    await loginPage.close();

    if (!RECORD) {
      await captureScreenshots(browser, storageState, ticket.id);
    } else {
      videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aida-capture-video-"));

      stub = await startOllamaStub();
      log(`Local Ollama-protocol stub listening at ${stub.url}`);

      await configureOllamaStubProvider(prisma, org.id, stub.url);

      const articles = await prisma.kbArticle.findMany({ where: { organizationId: org.id } });
      const kbTitles = articles.map((a) => a.title);
      if (!kbTitles.includes(KB_ARTICLE_TITLE)) {
        throw new Error(`[capture] Expected KB article "${KB_ARTICLE_TITLE}" not found in seed`);
      }

      log("Embedding the six seeded KB articles via kbEmbedArticleHandler (no worker process)...");
      const { kbEmbedArticleHandler } = await import("../src/lib/worker/jobs/kb-embed-article");
      for (const article of articles) {
        await kbEmbedArticleHandler({ articleId: article.id });
      }
      const reChecked = await prisma.kbArticle.findMany({ where: { organizationId: org.id } });
      const failed = reChecked.filter((a) => a.embeddingStatus !== "COMPLETED");
      if (failed.length > 0) {
        throw new Error(
          `[capture] ${failed.length} KB article(s) failed to embed against the stub: ${failed.map((a) => a.title).join(", ")}`,
        );
      }
      log(`All ${reChecked.length} KB articles embedded (embeddingStatus: COMPLETED).`);

      const recording = await recordGoldenPath(browser, storageState, videoDir, ticket.id);
      console.log("\n[capture] Golden path steps recorded:");
      for (const step of recording.steps) console.log(`  ${step}`);
      console.log(`[capture] Total recording runtime: ${recording.durationSeconds.toFixed(1)}s`);

      fs.mkdirSync(ASSETS_DIR, { recursive: true });
      const gif = await convertToGif(recording.videoPath);
      console.log(
        `\n[capture] docs/assets/aida-demo.gif: ${gif.bytes} bytes (settings: ${gif.settings})`,
      );
    }

    log("Capture complete.");
  } finally {
    await teardown();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[capture] FAILED:", err);
    process.exit(1);
  });
