---
phase: 12-ticket-lifecycle
plan: 05
subsystem: tickets, worker, inbox
status: complete
tags: [snooze, wake, pg-boss, row-lock, auto-close, filters, saved-views, testcontainers, races]
requires: ["12-04"]
provides:
  - "src/lib/tickets/snooze.ts: snoozeTicket(client, actor, { ticketId, until }, { now?, hooks? }), wakeTicket(client, actor, { ticketId }, { hooks? }), SnoozeError, SNOOZE_MIN_LEAD_MS (4 min), SNOOZE_MAX_LEAD_MS (366 d)"
  - "src/app/(app)/tickets/[id]/snooze-actions.ts: snoozeTicketAction(ticketId, untilIso), wakeTicketAction(ticketId)"
  - "src/lib/worker/jobs/snooze-wake.ts: snoozeWakeHandler(data?, { now, batchSize, onWakeTransaction, afterWakeLock }) -> { woken }, wakeDueTicket(tx, ticketId, now, hooks?)"
  - "queue snooze-wake scheduled every minute"
  - "InboxFilters.snoozed?: true (URL snoozed=1), TicketListFilters.snoozed"
affects: [12-06, 12-07, 12-10]
tech-stack:
  added: []
  patterns:
    - "Audit `before` read under SELECT … FOR UPDATE, never from UPDATE … RETURNING (review C6)"
    - "Conditional UPDATE re-checks the deadline in the statement; audit only when a row changed"
key-files:
  created:
    - src/lib/tickets/snooze.ts
    - src/app/(app)/tickets/[id]/snooze-actions.ts
    - src/lib/worker/jobs/snooze-wake.ts
    - tests/integration/snooze.test.ts
    - tests/integration/snooze-race.test.ts
    - tests/unit/snooze-filters.test.ts
  modified:
    - src/lib/worker/index.ts
    - src/lib/tickets/reopen-on-reply.ts
    - src/lib/worker/jobs/auto-close.ts
    - src/lib/tickets/list-filters.ts
    - src/lib/tickets/list-query.ts
decisions:
  - "Snooze and wake are a separate service, not runTicketMutation operations, so the Phase 11 bulk contract is unchanged"
  - "Snooze check order on the locked row: MERGED_SOURCE, TICKET_CLOSED, TOO_SOON, TOO_FAR; the bounds are measured after the lock"
  - "An unparsable or invalid deadline is INVALID (action and service)"
  - "reopenOnCustomerReply takes ReopenTx & TicketAuditTx so the wake audit goes through recordTicketAudit; both callers already pass Prisma transaction clients"
  - "The list query returns snoozedUntil through the existing include (all scalars), so no select change was needed for the 12-07 chip"
metrics:
  duration: "~35 min"
  completed: 2026-11-08
actuals:
  tokens: 12800
  tasks: 3
  commits: 3
plan_head_before: 326f6bb11350b4619c44441c6e49ff2208dbdf89
---

# Phase 12 Plan 05: Snooze, wake job, reply-path wake and the snoozed filter Summary

AIDA-54 is now enforced on the server. An agent snoozes a ticket until a UTC instant. Three things wake it: the every-minute `snooze-wake` pg-boss job, a real customer reply on either reply path, or a manual wake. Auto-close leaves snoozed tickets alone, in both its candidate query and its final UPDATE. The inbox hides snoozed tickets by default, and the new `snoozed` filter shows only them. Stored saved views stay at version 1. Every WOKEN audit takes its `before` value from the deadline it read under the row lock (review C6).

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Snooze service and actions, wake job and schedule | ef0bfd6 | typecheck 0; snooze.test 1/1; tracer gate re-run passed before Task 2 |
| 2 | Refusals, reply-path wake, auto-close skip, Races A/B/B2/C | 236060b | typecheck 0; 5 integration files 47/47 |
| 3 | Snoozed filter in the grammar and the list query | 6d4f5d3 | unit 67/67 (2 files); typecheck 0; snooze.test 10/10 |

## Verification (exit codes, read without a pipe)

- `pnpm typecheck`: 0 after each task. `pnpm exec biome check` on every plan file: 0.
- `pnpm exec vitest run tests/unit/snooze-filters.test.ts tests/unit/inbox-parsers.test.ts`: 0, with 67 passed. `inbox-parsers.test.ts` is unchanged (empty `git diff --stat`).
- `… pnpm test:integration tests/integration/snooze.test.ts`: 0, with 10 passed.
- Final run of `… pnpm test:integration` on snooze, snooze-race, auto-close, reply-reopen-race and merge-reply-race: 0, with 48 passed across the 5 files.
- Regression `… pnpm test:e2e tests/e2e/saved-views.spec.ts`: 0, with 10 passed.
- Forced races. In each one, `waitForBlockedBy` saw the waiter's recorded PID blocked by the holder's PID before the release:
  - **A:** a follow-up holds the row lock in `afterResolve` while the job waits (`onWakeTransaction` PID). Afterwards snoozedUntil is null and there is exactly one WOKEN row, with before = the original deadline. The row's `xmin` equals the reply transaction's xid, which proves the reply path wrote it.
  - **B:** a re-snooze to now + 2 h is held in `beforeCommit` while the job waits. Afterwards the later deadline survives, there is no WOKEN row, and SNOOZED has before = the old deadline.
  - **B2:** the job holds in `afterWakeLock`, after reading the due deadline under the lock, while the re-snooze waits (`onTransactionStart` PID). Afterwards WOKEN has before = the old deadline and after = null, SNOOZED has before = null and after = the new deadline, and the new deadline stays set.
  - **C:** a snooze of a quiet RESOLVED ticket is held in `beforeCommit` while auto-close waits (`onCloseTransaction` PID). Afterwards the ticket is still RESOLVED and snoozed, and there is no AUTO_CLOSED row.
- `pgrep -f 'artisan test'` found nothing before each Docker, Testcontainers or E2E run. The full integration suite and `test:egress` were not run (O-1). No migration, no schema change, no package change, and the env file was not touched. Nothing is sent when a ticket wakes: the agent-route test uses a recording queue double.

## New status readers for Phase 12.1 (D-02)

- Auto-close snooze condition: `src/lib/worker/jobs/auto-close.ts`. Both the candidate query and `closeResolvedTicketIfQuiet`'s UPDATE read `status = 'RESOLVED'` together with `"snoozedUntil" IS NULL`.
- Reply-path wake: `src/lib/tickets/reopen-on-reply.ts` (`reopenOnCustomerReply`), called from `follow-up/route.ts` and `ingest-message.ts`. It wakes and reopens (writes status) in the same locked transaction.
- Snooze filter in the inbox: `src/lib/tickets/list-filters.ts` and `src/lib/tickets/list-query.ts`. The filter reads `snoozedUntil`, and status filters combine with it.
- Snooze refusal of CLOSED tickets: `src/lib/tickets/snooze.ts` (`snoozeTicket` reads `status` and `mergedIntoTicketId` under the row lock).

## Deviations from Plan

1. **[Rule 2] INVALID in the service:** `snoozeTicket` also refuses an invalid `Date` with `INVALID`, not only the action. This was tested.
2. **Reply-path signature:** `reopenOnCustomerReply`'s transaction type is widened to `ReopenTx & TicketAuditTx`, so the WOKEN row goes through the one audit write path. Both callers compiled unchanged.
3. **Test-only env:** both new integration files set a test `RATE_LIMIT_PEPPER`, as 12-04 did. `snooze.test.ts` points `UPLOADS_DIR` at a fresh temp directory and mocks `@/lib/session` and `@/lib/queue/boss-client` for the agent messages route, following `ticket-merge.test.ts`.
4. **Tracer second run:** the second run asserts `{ woken: 0 }` exactly. This holds because integration files run sequentially (`fileParallelism: false`) and the tracer is the first case in its file.
5. **Membership-removal tests:** these call the service through a member whose row was deleted (D-01). The action itself was not tested.

## TDD Gate Compliance

Tasks 2 and 3 are `tdd="true"`. As in 12-01 to 12-04, tests and implementation went into one commit per task (236060b, 6d4f5d3). No separate RED run was recorded, and every new test passed on its first run against the finished code.

## Known Stubs

None. The snooze control, chip and filter UI belong to 12-07.

## Threat model dispositions

- **T-12-23:** membership is the first statement, and the lock carries the organization predicate. Tested for MEMBERSHIP_ENDED, another organization and an unknown id.
- **T-12-24:** the conditional UPDATE re-checks the deadline. Covered by Races A, B and B2.
- **T-12-25:** the predicate is in both auto-close stages. Covered by Race C and the skip-then-wake case.
- **T-12-26:** at most 500 tickets per run, every minute.
- **T-12-27:** automatic mail neither wakes nor reopens. Tested.

## Open

- AIDA-43: older pages and actions still lack the membership check (O-3).

## Self-Check: PASSED

- FOUND: all 6 created files and 5 modified files.
- FOUND commits: ef0bfd6, 236060b and 6d4f5d3. `git rev-list --count 326f6bb..HEAD` = 3 before this SUMMARY.
