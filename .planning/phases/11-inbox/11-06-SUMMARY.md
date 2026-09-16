---
phase: 11-inbox
plan: 06
subsystem: inbox, bulk-actions, ui
status: complete
tags: [bulk-actions, selection, checkbox, popover, command, e2e, audit, design-system]
requires:
  - "11-02: bulkUpdateTickets({ ticketIds, op }) and its error contract (codes returned, other errors rethrown)"
  - "11-05: ticket-list-panel layout with ListPanelFocus inside <aside id=\"ticket-list-panel\">, saved-view strip"
provides:
  - "TicketSelectionProvider, useTicketSelection (selectedIds, loadedIds, atCap, isSelected, toggle, clear, reportLoaded) and SelectableRow in src/app/(app)/tickets/ticket-selection.tsx"
  - "MAX_SELECTED_TICKETS = 100 (client cap, same as the service)"
  - "BulkActionBar in src/app/(app)/tickets/bulk-action-bar.tsx (Assign, Status, Priority, Add tag, Remove tag)"
  - "Row link id ticket-row-{ticketId} and the list query string on every row link (for 11-08)"
affects: [11-08]
tech-stack:
  added: []
  patterns:
    - "Selection keyed on the canonical filter string plus sv; reset by adjusting state during render, not in an effect"
    - "The panel reports its loaded ids through an effect in the bar; the provider prunes the selection to them"
    - "Failure callout tied to the selection it belongs to, so a different selection hides it without an effect"
key-files:
  created:
    - src/app/(app)/tickets/ticket-selection.tsx
    - src/app/(app)/tickets/bulk-action-bar.tsx
    - tests/e2e/bulk-actions.spec.ts
  modified:
    - src/app/(app)/tickets/layout.tsx
    - src/app/(app)/tickets/ticket-list-row.tsx
    - src/app/(app)/tickets/ticket-list-panel.tsx
decisions:
  - "The bar is a <section aria-label=\"Bulk actions\"> (implicit region role) instead of a div with role=region, which Biome's semantic-element rule prefers"
  - "Assign and Add tag always show their search input (their lists have no upper bound); Remove tag shows one above 8 entries; Status and Priority never do"
  - "Picker filtering matches only the option label (cmdk keywords), never the id used as the option value"
  - "The bar has mt-auto beside the spec's sticky bottom-0 so it sits at the panel bottom when the list is short"
  - "TicketListRow's open-ticket prop is renamed from selected to isOpen, so 'selected' means checked everywhere"
metrics:
  duration: "~14 min"
  completed: 2026-11-08
actuals:
  tokens: 10900
  tasks: 3
  commits: 3
plan_head_before: 35da1a33913b5382404be15137505a5bd609b8ee
---

# Phase 11 Plan 06: Row selection and the bulk action bar Summary

Inbox rows now have a checkbox beside the row link. A selection provider in `tickets/layout.tsx` keeps the selection across `/tickets` and `/tickets/[id]` and clears it when a filter or `sv` changes. A bulk bar at the bottom of the list panel applies Assign, Status, Priority, Add tag or Remove tag to exactly the checked tickets through `bulkUpdateTickets`. It has a pending state, a one-reason failure callout and the 100-ticket cap. Six E2E cases check the database results and the audit rows.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Check two rows, set their status from the bar | 34b949e | typecheck 0, lint 0, E2E 7/7 (bulk 1 + inbox 6) |
| 2 | Full bar, selection rules, cap and row details | 8cf43e8 | typecheck 0, lint 0, E2E 9/9 (bulk 1 + inbox 6 + reading-pane 2) |
| 3 | E2E for the remaining outcomes and selection rules | 6a053f7 | E2E 6/6 |

Tracer feedback gate: Task 1's `<verify>` (typecheck, lint, then the bulk and inbox E2E) passed before Task 2 started. The verify step is fully automated and the human-verify mode is end-of-phase, so no checkpoint was raised.

## What the E2E proves (tests/e2e/bulk-actions.spec.ts)

1. **Status:** with two of three tickets checked, the user picks Status → Resolved. Exactly those two become RESOLVED and the third stays OPEN. The database has two STATUS_CHANGED rows, one per ticket, sharing one non-null batchId (AIDA-48, D-23).
2. **Assign:** both tickets get the E2E member as assignee. The database has two ASSIGNEE_CHANGED rows sharing one non-null batchId.
3. **Tags:**
   - Before any tag is added, Remove tag shows "None of the selected tickets has a tag."
   - Add tag (search, then pick) links the tag to both tickets.
   - After the refresh, Remove tag offers that tag. Removing it leaves no link, and the database has two TAG_REMOVED rows.
4. **Refusal:** one selected ticket is deleted, then the user picks Priority → Urgent.
   - The bar's `role="alert"` callout shows "Nothing was changed." and the TICKET_UNAVAILABLE row.
   - The bar still shows "2 tickets selected".
   - The remaining ticket is still NORMAL and has no audit row.
5. **Selection rules:**
   - After the user opens another ticket's row, the URL is `/tickets/{id}?q={token}`, "1 ticket selected" is still shown, and the checked row is still checked.
   - Choosing a Status filter chip (and closing the menu) removes the bar and unchecks the row.
6. **Cap:** with 101 tickets at `limit=150` and 100 checked, the bar shows "100 tickets selected" and the cap note, and the 101st checkbox is disabled and unchecked.

## Verification commands (exit codes)

- `pnpm typecheck`: 0 after every task and after the last E2E run
- `pnpm lint`: 0 (317 files)
- `pnpm test` (unit): 0, 19 files and 152 tests
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e tests/e2e/bulk-actions.spec.ts`: 0, 6 passed. The first run of the final file exited 1 on case 5 (see Deviations, item 3), and the rerun passed.
- Regression: `pnpm test:e2e tests/e2e/inbox.spec.ts tests/e2e/reading-pane.spec.ts tests/e2e/saved-views.spec.ts`: 0, 18 passed. `saved-views.spec.ts` includes the 11-05 focus-after-delete assertion. `ListPanelFocus` is still rendered inside `<aside id="ticket-list-panel">`, and `src/lib/saved-views/ui-state.ts` is untouched.
- Before every E2E run, `pgrep -f 'artisan test'` found nothing. Each run was one process, its output went to a log under `$TMPDIR`, and its exit code was read without a pipe.
- No migration, no package change, no `.env` edit. The full integration and egress suites were not run (O-1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing copy] A row for a tag search with no match**
- **Found during:** Task 2
- **Issue:** The Copywriting Contract covers a member search with no match and a tag picker with no tags at all, but not a tag search with no match. The no-tags copy ("No tags yet…") would be wrong there, and an empty popover gives no feedback.
- **Fix:** When the list has tags, `CommandEmpty` shows `No tag matches "{query}".`, which follows the member row's pattern. When there are no tags to offer, a fixed empty row shows the contract copy instead.
- **Files modified:** src/app/(app)/tickets/bulk-action-bar.tsx
- **Commit:** 8cf43e8

**2. [Rule 3 - Lint] Biome formatting**
- **Found during:** Task 1
- **Fix:** Ran `biome format --write` on the plan's own files only. The fixes were formatting only.
- **Commit:** 34b949e

**3. [Rule 1 - Test correctness] The status filter menu is modal**
- **Found during:** Task 3
- **Issue:** While the filter row's Status dropdown is open, Radix hides the rest of the page from the accessibility tree. As a result, "bar has count 0" passed for the wrong reason, and the checkbox lookup failed.
- **Fix:** The case presses Escape and waits for the menu to close. It then checks that the row is visible before asserting that the bar is gone and the row is unchecked. No product code changed.
- **Commit:** 6a053f7

### Shape choices inside the plan's scope

- `reportLoaded` lives on the selection context, and `BulkActionBar` calls it from an effect. The bar is always mounted and renders nothing at zero selected. This keeps pruning on even when nothing is selected, as the "error" truth for E5 requires.
- Unmounting the tickets layout ends the selection (no extra code), because leaving `/tickets` unmounts the provider.
- The row link keeps only `view`, `status`, `tag`, `cf`, `q`, `sv` and `limit`, as the panel received them.
- The member list comes from bare `prisma.member` with an explicit `organizationId`, as on the ticket page. It is sorted by name, and an empty name falls back to the email.

## Threat model dispositions

- **T-11-28:** mitigated. The id list goes to the 11-02 service, which locks only the actor's organization's tickets and refuses a mismatch. The E2E refusal case proves that one unavailable id refuses the whole batch.
- **T-11-29:** mitigated. Checking a ticket at 100 does nothing, unchecked boxes are disabled, and the service caps at 100.
- **T-11-30:** accepted as planned. The picker lists only the active organization's members.
- **T-11-31:** mitigated. Subjects, member names and tag names render as React text and in `aria-label` strings. There is no `dangerouslySetInnerHTML` and no inline script. A grep found no colour literals in the new files.

## Open items (manual, not claimed)

- Visual approval of the bulk bar, the row checkbox column and the picker popovers (CONTEXT Human boundary).
- Dark-mode review of the same surfaces (DESIGN-SYSTEM section 7).
- Backstop truth E6 partial: after a bulk status change moves some selected tickets out of the filter, the remaining tickets stay checked and the count matches the checked rows. The prune-on-refresh code exists, but no E2E case covers this.
- Backstop truth E6 long-text: a 255-character member name and a 100-character tag name truncate inside the 240px popover. The options use `min-w-0 flex-1 truncate`, but nothing was measured.
- The E5/E6 overflow layout (triggers wrapping inside the 360px panel) and the focus ring on checked and open rows were not inspected visually.
- The D-14 screen-reader check, including whether the bulk count is announced, stays open.
- AIDA-48 is not marked complete here, because the orchestrator owns REQUIREMENTS.md.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/app/(app)/tickets/ticket-selection.tsx, src/app/(app)/tickets/bulk-action-bar.tsx, tests/e2e/bulk-actions.spec.ts, src/app/(app)/tickets/layout.tsx, src/app/(app)/tickets/ticket-list-row.tsx, src/app/(app)/tickets/ticket-list-panel.tsx
- FOUND commits: 34b949e, 8cf43e8, 6a053f7
