# Phase 12: code review fix status

## Fix pass F1 (server)

**Scope:** WR-01, WR-02, IN-01, IN-02, IN-03 (`12-REVIEW.md`); WR-03, WR-04, WR-05, IN-04 (`12-REVIEW-b.md`). All nine findings were checked against the code before editing, and all nine still held.
**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). Integration tests used Testcontainers on Colima.
**Result:** 9 of 9 fixed. No schema change and no migration.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| WR-01 | fixed | e8743bd | `snooze.test.ts` › "wakeDueTicket is scoped to the organization it is given (review WR-01)" › "ignores a ticket id paired with another organization, then wakes it for its own" | `AssertionError: expected true to be false // Object.is equality` (the old code woke the ticket of org A when called with org B) |
| WR-02 | fixed (pure refactor) | 1e1430f | existing `ticket-relations`, `snooze`, `snooze-race` tests, all green | n/a (no behaviour change) |
| IN-01 | fixed (run decision K34) | 85177d9 | `ticket-relations.test.ts` › "addRelation: refusals change nothing" › "TICKET_UNAVAILABLE when either ticket is a merged source (run decision K34), nothing written" | `AssertionError: expected { ok: true, …(2) } to deeply equal { ok: false, …(1) }` |
| IN-02 | fixed (comment only) | 03730de | existing reply/reopen tests, all green | n/a (comment only) |
| IN-03 | fixed | 0516a35 | `ticket-relations.test.ts` › "addRelation: unique violations (review IN-03)" › "a unique violation on an index other than the pair key is rethrown, never ALREADY_LINKED" | `AssertionError: promise resolved "{ ok: false, error: 'ALREADY_LINKED' }" instead of rejecting` |
| WR-03 | fixed | be821c5 | `ticket-merge.test.ts` › "POST /api/tickets/{id}/messages …" › "a removed member gets 403 MEMBERSHIP_ENDED: no message, no stored file, nothing queued (review WR-03)" | `AssertionError: expected 200 to be 403 // Object.is equality` |
| WR-04 | fixed | 61f3cf8 | `ticket-merge.test.ts` › "POST /api/tickets/{id}/messages …" › "two concurrent first public replies keep the first firstRespondedAt stamp (review WR-04)" | `AssertionError: expected '2026-11-08T16:08:46.650Z' to be '2026-11-08T16:08:46.647Z'` (the second reply overwrote the first stamp) |
| WR-05 | fixed (pure refactor) | 7455ef3 | existing demo seed lock tests in `ticket-merge.test.ts` (a to e, `seedDemoData`), all green | n/a (no behaviour change) |
| IN-04 | fixed | e7a2be4 | `merge-reply-race.test.ts` › "review IN-04: inbound email on a matched ticket that can no longer take the reply" › "rejects with the typed ReplyTicketUnavailableError and writes nothing" | `AssertionError: expected Error: matched ticket is no longer availa… to match object { …(2) }` |

### What changed

- **WR-01:** The due query returns `id, "organizationId"`. The new signature is `wakeDueTicket(tx, ticketId, now, orgId, hooks)`. It puts `"organizationId" = orgId` in the `FOR UPDATE` read and in the conditional UPDATE, and it writes the WOKEN audit row under that `orgId`. `orgId` comes after `now` on purpose: with the old code, the same call shows the behaviour difference (the old code woke the ticket) instead of failing on a type error.
- **WR-02:** `lockPair` in `relations.ts` and `lockTicket` in `snooze.ts` now call `lockTicketsInIdOrder`. They keep their refusals: `rows.length !== 2` gives TICKET_UNAVAILABLE, and a missing row gives TICKET_UNAVAILABLE.
- **IN-01:** After the pair lock, `addRelation` refuses with `TICKET_UNAVAILABLE` when either locked row has a `mergedIntoTicketId`. The merge target still takes new links, and removing a merged source's links is unchanged (D-06).
- **IN-02:** The header comment of `reopen-on-reply.ts` now says the `FOR UPDATE` is a second, re-entrant lock: `resolveReplyTicket` already holds the row. The lock is kept because the snooze deadline is read from it.
- **IN-03:** Only `TicketRelation_pair_key` maps to `ALREADY_LINKED`, and `TicketRelation_one_parent_key` still maps to `PARENT_EXISTS`. Any other unique violation is rethrown unchanged.
- **WR-03:** In the messages route, `findActiveMembership(tx, …)` is the first statement in the transaction, before `lockTicketForAgentWrite`. If the member row is gone, the route returns `403 { error: "MEMBERSHIP_ENDED" }`. Staged files are discarded on the same path as `MERGED_SOURCE`, and nothing is written or queued.
- **WR-04:** `firstRespondedAt` is now written by `tx.ticket.updateMany({ where: { id, organizationId, firstRespondedAt: null }, … })` under the row lock. The pre-read taken before the lock no longer decides it.
- **WR-05:** `lockDemoTicket` calls `lockTicketsInIdOrder` and keeps `DemoSeedTicketMergedError` for a missing or merged ticket.
- **IN-04:** A new `ReplyTicketUnavailableError` (`code = "TICKET_UNAVAILABLE"`, `ticketId`) lives in `reopen-on-reply.ts`. Email ingest throws it instead of a bare `Error`. Poller behaviour is otherwise unchanged; the follow-up route keeps its 404.

### Notes for the UI passes (no change made here)

- **IN-01 copy:** The link dialog maps `TICKET_UNAVAILABLE` to "That ticket is no longer available. Pick another ticket." (`relationErrorMessage`), so the new refusal shows that copy and never raw text. But the picker in link mode does not mark merged sources as unavailable (`pickerReason` checks `alreadyLinked` only), and the Link action is still offered on a merged source's own page. In that case "Pick another ticket" does not fit. This is for F2/F3 to decide.
- **WR-03:** For any failed response, the composer shows its generic send-failed toast, so the new 403 is handled but has no copy of its own.

### Final commands (after all nine commits)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm lint` | 0 | 387 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 268 tests passed |
| `pnpm test:integration` with `snooze`, `ticket-relations`, `ticket-merge`, `merge-reply-race`, `merge-provenance`, `merge-race-coverage`, `snooze-race`, `activity-feed`, `email-ingest`, `reply-reopen-race` (one process) | 0 | 10 files, 122 tests passed |

E2E, build, egress and the full integration suite were not run in this pass. The orchestrator reruns the full gate.

## Fix pass F2 (UI focus and time)

**Scope:** UI-WR-01, UI-WR-02, UI-WR-03, UI-WR-04, UI-IN-01, UI-IN-03, UI-IN-04, UI-IN-05, UI-IN-06 (`12-REVIEW-c.md`), plus the `Asia/Jakarta` time-zone E2E block of UI-WR-08. All nine findings were checked against the code at `9a885e8` before editing, and all nine still held. UI-WR-05, 06, 07, the rest of UI-WR-08, UI-IN-02 and UI-K34 were not touched (pass F3).
**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). E2E used Testcontainers on Colima.
**Result:** 9 of 9 fixed. No copy string changed, `12-UI-SPEC.md` not edited, no schema change, no migration, no new package.
**Method:** all new and extended tests were written first and run once against the unfixed code (`e2e-before`: 16 failed, 10 passed). Each fix was then committed with its own test hunks. UI-IN-06 went first because its assertion sits ahead of the UI-WR-04 snooze trigger checks in the same tests. A second run with only UI-IN-06 fixed showed the UI-WR-04 trigger failure on its own.
**Time zone:** this Mac runs in Asia/Jakarta, and the E2E server inherits the host zone. With browser and server in the same zone, the server-rendered aria-label of UI-WR-01 is already right, so the defect cannot show. The seen-failing run and one after-run therefore used `TZ=UTC`, which puts the Next server (and the runner) in UTC, as CI and containers run. The final gate run used the host zone. The UI-WR-02 test fails in any server zone, because the old title was hard-coded to UTC.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| UI-WR-01 | fixed | 21bb332 | `snooze.spec.ts` › "Snooze times in the viewer's time zone" (`timezoneId: "Asia/Jakarta"`) › "the snoozed chip's accessible name gives the deadline in the viewer's zone (review UI-WR-01)" | `toHaveAccessibleName` Expected `"Snoozed until Tue, Nov 10, 09:00. Change or wake."`, Received `"Snoozed until Tue, Nov 10, 02:00. Change or wake."` (server in UTC) |
| UI-WR-02 | fixed | bf6349a | same block › "the feed's event time tooltip gives the full time in the viewer's zone (review UI-WR-02)" | `toHaveAttribute("title")` Expected `"Sun, Nov 8, 2026, 23:23 GMT+7"`, Received `"Sun, Nov 8, 2026, 16:23 UTC"` |
| UI-WR-03 | fixed | 2be655c | `ticket-relations.spec.ts` › "closing the Link dialog returns focus to the menu trigger (review UI-WR-03)" and the focus check after "Link added." in "the dialog links A as the parent of B…"; `ticket-merge.spec.ts` › "closing the merge dialog returns focus to the menu trigger (review UI-WR-03)" and the check after "Keep tickets separate" in "a linked pair shows that the merge replaces the link" | `toBeFocused` on `getByRole('button', { name: 'More ticket actions' })`: Expected focused, Received inactive (all four) |
| UI-WR-04 | fixed | 53764c2 | `ticket-merge.spec.ts` › "a merge call that never returns moves focus to Keep tickets separate (review UI-WR-04)"; `ticket-relations.spec.ts` › picker focus check in "a three-ticket cycle is refused…", menu-trigger check after the last link is removed in "a stored link shows on both tickets…", "removing one of two links moves focus to the next link (review UI-WR-04)", "a removal call that never returns keeps focus on its remove button (review UI-WR-04)"; `snooze.spec.ts` › "a refused snooze keeps focus on the chosen preset (review UI-WR-04)", trigger focus checks after snooze (helper), after Wake now, and after waking a closed ticket ("…review C9") | `toBeFocused`, Expected focused, Received inactive, on: "Keep tickets separate"; the picker input; "More ticket actions"; the next chip's link `#N`; the "Remove the link …" button; the "In 3 hours" preset; and, after waking a closed ticket, `getByRole('button', { name: "Snooze. Closed tickets can't be snoozed. Reopen the ticket first." })` (run with only UI-IN-06 fixed). The trigger focus checks after a plain snooze and after Wake now already passed before the fix: the revalidated tree committed before the popover closed. They stay as regression guards and were not seen failing. |
| UI-IN-01 | fixed (styling) | ff039ca | none (pure styling, per pass rules) | n/a |
| UI-IN-03 | fixed | fbe2b1b | `snooze.spec.ts` › "a custom time that is too soon is announced on both fields and clears on edit (review UI-IN-03)" | `toHaveText` on `getByRole('dialog').getByRole('alert')`: Expected `"Pick a time at least 5 minutes from now."`, element(s) not found |
| UI-IN-04 | fixed (styling) | 364dfdd | none (pure styling, per pass rules) | n/a |
| UI-IN-05 | fixed (styling) | 974b952 | none (pure styling, per pass rules) | n/a |
| UI-IN-06 | fixed | 909e0c8 | `snooze.spec.ts` › dialog-name checks in the `snoozeInThreeHours` helper (`"Snooze until"`) and in "Wake now clears the snoozed chip" (`"Change snooze"`) | `toBeVisible` on `getByRole('dialog', { name: 'Snooze until' })` and `{ name: 'Change snooze' }`: element(s) not found |

### What changed

- **UI-WR-01:** New `useHydrated()` (a `useSyncExternalStore` flag: false on the server and during hydration, true after) and `useLocalDateTimeText()` in `local-date-time.tsx`. The chip's aria-label uses the same text as the visible chip: the UTC form marked "UTC" until mount, then the viewer's zone (UI-SPEC 4a). Both forms the spec allows. The visible chip already used `LocalDateTime`.
- **UI-WR-02:** New client `TimeWithLocalTitle` in `local-date-time.tsx`. The feed row keeps its server-rendered relative time. The title starts in the UTC full form (identical to the old string) and switches to the viewer's zone after mount, with the formatter `LocalDateTime` uses. `ActivityEventRow` stays a server component.
- **UI-WR-03:** `TicketActionsMenu` keeps a ref to the "More ticket actions" button. Both dialogs take an optional `onCloseAutoFocus` and forward it to `DialogContent`. The menu's handler prevents the Radix default (which focuses a null `triggerRef`) and focuses the menu button.
- **UI-WR-04:** One fix per case:
  - **Merge, rejected call:** "Keep tickets separate" takes focus.
  - **Link refusal:** `TicketPicker` gains an `inputRef` prop. Focus returns to the picker input once the call ends.
  - **Snooze refusal or rejected call:** focus returns to the control that submitted, or to the callout (`tabIndex={-1}`) when that control stays disabled.
  - **Snooze trigger:** one native `<button>` in all three states (Snooze, snoozed chip, disabled). The tooltip is always mounted, controlled, and only opens while the trigger is disabled. The disabled branch no longer returns a different tree.
  - **Link removal:** focus moves to the link of the chip now at that place, or the one before it. With no chip left, it moves to the menu button. `TicketMetaHeader` now always mounts `LinkedTicketsRow` (it still renders nothing without relations) and shares the menu-button ref. A failed removal refocuses its remove button.
- **UI-IN-01:** `text-[13px]` on the Snoozed toggle only. The pre-existing Status, Tag and Custom field buttons keep `text-[0.8rem]`.
- **UI-IN-03:** The field error has an id and `role="alert"`, both inputs list it in `aria-describedby` and set `aria-invalid` while it shows, and editing either input clears it. The "Enter both a date and a time." branch is kept as a defensive guard: 4c keeps "Snooze ticket" disabled until both fields hold a value, so it is unreachable from the UI, and removing it would orphan its Copywriting row. No copy changed.
- **UI-IN-04:** The `ThreadMessage` header line gets `flex-wrap gap-y-1`.
- **UI-IN-05:** The merged banner wraps, and its paragraph is `grow basis-60`, so the button moves below the text when there is less than 240px for it. The Merge icon in the banner and in the public merged notice sits in an `h-5` box (one 13px line) instead of `mt-0.5`.
- **UI-IN-06:** The popover heading has an id, and `PopoverContent` has `aria-labelledby`.

### Notes for pass F3 (no change made here)

- These new tests overlap UI-WR-08 cases. F3 can extend them instead of adding duplicates:
  - "a merge call that never returns…" covers "Merge outcome unknown".
  - "a refused snooze keeps focus…" covers the closed-ticket snooze refusal.
  - "a custom time that is too soon…" covers the "too soon" validation line.
  - "a removal call that never returns…" covers a failed link removal.
- The removal test only checks that an alert is visible, not its text, because UI-WR-05 item 6 changes that copy in F3.
- UI-WR-08's time-zone block is done here. F3 still owns the rest of UI-WR-08.
- On a host in Asia/Jakarta, the UI-WR-01 assertion only catches a regression when the E2E server runs in another zone (`TZ=UTC pnpm test:e2e …`). Setting the server zone in `global-setup.ts` was not done, because it would change the zone for every other spec.

### Final commands (after all nine commits)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm lint` | 0 | 387 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 268 tests passed |
| `TZ=UTC pnpm test:e2e` `ticket-relations`, `ticket-merge`, `snooze` (one process; before the fixes) | 1 | 16 failed, 10 passed (the seen-failing run) |
| `TZ=UTC pnpm test:e2e` `snooze` (one process; only UI-IN-06 fixed) | 1 | 5 failed, 7 passed |
| `TZ=UTC pnpm test:e2e` `ticket-relations`, `ticket-merge`, `snooze` (one process; after the fixes) | 0 | 26 passed |
| `pnpm test:e2e` `ticket-relations`, `ticket-merge`, `snooze`, `activity-feed`, `public-status`, `a11y-contrast` (one process, host zone) | 0 | 39 passed |

Build, egress, integration and the full E2E suite were not run in this pass. The orchestrator reruns the full gate.
