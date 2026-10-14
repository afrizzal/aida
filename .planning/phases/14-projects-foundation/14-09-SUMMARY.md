---
phase: 14-projects-foundation
plan: 09
subsystem: projects
status: complete
tags: [projects, recurrence, time-zones, exactly-once, races, isolation]
requires:
  - "14-02 (recurrence columns, CHECKs, Task_recurrence_predecessor_key)"
  - "14-03 (recurrence-rules.ts pure date rules)"
  - "14-06 (applyStatusChangeInTx, setTaskStatus, keys, race harness)"
provides:
  - "src/lib/projects/recurrence.ts: setTaskRecurrence, clearTaskRecurrence, spawnRecurrenceSuccessorInTx"
  - "applyStatusChangeInTx creates the next occurrence when a recurring task moves into DONE"
affects:
  - "14-12 (reorderTask and bulkUpdateTasks inherit the successor through applyStatusChangeInTx)"
  - "14-13 (isolation inventory reads project-recurrence-isolation.test.ts)"
tech-stack:
  added: []
  patterns:
    - "Conditional claim update (recurrenceSpawned false to true) under the task lock before any successor write"
    - "Pure-rule RangeError mapped to the typed refusal INVALID_DATE_RANGE"
key-files:
  created:
    - src/lib/projects/recurrence.ts
    - tests/integration/project-recurrence.test.ts
    - tests/integration/project-recurrence-race.test.ts
    - tests/integration/project-recurrence-isolation.test.ts
  modified:
    - src/lib/projects/tasks.ts
decisions:
  - "A completion whose next occurrence would fall after 2999-12-31 is refused as a whole with INVALID_DATE_RANGE (the RangeError of recurrence-rules.ts never surfaces); the task stays open"
  - "setTaskRecurrence follows the contract anchor rule literally: without anchorDate the anchor is re-derived from due, start or today, so changing only the time zone of a series passes the current anchor explicitly"
  - "The successor's TASK_RECURRED row is written before the predecessor's TASK_STATUS_CHANGED row (both last in the transaction, same batchId) so the counter and key rows are taken before any activity insert (lock order of section 3)"
metrics:
  duration: "about 15 minutes"
  completed: 2026-11-09
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 4c5f8b51085baf725078768ed82fff42b6526dae
---

# Phase 14 Plan 09: Recurring tasks Summary

Daily, weekly and monthly recurrence on top-level tasks with a calendar-date anchor and an IANA zone; the next occurrence is created exactly once inside the transaction that completes the task (recurrenceSpawned claim under the task lock plus Task_recurrence_predecessor_key), with month-end clamping from the anchor, zone-correct "today" across a daylight-saving change, and PID-bound race and privacy proofs.

## What was built

- `src/lib/projects/recurrence.ts` (imports keys, rank, access, activity, recurrence-rules, contract and service; never tasks.ts):
  - `setTaskRecurrence(actor, taskId, expectedVersion, { rule, anchorDate, timeZone }, opts)`: CONTENT, PROJECT_SHARE, task FOR UPDATE through requireTask, clock read once after the locks; subtask RECURRENCE_ON_SUBTASK, bad rule INVALID_INPUT (rule), bad zone INVALID_INPUT (timeZone), malformed anchor INVALID_INPUT (anchorDate); anchor by `initialAnchor`; no-op `{ changed: false }`; conditional update on the version; one TASK_UPDATED with the changed recurrence keys.
  - `clearTaskRecurrence(actor, taskId, expectedVersion)`: same skeleton, sets the three columns to null.
  - `spawnRecurrenceSuccessorInTx(tx, { orgId, actorUserId, task, now, batchId })`: `UPDATE ... SET "recurrenceSpawned" = true WHERE ... "recurrenceSpawned" = false AND "recurrenceRule" IS NOT NULL AND "parentId" IS NULL RETURNING ...`; no row returns null. Then occurrenceBase, nextOccurrence, successorDates, assignee only when `isEligibleAssignee`, rank appended to the TODO group (explicit-organization max and appendRank, rebalance when null), counter number and key, Task insert with recurrencePredecessorId, copied TaskLabel rows, ACTIVE TaskKey, TASK_RECURRED (after: predecessorTaskId, predecessorTaskKey, key, startDate, dueDate).
- `src/lib/projects/tasks.ts`: `StatusChangeTask` gains an optional `recurrenceRule`; `applyStatusChangeInTx` calls `spawnRecurrenceSuccessorInTx` after the status update when the old status is not DONE, the new status is DONE and the rule is not null, with the caller's `opts.now` and batchId.

## Tasks and commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Tracer: a daily task completed once produces exactly one next occurrence | 9c5c574 | recurrence.ts, tasks.ts, project-recurrence.test.ts |
| 2 | Every rule, month end, time zone and lifecycle edge | 82cf4fb | project-recurrence.test.ts |
| 3 | PID-bound exactly-once race and isolation | 5e22ffb | project-recurrence-race.test.ts, project-recurrence-isolation.test.ts |

## Verification

- Task 1: `pnpm test:integration tests/integration/project-recurrence.test.ts tests/integration/project-tasks.test.ts` (Colima variables): exit 0, 2 files, 15 passed. First run failed on a test-side fixture mistake (ProjectMilestone needs a date; switched to `seedMilestone`), not on the code.
- Task 2: `pnpm test:integration tests/integration/project-recurrence.test.ts`: exit 0, 1 file, 15 passed.
- Task 3: the five-file integration run (recurrence race, isolation, recurrence, tasks, tasks race): exit 0, 5 files, 44 passed; `pnpm exec next typegen` exit 0; `pnpm typecheck` exit 0; `pnpm exec biome check src/lib/projects` plus the three recurrence test files: exit 0, no warnings.
- Acceptance greps: `grep -cE "from ['\"]\./tasks['\"]" src/lib/projects/recurrence.ts` = 0; Task 2 strings all present (2026-02-28, 2028-02-29, Asia/Jakarta, America/New_York, 2026-03-09T04:30:00Z, 2026-03-10, RECURRENCE_ON_SUBTASK, Mars/Base, recurrencePredecessorId); race file has waitForBlockedBy, assertNoDeadlock and Task_recurrence_predecessor_key, `setTimeout|sleep\(` = 0, `changed: false` = 0; isolation file names setTaskRecurrence and clearTaskRecurrence and contains projectTableSnapshot.
- The whole-repository typecheck ran before each of the three commits (exit 0 each time).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] 2999-12-31 bound mapped to a typed refusal**
- **Found during:** Task 1 (flagged by the 14-03 SUMMARY and the orchestrator)
- **Issue:** recurrence-rules.ts throws a RangeError when a result would pass 2999-12-31; the contract names no code for it, and an uncaught RangeError would be rethrown by runProjectTransaction.
- **Fix:** `withinCalendarRange` in recurrence.ts maps a RangeError of the date rules to INVALID_DATE_RANGE (the contract's date refusal); the whole completion rolls back. Test: MONTHLY due 2999-12-15 and DAILY due 2999-12-31 return exactly `{ ok: false, code: "INVALID_DATE_RANGE" }`, the task row is unchanged, no successor, no activity.
- **Commit:** 9c5c574 (code), 82cf4fb (test)

**2. [Rule 3 - Test clarity] Time zone change of the open successor**
- The plan's case "after changing the series time zone of the open successor to UTC, its own completion uses UTC" is vacuous as written, because the successor of a dateless task carries a due date (contract section 7) and a due date makes the zone irrelevant. The test therefore passes the current anchor explicitly (contract anchor rule), clears the successor's dates with setTaskDates, and completes it at 2026-04-02T17:30Z: UTC gives 2026-04-03 (Jakarta would give 2026-04-04), and the anchor stays 2026-04-01.

No contract change; no change to `14-CONTRACT.md` or `contract.ts`.

## TDD note

Tasks 2 and 3 carry `tdd="true"` inside an `execute` plan. The tracer of Task 1 already implemented the service, so the Task 2 and Task 3 cases passed on their first run; no RED commit exists for them and no code change was needed after the tracer.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat register (T-14-43 mitigated by the claim update plus the unique index and the PID-bound race; T-14-44 by `isEligibleAssignee` before copying, three cases; T-14-45 by zone validation at set time and the INVALID_DATE_RANGE mapping).

## Self-Check: PASSED

- FOUND: src/lib/projects/recurrence.ts, tests/integration/project-recurrence.test.ts, tests/integration/project-recurrence-race.test.ts, tests/integration/project-recurrence-isolation.test.ts
- FOUND commits: 9c5c574, 82cf4fb, 5e22ffb
