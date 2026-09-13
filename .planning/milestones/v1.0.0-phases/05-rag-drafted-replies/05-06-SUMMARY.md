---
phase: 05-rag-drafted-replies
plan: 06
subsystem: ui
tags: [nextjs, react-hook-form, zod, prisma, kb, rag]

# Dependency graph
requires:
  - phase: 05-rag-drafted-replies (05-01)
    provides: KbArticle/KbChunk models, KbEmbeddingStatus enum, scopedDb allowlist
  - phase: 05-rag-drafted-replies (05-03)
    provides: createKbArticle/updateKbArticle write path (chunk+embed post-commit)
provides:
  - /kb list, /kb/new, /kb/[id] authoring surface under the existing sidebar entry
  - Admin-gated createKbArticleAction/updateKbArticleAction Server Actions
  - KbEmbeddingStatusChip (PENDING/COMPLETED/FAILED, token-only)
  - KbArticleForm (react-hook-form + zod/v4, create + edit modes)
affects: [05-07 (DraftCard/citations), Phase 5 close-out, 05-04 retrieval (reads what admins write here)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin-gated Server Actions delegate 100% of chunk/embed logic to lib/kb/create-article (05-03) — actions.ts never touches lib/rag or Prisma directly"
    - "Page-level admin guard omitted; Server Actions are the enforcement boundary (SLA/Tags/Custom-Fields/Email precedent)"
    - "KbEmbeddingStatusChip mirrors triage-status-chip.tsx's exact shape: plain muted text for the in-progress state, Badge w/ token classes for terminal states"

key-files:
  created:
    - src/app/(app)/kb/actions.ts
    - src/components/kb/kb-embedding-status-chip.tsx
    - src/components/kb/kb-article-form.tsx
    - src/app/(app)/kb/new/page.tsx
    - src/app/(app)/kb/[id]/page.tsx
  modified:
    - src/app/(app)/kb/page.tsx

key-decisions:
  - "Worktree was stale (checked out at Phase-5-planning, before Waves 1/2 executed) — fast-forwarded onto master (5fcdfb5 -> 45ead6e) before any Task 1 work began; merge-base check confirmed a clean fast-forward with zero divergent local commits"
  - "KbEmbeddingStatusChip's PENDING case renders as plain muted text with a spinning Loader2 icon (no Badge), matching triage-status-chip.tsx's PENDING treatment exactly; COMPLETED/FAILED use Badge + success/destructive token families"
  - "kb-article-form.tsx imports the Server Actions directly from the sibling app/(app)/kb/actions.ts (cross-directory Client Component -> Server Action import), mirroring the established 02-09 ticket-meta-header.tsx precedent"

patterns-established:
  - "Pattern: KB authoring pages (list/new/edit) never call lib/kb or lib/rag directly — only through actions.ts, keeping the single-write-path discipline from 05-03 intact through the UI layer"

requirements-completed: [AIDA-15]

# Metrics
duration: 30min
completed: 2026-07-22
---

# Phase 5 Plan 06: KB Authoring Surface Summary

**Admin-facing `/kb` list + `/kb/new` + `/kb/[id]` pages with a live embedding-status chip, all writes delegating to the single 05-03 `createKbArticle`/`updateKbArticle` path.**

## Performance

- **Duration:** ~30 min (execution only, excludes worktree fast-forward/environment bootstrap)
- **Completed:** 2026-07-22
- **Tasks:** 2/2
- **Files modified:** 6 (5 created, 1 replaced)

## Accomplishments

- Turned the `/kb` sidebar stub (EmptyState-only) into a real, force-dynamic KB article list with a token-only embedding-status chip and the mandated halo+icon-box empty state for the zero-article case
- Built admin-gated `createKbArticleAction`/`updateKbArticleAction` Server Actions that delegate 100% of chunking/embedding/slug logic to 05-03's `createKbArticle`/`updateKbArticle` — zero duplicated write logic in the UI layer
- Built `KbArticleForm` (react-hook-form + zod/v4) covering both create (redirect to the new article) and edit (in-place refresh) flows, with a muted hint that saving re-embeds the article in the background
- `/kb/new` and `/kb/[id]` pages wired to the form, both `force-dynamic`, matching the SLA/Tags/Custom-Fields precedent of action-gated (not page-gated) authorization

## Task Commits

1. **Task 1: KB Server Actions + embedding status chip** - `7a465d3` (feat)
2. **Task 2: KB list, authoring form, and view/edit pages** - `b2942e5` (feat)

**Plan metadata:** (this commit) - docs: complete plan

## Files Created/Modified

- `src/app/(app)/kb/actions.ts` - `createKbArticleAction`/`updateKbArticleAction`, both `requireOrgAdmin()`-gated, delegating to `lib/kb/create-article`
- `src/components/kb/kb-embedding-status-chip.tsx` - token-only PENDING/COMPLETED/FAILED chip
- `src/components/kb/kb-article-form.tsx` - react-hook-form + zod/v4 create/edit form
- `src/app/(app)/kb/page.tsx` - replaced the EmptyState-only stub with a real `db.kbArticle.findMany` list
- `src/app/(app)/kb/new/page.tsx` - "New article" page rendering `KbArticleForm mode="create"`
- `src/app/(app)/kb/[id]/page.tsx` - view/edit page rendering title + `KbEmbeddingStatusChip` + `KbArticleForm mode="edit"`

## Decisions Made

- Worktree fast-forward: this plan's assigned worktree was checked out at the Phase 5 planning commit (`5fcdfb5`), before Waves 1 and 2 (05-01…05-04) were executed and merged to `master`. `git merge-base HEAD master` confirmed the worktree's HEAD was exactly master's merge-base (no divergent local work), so `git merge master --ff-only` cleanly fast-forwarded to `45ead6e` before any Task 1 work began. This is the same class of issue documented for 03-05's worktree in STATE.md.
- Ran `pnpm install` + `cp .env.example .env` + `pnpm exec prisma generate` after the fast-forward, per the established 02-02 fresh-worktree-bootstrap precedent (schema.prisma changed in the merged commits; the generated client needed regenerating before `tsc --noEmit` would pass).
- `KbEmbeddingStatusChip`'s PENDING state deliberately has no `Badge` wrapper (plain `text-muted-foreground` span + spinning `Loader2`), matching `triage-status-chip.tsx`'s PENDING treatment byte-for-byte in spirit — only the terminal COMPLETED/FAILED states use the Badge + success/destructive token classes.

## Deviations from Plan

None - plan executed exactly as written. The only unplanned action was the worktree fast-forward described above, which is environment setup (not a code deviation) required before any plan task could begin — no Rule 1-4 deviation applies since no plan-authored code was changed to accommodate it.

## Issues Encountered

- Worktree was stale relative to `master` (missing Waves 1 and 2 of Phase 5). Resolved via `git merge master --ff-only` (verified clean fast-forward, no conflicts, no divergent commits) before starting Task 1.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AIDA-15's admin-facing half ("author/import KB articles") is now fully code-complete end-to-end: authoring UI -> `createKbArticle`/`updateKbArticle` -> chunk+embed pipeline (05-03) -> retrieval (05-04). Per the established split-requirement precedent (02-08/03-01/04-01 etc.), AIDA-15 is not marked Validated in PROJECT.md by this plan alone — confirm with the Phase 5 close-out review that 05-04's retrieval-consumption side is also verified before flipping AIDA-15 to Validated.
- 05-07 (DraftCard/citations/Composer insert) can now be developed against real KB articles created through this UI rather than only seed data.
- No blockers for Wave 3 siblings (05-05, 05-07) — this plan touched only `src/app/(app)/kb/*` and `src/components/kb/*`, no shared files with either.

---
*Phase: 05-rag-drafted-replies*
*Completed: 2026-07-22*

## Self-Check: PASSED

All 7 claimed files found on disk (`src/app/(app)/kb/actions.ts`, `src/components/kb/kb-embedding-status-chip.tsx`, `src/components/kb/kb-article-form.tsx`, `src/app/(app)/kb/new/page.tsx`, `src/app/(app)/kb/[id]/page.tsx`, `src/app/(app)/kb/page.tsx`, this SUMMARY). Both task commits (`7a465d3`, `b2942e5`) found in `git log`.
