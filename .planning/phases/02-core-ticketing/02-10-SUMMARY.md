---
phase: 02-core-ticketing
plan: 10
subsystem: ui
tags: [nextjs, prisma, scopedDb, server-actions, contacts]

# Dependency graph
requires:
  - phase: 02-core-ticketing (02-06)
    provides: StatusChip, AssigneeAvatar and the rest of the tickets chip vocabulary (StatusChip consumed directly)
provides:
  - Searchable /contacts list (name/email/company, insensitive, ticket-count per contact)
  - /contacts/[id] detail page with full per-contact ticket history (AIDA-03)
  - Autosaving free-form Notes field on the contact detail page
  - Contacts nav destination in the sidebar + top-bar
  - Shared formatRelativeTime() helper (past-facing companion to formatDueDuration)
affects: [02-08 (inbox — may want to link ticket rows to /contacts/[id]), 02-09 (reading pane — contact name could deep-link here), 02-11 (public intake — contacts created here become browsable via this UI)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side debounced search synced to the URL query string via router.replace (no server round-trip until debounce settles) — first use of this pattern in the app, reusable for the inbox's ticket search (02-08)"
    - "Notes-field autosave-on-blur with a useRef 'last saved value' guard (avoids redundant writes when blurring without edits, and after a successful save)"

key-files:
  created:
    - src/app/(app)/contacts/page.tsx
    - src/app/(app)/contacts/contact-search.tsx
    - src/app/(app)/contacts/[id]/page.tsx
    - src/app/(app)/contacts/[id]/notes-form.tsx
    - src/app/(app)/contacts/[id]/actions.ts
    - src/lib/format-relative-time.ts
  modified:
    - src/components/sidebar.tsx
    - src/components/top-bar.tsx

key-decisions:
  - "Contact detail 404 (not-found) rendered as an EmptyState (Users icon, 'Contact not found') rather than Next.js notFound() — matches the plan's stated 'If not found → EmptyState' instruction and keeps a consistent in-app empty-state visual language instead of the framework's default 404 page."
  - "Added src/lib/format-relative-time.ts as a new shared utility (not in the plan's files_modified list) — needed for 'last-activity' (contacts list) and ticket-history row timestamps; no past-facing relative-time formatter existed in the codebase (only the future-facing formatDueDuration for SLA due chips)."

requirements-completed: [AIDA-03]

# Metrics
duration: ~20min
completed: 2026-07-02
---

# Phase 2 Plan 10: Contacts (list, detail, ticket history, notes) Summary

**Searchable /contacts list + /contacts/[id] detail page showing full per-contact ticket history and an autosaving free-form Notes field, wired into the sidebar/top-bar nav — completes AIDA-03.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-02T01:34:00Z (approx, worktree sync + install)
- **Completed:** 2026-07-02T01:58:45Z
- **Tasks:** 2 completed
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments
- Contacts is now a first-class sidebar destination (between Tickets and Knowledge Base), with a matching top-bar page title.
- `/contacts` is a searchable, org-scoped list (name/email/company, case-insensitive) showing avatar, email, company, ticket count, and last-activity — reusing the exact query shape specified in the plan's `<interfaces>` block.
- `/contacts/[id]` shows a header card (avatar, email/phone/company, editable Notes) plus every ticket that contact has ever opened, ordered newest-first, each row rendering the shared `StatusChip` component from plan 06.
- Notes autosave on blur via a Server Action (`saveContactNotes`), with a "Saved" affordance and error toast on failure; a `useRef`-tracked last-saved value avoids redundant writes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Contacts list + search + nav integration** - `7283537` (feat)
2. **Task 2: Contact detail + ticket history + Notes autosave** - `eea4ee4` (feat)

**Deviation fix:** `15ecfe1` (style — biome formatting, see Deviations below)

**Plan metadata:** _pending this commit_

## Files Created/Modified
- `src/app/(app)/contacts/page.tsx` - Server Component: org-scoped searchable contacts list, `_count.tickets`, empty state
- `src/app/(app)/contacts/contact-search.tsx` - Client search input, debounced `router.replace(?q=)`
- `src/app/(app)/contacts/[id]/page.tsx` - Server Component: contact header card + full ticket history (StatusChip per row)
- `src/app/(app)/contacts/[id]/notes-form.tsx` - Client Notes textarea, autosave-on-blur
- `src/app/(app)/contacts/[id]/actions.ts` - `saveContactNotes` Server Action (getScopedDb + revalidatePath)
- `src/lib/format-relative-time.ts` - Shared past-facing relative-time formatter ("2h ago", "3d ago")
- `src/components/sidebar.tsx` - Added Contacts nav item (Users icon) between Tickets and Knowledge Base
- `src/components/top-bar.tsx` - Added `"/contacts": "Contacts"` page title

## Decisions Made
- Contact-not-found renders the shared `EmptyState` component (not a framework 404) — consistent with the plan's explicit "If not found → EmptyState" instruction and the rest of the app's empty-state visual language.
- Added a new shared `formatRelativeTime()` utility rather than duplicating inline formatting logic in both the list and detail pages, or writing a one-off local function — it is the natural past-facing counterpart to `formatDueDuration` and is positioned for reuse by the inbox (02-08) and reading pane (02-09), which also need relative timestamps on ticket-list rows and thread messages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `src/lib/format-relative-time.ts` (file not in plan's `files_modified` list)**
- **Found during:** Task 1 (Contacts list — "last-activity timestamp right-aligned" requirement) and Task 2 (ticket-history row timestamps)
- **Issue:** The plan's UI-SPEC requires relative timestamps on both the contacts list and the per-contact ticket-history rows, but no past-facing relative-time formatter existed in the codebase (`format-duration.ts` only handles future-facing SLA due durations).
- **Fix:** Added a small, self-contained `formatRelativeTime()` helper (just now/Nm/Nh/Nd/Nmo/Ny ago), following the exact same coarse-grained, no-seconds-precision style as the existing `formatDueDuration`.
- **Files modified:** `src/lib/format-relative-time.ts` (new), consumed by `src/app/(app)/contacts/page.tsx` and `src/app/(app)/contacts/[id]/page.tsx`
- **Verification:** `pnpm exec tsc --noEmit` clean; `pnpm run build` succeeds; visually inspected the formatting logic by hand-tracing minute/hour/day boundaries.
- **Committed in:** `7283537` (Task 1 commit)

**2. [Rule 1 - Bug/Style] Fixed biome formatter violations in newly authored files**
- **Found during:** Post-task lint pass (not part of the plan's stated verification, run as a CLAUDE.md quality-gate check since the project uses Biome)
- **Issue:** `biome check` flagged 3 of the newly created files for JSX that should collapse onto a single line (`<p>...</p>` split across lines where it fit within the line-width budget) — a real formatting delta from the project's Biome config, not a CRLF/line-ending artifact.
- **Fix:** Ran `pnpm exec biome check --write` scoped to only the newly authored `contacts/**` files (did not touch `sidebar.tsx`/`top-bar.tsx`, which have a separate, already-documented, pre-existing repo-wide CRLF line-ending mismatch — see `.planning/phases/02-core-ticketing/deferred-items.md`, logged during 02-05, out of scope to fix here).
- **Files modified:** `src/app/(app)/contacts/page.tsx`, `src/app/(app)/contacts/[id]/page.tsx`, `src/app/(app)/contacts/[id]/actions.ts`
- **Verification:** `biome check` clean on all touched files after the fix; `pnpm exec tsc --noEmit` re-confirmed clean.
- **Committed in:** `15ecfe1` (separate style commit, after both task commits)

---

**Total deviations:** 2 auto-fixed (1 missing utility, 1 style/formatting)
**Impact on plan:** Both auto-fixes are necessary for correctness/consistency (a working relative-timestamp UI; code that passes the project's configured formatter). No scope creep — no architectural changes, no new dependencies.

## Issues Encountered
- The worktree was several commits behind `master` (Waves 1+2, plans 02-01..02-07, had merged since this worktree was created). Fast-forwarded (`git merge --ff-only master`, clean fast-forward, no conflicts), then ran `pnpm install` and `pnpm prisma generate` (with a placeholder `DATABASE_URL` env var — no live Postgres needed for `generate`/`tsc`/`next build`) to bring the generated Prisma client and dependencies in sync with the newly-merged Phase-2 schema/components, per the plan's setup note.
- Pre-existing repo-wide CRLF/LF formatter mismatch (documented in `deferred-items.md` from 02-05) also flagged `sidebar.tsx`/`top-bar.tsx` as needing full-file reformatting after this plan's one-line edits to each. Left as-is (out of scope per SCOPE BOUNDARY — not caused by this plan's changes, and mass-reformatting would produce an unrelated, noisy diff).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- AIDA-03 is now fully satisfied end-to-end: contacts are auto-created/linked during intake (02-03's `createTicket`), and are now fully browsable (this plan) with searchable list, full ticket history, and persistent notes.
- `/contacts/[id]` currently links ticket-history rows to `/tickets/[id]`, which does not exist yet — this is expected and will resolve once 02-08 (inbox list) and 02-09 (reading pane) land later in Wave 3/4; no broken-link risk in the interim since there are no tickets to click through to without those plans (or 02-11's public intake) also being live.
- `formatRelativeTime()` is now available for 02-08 (ticket-list row timestamps) and 02-09 (thread message timestamps) to reuse directly rather than reimplementing.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 8 created/modified files found on disk; all 3 commits (`7283537`, `eea4ee4`, `15ecfe1`) found in git history.
