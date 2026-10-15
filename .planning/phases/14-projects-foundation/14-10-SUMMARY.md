---
phase: 14-projects-foundation
plan: 10
subsystem: projects
status: complete
tags: [projects, archive, favorites, hard-delete, tombstones, file-cleanup, races, isolation, redaction]
requires:
  - "14-04 (access.ts requireProject and requireTask, activity.ts and redactActivityRow, service observer)"
  - "14-05 (file-cleanup.ts enqueueFileCleanupInTx and sweepProjectFileCleanup)"
  - "14-06 (tasks.ts lockTaskTreeInTx, createTask, updateTask; keys.ts tombstoneTaskKeysInTx)"
  - "14-07 (comments.ts addTaskComment, labels.ts createLabel)"
provides:
  - "src/lib/projects/archive.ts: archiveProject, restoreProject, archiveTask, restoreTask"
  - "src/lib/projects/favorites.ts: favoriteProject, unfavoriteProject, favoriteTask, unfavoriteTask, listFavorites"
  - "src/lib/projects/delete.ts: deleteTask, deleteProject (internal removeTasksInTx)"
affects:
  - "14-11 (duplicateProject races use deleteTask, review R3-2)"
  - "14-13 (isolation inventory reads project-archive-delete-isolation.test.ts; verb pairs in project-archive-favorites.test.ts and project-delete.test.ts)"
tech-stack:
  added: []
  patterns:
    - "Six-step delete order with one shared internal removeTasksInTx (keys and counts read, TOMBSTONE, outbox, FK-order deletes), activity last"
    - "Favorite toggles at READ with a share lock (project or task FOR SHARE) so they serialize with hard deletes and stay allowed on archived work"
    - "A generic raceInOrder helper: hold one service at afterLock, prove the other's backend PID blocked by the holder's, optional work while held, then settle and check 40P01"
key-files:
  created:
    - src/lib/projects/archive.ts
    - src/lib/projects/favorites.ts
    - src/lib/projects/delete.ts
    - tests/integration/project-archive-favorites.test.ts
    - tests/integration/project-delete.test.ts
    - tests/integration/project-archive-delete-isolation.test.ts
  modified: []
decisions:
  - "deleteProject checks a missing or empty confirmName before any lock, but compares the name with the project only after the access check: comparing it first would tell an actor who cannot read the project that it exists (a wrong name still writes nothing)"
  - "restoreProject and restoreTask increment version like archiveProject and archiveTask, so an editor holding the pre-archive version gets CONFLICT"
  - "Archive activity values are { archived: false } to { archived: true, archivedAt }; restore the reverse; TASK_DELETED before holds key, title, parentId, commentCount and attachmentCount; PROJECT_DELETED before holds name, keyPrefix and the six counts"
  - "listFavorites returns up to limit projects and limit tasks (default 50, at most 200) with hasMoreProjects and hasMoreTasks, newest first, without a cursor"
metrics:
  duration: "about 45 minutes"
  completed: 2026-11-09
actuals:
  tokens: 28600
  tasks: 3
  commits: 3
plan_head_before: f230cb96015d3488a986777798b4694c85665201
---

# Phase 14 Plan 10: Archive, favorites and confirmed hard delete Summary

Projects and tasks can now be archived and restored, favorited per user (also on archived work), and hard-deleted after an explicit confirmation. A delete runs in one transaction in the six-step order of contract section 12. Old keys become TOMBSTONE, files are queued in the ProjectFileCleanup outbox, and the delete is recorded in append-only ProjectActivity rows. AuditEvent rows are never touched.

**Audit clause (owner item 14-o2):** the audit clause of AIDA-103 and AIDA-104 is recorded in ProjectActivity, owner confirmation pending (K63, D-06). A delete writes TASK_DELETED rows (one per removed task, one batchId) or one PROJECT_DELETED row with counts. It removes and changes no ProjectActivity or AuditEvent row and keeps the ProjectKeyPrefix reservation. After a project delete, nobody reads that project's feed (14-o2 default). Retention and who may read the activity of deleted projects remain open for the owner.

## What was built

- **archive.ts**
  - archiveProject (MANAGE, PROJECT_UPDATE) and restoreProject (MANAGE_ARCHIVED, PROJECT_UPDATE). Each runs a conditional update (archivedAt null and the version matching, or archivedAt not null) that increments version, then writes PROJECT_ARCHIVED or PROJECT_RESTORED. A miss is classified as NOT_FOUND, ARCHIVED or CONFLICT.
  - archiveTask (CONTENT) and restoreTask (CONTENT_ARCHIVED_TASK), both under PROJECT_SHARE. Each locks its task FOR UPDATE through requireTask, after the parent FOR SHARE for a subtask (review C3), and reads the archive state from the locked rows. Archiving a parent changes only the parent. restoreTask in an archived project, or under an archived parent, is ARCHIVED.
- **favorites.ts**
  - favoriteProject and unfavoriteProject run at READ under PROJECT_SHARE. Each calls requireProject with the share lock in its own body (review P4).
  - favoriteTask and unfavoriteTask run at READ under PROJECT_SHARE and lock the task FOR SHARE, the parent first (review R2-2).
  - The toggles use INSERT ... ON CONFLICT DO NOTHING or a delete, write no activity, and are the archive exception.
  - listFavorites filters through readableProjectWhere. Archived entries (including tasks of archived projects and subtasks of archived parents) appear only with includeArchived.
- **delete.ts**
  - deleteTask (CREATOR_OR_MANAGE, PROJECT_SHARE; confirm true and the root's version) and deleteProject (MANAGE_ARCHIVED, PROJECT_UPDATE; the exact name).
  - Step 1 takes every lock:
    - deleteTask: requireTask with the task FOR UPDATE, then lockTaskTreeInTx with the root first.
    - deleteProject: the project FOR UPDATE, all its tasks FOR UPDATE in one statement in id order, then the counter row FOR UPDATE.
  - Steps 2 to 5 run in the top-level internal `async function removeTasksInTx(`: storage keys and counts, then tombstoneTaskKeysInTx, then enqueueFileCleanupInTx, then the deletes in FK order (TaskFavorite, TaskLabel, TaskComment, TaskAttachment, then the Task rows in one statement). deleteProject then deletes ProjectLabel, ProjectMilestone, ProjectMember, ProjectTeam, ProjectFavorite, ProjectTaskCounter and the Project row.
  - Step 6 writes the activity rows, last.
  - The header comment states the K63 and 14-o2 position and the order with its reason.

## Verification

| Command | Exit | Result |
|---|---|---|
| Task 1 verify: `pnpm test:integration tests/integration/project-archive-favorites.test.ts` plus the toggle-lock loop (in `bash -c`) | 0 | 8 passed, loop printed nothing |
| Task 2 verify: the same file plus the "favorites: archive exception" grep | 0 | 23 passed |
| Task 3 verify, the whole chain as written (run with `bash` from a script file): the three integration files, `pnpm exec next typegen`, `pnpm typecheck`, biome on `src/lib/projects` and the three tests, the describe loop, the race-title loop and the removeTasksInTx order check | 0 | 54 passed in 3 files; typegen, typecheck and biome clean (23 files); loops printed nothing; order = `tombstoneTaskKeysInTx,enqueueFileCleanupInTx,DELETE` |
| Acceptance greps (Task 2 title loop; Task 3 token, `setTimeout\|sleep(` = 0, filtered `hardDeleteProjectRowsForTest` = 0, filtered AuditEvent / ProjectActivity update or delete in delete.ts = 0 each) | 0 | all as required |
| `git grep -i -n gr8r -- src tests` | 0 lines | clean-room holds |

The whole-repository typecheck passed before each of the three commits.

Proven by PID-bound races, each in both orders where the plan names two:
- archiveProject against addTaskComment (ARCHIVED).
- updateTask, addTaskComment and createTask with a parent against archiveTask (review C3).
- deleteTask against a subtask updateTask (C3).
- deleteTask against createTask, with a top-level create committing while the delete is held (R2-3).
- favoriteTask and unfavoriteTask against deleteTask (R2-2).
- favoriteProject and unfavoriteProject against deleteProject (P4).
- deleteProject against addTaskComment (NOT_FOUND).

Every settled promise is checked for 40P01, and no deadlock occurred. The redaction case "redaction: after deleteProject" runs after a real deleteProject. It compares the whole feed response with the redacted projection and scans the serialized row for S's secrets.

## Deviations from Plan

1. **deleteProject name check after access (contract section 12, step 0).**
   - The contract says confirmation is checked first. A missing or empty confirmName is checked first, but the comparison with the stored name needs the project row.
   - Comparing before the access check would answer CONFIRMATION_REQUIRED instead of NOT_FOUND to an actor who cannot read the project, which reveals that it exists. The comparison therefore runs right after requireProject; a wrong name still writes nothing (the snapshot is unchanged).
   - Section 17 isolation needs this, and contract.ts is unchanged.
2. **Verify loops run in bash.** The verify commands use bash syntax. They ran unchanged, Task 1's through `bash -c` and Task 3's from a script file run with `bash`.
3. **Test-only fix while running Task 3.** The first run failed one case because the test built storage keys with hyphens, which local file storage refuses (`invalid attachment key`). The test now strips the hyphens. Production code was not changed for this.

## Known Stubs

None. listFavorites has no keyset cursor (it returns at most `limit` of each kind with hasMore flags). This is a stated design choice for Phase 15/16 to extend if needed, not a stub.

## Manual items (human, open; not claimed)

- Owner item 14-o2: whether the ProjectActivity delete record satisfies "writes an audit event", plus retention, and who may read the activity of deleted projects.

## Self-Check: PASSED

- FOUND: src/lib/projects/archive.ts, src/lib/projects/favorites.ts, src/lib/projects/delete.ts
- FOUND: tests/integration/project-archive-favorites.test.ts, tests/integration/project-delete.test.ts, tests/integration/project-archive-delete-isolation.test.ts
- FOUND commits: 32ca2db, 5465eec, 767ff92
