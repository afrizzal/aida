---
phase: 06-aida-insight
plan: 07
subsystem: ui
tags: [nextjs, server-actions, pg-boss, design-system, insight-analytics, tailwind]

# Dependency graph
requires:
  - phase: 06-aida-insight (06-01)
    provides: InsightRun schema + shared src/lib/insight/types.ts contract (StoredCluster/StoredKbGap/VolumeDrivers/SlaCsatSummary/StoredNarrative)
  - phase: 06-aida-insight (06-06)
    provides: runInsight orchestrator + insight-run pg-boss queue registered in both boss-client.ts and worker/index.ts
provides:
  - "/insights" route (page + Server Action + period tabs + generate button + 4 cards)
  - generateInsightRun Server Action (PENDING/RUNNING duplicate guard, on-demand enqueue, agents+admins)
  - Sidebar Insight nav entry
affects: [AIDA-17 (now fully code-complete end-to-end across the whole 06-01..06-07 chain)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Period-scoped URL searchParam state (PeriodTabs) mirroring FilterChipRow's updateParams/router.replace pattern — no new URL-state library"
    - "useTransition + Server Action + router.refresh with zero polling infra (GenerateButton mirrors ReembedAllButton/TriageStatusChip's plain-text in-progress convention)"
    - "CSS/Tailwind bar-row distributions (plain <div> track+fill, inline width %) — no chart library added, per LOCKED decision"
    - "AI-off degradation via null props: cards distinguish `null` (AI off / never ran) from `[]` (AI on, nothing reported) with distinct copy"

key-files:
  created:
    - src/app/(app)/insights/page.tsx
    - src/app/(app)/insights/actions.ts
    - src/app/(app)/insights/period-tabs.tsx
    - src/app/(app)/insights/generate-button.tsx
    - src/app/(app)/insights/recurring-issues-card.tsx
    - src/app/(app)/insights/kb-gaps-card.tsx
    - src/app/(app)/insights/volume-drivers-card.tsx
    - src/app/(app)/insights/sla-csat-card.tsx
  modified:
    - src/components/sidebar.tsx

key-decisions:
  - "generateInsightRun's create() call needed an explicit organizationId in the data object (Rule 3 blocking-issue fix) — scopedDb auto-injects it at runtime via $allOperations, but Prisma's generated InsightRunCreateInput still requires it at the type level, matching every other db.<model>.create() call site in this codebase (src/lib/rag/settings.ts, tickets/[id]/actions.ts, etc.). The 06-RESEARCH.md verbatim snippet omitted this field."
  - "Reused the existing src/components/empty-state.tsx component for the page-level halo empty-state instead of hand-rolling the §4.3 markup inline — it is already the exact §4.3 pattern (halo blur + icon box + heading/body), used verbatim by /tickets, /contacts/[id], and /kb."
  - "Card style follows DESIGN-SYSTEM.md §4.5's literal directive (<Card className=\"border-border/70 shadow-sm\">) plus an explicit p-5 for padding (Card's base component has no horizontal padding outside of CardContent) — first instance of this exact combination in the (app) route group; prior pages (contacts/[id], kb/[id]) used bare <Card className=\"p-6\"> without the border-border/70/shadow-sm overrides."
  - "This worktree was found stale (checked out at pre-Phase-6 commit 3fe2e2d, missing all of Waves 1-3's insight code) — fast-forward merged to master (0e5c1f5) before any task work began, mirroring the 03-05/06-03/06-06 precedent already documented in STATE.md. No divergent commits existed on the branch, so git merge --ff-only was safe."

requirements-completed: [AIDA-17]

# Metrics
duration: ~40min
completed: 2026-07-24
---

# Phase 6 Plan 07: /insights UI Summary

**The `/insights` page ships all four AIDA-17 analytics sections (recurring-issue clusters, KB gaps, volume drivers, SLA/CSAT + AI narrative) as token-only design-system cards, driven by a period-tabbed on-demand pg-boss trigger, with numbers always sourced from stored SQL aggregates and zero new chart-library dependency.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-24
- **Tasks:** 2/2 completed
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

- `src/app/(app)/insights/actions.ts`: `generateInsightRun` Server Action — app-side PENDING/RUNNING duplicate guard (`findFirst` auto-scoped by `scopedDb`), creates the `InsightRun` row with the standard `InsightRunParams` defaults, enqueues `getBoss().send("insight-run", { insightRunId })`, marks the row `FAILED` on enqueue failure, `revalidatePath("/insights")`. No `requireOrgAdmin` gate — agents and admins both trigger runs (grep-confirmed absent).
- `src/app/(app)/insights/page.tsx`: `force-dynamic` Server Component. Parses/clamps the `period` searchParam to 7/30/90 (default 30), reads the latest run (for the "Generating…" indicator) and the latest COMPLETED run (for rendering) per `periodDays`, casts each `InsightRun` Json column back to its `src/lib/insight/types.ts` shape (`as unknown as`, Pitfall 5), and renders the shared `EmptyState` component (§4.3 halo + icon box) when no COMPLETED run exists yet.
- `period-tabs.tsx` / `generate-button.tsx`: period pills write the `period` URL searchParam via `router.replace` (mirrors `FilterChipRow`'s pattern); the generate button uses `useTransition` + `router.refresh()` with **no polling** — shows plain-text "Generating…" while a PENDING/RUNNING row exists or the transition is pending, and toasts "Insights are already generating…" on the guard hit.
- Four Server Component cards (`recurring-issues-card.tsx`, `kb-gaps-card.tsx`, `volume-drivers-card.tsx`, `sla-csat-card.tsx`): all token-only, explicit `text-[Npx]` typography, cited `/tickets/{ticketId}` and `/kb/{articleId}` links, CSS/Tailwind `<div>` bar rows (no chart library) for volume-driver and CSAT distributions, distinct `null` (AI-off) vs `[]`/empty (AI-on, nothing reported) messaging for the two AI-dependent cards, the explicit "No KB articles exist yet — every recurring theme is a gap." copy for `coverage === null`, and a separately labeled "AI summary" panel in the SLA/CSAT card whose numbers are always read from `data`, never from `narrative`.
- `src/components/sidebar.tsx`: added the `Lightbulb`-icon "Insight" nav item between Knowledge Base and Settings.

## Task Commits

Each task was committed atomically:

1. **Task 1: Page shell + generate action + period tabs + generate button + sidebar nav** - `7fb00b1` (feat)
2. **Task 2: The four section cards (token-only, cited links, CSS bar rows)** - `526d067` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/app/(app)/insights/actions.ts` - `generateInsightRun` Server Action (PENDING/RUNNING guard + pg-boss enqueue)
- `src/app/(app)/insights/page.tsx` - `/insights` Server Component: period parsing, latest/COMPLETED run reads, empty-state, 4-card grid
- `src/app/(app)/insights/period-tabs.tsx` - 7/30/90-day URL-searchParam pill selector (Client Component)
- `src/app/(app)/insights/generate-button.tsx` - "Generate insights" trigger (useTransition, no polling)
- `src/app/(app)/insights/recurring-issues-card.tsx` - Recurring Issues section card
- `src/app/(app)/insights/kb-gaps-card.tsx` - Knowledge-Base Gaps section card
- `src/app/(app)/insights/volume-drivers-card.tsx` - Volume Drivers section card (SQL-only, renders with AI off)
- `src/app/(app)/insights/sla-csat-card.tsx` - SLA & CSAT section card + AI narrative panel
- `src/components/sidebar.tsx` - added the `/insights` nav item (`Lightbulb` icon)

## Decisions Made

See `key-decisions` in the frontmatter above for full rationale. Summary: (1) added an explicit `organizationId` to the `generateInsightRun` create-call data object — a type-level requirement the research snippet's verbatim code omitted; (2) reused the existing `EmptyState` component rather than re-implementing the halo pattern inline; (3) followed DESIGN-SYSTEM.md §4.5's literal `<Card className="border-border/70 shadow-sm">` directive plus explicit `p-5` padding; (4) fast-forward merged this plan's stale worktree to master before starting (mirrors 03-05/06-03/06-06 precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `organizationId` to `generateInsightRun`'s create() call**
- **Found during:** Task 1 (page shell + generate action), first `tsc --noEmit` run
- **Issue:** The plan's verbatim `generateInsightRun` code (copied from 06-RESEARCH.md lines 665-721) omitted `organizationId` from the `db.insightRun.create({ data: {...} })` call. `scopedDb`'s `$allOperations` extension injects it at runtime, but Prisma's generated `InsightRunCreateInput` type still requires it at the call site — every other `create()` call in the codebase (e.g. `src/lib/rag/settings.ts`, `tickets/[id]/actions.ts`) explicitly passes it for the same reason. Without the fix, `tsc --noEmit` failed with `TS2322: Property 'organization' is missing`.
- **Fix:** Destructured `orgId` from `getScopedDb()` and added `organizationId: orgId` to the `create` call's `data` object, with an inline comment explaining why it's needed despite scopedDb's runtime injection.
- **Files modified:** `src/app/(app)/insights/actions.ts`
- **Verification:** `pnpm exec tsc --noEmit` exits 0; `pnpm run build` succeeds.
- **Committed in:** `7fb00b1` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary type-correctness fix with an exact precedent already established elsewhere in the codebase. No scope creep.

## Issues Encountered

- This plan's assigned worktree (`agent-abe81ba4827888d5c`) was stale, checked out at commit `3fe2e2d` (pre-Phase-6, missing all of Waves 1-3's insight code and phase docs — same class of issue as 06-01/06-03/06-06). Resolved by fast-forward merging to `master` (`0e5c1f5`) before starting Task 1.
- Fresh worktree had no `node_modules`, `.env`, or generated Prisma client — bootstrapped via `cp .env.example .env`, `pnpm install`, and `pnpm prisma generate` before any typecheck/build could run (mirrors the documented 02-02/06-06 fresh-worktree-bootstrap precedent).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full AIDA-17 chain (06-01 through 06-07) is now code-complete end-to-end: schema/types -> clustering math -> SQL aggregates -> KB-gap KNN + LLM prompts -> CSAT capture -> insight-run orchestrator + pg-boss wiring -> the `/insights` UI. `pnpm exec tsc --noEmit` clean, `pnpm run build` succeeds (`/insights` registered as a dynamic route), `pnpm exec biome check` clean on every touched file.
- Design-system self-check (§9): token-only confirmed (grep found zero `#hex`/`oklch(` literals), explicit `text-[Npx]` throughout (grep found zero `text-lg`/`text-xl`), halo empty-state present (`EmptyState` reused), sidebar uses the standard `{ href, label, icon }` nav-item shape, no chart-library import (grep found zero `recharts`/`chart.js`/`d3`), `force-dynamic` present on the page.
- Numbers rendered in the SLA/CSAT card are confirmed sourced from `data` (the stored SQL aggregate), never parsed from `narrative.summary` — the AI narrative renders in a separately labeled panel.
- No blockers. This was the final plan of Phase 6 (aida-insight) — phase-level close-out verification (combined-suite run, phase-goal check, human sign-off) is the next step, not another plan.

---
*Phase: 06-aida-insight*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: src/app/(app)/insights/page.tsx
- FOUND: src/app/(app)/insights/actions.ts
- FOUND: src/app/(app)/insights/period-tabs.tsx
- FOUND: src/app/(app)/insights/generate-button.tsx
- FOUND: src/app/(app)/insights/recurring-issues-card.tsx
- FOUND: src/app/(app)/insights/kb-gaps-card.tsx
- FOUND: src/app/(app)/insights/volume-drivers-card.tsx
- FOUND: src/app/(app)/insights/sla-csat-card.tsx
- FOUND: src/components/sidebar.tsx (modified)
- FOUND commit: 7fb00b1
- FOUND commit: 526d067
