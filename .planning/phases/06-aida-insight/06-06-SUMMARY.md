---
phase: 06-aida-insight
plan: 06
subsystem: ai
tags: [pg-boss, pgvector, clustering, embeddings, llm, insight-analytics, prisma]

# Dependency graph
requires:
  - phase: 06-aida-insight (06-01)
    provides: InsightRun/TicketEmbedding/CsatResponse schema + shared insight/types.ts contract
  - phase: 06-aida-insight (06-02)
    provides: leaderCluster (deterministic clustering math), buildTicketExcerpt, ticket-embeddings cache read/write
  - phase: 06-aida-insight (06-03)
    provides: computeVolumeDrivers, computeSlaCsat, periodMath (SQL aggregates)
  - phase: 06-aida-insight (06-04)
    provides: nearestKbChunk/scoreGap (KB-gap KNN), cluster-label + narrative Zod schema/prompt pairs
provides:
  - runInsight(insightRunId) orchestrator composing all four Wave-2 sections into one idempotent recompute
  - insightRunHandler pg-boss job handler (load -> RUNNING -> runInsight -> COMPLETED/FAILED)
  - insight-run queue registered in both src/lib/queue/boss-client.ts (app) and src/lib/worker/index.ts (worker)
  - end-to-end integration test proving reproducibility + AI-off degradation
affects: [06-07 (the /insights UI plan reads InsightRun rows this job writes)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent full-recompute-on-retry: runInsight never partial-resumes; every pg-boss retry recomputes every section and overwrites the row"
    - "Defense-in-depth AI gate re-checked at execution time (canCluster/canNarrate), never trusted from enqueue time"
    - "Programmatic citations: citations always built from leaderCluster's memberIds, never from LLM output (LLM only supplies label+description)"
    - "Zero-KB shortcut: kbChunkCount === 0 flags every reported cluster as a gap with coverage: null, skipping the KNN call entirely"

key-files:
  created:
    - src/lib/insight/run-insight.ts
    - src/lib/worker/jobs/insight-run.ts
    - tests/integration/insight-run.test.ts
  modified:
    - src/lib/queue/boss-client.ts
    - src/lib/worker/index.ts

key-decisions:
  - "Worktree was checked out at pre-Phase-6 master (missing all Wave 1/2 code) — fast-forward merged to master before any execution (mirrors the 03-05 precedent)."
  - "Standard InsightRunParams defaults (clusterSimilarityThreshold 0.8, minClusterSize 3, gapThreshold 0.5, excerptCharLimit 500, embedBatchSize 100, maxClustersRendered 20) taken verbatim from 06-RESEARCH.md's recommendation and used as the test's seeded params — no shared defaults constant exists yet (06-07's job to introduce one for the UI's 'Generate insights' action)."
  - "Integration test seeds TicketEmbedding vectors directly via raw SQL (two orthogonal base vectors + tiny deterministic per-member noise) instead of mocking embed() — keeps clustering fully deterministic and exercises the real cached-embedding read path with zero SDK mocking surface."
  - "AIDA-17 intentionally NOT marked complete in REQUIREMENTS.md yet — this plan wires the backend job only; the requirement's user-facing flow (the /insights page + 'Generate insights' button) is 06-07's job. Mirrors the 02-08/03-01 precedent of not closing a split requirement until its full flow lands."

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-07-25
---

# Phase 6 Plan 06: insight-run pg-boss orchestrator Summary

**`runInsight(insightRunId)` composes all four Wave-2 insight modules (clustering+labels+citations, KB-gap KNN, SQL volume-drivers/SLA/CSAT, narrative) into one idempotent pg-boss job, registered end-to-end in both boss clients and proven by an integration test covering reproducibility and AI-off degradation.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-25
- **Tasks:** 3/3 completed
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `src/lib/insight/run-insight.ts`: the orchestrator loads an `InsightRun`, always computes `volumeDrivers`/`slaCsat` (SQL-only, AI-independent), re-checks the AI gate at execution time (`canCluster = aiEnabled && llmConfigured && embeddingConfigured`, `canNarrate = aiEnabled && llmConfigured`), embeds only missing period tickets, clusters deterministically, labels clusters via one schema-forced LLM call, flags KB gaps via KNN (or the zero-KB shortcut), writes one narrative via a second schema-forced LLM call, and overwrites the run's JSON columns in a single Prisma update.
- `src/lib/worker/jobs/insight-run.ts` + queue registration in both `src/lib/queue/boss-client.ts` and `src/lib/worker/index.ts`: the `insight-run` queue now exists app-side and worker-side with the standard `retryLimit: 2, retryBackoff: true, retryDelayMax: 300` shape, and the worker subscribes with `boss.work("insight-run", ...)`.
- `tests/integration/insight-run.test.ts`: proves the whole pipeline end-to-end against a real Testcontainers Postgres — labeled+cited clusters, volume drivers, SLA/CSAT (CSAT count 2, avg 4.5, 5-bucket distribution), non-empty KB gaps with `coverage: null`, exactly two audited `INSIGHT_CLUSTER_LABELS`/`INSIGHT_SUMMARY` events with redacted input, byte-identical cluster membership across two runs, and AI-off degradation (`clusters`/`kbGaps`/`narrative` null, SQL sections still populated).

## Task Commits

Each task was committed atomically:

1. **Task 1: The orchestrator (run-insight.ts)** - `971a3a2` (feat)
2. **Task 2: Worker job handler + queue registration in both boss files** - `a114530` (feat)
3. **Task 3: Integration test (tests/integration/insight-run.test.ts)** - `24a383b` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/lib/insight/run-insight.ts` - `runInsight(insightRunId)` orchestrator; composes cluster/excerpt/ticket-embeddings/volume-drivers/sla-csat/kb-gap/cluster-label-prompt/narrative-prompt into one idempotent recompute
- `src/lib/worker/jobs/insight-run.ts` - `insightRunHandler`: load -> RUNNING -> runInsight -> COMPLETED/(FAILED+rethrow)
- `src/lib/queue/boss-client.ts` - added `insight-run` createQueue (app-side singleton)
- `src/lib/worker/index.ts` - added `insight-run` createQueue + `boss.work` registration (worker-side)
- `tests/integration/insight-run.test.ts` - end-to-end + reproducibility + AI-off integration test

## Decisions Made

- Fast-forward merged this plan's assigned worktree to `master` before execution — it was checked out at a pre-Phase-6 commit missing all of Wave 1/2's code (`src/lib/insight/*`, the `InsightRun`/`TicketEmbedding`/`CsatResponse` schema, `06-01` through `06-05` PLAN/SUMMARY docs). No divergent commits existed on the worktree branch, so `git merge --ff-only master` was safe. This mirrors the exact 03-05 precedent already documented in STATE.md.
- Used the standard `InsightRunParams` defaults from `06-RESEARCH.md` (`0.8`/`3`/`0.5`/`500`/`100`/`20`) directly in the integration test since no shared defaults constant exists in the codebase yet — 06-07 (the UI plan that adds the "Generate insights" Server Action) is the natural place to introduce one.
- Test seeds `TicketEmbedding` rows directly via raw SQL with two orthogonal hand-crafted base vectors (constant-1 vs. alternating +1/-1, guaranteeing ~0 cross-group cosine similarity) plus tiny deterministic per-member sine-based noise, rather than mocking `embed()`. This keeps the clustering input fully controlled and deterministic while still exercising the real `readCachedEmbeddings`/`writeNewEmbeddings` cache-read path (the "missing" list is empty, so no embed call happens at all — matching the plan's suggested strategy).
- Deferred marking `AIDA-17` complete in `REQUIREMENTS.md` — this plan only wires the backend compute job; the requirement isn't validated end-to-end until 06-07 ships the `/insights` page and "Generate insights" trigger. Mirrors the project's established split-requirement discipline (see STATE.md decisions for 02-08 and 03-01).

## Deviations from Plan

None - plan executed exactly as written. The only pre-execution adjustment was environment bootstrap (worktree fast-forward + `pnpm install` + `pnpm prisma generate` + `cp .env.example .env`), which is infrastructure setup, not a deviation from the plan's task content.

## Issues Encountered

- This plan's assigned worktree (`agent-a698a5592c57d4966`) was stale, checked out at commit `3fe2e2d` (pre-Phase-6, missing all of Wave 1/2's insight code and phase docs). Resolved by fast-forward merging to `master` (`62d5240`) before starting Task 1 — see Decisions Made above.
- Fresh worktree had no `node_modules`, `.env`, or generated Prisma client — bootstrapped via `cp .env.example .env`, `pnpm install`, and `pnpm prisma generate` before any typecheck/test could run (mirrors the documented 02-02 fresh-worktree-bootstrap precedent).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `insight-run` pg-boss job is fully wired end-to-end (app-side enqueue capability + worker-side processing) and proven by an integration test. 06-07 can now build the `/insights` UI's "Generate insights" Server Action on top of `getBoss().send("insight-run", { insightRunId })` with confidence the job computes and persists all four sections correctly.
- No blockers. `pnpm exec tsc --noEmit` clean; `pnpm exec biome check` clean on all touched files; the esbuild worker-bundle command builds `dist/worker-verify.mjs` with zero errors; `volta run --node 22.23.1 pnpm test:integration` passes 11/11 files (26/26 tests, including the new suite); `pnpm test` (unit) passes 16/16 files (81/81 tests).

---
*Phase: 06-aida-insight*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: src/lib/insight/run-insight.ts
- FOUND: src/lib/worker/jobs/insight-run.ts
- FOUND: tests/integration/insight-run.test.ts
- FOUND: .planning/phases/06-aida-insight/06-06-SUMMARY.md
- FOUND commit: 971a3a2
- FOUND commit: a114530
- FOUND commit: 24a383b
