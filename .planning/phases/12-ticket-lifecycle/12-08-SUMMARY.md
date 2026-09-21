---
phase: 12-ticket-lifecycle
plan: 08
subsystem: tickets-ui
status: complete
tags: [activity-feed, audit, snooze, filters, saved-views, ui]
requires: ["12-05", "12-06", "12-07"]
provides:
  - "src/lib/tickets/activity-feed.ts: buildActivityFeed(messages, events), FeedItem, referencedIds"
  - "src/lib/tickets/activity-copy.ts: ACTIVITY_COPY per TicketAuditAction, describeEvent, partsToText, marker constants"
  - "ActivityFeed and ActivityEventRow server components"
  - "loadTicketDetailData returns feed and feedReferences"
  - "Snoozed toggle in the inbox filter row; saved views store and show it"
affects: [ticket page, inbox filter row, save and edit view dialogs, list panel]
tech-stack:
  added: []
  patterns: ["Event copy as parts (text, ticket link, time) so the server row renders links and LocalDateTime"]
key-files:
  created:
    - src/lib/tickets/activity-feed.ts
    - src/lib/tickets/activity-copy.ts
    - src/components/tickets/activity-feed.tsx
    - src/components/tickets/activity-event-row.tsx
    - tests/unit/activity-feed.test.ts
    - tests/integration/activity-feed.test.ts
    - tests/e2e/activity-feed.spec.ts
  modified:
    - src/lib/tickets/ticket-detail-data.ts
    - src/app/(app)/tickets/[id]/page.tsx
    - src/app/(app)/tickets/filter-chip-row.tsx
    - src/app/(app)/tickets/save-view-dialog.tsx
    - src/app/(app)/tickets/ticket-list-panel.tsx
    - tests/e2e/snooze.spec.ts
decisions:
  - "Users in event text are named from the organization's current member roster that the loader already reads; tickets and tags are resolved through scopedDb. Anything unresolved renders as its marker."
  - "The event row's time title states the full time in UTC, because a server component has no viewer zone; snooze times inside the text use LocalDateTime."
metrics:
  duration: ~40min
  completed: 2026-11-08
plan_head_before: d2f291b0a897e54f1d7a2ef924d83d0abd7955d7
actuals:
  tokens: 15500
  tasks: 3
  commits: 3
---

# Phase 12 Plan 08: Activity feed and the Snoozed filter Summary

The ticket page now shows one activity feed (AIDA-55, D-18). It merges messages, including internal notes, with TicketAuditEvent rows, oldest first by (createdAt, kind, id), with messages before events on a tie. The loader reads it through scopedDb after the membership check. Each audit action has its own sentence. Actors are named only when they are current members of the organization. The inbox gains the Snoozed toggle (AIDA-54, D-16). It can be saved as a view, it shows in the view dialogs, and it has its own empty line.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | b751e96 | buildActivityFeed, loader feed read through scopedDb, the `ol aria-label="Ticket activity"` list replacing the thread, tracer E2E (message, status change, reply in order) |
| 2 | 24c8b20 | ACTIVITY_COPY and describeEvent, ActivityEventRow (icon, copy, ticket links, LocalDateTime, relative time), the empty line, 9 unit and 5 integration tests |
| 3 | 60bf124 | Snoozed toggle, the "Only snoozed tickets" summary row, the snoozed empty line, 3 snooze-filter E2E cases and the link/snooze/wake feed-order E2E |

## Verification (exit codes, read without a pipe)

- `pnpm typecheck`: 0 and `pnpm lint`: 0 after each task.
- Task 1: `… pnpm test:e2e tests/e2e/activity-feed.spec.ts tests/e2e/reading-pane.spec.ts`: 0, 4 passed. The tracer gate passed before Task 2.
- Task 2: `pnpm exec vitest run tests/unit/activity-feed.test.ts`: 0, 9 passed. `… pnpm test:integration tests/integration/activity-feed.test.ts`: 0, 5 passed. Re-run of the tracer E2E with the final copy: 0, 1 passed.
- Task 3: `… pnpm test:e2e tests/e2e/snooze.spec.ts tests/e2e/activity-feed.spec.ts tests/e2e/saved-views.spec.ts`: first run exit 1 (19 passed, 1 failed; real bug, see Deviations), second run 0, 20 passed.
- Regressions: `… pnpm test:e2e tests/e2e/reading-pane.spec.ts tests/e2e/inbox.spec.ts tests/e2e/saved-views.spec.ts tests/e2e/snooze.spec.ts`: 0, 27 passed.
- Acceptance greps pass. `grep -rln "activity-feed\|activity-copy" "src/app/(public)"` prints nothing.
- `pgrep -f 'artisan test'` found nothing before each Testcontainers or E2E run. No migration, no package, no env change, no push. The full integration suite and `test:egress` were not run (O-1).

## Deviations from Plan

1. **[Rule 1] The save and edit view dialogs dropped the snoozed field.** The dialog built its `filters` from view, statuses, tag, cf and q only, so a view saved with the toggle on reopened without it. The first Task 3 E2E run caught this. Fix: the dialog now passes `snoozed: true` when it is set.
2. **[Rule 1] List row links dropped `snoozed=1`.** `LIST_QUERY_KEYS` in ticket-list-panel.tsx did not include `snoozed`, so opening a ticket from the snoozed list sent the agent back to the default list. Added the key.
3. **Copy, mid-sentence marker.** In "assigned this ticket to {name}", an unknown or removed assignee renders as "a former member" (lower case), because it falls in the middle of a sentence. The actor at the start of a sentence stays "A former member". This needs a copy review.
4. **Event row time title in UTC.** UI-SPEC asks for the full local time in the `time` title. The row is a server component and does not know the viewer's zone, so the title reads "… UTC", the same as LocalDateTime's first render. Snooze deadlines inside the text use LocalDateTime and switch to the local zone after mount.
5. **Toggle URL write.** The toggle uses the filter row's existing `updateParams` helper (`snoozed=1` on, removed off), not `filtersToSearchParams`. The result is the same canonical parameter.
6. **E2E link step.** The feed-order E2E creates the link through the relations service (`addRelation`, as the agent), as ticket-merge.spec.ts does. The snooze goes through the UI, and the wake runs `snoozeWakeHandler` against a past deadline (D-22).
7. **Unknown or malformed rows.** A relation row with an unknown type, or a SNOOZED row without a valid time, falls back to the "other" sentence and does not throw.

## TDD Gate Compliance

Task 2 is `tdd="true"`. As in 12-01 to 12-07, the tests and the implementation went into one commit (24c8b20). No separate RED run was recorded.

## Open manual items (not claimed)

- Backstop: with Status, Tag, Custom field and Snoozed all active, the filter row's second row wraps inside the 360px list panel and the save-view button stays reachable.
- Backstop: a ticket with 500 events and 200 messages renders the full feed in the scrolling pane without layout breakage, and the composer stays pinned below it.
- Backstop: an event row naming a 255-character member name wraps centered inside the reading pane at a 1024px window without horizontal scroll.
- Visual, dark-mode and screen-reader review of the feed rows, the empty line and the Snoozed toggle. No visual or accessibility pass is claimed.

## Known Stubs

None.

## Threat model dispositions

- T-12-34: audit rows are read through scopedDb after membership. The integration test shows that an org B row with the same ticketId is absent.
- T-12-35: names come only from the organization's member roster. The integration test covers an org B actor and a removed member, and checks that the outsider's name is not in the references.
- T-12-36: no `(public)` import (grep empty).
- T-12-37: accepted. There is no paging, and the 500-event backstop stays open.

## Self-Check: PASSED

- FOUND: 7 created and 6 modified files. FOUND commits b751e96, 24c8b20 and 60bf124 (`git rev-list --count d2f291b..HEAD` = 3 before this SUMMARY).
