---
phase: 02-core-ticketing
plan: 06
subsystem: ui
tags: [react, tailwind, design-tokens, badge, avatar, lucide]

# Dependency graph
requires:
  - phase: 02-core-ticketing (plan 02)
    provides: "--warning/--success design tokens, Badge warning/success variants, shadcn primitives"
provides:
  - "StatusChip (5-state), PriorityChip (4-level), SlaDueChip (3-state) token-mapped chips"
  - "TagChip + TagOverflowChip, AttachmentChip + formatBytes, AssigneeAvatar with Unassigned placeholder"
  - "formatDueDuration coarse relative-duration helper"
affects: [02-08 (inbox), 02-09 (reading pane), 02-10 (contacts), 02-11 (public intake), 02-12 (public status page)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chip components: Badge base + cn(baseSizeClasses, stateClasses) — twMerge dedupes overriding utility classes so state maps stay pure token strings"
    - "Unassigned/empty states rendered as dashed-outline placeholder divs (not Avatar) with native title tooltip"

key-files:
  created:
    - src/lib/tickets/format-duration.ts
    - src/components/tickets/status-chip.tsx
    - src/components/tickets/priority-chip.tsx
    - src/components/tickets/sla-due-chip.tsx
    - src/components/tickets/tag-chip.tsx
    - src/components/tickets/attachment-chip.tsx
    - src/components/tickets/assignee-avatar.tsx
  modified: []

key-decisions:
  - "SlaDueChip precedence is breached > at-risk > on-track, matching CONTEXT.md D-15 exactly"
  - "AssigneeAvatar reuses the sidebar's getInitials pattern (first letters of up to 2 words, uppercase) rather than a shared util, keeping the component self-contained per plan scope"

patterns-established:
  - "Ticket-domain chip vocabulary lives under src/components/tickets/*-chip.tsx; all future inbox/reading-pane/contacts/public UI must reuse these instead of re-deriving status/priority/SLA color logic"

requirements-completed: [AIDA-01, AIDA-06]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 02 Plan 06: Ticket Chip Vocabulary Summary

**Token-only StatusChip/PriorityChip/SlaDueChip/TagChip/AttachmentChip/AssigneeAvatar built exactly to the UI-SPEC contract, giving every future ticket screen one shared, design-token-driven visual vocabulary.**

## Performance

- **Duration:** ~25 min (excluding a mid-session workflow pause)
- **Started:** 2026-07-02T07:05:00+07:00 (worktree fast-forward + `pnpm install`/`prisma generate`)
- **Completed:** 2026-07-02T07:51:00+07:00
- **Tasks:** 2
- **Files modified:** 7 created

## Accomplishments
- Built the 5-state `StatusChip`, 4-level `PriorityChip`, and 3-state `SlaDueChip` (with correct breached > at-risk > on-track precedence) against the exact UI-SPEC class tables
- Built `formatDueDuration` coarse relative-duration helper (m/h/d, no seconds) used by `SlaDueChip`'s on-track label
- Built `TagChip` (+ `TagOverflowChip`), `AttachmentChip` (+ `formatBytes`), and `AssigneeAvatar` (with dashed "Unassigned" placeholder), all token-only and typed against the generated Prisma enums

## Task Commits

Each task was committed atomically:

1. **Task 1: StatusChip + PriorityChip + format-duration + SlaDueChip** - `16f1032` (feat)
2. **Task 2: TagChip + AttachmentChip + AssigneeAvatar** - `daa38bb` (feat)

**Plan metadata:** (this commit) `docs(02-06): complete ticket chip vocabulary plan`

## Files Created/Modified
- `src/lib/tickets/format-duration.ts` - coarse relative-duration formatter (m/h/d) for SLA due labels
- `src/components/tickets/status-chip.tsx` - 5-state ticket status chip (NEW/OPEN/PENDING/RESOLVED/CLOSED)
- `src/components/tickets/priority-chip.tsx` - 4-level priority chip (LOW/NORMAL/HIGH/URGENT)
- `src/components/tickets/sla-due-chip.tsx` - 3-state SLA chip (on-track/at-risk/overdue) with icon + hover timestamp
- `src/components/tickets/tag-chip.tsx` - removable tag chip + `TagOverflowChip` for "+N" overflow
- `src/components/tickets/attachment-chip.tsx` - attachment chip (link or removable-unsent variants) + `formatBytes`
- `src/components/tickets/assignee-avatar.tsx` - assignee avatar with initials fallback + dashed "Unassigned" placeholder

## Decisions Made
None beyond what's captured in `key-decisions` above — plan executed as specified.

## Deviations from Plan

None - plan executed exactly as written. The worktree branch was several waves behind `master` (Wave 1 plans 02-01/02-02 had merged since branch creation); per the orchestrator's note this was resolved with a fast-forward merge (`git merge --ff-only master`) plus `pnpm install` and `pnpm prisma generate` before starting Task 1 — this is environment setup, not a plan deviation.

## Issues Encountered
- Biome's `assist/source/organizeImports` and formatter flagged import ordering and single-line JSX return style on first save for 2 of the 7 files; resolved with `pnpm exec biome check --write` and re-verified clean before committing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

All 6 chip components + the duration helper are ready to compose into the shared inbox (`TicketListRow`, `TicketMetaHeader` — plan 08/09), contacts (compact `TicketListRow` variant — plan 10), and the public status page (plan 12). No blockers. `pnpm exec tsc --noEmit` and `biome check` are both clean on the full `src/components/tickets/` + `src/lib/tickets/` set, and no hardcoded hex/oklch literals exist in any of the 7 files.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 7 created files found on disk; both task commits (`16f1032`, `daa38bb`) found in git history.
