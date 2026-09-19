---
phase: 12-ticket-lifecycle
plan: 04
subsystem: public-status, tickets, email-ingest
status: complete
tags: [merge, provenance, status-token, row-lock, savepoint, attachments, csat, testcontainers, races]
requires: ["12-01", "12-03"]
provides:
  - "src/lib/tickets/status-page-data.ts: loadStatusPageData(token) -> { ticketId, number, subject, status, contact, merged, mergedAt, messages, csat } | null"
  - "src/lib/tickets/reopen-on-reply.ts: resolveReplyTicket(tx, orgId, tokenTicketId) -> { ok: true, ticketId } | { ok: false, error: 'TICKET_UNAVAILABLE' }; ReplyTicketChangedError; observer hooks beforeLock/onResolveStart/afterRelock/afterResolve"
  - "POST /api/public/status/{token}/follow-up: lands on the merge target; 409 { error: 'TICKET_CHANGED' }; TICKET_UNAVAILABLE -> 404 { error: 'not_found' }; staged files discarded whenever no message commits"
  - "GET /api/public/status/{token}/attachments/{id}: served only when isMessageVisibleForToken passes, else the unknown-id 404"
affects: [12-06, 12-10]
tech-stack:
  added: []
  patterns:
    - "Reply path locks only through lockTicketsInIdOrder, with one bounded SAVEPOINT relock"
    - "One loader per public page, fed only by the shared provenance predicate"
key-files:
  created:
    - src/lib/tickets/status-page-data.ts
    - tests/integration/merge-provenance.test.ts
    - tests/integration/merge-reply-race.test.ts
  modified:
    - src/app/(public)/status/[token]/page.tsx
    - src/app/api/public/status/[token]/attachments/[id]/route.ts
    - src/lib/tickets/reopen-on-reply.ts
    - src/app/api/public/status/[token]/follow-up/route.ts
    - src/lib/channels/email/ingest-message.ts
decisions:
  - "resolveReplyTicket runs the 11-04 beforeLock observer before its own first lock (a WeakSet stops reopenOnCustomerReply from running it twice), so the 11-04 race tests still record the reply PID before any lock"
  - "On success resolveReplyTicket releases its savepoint (RELEASE SAVEPOINT keeps every row lock until the transaction ends)"
  - "The follow-up route validates every file before storing any, so 413/415 leave no file either (as 12-03 did for the agent route)"
  - "Ingest: TICKET_UNAVAILABLE from resolveReplyTicket throws inside the ingest transaction (rollback); unreachable without a ticket delete or an organization move"
  - "ReplyTicketChangedError (second mismatch after the relock) is unreachable under D-07: mergedIntoTicketId is write-once and chains are refused; its forced test belongs to 12-10 through the afterRelock seam"
metrics:
  duration: "~40 min"
  completed: 2026-11-08
actuals:
  tokens: 15300
  tasks: 3
  commits: 3
plan_head_before: 4b5e7edc0c1f367c1ea4611d2ad5413c3c909821
---

# Phase 12 Plan 04: Status links and replies after a merge Summary

Both status links of a merged pair keep working and show only what D-09 allows. One loader, fed by `statusMessageWhere`, backs the page. The attachment route serves a file only when `isMessageVisibleForToken` passes. Follow-ups and inbound email to a merged source reach the target through `resolveReplyTicket`, which locks only through 12-03's `lockTicketsInIdOrder`, re-checks under the lock and relocks at most once through `ROLLBACK TO SAVEPOINT`. Proven by 17 Testcontainers cases: 6 for provenance and 11 for replies and races. Seven of those are PID-bound forced-order races, and none ends in 40P01.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Loader, page, attachment route, tracer | 0728a0d | typecheck 0; integration 1/1; tracer gate passed before Task 2 |
| 2 | Reply paths under the shared lock order, races, C7 storage | 0277dd2 | typecheck 0; lint 0; integration 23/23 (3 files) |
| 3 | Two-token matrix, CSAT, refused two-contact, empty source | bf464cd | typecheck 0; lint 0; integration 6/6 |

## Verification (exit codes)

- `pnpm typecheck`: 0 after each task. `pnpm exec biome check` on all 8 plan files: 0.
- `… pnpm test:integration tests/integration/merge-provenance.test.ts`: 0, 6 passed.
- `… pnpm test:integration tests/integration/merge-reply-race.test.ts tests/integration/reply-reopen-race.test.ts tests/integration/email-ingest.test.ts`: 0, 23 passed (11 new, plus 12 existing reopen and ingest cases).
- Regression `pnpm test:e2e tests/e2e/public-status.spec.ts`: 0, 3 passed.
- Forced races. In each one, `waitForBlockedBy` saw the waiter's recorded PID blocked by the holder before the release. Both sides fulfilled, and the merge was whole (S CLOSED into T, no message left on S):
  - Race 1, target id first and source id first: the merge is held in beforeCommit and the follow-up through S's token waits. The message lands once on T with `mergedFromTicketId` null, visible to both tokens.
  - Race 2, both id orders: the follow-up, with one PDF, holds S's row in afterResolve and the merge waits. The message lands once on T with `mergedFromTicketId` = S. S's page lists it and the attachment route serves the PDF for S's token. T's page omits it and the route answers 404 for T's token (review C2).
  - Race 3: the merge is held and an email carrying S's number (no known headers) waits. It lands once on T.
  - Race 4: S is already merged, and a holder locks S and T through `lockTicketsInIdOrder`. The follow-up waits behind it, then lands once on T.
- Review C7 storage: UPLOADS_DIR points at a fresh mkdtemp directory. Two cases, each with two attachments: a sentinel thrown in afterResolve rejects with exactly that sentinel, and TICKET_UNAVAILABLE (onResolveStart moves the ticket to another organization) answers 404 `not_found`. Both leave zero files and unchanged message, attachment and audit counts.
- `pgrep -f 'artisan test'` found nothing before each Docker, Testcontainers or E2E run. The full integration suite and `test:egress` were not run (O-1). No migration, no schema change, no package change, and the env file was not touched.

## Residual retry (D-10)

The only retry is `resolveReplyTicket`'s single `ROLLBACK TO SAVEPOINT reply_resolve` relock, taken when a merge committed while the reply waited on the token row. A second mismatch is **unreachable under D-07** (mergedIntoTicketId is write-once, and chains are refused). If one happens anyway, `ReplyTicketChangedError` is thrown before any write. The follow-up route then discards its staged files and answers 409 `{ error: "TICKET_CHANGED" }`, and ingest propagates the error unchanged. Plan 12-10 forces this branch through the `afterRelock` seam.

## New status readers for Phase 12.1 (D-02)

- `src/lib/tickets/status-page-data.ts`: reads the token ticket's status for the public page header and CSAT eligibility, and never the target's status.
- `src/app/(public)/status/[token]/page.tsx`: renders the token ticket's own status and shows CSAT for RESOLVED/CLOSED.
- `src/app/api/public/status/[token]/csat/route.ts`: unchanged, and it reads the token ticket's own status (a merged source is CLOSED, so it is eligible).
- Reply-path redirect: `src/lib/tickets/reopen-on-reply.ts` (`resolveReplyTicket`) feeds `reopenOnCustomerReply`, which writes the effective ticket's status, from `follow-up/route.ts` and `ingest-message.ts`.

## Deviations from Plan

1. **[Rule 3] Test-only `RATE_LIMIT_PEPPER`.** Both new test files set this test value before any import, as `reply-reopen-race.test.ts` does. Without it the public routes throw.
2. **[Rule 2] The follow-up route validates every file before storing any.** Before this change, an earlier file could be orphaned when a later file got 413/415.
3. **Observer extension:** `setReopenObserverForTests` accepts the 11-04 function form, which becomes `beforeLock`, or an object with `onResolveStart`, `afterRelock` and `afterResolve`. Callers record PIDs through `backendPid(tx)` in a callback.
4. **Snooze wake:** neither reply path has a snooze wake yet (12-05 adds it). The automatic-mail case asserts that the target's `snoozedUntil` and RESOLVED status are unchanged. The reply-path wake on the effective ticket belongs to 12-05.
5. **Task 3:** CSAT got its own case, so the file has 6 `it(` blocks. The page, attachment and follow-up matrix stays one case. The CSAT route needed no change.
6. The loader also returns the token ticket's own `contact` (for the existing "Ticket reopened" row) and `ticketId`. A test pins the full key set and checks that no target id appears.

## TDD Gate Compliance

Tasks 2 and 3 are `tdd="true"`. As in 12-01 to 12-03, tests and implementation were committed together, one commit per task (0277dd2, bf464cd). No separate RED run was recorded. Task 2's first run failed only on the missing test pepper (9 failed), and the behaviour code was unchanged when it went green.

## Known Stubs

None.

## Threat model dispositions

T-12-18 to T-12-23 are mitigated as planned. T-12-18 and T-12-19: a single loader and a single predicate, with tests on two tokens and the unknown-id 404. T-12-20 and T-12-23: the redirect runs under the lock in the shared id order, with Races 1 to 4 in both id orders and no 40P01. T-12-21: the subject-number fallback lands on a target of the same contact. T-12-22: CSAT is per token, with a test.

## Self-Check: PASSED

- FOUND: all 3 created and 5 modified files.
- FOUND commits: 0728a0d, 0277dd2, bf464cd (`git rev-list --count 4b5e7ed..HEAD` = 3 before this SUMMARY).
