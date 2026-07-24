---
phase: 06-aida-insight
plan: 03
subsystem: database
tags: [prisma, raw-sql, postgres, insight, sla, csat]

# Dependency graph
requires:
  - phase: 06-01 (data foundation)
    provides: InsightRun/TicketEmbedding/CsatResponse models, scopedDb DOMAIN_MODELS widened, src/lib/insight/types.ts contract (VolumeDrivers/SlaCsatSummary shapes)
provides:
  - "computeVolumeDrivers(): org-scoped category/tag/company counts with previous-period deltas via raw SQL"
  - "computeSlaCsat(): SLA breach/at-risk/avg-duration + CSAT avg/distribution/count, org-scoped"
  - "periodMath()/zipDelta(): pure period-window and delta-composition helpers, unit-tested"
affects: [06-06 (narrative composer consumes VolumeDrivers/SlaCsatSummary), 06-07 (insights page renders these sections)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Raw $queryRaw with explicit organizationId filter for every cross-relation/groupBy aggregate (scopedDb does not auto-scope $queryRaw or groupBy)"
    - "scopedDb count() used for single-table SLA counts (count() IS in WHERE_SCOPED_OPERATIONS, safe to auto-scope)"
    - "Densify sparse GROUP BY results (CSAT distribution) to a fixed-length array in JS so the UI always renders all buckets"

key-files:
  created:
    - src/lib/insight/volume-drivers.ts
    - src/lib/insight/sla-csat.ts
    - tests/unit/insight-aggregates.test.ts
  modified: []

key-decisions:
  - "atRiskOnly computed as isAtRisk=true AND isBreached=false (breach implies at-risk per sla-flag.ts); breachRate uses isBreached alone (Pitfall 4)"
  - "CSAT distribution densified to exactly scores 1..5 so the UI always renders five bar rows even with zero responses"
  - "Duration averages (avgFirstResponseSeconds/avgResolutionSeconds) computed via two explicit raw-SQL variants rather than a dynamic column-name query, keeping SQL fully parameterized"

patterns-established:
  - "Pattern: any future org-scoped aggregate that needs groupBy or a cross-relation JOIN must use raw SQL with an explicit organizationId filter, never scopedDb.groupBy/aggregate"

requirements-completed: [AIDA-17]

# Metrics
duration: 15min
completed: 2026-07-24
---

# Phase 06 Plan 03: SQL Aggregates (Volume Drivers + SLA/CSAT) Summary

**Deterministic, LLM-free SQL analytics for AIDA Insight: volume drivers (category/tag/company counts with previous-period deltas) and SLA/CSAT summary, both entirely computed in org-scoped SQL with no LLM involvement.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-24T17:32:38Z
- **Completed:** 2026-07-24T17:47:54Z
- **Tasks:** 2
- **Files modified:** 3 (2 created source files, 1 created test file)

## Accomplishments
- `computeVolumeDrivers()` returns top categories/tags/companies for the current period, each with `previousCount`/`delta` vs. the equal-length prior period — all three counts implemented as raw SQL (category is single-table GROUP BY; tag and company require cross-relation JOINs that Prisma `groupBy` cannot express)
- `computeSlaCsat()` returns SLA breach/at-risk/avg-first-response/avg-resolution plus CSAT average score, response count, and a densified 1..5 score distribution — SLA counts via `scopedDb`'s auto-scoped `count()`, durations and CSAT via raw SQL with an explicit `organizationId` filter
- `periodMath()` and `zipDelta()` are pure (no DB), fully unit-tested: window contiguity (previous period ends exactly where current period starts) and delta computation including the missing-previous-key case (`previousCount: 0, delta: count`)
- Every raw aggregate in both files carries an explicit `"organizationId" = ${orgId}` filter — confirmed via grep (3 occurrences in volume-drivers.ts, 4 in sla-csat.ts) — closing the Pitfall 1 cross-tenant risk

## Task Commits

Each task was committed atomically:

1. **Task 1: Volume drivers — periodMath + raw-SQL counts + delta compose (volume-drivers.ts)** - `506afac` (feat)
2. **Task 2: SLA + CSAT aggregate (sla-csat.ts)** - `13a3253` (feat)

_Note: No plan-metadata commit yet — this SUMMARY/STATE/ROADMAP update is committed separately per the execution protocol._

## Files Created/Modified
- `src/lib/insight/volume-drivers.ts` - `periodMath`, `zipDelta`, `computeVolumeDrivers`; category/tag/company raw-SQL counts with previous-period delta composition
- `src/lib/insight/sla-csat.ts` - `computeSlaCsat`; SLA breach/at-risk/avg-duration + CSAT avg/distribution/count
- `tests/unit/insight-aggregates.test.ts` - unit coverage for `periodMath` window math and `zipDelta` delta/missing-key cases

## Decisions Made
- Followed the plan's verbatim SQL from 06-RESEARCH.md exactly for all three volume-driver count queries and the two SLA duration averages.
- Implemented `csatSummary` (left as a TODO in RESEARCH.md) as a single raw-SQL join of `CsatResponse` -> `Ticket` filtered by the ticket's `createdAt` (CsatResponse has no period column of its own), plus a second raw-SQL query for the per-score distribution, densified to scores 1..5 in JS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fast-forwarded stale worktree branch to pick up Plan 06-01's dependency**
- **Found during:** Task 1, initial `tsc --noEmit` — `Cannot find module './types'`
- **Issue:** This plan's assigned worktree branch was checked out at commit `3fe2e2d` (Phase 5 completion), before Phase 6 was even planned. Plan 06-03 `depends_on: ["06-01"]`, but 06-01's output (`src/lib/insight/types.ts`, the `InsightRun`/`TicketEmbedding`/`CsatResponse` schema migration, and the widened `scopedDb`/`recordAuditEvent`) had already landed on `master` (commits `4df3fa6`..`4e593ef`) but not on this worktree's branch.
- **Fix:** Confirmed the worktree branch had zero unique commits ahead of `master` (`git log master..worktree-branch` empty) and fast-forward-merged `master` into the worktree branch (`git merge --ff-only master`), then re-ran `pnpm exec prisma generate` to regenerate the Prisma client against the updated schema. This mirrors the documented 03-05 precedent for the same stale-worktree class of issue (see STATE.md decision "(03-05) This plan's assigned worktree was found checked out at Phase-2-completion...").
- **Files modified:** No source files — `git merge --ff-only` fast-forwarded the worktree branch (18 files from master: schema, scoped-db.ts, types.ts, migration, phase docs).
- **Verification:** `tsc --noEmit` and `vitest run tests/unit/insight-aggregates.test.ts` both passed clean after the merge + Prisma regenerate.
- **Committed in:** N/A (merge, not a new commit — fast-forward moved the branch pointer to the existing `4e593ef`)

**2. [Rule 3 - Blocking] Installed dependencies and generated Prisma client (fresh worktree bootstrap)**
- **Found during:** Task 1, first `vitest run` attempt
- **Issue:** This worktree had no `node_modules` and no generated Prisma client (both gitignored, standard fresh-worktree state per the 02-02 precedent).
- **Fix:** `pnpm install --prefer-offline`, `cp .env.example .env`, `pnpm exec prisma generate`.
- **Files modified:** None tracked (node_modules, generated client, .env are all gitignored).
- **Verification:** `vitest run`/`tsc --noEmit`/`biome check` all ran successfully afterward.
- **Committed in:** N/A (no trackable changes)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, both environment/dependency setup — no code logic deviated from the plan)
**Impact on plan:** No scope creep. Both fixes were required just to get the declared 06-01 dependency and a runnable toolchain in place; the plan's SQL and TypeScript logic were implemented exactly as specified.

## Issues Encountered
None beyond the two blocking auto-fixes documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `computeVolumeDrivers()` and `computeSlaCsat()` are ready for Plan 06-06 (narrative composer, which describes but never computes these numbers) and Plan 06-07 (insights page rendering).
- Both functions return the exact `VolumeDrivers`/`SlaCsatSummary` shapes from `src/lib/insight/types.ts` (Plan 01) — no shape drift.
- No blockers for the remaining Wave 2 plans (06-02 clustering math, 06-04 KB-gap KNN + LLM prompts, 06-05 CSAT capture) or Wave 3/4.

---
*Phase: 06-aida-insight*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: src/lib/insight/volume-drivers.ts
- FOUND: src/lib/insight/sla-csat.ts
- FOUND: tests/unit/insight-aggregates.test.ts
- FOUND: commit 506afac
- FOUND: commit 13a3253
