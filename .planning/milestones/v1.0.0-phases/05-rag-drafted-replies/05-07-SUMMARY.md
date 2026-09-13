---
phase: 05-rag-drafted-replies
plan: 07
subsystem: ui
tags: [react, nextjs, server-actions, rag, audit, human-in-the-loop]

# Dependency graph
requires:
  - phase: 05-rag-drafted-replies (05-04)
    provides: generateDraftReply Server Action, GenerateDraftResult/citationsResolved shape, DRAFT_GENERATED audit
provides:
  - AI Draft card (DraftCard) + citation list (DraftCitationList) rendering grounded/ungrounded draft states
  - TicketReplyArea client coordinator wiring Generate draft -> DraftCard -> Composer insert, KB-gated
  - Composer insertedText/onInsertedConsumed + fromDraft plumbing (existing manual-reply path untouched)
  - DRAFT_APPROVED audit event on draft-originated PUBLIC sends through the existing messages route
affects: [06-aida-insight, phase-5-close-out]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lifted-state draft hand-off: TicketReplyArea owns draft/insertedText state; Composer only consumes insertedText via a one-shot useEffect + ack callback, never a two-way binding"
    - "Human-approval gate closure: LLM/Server Action output can only ever reach the Composer's controlled textarea; the ONLY network write path to a customer is the existing POST /api/tickets/[id]/messages route, gated by an explicit Send click"

key-files:
  created:
    - src/components/tickets/draft-card.tsx
    - src/components/tickets/draft-citation-list.tsx
    - src/components/tickets/ticket-reply-area.tsx
  modified:
    - src/components/tickets/composer.tsx
    - src/app/(app)/tickets/[id]/page.tsx
    - src/app/api/tickets/[id]/messages/route.ts

key-decisions:
  - "Ungrounded draft state still offers Insert (of the honest NO_RELEVANT_CONTENT_MESSAGE) + Discard, never a dead-end — matches plan spec exactly"
  - "fromDraft flag is only sent (and only honored server-side) when mode === public — internal notes and manual replies are structurally unable to produce a DRAFT_APPROVED audit row"
  - "recordAuditEvent + resolveActiveProvider calls in the messages route are both wrapped in try/catch so an audit-write or provider-resolution failure can never block the send response reaching the agent"

patterns-established:
  - "DraftCard/DraftCitationList are pure presentational components (no data fetching) — any future draft-surfacing UI (e.g. a bulk-draft view) can reuse them against the same GenerateDraftResult shape"

requirements-completed: [AIDA-16]

# Metrics
duration: ~35min
completed: 2026-07-22
---

# Phase 5 Plan 07: Draft Card, Citations, and the Human-Approval Send Gate Summary

**Ticket-page "Generate draft" -> cited AI Draft card -> Insert-into-Composer -> explicit Send, closing AIDA-16 end-to-end with a DRAFT_APPROVED audit event linked to the sent message.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-22T
- **Tasks:** 3/3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Token-only `DraftCard` renders a grounded draft (`whitespace-pre-wrap`, never `dangerouslySetInnerHTML`) with inline `[N]` citations linking to `/kb/{articleId}`, or an explicit `--warning`-toned "no relevant sources found" state when retrieval found nothing — no citation list rendered in that branch, matching Success Criterion 4.
- `TicketReplyArea` coordinates the whole flow client-side: "Generate draft" (disabled + muted hint when the org has zero COMPLETED-embedding KB articles, Pitfall 9) calls the existing `generateDraftReply` Server Action (05-04), renders `DraftCard` on success, and lifts the chosen draft's markdown into the Composer via `insertedText`.
- `Composer` gained optional `insertedText`/`onInsertedConsumed` props (both optional, existing callers unaffected) — inserting a draft sets the body, forces `mode: "public"`, and marks the pending send `fromDraft`; sending still requires the agent to explicitly click Send Reply, which posts through the untouched `POST /api/tickets/[id]/messages` route.
- The messages route now reads a `fromDraft` flag and, only for `fromDraft && mode === "public"`, records a `DRAFT_APPROVED` audit event (best-effort provider/model resolution, non-blocking on failure) — closing the audit loop `DRAFT_GENERATED` (05-04) started.

## Task Commits

Each task was committed atomically:

1. **Task 1: DraftCard + DraftCitationList presentational components** - `c3c44b8` (feat)
2. **Task 2: TicketReplyArea wrapper + Composer insert/fromDraft plumbing + ticket page wiring** - `a5ba1b2` (feat)
3. **Task 3: DRAFT_APPROVED audit on draft-originated sends** - `6571536` (feat)

**Plan metadata:** (this commit) `docs(05-07): complete draft-card-and-approval-gate plan`

## Files Created/Modified

- `src/components/tickets/draft-citation-list.tsx` - Presentational `[N] -> /kb/{articleId}` citation list, renders nothing when empty
- `src/components/tickets/draft-card.tsx` - AI Draft card: grounded/ungrounded branches, Insert/Discard, no data fetching
- `src/components/tickets/ticket-reply-area.tsx` - Client coordinator: Generate draft button (KB-gated), draft state, Composer insert hand-off
- `src/components/tickets/composer.tsx` - `insertedText`/`onInsertedConsumed` props + `fromDraft` state/flag threaded into the POST FormData
- `src/app/(app)/tickets/[id]/page.tsx` - Computes `draftableKbCount` (COMPLETED-embedding `KbArticle` count), renders `TicketReplyArea` in place of the direct `Composer`
- `src/app/api/tickets/[id]/messages/route.ts` - Reads `fromDraft`, records `DRAFT_APPROVED` audit (best-effort, non-blocking) only for draft-originated PUBLIC sends

## Decisions Made

- Kept the Composer's own `border-t border-border p-4` wrapper as the sole visual separator below the new "Generate draft" section (no duplicate border added in `TicketReplyArea`) — see Deviations.
- Followed the plan's literal `/kb/${articleId}` link target even though the KB article detail page (`/kb/[id]`, plan 05-06) is being built concurrently in a sibling worktree and isn't present in this worktree yet — this is the documented cross-plan contract, not a broken link once 05-06 merges.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fast-forwarded this worktree onto `master` before starting**
- **Found during:** Initial file reads (Task setup)
- **Issue:** This worktree's branch was still at the Phase-5-planning commit (`5fcdfb5`) — it predated the Wave 1 (05-01/05-02) and Wave 2 (05-03/05-04) merges into `master`. `generateDraftReply`, `GenerateDraftResult`, the `KbArticle`/`KbChunk` models, and every other 05-04 dependency this plan requires did not exist in the worktree yet.
- **Fix:** `git merge master --ff-only` (verified `merge-base(HEAD, master) === HEAD` first, so this was a pure fast-forward, not a rewrite of any local work — this worktree had zero commits of its own at that point).
- **Files modified:** N/A (merge only; brought in 39 files from Waves 1-2)
- **Verification:** `git log` confirmed 05-01..05-04 commits now present; `generateDraftReply` grep-found in `actions.ts` afterward.
- **Committed in:** N/A (fast-forward, no new commit created)

**2. [Rule 3 - Blocking] Fresh worktree had no `node_modules`/`.env`/generated Prisma client**
- **Found during:** First verification attempt (Task 1)
- **Issue:** This worktree had never been bootstrapped — `pnpm exec tsc --noEmit` and `pnpm run build` were initially (incorrectly) run against the shared main checkout directory instead of this worktree, masking the missing-dependencies problem entirely. Once corrected to run from the actual worktree path, `node_modules`, `.env`, and `src/generated/prisma` were all absent.
- **Fix:** `cp .env.example .env`, `pnpm install`, `pnpm exec prisma generate` — mirrors the documented 02-02 "fresh worktree/clone bootstrap" precedent.
- **Files modified:** None tracked (`.env`/`node_modules`/generated client are all gitignored)
- **Verification:** `pnpm exec tsc --noEmit` and `pnpm run build` both clean afterward, run correctly from the worktree.
- **Committed in:** N/A (no trackable files changed)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking environment/dependency issues, not scope creep). No architectural or plan-logic deviations; all three tasks were implemented exactly as specified.

**Impact on plan:** Both fixes were prerequisites for being able to execute the plan at all in this parallel-worktree setup; zero impact on the plan's actual scope or design.

## Issues Encountered

- `pnpm exec biome check <path>` consistently reports `Lint: No issues found` for every file touched in this plan but exits with code 1 — a known RTK CLI proxy hook quirk on this project (documented in STATE.md's 04-04 Key Decision: the hook intercepts/rewrites `pnpm`-invoked commands). Confirmed via a control run against an unrelated pre-existing file (`src/lib/rag/embed.ts`, CRLF line-ending format diff, exit 1) and via direct-binary invocation (`node_modules/.bin/biome`) failing on Windows path resolution from git-bash entirely. Treated as environment noise, not a real lint failure — `pnpm test` (65/65 unit tests) and `pnpm run build` both passed cleanly as independent confirmation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AIDA-16 is now fully code-complete end-to-end: retrieval + grounded drafting (05-04) + cited UI + the absolute human-approval gate + DRAFT_APPROVED audit (this plan). Marked complete in REQUIREMENTS.md.
- The `/kb/${articleId}` citation links depend on plan 05-06's KB article detail page landing (concurrent sibling worktree, not yet merged as of this plan's execution) — no action needed here, just note for phase close-out UAT that citation links should be re-verified once 05-05/05-06 are merged.
- Phase 5 (rag-drafted-replies) is now 7/7 plans complete pending 05-05/05-06's own merges — ready for phase-level verify-work/UI-review/human sign-off once all three Wave 3 worktrees are merged.

## Self-Check: PASSED

- All 6 claimed files (3 created, 3 modified) verified present via `ls`.
- All 3 task commits (`c3c44b8`, `a5ba1b2`, `6571536`) verified present via `git log --oneline --all`.

---
*Phase: 05-rag-drafted-replies*
*Completed: 2026-07-22*
