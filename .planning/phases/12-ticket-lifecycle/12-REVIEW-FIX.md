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
