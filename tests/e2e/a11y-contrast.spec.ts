/**
 * Automated contrast/a11y coverage (07-09.1 Task 3, D-3).
 *
 * DESIGN-SYSTEM.md §9's "Dark mode diuji" checklist item was, until now, closed only by a human
 * eyeballing a screenshot (07-08's Task 3 sign-off). That sign-off explicitly discharged 5 surfaces
 * (inbox, ticket-detail, insights, KB list, AI settings) but 05-HUMAN-UAT.md item 3 named FOUR
 * surfaces it never covered: /kb, /kb/new, /kb/[id], and the ticket page's draft card in its
 * IN-FLIGHT state (generated, not yet inserted — distinct from ticket-detail.png's RESOLVED
 * Triage -> Draft generated -> Draft approved trail). This file asserts zero `color-contrast`
 * axe-core violations on exactly those four surfaces, in both themes, forcing the theme exactly
 * as scripts/capture-demo-assets.ts does (`colorScheme` context option + a `theme` localStorage
 * init script) so the assertion targets the same rendering path a human reviewer would see.
 *
 * Aesthetic judgement (spacing, "does this look good") is NOT automatable and is NOT a release
 * gate per D-3 — only objective WCAG contrast is asserted here. See 07-SECURITY-PASS.md's Human
 * verification items #3 for the aesthetic residual this file does not (and should not) close.
 *
 * File ordering note: "a11y-contrast" sorts alphabetically BEFORE every other spec file in this
 * directory (attachments, authz, contacts, honesty-invariants, phase4-ai, phase5-rag, ...), so
 * this file runs FIRST in the shared, single-container e2e run. phase5-rag.spec.ts's first test
 * asserts the KB empty state at ZERO articles, and phase4-ai.spec.ts asserts the AI toggle is
 * disabled "before a provider is configured" — this file's afterAll must revert every piece of
 * shared org-scoped state it touches (Settings rows, the KB article, the ticket) exactly like
 * honesty-invariants.spec.ts already does for the same reason.
 *
 * CONTRAST HISTORY (RESOLVED 2026-08-01). The first run of this suite found several genuine axe
 * color-contrast violations. Every one traceable to an isolated component bug (wrong/missing Badge
 * `variant` silently inheriting `bg-primary`; the sidebar footer email's `/60`-opacity muted text)
 * was FIXED at its source — see `src/components/tickets/{triage-category-chip,priority-chip,
 * triage-sentiment-chip,ticket-meta-header}.tsx` and `src/components/sidebar.tsx`. What remained
 * after that (see `.planning/phases/07-launch-readiness/deferred-items.md`'s "From 07-09.1"
 * section for the full history) was a systemic gap in the brand/semantic color VALUES themselves,
 * used identically across dozens of components — reported rather than mechanically patched, since
 * adjusting `--primary`/`--success` was a maintainer brand decision:
 *   - `--success` (light mode) as badge text on its own `/10` tint — was 3.47:1 (needs 4.5:1),
 *     e.g. KbEmbeddingStatusChip's "Indexed" badge (/kb, /kb/[id], light theme).
 *   - `--primary` (dark mode) used AS TEXT on dark surfaces — was 3.86-4.1:1, e.g. the sidebar
 *     avatar-initials fallback (every dark-theme page), "AI Draft"/citation links, "All"/"Public
 *     Reply" pills (ticket page, dark theme).
 *   - `--primary` as a solid button/badge background with near-white text — was 3.98:1 light /
 *     4.29:1 dark, e.g. every default-variant Button ("Insert into reply", "Create article",
 *     "New article", etc.) and StatusChip's NEW state.
 * The maintainer's decision (2026-08-01): darken `--success` (light) and `--primary` (dark,
 * background role only) slightly, and split `--primary` into a background token (`--primary`,
 * unchanged hue/chroma) and a new text-legible token (`--primary-emphasis` /
 * `--sidebar-primary-emphasis`) for every TEXT usage — see DESIGN-SYSTEM.md §1/§2. A fourth,
 * previously-mis-attributed failure (`#716ee4`, light mode, 3.98:1) turned out to be `Button`/
 * `Badge`'s opacity-based hover state (`hover:bg-primary/80`) captured mid-`:hover`, not `--primary`
 * itself — fixed via a `color-mix` darken instead of an opacity blend. A fifth, previously-masked
 * violation (`ai-activity-section.tsx`'s `text-muted-foreground/70` event count, 4.17:1 dark —
 * unrelated to `--primary`/`--success`, only visible once a ticket has AI-activity events) was
 * found live while re-verifying this fix and fixed the same way (dropped the `/70`). All 8 tests
 * in this file are green as a direct result — see `deferred-items.md` for the full before/after
 * ratio table.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { EMBEDDING_DIMENSIONS } from "../../src/lib/rag/types";
import { createTicket, orgId, prisma } from "./support/db";
import { CHAT_MODEL, createLlmStub, EMBED_MODEL } from "./support/llm-stub";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");

const ts = Date.now();
const MARKER = `aida-e2e-a11y-marker-${ts}`;

// Deterministic, mutually orthogonal embedding vectors (cosine distance exactly 1, comfortably
// beyond generate-draft.ts's 0.5 groundedness threshold) — same technique as phase5-rag.spec.ts
// and honesty-invariants.spec.ts, zero flake risk.
const HALF = EMBEDDING_DIMENSIONS / 2;
const CANONICAL_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 1 : 0,
);
const UNRELATED_VECTOR: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
  i < HALF ? 0 : 1,
);

const stub = createLlmStub();
stub.embedFn = (text) => (text.includes(MARKER) ? CANONICAL_VECTOR : UNRELATED_VECTOR);

const SETTING_KEYS_TO_RESET = [
  "llm:provider",
  "llm:model",
  "llm:ollamaBaseUrl",
  "llm:embeddingProvider",
  "llm:embeddingModel",
  "llm:embeddingOllamaBaseUrl",
];

let articleId = "";
let ticketId = "";
const draftMarkdown =
  "Thanks for reaching out! Here is a grounded, cited answer for the contrast scan [1].";

// First-hit compile-race guard (project pitfall: next dev can transiently 404 a route before its
// first compile finishes) — this file runs before any other spec has warmed these routes.
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

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await stub.start();

  // Settings written directly (bypassing the UI form) — the settings-save flow itself is already
  // covered by phase5-rag.spec.ts/honesty-invariants.spec.ts; this file only needs a genuinely
  // functioning provider so the KB article really embeds and "Generate draft" really produces the
  // in-flight DraftCard state, not a faked DOM.
  for (const [key, value] of [
    ["llm:provider", "ollama"],
    ["llm:model", CHAT_MODEL],
    ["llm:ollamaBaseUrl", stub.url],
    ["llm:embeddingProvider", "ollama"],
    ["llm:embeddingModel", EMBED_MODEL],
    ["llm:embeddingOllamaBaseUrl", stub.url],
  ] as const) {
    await prisma.setting.create({ data: { organizationId: orgId, key, value } });
  }

  // Real KB article through the real createKbArticle path (05-03) — never a raw prisma.create,
  // so bodyHtml/slug are produced exactly like the product does it. Embedded via a direct
  // kbEmbedArticleHandler call (no worker process needed for this file — mirrors
  // scripts/capture-demo-assets.ts's --record mode, which uses the identical shortcut).
  const { createKbArticle } = await import("../../src/lib/kb/create-article");
  const article = await createKbArticle(orgId, {
    title: `A11y contrast KB article ${ts}`,
    bodyMarkdown: `# A11y contrast KB article\n\nGenuine KB content for the contrast scan. ${MARKER}`,
  });
  articleId = article.id;

  const { kbEmbedArticleHandler } = await import("../../src/lib/worker/jobs/kb-embed-article");
  await kbEmbedArticleHandler({ articleId });

  const embedded = await prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
  if (embedded.embeddingStatus !== "COMPLETED") {
    throw new Error(
      `[a11y-contrast] KB article fixture failed to embed (status: ${embedded.embeddingStatus})`,
    );
  }

  const ticket = await createTicket(orgId, {
    subject: `A11y contrast draft ticket ${ts}`,
    priority: "NORMAL",
    body: `Question that matches the KB article. ${MARKER}`,
    contact: { email: `a11y-contrast-${ts}@example.com` },
    direction: "INBOUND",
  });
  ticketId = ticket.id;

  const chunk = await prisma.kbChunk.findFirstOrThrow({ where: { articleId } });
  stub.chatResponse = {
    grounded: true,
    draftMarkdown,
    citations: [{ marker: "1", chunkId: chunk.id }],
  };
});

test.afterAll(async () => {
  stub.stop();
  if (ticketId) await prisma.ticket.delete({ where: { id: ticketId } }).catch(() => {});
  if (articleId) await prisma.kbArticle.delete({ where: { id: articleId } }).catch(() => {});
  await prisma.setting.deleteMany({
    where: { organizationId: orgId, key: { in: SETTING_KEYS_TO_RESET } },
  });
});

// ---------------------------------------------------------------------------
// One describe block per theme — colorScheme forces the media-query signal, the addInitScript
// forces the app's own `theme` localStorage key, exactly matching
// scripts/capture-demo-assets.ts's captureScreenshots() forcing technique.
// ---------------------------------------------------------------------------
for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ storageState: ADMIN_STORAGE, colorScheme: theme });

    async function scanForContrastViolations(page: Page) {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const contrastViolations = results.violations.filter((v) => v.id === "color-contrast");
      expect(contrastViolations, JSON.stringify(contrastViolations, null, 2)).toEqual([]);
    }

    test(`/kb has zero color-contrast violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await gotoWarm(page, "/kb");
      // Scoped to main: TopBar (src/components/top-bar.tsx) renders its own page-title <h1> in
      // the sticky header for every (app) route, so an unscoped getByRole("heading") matches
      // BOTH that and /kb/page.tsx's own <h1> — a real, pre-existing duplicate-<h1> pattern
      // across the whole app, out of this test's scope to fix (SCOPE BOUNDARY — logged as a
      // pre-existing finding, not touched).
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Knowledge Base" }),
      ).toBeVisible();
      await expect(page.getByText(`A11y contrast KB article ${ts}`)).toBeVisible();
      await scanForContrastViolations(page);
    });

    test(`/kb/new has zero color-contrast violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await gotoWarm(page, "/kb/new");
      await expect(page.getByRole("heading", { name: "New article" })).toBeVisible();
      await scanForContrastViolations(page);
    });

    test(`/kb/[id] has zero color-contrast violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await gotoWarm(page, `/kb/${articleId}`);
      await expect(page.getByText("Indexed")).toBeVisible();
      await scanForContrastViolations(page);
    });

    test(`ticket page with the in-flight draft card has zero color-contrast violations (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      await gotoWarm(page, `/tickets/${ticketId}`);
      await page.getByRole("button", { name: "Generate draft" }).click();

      // In-flight: the DraftCard is rendered (Insert/Discard both present, nothing sent yet) —
      // distinct from ticket-detail.png's static capture of an already-RESOLVED Triage -> Draft
      // generated -> Draft approved trail, which is a different DOM state entirely.
      await expect(page.getByText("AI Draft")).toBeVisible();
      await expect(page.getByText(draftMarkdown)).toBeVisible();
      await expect(page.getByRole("button", { name: "Insert into reply" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();

      await scanForContrastViolations(page);
    });
  });
}
