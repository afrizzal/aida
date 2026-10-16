# Phase 14: Code Review Fix Report

Source reviews: `14-REVIEW.md` (part a, with the orchestrator dispositions), `14-REVIEW-b.md`, `14-REVIEW-c.md`.

## F1

Fixer: Claude (gsd-code-fixer), 2026-11-09. Branch `v2/run-loop`, main checkout (`workflow.use_worktrees` is false), so every test ran in the main checkout. Fix scope: the rows of the disposition table whose batch is F1, 15 rows. All 15 are fixed. Each behaviour change has a test that was run red before the fix and green after it. No assertion was weakened. Where an existing test encoded the old behaviour, its expectation was changed to the decided behaviour. Those changes are listed under "Changed expectations".

New test files:
- `tests/integration/project-review-fixes.test.ts`: one describe per finding.
- `tests/integration/project-review-race.test.ts`: lock-order races, bound to backend PIDs with `tests/support/lock-wait.ts`, no sleeps.
- `tests/unit/project-db-errors.test.ts`.

The sweep cases were added to `tests/integration/project-file-cleanup.test.ts`, because that file owns the ProjectFileCleanup table.

### Rows

| Row | Commit | Failing-first evidence (red run, cause) | Fix |
|---|---|---|---|
| a-IN-07 | 7c35704 | `project-db-errors.test.ts` against the old mapper, moved unchanged into `db-errors.ts`: 4 of 6 failed. The length CHECKs were unmapped. 40P01 was unmapped. A row detail containing `Task subtask depth exceeded` or `Task_dates_check` changed the mapping. A 23503 or 23514 of another constraint whose detail names a mapped constraint was mapped instead of rethrown. | `mapDatabaseError` lives in `src/lib/projects/db-errors.ts` and is re-exported by `service.ts`. It reads only the server error that the pg driver adapter reports (`originalCode`, `originalMessage`) or that a pg error carries (`code`, `severity`, `constraint`). The constraint name is taken from PostgreSQL's fixed 23505 and 23514 message shapes. P0001 is matched by exact message. 40P01 maps to CONFLICT. The text length CHECKs map to INVALID_INPUT with their field. The shapes were recorded from real errors with a throwaway probe test, which was deleted and never committed. Contract section 14 updated. |
| a-WR-05, b-WR-02 | d88bfc5 | Integration: a project description of 5000 code points plus surrounding whitespace, and a task description of 20000 plus a newline. Both were refused `INVALID_INPUT description` through the new CHECK mapping, and before a-IN-07 they would have been thrown errors. | `validDescription` in `projects.ts` and `parseTaskInput` in `tasks.ts` store the trimmed text that was validated. The CHECK mapping comes from the a-IN-07 commit. Contract section 15 updated. |
| a-IN-02 | 7bbc6ee | Integration: a stale version with equal values returned `{ ok: true, changed: false }`. | `editProject` compares `expectedVersion` with the row it locked FOR UPDATE before the no-op test. Contract section 14 updated. |
| a-WR-04 | e6002a1 | Integration: an org admin made the project private after its only manager's member row was removed, and got `{ ok: true, changed: true }`. | `setProjectPrivacy(true)` runs `assertActiveManager` in `beforeWrite` and returns LAST_MANAGER when no MANAGER row belongs to an active member. Contract section 2 updated. |
| a-IN-04 | df1dc00 | Integration, in the same red run as a-WR-04: promoting a stale row returned `{ ok: true, changed: true }`. | `setProjectMemberRole` to MANAGER returns NOT_ELIGIBLE without a `member` row. Contract section 2 updated, in commit e6002a1. |
| a-WR-01, b-IN-02 | e069075 | Race (PIDs): a comment waited on project A while moveTask held it, and after the move committed the comment returned `{ ok: true, ... }`. It had restarted and locked project B while still holding A. | `requireTask` returns CONFLICT when the locked task's project differs from the plain read, or when the parent left the project. Only a changed parent restarts, and the second attempt never names another project. 40P01 maps to CONFLICT as a last resort (a-IN-07 commit). Contract section 2 updated, in commit 2339fa3. |
| a-WR-02 | 64bc2b3 | Race (PIDs): a blocker held the creator's `user` row, so createProject stopped at its Project insert's foreign key check with the prefix index entry written. A prefix change to the same prefix then waited on the create. When the blocker was released, PostgreSQL detected the deadlock (about 1 s) and one side came back as CONFLICT (the mapped 40P01) instead of the expected `{ ok: true }` and PREFIX_TAKEN. | `createProject` generates the project id (`randomUUID`) and reserves the prefix before inserting the Project row, the same order as `changeProjectKeyPrefix`. Contract section 6 updated, in commit 2339fa3. |
| a-WR-03 | 2339fa3 | Race (PIDs): deleteTeam waited for the project lock while deleteProject held it, and after the project delete committed, deleteTeam returned NOT_FOUND. | deleteTeam locks the candidate projects FOR UPDATE in id order without refusing on missing rows. It then re-reads the links under those locks, deletes them and writes TEAM_UNASSIGNED only for links it removed. Contract section 3 updated. |
| a-CR-01 (K71) | 4c71083 | Integration, two worlds that differ only by hidden private projects of another user: the list pages, decoded cursors (`[2048,"V2"]` vs `[3072,"V2"]`), `getProject.position`, the `changed` flags and the PROJECT_REORDERED values all differed. | `position` is removed from `ProjectView` and `ProjectListItem`. The listProjects cursor is `[id]`, and the server re-reads that project's position under the read predicate (unreadable or gone: INVALID_INPUT cursor). moveProjectPosition decides its no-op from the caller's readable order, places the project directly after its anchor in the full order and rebalances internally. PROJECT_REORDERED has `before` and `after` null, because a neighbour id or a position would leak to other feed readers. Contract sections 5, 8 and 16 and `contract.ts` updated. |
| b-WR-01 | 1813f01 | Integration: a bulk call `{ status: DONE, dueDate: 2026-12-01, priority, assignee, labels }` on a WEEKLY task due 2026-11-01 created a successor due 2026-11-08 with stale values. | `bulkUpdateTasks` writes the fields and the label removals and additions first. The status change, and with it the spawn, runs last and still matches on the unchanged version. Contract section 7 updated, in commit e4c66f8. |
| b-IN-03 | 0e1c131 | Integration: a target-only reader received the predecessor id of a task in a private project. | `getTask` returns `recurrencePredecessorId` only when the predecessor's current project is readable by the caller. Otherwise it returns null, also when the predecessor is deleted. |
| a-IN-03 | e4c66f8, 9c66519 | Integration: a value of exactly 4096 bytes as compact JSON was refused by the database CHECK (`new row for relation "ProjectActivity" ...`), not by the writer. The positive case confirmed that a value of exactly 4096 bytes as `jsonb::text` passes the CHECK. The first test draft was wrong (strings over 200 code points are cut), so it was rebuilt with arrays before the red run counted. | The writer measures compact JSON plus the spaces PostgreSQL prints after every colon and comma. Commit 9c66519 restores a contract expression that a shell heredoc had eaten in e4c66f8. Contract section 5 updated. |
| b-IN-05 | df40e92 | Integration: a row at 19 attempts failed once more and was selected again a month later. A hung storage delete hung the sweep past the 30 s transaction timeout, and the test timed out at 60 s. | Rows with `attempts >= PROJECT_FILE_CLEANUP_MAX_ATTEMPTS` (20) are no longer selected and stay as the report. A "retries stopped" log line is written once. The file I/O of one run is bounded by `PROJECT_FILE_CLEANUP_IO_BUDGET_MS` (20 000 ms, under the 30 s transaction timeout; option `ioBudgetMs`). A delete that has not settled is recorded as ETIMEDOUT, and the rows not reached stay untouched. File I/O stays inside the locked row's transaction because it is now bounded. Contract section 12 and `contract.ts` updated. |
| b-IN-09 | 7a4d3e5 | Integration: `listProjects({ limit: 201 })` returned ok (clamped). | One `listLimit` in the service kit: absent is the default, 1 to max is used, anything else is INVALID_INPUT field limit. It applies to listProjects, the task lists, listFavorites, comments and attachments (through `pageLimit`) and the three activity feeds (max 100). Contract section 15 updated. |
| a-WR-07, b-WR-05 | 79f7b77 | Integration: paging listProjectMembers with limit 2 returned rows with no `hasMore` and no cursor. An organization with 203 members gave no `hasMore` for listEligibleAssignees. | `{ cursor, limit }` with `hasMore` and `nextCursor`: members by (role, name, userId) and assignees by (name, userId), both paged after the `member` re-check; teams and project teams by (name, id); milestones by (date, id); listFavorites with `projectsCursor`/`tasksCursor` and `nextProjectsCursor`/`nextTasksCursor`. Shared helpers `encodeKeyset`, `decodeKeyset`, `pageInMemory` and `ListPageOpts` are in `service.ts`. Contract section 15 updated. |

### Changed expectations in existing tests (decided behaviour, no assertion removed)

- `project-core.test.ts`:
  - The updateProject no-op call uses the current version 1. A stale 0 is now CONFLICT (a-IN-02).
  - PROJECT_REORDERED expects `before: null, after: null` (K71).
  - `listProjects({ limit: 5000 })` expects INVALID_INPUT limit, and `limit: 200` succeeds (b-IN-09).
- `project-members-isolation.test.ts`, `project-members-teams.test.ts`, `project-archive-favorites.test.ts` and `project-archive-delete-isolation.test.ts`: the deep-equal results of listTeams, listProjectTeams and listFavorites gain `hasMore: false, nextCursor: null` or `nextProjectsCursor: null, nextTasksCursor: null` (a-WR-07, b-WR-05).

### Contract changes (14-CONTRACT.md, and contract.ts where it holds the rule)

The changes are in sections 2, 3, 5, 6, 7, 8, 12, 14, 15 and 16, as named per row above. No operation name and no refusal code changed. `contract.ts` gained:
- the constants `PROJECT_FILE_CLEANUP_MAX_ATTEMPTS` and `PROJECT_FILE_CLEANUP_IO_BUDGET_MS`;
- a K71 comment on `moveProjectPosition`.

### Not done, with reason

- b-IN-09, second half (`cleanupQueued` reports the collected keys rather than the inserted rows): the disposition for b-IN-09 names only "one rule for list limits", so it was left as it is.
- The a-WR-01 subtask path (the parent's lock read finds no parent because the tree moved) is fixed in code, but only the top-level path has a race test.
- The a-WR-02 race is proven in one order (the create first). The other order needs the change parked between its reservation and its Project update, and no seam exists there. In that order the change's reservation is already committed or blocks the create's reservation, so a deadlock is not reachable.

### Gates (one process at a time, main checkout)

- `pnpm test`: exit 0. 50 files, 801 tests passed.
- `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts` (Testcontainers, Colima socket env): exit 0. 90 files, 1216 tests passed.
- `pnpm exec next typegen`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (548 files, no fixes).
- `tests/unit/project-operation-inventory.test.ts`: green, as part of `pnpm test`.
- Affected integration files, run one by one per fix before each commit: all green at the time of the commit. Red runs are listed per row above.
