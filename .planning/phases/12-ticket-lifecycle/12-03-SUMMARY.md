---
phase: 12-ticket-lifecycle
plan: 03
subsystem: tickets, attachments, demo-seed
status: complete
tags: [merge, row-lock, provenance, attachments, testcontainers, races]
requires: ["12-01"]
provides:
  - "src/lib/tickets/merge.ts: mergeTickets, lockTicketsInIdOrder, lockTicketForAgentWrite, MergeError codes, setAgentMessageObserverForTests"
  - "src/app/(app)/tickets/[id]/merge-actions.ts: mergeTicketAction -> { ok: true, targetId } | { ok: false, error }"
  - "src/lib/attachments/staged-files.ts: saveStagedFiles(storage, orgId, files) -> { saved, discard() }"
  - "src/lib/demo/seed-demo-data.ts: insertDemoReplies, finalizeDemoTicket, DemoSeedTicketMergedError"
  - "POST /api/tickets/{id}/messages: 409 { error: 'MERGED_SOURCE' } on a merged source"
affects: [12-04, 12-06, 12-10]
tech-stack:
  added: []
  patterns:
    - "One lock helper (ORDER BY id FOR UPDATE in one statement) shared by every writer of a merge pair"
    - "Provenance marker drawn with nextval under the row locks"
    - "Staged file saving with best-effort discard"
key-files:
  created:
    - src/lib/tickets/merge.ts
    - src/app/(app)/tickets/[id]/merge-actions.ts
    - src/lib/attachments/staged-files.ts
    - tests/integration/ticket-merge.test.ts
    - tests/unit/staged-files.test.ts
  modified:
    - src/app/api/tickets/[id]/messages/route.ts
    - src/lib/demo/seed-demo-data.ts
decisions:
  - "Lock-order contract: mergeTickets takes row locks only through lockTicketsInIdOrder (one statement, ORDER BY id, FOR UPDATE, organization predicate); the agent messages route locks through lockTicketForAgentWrite, which calls the same helper; 12-04's reply path must import it too"
  - "Closing the source mirrors mutations.ts: from a non-terminal status it also sets resolvedAt = mergedAt and clears isAtRisk/isBreached; RESOLVED -> CLOSED keeps resolvedAt"
  - "Route: TICKET_UNAVAILABLE under the lock returns the route's existing 404 { error: 'not_found' }"
  - "Route: every file is validated (size, sniffed type) before any is stored, so 413/415 leave no file either"
metrics:
  duration: "~45 min"
  completed: 2026-11-08
actuals:
  tokens: 20500
  tasks: 3
  commits: 3
plan_head_before: 6227d93a27189d0282deb68b9e4565fb28e94fb2
---

# Phase 12 Plan 03: Ticket merge service Summary

Merge service that moves a whole thread in one transaction (membership first, both rows locked in id order through `lockTicketsInIdOrder`, every D-07 refusal on the locked rows, `mergedAt` from `clock_timestamp()` and `mergeMessageSeq` from `nextval` after the locks, link replacement audited on both tickets). The demo seed now writes replies and its status only under the ticket row lock. The agent messages route refuses a merged source under the row lock and cleans up staged attachment files on a best-effort basis. Proven by 36 Testcontainers cases, 9 of them forced-order races on recorded PIDs, and 7 unit cases.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Merge service and server action | 45913c6 | typecheck 0; integration 1/1; tracer gate passed before Task 2 |
| 2 | Refusals, link replacement, rollback, idempotency, races, locked demo seed | 6652be8 | typecheck 0; lint 0; integration 32/32 |
| 3 | Agents cannot write to a merged source; staged attachment files | 9147c98 | unit 7/7; typecheck 0; lint 0; integration 36/36 |

## Verification (exit codes)

- `pnpm exec vitest run tests/unit/staged-files.test.ts`: 0, 7 passed.
- `pnpm typecheck`: 0. `pnpm lint` (whole repo, `biome check .`): 0.
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/ticket-merge.test.ts`: 0, 36 passed.
- Forced-order races, each with the waiter's recorded PID observed blocked by the holder through `waitForBlockedBy` before release:
  - A→T held vs A→U: SOURCE_MERGED.
  - A→T held vs T→A: TARGET_MERGED.
  - Link insert holding both rows vs merge: the merge then replaces that link.
  - Seed (a) holds in afterLock vs merge: both replies moved, `mergedFromTicketId` = S, seq below `mergeMessageSeq`.
  - Seed (b): merge held vs insertDemoReplies: DemoSeedTicketMergedError, no reply written.
  - Seed (c): merge held vs finalizeDemoTicket: DemoSeedTicketMergedError, S still CLOSED and equal to its row after the merge.
  - Route: merge held vs agent reply POST: 409 MERGED_SOURCE, no message, no file.
- `pgrep -f 'artisan test'` found nothing before each Testcontainers run. The full integration suite and `test:egress` were not run (O-1). No migration, no schema change, no package change, and the env file was not touched.

## Lock-order contract (D-08, D-10)

`lockTicketsInIdOrder(tx, orgId, ids)` is one raw statement: `SELECT … FROM "Ticket" WHERE "organizationId" = $org AND id = ANY($ids) ORDER BY id FOR UPDATE`. PostgreSQL decides both the sort and the lock order, and no JS sort is involved. `mergeTickets` locks both rows only through it. `lockTicketForAgentWrite` (messages route) calls it with one id. 12-04's customer-reply path must lock through the same helper, which leaves one lock order for merges and replies. The demo seed locks a single ticket row; one row cannot form a cycle.

## Refusal order (D-07, review C3)

SELF (ids compared, no query), then MEMBERSHIP_ENDED (`findActiveMembership`, the first statement of the transaction, with no ticket read and no pre-read before it), then TICKET_UNAVAILABLE, SOURCE_MERGED, TARGET_MERGED, SOURCE_HAS_MERGES and DIFFERENT_CONTACTS (K33). Every check after membership runs on the locked rows. A removed member gets MEMBERSHIP_ENDED whether or not the source is already merged; both cases are tested and change nothing.

## Documented limitations and owner items

- **Merge chains are refused** (D-07): a merged target (TARGET_MERGED) and a source that has received merges (SOURCE_HAS_MERGES) are both refused.
- **Tags, assignee and custom field values stay on the source** (D-08). Only messages (and their attachments) move.
- **AIDA-53's literal "full AuditEvent" is not claimed** (D-11, owner item 12-o1). The merge is audited in TicketAuditEvent as MERGED_INTO, MERGED_FROM, STATUS_CHANGED (only on a real change), WOKEN (only when the source was snoozed), and RELATION_REMOVED/RELATION_ADDED (only when a link was replaced). These rows hold ids, enum values, the ISO mergedAt and the seq marker as a string.
- **Attachment cleanup is best-effort** (review R3-2). When the storage refuses a delete (any error other than ENOENT), that file stays on disk. The only record is one `console.error` line with the key and the error code, never file content. The request still returns its own response (409) or rethrows its own error. This plan builds no retry or reconciliation.
- **D-01 / AIDA-43:** the merge action checks membership. The older agent messages route still authorises through `getScopedDb` only, so AIDA-43 stays open.

## New status readers and writers for Phase 12.1 (D-02)

- `src/lib/tickets/merge.ts` (`mergeTickets`) closes the source (status CLOSED) and reads the source's status under the lock.
- `src/lib/demo/seed-demo-data.ts` (`finalizeDemoTicket`) writes the seeded status under the row lock and refuses a merged ticket.

## Deviations from Plan

1. **[Rule 3] lockTicketsInIdOrder was written in Task 1** instead of being extracted in Task 2. Its single statement also selects `contactId`, `status` and `snoozedUntil`, so every D-07 check reads the rows that statement locked.
2. **[Rule 2] Source close semantics:** the merge also sets `resolvedAt` and clears the SLA flags when the source moves from a non-terminal status to CLOSED, matching `mutations.ts`.
3. **The seed helpers share one `lockDemoTicket` statement.** The acceptance grep "FOR UPDATE ≥ 2" is met by that statement plus a comment line. The intent (both paths locked) is met by the shared function, and cases (a) to (e) test it.
4. **The test observer lives in `src/lib/tickets/merge.ts`** (`setAgentMessageObserverForTests` / `getAgentMessageObserver`), because a Next.js route file may export only route handlers.
5. **[Rule 3] Route test doubles:** `@/lib/session` (`getScopedDb`, bound to the case's actor and the real `scopedDb`) and `@/lib/queue/boss-client` (`getBoss`, which records sends) are mocked in the integration file. No existing integration test drives a `getScopedDb` route with a session. The `email:enabled` setting is on, so "no outbound job" on a 409 is a real assertion and the target POST enqueues exactly one job.
6. **[Rule 2] The messages route validates every file before storing any.** It returns TICKET_UNAVAILABLE under the lock as 404 `not_found`.
7. **Added a `seedDemoData` regression case:** the summary's message, internal-note and per-status counts equal the rows written through the new locked helpers.

## TDD Gate Compliance

Tasks 2 and 3 are `tdd="true"`. In each task the tests and the implementation were written together and committed in one commit per task (6652be8, 9147c98), as in 12-01 and 12-02. No separate failing RED run was recorded. Every listed behaviour has a passing case.

## Known Stubs

None.

## Threat model dispositions

T-12-12 to T-12-16 are mitigated as planned, and each has a test (DIFFERENT_CONTACTS snapshot, MEMBERSHIP_ENDED and the cross-organization refusal, the afterMove rollback sentinel, the audit rows, and the route race). T-12-17: the merge side of the lock-order contract is in place. The reply side and its no-40P01 proofs belong to 12-04.

## Self-Check: PASSED

- FOUND: all 5 created and 2 modified files.
- FOUND commits: 45913c6, 6652be8, 9147c98 (`git rev-list --count 6227d93..HEAD` = 3 before this SUMMARY).
