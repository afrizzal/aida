---
phase: 14-projects-foundation
plan: 11
subsystem: projects
status: complete
tags: [projects, move, duplicate, keys, redaction, races, isolation]
requires: ["14-06", "14-07", "14-10"]
provides:
  - "moveTask (src/lib/projects/move.ts)"
  - "duplicateTask, duplicateProject (src/lib/projects/duplicate.ts)"
affects: ["14-12", "14-13", "Phase 15 move operation"]
tech-stack:
  added: []
  patterns:
    - "one UPDATE over a task tree through an unnest join with the organization term (C3)"
    - "label and milestone mapping by SQL lower(name), the same function as the unique indexes"
    - "duplicate placement with rankBetween and an in-transaction rebalance under PROJECT_UPDATE"
key-files:
  created:
    - src/lib/projects/move.ts
    - src/lib/projects/duplicate.ts
    - tests/integration/project-move.test.ts
    - tests/integration/project-duplicate.test.ts
    - tests/integration/project-move-duplicate-isolation.test.ts
  modified: []
decisions:
  - "moveTask refuses CONFLICT when the locked root's projectId differs from the plain read (a move committed before the lock) instead of starting over, because a retry would lock further projects after the two already held, out of id order; such a task's version has moved anyway"
  - "The move's tree UPDATE joins unnest() of six typed arrays instead of a VALUES list; one statement, organization term, same effect"
  - "duplicateProject copies no recurrence (contract section 11 lists none; a copy never starts a second series, as for duplicateTask)"
metrics:
  duration: "about 45 minutes"
  completed: 2026-11-09
estimate:
  tokens: 140000
actuals:
  tokens: 25000
  tasks: 3
  commits: 3
plan_head_before: d3debb0817ba484ee2032138eb6c03b86b23b859
---

# Phase 14 Plan 11: Move and duplicate Summary

moveTask moves a top-level task tree between projects under both projects' FOR UPDATE locks in id order, with new keys from the target counter, old keys as aliases, labels and milestone mapped by lower(name) in one tree UPDATE and one TASK_MOVED row redacted per reader; duplicateTask places its copy directly after the source (rebalancing when needed) and duplicateProject copies one committed state of its source taken under the source FOR UPDATE lock.

## What was built

- `src/lib/projects/move.ts`: `moveTask(actor, taskId, targetProjectId, expectedVersion)`. Plain read of the task's project, `lockProjectsInIdOrder` FOR UPDATE on source and target, CONTENT on both through `requireProject`, same project INVALID_INPUT, `lockTaskTreeInTx` (root, then subtasks), SUBTASK_MOVE, ARCHIVED, `afterLock`, version check. New numbers per task (root first, subtasks in (rank, id)), root rank appended to the target group, TaskLabel rows deleted, one UPDATE over the tree (projectId, number, key, rank, milestoneId, assignee, version + 1), label links re-created for names that exist in the target, old keys `aliasTaskKeyInTx`, new keys `issueTaskKeyInTx`, one TASK_MOVED row with the whole source side in before and the whole target side (plus subtaskCount) in after.
- `src/lib/projects/duplicate.ts`: `duplicateTask(actor, taskId)` (CONTENT, PROJECT_UPDATE; `rankBetween` with the next task in (rank, id), `appendRank` when last, `rebalancedRanks` through raw updates with `"updatedAt" = now()` when no integer fits; subtasks (i + 1) * RANK_GAP; no comments, attachments, favorites or recurrence) and `duplicateProject(actor, projectId, { name, keyPrefix, includeTasks })` (READ with the source FOR UPDATE, every source read after `afterLock`; project, MANAGER row, counter and prefix reservation as createProject writes them; labels and milestones copied and mapped; tasks keyed in (status order, rank, id) with subtasks after their parent; eligible assignees only). PROJECT_DUPLICATED and TASK_DUPLICATED rows with one batch id and both sides written whole.

## Verification

| Command | Exit | Result |
|---|---|---|
| Task 1: `pnpm test:integration tests/integration/project-move.test.ts` (Colima variables) | 0 | 1 passed |
| Task 2: same file, then the five-title loop | 0, 0 | 13 passed; loop printed nothing |
| Task 3: the three files in one run | 0 | 36 passed (3 files) |
| `pnpm exec next typegen` | 0 | |
| `pnpm typecheck` (whole repository, also before each commit) | 0 | |
| `pnpm exec biome check src/lib/projects` and the three test files | 0 | no errors |
| Task 3 seven-title loop | 0 | printed nothing |
| Acceptance greps (Tasks 1 to 3), sleep grep, recurrence-import grep | | all present; `setTimeout|sleep(` 0 in both race files; recurrence import 0 |

Race PIDs are printed by each file's afterAll (`project-move PIDs`, `project-duplicate PIDs`); every race waits for the recorded waiter PID to be blocked by the recorded holder PID, and every settled promise passes `assertNoDeadlock`.

## Deviations from Plan

1. **Task 1 already carries the Task 2 mappings.** The plan let Task 1 clear labels, milestone and assignee and add the mappings in Task 2. move.ts was written with the mappings from the start, so the Task 2 commit contains tests only and move.ts is unchanged since Task 1.
2. **unnest instead of VALUES.** The tree UPDATE joins `unnest()` of typed arrays rather than a VALUES list (the repository has no Prisma.join usage); it is still one statement with the organization term.
3. **CONFLICT instead of a second attempt** when the locked root's project differs from the plain read (see decisions). The contract's "start over once" would lock further projects after the two already held.
4. **Acceptance grep on wrapped signatures.** Biome wraps `export async function moveTask(actor`, `duplicateTask(actor` and `duplicateProject(actor` over two lines; the equivalent multiline match (`export async function moveTask(` followed by `actor: ProjectActor,`) was used.
5. **Verify loops** were run inside `bash -c` (unchanged text), as the plan's loops use bash syntax.
6. **The "update then move" race** calls moveTask with expectedVersion 1, the version the held edit produces, so the move runs after the edit and carries it (the plan's "the move succeeds and carries the edit"). The reverse race uses the old version and proves CONFLICT with no write.

hardDeleteProjectRowsForTest needed no change: every project it removed here has no subtasks.

## Known Stubs

None.

## Threat Flags

None. The surfaces are those of the plan's threat model (T-14-52 to T-14-56, T-14-55b, T-14-55c), each covered by the cases above.

## Self-Check: PASSED

- FOUND: src/lib/projects/move.ts, src/lib/projects/duplicate.ts, tests/integration/project-move.test.ts, tests/integration/project-duplicate.test.ts, tests/integration/project-move-duplicate-isolation.test.ts
- FOUND commits: 6ae1b66, 2c68f56, 6eaa500
