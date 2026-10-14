---
phase: 14-projects-foundation
plan: 06
subsystem: projects-task-core
status: complete
tags: [tasks, task-keys, key-namespace, subtasks, trigger-lock-protocol, isolation, races, k69]
requires: ["14-04"]
provides:
  - "src/lib/projects/keys.ts: nextTaskNumberInTx, issueTaskKeyInTx, aliasTaskKeyInTx, tombstoneTaskKeysInTx, resolveTaskKey"
  - "src/lib/projects/tasks.ts: createTask, getTask, listProjectTasks, listWorkspaceTasks, updateTask, setTaskDates, setTaskStatus, setTaskParent, applyStatusChangeInTx, lockTaskTreeInTx, appendRankInTx, taskInputErrors"
affects: ["14-07", "14-08", "14-09", "14-10", "14-11", "14-12", "14-13"]
tech-stack:
  added: []
  patterns:
    - "counter UPDATE ... RETURNING after the project FOR SHARE lock, key row in the same transaction"
    - "parent FOR SHARE re-read under the lock before a subtask insert (review C3)"
    - "stale version classified right after the task lock, before no-op detection"
    - "tree lock: root first, subtasks in a second statement after it"
key-files:
  created:
    - src/lib/projects/keys.ts
    - src/lib/projects/tasks.ts
    - tests/integration/project-tasks.test.ts
    - tests/integration/project-task-keys.test.ts
    - tests/integration/project-tasks-race.test.ts
    - tests/integration/project-tasks-isolation.test.ts
  modified: []
decisions:
  - "Task edits compare the locked row's version with expectedVersion before no-op detection, so a stale version is always CONFLICT (also when the requested values equal the stored ones); the conditional update on (id, organizationId, version) stays as the fence"
  - "Input validation runs after the access check and the locks (as in 14-04), so a refused actor's result never depends on the input and stays deep-equal to the missing-id call"
  - "setTaskParent increments version (it takes expectedVersion); a status change of a subtask keeps its rank (its group is its parent)"
  - "createTask returns { ok, taskId, key, number, version: 0 }; edits return { ok, changed: true, version } or { ok, changed: false }"
  - "listWorkspaceTasks orders by id with an id keyset; it leaves out archived projects, archived tasks and subtasks of archived parents"
metrics:
  duration: "about 9 min"
  completed: "2026-11-09"
estimate:
  tokens: 130000
actuals:
  tokens: 24617
  tasks: 3
  commits: 3
plan_head_before: c53775f0be303e8c41d85cbaeb94676efb6bb45f
---

# Phase 14 Plan 06: Task core with keys, one-level subtasks, races and isolation Summary

Tasks get a project key from a locked counter (20 parallel creates get keys 1 to 20). They can be read with the description rendered safely, edited under a version check, dated, moved through statuses, nested one level and found by key through ACTIVE, ALIAS and TOMBSTONE rows. The subtask trigger protocol, prefix changes, concurrent edits and the tree lock are proven in PID-bound races. All nine operations are proven for the section 17 actors on a private project.

## Exported signatures for later plans

keys.ts:
- `nextTaskNumberInTx(tx, orgId, projectId): Promise<number>`: counter `UPDATE ... RETURNING` with the organization term. No row returned gives KEY_SPACE_EXHAUSTED. Call it after the project lock.
- `issueTaskKeyInTx(tx, { orgId, projectId, taskId, prefix, number }): Promise<string>`: inserts the ACTIVE row and returns the key.
- `aliasTaskKeyInTx(tx, orgId, key): Promise<number>`: turns the ACTIVE row of that key into ALIAS. Returns the count changed (0 for a malformed key).
- `tombstoneTaskKeysInTx(tx, orgId, taskIds): Promise<number>`: turns every non-tombstone row of those tasks into TOMBSTONE.
- `resolveTaskKey(actor, key): ProjectResult<{ taskId, key, projectId, isAlias }>`: `key` is the task's current key. Malformed, missing, tombstoned or unreadable keys are NOT_FOUND.

tasks.ts:
- `createTask(actor, projectId, { title, description?, status?, priority?, assigneeUserId?, startDate?, dueDate?, estimateMinutes?, parentId? }): ProjectResult<{ taskId, key, number, version }>`
- `getTask(actor, taskId): ProjectResult<{ task: TaskView }>`. TaskView holds the section 15 fields, CalendarDate strings, `descriptionHtml`, `labels` ({ id, name, color }, by name), `milestone` ({ id, name } or null), recurrence fields, `subtasks` ({ id, key, title, status, rank, archivedAt } in (rank, id)) and `archivedViaParent`.
- `listProjectTasks(actor, projectId, { status?, parentId?, assigneeUserId?, archived?, cursor?, limit? })` and `listWorkspaceTasks(actor, { assigneeUserId?, status?, dueFrom?, dueTo?, cursor?, limit? })`: both return `{ tasks: TaskListItem[], hasMore, nextCursor }`.
- `updateTask(actor, taskId, expectedVersion, { title?, description?, priority?, assigneeUserId?, estimateMinutes? })`, `setTaskDates(actor, taskId, expectedVersion, { startDate?, dueDate? })`, `setTaskStatus(actor, taskId, expectedVersion, status, { now? })`, `setTaskParent(actor, taskId, expectedVersion, parentId | null)`: each returns `{ changed: true, version }` or `{ changed: false }`.
- `applyStatusChangeInTx(tx, { orgId, actorUserId }, { id, projectId, parentId, status, version }, newStatus, { now, batchId, record? = true }): Promise<{ before: { status }, after: { status }, version }>`. The caller must hold the project FOR UPDATE and the task FOR UPDATE. A top-level task is appended to its new status group (rebalance allowed). A version mismatch is CONFLICT. Plan 14-09 adds the recurrence successor here.
- `lockTaskTreeInTx(tx, orgId, rootTaskId, "share" | "update"): Promise<{ root: TreeTaskRow, subtasks: TreeTaskRow[] } | null>`. TreeTaskRow holds id, projectId, parentId, number, key, status (text), rank, version and archivedAt.
- `appendRankInTx(tx, orgId, group: { projectId, status, parentId?: null } | { projectId, parentId }, { canRebalance, excludeTaskId? }): Promise<number>`
- `taskInputErrors(input, { requireTitle? }): { code: "INVALID_INPUT" | "INVALID_DATE_RANGE", field? }[]`
- Types: `TaskInput`, `CreateTaskInput`, `UpdateTaskPatch`, `TaskView`, `TaskListItem`, `RankGroup`, `StatusChangeContext`, `StatusChangeTask`, `TreeTaskRow`.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 | Tracer: keys, createTask and getTask; 20 parallel creates | 8ea4e89 |
| 2 | Edits, dates, status, parenting, lists, resolver and namespace helpers | c62584c |
| 3 | PID-bound races and the isolation matrix | 9ac8470 |

## Verification

- Task 1 verify (2 files): exit 0, 4 tests passed. The tracer gate re-ran it before expansion.
- Task 2 verify (2 files): exit 0, 18 tests passed. Acceptance greps: every required code name is present; the stale-version `it(` grep prints 3; all four helpers are exported.
- Task 3 verify (the whole command: 4 integration files, `next typegen`, `pnpm typecheck`, biome): the first run had 36 tests passed and typegen and typecheck clean. Biome then reported 4 formatting and import-order errors in this plan's files, so the run exited 1. `biome check --write` fixed those six files and the whole command was run again unchanged: exit 0, 36 tests passed, biome clean on 14 files. It ran in zsh with no `bash -c` fallback needed.
- Race file: both trigger messages, waitForBlockedBy, assertNoDeadlock and lockTaskTreeInTx are present; `setTimeout|sleep(` counts 0. Isolation file: all nine operation names, projectTableSnapshot, MEMBERSHIP_ENDED, aliasTaskKeyInTx, issueTaskKeyInTx and isAlias are present.
- Clean-room: `git grep -i -n gr8r -- src docs website README.md public prisma tests` is empty. No `@/` import and no Next.js import in keys.ts or tasks.ts.

## Deviations from Plan

1. **[Acceptance reading] The literal grep `export async function <name>(actor` matches 0.** The formatter wraps every long signature onto the next line. A multiline match (`export async function <name>\(\s*actor`) finds each of the eight operations exactly once. This is the same reading as 14-04's projects.ts.
2. **[TDD shape] No separate RED commits.** The tests and code of Tasks 2 and 3 went into one commit each, as 14-02 and 14-04 did. No case is skipped.
3. **[Rule 2] One extra race case.** Task 2's behavior says setTaskStatus locks the project FOR UPDATE. This is proven PID-bound in the race file: createTask waits behind a held setTaskStatus. A plain test cannot see row locks.
4. **Commit 9ac8470 also carries the biome formatting** of tasks.ts and the two Task 1 and 2 test files (whitespace and import order only).
5. **Isolation for resolveTaskKey and listWorkspaceTasks.** missingId() has no key form. The KEY comparison uses `NOWHERE-1`, a well-formed key that exists nowhere. The resolveTaskKey block still calls missingId(), so the 14-13 inventory finds it.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or file access was added. T-14-28 to T-14-32 are covered by the cases above.

## Self-Check: PASSED

- FOUND: the six files under key-files.created
- FOUND: commits 8ea4e89, c62584c and 9ac8470
