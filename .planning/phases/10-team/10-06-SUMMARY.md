---
phase: 10-team
plan: 06
subsystem: notifications, tickets, email ingest, public status, sla worker
status: complete
tags: [notifications, emitters, sla, returning, customer-reply, assignment, race, testcontainers]
requires:
  - "10-01: Notification, NotificationPreference, NotificationSetting (migration 20261115100000_team_foundation)"
  - "10-03: runTicketMutation assignee read with shareLockActiveMembership, onlyIfAssignedTo, deactivateMember and its hooks"
  - "10-04: emitNotifications, emitForTicket (unassigned fallback, V-28), store, preferences"
  - "10-16: findTicketByStatusToken and Rule E in the membership inventory"
provides:
  - "src/lib/tickets/mutations.ts: ASSIGNED emitted in applyOp case assign, per ticket, single and bulk"
  - "src/lib/channels/email/ingest-message.ts and src/app/api/public/status/[token]/follow-up/route.ts: CUSTOMER_REPLY on the effective ticket inside the INBOUND transaction"
  - "src/lib/worker/jobs/sla-flag.ts: both UPDATEs hand back the flipped rows; SLA_BREACHED and SLA_AT_RISK for exactly those rows in the pass transaction"
  - "src/lib/notifications/recipients.ts: ticketAssigneeId(tx, orgId, ticketId)"
affects: [10-09, 10-11, 10-13, 10-14]
tech-stack:
  added: []
  patterns:
    - "Emit inside the causing transaction, after its existing locks, with plain reads and no new lock"
    - "UPDATE ... RETURNING as the exact transition set; the flag is the transition identity, now is the key suffix"
key-files:
  created:
    - tests/integration/notification-emitters.test.ts
    - tests/integration/notification-race.test.ts
  modified:
    - src/lib/tickets/mutations.ts
    - src/lib/channels/email/ingest-message.ts
    - src/app/api/public/status/[token]/follow-up/route.ts
    - src/lib/worker/jobs/sla-flag.ts
    - src/lib/notifications/recipients.ts
    - tests/integration/sla-flag-handler.test.ts
    - tests/unit/membership-inventory.test.ts
decisions:
  - "The assignee of a replied-to ticket is read through a new lib helper ticketAssigneeId (notifications/recipients.ts), because Rule E forbids the follow-up route its own ticket read; both reply writers use it"
  - "ASSIGNED passes the actor as actorUserId and is skipped explicitly for unassign and self-assignment; emitNotifications still applies the membership and in-app rules"
  - "The SLA pass emits per flipped row in ticket id order, each under that row's own organization"
metrics:
  duration: "about 20 minutes (2026-11-12T22:13Z to 22:32Z)"
  completed: 2026-11-13
  tasks: 3
  files: 9
estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 15600
  tasks: 3
  commits: 5
commits: 5
plan_head_before: 746882de1b9b5c27075918a03f5069ff9efb0622
---

# Phase 10 Plan 06: Notification emitters Summary

Assignment, customer replies and SLA transitions now create per-user notifications inside the transaction that causes them (D-16). Assignment emits ASSIGNED inside `applyOp` (V-08). The two writers that append a customer message to an existing ticket emit CUSTOMER_REPLY on the effective (merge target) ticket, with the owner and admin fallback for unassigned tickets (V-10, V-28). The SLA job's two UPDATEs now return the rows they flipped, and the job notifies for exactly those rows in the same pass (V-09, V-30). Races against deactivation end without deadlock.

## What was built

- **ASSIGNED (Task 1, V-08, D-16, D-17).** `applyOp` in `src/lib/tickets/mutations.ts` takes the actor id. In case `"assign"`, inside the existing `assigneeId` change branch, it calls `emitNotifications` when the new assignee is not null and is not the actor. The event key is `assigned:{ticketId}:{now ISO}`, using the `now` that is already read once after the ticket lock. It runs per ticket for single and bulk calls. A ticket skipped by `onlyIfAssignedTo` reaches no `applyOp`, so it emits nothing. The header's step 7 gains one line that names the emission. The lock order of steps 1 to 6 and the ticket `FOR UPDATE` statement are unchanged. No organization lock and no `assign-ticket.ts`. Assignment already checks the actor and the assignee inside the transaction (D-17 met by 10-03), and the assignee check stays `MEMBER_NOT_ACTIVE`.
- **CUSTOMER_REPLY (Task 2, V-10, V-28, owner item 11 option b).** Both reply writers run this after `message.create`, inside their transaction and after `resolveReplyTicket` has locked the effective ticket: `emitForTicket(tx, orgId, { assigneeId: await ticketAssigneeId(tx, orgId, effectiveTicketId), type: "CUSTOMER_REPLY", eventKey: \`message:${created.id}\`, entityId: effectiveTicketId })`. There is no actor. In the follow-up route, the organization and ticket come from the 10-16 helper's result (`ticket.organizationId` and `effectiveTicketId`, which derives from it), so Rule E still passes. `ticketAssigneeId` is a plain `findFirst` with an explicit organization term and no lock. It returns an assignee who is no longer a member as is, and `emitForTicket` then skips that person (O-7 (b)). Neither path changed in any other way, and the new-ticket branch of ingest was not touched.
- **SLA transitions (Task 3, V-09, V-30, D-18).** `updateBreach` and `updateAtRisk` are now `$queryRaw<FlippedRow[]>` with `RETURNING "Ticket".id, "Ticket"."organizationId", "Ticket"."assigneeId"`. Their WHERE and eligibility clauses are unchanged. `runPass` emits for the returned rows, sorted by id and each under its own organization, after the update and before `afterPassUpdate`. Breach rows get `SLA_BREACHED` with key `sla-breached:{id}:{now ISO}`, and at-risk rows get `SLA_AT_RISK` with key `sla-at-risk:{id}:{now ISO}`. `now` is read once in `slaFlagHandler` and shared by both passes. The seams `onPassTransaction`, `afterPassLock` and `afterPassUpdate` stay; the `afterPassUpdate` doc now says it runs after the notifications. Imports stay relative only, and no column was added. The D-28 comment now describes the returned columns.

## INBOUND inventory (C11 part 3, V-10)

| # | Site | Classification | Test |
|---|------|----------------|------|
| 1 | `src/lib/channels/email/ingest-message.ts:220` (append to a matched ticket, effective ticket from `resolveReplyTicket`) | emits CUSTOMER_REPLY on the effective ticket | notification-emitters: "a reply threaded onto an assigned ticket ...", "... merged source ...", "... unassigned ticket ... unassignedFallback ...", "... assignee's member rows were deleted ..." (O-7 (b)), "... never the customer's text" |
| 2 | `src/lib/channels/email/ingest-message.ts:271` (no match, new ticket through `createTicket`) | new ticket, no emit (O-7 (a)) | "an email that opens a new ticket through createTicket notifies nobody" |
| 3 | `src/app/api/public/status/[token]/follow-up/route.ts:135` (effective ticket from `resolveReplyTicket`) | emits CUSTOMER_REPLY on the effective ticket | "a follow-up on an assigned ticket ...", "... merged source's token ...", "... unassigned ticket ... (unassignedFallback) ...", "... assignee is no longer a member ...", "... honeypot hit writes no message and no notification" |
| 4 | `src/app/api/public/intake/route.ts:108` (new ticket through `createTicket`) | new ticket, no emit (O-7 (a)) | "a public intake submission notifies nobody" |
| 5 | `src/lib/demo/seed-demo-data.ts:421` (`createTicket` for each demo ticket) | demo seed, exempt (seeded history is not an event) | "the demo seed writes INBOUND rows (createTicket and insertDemoReplies) and emits nothing" |
| 6 | `src/lib/demo/seed-demo-data.ts:552` (contact replies through `insertDemoReplies`) | demo seed, exempt | the same case; it asserts more INBOUND rows than tickets, so the contact replies were written |

Line numbers are for this commit (the plan's context lines were taken at 5dc6890). `src/lib/rag/generate-draft.ts:50` matches `direction: "INBOUND"` only in a read.

## Fan-out duration (AIDA-44 edge)

An unassigned breached ticket in an organization with one owner and 60 admins wrote **61 rows** in the breach pass transaction. The case counted them inside that transaction, before commit. The verbose run measured the breach pass from `onPassTransaction` to `afterPassUpdate` (lock, update, emit) at **9.6 ms**, and the whole handler (both passes, including other organizations' rows in the shared test database) at 13.5 ms: `[10-06 fan-out] 61 recipients, breach pass (lock, update, emit) 9.6 ms, handler 13.5 ms`. This was on the Testcontainers Postgres on this Mac.

## O-7 limits (defaults applied, documented)

- (a) A new ticket opened by a customer, by email or through public intake, notifies nobody. If the owner says yes, `emitForTicket` gets added to the two new-ticket paths through `createTicket`'s own transaction.
- (b) A ticket whose assignee is no longer a member notifies nobody. That person is skipped by the membership check in `emitNotifications`. The ticket is not treated as unassigned, so the owner and admin fallback does not apply. This is tested for both reply writers. The Deactivate dialog keeps offering reassignment (D-07).
- The fallback recipient set is a snapshot read after the ticket locks. The races show that a deactivation committing while an SLA pass is parked still leaves a row for the removed member. That row is inert, and the bell (10-11) and the digest (10-09) must re-check membership when they read (D-25, C8).
- Accepted (flagged assumption): two assignments of one ticket to the same member within the same millisecond share an event key and store one row.

## Verification

All Docker steps ran with `AIDA_TEST_RUN_ID=mwe3po85-9b254c7de84f0ec4`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Before the first Docker step of each task and before the extra full run, `colima status` exited 0 and `docker info` exited 0 (server 29.5.2).

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (after each task's edits) | 0 | clean |
| Task 1: `pnpm test:integration tests/integration/notification-emitters.test.ts tests/integration/ticket-mutations.test.ts` | 0 | 2 files, 50 passed (10 and 40) |
| Task 1 tracer gate, the same command again after the commit | 0 | 2 files, 50 passed |
| Task 2 RED: `pnpm test:integration tests/integration/notification-emitters.test.ts` | 1 | 7 failed, 16 passed; every failure an AssertionError (no row written) |
| Task 2: `pnpm test:integration tests/integration/notification-emitters.test.ts tests/integration/email-ingest.test.ts tests/integration/merge-reply-race.test.ts` | 0 | 3 files, 43 passed |
| Task 2: `pnpm test tests/unit/membership-inventory.test.ts` (the script runs all of `tests/unit`) | 0 | 106 files, 1879 passed (Rule E holds for the follow-up route) |
| Task 3 RED: `pnpm test:integration tests/integration/sla-flag-handler.test.ts tests/integration/notification-race.test.ts` | 1 | 14 failed, 9 passed; every failure an AssertionError. The two assignment races already passed on the Task 1 code |
| Task 3: `pnpm test:integration tests/integration/sla-flag-handler.test.ts tests/integration/notification-race.test.ts tests/integration/deactivation-race.test.ts` | 0 | 3 files, 27 passed (18, 5 and 4) |
| Task 3: `pnpm test:integration tests/integration/sla-flag-handler.test.ts --silent=false --reporter=verbose` (fan-out duration) | 0 | 18 passed |
| Phase 12.1 races and ticket mutations, one command: ticket-mutations, sla-pause-race, snooze-race, triage-priority-race, ticket-state-delete-race, merge-race-coverage, merge-reply-race, reply-reopen-race, create-ticket-state-race (`--reporter=verbose`) | 0 | **9 files, 99 passed**: 40, 5, 4, 7, 6, 10, 12, 10, 5 |
| `pnpm test` (unit, after Task 3) | 0 | 106 files, 1879 passed |
| `pnpm lint` | 0 | 720 files, 1 warning, pre-existing at `tests/unit/container-config.test.ts:160` (not touched) |
| Extra: `pnpm test:integration` (whole integration suite, one process) | 0 | 127 files, 1781 passed, 448.8 s |

Acceptance greps:
- Task 1: `"ASSIGNED"` in mutations.ts: 1. `test -e src/lib/tickets/assign-ticket.ts`: exit 1. `git diff 5dc6890 -- src/lib/tickets/mutations.ts` exit 0, with 0 removed lines matching `FOR UPDATE`. `it(` in notification-emitters.test.ts: 10 after Task 1 and 23 at the end.
- Task 2: `CUSTOMER_REPLY` is 1 in ingest-message.ts and 1 in follow-up/route.ts. `@/` in ingest-message.ts is 0 now and 0 at 5dc6890. `intake` in the emitter test: 9. `unassignedFallback`: 7.
- Task 3: `RETURNING` in sla-flag.ts: 2. `@/` in sla-flag.ts: 0. `afterPassUpdate` in sla-flag-handler.test.ts: 3. `assertNoDeadlock` in notification-race.test.ts: 7. `git diff 746882d -- prisma/` (this plan) is empty. `git diff 5dc6890 -- prisma/schema.prisma` shows only the 10-01 schema commit `1708239`, which predates this plan.

## Races against deactivation (V-25, T-10-25b)

`tests/integration/notification-race.test.ts` records each PID from inside its own transaction through the services' seams. It uses `deferred`, `backendPid` and `waitForBlockedBy` from `lock-wait.ts`, and `createObserverClient`, `settleAll` and `assertNoDeadlock` from `project-race.ts`. It uses no lock barrier and no sleep.
- SLA pass parked in `afterPassUpdate` (ticket locked, flag flipped, notification written) against `deactivateMember` of the assignee. The deactivation does not wait: it resolves while the pass is still parked (asserted). Then the pass commits. Both fulfilled, no deadlock. The ticket is breached, the member rows are gone, and one inert SLA_BREACHED row exists for the former member.
- Reverse order: the deactivation is parked after its delete, holding the organization row `FOR NO KEY UPDATE`. The SLA pass completes while it is parked. Both fulfilled, no deadlock.
- Unassigned fallback: the pass is parked after emitting to the owner and two admins, and the deactivation of one admin does not wait. There are three fallback rows.
- Emitting assignment parked in `afterItem` after its emission: `waitForBlockedBy(observer, assignmentPid, [deactivationPid])` holds. Then both commit, in the order assignment then deactivation, with one ASSIGNED row.
- Deactivation parked after its delete: `waitForBlockedBy(observer, deactivationPid, [assignmentPid])` holds. The assignment is refused with `MEMBER_NOT_ACTIVE`, and no notification row exists.
- 10-03's `deactivation-race.test.ts` (4) passes unchanged with the emission in place. Its "assignment first" cases now also write an ASSIGNED row inside the held transaction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A lib helper for the assignee read in the follow-up route**
- **Found during:** Task 2
- **Issue:** The plan says to "read the effective ticket's assigneeId inside that transaction (plain read with an explicit organization term)". Rule E (10-16) forbids a status-token entry any own read on the `ticket` delegate (finding kind `own-read`, never allowlisted), so an inline `tx.ticket.findFirst` in the route would fail the inventory.
- **Fix:** `ticketAssigneeId(tx, orgId, ticketId)` in `src/lib/notifications/recipients.ts`. It is a structural transaction type, a plain `findFirst` with `{ id, organizationId }`, no lock, and relative imports. Both writers call it with values bound to the helper's result, which Rule E item 5 accepts. The full unit suite passed with it.
- **Files modified:** src/lib/notifications/recipients.ts (not in `files_modified`)
- **Commit:** 0642466

**2. [Rule 1 - Stale documentation] Inventory allowlist reasons for the SLA UPDATEs**
- **Found during:** Task 3
- **Issue:** The Rule D allowlist entries for `updateBreach` and `updateAtRisk` in `tests/unit/membership-inventory.test.ts` said "returns a count only", which is false after V-09.
- **Fix:** Both reasons now name the returned columns (id, organizationId, assigneeId) and say they are used only to emit under the row's own organization in the pass transaction. The entries still match by file and function.
- **Commit:** ef27670

### Other notes

- The emitter test has more cases than the plan lists, all additive: in-app off for ASSIGNED, a partial bulk where one ticket already has the assignee, a conditional reassignment skip, a rollback on a hook error, no customer text in a row (T-10-25), and the honeypot. The SLA suite adds "one run shares its now between both passes". The race file adds the reverse SLA order, the fallback variant, and the reverse assignment order.
- The intake case pins the single organization with `vi.spyOn(prisma.organization, "findFirstOrThrow")`, as `file-delete-inventory.test.ts` does. The database is not mocked. Intake picks "the one organization", and the shared test database holds many.
- The reset case uses the priority-change reset of `runTicketMutation` (the flag reset the plan cites as `mutations.ts:424`, now at the `priority` branch of `applyOp`). The ticket is created ten days back, so the recomputed deadlines are still past at the later `now`.
- RED evidence for the two TDD tasks is the run output above, committed before the implementation as `d1cebe8` and `e7bb8b9`. `gsd-tools check tdd-red-evidence` was not used, because it cannot parse vitest output (recorded in 10-16).

## Owner items and defaults used

- Owner item 11 option b (fallback to owners and admins, opt-out per person) through `emitForTicket` (V-28).
- O-7 defaults (a) and (b), see above.
- O-9: `REQUIREMENTS.md` was not edited, and AIDA-44 and AIDA-43 were not marked complete (that is the orchestrator's job).

## Prohibitions

- **AIDA-44 (privacy):** "MUST NOT notify anyone who is not a current member of the ticket's organization, or copy customer message text into a notification." Verified by test:
  - An ex-member assignee gets nothing on an email reply or a follow-up (O-7 (b) cases).
  - A user of another organization cannot be assigned (`MEMBER_NOT_ACTIVE`, no row in either organization).
  - Each organization's SLA rows go only to its own assignee ("two organizations").
  - The reply row contains no part of the customer's message body ("... never the customer's text").
  - Limit: a recipient who is deactivated between the snapshot read and the commit may still get an inert row (shown in the races). The bell and the digest must filter it when they read (10-11, 10-09).

## Manual items (open)

- None. This plan has no UI.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access. The follow-up route's new calls are bound to the status token's ticket (Rule E passes). The SLA job's new returned columns go only to the emitter, under the row's own organization.

## Self-Check: PASSED

- FOUND: tests/integration/notification-emitters.test.ts, tests/integration/notification-race.test.ts, this SUMMARY
- FOUND commits: 57a1f47, d1cebe8, 0642466, e7bb8b9, ef27670 (`git rev-list --count 746882d..HEAD` = 5 before the docs commit)
