---
phase: 12-ticket-lifecycle
plan: 06
subsystem: tickets-ui
status: complete
tags: [relations, merge, picker, dialogs, e2e]
requires: ["12-02", "12-03", "12-04"]
provides:
  - "src/components/tickets/linked-tickets-row.tsx: LinkedTicketsRow, relationErrorMessage(code, { childNumber })"
  - "src/components/tickets/ticket-actions-menu.tsx: TicketActionsMenu, mergeUnavailableReason"
  - "src/components/tickets/ticket-picker.tsx: TicketPicker, pickerReason(row, purpose), meetsPickerMinimum"
  - "src/components/tickets/link-ticket-dialog.tsx: LinkTicketDialog"
  - "src/components/tickets/merge-ticket-dialog.tsx: MergeTicketDialog, mergeErrorMessage"
  - "TicketMetaHeader props relations, mergedSource, hasReceivedMerges, snoozeControl (slot for 12-07)"
  - "loadTicketDetailData returns relations and hasReceivedMerges"
affects: [12-07, 12-10]
tech-stack:
  added: []
  patterns:
    - "Dialog bodies mount per opening, so each opening starts clean"
    - "Picker stale-response guard keyed on the current trimmed query plus AbortController"
key-files:
  created:
    - src/components/tickets/linked-tickets-row.tsx
    - src/components/tickets/ticket-actions-menu.tsx
    - src/components/tickets/ticket-picker.tsx
    - src/components/tickets/link-ticket-dialog.tsx
    - src/components/tickets/merge-ticket-dialog.tsx
    - tests/e2e/ticket-relations.spec.ts
    - tests/e2e/ticket-merge.spec.ts
  modified:
    - src/lib/tickets/ticket-detail-data.ts
    - src/components/tickets/ticket-meta-header.tsx
    - src/app/(app)/tickets/[id]/page.tsx
decisions:
  - "Ineligible picker rows are marked in the client (pickerReason) because the 12-02 endpoint ignores purpose: link marks alreadyLinked; merge marks mergedSource first, then a different contact"
  - "Merge confirm step: focus goes to Back; after a rule refusal Merge tickets is disabled and Back is focused; after a rejected call Back and Merge tickets are disabled and Keep tickets separate is the way out"
  - "The Merge replaces link line quotes the chip label from this ticket's side (header relations passed to the menu)"
metrics:
  duration: "~40 min"
  completed: 2026-11-08
actuals:
  tokens: 14400
  tasks: 3
  commits: 3
plan_head_before: 175619015362a48bbfb0fb11a9e3b546626a63db
---

# Phase 12 Plan 06: Relations and merge UI Summary

This plan adds the agent UI for AIDA-52 and AIDA-53 on the ticket page. It covers the Linked tickets row (grouped chips, 8-chip overflow, a lock on the merge link, remove with a spinner and `aria-busy`), the "More ticket actions" menu (Merge is disabled with its reason), the shared ticket picker, the Link a ticket dialog, and the two-step merge dialog. Every call goes through the membership-checked 12-02 and 12-03 actions. Each refusal code maps to exactly one Copywriting row, and a rejected call shows the "outcome unknown" copy.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Linked tickets row, loader, tracer E2E | f0d4493 | typecheck 0; lint 0; E2E 1/1; the tracer gate re-ran the E2E end to end before Task 2 |
| 2 | Actions menu, picker, Link a ticket dialog | 0177830 | typecheck 0; lint 0; E2E ticket-relations 4/4 |
| 3 | Two-step merge dialog | 2761498 | typecheck 0; lint 0; E2E ticket-merge 3/3 |

## Verification (exit codes, read without a pipe)

- `pnpm typecheck`: 0. `pnpm lint` (whole repo): 0.
- `… pnpm test:e2e tests/e2e/ticket-relations.spec.ts`: 0, 4 passed. The cases: the tracer; A "is the parent of" B through the dialog, then B's row disabled with "Already linked" and "Link tickets" disabled; the three-ticket cycle (C child of B, B child of A, then A "is a child of" C) shows the cycle copy, the dialog stays open, and the CHILD_OF and RELATION_ADDED counts are unchanged; the picker's start and no-match lines.
- `… pnpm test:e2e tests/e2e/ticket-merge.spec.ts`: 0, 3 passed. The cases: a merge after confirmation lands on `/tickets/{T}` and shows the toast, S is CLOSED with `mergedIntoTicketId` T, and S's message is on T with `mergedFromTicketId` S; two contacts' tickets: the row is disabled with the different-customer reason, "Review merge" stays disabled, and the tickets, messages and relations snapshot is unchanged; a linked pair shows the "Merge replaces link" line.
- Regression `… pnpm test:e2e tests/e2e/reading-pane.spec.ts tests/e2e/keyboard.spec.ts`: 0, 22 passed.
- Acceptance greps: the forbidden-pattern count is 0 for all five components, `test(` counts are 4 and 3, and the required copy is present.
- `pgrep -f 'artisan test'` found nothing before each E2E run. No migration, no package, no env change.

## Deviations from Plan

1. **[Rule 3] `src/app/(app)/tickets/[id]/page.tsx` modified.** The page passes the new relations and merge flags into `TicketMetaHeader`. The file was not in `files_modified`.
2. **[Rule 2] Picker marking per purpose is done in the UI** (the orchestrator's note from 12-02). `pickerReason` disables rows with "Already linked" for link, and with "Already merged into another ticket" or the different-customer reason for merge. A target that has received merges stays eligible.
3. **`ticket-meta-header.tsx` was also touched in Task 3** to pass the link labels to the menu for the "Merge replaces link" line.
4. **Not specified by the UI-SPEC, decided here:** a failed remove whose call rejects shows the "Link outcome unknown" line in the row. The PARENT_EXISTS copy names the child: this ticket for "is a child of", the other ticket for "is the parent of". The link dialog also blocks closing while a link is pending.
5. **Focus on step 2:** "Back" takes focus when step 2 opens. The UI-SPEC says "the step's first element", and Back is the first control.
6. **Added a fourth relations case** for the picker's start and no-match lines.

## Open manual items (CONTEXT Human boundary, not claimed)

- Backstop: with a 255-character subject, the actions menu stays visible in the top bar at 1280px and the subject truncates.
- Backstop: a 255-character subject in a relation chip truncates at 200px with the tooltip, and the remove button stays visible at 1024px.
- Backstop: a 255-character subject truncates in a picker row with the status chip visible, and the cycle callout wraps at 360px.
- Backstop: two 255-character subjects in the merge confirmation and the source-has-merges callout fit 360px, with all three footer buttons visible.
- Visual, dark-mode and screen-reader review of the relations row, menu, picker and both dialogs. No visual or accessibility pass is claimed.
- The merge-refusal and rejected-call callouts are not covered by an E2E case. The server refusals are proven in 12-03 and 12-04.

## Known Stubs

`snoozeControl` is an empty slot in the header until 12-07 fills it. This is intentional and the plan asked for it.

## Threat model dispositions

- T-12-28: disabled rows are a convenience only, and the server refuses everything (12-02 and 12-03).
- T-12-29: all text is rendered as React text, with no `dangerouslySetInnerHTML` and no inline script.
- T-12-30: the merge runs only from step 2, through the destructive button. E2E case 1 covers it.

## Self-Check: PASSED

- FOUND: all 7 created files and 3 modified files. FOUND commits: f0d4493, 0177830, 2761498 (`git rev-list --count 1756190..HEAD` = 3 before this SUMMARY).
