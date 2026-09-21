---
phase: 12-ticket-lifecycle
plan: 07
subsystem: tickets-ui
status: complete
tags: [merge, snooze, public-status, ui]
requires: ["12-03", "12-04", "12-05", "12-06"]
provides:
  - LocalDateTime (hydration-safe local time)
  - Merged-source banner and merged composer line
  - Moved-from marker on agent pages
  - Public "Combined" label and notice for a merged source
  - SnoozeControl (trigger, popover, presets, custom time, wake) and SnoozedChip in inbox rows
affects: [ticket page, inbox list, public status page]
tech-stack:
  added: []
  patterns: [UTC on server and first client render, local form after mount]
key-files:
  created:
    - src/components/tickets/local-date-time.tsx
    - src/components/tickets/merged-source-banner.tsx
    - src/components/tickets/snooze-control.tsx
    - tests/e2e/snooze.spec.ts
  modified:
    - src/app/(app)/tickets/[id]/page.tsx
    - src/lib/tickets/ticket-detail-data.ts
    - src/components/tickets/thread-message.tsx
    - src/app/(public)/status/[token]/page.tsx
    - src/app/(app)/tickets/ticket-list-row.tsx
    - tests/e2e/ticket-merge.spec.ts
decisions:
  - "The snooze control is mounted through the existing TicketMetaHeader snoozeControl slot from the page, so the status prop updates after revalidation; ticket-meta-header.tsx was not changed."
  - "A disabled snooze trigger uses aria-disabled with a tooltip, and its accessible name carries the reason."
metrics:
  duration: 8min (measured from first edit)
  completed: 2026-11-08
plan_head_before: bd7091b45d18913d7a5de09cc45bebda1b094fdc
actuals:
  tokens: 10850
  tasks: 3
  commits: 3
---

# Phase 12 Plan 07: Merge surfaces and snooze control Summary

A merged source now shows a banner and a line pointing to the target in place of the composer. Moved messages carry a "Moved from #N" marker on agent pages. The public page of a merged source shows the neutral "Combined" label and a fixed notice that says nothing about the target. Agents can snooze and wake a ticket from the top bar, using browser-zone presets or a custom time, and snoozed tickets carry a chip in inbox rows.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | b4b914c | LocalDateTime, MergedSourceBanner, MergedComposerLine, and the loader resolving `mergeTarget` through scopedDb. E2E: the source shows the banner, "Open #T" and the composer line with no textarea, and the target keeps its composer |
| 2 | e422081 | `movedFrom` prop on ThreadMessage, which only the agent page passes. The loader resolves `movedFromSources`. The public page shows "Combined" and the role=note notice. E2E with two tokens (D-09/D-22) |
| 3 | ed57978 | SnoozeControl and SnoozedChip, mounted in the header slot and shown in inbox rows. snooze.spec.ts has 5 cases, including review C9 |

## Verification (exit codes, read without a pipe)

- `pnpm typecheck`: 0. `pnpm lint`: 0. Both were run after each task.
- Task 1: `… pnpm test:e2e tests/e2e/ticket-merge.spec.ts`: 0, 4 passed.
- Task 2: `… pnpm test:e2e tests/e2e/ticket-merge.spec.ts tests/e2e/public-status.spec.ts`: 0, 8 passed. The first run exited 1 because of a test timing bug, described under Deviations.
- Task 3: `… pnpm test:e2e tests/e2e/snooze.spec.ts tests/e2e/inbox.spec.ts`: 0, 11 passed. The first run exited 1 because of a test bug, described under Deviations.
- Regressions: `… pnpm test:e2e tests/e2e/public-status.spec.ts tests/e2e/reading-pane.spec.ts tests/e2e/ticket-merge.spec.ts tests/e2e/keyboard.spec.ts`: 0, 30 passed.
- Acceptance greps all pass. The forbidden-pattern count is 0 in the three new components, `grep -c "<script"` on the public page is 0, `test(` appears 5 times in snooze.spec.ts, and the required copy is present.
- `pgrep -f 'artisan test'` found nothing before each E2E run. No migration, no package change, no env change, no push.

## Deviations from Plan

1. **[Rule 3] `mergeTarget` was added to the loader in Task 1.** Task 1 needs the target number, so I changed `ticket-detail-data.ts`, which the plan lists under Task 2, one task early.
2. **[Rule 2] New fallback copy for an unreadable target.** UI-SPEC defines no merged composer line for a target that cannot be read. I used "Replies go on the ticket this one was merged into." This copy is not in the Copywriting Contract and needs review.
3. **[Rule 1, test] The two-token E2E opened the status page before the reply was stored.** The reply text became visible before the POST finished. The spec now waits for the POST response and polls the database. The product was not changed.
4. **[Rule 1, test] Clicking an aria-disabled trigger.** Playwright treats `aria-disabled` as not actionable, so the spec uses `click({ force: true })` and then asserts that no dialog opened.
5. **Mount point.** The plan lists `ticket-meta-header.tsx` under Task 3, but that file is unchanged. The page passes SnoozeControl through the header's existing `snoozeControl` slot, which 12-06 built.
6. **Popover width.** The popover keeps `w-[320px]` and adds `max-w-[calc(100vw-16px)]` so it fits a 360px viewport (backstop truth). The time-zone line uses `break-words`.

## Open manual items (not claimed)

- Backstop: at a 1024px window, the merged banner and the composer line wrap with "Open #N" visible.
- Backstop: a long IANA zone name (America/Argentina/ComodRivadavia) wraps inside the 320px popover, and the popover stays inside a 360px viewport.
- Backstop: in an inbox row in the 360px list panel, the snoozed, status, priority and SLA chips wrap without overlapping the subject.
- Backstop: at 360px, the public merged notice wraps and the header keeps the truncated subject and "Combined" on one line.
- Backstop: in a browser set to Asia/Jakarta, Tomorrow 09:00 is stored as 02:00 UTC and shown as 09:00 in the chip, the popover and the feed, and the time-zone line names Asia/Jakarta.
- Visual, dark-mode and screen-reader review of the banner, the marker, the public notice, the popover and the chips. No visual or accessibility pass is claimed.
- The snooze refusal callouts (per server code) and the "Snooze outcome unknown" callout have no E2E case. The server refusals are proven in 12-05.

## Known Stubs

None.

## Threat model dispositions

- T-12-31: the public notice uses fixed copy and reads only `loadStatusPageData`. The two-token E2E asserts the page has no target number, subject, token link or `/tickets/` link.
- T-12-32: the client bounds are a convenience. The server bounds come from 12-05.
- T-12-33: no `(public)` route passes `movedFrom` (grep count 0). The E2E asserts that "Moved from" is absent on both status pages.

## Self-Check: PASSED

- FOUND: 4 created and 6 modified files. FOUND commits b4b914c, e422081 and ed57978 (`git rev-list --count bd7091b..HEAD` = 3 before this SUMMARY).
