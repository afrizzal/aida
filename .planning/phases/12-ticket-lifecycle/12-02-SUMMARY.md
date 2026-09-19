---
phase: 12-ticket-lifecycle
plan: 02
subsystem: tickets
status: complete
tags: [relations, advisory-lock, testcontainers, races]
requires: ["12-01"]
provides:
  - "src/lib/tickets/relations.ts: addRelation, removeRelation, listRelationsForTicket, RelationError codes, ANCESTOR_WALK_LIMIT = 1000, hooks onTransactionStart/afterLock/beforeCommit"
  - "src/app/(app)/tickets/[id]/relation-actions.ts: addRelationAction, removeRelationAction"
  - "src/lib/tickets/ticket-picker.ts: searchTicketsForPicker, PICKER_RESULT_LIMIT = 10"
  - "GET /api/tickets/picker?q=&ticketId=&purpose=link|merge (src/app/api/tickets/picker/route.ts)"
affects: [12-06, 12-10]
key-files:
  created:
    - src/lib/tickets/relations.ts
    - src/app/(app)/tickets/[id]/relation-actions.ts
    - tests/integration/ticket-relations.test.ts
    - src/lib/tickets/ticket-picker.ts
    - src/app/api/tickets/picker/route.ts
    - tests/integration/ticket-picker.test.ts
decisions:
  - "removeRelation first checks that the acting ticket belongs to the actor's organization (TICKET_UNAVAILABLE), then reads the relation by id and organization (ALREADY_REMOVED when absent); this satisfies both the action text and the behavior line for another organization's relation without revealing whether a foreign relation exists"
  - "Unique violations are mapped by index name: TicketRelation_one_parent_key -> PARENT_EXISTS, any other unique violation on the insert -> ALREADY_LINKED"
  - "Services return { ok: true, ticketIds } so the actions revalidate both ticket pages after success"
  - "Picker: a digits-only query (#N or N, one digit is enough) is a number lookup only, not also a full-text search; purpose is accepted (link|merge, default link) but both dialogs get the same rows"
  - "Picker: an unknown current ticket and another organization's ticket both map to TICKET_NOT_FOUND / 404, so the route does not reveal foreign ids"
actuals:
  tasks: 3
  commits: 6
plan_head_before: 2669aa3
---

# Phase 12 Plan 02: Ticket relations service Summary

Relations service with one transaction per write in the review-C5 lock order (membership, CHILD_OF advisory lock, both ticket rows FOR UPDATE in id order, validation), bounded ancestor walk with an explicit HIERARCHY_TOO_DEEP refusal, merge-link guard, and removal decided from a re-read under the locks; proven with 21 Testcontainers cases including three PID-bound races. A membership-checked picker endpoint serves both the link and the merge dialogs with a fixed seven-field row (8 Testcontainers cases, including the route with a real Better Auth session cookie).

## Tasks

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 (tracer) | Service, actions, link read from both sides | 9ca9f19 | typecheck 0; integration 1/1; tracer gate passed before Task 2 |
| 2 | Remove, refusals, advisory lock, race proofs | 0aef32d, fa41928 | typecheck 0; lint 0; integration 21/21 |
| 3 | Ticket picker endpoint | a5446c9 | typecheck 0; lint 0; integration 8/8 |

## Verification (exit codes)

- `pnpm typecheck`: 0
- `pnpm exec biome check` on the three plan files: 0
- `pnpm test:integration tests/integration/ticket-relations.test.ts` (Colima env): 0, 21 passed. Races: cycle race (run 2 observed blocked on the advisory lock by run 1's PID, run 1 ok, run 2 CYCLE); same-pair race commit (ALREADY_LINKED) and rollback (run 1 rejects with the sentinel, run 2 ok, only run 2's two RELATION_ADDED rows); concurrent delete vs removeRelation (blocked by holder PID, ALREADY_REMOVED, no RELATION_REMOVED row).
- `pnpm test:integration tests/integration/ticket-picker.test.ts` (Colima env): 0, 8 passed. Number lookup (#N, N, one digit), short-query no-search, limit 11 then 10 rows with the current ticket excluded, exact row keys with alreadyLinked (reverse direction), sameContact and mergedSource, cross-organization by number and by word, MEMBERSHIP_ENDED without searching, TICKET_NOT_FOUND for unknown and foreign; route: 401 without session, 200 with only the seven keys, 404 unknown and foreign, 403 membership_ended after the member row is deleted, Cache-Control no-store.
- `pnpm lint` (whole repo): 0. Task 3 acceptance greps: findActiveMembership 2, email/bodyMarkdown/bodyHtml outside comments 0, `git diff --stat -- src/proxy.ts` empty.
- `pgrep -f 'artisan test'` found nothing before each run.

## Deviations from Plan

1. [Rule 3] Task 1's commit already contains removeRelation and the CHILD_OF advisory-lock/walk code; Task 2's commit adds the organization check in removeRelation and every Task 2 test.
2. [Rule 2] removeRelation refuses TICKET_UNAVAILABLE when the acting ticket is not in the actor's organization, before reading the relation (see decisions).
3. An INVALID code was added for an unknown link choice or empty ids.
4. [Rule 3] No existing integration test called a route with a real session cookie, so ticket-picker.test.ts signs a user in in-process (auth.api.signUpEmail, member row, auth.api.signInEmail with asResponse) and sends the returned cookies to the route handler.
5. Task 3 RED and GREEN were committed together in a5446c9 (one commit per task); the test file was written before the service and route.

## Open items

- D-01 / AIDA-43: older pages and actions still lack the membership check; AIDA-43 stays open.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: the six created files; commits 9ca9f19, 0aef32d, fa41928, a5446c9.
