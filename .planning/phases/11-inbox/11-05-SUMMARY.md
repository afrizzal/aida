---
phase: 11-inbox
plan: 05
subsystem: saved-views, inbox, sidebar, ui
status: complete
tags: [saved-views, sidebar, dialog, strip, e2e, membership, design-system]
requires:
  - "11-01: list-filters grammar (parseUrlFilters, filtersToSearchParams, hasAnyFilter), SavedView model"
  - "11-03: listSavedViewsForViewer, getSavedViewForPanel, SavedViewError, createSavedViewAction / updateSavedViewAction / deleteSavedViewAction"
provides:
  - "Sidebar Views section (src/components/sidebar-views.tsx), fed by the (app) layout"
  - "Save view icon button in FilterChipRow and SaveViewDialog (create and edit modes)"
  - "SavedViewStrip (applied, changed, broken reference) and the not-available / membership-ended line in TicketListPanel"
  - "DeleteViewDialog"
  - "sidebarViewsOrEmpty and panelOrMembershipEnded in src/lib/saved-views/ui-state.ts"
affects: [11-07, 11-09]
tech-stack:
  added: []
  patterns:
    - "Server read passed as a thunk to a small wrapper that maps the thrown MEMBERSHIP_ENDED to a defined UI state"
    - "Dialog form mounted inside DialogContent so every opening starts from fresh state"
    - "Disabled icon button wrapped in a focusable span so its tooltip still shows the reason"
key-files:
  created:
    - src/components/sidebar-views.tsx
    - src/lib/saved-views/ui-state.ts
    - src/app/(app)/tickets/save-view-dialog.tsx
    - src/app/(app)/tickets/saved-view-strip.tsx
    - src/app/(app)/tickets/delete-view-dialog.tsx
    - tests/e2e/saved-views.spec.ts
    - tests/integration/saved-views-ui-state.test.ts
  modified:
    - src/app/(app)/layout.tsx
    - src/components/sidebar.tsx
    - src/app/(app)/tickets/filter-chip-row.tsx
    - src/app/(app)/tickets/ticket-list-panel.tsx
decisions:
  - "The layout and the panel call listSavedViewsForViewer / getSavedViewForPanel themselves and pass the call as a thunk to sidebarViewsOrEmpty / panelOrMembershipEnded, so the catch logic is testable on Testcontainers"
  - "A removed member opening ?sv= sees the Copywriting 'View error: membership ended' line with Clear, in the same place and style as 'View not available'; the sidebar shows the 'Views empty' line"
  - "Applied versus changed stays decided on the server by filtersEqual (order-insensitive); the strip never compares filters itself"
  - "In the dialog a tag or custom field counts as broken when the server flags it or it is not in the organization's current list, so create mode also flags a URL tag that was deleted"
  - "The strip menu uses DropdownMenu modal={false} so opening a dialog from a menu item does not leave the body locked"
metrics:
  duration: "~8 min"
  completed: 2026-11-08
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 5d1ca699a5bc9d6680bbe5b865e151c1adc2e7c4
---

# Phase 11 Plan 05: Saved views in the interface Summary

Saved views now have a full interface. The sidebar has a Views section with Private and Shared groups. The filter row has a Save view button that opens a dialog with the filter summary and the shared-search warning. Above the list, a strip shows the applied, changed and broken-reference states, and editors can edit or delete the view from it. Every permission still comes from the 11-03 service. A removed member gets a defined line instead of an error page.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | A saved view opens from the sidebar with its filters applied | 127abb9 | typecheck 0, lint 0, E2E 1/1 |
| 2 | Save view button and the Save view / Edit view dialog | 2abc03f | typecheck 0, lint 0, E2E 5/5 |
| 3 | Strip states, edit, delete, second-user visibility | d58127d | typecheck 0, lint 0, integration 3/3, E2E 10/10 |

Tracer feedback gate: Task 1's `<verify>` (typecheck, lint, and the E2E file) passed before Task 2 started. Auto-advance is off, the human-verify mode is end-of-phase, and the verify step is fully automated, so no checkpoint was raised.

## The two 11-03 notes

1. **Thrown MEMBERSHIP_ENDED.** Every new caller goes through `src/lib/saved-views/ui-state.ts`. In the sidebar, `sidebarViewsOrEmpty` turns any failure into empty lists, so the Views heading and the "Views empty" line still render, and it logs one line carrying only the error code. In the panel, `panelOrMembershipEnded` maps `MEMBERSHIP_ENDED` to `{ status: "membership_ended" }`. That state renders the "membership ended" copy with Clear, and the list keeps the URL filters. Any other error is rethrown. `tests/integration/saved-views-ui-state.test.ts` deletes a member row and asserts three things: the raw reads reject with `MEMBERSHIP_ENDED`, the sidebar wrapper resolves to `{ private: [], shared: [] }`, and the panel wrapper resolves to `{ status: "membership_ended" }`. A second case asserts that the panel wrapper rethrows a different error. (11-07, the palette, is a further caller of the list read and must use the same wrapper.)
2. **Status order.** The strip renders the server's `state` and does no comparison of its own. The integration test stores a view as `["PENDING", "OPEN"]`, confirms the row keeps that order, and gets `applied` for both `OPEN, PENDING` and `PENDING, OPEN`, and `changed` for `OPEN` alone. The E2E case "a different status order alone does not show Filters changed" opens both URL orders and finds no "Filters changed".

## Verification commands (exit codes)

- `pnpm typecheck`: 0 after every task
- `pnpm lint`: 0 (313 files)
- `pnpm test` (unit): 0, 19 files and 152 tests
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/saved-views-ui-state.test.ts`: 0, 3 passed
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e tests/e2e/saved-views.spec.ts`: 0, 10 passed
- Regression: `pnpm test:e2e tests/e2e/inbox.spec.ts tests/e2e/reading-pane.spec.ts`: 0, 8 passed
- `pgrep -f 'artisan test'` found nothing before each Testcontainers or E2E run. Each run was one process, its output went to a log under `$TMPDIR`, and its exit code was read without a pipe.
- No migration, no package change, no `.env` edit. The full integration and egress suites were not run (O-1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Defined state for a removed member (orchestrator note 1)**
- **Found during:** Task 1 and Task 3
- **Issue:** Both service reads throw `SavedViewError("MEMBERSHIP_ENDED")`. Without a catch, a removed member would hit the tickets error boundary.
- **Fix:** Added `src/lib/saved-views/ui-state.ts` (not in the plan's file list), the `membership_ended` line in `ticket-list-panel.tsx`, and `tests/integration/saved-views-ui-state.test.ts`.
- **Commits:** 127abb9, d58127d

**2. [Rule 2 - Test] Status-order proof (orchestrator note 2)**
- **Fix:** Added the integration case and the E2E case described above. No product change was needed.
- **Commit:** d58127d

### Shape choices inside the plan's scope

- The duplicate-name E2E seeds the first private view through prisma instead of reusing the view an earlier case saved, so the case does not depend on that one.
- In Task 3 case (3), the admin's shared and private views are seeded through prisma. The UI save path is already covered by the Task 2 cases. What this case proves is what the member sees.
- In Task 3 case (2), the view is saved through the UI on `?tag={T}`, as planned. The tag is then deleted through prisma.
- The Clear button is a server-rendered link that drops `sv` and keeps the panel's `basePath`, so on `/tickets/[id]` it stays on the open ticket.

## Threat model dispositions

- T-11-24: mitigated. The sidebar and strip get their data only from `listSavedViewsForViewer` and `getSavedViewForPanel`. The E2E proves that the member never sees the admin's private view, either in the sidebar or by its sv URL.
- T-11-25: mitigated. In the dialog, NOT_FOUND maps to the not-allowed row. The panel shows one not-available line for deleted, hidden and unknown views.
- T-11-26: mitigated. Names, search text, tag names and field values are rendered as React text. There is no `dangerouslySetInnerHTML` and no inline script. A grep found no colour literals in the new files.
- T-11-27: mitigated. `canEdit` from the server hides the menu, Save changes and Edit view. The service still refuses on its own (11-03).

## Open items (manual, not claimed)

- Visual approval of the Views section, the strip and notices, and the save and delete dialogs (CONTEXT Human boundary).
- Dark-mode review of the same surfaces (DESIGN-SYSTEM section 7).
- Backstop truths that need a human or a later check: an 80-character name in the strip and the both-references notice at a 360px panel; a 200-character search text and custom-field value wrapping in the dialog at a 360px viewport; an 80-character name in the delete title. The layout uses `min-w-0`, `truncate`, `flex-wrap` and `wrap-anywhere` for these, but no screenshot or measurement was taken.
- The E1 error backstop (the layout logs and renders "Views empty" when the read fails) is proven at the wrapper level. It was not proven by forcing a failure in a running page.
- UI-SPEC 2d says focus moves to the list panel's first focusable element after a delete. This was not implemented separately: the app navigates to `/tickets` and focus follows the router default. It is left for the phase gate.
- AIDA-47 is not marked complete here (orchestrator owns REQUIREMENTS.md).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/components/sidebar-views.tsx, src/lib/saved-views/ui-state.ts, src/app/(app)/tickets/save-view-dialog.tsx, src/app/(app)/tickets/saved-view-strip.tsx, src/app/(app)/tickets/delete-view-dialog.tsx, tests/e2e/saved-views.spec.ts, tests/integration/saved-views-ui-state.test.ts
- FOUND commits: 127abb9, 2abc03f, d58127d

## Follow-up fix (orchestrator)

Closes the UI-SPEC 2d open item above: after a delete, focus now moves to the list panel's first focusable element.

- Commit `fix(11-05): move focus to the list panel after a view is deleted (UI-SPEC 2d)`.
- The delete dialog sits inside the saved-view strip, which unmounts once `sv` leaves the URL, so it cannot move focus itself. On success it calls `requestListPanelFocus()` and prevents radix's return-to-trigger focus (`onCloseAutoFocus`). A new client component, `ListPanelFocus` in `src/app/(app)/tickets/list-panel-focus.tsx`, is rendered inside the panel's `<aside id="ticket-list-panel">`. Once the URL no longer carries `sv`, it focuses the first focusable descendant. No styling changed.
- Before the fix, focus landed on the `<aside>` scroll container itself, not on a control. The new E2E assertion in "the admin deletes a view from the strip menu" requires the focused element to be a descendant of the panel, not the panel itself. It failed with the fix disabled (exit 1) and passes with it.
- Verify: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test:e2e tests/e2e/saved-views.spec.ts` 0 (10 passed).
