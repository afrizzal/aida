---
phase: 11-inbox
plan: 02
subsystem: tickets, server-actions, test-support
status: complete
tags: [ticket-mutations, bulk-actions, audit, membership, transactions, row-locks, testcontainers, concurrency]
requires:
  - "11-01: recordTicketAudit, findActiveMembership, getSessionActor, lock-wait helpers, inbox fixtures, TicketAuditEvent migration"
provides:
  - "runTicketMutation({ actor, ticketIds, op, mode }, hooks?) in src/lib/tickets/mutations.ts"
  - "TicketOp union (assign, status, priority, addTag, addTagByName, removeTag), TicketMutationError codes INVALID, TOO_MANY, TICKET_UNAVAILABLE, MEMBER_NOT_ACTIVE, TAG_MISSING, MEMBERSHIP_ENDED"
  - "Test seams hooks.onTransactionStart(tx) and hooks.afterItem(tx, ticketId, index)"
  - "bulkUpdateTickets(input) server action in src/app/(app)/tickets/bulk-actions.ts"
  - "assignTicket, changeStatus, changePriority, addTag, removeTag as thin wrappers returning { ok, error? }"
affects: [11-06, 11-07, 11-08]
tech-stack:
  added: []
  patterns:
    - "One interactive transaction per mutation: membership read, reference checks, one sorted SELECT … FOR UPDATE, apply, audit"
    - "Service refusals returned as codes; every other error rethrown unchanged"
    - "Find-or-create inside the transaction with INSERT … ON CONFLICT DO NOTHING, then a fresh read"
key-files:
  created:
    - src/lib/tickets/mutations.ts
    - src/app/(app)/tickets/bulk-actions.ts
    - tests/integration/ticket-mutations.test.ts
  modified:
    - src/app/(app)/tickets/[id]/actions.ts
decisions:
  - "The service also validates enum values and id shapes itself (INVALID), because the single-ticket server actions receive untrusted arguments with no zod layer"
  - "bulkUpdateTickets bounds each id at 128 characters in zod; an invalid payload returns { ok: false, error: INVALID }"
  - "Tag links are read once, after the ticket lock, so a concurrent mutation cannot change them between the read and the write"
  - "A tag id that resolves to null after the ON CONFLICT insert is treated as TAG_MISSING (cannot happen under READ COMMITTED; kept as a guard)"
metrics:
  duration: "~7 min"
  completed: 2026-11-08
actuals:
  tokens: 16200
  tasks: 3
  commits: 3
plan_head_before: 8fce862389f303386ab219998077cba470de324e
---

# Phase 11 Plan 02: Ticket mutation service and bulk action Summary

Every ticket mutation, single or bulk, now runs through `runTicketMutation`. It is one membership-checked transaction that locks tickets in ascending id order and writes one `TicketAuditEvent` per ticket. All five ticket-page actions are thin wrappers around it, and `bulkUpdateTickets` exists for the bulk bar. Rollback, refusals, idempotency, the membership guarantee, deadlock-free concurrency and the same-name tag race are proven on Testcontainers with recorded-PID waits.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Status change through the service, from the server action to the audit row | c0c3297 | typecheck 0; 3/3 integration cases |
| 2 | Assign, priority and tag operations, wrappers, bulk server action | 6619b4c | typecheck 0; 16/16 integration cases; `tests/e2e/mutations.spec.ts` 5/5 |
| 3 | Rollback, refusal, idempotency and concurrency proofs | 2995b25 | 29/29 integration cases; typecheck 0; lint 0 |

Tracer feedback gate: after Task 1 was committed, its `<verify>` (typecheck plus the integration file) was green. Expansion started only after that.

## Priority parity (Codex review C2)

A priority change writes the same seven fields as the previous `changePriority`, in one update with the organization predicate:
- `priority`
- `firstResponseTargetMinutes` and `resolutionTargetMinutes`, from the organization's `SlaPolicy` row (read with an explicit `organizationId` predicate) or from `DEFAULT_SLA_TARGETS`
- `firstResponseDueAt` and `resolutionDueAt`, computed from the ticket's `createdAt`
- `isAtRisk` false and `isBreached` false

**The only deviation from the previous action is the D-08 no-op:** re-applying the current priority writes nothing to the ticket. It still records one `PRIORITY_CHANGED` row whose before equals its after.

## Evidence (Task 3)

From `pnpm test:integration tests/integration/ticket-mutations.test.ts --reporter=verbose --silent=false`, final run:

- **Bulk concurrency, sorted lock:**
  - Run A (pid 258) was observed blocked by the holder of b after 5 ms.
  - Run B (pid 267) was then observed blocked by run A after 4 ms.
  - After the holder was released, both runs returned ok with count 3: six audit rows in two batches, and no deadlock.
- **Control, input-order locks:**
  - T1 (pid 258) was observed blocked by the holder after 0 ms (the first poll).
  - T2 (pid 249) was observed blocked by T1 after 54 ms.
  - After the holder was released, exactly one transaction rejected with `Raw query failed. Code: 40P01. Message: deadlock detected`, and the other committed. The case took 1081 ms in the run before, which is about Postgres's 1 s `deadlock_timeout`.
- **addTagByName same-name race, A commits:** B (pid 249) was observed blocked by A (pid 258) after 54 ms. Both runs returned ok. The organization has exactly one new tag, "Escalation", and both tickets link it, with one TAG_ADDED row each.
- **addTagByName same-name race, A rolls back:** B (pid 258) was observed blocked by A (pid 249) after 54 ms. A rejected with its exact sentinel (`rejects.toBe`), and B returned ok. The one tag links q only; p has no link and no TAG_ADDED row.
- **Member removal after the membership read (Codex review R2-1):** the actor's member row was deleted through another connection while the status change was held in `hooks.afterItem`. The delete committed in 1 ms, inside the 5-second bound, and only then was the hook released. The call returned `{ ok: true, count: 1 }`, the ticket is RESOLVED, one STATUS_CHANGED row with the actor's id was committed, and the member row is still gone.
- **D-09 rollback:** `hooks.afterItem` threw a plain `Error` sentinel after the first ticket. Inside the transaction it had read the tag link and an audit count of 1 above the starting count. The call rejected with that exact sentinel. Afterwards no tag link exists, every ticket row equals its snapshot, and the audit count equals its value before the call.

## Verification commands (exit codes)

- `pnpm typecheck`: 0 (after every task and after the E2E run)
- `pnpm lint`: 0 (293 files)
- `pnpm test` (unit suite): 0, 19 files and 152 tests passed
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:integration tests/integration/ticket-mutations.test.ts`: 0 every run; 3, then 16, then 29 passed
- `DOCKER_HOST=… TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=… pnpm test:e2e tests/e2e/mutations.spec.ts`: 0, 5 passed (status lifecycle, priority recompute, assign, tag add/remove, custom field)
- `pgrep -f 'artisan test'` found nothing before each Testcontainers or E2E run.
- The full `pnpm test:integration` and `pnpm test:egress` were not run (orchestrator rule; O-1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing validation] Enum and id-shape checks in the service**
- **Found during:** Task 1
- **Issue:** The single-ticket server actions pass client-supplied `status`, `priority`, assignee and tag ids straight to the service, with no zod layer. An invalid enum value would surface as a Prisma error instead of a refusal.
- **Fix:** `validateInput` checks the op kind, the enum membership, the non-empty ids and the blank tag name before any transaction. It refuses with INVALID.
- **Files modified:** src/lib/tickets/mutations.ts
- **Commit:** c0c3297, 6619b4c

**2. [Rule 1 - Acceptance] revalidatePath named in a service comment**
- **Found during:** Task 2 acceptance greps
- **Issue:** A header comment in `mutations.ts` mentioned `revalidatePath`, so `grep -c revalidatePath` printed 1 instead of 0.
- **Fix:** Reworded the comment to "cache revalidation". No code changed.
- **Commit:** 6619b4c

### Shape choices inside the plan's scope

- The wrappers share one helper, `afterSingle(ticketId, result)`, which revalidates only after an ok result. Each of the five wrappers calls `runTicketMutation` itself, so the key link and the acceptance count (7 occurrences) hold.
- Wrappers return `{ ok: boolean; error?: code }`. `TicketMetaHeader` still reads only `result.ok`, and the E2E spec passed unchanged.
- The 101-id case also proves that no transaction started: `hooks.onTransactionStart` was never called.
- Idempotency has a second case for priority, which shows that the SLA dates are not recomputed (truth: "SLA dates not recomputed").

## Threat model dispositions

- T-11-07: mitigated. The lock filters on the actor's `organizationId`, and a count mismatch refuses the whole batch (test: foreign ticket in a batch).
- T-11-08: mitigated, with the stated guarantee proven on both sides of the membership read.
- T-11-09: mitigated. The assignee membership check runs inside the transaction (MEMBER_NOT_ACTIVE test).
- T-11-10: mitigated. 100-id cap, 30 s transaction timeout, sorted lock, and the concurrency test with its deadlock control.
- T-11-11: mitigated. One audit row per ticket, no-ops included.
- T-11-43: mitigated. Tag-count tests cover a revoked actor and an unavailable ticket.
- T-11-44: mitigated. The stored targets and due dates are tested for a policy row and for the defaults.
- Privacy prohibition: audit snapshots hold only `status`, `priority`, `assigneeId`, `tagId` and `present`, with string, boolean or null values. The audit-content case checks this for every row the file writes.

## Open items

- `getScopedDb` and the other actions in `src/app/(app)/tickets/[id]/actions.ts` (retryOutboundSend, rerunTriage, generateDraftReply, the triage overrides, setCustomFieldValue) still do not check membership (D-01). AIDA-43 stays open (O-3).
- The bulk bar UI that calls `bulkUpdateTickets` is plan 11-06. No visual check is claimed.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/tickets/mutations.ts, src/app/(app)/tickets/bulk-actions.ts, tests/integration/ticket-mutations.test.ts, src/app/(app)/tickets/[id]/actions.ts
- FOUND commits: c0c3297, 6619b4c, 2995b25
