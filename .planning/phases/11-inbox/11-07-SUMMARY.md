---
phase: 11-inbox
plan: 07
subsystem: command-palette, shell, inbox, ui
status: complete
tags: [command-palette, registry, cmdk, top-bar, saved-views, new-ticket, e2e, design-system]
requires:
  - "11-03: GET /api/palette/tickets?q= (membership-checked, at most 10 rows of { id, number, subject, status })"
  - "11-05: views list read in the (app) layout through sidebarViewsOrEmpty; SaveViewDialog and the save-view state in FilterChipRow"
provides:
  - "src/lib/commands/registry.ts: createCommandRegistry() (register, unregister, list, visible, paletteCommands, subscribe, getVersion), Command, CommandContext, CommandGroup, CommandIcon, COMMAND_GROUP_ORDER, filterCommands"
  - "src/components/command-provider.tsx: CommandProvider (one registry, palette state, command context from route and URL), useCommands (open, setOpen, openPalette, closePalette, togglePalette, registry, context, registerNewTicketOpener), useRegisterCommands(commands, deps)"
  - "src/components/command-palette.tsx: the palette dialog; its cmdk root carries data-command-palette for the 11-08 dispatcher"
  - "Global command ids: nav.tickets, nav.contacts, nav.kb, nav.insights, nav.settings, create.ticket, view:{viewId}; inbox command views.save"
  - "Top-bar Search trigger with a platform key cap and aria-keyshortcuts"
  - "NewTicketDialog opens from the palette while mounted and on /tickets?new=1"
affects: [11-08, 11-09, phase-16]
tech-stack:
  added: []
  patterns:
    - "Registry in plain TypeScript with a version counter, read in React through useSyncExternalStore"
    - "Icons named by string in the registry and mapped to Lucide components in the palette, so the registry imports no React"
    - "Palette item value = command id (ticket id for search rows), never the label"
    - "Server snapshot null for the platform key cap, so the cap is decided only on the client"
key-files:
  created:
    - src/lib/commands/registry.ts
    - src/components/command-provider.tsx
    - src/components/command-palette.tsx
    - tests/unit/command-registry.test.ts
    - tests/e2e/command-palette.spec.ts
  modified:
    - src/components/top-bar.tsx
    - src/app/(app)/layout.tsx
    - src/app/(app)/tickets/new-ticket-dialog.tsx
    - src/app/(app)/tickets/filter-chip-row.tsx
decisions:
  - "The palette's Views group uses the same views object the layout already read through sidebarViewsOrEmpty, so a removed member sees an empty group and never the error boundary (11-05 note), and only the viewer's own private views plus shared views reach the client (T-11-32)"
  - "The Tickets group shows 'Searching tickets…' until a response for exactly the current query arrives, so a result row is never from an older query; an older request is aborted and its response ignored"
  - "'Nothing matches' renders only when the Tickets group is hidden and no command matches; cmdk's own empty logic is not used because non-selectable rows are not cmdk items"
  - "The palette closes, then runs the chosen command in the same handler; the E2E proves that only one dialog is open after Create ticket and after the save command"
  - "useRegisterCommands(commands, deps) reads the commands from a ref and re-registers when deps change; a stale unregister function never removes a newer command registered under the same id"
  - "The views.save command uses order -1, so it sits above the view commands (order 0 onward, private first)"
metrics:
  duration: "~9 min"
  completed: 2026-11-08
actuals:
  tokens: 13300
  tasks: 3
  commits: 4
plan_head_before: ec23c4f4feb1f859f149b1e210317641559c10ff
---

# Phase 11 Plan 07: Command palette Summary

The app shell now has a command palette. It opens from a Search button in the top bar. It searches tickets through the membership-checked endpoint, with a 300 ms debounce, a 2-character minimum, and stale responses discarded. It also lists the viewer's saved views (private and shared), the other sidebar sections, and Create ticket. Any module can add commands through one plain-TypeScript registry, and the inbox already adds "Save these filters as a view…" this way. 11-08 binds keys to the same registry, and Phase 16 will register its commands there too.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Open the palette from the top bar, find a ticket, open it | 2ea290e | typecheck 0, lint 0, E2E 1/1 |
| 2 (tdd) | Registry and the Go to, Create and Views groups | a5df71f (RED), fbed1e0 (GREEN) | RED: the test file failed to load (module missing); GREEN: unit 10/10, typecheck 0, lint 0 |
| 3 | Save-view command and the E2E for every group built here | 34375fb | typecheck 0, lint 0, E2E 9/9 |

Tracer feedback gate: Task 1's `<verify>` (typecheck, lint, the E2E file) passed before its commit, and Task 2 started only after that. Per the run charter there was no human checkpoint.

## Verification commands (exit codes)

- `pnpm typecheck`: 0 after every task and after the build
- `pnpm lint`: 0 (322 files)
- `pnpm exec vitest run tests/unit/command-registry.test.ts`: 0, 10 passed
- `pnpm test` (unit suite): 0, 20 files and 162 tests
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e tests/e2e/command-palette.spec.ts`: 0, 9 passed
- Regression `pnpm test:e2e tests/e2e/inbox.spec.ts tests/e2e/saved-views.spec.ts tests/e2e/bulk-actions.spec.ts`: **1** (21 passed, 1 failed). The failure was the bulk-tag case, with two popovers' options visible at once (see Deferred Issues).
- Re-run `pnpm test:e2e tests/e2e/bulk-actions.spec.ts`: 0, 6 passed
- `pnpm build`: 0. The shell-level `useSearchParams` causes no prerender error, because every (app) route is dynamic.
- Before every Docker, E2E or build command, `pgrep -f 'artisan test'` found nothing. Each test command ran as a single process, its output went to a log under `$TMPDIR`, and its exit code was read without a pipe.
- No migration, no package change, no `.env` edit, no container touched. `list-panel-focus.tsx`, `bulk-action-bar.tsx` and `ticket-selection.tsx` are unchanged.

## E2E coverage (observed outcomes, D-23)

1. Top-bar trigger, then a token search: the option shows `#number` and the subject, and Enter opens `/tickets/{id}`.
2. On /tickets, Go to lists Contacts, Knowledge Base, Insight and Settings, and has no Tickets option. Choosing Contacts lands on /contacts.
3. Create ticket from /contacts: the URL becomes /tickets with no `new` parameter, and the "New Ticket" dialog is visible.
4. Create ticket on /tickets: the "New Ticket" dialog opens over the page, the palette is hidden, exactly one dialog is in the page, and the Subject field accepts input.
5. A private view and a shared view with the same name show as two options, one marked "Private" and one "Shared". Choosing Shared lands on `sv={sharedId}`.
6. On /tickets?status=OPEN, the save command opens the "Save view" dialog, with one dialog open. On /tickets with no filter, the command is absent.
7. Typing "~" shows `Nothing matches "~".` and no Tickets group, and no search request is sent even after the debounce has passed. A 2+ character token with no hits shows `No tickets match "{token}".` in the Tickets group, with no "Nothing matches" line.
8. While the first response is held, "Searching tickets…" is visible. A refused search (403) then shows the search-error row, and choosing Contacts from Go to still works.
9. An older query's response that arrives late is never shown. The newer query's empty state stays on screen.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Mount-order-safe unregister**
- **Found during:** Task 2
- **Issue:** If a component re-registers an id after an earlier unmount, the earlier unregister function could remove the newer command.
- **Fix:** The function that `register` returns removes only its own instance. A unit test covers this.
- **Commit:** fbed1e0

**2. [Rule 2 - UI-SPEC behaviour beyond the plan's E2E list] Extra E2E cases for E7**
- **Issue:** The plan's E2E list does not cover the E7 loading, error and stale-response truths, or Create ticket on the inbox route (one modal).
- **Fix:** Added cases 4, 8 and 9 above. Cases 8 and 9 intercept the page's own request with `page.route`. No product change was needed.
- **Commit:** 34375fb

**3. [Rule 3 - Test infrastructure] Warm-up for first compiles**
- **Issue:** On its first hit, `next dev` can answer with a transient 404 for `/api/palette/tickets` or a page route.
- **Fix:** The spec polls the endpoint and the target routes with the page's session before acting, following the charter's `expect.poll` rule. The product was not loosened.
- **Commit:** 2ea290e, 34375fb

### Shape choices inside the plan's scope

- The registry also exposes `getVersion()` for `useSyncExternalStore`, and a `CommandIcon` name union, so the registry needs no React import.
- The palette's cmdk root carries `data-command-palette`. This lets the 11-08 dispatcher tell the palette apart from other dialogs.
- The key cap is `aria-hidden`, so the trigger's accessible name is "Search". The shortcut is announced through `aria-keyshortcuts`.
- The search-error row has `role="alert"`, so a screen reader announces the failure.
- Keywords on the global commands: Tickets "inbox"; Contacts "customers", "people"; Knowledge Base "articles", "kb"; Insight "insights", "reports"; Settings "preferences"; Create ticket "new ticket", "add"; views "view" plus "private" or "shared"; views.save "save view", "bookmark".

## Deferred Issues

- A flaky case in the 11-06 spec `bulk-actions.spec.ts` ("a tag added in bulk is offered by Remove tag…") failed once in the combined regression run and passed on the re-run. While the Add tag picker was still animating closed, the Remove tag picker opened, so the tag appeared as two options and tripped Playwright's strict mode. Nothing in this plan touches the bulk bar. Recorded in `.planning/phases/11-inbox/deferred-items.md`.

## Follow-up fix (orchestrator)

- **Symptom:** E2E case 3 ("Create ticket from another page…") failed every time the spec ran alone and in two combined runs. The palette pushed `/tickets?new=1`, and the page then landed back on `/contacts` with no "New Ticket" dialog.
- **Root cause (product bug, not the palette):** `ContactSearch` (`src/app/(app)/contacts/contact-search.tsx`) called `router.replace("/contacts")` 300 ms after every mount, even with nothing typed. The /contacts page stays mounted until a navigation away commits, so its timer was not cleared. A navigation started within those 300 ms was overridden by that later replace. A CDP initiator stack confirmed this: the `/tickets?new=1` RSC request came from the palette's `create.ticket` command, and the `/contacts` RSC request came from `ContactSearch.useEffect` through `setTimeout` and `router.replace`. The new-ticket dialog's `?new=1` effect never ran. A real user who chose Create ticket, any palette command, or a sidebar link within 300 ms of opening Contacts was sent back the same way. The 11-07 run passed only because its click came after the timer had fired.
- **Fix (9eddbd9):** the effect returns early when the trimmed search text equals the URL's `q`. This is the same guard `TicketSearchInput` already uses. The palette, the dialog and the spec are unchanged, and the test still asserts as strictly as before.
- **Verification:** `pnpm typecheck` 0; `pnpm lint` 0; `pnpm test:e2e tests/e2e/command-palette.spec.ts` three runs in a row, exit 0 each time, 9/9; `command-palette` + `bulk-actions` + `inbox` + `saved-views` together: exit 0, 31 passed; `contacts.spec.ts` + `uat-gaps.spec.ts`: exit 0, 10 passed and 1 skip that was already in the spec.
- **Residual, not fixed:** if a user types in the contacts search and navigates away within 300 ms, the debounced replace can still override that navigation, because a changed query really does need a replace.

## Threat model dispositions

- T-11-32: mitigated. The provider receives only the layout's `sidebarViewsOrEmpty(listSavedViewsForViewer)` output: the viewer's own private views and the shared views. 11-05's E2E covers the member case.
- T-11-33: mitigated by 11-03's endpoint (membership check, organization filter, limit 10). The client sends only `q` and keeps only well-formed `{ id, number, subject, status }` rows with a known status.
- T-11-34: accepted. The registry is client code inside the app process only. No command surface is exposed to tickets or AI.
- T-11-35: mitigated. Subjects, view names and the query are rendered as React text. There is no `dangerouslySetInnerHTML` and no inline script. Nothing calls `lib/llm/`.

## Open items (manual, not claimed)

- Visual approval of the palette and its top-bar trigger (CONTEXT Human boundary). No visual pass is claimed.
- Dark-mode review of the palette, its rows, the status chips and the key cap (DESIGN-SYSTEM §7).
- Backstop truth, not measured: at a 360px viewport, a 255-character ticket subject truncates in its palette row with the status chip still visible, and an 80-character view name truncates before its Private/Shared label. The rows use `min-w-0 flex-1 truncate` with a `shrink-0` chip and label, but no screenshot or measurement was taken.
- Screen-reader behaviour of the palette (D-14 and the UI-SPEC accessibility backstop) is not checked.
- ⌘K / Ctrl+K, the This ticket and Help groups, the key caps on items, and the footer's "? for all shortcuts" part are 11-08's work.
- AIDA-49 is not marked complete here (the orchestrator owns REQUIREMENTS.md).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/commands/registry.ts, src/components/command-provider.tsx, src/components/command-palette.tsx, tests/unit/command-registry.test.ts, tests/e2e/command-palette.spec.ts
- FOUND commits: 2ea290e, a5df71f, fbed1e0, 34375fb
