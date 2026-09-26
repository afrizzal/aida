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

## Fix pass F4 (Codex diff round 1)

**Scope:** D1, D2, D4 and D5 from the dispositions table in `12-REVIEW.md` ("Codex critique of the phase diff (round 1)"). D3 and D6 were not touched. Each claim was checked against the code at `6e77100` before editing, and all four still held:
- D1: the lock in `runTicketMutation` did not select `mergedIntoTicketId`, and the header status menu was enabled on a merged source.
- D2: the messages route read the ticket (`route.ts:32`) and the body, the email settings and the staged files before the in-transaction membership check (`:104`).
- D4: `MergeFlow` kept the `target` object from the first pick and never replaced it from newer rows.
- D5: `loadStatusPageData` and the attachment route read the ticket and the rows in two separate statements.

**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). Integration and E2E used Testcontainers on Colima. Host zone Asia/Jakarta, no `TZ` override.
**Result:** 4 of 4 fixed. No schema change, no migration, no new package. The provenance predicate (`status-visibility.ts`) is unchanged, and the public page shows no target data.
**Method:** for each finding, the tests were written first and run once against the unfixed code, then the fix was made and the same tests run again. For D1, the E2E before-run had the server fix in place but not the UI fix, so it measured the UI changes. For D5, the test seam was added first without the snapshot, so the before-run shows Codex's failure itself.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| D1 | fixed | e0319cd | `ticket-mutations.test.ts` › "runTicketMutation: a merged source keeps its status (Codex diff round 1, D1)" › "single: …", "bulk: one merged source in the batch refuses the whole batch …", "forced order: a status change observed blocked by a held merge is refused after the merge commits"; `ticket-merge.spec.ts` › "the status control is disabled on a merged source, with its reason (Codex diff round 1, D1)" and "a status change sent after a merge the page did not see is refused and says why …"; `bulk-actions.spec.ts` › "a bulk status change over a merged source changes nothing and says why …" | Integration: `AssertionError: expected { ok: true, count: 1, batchId: null } to deeply equal { ok: false, error: 'MERGED_SOURCE' }` (single and forced order), `expected { ok: true, count: 2, …(1) } to deeply equal { ok: false, error: 'MERGED_SOURCE' }` (bulk). E2E: `toContainText` Expected `"This ticket was already merged."`, Received `"NewOpenPendingResolvedClosed"`; bulk alert Expected substring `"One of the selected tickets was already merged into another ticket, …"`, Received `"Nothing was changed.The change could not be saved. Wait a moment and try again."`; `toBeVisible` on the single-ticket refusal text: element(s) not found |
| D2 | fixed | 2a90d6f | `ticket-merge.test.ts` › "a removed member is refused before anything is read (Codex diff round 1, D2)" › "an existing id: 403 MEMBERSHIP_ENDED and no file is ever written, not even staged", "a missing id: the same 403 MEMBERSHIP_ENDED, never 404", "an invalid body: the same 403 MEMBERSHIP_ENDED, never 400 or 415" | `AssertionError: expected "save" to not be called at all, but actually been called 1 times`; `expected 404 to be 403 // Object.is equality`; `expected 400 to be 403 // Object.is equality` |
| D4 | fixed | c333ec6 | `ticket-merge.spec.ts` › "a link added while the dialog is open shows on the confirm step after Back and Review (Codex diff round 1, D4)" and "a link added after the target was picked shows on the confirm step …" | `toBeVisible` on `getByRole('dialog').getByText('The current link "Child of" between these tickets is replaced by "Duplicate of".')` and on the same line with `"Related to"`: element(s) not found |
| D5 | fixed | 987f0a8 | `status-read-snapshot.test.ts` (new) › "the source token's page shows the pre-merge thread, never an empty one" and "the source token's attachment is still served when the merge commits between the reads" | `AssertionError: expected [] to deeply equal [ 'cmw83ctlp00021sq5l5qz7wty', …(1) ]` (the empty thread); `expected 404 to be 200 // Object.is equality` |

Tests added as guards, not seen failing, because they pin behaviour that already held:
- D1: "other operations on a merged source still apply …", and the unit case "the status refusals on a merged source are exported constants …" in `tests/unit/activity-feed.test.ts`.
- D2: "a removal that commits after the first check is still refused inside the transaction (WR-03 kept)", and "an active member still gets the existing answers for a missing id and an empty body".
- D5: "the target token sees nothing of the source in either snapshot".

No existing assertion was loosened or removed.

### What changed

- **D1:**
  - `runTicketMutation` now selects `mergedIntoTicketId` in its one `FOR UPDATE` statement. A `status` operation is refused with the new `TicketMutationErrorCode` `MERGED_SOURCE` when any locked ticket is a merged source. The whole payload rolls back and nothing is written. Because the check reads the locked rows, a status change that waited on a merge's lock sees the committed merge.
  - Choice: only `status` is refused. Assignee, priority and tags stay changeable, because D-08 keeps them on the source. A test pins this choice.
  - In the header, "Change status" still opens its menu on a merged source, but all five choices are disabled (`aria-disabled`, not hidden). The menu shows `MERGED_SOURCE_REASON` as a 12px muted line, which is also the menu's `aria-describedby`. This mirrors how Merge shows its reason.
  - A page loaded before the merge maps `MERGED_SOURCE` to `STATUS_REFUSED_MERGED_SOURCE`. The bulk bar maps it to `BULK_STATUS_REFUSED_MERGED_SOURCE`, under its existing "Nothing was changed." line.
- **D2:** `findActiveMembership(db, …)` is the first thing the route does after the session, before `params`, the ticket, the form, the email settings or any file. The in-transaction check is kept, and its comment now says it covers a removal that commits after the first check.
- **D4:**
  - `TicketPicker` gains `onRows`, called with every list of rows it shows. Its fetch moved into an exported `fetchPickerRows`; the behaviour is the same.
  - `MergeFlow` replaces its kept choice with the newest row of the same id.
  - "Review merge" re-reads the row by `#number` through the same endpoint before the confirm step. While it reads, the button shows `Loader2` and the picker is disabled.
  - If the re-read fails, the newest row on screen is used. If the fresh row is ineligible, step 1 stays, the choice is cleared, and the picker re-fetches so the row shows its reason.
  - No server change.
- **D5:**
  - `loadStatusPageData` and a new `loadStatusAttachment` (in `status-page-data.ts`) each run their two reads in one `prisma.$transaction` with `isolationLevel: "RepeatableRead"`. The attachment route now calls `loadStatusAttachment`, and the file read stays outside the transaction.
  - The new test seam is `setStatusReadObserverForTests({ afterTicketRead })`, awaited between the two reads.
  - Default transaction timeouts are kept. The reads are plain and take no row lock.

### UI-SPEC rows added (`12-UI-SPEC.md`, additive only; no approved row changed)

1. Status unavailable: merged source: "This ticket was already merged." (D1, reuses `MERGED_SOURCE_REASON`)
2. Status error: merged source: "Nothing was changed. This ticket was already merged, so its status can't change." (D1, `STATUS_REFUSED_MERGED_SOURCE`)
3. Bulk error: merged source (after the "Nothing was changed." line): "One of the selected tickets was already merged into another ticket, so its status can't change. Unselect it and try again." (D1, `BULK_STATUS_REFUSED_MERGED_SOURCE`)

An "Amended … fix pass F4" note at the end of the spec records the D1 menu behaviour and the D4 confirm-step behaviour. D4 adds no copy.

### Notes for the orchestrator (no change made here)

- D6: `12-GATE.md` open item 11 can now say that the messages route checks membership both before any read (D2) and inside its transaction (WR-03).
- D1 refuses a status change only on the source. Snooze already refused merged sources. A merge target is not a merged source and keeps every control.
- D5 uses Prisma's default interactive-transaction timeouts (`maxWait` 2 s, `timeout` 5 s) on the public page and the attachment route. If the connection pool is exhausted, a request now fails with a transaction timeout instead of waiting in the pool.
- At the end of the run, the only container from these runs was Testcontainers' own `ryuk` reaper, which removes itself. No container was created, stopped or removed by hand.

### Final commands (after all four commits)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm lint` | 0 | 389 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 274 tests passed |
| `pnpm test:integration` `ticket-mutations` (D1 block, before the fix) | 1 | 3 failed, 1 passed (the seen-failing run) |
| `pnpm test:e2e` `ticket-merge`, `bulk-actions` `--grep D1` (server fix only, before the UI fix) | 1 | 3 failed |
| `pnpm test:integration` `ticket-merge -t "Codex diff round 1, D2"` (before the fix) | 1 | 3 failed, 1 passed |
| `pnpm test:e2e ticket-merge.spec.ts --grep D4` (before the fix) | 1 | 2 failed |
| `pnpm test:integration` `status-read-snapshot` (seam without the snapshot) | 1 | 2 failed, 1 passed |
| `pnpm test:integration` `ticket-mutations`, `ticket-merge`, `status-read-snapshot`, `merge-provenance`, `merge-race-coverage`, `merge-reply-race` (one process) | 0 | 6 files, 107 tests passed |
| `pnpm test:e2e` `ticket-merge`, `mutations`, `bulk-actions`, `public-status`, `ticket-relations` (one process, host zone) | 0 | 44 passed |

Intermediate runs after each fix: D1 E2E 3 passed; `ticket-mutations` 33 passed; `ticket-merge` integration 43 passed; `ticket-merge` and `ticket-relations` E2E 24 passed; `status-read-snapshot` and `merge-provenance` 9 passed. Build, egress, the full integration suite and the full E2E suite were not run in this pass. The orchestrator reruns the full gate.

## Fix pass F5 (Codex diff round 2)

**Scope:** R2-1 and R2-2 from the dispositions table in `12-REVIEW.md` ("Codex critique of the phase diff (round 2)"). R2-3 was not touched. Both claims were checked against the code at `493c156` before editing, and both still held:
- R2-1: `review()` fell back to the old row when the re-read failed or did not find the row (`latest = … ?? chosen`). `mergeTickets` replaced whatever link it found without comparing it with the link the confirm step named.
- R2-2: `email-outbound-send.ts` took subject, number, recipient and history from `message.ticketId` (`ticketId: message.ticketId`, `message.ticket.subject`).

**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). Integration and E2E used Testcontainers on Colima. Host zone Asia/Jakarta, no `TZ` override.
**Result:** 2 of 2 fixed. No schema change, no migration, no new package. The public status page was not touched and shows no target data.
**Method:** the tests were written first and run once against the unfixed code. For R2-2, the test seam (`setOutboundSendObserverForTests`) was added first without the fix, so the in-flight run shows Codex's failure itself. Then the fix was made and the same tests run again.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| R2-1 | fixed (client and server, one commit) | d26f783 | `ticket-merge.test.ts` › "mergeTickets: the reviewed link is a precondition (Codex diff round 2, R2-1)": the cases "a link added between review and merge is refused…", "a link changed between review and merge is refused…", "the label is compared from the source's side…", "a link removed between review and merge is refused…" and "forced order: a link inserted while the merge waits on the row locks…". `ticket-merge.spec.ts`: "a failed re-read keeps step 1 and the choice, says so and focuses Review merge (Codex diff round 2, R2-1)" and "a link changed after Review is refused with LINK_CHANGED, and Back asks for a new review (Codex diff round 2, R2-1)". Unit: `activity-feed.test.ts` › "copy rows added by Codex diff round 2, R2-1" | Integration (5 of 5): `AssertionError: expected { ok: true, …(2) } to deeply equal { ok: false, error: 'LINK_CHANGED' }`. E2E: `toHaveText` Expected `"Could not check #2 again. Try again."`, element(s) not found; `toHaveText` Expected `"Nothing was changed. The link between these tickets changed. Review the merge again."`, element(s) not found. Unit: `AssertionError: expected undefined to be 'The link between these tickets change…'` |
| R2-2 | fixed (run decision K37, replaces K36) | f3ae1e8 | `email-outbound-merge.test.ts` (new) › "(a) a reply queued on the source, then merged, then sent…" and "(b) in flight: the message is read before the merge and the history after it…" | (a) `AssertionError: expected 'Re: Lifecycle fixture 1fb7dcfd-dd99-4…' to be 'Re: Lifecycle fixture 727d6905-60a9-4…'` (the target's subject); (b) `AssertionError: expected undefined to be '<s1-b5d74e86-…'` (an empty `References` header) |

Tests added as guards, not seen failing, because they pin behaviour that already held:
- R2-1: "unchanged, no link reviewed and none now: the merge proceeds" and "unchanged, the reviewed link is still there: the merge proceeds and replaces it".
- R2-2: "(c) a reply written on the target after the merge keeps the target's thread (regression guard)".

No existing assertion was loosened or removed.

### What changed

- **R2-1, server:**
  - `MergeInput` has a required `reviewedLinkLabel: RelationLabel | null`: the link label from the source's side, or null for no link.
  - After the D-07 checks, under both row locks and before any write or marker draw, `mergeTickets` reads the pair's link and computes `relationLabel(type, relationSideFor(link, source))`. If that differs from the precondition, it refuses with the new `MergeErrorCode` `LINK_CHANGED`. The transaction rolls back, so nothing changes and no audit row is written.
  - The read that was already in place moved up. The replace step uses the row it read.
  - `mergeTicketAction(source, target, reviewedLinkLabel)` passes the precondition through. A missing or unknown value never equals a current link, so it is refused the same way.
- **R2-1, callers:** every other caller states an explicit precondition:
  - Every `mergeTickets` call in the integration and E2E tests and fixtures.
  - The `merge` helper in `ticket-merge.test.ts`, which now takes the precondition as its fourth argument.
  - `heldMerge` and `recordedMerge` in `merge-race-coverage.test.ts`.
  - Linked-pair cases pass the label the merge finds under its locks:
    - "replaces an existing … link": "Related to" and "Parent of".
    - The rollback sentinel case and "a link insert holding both rows…": "Related to".
    - `removeAgainstMerge`: "Related to", or null in the "remove commits" order, with a comment that points at the refusal cases.
- **R2-1, client:**
  - `review()` opens the confirm step only when the re-read returns results that still contain the chosen row.
  - If the read fails, access has ended, or the row is missing, step 1 stays with the choice kept. A destructive `role="alert"` callout shows `mergeRecheckFailedText(n)`, and "Review merge" (new `reviewRef`) takes focus. Picking a row or pressing Review again clears the callout.
  - An aborted read (the dialog closed) still returns silently.
  - The merge sends `chosen.linkLabel ?? null`. `linkLabel` is set exactly when `alreadyLinked` is (UI-WR-06).
  - `mergeErrorMessage` maps `LINK_CHANGED` to `MERGE_ERROR_LINK_CHANGED`, and the `never` check is kept (UI-IN-02). This is a rule refusal: the callout shows, "Merge tickets" is disabled, Back takes focus, and the target is cleared (UI-WR-07).
- **R2-2:**
  - The origin is `message.mergedFromTicketId ?? message.ticketId`.
  - Subject and number come from the origin ticket, read through `scopedDb(orgId).ticket.findFirst`.
  - **Recipient:** read from the origin ticket's contact. Merge refuses different contacts (D-07, K33), so it is the same contact as the current ticket's. The message read no longer includes the contact.
  - **History:** `OR: [{ ticketId: origin }, { mergedFromTicketId: origin }]`, excluding this message, `emailMessageId` not null, `orderBy createdAt asc`, through `scopedDb`.
  - The header comment of the worker records K37.
  - New test seam: `setOutboundSendObserverForTests({ afterMessageRead })`, awaited right after the message read.
  - **SMTP in tests:** no existing test stubbed SMTP for this job; only the egress probe uses a stub SMTP container, and it was not run. The new file mocks `createSmtpTransport` with a fake `sendMail` that records each mail. No SMTP server is contacted.

### UI-SPEC rows added (`12-UI-SPEC.md`, additive only; no approved row changed)

1. Merge error: link changed (after the "Nothing was changed." prefix): "The link between these tickets changed. Review the merge again." (`MERGE_ERROR_LINK_CHANGED`)
2. Merge re-check failed: "Could not check #{target} again. Try again." (`mergeRecheckFailedText`)

An "Amended … fix pass F5" note at the end of the spec records the confirm-step rule. It replaces the F4 sentence "If that read fails, the newest row already on screen is used". The note also records the precondition and that it narrows Assumption 6: the merge replaces only the link the user reviewed.

### Notes for the orchestrator (no change made here)

- No existing integration file tests the outbound send job. The only other path is the egress probe (`egress-fixtures/probe.ts`), which was not run. `email-ingest.test.ts` (inbound) was run alongside as the existing email file.
- The R2-2 row says a reply written on the target keeps "the target's thread". Under K37 that thread is `ticketId = target OR mergedFromTicketId = target`, so it also holds the messages moved into the target. Before K37 it held them too, and guard (c) pins it.
- `12-REVIEW.md` says D3 (K36) was recorded in `deferred-items.md`, but that file has no outbound or K36 entry. With K37 there is nothing to defer. `RUN-LOG.md` still names K36; it was not edited, because it belongs to the orchestrator.
- At the end of the run, the only container from these runs was Testcontainers' own `ryuk` reaper, which removes itself. No container was created, stopped or removed by hand.

### Final commands (after both commits)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm test:integration` `email-outbound-merge`, `ticket-merge -t "R2-1\|R2-2"` (before the fixes, R2-2 seam only) | 1 | 7 failed, 10 passed, 36 skipped (the seen-failing run) |
| `pnpm test:e2e ticket-merge.spec.ts --grep R2-1` (before the fixes) | 1 | 2 failed |
| `vitest run tests/unit/activity-feed.test.ts` (before the fix) | 1 | 1 failed, 15 passed |
| `pnpm lint` | 0 | 390 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 276 tests passed |
| `pnpm test:integration` `ticket-merge`, `merge-provenance`, `merge-race-coverage`, `merge-reply-race`, `ticket-relations`, `ticket-mutations`, `snooze`, `status-read-snapshot`, `email-outbound-merge`, `email-ingest` (one process) | 0 | 10 files, 158 tests passed |
| `pnpm test:e2e` `ticket-merge`, `ticket-relations`, `public-status`, `bulk-actions` (one process, host zone) | 0 | 41 passed |

Intermediate runs: after R2-1, the eight touched integration files passed 149 of 149 and `ticket-merge.spec.ts` passed 17 of 17. After R2-2, `email-outbound-merge` passed 3 of 3. `bulk-actions.spec.ts` was added to the E2E run because its `mergeTickets` fixture call changed. Build, egress, the full integration suite and the full E2E suite were not run in this pass. The orchestrator reruns the full gate.

## Fix pass F6 (Codex diff round 3)

**Scope:** R3-1 only, from the dispositions table in `12-REVIEW.md` ("Codex critique of the phase diff (round 3, last)"), run decision K38 (refines K37). R3-2 and R3-3 were not touched, and neither were the merge service and the UI. Before editing, the claim was checked against the code at `13fda37` and still held: the history read was `OR: [{ ticketId: originTicketId }, { mergedFromTicketId: originTicketId }]`, so a target's thread also took every message moved into it.

**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). Integration tests used Testcontainers on Colima. The SMTP transport is the file's fake (`vi.mock` of `createSmtpTransport`). No SMTP server was contacted and no email was sent.
**Result:** 1 of 1 fixed. No schema change, no migration, no new package.
**Method:** the tests were changed and added first, then run once against the unfixed code, where they failed. After that the fix was made and the same file was run again.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| R3-1 | fixed (run decision K38, refines K37) | 0c98bef | `email-outbound-merge.test.ts` › "(c) a reply written on the target after the merge keeps the target's own thread (K38)" (corrected), "(d) a source with a long history merged into the target: a target reply keeps the target's ids in References (K38)" (new), "(e) a target reply whose first send fails before the merge and is retried after it keeps the same References and In-Reply-To (K38)" (new) | (c) `AssertionError: expected '<s1-…' to be '<t1-…'`, Expected `"<t1-…> <t2-…>"`, Received `"<s1-…> <t1-…> <s2-…> <t2-…> <s3-…>"` (line 225, `References`). (d) `AssertionError: expected '<s3-…' to be '<t1-…'`, Received `"<s3-…> … <s12-…>"`: ten source ids, both target ids pushed out by the cap (line 259). (e) `AssertionError: expected '<s1-…' to be '<t1-…'` at `expect(retry.references).toBe(first.references)` (line 295): the failed first send before the merge carried `<t1> <t2>`, the retry after it carried `<s1> <t1> <s2> <t2> <s3>` |

Cases (a) and (b) were not changed, and they passed both before and after the fix. Test (c) used to assert `References` `s1 t1 s2 t2 s3` and `In-Reply-To` `s3`. It now asserts `t1 t2` and `t1`. This is a stricter expectation that replaces one the old code met, not a looser one. No other assertion was changed or removed.

### What changed

- **`src/lib/worker/jobs/email-outbound-send.ts`:**
  - The history `where` is now `OR: [{ ticketId: origin, mergedFromTicketId: null }, { mergedFromTicketId: origin }]`. It still excludes this message, keeps `emailMessageId` not null and `orderBy createdAt asc`, and still reads through `scopedDb`.
  - The origin is still `mergedFromTicketId ?? ticketId`.
  - The header comment now records K38. It also records the known edge: after a merge, an inbound reply the customer sends in the source's old email thread is created on the target (ingest follows `mergedIntoTicketId`) with `mergedFromTicketId` null, so it counts in the target's thread.
- **`tests/integration/email-outbound-merge.test.ts`:**
  - The fake transport now also records every attempt in `attempts` and can refuse the next send (`failNext`). Nothing about `sent` changed for cases (a) and (b).
  - `afterEach` resets both fields and restores the `console.error` spy that (e) uses.
  - (c) is corrected as described above.
  - (d) seeds `t1` and `t2`, then twelve newer email-bearing source messages, merges, and checks that a target reply's `References` is exactly `t1 t2` with no source id in it.
  - (e) runs a target reply that fails once before the merge (the handler rethrows and the message becomes `FAILED`), merges, then runs the retry. The retry has the same `References`, `In-Reply-To` and subject as the failed attempt and ends `SENT`.

### Note for the orchestrator (no change made here)

- **Chained merges are still open.** Say A merges into B, then B merges into C. The merge sets `mergedFromTicketId = B` on every row whose `ticketId` is B. That includes A's messages, which overwrites their `A`. Two things follow:
  - B's thread is B's own messages before the second merge, and B's plus A's after it. A B reply that fails before B→C and is retried after it would get different headers.
  - A queued reply written on A would take B as its origin.
- This comes from the merge service (`merge.ts` move step), which is outside this pass and was not changed. The old K37 clause had the same overwrite.

### Final commands (on the committed fix content)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm test:integration email-outbound-merge` (before the fix, tests changed and added) | 1 | 3 failed, 2 passed (the seen-failing run) |
| `pnpm test:integration email-outbound-merge` (after the fix) | 0 | 5 passed |
| `pnpm lint` | 0 | 390 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 276 tests passed |
| `pnpm test:integration email-outbound-merge ticket-merge merge-provenance email-ingest` (one process) | 0 | 4 files, 67 tests passed |

Before every Docker command, `pgrep -f 'artisan test'` printed nothing. Egress, E2E and build were not run. The only container left from these runs was Testcontainers' own `ryuk` reaper, which removes itself. No container was created, stopped or removed by hand. `aida-dev-db` was already running before this pass and was not touched.

## Fix pass F7 (review of F6)

**Scope:** F6-WR-01, F6-WR-02, F6-IN-01, F6-IN-02, F6-IN-03 (comment only) and F6-IN-04 from `12-REVIEW-F6.md`, as disposed in `12-REVIEW.md` ("Independent review of fix pass F6"). Only `src/lib/worker/jobs/email-outbound-send.ts` and `tests/integration/email-outbound-merge.test.ts` were changed. Both warnings were checked against the code at `0c98bef` before editing, and both still held: the history query had no bound against the reply, and `References` was the thread's own ids only.

**Where it ran:** main checkout, branch `v2/run-loop` (`workflow.use_worktrees` is `false`). Integration tests used Testcontainers on Colima. The SMTP transport is the file's fake. No SMTP server was contacted and no email was sent. The customer replies in (e) and (f) go through the real `ingestMessage` (mailparser, header thread-match), with no mock.
**Result:** 6 of 6 done: 5 fixed, IN-03 as a comment. No schema change, no migration, no new package.
**Method:** one cycle per commit. The test was written first and run against the code as it stood, where it failed. Then the fix was made and the same file was run again.

| ID | Status | Commit | Test | Failing assertion seen before the fix |
|----|--------|--------|------|------------------------------------|
| F6-WR-02 | fixed | a58b3ed | `email-outbound-merge.test.ts` › "(e) a target reply whose first send fails before the merge and is retried after it…" (extended: after the merge and before the retry, a customer reply in the source's old thread is ingested and lands on the target with `mergedFromTicketId` null) | `AssertionError` at `expect(retry.references).toBe(first.references)` (line 342): Expected `"<t1-…> <t2-…>"`, Received `"<t1-…> <t2-…> <reply-…@customer.test>"`. 1 failed, 4 passed |
| F6-WR-01 | fixed | 38afb4a | `email-outbound-merge.test.ts` › "(f) a customer reply in the source's old thread after the merge: a target reply answers it and References carries its chain first (F6-WR-01)" (new) | `AssertionError` at the `References` assertion (line 380): Expected `"<s1-…> <s2-…> <s3-…> <t1-…> <t2-…> <reply-…>"`, Received `"<t1-…> <t2-…> <reply-…>"`. The `In-Reply-To` assertion just before it already passed. 1 failed, 5 passed |
| F6-IN-02 | fixed | 6d842ba | `email-outbound-merge.test.ts` › "(g) two messages with the same createdAt are ordered by seq, whatever order the table returns them in (F6-IN-02)" (new) | `AssertionError` at the `References` assertion (line 427): Expected `"<tie-b-…> <tie-a-…>"`, Received `"<tie-a-…> <tie-b-…>"`. 1 failed, 6 passed. See the note below: the first two versions of this test passed against the unfixed code |
| F6-IN-01 | fixed (test only) | 6d842ba | (e): `first.messageId` equals the `emailMessageId` saved by the failed attempt, `retry.messageId` equals `first.messageId`, and `References` never names it. `SentMail` gained `messageId` | Not seen failing: a guard. The reuse already held (`message.emailMessageId ?? buildOutboundMessageId`) |
| F6-IN-03 | comment | 6d842ba | none | Not applicable. One line in the worker header: the status page answers what a token holder may see (D-09), this job answers which thread a reply joins (K38) |
| F6-IN-04 | fixed | 6d842ba | none | Not applicable. The describe title is now "(R2-2 K37, R3-1 K38)", and the header comment is rewrapped at 100 |

No existing assertion was loosened or removed. Cases (a) to (d) were not changed, and they passed in every run of this pass.

### What changed

- **F6-WR-02:** the history `where` keeps the K38 clause `(ticketId = origin AND mergedFromTicketId IS NULL) OR mergedFromTicketId = origin`, keeps `emailMessageId` not null and still reads through `scopedDb`. It adds `seq: { lt: message.seq }`. `message.seq` comes from the existing `findUnique`, which returns every scalar column. `seq` is drawn at insert and a merge keeps it, so the bound is the same on every attempt. It also excludes the message itself, so `id: { not: message.id }` was removed. The (e) assertion `References` never names its own Message-ID pins that.
- **F6-WR-01:** `In-Reply-To` stays the last inbound in the bounded history. `References` is now `[...new Set([...(lastInbound?.emailReferences ?? []), ...ownIds])]`: the parent's stored References (as ingest saved them, already capped to 10), then the thread's own ids, the parent's Message-ID among them, in first-seen order. `composeMail` is unchanged and still keeps the last 10 entries. The comment says what survives the cap: the thread's own ids first (the newest ten when there are more), then whatever room is left goes to the parent's chain, oldest ids dropped first. For a thread with no merge, when the customer's References only name ids of the thread, the set of ids is the same as before. The order changes only if those References skip an earlier id or list the ids in another order: the ids they name then come first. The header comment no longer says that a target reply threads on the target's own messages only. It now describes the post-merge source-thread reply and how its chain is carried.
- **F6-IN-02:** `orderBy: [{ createdAt: "asc" }, { seq: "asc" }]`.
- **Tests:** the new helper `customerReply` builds a real RFC message with `MailComposer`, runs it through `ingestMessage`, asserts `"appended"`, and returns the stored row.

### Note on the IN-02 test

The tie only shows when the access path returns the later message first. The first version of (g) changed `bodyHtml` on the first message. It passed against the unfixed code, because that update is HOT and the index entry keeps the old row position. The second version also gave the first message the greater Message-ID. It passed too. The third version creates the first message with a placeholder Message-ID and then sets the real one. That update changes an indexed column, so it writes new index entries after the second message's, and the test failed against the unfixed code as shown above. Whether the unfixed query returns the wrong order depends on the plan Postgres picks, so the seen-failing evidence holds for this database and this data. After the fix the order is total and does not depend on the plan.

### Note for the orchestrator (no change made here)

- The chained-merge note from F6 still stands: `merge.ts` overwrites `mergedFromTicketId` when a merged target is merged again. Nothing in this pass changed that.
- `emailReferences` is customer header data. It now goes into `References` of a reply to the ticket's contact, as the inbound Message-IDs already did. mailparser splits the header into ids and ingest caps it to 10. No new egress, and the recipient is unchanged.

### Final commands (on the committed fix content)

| Command | Exit | Counts |
|---------|------|--------|
| `pnpm test:integration email-outbound-merge` before WR-02 fix | 1 | 1 failed, 4 passed |
| same, after WR-02 fix | 0 | 5 passed |
| same, before WR-01 fix (test (f) added) | 1 | 1 failed, 5 passed |
| same, after WR-01 fix | 0 | 6 passed |
| same, before IN-02 fix (test (g), versions 1 and 2) | 0 | 7 passed (test did not show the tie) |
| same, before IN-02 fix (test (g), version 3) | 1 | 1 failed, 6 passed |
| same, after IN-02 fix | 0 | 7 passed |
| `pnpm lint` | 0 | 390 files checked, no fixes |
| `pnpm typecheck` | 0 | clean |
| `pnpm test` | 0 | 27 files, 276 tests passed |
| `pnpm test:integration email-outbound-merge ticket-merge merge-provenance email-ingest` (one process) | 0 | 4 files, 69 tests passed (67 at F6, plus (f) and (g)) |

Before every Docker command, `pgrep -f 'artisan test'` printed nothing. Egress, E2E and build were not run. The only container left from these runs was Testcontainers' own `ryuk` reaper, which removes itself. No container was created, stopped or removed by hand. `aida-dev-db` was already running and was not touched.
