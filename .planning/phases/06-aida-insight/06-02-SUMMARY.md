---
phase: 06-aida-insight
plan: 02
subsystem: ai
tags: [clustering, pgvector, embeddings, redaction, insight]

# Dependency graph
requires:
  - phase: 06-aida-insight (plan 01)
    provides: "InsightRun/TicketEmbedding/CsatResponse Prisma models, scopedDb DOMAIN_MODELS allowlist, src/lib/insight/types.ts persisted-shape contract"
provides:
  - "Pure deterministic leader-clustering math (l2Normalize, leaderCluster) — zero-import, worker-bundleable"
  - "buildTicketExcerpt(): redact-then-slice excerpt builder closing the embed() redaction gap (AIDA-20)"
  - "readPeriodTickets / readCachedEmbeddings / writeNewEmbeddings: org-scoped raw-SQL TicketEmbedding cache I/O"
affects: ["06-06 (insight-run orchestrator wires all three modules)", "06-03/06-04/06-05 (KB gap, volume drivers, SLA/CSAT plans that may reuse period-ticket patterns)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-match-wins (not best-match) greedy leader clustering with incremental normalized-sum centroid — O(n*k), fully deterministic"
    - "Redact-before-slice ordering for any ticket text reaching embed() (embed() itself never redacts, unlike complete())"

key-files:
  created:
    - src/lib/insight/cluster.ts
    - src/lib/insight/excerpt.ts
    - src/lib/insight/ticket-embeddings.ts
    - tests/unit/insight-cluster.test.ts
  modified: []

key-decisions:
  - "Implemented cluster.ts, excerpt.ts, and ticket-embeddings.ts verbatim from 06-RESEARCH.md's proven code blocks (per CONTEXT.md's LOCKED plan-style directive) — no algorithmic re-derivation needed at execution time."
  - "Task 1 was declared tdd=true but the plan already specifies the full implementation verbatim; followed the spirit of TDD by writing comprehensive tests covering every <behavior> bullet and verifying both test-pass and tsc-clean before committing, rather than a literal empty-red-then-green cycle (there was no failing-first phase to author against, since the implementation text IS the spec)."

patterns-established:
  - "Pattern: insight lib modules (src/lib/insight/*) use relative imports only, mirroring src/lib/rag/ — worker-bundleable via esbuild, no @/ aliases."

requirements-completed: []  # AIDA-17 is a phase-level requirement spanning all 7 plans; not marked complete until the orchestrator (06-06) + UI (06-07) land — see 06-01-SUMMARY.md precedent note.

# Metrics
duration: 20min
completed: 2026-07-25
---

# Phase 6 Plan 02: Clustering Core + Ticket-Embedding Cache Summary

Implemented the one genuinely-new algorithm in Phase 6 — deterministic greedy leader clustering (`l2Normalize`/`leaderCluster`, pure, zero imports) — plus the AIDA-20 redaction fix (`buildTicketExcerpt`, redact-then-slice) and the org-scoped raw-SQL `TicketEmbedding` cache I/O (`readPeriodTickets`/`readCachedEmbeddings`/`writeNewEmbeddings`), all worker-bundleable and unit-proven reproducible.

## Performance

- **Duration:** ~20 min (including a one-time worktree fast-forward + `pnpm install` + `prisma generate`, since this worktree was stale at Phase-5-completion and missing all of Phase 6's planning docs and Plan 01's schema)
- **Completed:** 2026-07-25
- **Tasks:** 2/2
- **Files modified:** 4 (3 created source files, 1 created test file)

## Accomplishments
- `src/lib/insight/cluster.ts`: pure, zero-import `l2Normalize` + `leaderCluster` — first-match-wins greedy leader clustering with an incrementally-updated normalized-sum centroid (O(n·k), no re-averaging of raw members).
- `src/lib/insight/excerpt.ts`: `buildTicketExcerpt` redacts the full ticket body via `redactSecrets()` BEFORE slicing to the char limit — closes the gap where `embed()` (unlike `complete()`) never redacts on its own.
- `src/lib/insight/ticket-embeddings.ts`: `readPeriodTickets` (org-scoped, first PUBLIC INBOUND message body per ticket, `createdAt ASC, id ASC`), `readCachedEmbeddings` (same ordering, JOINs `Ticket` for the period filter), `writeNewEmbeddings` (batched `embed()` calls + looped `ON CONFLICT ("ticketId","embeddingModel") DO NOTHING` insert inside a transaction — idempotent on pg-boss retry, mirrors the proven `kb-embed-article.ts` pattern).
- `tests/unit/insight-cluster.test.ts`: 7 passing assertions covering empty input, near-identical-vector collapse into one cluster, orthogonal-family split into two clusters, determinism (byte-identical `memberIds` across repeated calls), first-match-wins vs best-match, and the zero-vector `l2Normalize` guard.

## Task Commits

1. **Task 1: Pure leader-clustering math (cluster.ts) + unit test** - `d760b4a` (feat)
2. **Task 2: Redacted excerpt builder + raw-SQL embedding cache** - `7f39188` (feat)

_Note: Task 1 was declared `tdd="true"`, but per this phase's LOCKED plan-style directive the plan text already contains the full verbatim implementation (not a spec-only behavior description) — tests were written to cover every `<behavior>` bullet and both test-pass + `tsc --noEmit` were confirmed clean before the single feat commit, rather than a separate test-then-implementation commit pair._

## Files Created/Modified
- `src/lib/insight/cluster.ts` - Pure leader-clustering math: `l2Normalize`, `leaderCluster` (exported), zero imports
- `src/lib/insight/excerpt.ts` - `buildTicketExcerpt(subject, firstPublicInboundBody, charLimit)`, redact-then-slice
- `src/lib/insight/ticket-embeddings.ts` - `readPeriodTickets`, `readCachedEmbeddings`, `writeNewEmbeddings` (org-scoped raw SQL, relative imports only)
- `tests/unit/insight-cluster.test.ts` - 7 assertions proving determinism/threshold/first-match/zero-vector behavior

## Decisions Made
- Implemented all three files verbatim from `06-RESEARCH.md`'s proven code (Decision: "Plans MUST contain the actual formulas... executor implements from plan text alone" — CONTEXT.md LOCKED). No algorithmic re-derivation was needed or performed.
- Chose exact-degree trig fixtures (`Math.cos`/`Math.sin` of 0°/1°/2°/50° etc.) for the unit test rather than hand-rounded decimal literals, so the test asserts against runtime-computed values instead of manually-verified approximations — eliminates rounding-error risk in the test fixtures themselves.

## Deviations from Plan

None — plan executed exactly as written. One environmental prerequisite was required before any task could run: this worktree (`agent-aaea9a0d63c5e7d8a`) was checked out at Phase-5-completion (`3fe2e2d`), missing Phase 6's `06-CONTEXT.md`/`06-RESEARCH.md`/all `06-*-PLAN.md` files and Plan 01's schema/scopedDb/types.ts foundation this plan `depends_on: ["06-01"]`. Confirmed `3fe2e2d` is a strict ancestor of `master`'s tip (`4e593ef`) and fast-forward-merged (`git merge --ff-only`) before proceeding — this exact same-worktree-staleness pattern is a documented, recurring precedent (see STATE.md's `(03-05)` decision entry). `node_modules` also did not exist in this worktree; ran `cp .env.example .env && pnpm install && pnpm exec prisma generate` per the project's documented fresh-worktree bootstrap (02-02 precedent) before any verification command could run.

## Issues Encountered
- `pnpm exec <tool>` was intercepted by a shell-level `rtk` (Rust Token Killer) hook that failed to resolve `vitest`/`tsc`/`biome` via its own internal PATH even though `node_modules/.bin/` contained them — worked around by invoking each tool's entrypoint directly via `node node_modules/<pkg>/<bin>.mjs` (or `bin/tsc`, `bin/biome`), which succeeded identically. No project code or config was changed for this; purely a local invocation workaround.

## Next Phase Readiness
- `leaderCluster`/`l2Normalize`, `buildTicketExcerpt`, and the three `ticket-embeddings.ts` cache functions are ready to be imported and composed by Plan 06's `insight-run` orchestrator exactly as specified in this plan's `<key_links>` (relative imports, worker-bundleable).
- No blockers. `pnpm exec tsc --noEmit`, `biome check`, and the new vitest suite are all clean.

## Self-Check: PASSED

- FOUND: src/lib/insight/cluster.ts
- FOUND: src/lib/insight/excerpt.ts
- FOUND: src/lib/insight/ticket-embeddings.ts
- FOUND: tests/unit/insight-cluster.test.ts
- FOUND commit d760b4a (Task 1)
- FOUND commit 7f39188 (Task 2)

---
*Phase: 06-aida-insight*
*Completed: 2026-07-25*
