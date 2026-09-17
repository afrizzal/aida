---
phase: 11-inbox
plan: 08
subsystem: keyboard, command-palette, inbox, ticket-page, ui
status: complete
tags: [keyboard, shortcuts, dispatcher, chord, help-modal, command-palette, cmdk, e2e, design-system]
requires:
  - "11-06: useTicketSelection (loadedIds, toggle, clear, cap), row link id ticket-row-{id}"
  - "11-07: CommandProvider, useCommands, useRegisterCommands, the registry, data-command-palette on the palette's cmdk root, global ids nav.*"
provides:
  - "src/lib/keyboard/keymap.ts: KEYMAP, KEYMAP_SECTIONS, formatKeys, keyCaps, keymapBySection, keymapEntryForCommand"
  - "src/lib/keyboard/dispatch.ts: decideKey (pure), CHORD_TIMEOUT_MS = 1000, createChordTimer"
  - "src/components/keyboard/keyboard-dispatcher.tsx: the one window keydown listener (bubble phase), mounted in CommandProvider"
  - "src/components/keyboard/keyboard-help-dialog.tsx, chord-hint.tsx, key-caps.tsx (KeyCap, KeyCaps, useApplePlatform)"
  - "Command ids: list.next, list.prev, list.toggle, list.clearSelection (hidden); ticket.assign, ticket.status, ticket.tag, ticket.reply, ticket.note (This ticket); help.shortcuts (Help)"
  - "useCommands() now also exposes helpOpen, setHelpOpen, openHelp and chord"
  - "docs/KEYBOARD.md"
affects: [11-09, phase-16]
tech-stack:
  added: []
  patterns:
    - "Pure decision function over an event snapshot; the React component only builds the snapshot and performs the action"
    - "The pending chord lives in provider state; one timer in the dispatcher clears it"
    - "The palette commits its close with flushSync before running a command, so the focus trap is gone when the command moves focus"
key-files:
  created:
    - src/lib/keyboard/keymap.ts
    - src/lib/keyboard/dispatch.ts
    - src/components/keyboard/keyboard-dispatcher.tsx
    - src/components/keyboard/keyboard-help-dialog.tsx
    - src/components/keyboard/chord-hint.tsx
    - src/components/keyboard/key-caps.tsx
    - docs/KEYBOARD.md
    - tests/unit/keyboard-dispatch.test.ts
    - tests/e2e/keyboard.spec.ts
  modified:
    - src/components/command-provider.tsx
    - src/components/command-palette.tsx
    - src/app/(app)/tickets/ticket-selection.tsx
    - src/components/tickets/ticket-meta-header.tsx
    - src/components/tickets/composer.tsx
decisions:
  - "A key after g that is not a Go to letter only cancels the chord; it does not also run its own command"
  - "Besides the plan's guards, decideKey ignores every non-palette key while any modal (or the palette) is open, and lone modifier keys (Shift, Control, Alt, Meta) neither act nor cancel a chord"
  - "Palette key caps are aria-hidden, as on the 11-07 top-bar trigger, so each item's accessible name stays its label; the help modal lists every key as text"
  - "a and s focus the current value only when opened by a key or palette command (ref callback on the menu content); a click keeps Radix's own focus"
  - "After a chosen palette command the palette does not restore focus (onCloseAutoFocus prevented); closing with Esc, ⌘K or a click outside still restores it"
metrics:
  duration: "~12 min"
  completed: 2026-11-08
actuals:
  tokens: 16900
  tasks: 3
  commits: 4
plan_head_before: feb1de5febbc358afb2102dd30be27e659215da3
---

# Phase 11 Plan 08: Keyboard shortcuts Summary

One dispatcher over one key table now handles the whole app's keyboard. ⌘K and Ctrl+K open and close the palette, also from an input, but not behind another modal or inside a menu. g chords navigate and expire after one second. j, k, x, Enter and Esc drive the inbox list. a, s, t, r and n act on the open ticket. ? opens a help modal that is rendered from the same table as `docs/KEYBOARD.md`. The palette shows the This ticket and Help groups, with key caps taken from the table.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | One dispatcher over one key table: ⌘K/Ctrl+K and g chords | 462e09e | typecheck 0, lint 0, keyboard E2E 6/6 |
| 2 (tdd) | Decision-logic tests, help modal, chord hint, docs | 7ca4a28 (RED), cc41861 (GREEN) | RED: 2 failing (doc missing, keymapBySection missing); GREEN: unit 60/60, typecheck 0, lint 0 |
| 3 | List and ticket-page keys, palette key caps, hint and Ctrl+K E2E | 93b2930 | typecheck 0, lint 0, E2E 29/29 (keyboard, mutations, reading-pane, command-palette) |

Tracer gate: Task 1's `<verify>` (typecheck, lint, keyboard E2E) passed before Task 2 started. Per the run charter there was no human checkpoint.

## Verification commands (exit codes)

- `pnpm typecheck`: 0 after every task
- `pnpm lint`: 0 (330 files)
- `pnpm exec vitest run tests/unit/keyboard-dispatch.test.ts`: 0, 60 passed
- `pnpm test` (unit suite): 0, 21 files, 222 tests
- `pnpm test:e2e tests/e2e/keyboard.spec.ts`: 0, 13 passed. The first run of the Task 3 spec exited 1 (12 passed, 1 failed); see Deviations, item 1.
- Plan verify: `pnpm test:e2e tests/e2e/keyboard.spec.ts tests/e2e/mutations.spec.ts tests/e2e/reading-pane.spec.ts tests/e2e/command-palette.spec.ts`: 0, 29 passed
- Regression (orchestrator list): `pnpm test:e2e tests/e2e/inbox.spec.ts tests/e2e/reading-pane.spec.ts tests/e2e/saved-views.spec.ts tests/e2e/bulk-actions.spec.ts tests/e2e/command-palette.spec.ts`: 0, 33 passed
- Every E2E command ran with `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=…`, after `pgrep -f 'artisan test'` found nothing. Each ran as one process, with output in a log under `$TMPDIR` and the exit code read without a pipe. No build, migration, package change or `.env` edit. No container was touched.
- Unchanged: `list-panel-focus.tsx`, the saved-view wrappers, `bulk-action-bar.tsx` (the one-picker rule), `src/lib/commands/registry.ts` and `contact-search.tsx` (the 9eddbd9 fix).

## E2E coverage (tests/e2e/keyboard.spec.ts, observed outcomes, D-23)

1. On /tickets, Meta+k shows the "Command palette" dialog and a second Meta+k hides it.
2. Control+k shows the palette.
3. Meta+k with focus in the inbox search input shows the palette.
4. With the "New Ticket" dialog open, Meta+k leaves the palette closed, and exactly one dialog stays open.
5. g then c from /tickets lands on /contacts.
6. g then c typed into the inbox search input: the input holds "gc", and after more than a second the page is still /tickets. The search box's own debounce adds `?q=gc`, so the test asserts the pathname, not the full URL.
7. Chord hint: after g, "then a letter" is visible. With no further key it is hidden within 2500 ms, and a later c leaves the page on /tickets (Codex C9).
8. Control+k with focus in the open palette's input closes the palette (Codex C4, vimBindings off).
9. ? opens "Keyboard shortcuts" with the four section headings and their rows, and Esc closes it. The palette footer shows "for all shortcuts", and its "Show keyboard shortcuts" item opens the help modal with the palette hidden (one dialog).
10. On a filtered inbox with 3 rows:
    - j and k move focus row by row and stop at both ends, and no more rows load.
    - x checks the cursor row and the bar shows "1 ticket selected". Esc then clears the selection.
    - Enter on a focused row opens `/tickets/{id}`.
11. With a ticket open, the first j focuses that ticket's row.
12. On the ticket page:
    - s opens the status menu with focus on the checked current status.
    - a opens the assignee menu with focus on "Unassign" (the current value).
    - t opens the tag picker with focus in its empty search input.
    - r focuses the reply textarea and the r is not typed.
    - n switches to Internal Note and keeps the typed text, with the caret at the end.
13. The palette's This ticket group lists its five items in order. "Write an internal note" leaves the internal-note textarea focused after the palette has closed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A palette command could not keep focus**
- **Found during:** Task 3 (E2E case 13, first run red)
- **Issue:** `choose()` closed the palette with a state update and then ran the command in the same handler. The palette's modal focus trap was still active when `ticket.note` focused the textarea, so it pulled focus back. On close, the dialog would also have restored focus to the earlier element.
- **Fix:** The palette commits its close with `flushSync`, then runs the command. After a chosen command it does not restore focus. This is done through `onCloseAutoFocus` on its own `Dialog`/`DialogContent`, which use the same markup and classes as `CommandDialog`; `ui/command.tsx` is untouched. Closing with Esc, ⌘K or a click outside still restores focus. The 11-07 command-palette spec still passes 9/9.
- **Files:** src/components/command-palette.tsx
- **Commit:** 93b2930

**2. [Rule 1 - Accessibility regression avoided] Palette key caps are aria-hidden**
- **Found during:** Task 3
- **Issue:** Visible caps inside an option would change its accessible name ("Contacts g then c"). That would break the 11-07 spec's exact-name locators, and screen readers would read the caps as part of the name.
- **Fix:** The caps sit in an `aria-hidden` `CommandShortcut`, as the top-bar cap does. No assertion was changed.
- **Commit:** 93b2930

**3. [Rule 2 - UI-SPEC behaviour beyond the plan's E2E list] Extra E2E cases**
- The plan lists cases 1 to 8 above. Cases 9 to 13 cover the E8 populated, E9 populated, partial and zero-one-many, and 5b and 5c truths: help modal, j/k/x/Esc/Enter, the open-ticket start, ticket-page keys and the This ticket group.
- **Commit:** 93b2930

**4. [Rule 2 - Correctness] Extra guards in decideKey**
- Lone modifier keydowns (Shift before ?, for example) neither act nor cancel a pending chord.
- Every non-palette key is ignored while any modal or the palette is open, even when the event target is outside it (for example `body`), because D-13 ignores keys "inside an open dialog".
- Both are unit-tested.
- **Commit:** 462e09e, 7ca4a28

**5. [Rule 3 - Lint] Biome formatting**, applied to this plan's own files only.

### Shape choices inside the plan's scope

- `KeymapEntry.keys` holds one key, or two for a chord. The palette key is the token `Mod+K`, and the `help` entry names `help.shortcuts` so the palette item shows `?`.
- `keymapBySection()` feeds the help modal, and a unit test checks that it holds every KEYMAP entry exactly once. This is the E8 error backstop for the modal, next to the `docs/KEYBOARD.md` parity test.
- The palette clears its query when ⌘K/Ctrl+K closes it from outside, as an Esc close already did.
- The help modal title uses `text-[15px] font-semibold tracking-tight`, as the save-view dialog does.

## Threat model dispositions

- T-11-36: mitigated. Editable and overlay targets, open modals, IME composition, repeats and modified keys are ignored (unit tests). E2E cases 3, 6 and 12 show that keys typed in inputs stay there.
- T-11-37: mitigated. Commands read only the route context and their own component state, never ticket text. Only real keydown events reach the dispatcher.
- T-11-38: mitigated. The chord timer is stopped on completion, cancel, Esc, blur, navigation and unmount. Fake-timer unit tests and E2E case 7 cover it.
- T-11-47: mitigated. The universal guards run before the palette exception, with unit tests for each guard with Meta+K and with Ctrl+K, with and without an editable target.
- T-11-39: mitigated. Client modules only, mounted in the shell, with no inline script.

## Open items (manual, not claimed)

- D-14: how the single-letter keys behave with screen readers. Not checked, and never claimed as passed.
- Visual approval of the help modal, the chord hint, the palette key caps and the footer. No visual pass is claimed.
- Dark-mode review of the same surfaces (DESIGN-SYSTEM §7).
- Backstop truth E8 long-text: at 360px, the longest action wraps while its caps stay on one line (`shrink-0` on the caps). Not measured.
- Backstop truth E9 long-text: at 360px, the chord hint stays on one line (`whitespace-nowrap`) and does not cover the bulk bar's Clear selection. Not measured.
- AIDA-49 and AIDA-50 are not marked complete here, because the orchestrator owns REQUIREMENTS.md.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/keyboard/keymap.ts, src/lib/keyboard/dispatch.ts, src/components/keyboard/keyboard-dispatcher.tsx, src/components/keyboard/keyboard-help-dialog.tsx, src/components/keyboard/chord-hint.tsx, src/components/keyboard/key-caps.tsx, docs/KEYBOARD.md, tests/unit/keyboard-dispatch.test.ts, tests/e2e/keyboard.spec.ts
- FOUND commits: 462e09e, 7ca4a28, cc41861, 93b2930
