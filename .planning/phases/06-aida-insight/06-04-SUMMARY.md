---
phase: 06-aida-insight
plan: 04
subsystem: ai
tags: [zod, pgvector, prompt-injection, llm, insight]

# Dependency graph
requires:
  - phase: 06-aida-insight (06-01)
    provides: src/lib/insight/types.ts (NearestArticle contract), scopedDb/audit widening, InsightRun/TicketEmbedding/CsatResponse schema
provides:
  - "nearestKbChunk + scoreGap: org+embeddingModel-scoped pgvector top-1 KNN coverage scoring against KbChunk"
  - "ClusterLabelsResultSchema/CLUSTER_LABEL_SYSTEM_PROMPT/buildClusterLabelPrompt: schema-forced label/description-only LLM call with fenced untrusted excerpts"
  - "InsightNarrativeSchema/INSIGHT_NARRATIVE_SYSTEM_PROMPT/buildNarrativePrompt: single-string stats-only narrative LLM call"
affects: [06-06 (insight-run orchestrator wires these into complete())]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "KB-gap KNN mirrors src/lib/rag/retrieve.ts's exact org+embeddingModel-filtered <=> query shape, topK reduced to 1"
    - "Membership/citations for AI-labeled clusters are never delegated to the LLM (Pitfall 8) — schema only carries clusterIndex/label/description"
    - "Untrusted ticket excerpts are always wrapped via fenceContent() before entering any LLM prompt (AIDA-20)"
    - "The narrative LLM call only ever receives computed aggregate JSON (no customer text) and returns exactly one summary string — numbers always come from stored SQL aggregates, never parsed from LLM output"

key-files:
  created:
    - src/lib/insight/kb-gap.ts
    - src/lib/insight/cluster-label-prompt.ts
    - src/lib/insight/narrative-prompt.ts
    - tests/unit/insight-prompts.test.ts
  modified: []

key-decisions:
  - "GAP_THRESHOLD reuse deferred to the orchestrator (06-06) — this plan only implements the pure scoreGap(nearest, gapThreshold) function; the 0.5 default constant lives with the caller per the plan's scope"

patterns-established:
  - "Pattern: worker-bundleable AI primitives under src/lib/insight/ use relative imports only (../db, ../rag/*) — no @/ aliases — so the same module works from both the Next.js app and the esbuild-bundled pg-boss worker"

requirements-completed: [AIDA-17]

# Metrics
duration: ~20min
completed: 2026-07-25
---

# Phase 06 Plan 04: KB-Gap Detector + Injection-Safe LLM Prompt Pairs Summary

**KB-gap coverage scoring via pgvector KNN against KbChunk, plus two schema-forced LLM prompt pairs (cluster labeling, period narrative) with structural anti-prompt-injection guarantees — the three AI-touching primitives the Plan 06 orchestrator will call through the existing `complete()` port.**

## Performance

- **Duration:** ~20 min (includes worktree bootstrap: fast-forward merge to pick up 06-01, `pnpm install`, `prisma generate`)
- **Tasks:** 3
- **Files modified:** 4 (3 created + 1 test file grown across tasks 1-2)

## Accomplishments
- `nearestKbChunk`/`scoreGap` (`src/lib/insight/kb-gap.ts`): org+embeddingModel-scoped pgvector `<=>` top-1 KNN against `KbChunk`/`KbArticle`, plus the pure `coverage = 1 - distance` boundary function (null nearest => always a gap; strict `<` at the threshold).
- `ClusterLabelsResultSchema`/`CLUSTER_LABEL_SYSTEM_PROMPT`/`buildClusterLabelPrompt` (`src/lib/insight/cluster-label-prompt.ts`): the labeling schema carries ONLY `clusterIndex`/`label`/`description` — no ticket-ID or membership field exists for the LLM to manipulate or exfiltrate (Pitfall 8); every excerpt is fenced via `fenceContent("ticket_excerpt", ex)` before entering the prompt.
- `InsightNarrativeSchema`/`INSIGHT_NARRATIVE_SYSTEM_PROMPT`/`buildNarrativePrompt` (`src/lib/insight/narrative-prompt.ts`): a single `summary` string forced by schema — the LLM receives only computed aggregate JSON (`<computed_stats>`) and can never invent or alter numbers shown in the UI.
- `tests/unit/insight-prompts.test.ts`: 5 passing cases — 4 `scoreGap` boundary cases (including the exact-threshold strict-`<` case) + 1 fence-escaping proof (an injected `</ticket_excerpt>` breakout attempt is neutralized to `[escaped-tag]`, and exactly one genuine closing fence survives per excerpt).

## Task Commits

Each task was committed atomically:

1. **Task 1: KB-gap KNN + scoreGap (kb-gap.ts) with a scoreGap unit test** - `c86e694` (feat)
2. **Task 2: Cluster-label prompt pair (cluster-label-prompt.ts) + fence-escaping test** - `20a3676` (feat)
3. **Task 3: Narrative prompt pair (narrative-prompt.ts)** - `5aace33` (feat)

_No TDD multi-commit sequences — Task 1 used `tdd="true"` but was implemented and tested together per the plan's VERBATIM code-example instructions (research-locked implementation, not exploratory RED/GREEN)._

## Files Created/Modified
- `src/lib/insight/kb-gap.ts` - `nearestKbChunk` (org+embeddingModel-filtered pgvector KNN, LIMIT 1) + `scoreGap` (pure coverage/gap boundary logic)
- `src/lib/insight/cluster-label-prompt.ts` - `ClusterLabelsResultSchema` (zod, no ID field) + `CLUSTER_LABEL_SYSTEM_PROMPT` + `buildClusterLabelPrompt` (fences every excerpt)
- `src/lib/insight/narrative-prompt.ts` - `InsightNarrativeSchema` (single `summary` field) + `INSIGHT_NARRATIVE_SYSTEM_PROMPT` + `buildNarrativePrompt` (stats-only, no untrusted text)
- `tests/unit/insight-prompts.test.ts` - `scoreGap` boundary suite (4 cases) + `buildClusterLabelPrompt` fence-escaping proof (1 case)

## Decisions Made
None beyond what's captured in `key-decisions` above — implemented VERBATIM from `06-RESEARCH.md` per the plan's explicit instruction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree was stale — fast-forwarded to `master` before any Phase 6 file existed here**
- **Found during:** Pre-Task-1 setup (files_to_read step)
- **Issue:** This agent's worktree branch (`worktree-agent-af9997efc0b91f56e`) was still at the Phase 5 completion commit (`3fe2e2d`) — it had neither the Phase 6 planning docs nor 06-01's `src/lib/insight/types.ts`/schema migration/`scopedDb` widening that this plan `depends_on`. `node_modules`, `.env`, and the generated Prisma client were also absent (fresh worktree, never bootstrapped).
- **Fix:** Confirmed `HEAD` was a strict ancestor of local `master` (`git merge-base --is-ancestor`, no divergent work at risk), then `git merge --ff-only master` to pick up 06-01 + the Phase 6 planning docs. Bootstrapped the worktree: `cp .env.example .env`, `pnpm install`, `pnpm prisma generate`.
- **Files modified:** None beyond the plan's own scope — this was a repo-state sync, not a code change.
- **Verification:** `tsc --noEmit` and the full unit test run both succeeded afterward; `git log` confirms `06-01`'s commits are now present on this branch.
- **Committed in:** N/A (fast-forward merge, no new commit created; `node_modules`/`.env`/generated client are gitignored, not committed)

**2. [Rule 3 - Blocking] Biome formatting fix in `cluster-label-prompt.ts`**
- **Found during:** Task 2 verification (`biome check`)
- **Issue:** The VERBATIM research code's multi-line `.map(...).join("\n")` chain for `examples` did not match this repo's Biome formatting rules (would auto-wrap to one line).
- **Fix:** Collapsed the chain to a single line to match Biome's expected formatting; no logic change.
- **Files modified:** `src/lib/insight/cluster-label-prompt.ts`
- **Verification:** `biome check` clean; `tsc --noEmit` clean; unit tests still pass (5/5).
- **Committed in:** `20a3676` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking - stale worktree, 1 blocking - formatting)
**Impact on plan:** Neither affected the plan's actual logic — both were environment/formatting corrections required to execute and verify the plan as written. No scope creep.

## Issues Encountered
- The `rtk` (Rust Token Killer) global PATH hook intercepted `pnpm exec vitest`/`pnpm vitest` and failed to resolve the binary ("Binary 'vitest' not found on PATH"). Worked around by invoking `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, and `./node_modules/.bin/biome` directly for all verification commands in this plan.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - these are pure library modules (KNN query function, pure scoring function, prompt builders) with no UI or data-wiring surface. No stub patterns apply.

## Next Phase Readiness
- All three exported surfaces (`nearestKbChunk`/`scoreGap`, `ClusterLabelsResultSchema`/`CLUSTER_LABEL_SYSTEM_PROMPT`/`buildClusterLabelPrompt`, `InsightNarrativeSchema`/`INSIGHT_NARRATIVE_SYSTEM_PROMPT`/`buildNarrativePrompt`) match the plan's `must_haves.artifacts` exactly and are ready for Plan 06 (insight-run orchestrator) to call through the existing `complete()` port.
- No blockers. Plan 06 must remember: citations/membership for `StoredKbGap`/`StoredCluster` are attached programmatically from the deterministic clustering output — never from the LLM's `ClusterLabelsResultSchema` response (which has no field for it).

---
*Phase: 06-aida-insight*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 4 created files found on disk; all 3 task commits (`c86e694`, `20a3676`, `5aace33`) found in `git log`.
