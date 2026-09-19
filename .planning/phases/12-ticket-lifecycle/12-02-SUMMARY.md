---
phase: 12-ticket-lifecycle
plan: 02
subsystem: tickets
status: partial
tags: [relations, advisory-lock, testcontainers, races]
requires: ["12-01"]
provides:
  - "src/lib/tickets/relations.ts: addRelation, removeRelation, listRelationsForTicket, RelationError codes, ANCESTOR_WALK_LIMIT = 1000, hooks onTransactionStart/afterLock/beforeCommit"
  - "src/app/(app)/tickets/[id]/relation-actions.ts: addRelationAction, removeRelationAction"
affects: [12-06, 12-10]
key-files:
  created:
    - src/lib/tickets/relations.ts
    - src/app/(app)/tickets/[id]/relation-actions.ts
    - tests/integration/ticket-relations.test.ts
decisions:
  - "removeRelation first checks that the acting ticket belongs to the actor's organization (TICKET_UNAVAILABLE), then reads the relation by id and organization (ALREADY_REMOVED when absent); this satisfies both the action text and the behavior line for another organization's relation without revealing whether a foreign relation exists"
  - "Unique violations are mapped by index name: TicketRelation_one_parent_key -> PARENT_EXISTS, any other unique violation on the insert -> ALREADY_LINKED"
  - "Services return { ok: true, ticketIds } so the actions revalidate both ticket pages after success"
actuals:
  tasks: 2
  commits: 3
plan_head_before: 2669aa3
---

# Phase 12 Plan 02: Ticket relations service Summary (PARTIAL: Task 3 not executed)

Relations service with one transaction per write in the review-C5 lock order (membership, CHILD_OF advisory lock, both ticket rows FOR UPDATE in id order, validation), bounded ancestor walk with an explicit HIERARCHY_TOO_DEEP refusal, merge-link guard, and removal decided from a re-read under the locks; proven with 21 Testcontainers cases including three PID-bound races.

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Service, actions, link read from both sides | 9ca9f19 | typecheck 0; integration 1/1; tracer gate passed before Task 2 |
| 2 | Remove, refusals, advisory lock, race proofs | 0aef32d, fa41928 | typecheck 0; lint 0; integration 21/21 |
| 3 | Ticket picker endpoint | not started | OPEN: executor context exhausted |

## Verification (exit codes)

- `pnpm typecheck`: 0
- `pnpm exec biome check` on the three plan files: 0
- `pnpm test:integration tests/integration/ticket-relations.test.ts` (Colima env): 0, 21 passed. Races: cycle race (run 2 observed blocked on the advisory lock by run 1's PID, run 1 ok, run 2 CYCLE); same-pair race commit (ALREADY_LINKED) and rollback (run 1 rejects with the sentinel, run 2 ok, only run 2's two RELATION_ADDED rows); concurrent delete vs removeRelation (blocked by holder PID, ALREADY_REMOVED, no RELATION_REMOVED row).
- `pgrep -f 'artisan test'` found nothing before each run.

## Deviations from Plan

1. [Rule 3] Task 1's commit already contains removeRelation and the CHILD_OF advisory-lock/walk code; Task 2's commit adds the organization check in removeRelation and every Task 2 test.
2. [Rule 2] removeRelation refuses TICKET_UNAVAILABLE when the acting ticket is not in the actor's organization, before reading the relation (see decisions).
3. An INVALID code was added for an unknown link choice or empty ids.

## Open items

- Task 3 (src/lib/tickets/ticket-picker.ts, src/app/api/tickets/picker/route.ts, tests/integration/ticket-picker.test.ts) is NOT done; plan 12-06 depends on it.
- D-01 / AIDA-43: older pages and actions still lack the membership check; AIDA-43 stays open.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: the three created files; commits 9ca9f19, 0aef32d, fa41928.
