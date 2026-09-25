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

## Fix pass F3 (UI copy, merge confirm and E2E)

**Scope:** UI-WR-05, UI-WR-06, UI-WR-07, the rest of UI-WR-08 and UI-IN-02 (`12-REVIEW-c.md`), plus UI-K34 (orchestrator dispositions, follow-up of run decision K34). All six were checked against the code at `75ed5c7` before editing, and all six still held. UI-WR-05's six strings were all still in the code without a row, and items 2 and 6 still showed "none", the raw enum key and "may have been saved". UI-WR-06's `?? "Related to"` fallback was still there. UI-WR-07: the picker still started empty after Back. UI-IN-02: the `default: return null` branch was still there. UI-K34: `pickerReason` still checked only `alreadyLinked` in link mode, and the Link item had no disabled state.
**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). Integration and E2E used Testcontainers on Colima. The host and the E2E server ran in Asia/Jakarta, with no `TZ` override in any run.
**Result:** 6 of 6 fixed. No schema change, no migration, no new package. The public status page was not touched.
**Method:** all new and extended tests were written first and run once against the unfixed code. E2E before-run: 6 failed, 29 passed. The 6 failures were the six new behaviour tests. Every coverage-only case passed, because those paths already worked. The test files were then reset, and each finding's tests went into the commit with its fix. At the end, every test file was byte-identical to the before-run version.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| UI-IN-02 | fixed (no reachable behaviour change) | b5d7a99 | none: dead code. The `never` check makes `typecheck` fail if a new code has no row. | n/a |
| UI-WR-05 | fixed | d7cba59 | `tests/unit/activity-feed.test.ts` › "copy rows added by the review …": "each new row is one exported constant …", "the former member mid-sentence comes from its constant", "a missing status or priority reads as the missing-value row", "an unknown status or priority value uses the other row, never the raw key"; `ticket-relations.spec.ts` › "a removal call that never returns keeps focus on its remove button" now also asserts the text | Unit: first `Error: Cannot find module '../../src/lib/tickets/lifecycle-copy'`. With the constants in place and the label logic still old: `expected 'Ann changed the priority from none to…' to be 'Ann changed the priority from no valu…'` and `expected 'Ann changed the status from ARCHIVED …' to be 'Ann changed this ticket.'`. E2E `toHaveText`: Expected `"…The link may have been removed…"`, Received `"…The link may have been saved…"` |
| UI-WR-06 | fixed | 0c2c528 | `tests/integration/ticket-picker.test.ts` › "linkLabel gives the current link from the current ticket's side, null when unlinked" and "linkLabel never reports a link of another organization"; the row-key checks (service and route) now list `linkLabel`; `ticket-merge.spec.ts` › "the confirmation names a link added after the page loaded"; unit `mergeReplacesLinkText` | Integration: `expected { alreadyLinked: true, …(1) } to deeply equal { alreadyLinked: true, …(1) }`, `expected [ [ …(3) ] ] to deeply equal [ [ …(3) ] ]`, `expected [ 'alreadyLinked', 'id', …(5) ] to deeply equal [ 'alreadyLinked', 'id', …(6) ]` (2×). E2E `toBeVisible` on `'The current link "Child of" between these tickets is replaced by "Duplicate of".'`: element(s) not found |
| UI-WR-07 | fixed | d4d4e3d | `ticket-merge.spec.ts` › "Back from the confirm step shows the kept choice" and "after a rule refusal, Back asks for a new pick" | `toHaveValue` on the picker input: Expected `"28"`, Received `""`; `toBeDisabled` on "Review merge": Expected disabled, Received enabled |
| UI-WR-08 | fixed (tests) | f1d30d1 | `ticket-merge.spec.ts` › new "a rule refusal names the rule, disables Merge tickets and focuses Back"; F2's "a merge call that never returns…" now also asserts Back disabled. `snooze.spec.ts` › new "a snooze call that never returns shows the outcome unknown callout" and "a custom time more than 365 days ahead is refused on the client"; F2's "a refused snooze keeps focus…" now also asserts the popover stays open with no success toast. "Too soon" stays covered by F2's UI-IN-03 test, and the failed link removal is covered by the UI-WR-05 row. Time-zone block: see below | Coverage only. These paths already worked, so every case passed in the before-run. Time-zone block, Asia/Jakarta host, no `TZ`, UI-WR-01 fix reverted locally and not committed: `toHaveAccessibleName` Expected `"Snoozed until Tue, Nov 10, 09:00. Change or wake."`, Received `"Snoozed until Wed, Nov 11, 02:00. Change or wake."` (1 failed, 2 passed). With the fix restored: 3 passed |
| UI-K34 | fixed | f5bb311 | `ticket-relations.spec.ts` › "the link picker marks a merged source unavailable (run decision K34)" and "Link a ticket… is disabled on a merged source, with its reason (run decision K34)"; unit constants | `toHaveAttribute("aria-disabled", "true")` on the picker row: Expected `"true"`, Received `"false"`; on the "Link a ticket…" menu item: Expected `"true"`, Received `""` |

### What changed

- **UI-IN-02:** `mergeErrorMessage` maps all seven `MergeErrorCode` values and ends in `const unhandled: never = code`. `MergeFailure` lost its `rule` flag. Every returned refusal is a rule refusal: Back takes focus and "Merge tickets" stays disabled. A thrown error is still "Merge outcome unknown".
- **UI-WR-05:** New `src/lib/tickets/lifecycle-copy.ts` (pure, client-safe). It exports `MERGED_BANNER_DATE_UNKNOWN`, `MERGED_COMPOSER_TARGET_UNAVAILABLE`, `MERGE_CONFIRM_DESCRIPTION` and `LINK_REMOVE_OUTCOME_UNKNOWN`. `activity-copy.ts` exports `ACTOR_FORMER_MEMBER_MID_SENTENCE` and `MISSING_VALUE`. The banner, composer line, merge dialog, linked-tickets row and feed use these constants verbatim. Status and priority feed rows go through `changeParts`:
  - a missing value gives "no value";
  - an unknown value or a non-string gives the "Feed events: other" row ("{actor} changed this ticket."), keeping the action's icon.
- **UI-WR-06:** `searchTicketsForPicker` returns `linkLabel` (`RelationLabel | null`):
  - It is computed with `relationLabel(type, relationSideFor(r, current.id))`.
  - It comes from the same relation query as `alreadyLinked`. That query is filtered by `organizationId: actor.orgId` and the current ticket, and still runs after the membership check and the organization-scoped read of the current ticket.
  - The allow-list comment in `ticket-picker.ts` and the route comment list the eight fields.
  - The confirmation shows `mergeReplacesLinkText(reviewed.linkLabel ?? null)`, so with no label it shows the generic row, never a guessed type.
  - The `linkLabels` prop chain (meta header → actions menu → merge dialog) is removed.
- **UI-WR-07:** `TicketPicker` takes an optional controlled `query`/`onQueryChange`. `MergeFlow` holds the search text, so Back remounts step 1 with the same search, and the re-fetched rows show the chosen row checked. The confirm step renders a separate `reviewed` row. A rule refusal clears the picker's `target`, so after Back "Review merge" is disabled until the user picks again, and the refreshed rows show the refused ticket with its reason (for example "Already merged into another ticket").
- **UI-K34:** `pickerReason` checks `mergedSource` first for both purposes and returns `PICKER_REASON_MERGED`. `TicketActionsMenu` disables "Link a ticket…" on a merged source and shows `MERGED_SOURCE_REASON` as a second 12px muted line, with the same markup as Merge. `mergeUnavailableReason` uses the same constant.
- **UI-WR-08, time zones:** The viewer zone is chosen at module load: the first of Asia/Jakarta (deadline 02:00 UTC) and Pacific/Honolulu (19:00 UTC) whose rendering differs from the host zone's. Neither zone has daylight saving. All expected strings are computed for that zone. A guard test and an in-test `hostText !== local` check fail loudly if the block could not tell the two zones apart. On this Asia/Jakarta host, the block runs in Pacific/Honolulu.

### UI-SPEC rows added (`12-UI-SPEC.md`, additive only; no approved row changed)

1. Link remove outcome unknown: "The result is not known. The link may have been removed. Refresh the page to check before you try again." (UI-WR-05)
2. Merge confirm description (sr): "Review what happens before you merge these tickets." (UI-WR-05)
3. Merged banner, date unknown (fills {date}): "an earlier date" (UI-WR-05)
4. Merged composer line, target unavailable: "Replies go on the ticket this one was merged into." (UI-WR-05)
5. Actor: former member (mid-sentence): "a former member" (UI-WR-05)
6. Feed events: missing value (fills {before} or {after}): "no value" (UI-WR-05)
7. Merge replaces link, label unknown: 'The current link between these tickets is replaced by "Duplicate of".' (UI-WR-06)
8. Link unavailable: merged source: "This ticket was already merged." (UI-K34)
9. Picker reason: merged (link dialog): "Already merged into another ticket" (UI-K34)

An "Amended … fix pass F3" note at the end of the spec records each row and the UI-WR-07 and K34 behaviour, including that a merged source is now also a link-dialog reason (Surface 2c said only "Already linked" applied).

### Notes for the orchestrator (no change made here)

- After UI-IN-02, the approved row "Merge error: unknown" and the 3a sentence "'Merge tickets' stays enabled only for the 'unknown' refusal" describe a path no code reaches. The rows were left unchanged, because approved rows are never edited. Removing or re-wording them is a spec decision.
- The picker's `alreadyLinked`/`linkLabel` are read when the row is fetched. A link added between picking and confirming is still not shown. The server's merge replaces whatever link exists inside its transaction (Assumption 6), so only the wording of that line can be stale, never the result.
- Coverage-only UI-WR-08 cases cannot be seen failing without breaking the product. Each was checked to assert the exact spec text or state.

### Final commands (after all six commits)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm lint` | 0 | 388 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 273 tests passed |
| `pnpm test:integration` `ticket-picker` (one process; before the fixes) | 1 | 4 failed, 6 passed (the seen-failing run) |
| `pnpm test:integration` `ticket-picker`, `ticket-relations`, `ticket-merge`, `activity-feed` (one process) | 0 | 4 files, 77 tests passed |
| `pnpm test:e2e` `ticket-relations`, `ticket-merge`, `snooze` (one process; before the fixes) | 1 | 6 failed, 29 passed (the seen-failing run) |
| `pnpm test:e2e snooze.spec.ts --grep "viewer's time zone"` (UI-WR-01 fix reverted locally, host zone) | 1 | 1 failed, 2 passed |
| `pnpm test:e2e snooze.spec.ts --grep "viewer's time zone"` (fix restored, host zone) | 0 | 3 passed |
| `pnpm test:e2e` `ticket-relations`, `ticket-merge`, `snooze`, `activity-feed`, `public-status`, `a11y-contrast` (one process, host zone) | 0 | 48 passed |

Intermediate runs: `ticket-merge.spec.ts` after UI-WR-07, 10 passed; `ticket-relations.spec.ts` after UI-K34, 9 passed. Build, egress, the full integration suite and the full E2E suite were not run in this pass. The orchestrator reruns the full gate.
