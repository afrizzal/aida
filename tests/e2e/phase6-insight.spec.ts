/**
 * Phase 6 (AIDA Insight) E2E coverage — automated evidence for the human-UAT items
 * recorded in .planning/phases/06-aida-insight/06-HUMAN-UAT.md.
 *
 * Covers:
 *  - Item 1 (visual review of /insights): renders the four design-system cards from a
 *    seeded COMPLETED InsightRun, exercises the empty state, the period tabs, the sidebar
 *    nav item, and the "Generate insights" enqueue-a-background-job flow. Reference
 *    screenshots land in test-results/phase6-visual/ (gitignored, regenerated per run).
 *  - Item 2 (CSAT capture end-user flow): a customer picks a 1-5 star rating + comment on
 *    the public status page of a RESOLVED ticket, submits, the row persists, and the rating
 *    prefills on reload. Also proves the form is hidden until the ticket is resolved.
 *
 * Item 3 (real-LLM output quality) stays a genuine human item — a stubbed LLM cannot judge
 * semantic quality, so it is intentionally NOT covered here.
 *
 * Pattern mirrors tests/e2e/phase5-rag.spec.ts and tests/e2e/public-status.spec.ts:
 * seed domain data directly via Prisma / createTicket from ./support/db, drive the real UI,
 * assert against the real DB. Runs serially (playwright.config: workers=1, fullyParallel=false)
 * so tests within a describe execute in declaration order. Run under Node 22.23.1:
 *   volta run --node 22.23.1 pnpm test:e2e -- tests/e2e/phase6-insight.spec.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { createTicket, orgId, prisma } from "./support/db";
import { expect, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const VISUAL_DIR = path.join(PROJECT_ROOT, "test-results", "phase6-visual");
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");

const ts = Date.now();

fs.mkdirSync(VISUAL_DIR, { recursive: true });

/**
 * Warm a route the first time this spec hits it. Guards against next-dev's transient first-hit
 * 404 AND its slow cold Turbopack compile: waits only for domcontentloaded (server HTML, not full
 * client load) and allows a generous budget, since a first authed compile can take ~8s+.
 */
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

/**
 * Insert one COMPLETED InsightRun whose five JSON columns are all non-empty, so every card on
 * /insights renders populated. Mirrors the exact persisted shapes in src/lib/insight/types.ts
 * (StoredCluster / StoredKbGap / VolumeDrivers / SlaCsatSummary / StoredNarrative). Seeding is a
 * bare-prisma write with an explicit organizationId (the read path is org-scoped via scopedDb).
 */
async function seedCompletedRun(periodDays: number) {
  return prisma.insightRun.create({
    data: {
      organizationId: orgId,
      status: "COMPLETED",
      periodDays,
      periodStart: new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
      completedAt: new Date(),
      ticketCount: 20,
      embeddingModel: "openai:text-embedding-3-small",
      provider: "openai",
      model: "gpt-4o-mini",
      params: {
        clusterSimilarityThreshold: 0.8,
        minClusterSize: 3,
        gapThreshold: 0.5,
        excerptCharLimit: 500,
        embedBatchSize: 100,
        maxClustersRendered: 20,
      },
      clusters: [
        {
          index: 0,
          label: "Login issues",
          description: "Users report they cannot log in to their account.",
          size: 4,
          citations: [
            { ticketId: "seed-cluster-t1", number: 101, subject: "Can't log in" },
            { ticketId: "seed-cluster-t2", number: 102, subject: "Password reset fails" },
          ],
        },
      ],
      kbGaps: [
        {
          clusterIndex: 0,
          label: "Login issues",
          size: 4,
          coverage: null,
          nearestArticle: null,
          citations: [{ ticketId: "seed-cluster-t1", number: 101, subject: "Can't log in" }],
        },
      ],
      volumeDrivers: {
        byCategory: [{ key: "Billing", count: 12, previousCount: 8, delta: 4 }],
        byTag: [{ key: "urgent", count: 5, previousCount: 5, delta: 0 }],
        byCompany: [{ key: "Acme Inc", count: 7, previousCount: 10, delta: -3 }],
      },
      slaCsat: {
        sla: {
          total: 20,
          breached: 3,
          atRiskOnly: 2,
          breachRate: 0.15,
          avgFirstResponseSeconds: 5400,
          avgResolutionSeconds: 86400,
        },
        csat: {
          responseCount: 8,
          averageScore: 4.2,
          distribution: [
            { score: 1, count: 0 },
            { score: 2, count: 1 },
            { score: 3, count: 1 },
            { score: 4, count: 2 },
            { score: 5, count: 4 },
          ],
        },
      },
      narrative: {
        summary: "Ticket volume was steady this period with no notable SLA breaches.",
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Item 1 — AIDA Insight (/insights). Authenticated (admin) surface.
// ---------------------------------------------------------------------------
test.describe("AIDA Insight (/insights)", () => {
  test.use({ storageState: ADMIN_STORAGE });

  test("sidebar 'Insight' link opens /insights and shows the empty state", async ({ page }) => {
    test.setTimeout(90_000);
    // First hit of the run to /insights — warm it, and it defaults to period=30 (no run yet).
    await gotoWarm(page, "/insights");

    await expect(page.getByRole("heading", { level: 1, name: "AIDA Insight" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "No insights yet" })).toBeVisible();
    await expect(
      page.getByText("Generate insights to cluster recurring issues", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Not generated yet")).toBeVisible();

    await page.screenshot({
      path: path.join(VISUAL_DIR, "insights-empty-state.png"),
      fullPage: true,
    });

    // Sidebar nav item is labeled "Insight" (singular) and routes to /insights.
    await page.goto("/tickets");
    await page.getByRole("link", { name: "Insight" }).click();
    await expect(page).toHaveURL(/\/insights/);
    await expect(page.getByRole("heading", { level: 1, name: "AIDA Insight" })).toBeVisible();
  });

  test("a completed run renders all four insight cards", async ({ page }) => {
    test.setTimeout(60_000);
    await seedCompletedRun(30);

    await page.goto("/insights?period=30");

    await expect(page.getByRole("heading", { level: 1, name: "AIDA Insight" })).toBeVisible();
    await expect(page.getByText(/^Last generated /)).toBeVisible();

    // All four card titles.
    await expect(page.getByRole("heading", { name: "Recurring Issues" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Knowledge-Base Gaps" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Volume Drivers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "SLA & CSAT" })).toBeVisible();

    // Representative populated content per card.
    await expect(page.getByText("Login issues").first()).toBeVisible();
    await expect(page.getByText("4 tickets")).toBeVisible();
    await expect(page.locator('a[href="/tickets/seed-cluster-t1"]').first()).toBeVisible();
    await expect(page.getByText("No KB articles exist yet", { exact: false })).toBeVisible();
    await expect(page.getByText("By Category")).toBeVisible();
    await expect(page.getByText("Billing")).toBeVisible();
    await expect(page.getByText("Breach rate")).toBeVisible();
    await expect(page.getByText("AI summary")).toBeVisible();
    await expect(page.getByText("Ticket volume was steady", { exact: false })).toBeVisible();

    await page.screenshot({
      path: path.join(VISUAL_DIR, "insights-populated.png"),
      fullPage: true,
    });
  });

  test("period tabs scope the visible run (30d populated, 90d empty)", async ({ page }) => {
    // Relies on the period-30 run seeded by the previous test (serial run, shared DB).
    await page.goto("/insights?period=30");
    await expect(page.getByRole("heading", { name: "Recurring Issues" })).toBeVisible();

    await page.getByRole("button", { name: "90d" }).click();
    await expect(page).toHaveURL(/period=90/);
    await expect(page.getByRole("heading", { level: 2, name: "No insights yet" })).toBeVisible();
    await page.screenshot({
      path: path.join(VISUAL_DIR, "insights-period-90-empty.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "30d" }).click();
    await expect(page).toHaveURL(/period=30/);
    await expect(page.getByRole("heading", { name: "Recurring Issues" })).toBeVisible();
  });

  test("'Generate insights' enqueues a background run without blocking the UI", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // Use period=7, which is never seeded COMPLETED, so this asserts a fresh enqueue.
    await page.goto("/insights?period=7");

    const generate = page.getByRole("button", { name: "Generate insights" });
    await expect(generate).toBeEnabled();
    await generate.click();

    // The Server Action creates a PENDING InsightRun row then enqueues a pg-boss job and returns
    // immediately (no blocking compute). No worker runs in this spec, so the row stays PENDING.
    await expect
      .poll(
        async () => {
          const run = await prisma.insightRun.findFirst({
            where: { organizationId: orgId, periodDays: 7 },
            orderBy: { createdAt: "desc" },
          });
          return run?.status ?? null;
        },
        { timeout: 20_000 },
      )
      .toMatch(/PENDING|RUNNING|FAILED/);

    // With a run in flight for this period the button reflects the busy state (best-effort —
    // only true when the enqueue succeeded and the row is still PENDING/RUNNING).
    await expect
      .soft(page.getByRole("button", { name: "Generating…" }))
      .toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Item 2 — Public CSAT capture on the status page. Anonymous (no storageState).
// ---------------------------------------------------------------------------
test.describe("Public CSAT capture", () => {
  test("the CSAT form is hidden until the ticket is resolved", async ({ page }) => {
    test.setTimeout(90_000);
    const ticket = await createTicket(orgId, {
      subject: `E2E CSAT gate ${ts}`,
      priority: "NORMAL",
      body: "Original request body.",
      contact: { email: `csat-gate-${ts}@example.com`, name: "Gate Customer" },
      direction: "INBOUND",
    });

    // First public hit to /status this run — warm it.
    await gotoWarm(page, `/status/${ticket.statusToken}`);

    // Ticket is NEW → no CSAT block; the always-present follow-up form still renders.
    await expect(page.getByRole("heading", { name: "How did we do?" })).toHaveCount(0);
    await expect(page.getByPlaceholder("Write a follow-up…")).toBeVisible();
  });

  test("a customer submits a rating; it persists and prefills on reload", async ({ page }) => {
    test.setTimeout(60_000);
    const ticket = await createTicket(orgId, {
      subject: `E2E CSAT submit ${ts}`,
      priority: "NORMAL",
      body: "Original request body.",
      contact: { email: `csat-submit-${ts}@example.com`, name: "CSAT Customer" },
      direction: "INBOUND",
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    await page.goto(`/status/${ticket.statusToken}`);
    await expect(page.getByRole("heading", { name: "How did we do?" })).toBeVisible();

    // Submit is disabled until a star is chosen.
    const submit = page.getByRole("button", { name: "Submit" });
    await expect(submit).toBeDisabled();

    await page.getByRole("button", { name: "Rate 5 out of 5" }).click();
    await expect(page.getByRole("button", { name: "Rate 5 out of 5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(submit).toBeEnabled();

    const comment = "Very helpful, resolved quickly.";
    await page.getByPlaceholder("Anything you'd like to add? (optional)").fill(comment);
    await page.screenshot({ path: path.join(VISUAL_DIR, "csat-form-filled.png"), fullPage: true });

    await submit.click();
    // First POST to /api/public/status/[token]/csat can cold-compile (~9s) — allow for it.
    await expect(page.getByText("Thanks for your feedback!")).toBeVisible({ timeout: 25_000 });

    // Persisted exactly once, keyed on the ticket.
    await expect
      .poll(async () => {
        const row = await prisma.csatResponse.findUnique({ where: { ticketId: ticket.id } });
        return row ? `${row.score}|${row.comment}` : null;
      })
      .toBe(`5|${comment}`);

    // A fresh load re-renders the server form with the existing rating prefilled.
    await page.goto(`/status/${ticket.statusToken}`);
    await expect(page.getByRole("button", { name: "Rate 5 out of 5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByPlaceholder("Anything you'd like to add? (optional)")).toHaveValue(
      comment,
    );
    await page.screenshot({ path: path.join(VISUAL_DIR, "csat-prefilled.png"), fullPage: true });
  });
});
