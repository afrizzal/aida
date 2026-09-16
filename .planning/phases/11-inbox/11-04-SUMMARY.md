---
phase: 11-inbox
plan: 04
subsystem: tickets, worker, email-ingest, public-status, settings-ui
status: complete
tags: [auto-close, pg-boss, settings, row-locks, for-share, race-proofs, testcontainers, e2e]
requires:
  - "11-01: parseAutoCloseDays, recordTicketAudit, findActiveMembership, getSessionActor, lock-wait helpers, inbox fixtures"
provides:
  - "src/lib/tickets/auto-close-settings.ts: AUTO_CLOSE_DAYS_KEY, AUTO_CLOSE_ENABLED_AT_KEY, readAutoCloseSettings, lockAutoCloseSettings (hooks.afterShareLock), saveAutoCloseDays (opts { now, hooks: { onTransactionStart, beforeCommit } })"
  - "src/lib/worker/jobs/auto-close.ts: autoCloseHandler(data?, { now, log, onCloseTransaction }) returning per-org counts, closeResolvedTicketIfQuiet(tx, { orgId, ticketId, now }, hooks?)"
  - "Daily pg-boss queue auto-close (02:15) in src/lib/worker/index.ts"
  - "src/lib/tickets/reopen-on-reply.ts: reopenOnCustomerReply, setReopenObserverForTests (test seam)"
  - "saveAutoCloseSetting server action and the auto-close card on /settings/sla"
affects: [11-09]
tech-stack:
  added: []
  patterns:
    - "Setting row as a lock: FOR SHARE in each close, FOR UPDATE for the whole save"
    - "Row lock first, then conditional UPDATE, so a waiting reply reads the committed status"
    - "Module-level test observer for a route handler whose signature cannot carry hooks"
key-files:
  created:
    - src/lib/tickets/auto-close-settings.ts
    - src/lib/worker/jobs/auto-close.ts
    - src/lib/tickets/reopen-on-reply.ts
    - src/app/(app)/settings/sla/auto-close-form.tsx
    - tests/integration/auto-close.test.ts
    - tests/integration/reply-reopen-race.test.ts
    - tests/e2e/auto-close.spec.ts
  modified:
    - src/lib/worker/index.ts
    - src/lib/channels/email/ingest-message.ts
    - src/app/api/public/status/[token]/follow-up/route.ts
    - src/app/(app)/settings/sla/actions.ts
    - src/app/(app)/settings/sla/page.tsx
    - tests/e2e/support/db.ts
decisions:
  - "Invalid stored values (refused days, or positive days without a parseable enabledAt) read as days 0 with invalid true, so the card shows 'Auto-close is off.' and the job skips and logs the organization"
  - "A save from an invalid or missing enabledAt with positive days sets enabledAt to now even when the previous days were positive, so the stored state becomes valid"
  - "A server INVALID (unreachable through the card, which validates with the same parser) is shown as the field error, not as an 'Auto-close error' callout"
  - "autoCloseHandler returns { organizations: [{ orgId, closed, skippedWithoutResolvedAt, stoppedOff }], invalidOrganizations } in addition to the log line"
metrics:
  duration: "~11 min"
  completed: 2026-11-08
actuals:
  tokens: 19500
  tasks: 3
  commits: 3
plan_head_before: 20af575f03123ebf67d488d21925c4f117af72e7
---

# Phase 11 Plan 04: Auto-close of resolved tickets Summary

Resolved tickets now close through a daily pg-boss job. The quiet period starts at the later of `resolvedAt` and `autoCloseEnabledAt`. Each close takes FOR SHARE on the organization's setting row, runs one conditional UPDATE, and writes a SYSTEM `AUTO_CLOSED` audit row. A run closes at most 100 tickets per organization. Both customer-reply paths now decide the reopen under the ticket row lock. Every race order is proven on recorded PIDs, and owners and admins control the setting from a card on the SLA page. Nothing is sent to customers.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Settings service, daily job, worker registration | f6d6303 | typecheck 0; auto-close.test.ts 12/12 |
| 2 | Reopen helper in both reply paths, race proofs (a) to (f) | 0a31942 | 27/27 across reply-reopen-race (6), auto-close (15), email-ingest (6) |
| 3 | Auto-close card, server action, E2E | 3ae69c4 | typecheck 0; lint 0; auto-close.spec.ts 4/4 |

Tracer feedback gate: after Task 1 was committed, its `<verify>` (typecheck plus `auto-close.test.ts`) was re-run and passed with 12/12. Task 2 started only after that.

## Race cases (recorded PIDs, Codex review C6)

Every waiter recorded its PID inside its own transaction (`opts.onCloseTransaction`, the `saveAutoCloseDays` hooks, or `setReopenObserverForTests`), filtered to the case's ticket id. `waitForBlockedBy(prisma, holderPid, [waiterPid])` resolved before the holder was released. The PIDs below come from the verbose run. "Observed after" is the time until pg_blocking_pids named the holder.

| Case | Holder PID | Waiter PID | Observed after | Final state |
|------|-----------|-----------|----------------|-------------|
| (a) reply holds, job closes | 266 (reopen) | 267 (close) | 5 ms | ticket OPEN; job closed=0 for the org; no AUTO_CLOSED row |
| (b-email) close holds, email reply | 267 (close) | 266 (ingest) | 0 ms (already blocked at first poll) | ticket OPEN, resolvedAt null; message triggeredReopen true; 1 AUTO_CLOSED row |
| (b-status) close holds, status follow-up | 266 (close) | 267 (route POST) | 0 ms | ticket OPEN, resolvedAt null; message triggeredReopen true; 1 AUTO_CLOSED row; HTTP 200 |
| (c-email) agent resolve uncommitted, email reply | 267 (resolve) | 266 (ingest) | 1 ms | ticket OPEN, resolvedAt null; triggeredReopen true |
| (c-status) agent resolve uncommitted, status follow-up | 266 (resolve) | 267 (route POST) | 0 ms | ticket OPEN, resolvedAt null; triggeredReopen true; HTTP 200 |
| (d) save "0" held at beforeCommit, job closes | 232 (save) | 248 (close) | 4 ms | save ok days 0; ticket RESOLVED; no AUTO_CLOSED; log closed=0, stopped=setting-off; stored days "0", enabledAt removed |
| (e) close holds, save "0" | 248 (close) | 232 (save) | 53 ms | ticket CLOSED with 1 AUTO_CLOSED row; save ok; stored days "0", enabledAt removed; second run closes nothing |
| (f) no days row, save inside afterShareLock | n/a (the close holds no setting row) | n/a | save committed inside the hook in 3 ms (5 s bound) | close returned { closed: false, off: true }; ticket RESOLVED, no AUTO_CLOSED; control close in a new transaction returned { closed: true } with 1 AUTO_CLOSED row |

The setting re-read under the lock is also covered without a held transaction. A save of "30" (lengthened) or "0" committed from `onCloseTransaction` before the close's lock left the ticket RESOLVED. The log line read closed=0.

Automatic mail (`Auto-Submitted: auto-replied`) sent to a CLOSED ticket was appended with triggeredReopen false. The ticket stayed CLOSED.

## Verification commands (exit codes)

- `pnpm typecheck`: 0 (after each task and after the E2E run)
- `pnpm lint`: 0 (306 files)
- `pnpm test` (unit suite): 0, 19 files and 152 tests passed
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/auto-close.test.ts`: 0, 12 passed (Task 1 run and tracer gate re-run)
- `… pnpm test:integration tests/integration/reply-reopen-race.test.ts tests/integration/auto-close.test.ts tests/integration/email-ingest.test.ts`: 0, 27 passed (run twice; the second run used `--reporter=verbose --silent=false` to capture the PIDs above). email-ingest case 6 (a reply reopens a RESOLVED ticket) still passes.
- `… pnpm test:e2e tests/e2e/auto-close.spec.ts`: 0, 4 passed
- `… pnpm test:e2e tests/e2e/public-status.spec.ts`: 0, 3 passed (regression check on the changed follow-up route)
- `pgrep -f 'artisan test'` found nothing before each Testcontainers or E2E run.
- The full `pnpm test:integration` suite and `pnpm test:egress` were not run (orchestrator rule; O-1). No migration was added. `aida-dev-db` was not used, because the integration tests and the E2E use their own Testcontainers databases.

## Deviations from Plan

### Auto-fixed Issues

None. Every test passed on its first run.

### Small choices inside the plan's scope

- `saveAutoCloseDays` checks membership, role and the parsed value before the transaction, in the order the plan lists. The transaction then inserts the days row (`ON CONFLICT DO NOTHING`, default "0") and takes `FOR UPDATE` on it.
- The settings card keeps its copy in one `COPY` constant, so each Copywriting row stays on one line and matches the acceptance greps verbatim.
- The `ReopenTx` type is structural (`$queryRaw` and `$executeRaw`), so both a scopedDb transaction (ingest) and a prisma transaction (the route) fit.
- The reopen `UPDATE` stamps `updatedAt` explicitly, because the raw statement bypasses Prisma's `@updatedAt`.

## Threat model dispositions

- T-11-18 (mitigated): `saveAutoCloseDays` refuses a member (NOT_ALLOWED) and a removed member (MEMBERSHIP_ENDED). Both refusals are tested.
- T-11-19 (mitigated): the save validates with parseAutoCloseDays. A stored "abc", or a positive value without enabledAt, is treated as off and logged. Both are tested.
- T-11-20 (mitigated): both reply paths take the row lock and then reopen conditionally, and the close is conditional. Cases (a) to (c) prove it on both reply paths.
- T-11-21 (mitigated): there is no notice code path. The acceptance grep finds no `sendMail`, `email-outbound-send` or `lib/llm` reference in the job.
- T-11-22 (mitigated): enabledAt starts the quiet period (tested), and a run closes at most 100 tickets per organization. The 105-ticket case tests the cap and the tie order.
- T-11-23 (accepted, recorded here): agent replies, internal notes and automatic mail on a resolved ticket do not delay auto-close, because messages are not read (D-16 as amended). The card says so. A customer reply still reopens the ticket under the D-17 lock.
- T-11-46 (mitigated): cases (d), (e) and (f), plus the lengthened setting and the disabled setting, are tested.

## Open items (manual, not claimed)

- **Approval of the auto-close card's look** (CONTEXT Human boundary). No visual pass, dark-mode review or 360px check has been done by a human. The UI-SPEC long-text row (360px wrap) is a backstop item and stays open.
- **Owner item O-2 (customer notice on auto-close).** Nothing is sent to customers (D-19), and the card has no notice toggle.
- AIDA-51 is not marked complete by this executor. Requirement bookkeeping belongs to the orchestrator.

## Known Stubs

None.

## Threat Flags

None. The changed public follow-up route gained no new surface. It now takes a row lock on the one ticket it already wrote to.

## Self-Check: PASSED

- FOUND: all 7 created and 6 modified files listed above
- FOUND commits: f6d6303, 0a31942, 3ae69c4
