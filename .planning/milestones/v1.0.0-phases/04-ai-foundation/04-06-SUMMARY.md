---
phase: 04-ai-foundation
plan: 06
subsystem: ui
tags: [triage, audit-log, ticket-detail, next.js, prisma, shadcn]

# Dependency graph
requires:
  - phase: 04-ai-foundation
    plan: 05
    provides: "rerunTriage(ticketId) Server Action, live ticket.triageStatus/triageCategory/triageSentiment/triageLanguage columns"
  - phase: 04-ai-foundation
    plan: 01
    provides: "AuditEvent model (org-scoped, insert-only, no ticket FK) + TriageCategory/TriageSentiment/TriageStatus enums"
provides:
  - "setTriageCategory / setTriageSentiment / setTriageLanguage override Server Actions (plain field writes, no SLA recompute)"
  - "TriageCategoryChip / TriageSentimentChip presentational Badges (token-only)"
  - "TriageStatusChip client control: Triaging.../Triage failed+Re-run/Re-run AI triage"
  - "Triage cluster + edit dropdowns/popover wired into TicketMetaHeader's second meta row"
  - "AiActivitySection — read-only <details> log of AuditEvent triage runs on the ticket detail page"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Triage override dropdowns mirror the existing PriorityChip DropdownMenu shape exactly
      (button trigger + DropdownMenuRadioGroup); language uses a Popover+Input following the
      existing 'Add tag' Popover shape already in ticket-meta-header.tsx."
    - "Native <details>/<summary> for a read-only, no-client-JS collapsible section — no
      Collapsible/Accordion component exists in this codebase yet, and none was needed here."
    - "Every triage UI piece (category/sentiment/language chip, status chip, AI Activity
      section) is rendered behind a `!== null` / `.length === 0` guard so a never-triaged
      ticket (AI off) shows zero triage chrome, matching D-10/D-19's intent."

key-files:
  created:
    - src/components/tickets/triage-category-chip.tsx
    - src/components/tickets/triage-sentiment-chip.tsx
    - src/components/tickets/triage-status-chip.tsx
    - src/components/tickets/ai-activity-section.tsx
  modified:
    - src/app/(app)/tickets/[id]/actions.ts
    - src/app/(app)/tickets/[id]/page.tsx
    - src/components/tickets/ticket-meta-header.tsx

key-decisions:
  - "Triage cluster (category/sentiment/language/status) placed in the header's existing
    second meta row, ahead of tags/custom fields — reuses the row's existing flex-wrap layout
    without a new header band."
  - "AI Activity section placed as a footer band directly under the message thread (border-t,
    muted text-[12px]) and above the Composer — deliberately lower visual weight than
    ThreadMessage/ThreadSystemEvent so it reads as metadata, not conversation content."
  - "AuditEvent.input is never referenced in ai-activity-section.tsx (D-13) — only
    provider/model/createdAt/output (defensively JSON-parsed) are surfaced."

requirements-completed: [AIDA-14, AIDA-19]

# Metrics
duration: ~20min
completed: 2026-07-07
---

# Phase 4 Plan 6: Triage UI Wiring Summary

**Wired the triage/audit backend (04-01…04-05) into the ticket-detail UI: agent-editable category/sentiment/language chips, a Re-run AI triage / Triage failed control in `TicketMetaHeader`, and a read-only "AI Activity" log of `AuditEvent` triage runs — no new backend behavior, pure UI wiring against existing tested contracts.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-07T14:18:00+07:00 (approx, after prior plan's completion commit)
- **Completed:** 2026-07-07T14:38:00+07:00 (approx, after full verification pass)
- **Tasks:** 3/3 completed
- **Files modified:** 3 modified, 4 created

## Accomplishments

- `src/app/(app)/tickets/[id]/actions.ts` gained `setTriageCategory` / `setTriageSentiment` / `setTriageLanguage` — thin scoped `db.ticket.update` + `revalidatePath` writes mirroring `assignTicket`, explicitly not touching SLA (only `changePriority` does that). `rerunTriage` and every prior export are unchanged.
- `TriageCategoryChip` (5-value enum, neutral token style) and `TriageSentimentChip` (success/neutral/destructive tokens) — presentational Badges mirroring `PriorityChip`'s exact shape.
- `TriageStatusChip` — a `"use client"` control mirroring `DeliveryFailedChip`'s `useState`/`router.refresh()` pattern: `PENDING` shows "Triaging…", `FAILED` shows the destructive "Triage failed" badge + a link "Re-run" button (D-10), `COMPLETED` shows a ghost "Re-run AI triage" button with the `Sparkles` brand icon (D-06), all calling the existing `rerunTriage` action from 04-05.
- `TicketMetaHeader` extended: `TicketMetaHeaderTicket` now carries the four triage fields; the second meta row renders a category dropdown, sentiment dropdown, language Popover+Input (reusing the existing "Add tag" Popover shape), and `TriageStatusChip` — each gated on `!== null` so a never-triaged ticket (AI off) shows no triage chrome at all. The pre-existing status/priority/assignee/SLA row and tag/custom-field rendering are untouched; priority remains edited by the existing `changePriority` action.
- `page.tsx` passes `triageCategory`/`triageSentiment`/`triageLanguage`/`triageStatus` into the `TicketMetaHeader` ticket prop (the existing `findFirst` already returns these scalars, no `include`/`select` change needed).
- `AiActivitySection` — a server-safe, read-only native `<details>`/`<summary>` component (no client JS) listing triage `AuditEvent` rows: provider/model, `formatRelativeTime`, and a defensively-parsed compact result string (`category · priority · sentiment · language`). Returns `null` on an empty list (no empty box on un-triaged tickets). Never references `AuditEvent.input` (D-13 — it may carry redacted ticket content).
- `page.tsx` added `db.auditEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: "desc" }, take: 20 })` to the existing `Promise.all`, and renders `<AiActivitySection>` between the message thread and the `Composer`.
- Full verification pass: `pnpm exec tsc --noEmit` clean, `pnpm run build` clean (same pre-existing, out-of-scope Turbopack NFT-trace warning documented since 02-11 — unrelated to this plan), `pnpm exec biome check` clean on all 7 touched files, `pnpm test` 54/54 unit tests passing (no regressions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Triage override Server Actions + presentational chips + status/re-run client control** - `ea9aa92` (feat)
2. **Task 2: Wire triage chips + edit dropdowns + language popover + status/re-run into TicketMetaHeader** - `6d1b84b` (feat)
3. **Task 3: Read-only "AI Activity" section reading AuditEvent** - `81fca56` (feat)

**Plan metadata:** (this commit) `docs(04-06): complete triage UI wiring plan`

## Files Created/Modified

- `src/app/(app)/tickets/[id]/actions.ts` - adds `setTriageCategory`/`setTriageSentiment`/`setTriageLanguage` override Server Actions
- `src/components/tickets/triage-category-chip.tsx` - presentational Badge for the 5-value `TriageCategory` enum
- `src/components/tickets/triage-sentiment-chip.tsx` - presentational Badge for `TriageSentiment` (success/neutral/destructive tokens)
- `src/components/tickets/triage-status-chip.tsx` - client control: Triaging…/Triage failed+Re-run/Re-run AI triage, calling `rerunTriage`
- `src/components/tickets/ticket-meta-header.tsx` - triage chips + edit dropdowns/popover + `TriageStatusChip` wired into the second meta row
- `src/components/tickets/ai-activity-section.tsx` - read-only `<details>` AI Activity log (provider/model/time/result), never renders `input`
- `src/app/(app)/tickets/[id]/page.tsx` - passes triage fields into the header prop, queries `AuditEvent`, renders `AiActivitySection`

## Decisions Made

See `key-decisions` in frontmatter. In summary: the triage cluster reuses the header's existing second meta row (no new row); AI Activity is a muted footer band under the thread (not a message-weight card); `AuditEvent.input` is structurally never surfaced in the new component.

## Deviations from Plan

None - plan executed exactly as written. All file paths, component shapes, and action signatures match the plan's literal snippets.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AIDA-14 ("agent can override triage") and AIDA-19 ("append-only audit log of AI actions") are now fully satisfied end-to-end (backend from 04-01…04-05 + this UI) and are marked Validated in PROJECT.md / checked off in REQUIREMENTS.md.
- Phase 4 (ai-foundation) is now 6/6 plans complete, all 5 waves done. Next: phase-level verify-work + UI-review (DESIGN-SYSTEM.md §9) + human sign-off (mirrors Phase 2/3's close-out) before Phase 4 is formally CLOSED.
- A ticket whose triage exhausted retries shows the destructive "Triage failed" badge + Re-run (mirrors `DeliveryFailedChip` exactly); a ticket created with AI off shows zero triage chrome and no AI Activity section — confirmed by the `!== null`/`.length === 0` guards throughout.

## Known Stubs

None - all rendered data is sourced from live, tested backend fields/tables (Ticket triage columns from 04-01, AuditEvent rows from 04-03's `recordAuditEvent()`). No hardcoded/mock data paths were introduced.

---
*Phase: 04-ai-foundation*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: src/app/(app)/tickets/[id]/actions.ts
- FOUND: src/components/tickets/triage-category-chip.tsx
- FOUND: src/components/tickets/triage-sentiment-chip.tsx
- FOUND: src/components/tickets/triage-status-chip.tsx
- FOUND: src/components/tickets/ticket-meta-header.tsx
- FOUND: src/components/tickets/ai-activity-section.tsx
- FOUND: src/app/(app)/tickets/[id]/page.tsx
- FOUND commit: ea9aa92
- FOUND commit: 6d1b84b
- FOUND commit: 81fca56
