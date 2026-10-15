---
phase: 14-projects-foundation
plan: 12
subsystem: projects
status: complete
tags: [projects, ordering, bulk, progress, races, isolation]
requires: ["14-07", "14-09", "14-11"]
provides:
  - "reorderTask (src/lib/projects/ordering.ts)"
  - "bulkUpdateTasks (src/lib/projects/bulk.ts)"
  - "getProjectProgress, getProjectsProgress, getTaskProgress (src/lib/projects/progress.ts)"
affects: ["14-13", "Phase 15 board, list and bulk views"]
tech-stack:
  added: []
  patterns:
    - "placement by rankBetween over the group read after the lock (the moved task excluded), with an in-transaction rebalance only when no integer fits"
    - "bulk: read-predicate resolve, projects FOR UPDATE in id order, tasks FOR UPDATE in one statement in id order, every per-task check before the first write"
    - "progress from count and groupBy with explicit organization terms, never stored"
key-files:
  created:
    - src/lib/projects/ordering.ts
    - src/lib/projects/bulk.ts
    - src/lib/projects/progress.ts
    - tests/integration/project-ordering-bulk.test.ts
    - tests/integration/project-progress.test.ts
    - tests/integration/project-ops-race.test.ts
    - tests/integration/project-ops-isolation.test.ts
  modified: []
decisions:
  - "bulkUpdateTasks resolves each task through the read predicate before any lock, so a batch holding a task of an unreadable private project is NOT_FOUND before any ARCHIVED or other check; a readable archived project can therefore never answer differently from a batch with a missing id"
  - "bulkUpdateTasks answers a malformed task id NOT_FOUND (like a missing one); empty id list INVALID_INPUT field taskIds; empty patch INVALID_INPUT field patch; an id in both addLabelIds and removeLabelIds INVALID_INPUT field labelIds; more than MAX_TASK_LABELS after the change TOO_MANY"
  - "Label changes in bulk are recorded as labelNames before and after (the setTaskLabels format) and increment version once"
  - "reorderTask returns { changed, status, rank, version }; a status change is applied first through applyStatusChangeInTx (its append may rebalance the target group), then the group is read again and the requested slot is computed"
  - "getProjectsProgress (LIST) accepts at most LIST_MAX distinct ids (TOO_MANY above) and returns entries in the given order, deduplicated"
metrics:
  duration: "about 40 minutes"
  completed: 2026-11-09
estimate:
  tokens: 125000
actuals:
  tokens: 17300
  tasks: 3
  commits: 3
plan_head_before: 831d33b72d7e1a05a83d9576913069f7c9dbc443
---

# Phase 14 Plan 12: Reorder, bulk update and derived progress Summary

reorderTask places a task after a given task of its group (or first), optionally in another status column, under the project FOR UPDATE lock with rankBetween and an in-transaction rebalance, writing exactly one TASK_STATUS_CHANGED or TASK_REORDERED row; bulkUpdateTasks changes up to 100 tasks across projects atomically with one row per changed task sharing a batch id; progress is derived on read; races are PID-bound in both orders and isolation follows section 17.

## What was built

- `src/lib/projects/ordering.ts`: `reorderTask(actor, taskId, { status?, placeAfterTaskId }, opts)`. CONTENT, PROJECT_UPDATE (requireTask with the update lock), afterLock. Group: top-level by project and target status, subtasks by parent. placeAfterTaskId outside the group, the task itself or malformed is INVALID_INPUT field placeAfterTaskId. Status change through `applyStatusChangeInTx` with record false (recurring task into DONE creates its successor and TASK_RECURRED with the same batch id). Rank from `rankBetween`; `rebalancedRanks` with raw updates (organization term, `"updatedAt" = now()`) when null. One row: TASK_STATUS_CHANGED (status and rank) or TASK_REORDERED (rank). The current placement is `{ changed: false }` with no row. Rank changes never increment version.
- `src/lib/projects/bulk.ts`: `bulkUpdateTasks(actor, taskIds, patch, opts)` with status, assigneeUserId, priority, startDate, dueDate, milestoneId, addLabelIds, removeLabelIds. Validation before any lock (TOO_MANY above BULK_MAX distinct ids). Membership, read-predicate resolve, `lockProjectsInIdOrder` FOR UPDATE, CONTENT on each project, tasks FOR UPDATE in one statement in id order (CONFLICT if a task left the locked projects), afterLock, all per-task checks, then writes. Version incremented once per changed task (by applyStatusChangeInTx when the status changes, else by the field update). One TASK_STATUS_CHANGED (with the other changed keys) or TASK_UPDATED row per changed task, shared batch id; unchanged tasks get none. Returns `{ changedCount, batchId }`.
- `src/lib/projects/progress.ts`: `getProjectProgress`, `getProjectsProgress`, `getTaskProgress`, READ with no lock, `{ done, total, percent }` with percent = floor(done * 100 / total) or 0.

## Verification

| Command | Exit | Result |
|---|---|---|
| Task 1 verify: `pnpm test:integration tests/integration/project-ordering-bulk.test.ts` (Colima variables) | 0 | 1 file, 2 tests passed |
| Task 2 verify: ordering-bulk and progress files | 0 | 2 files, 16 tests passed |
| Task 3 verify (whole command, run inside `bash -c`): four integration files, `next typegen`, `pnpm typecheck`, biome on `src/lib/projects` and the four files, describe loop | 0 | 4 files, 34 tests passed; typecheck clean; biome clean; no "missing describe" |
| `pnpm typecheck` before each commit | 0 | clean |

Acceptance greps: `export async function reorderTask(actor` and `export async function bulkUpdateTasks(actor` and the three progress reads were checked with an equivalent multiline match (biome wraps the signatures onto separate lines); the race file has 0 matches for `setTimeout|sleep\(` and both exact titles `it("duplicateTask: duplicate first"` and `it("duplicateTask: reorder first"`; every required token is present. Each of the six (operation, verb) pairs is asserted inside one `it` block that calls the operation: (reorderTask, TASK_STATUS_CHANGED) in the tracer case, (reorderTask, TASK_REORDERED) in the first-in-column case, (reorderTask, TASK_RECURRED) in the recurring case, (bulkUpdateTasks, TASK_UPDATED) in the two-project case, (bulkUpdateTasks, TASK_STATUS_CHANGED) and (bulkUpdateTasks, TASK_RECURRED) in the recurring bulk case; no case had to be added for this check.

## Deviations from Plan

1. **Task 2 (tdd="true") was not split into a RED commit and a GREEN commit.** The tests and the implementation were written together and committed as one task commit (7135d45), as the plan's per-task atomic commit rule allows; the tests were run against the implementation, not first against its absence. No behavior was weakened.
2. **bulk.ts locks tasks with a raw `SELECT "id", "projectId" ... FOR UPDATE` and then reads the locked rows with a typed Prisma findMany** (same transaction, after the lock) instead of selecting every field in the raw statement, to get typed enum and date values. Still one locking statement in id order (contract section 3).

No Rule 1 to 4 fix was needed in earlier plans' code.

## Known Stubs

None.

## Threat Flags

None. T-14-57 (unreadable task in a batch: NOT_FOUND as a whole, deep-equal to a missing id, snapshot unchanged), T-14-58 (BULK_MAX, rebalance only when no gap), T-14-59 (races in both orders) and T-14-60 (one row per changed task with a shared batch id) are covered by the test files above.

## Self-Check: PASSED

- All seven created files exist.
- Commits cb34e20, 7135d45 and be96dce exist on v2/run-loop.
