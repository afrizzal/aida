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

## F2

Fixer: Claude (gsd-code-fixer), 2026-11-09. Branch `v2/run-loop`, main checkout (`workflow.use_worktrees` is false), so every test ran in the main checkout. Fix scope: the 9 rows of the disposition table whose batch is F2. All 9 are fixed.

Each strengthened test was run against a deliberately broken copy of the code. The copy was then restored, and `git diff` was checked: no change was left in `src/`. No assertion was weakened, and no fixed sleep was added. No file holds a literal invisible character. Unit strings are built with `String.fromCodePoint`, and a Unicode category scan of the two edited files found none.

### Rows

| Row | Commit | Failing-first evidence (broken copy, red run, cause) | Fix |
|---|---|---|---|
| b-WR-04 | 06d850f | The old `cleanDisplayName` (C0 and DEL only), restored from HEAD, failed 25 of 42 tests in `validate-upload.test.ts`: every bidi mark, embedding, override and isolate (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069), C1 (U+0080, U+0085, U+009F), zero-width (U+200B-U+200D, U+2060, U+FEFF), U+2028 and U+2029, the all-invisible fallback, and the `validateUpload` path. | `cleanDisplayName` removes Unicode categories Cc, Cf, Zl and Zp (`/^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u`). Visible non-ASCII letters and emoji are kept, and there is a test for that. |
| c-WR-01 | 7b5db90, 17474c3 (import order) | `filesOnDisk` was pointed at a wrong root, a regular file, so `readdir` gives ENOTDIR. With the new helper, 6 of 13 tests failed with ENOTDIR. With the old swallowing helper on the same wrong root, only 2 failed (the cases that assert a file exists), and the "no file on disk" assertions passed without checking anything. | Shared fixture `filesUnder(dir)` in `tests/support/project-fixtures.ts`. It lists files recursively and sorted. Only ENOENT counts as empty, and every other error is rethrown. `filesOnDisk` uses it. |
| c-WR-02 | 0ae76cb | `uploadTaskAttachments` was changed to save a blob in `actor.orgId` before its access check. The isolation case failed at the new disk assertion: `expected [[…(7)], […(2)]] to deeply equal [[], []]`, which means orphans in both A and B. The database snapshot and the activity count did not see them. | Before the refused calls, the case lists `UPLOADS_DIR/<orgA>` and `UPLOADS_DIR/<orgB>` with `filesUnder`. After them, it asserts that both lists are unchanged. |
| c-WR-03 | 4eb500c | The 8 new negative cases, run against the old resolver (HEAD helpers with the new cases appended), all failed: MEMBERSHIP_ENDED only in an it title, only in a trailing comment, or only in a non-`code:` string literal; `getTask(` and `missingId(` only in a string and an inline block comment; activity reached only through `seedActivity(`; activity only as `projectActivity.create` or as the type `ProjectActivity`; "hidden private link" outside every title; a verb only in the it title or a comment. With the fix, all 29 inventory tests pass, including the three gates on the real repository. | Markers are matched on `markerText`: a scanner removes string literals, trailing `//` comments and inline block comments, and so test titles too. Module definitions get the same treatment. `code: "X"` is kept as the bare word X, because it asserts a code. The hidden-link marker reads only the describe, it and test titles. `seed*` helpers are not expanded. The activity marker must be a read: `projectActivity.(count\|findMany\|findFirst\|aggregate\|groupBy)(`. In `activityGaps`, a call or verb named only in a title or comment no longer counts. |
| c-WR-04 | 3fc1e89 | `addTaskComment` was changed so that, when the task lies in another organization, it creates a Team row in `actor.orgId` before access. The HEAD test (org A only) passed against it: 1 passed. The strengthened test failed at the snapshot comparison (content-isolation.test.ts:117, `[{…(18)}, …(1)]` not equal). | Shared fixtures `projectTableSnapshotAll(prisma, orgIds)` and `projectActivityCounts(prisma, orgIds)`. Six files snapshot `[orgA, orgB]` before and after every refused call: archive-delete, content, core, members, recurrence and tasks. move-duplicate and ops already did. Their now-unused local `activityCount` helpers were removed. The inventory accepts `projectTableSnapshotAll(` as the snapshot marker and does not expand it. |
| c-IN-01 | 074d435 | Comment only, no behaviour to fail. | The comment at the `beforeEach` wipe names its dependency on `fileParallelism: false` and on one test process at a time, and names the two files whose outbox rows a parallel run would delete. |
| c-IN-02 | 7b5db90, 0ae76cb | No behaviour to fail. Both files run green with the restore. | `project-comments-attachments.test.ts` and `project-content-isolation.test.ts` save the previous `UPLOADS_DIR` and restore it in `afterAll` (delete it when it was unset). The temporary directories stay, because the charter allows no recursive delete. |
| c-IN-03 | 074d435 | `FOR UPDATE SKIP LOCKED` in the sweep was changed to `FOR UPDATE`. The case failed in 128 ms with `sweep 2 blocked behind sweep 1: PID(s) 249 wait on 239`. Before the fix, the same regression could only hang until the 60 s test timeout. | The vacuous `pg_blocking_pids` read inside `onLocked` is removed. While sweep 2 runs, an observer watchdog queries without pause for any backend blocked by sweep 1's PID. A query in a loop, not a sleep. On a hit it releases sweep 1 and fails with the PIDs. The case also asserts that the watchdog checked at least once. |
| c-IN-04 | 861f8ba | Comment only. | The T7 comment now says retryLimit 2 with exponential backoff capped by retryDelayMax, points at `src/lib/worker/index.ts`, and says the 60 s poll timeout must cover the backoff total. |

### Notes

- c-WR-01 and c-IN-02 share a commit for the attachments file, and c-WR-02 and c-IN-02 share one for the content-isolation file. c-IN-01 and c-IN-03 share one commit in `project-file-cleanup.test.ts`. Hunk-level staging is not available here.
- Lint caught that commit 7b5db90 did not sort a fixture import. 17474c3 fixes the order only.
- c-IN-01: only the comment was added. The optional org-filtered sweep for tests was not built, because the disposition names the comment.
- c-WR-03: the resolver is still lexical (one line at a time). A template literal that spans lines is not stripped across lines. No current test relies on one.

### Gates (one process at a time, main checkout)

- `pnpm test`: exit 0. 50 files, 838 tests passed.
- `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts` (Testcontainers, Colima socket env): exit 0. 90 files, 1216 tests passed.
- `pnpm exec next typegen`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (548 files, no fixes).
- Affected files run green before each commit: `validate-upload.test.ts` (42), `project-comments-attachments.test.ts` (13), `project-content-isolation.test.ts` (20), `project-operation-inventory.test.ts` (29), the six isolation files together (76) and `project-file-cleanup.test.ts` (11).
- `git grep -i -n gr8r -- src docs website README.md public prisma tests`: empty.

## F3 (Codex diff round 1)

Fixer: Claude (gsd-code-fixer), 2026-11-09. Branch `v2/run-loop`, main checkout (`workflow.use_worktrees` is false), so every test ran in the main checkout. Fix scope: the "Codex diff critique / Round 1" rows of `14-REVIEW.md`. D1, D2 and D3 (run decision K72) are fixed. D4 is rejected by the disposition and was not touched. Each fix has a test that was run red before the fix and green after it. No assertion was weakened, no existing expectation changed, and no fixed sleep was added.

### Rows

| Row | Commit | Failing-first evidence (red run, cause) | Fix |
|---|---|---|---|
| D3 (K72) | e83453b | `project-review-fixes.test.ts`, describe "Codex diff D3, K72", 2 of 2 failed: `resolveTaskKey(reader, "HP-1")` for a task moved out of a private project the reader cannot read returned `{ ok: true, ... isAlias: true }` instead of the missing-key NOT_FOUND of the world where HP never existed. After the origin project was archived and deleted, the old key still resolved (`{ ok: true, ... }`). | `resolveTaskKey` reads the TaskKey row's `projectId` and, for an ALIAS, requires the origin project through `readableProjectWhere` with the organization term. Unreadable or deleted origin: NOT_FOUND, identical to a missing key. A reader of the origin still resolves the alias (positive case). The prefix probe stays owner item 14-o3. Contract section 6 and a `contract.ts` comment on `resolveTaskKey`. |
| D2 | 4e3d8ff | New case in the K71 describe of `project-review-fixes.test.ts`: per move, which other projects changed `updatedAt`, compared between the two worlds. Red: `expected [ Array(16) ] to deeply equal [ Array(16) ]`, the hidden world listed `HIDDEN` projects (and visible ones at other steps) whose `updatedAt` the rebalance had changed. The case also asserts that both worlds rebalanced (another project's stored position changed at least once), so it exercises the renumbering. | The rebalance `UPDATE` sets `"updatedAt" = CASE WHEN id = moved THEN now() ELSE "updatedAt" END`, so only the moved project's timestamp changes. The case asserts the per-project change lists are equal in both worlds and empty. Contract section 8 and the K71 comment in `contract.ts`. |
| D1 | 49e4eea | New `tests/integration/project-content-read-race.test.ts`, 3 PID-bound races: a holder takes `TaskComment` (or `TaskAttachment`) ACCESS EXCLUSIVE, the read's own PID (`nextStartPid`) is bound to it with `waitForBlockedBy`, then the access change commits (moveTask into a private project; removeProjectMember of the reader) and the holder inserts a private comment or file before it releases. The seam (read transaction) was committed in the same commit but run first without the predicate join: 3 of 3 failed, the results held `bodyMarkdown: "secret"` (both comment races) and `originalFilename: "secret.png"`. | `runProjectReadInTransaction` in `service.ts` (membership first, observer start like every service transaction). listTaskComments, listTaskAttachments, listProjectAttachments and getTaskAttachmentForDownload use it, and their content query carries `task: { organizationId, project: readableProjectWhere(actor) }`, so content is returned only while the task's current project is readable at that query. Contract section 2 and a `contract.ts` comment. |
| D4 | none | Not applicable. | Rejected by the disposition (c-IN-01 already documents the `fileParallelism: false` dependency). |

### Not done, with reason

- D1: only the four reads the finding and disposition name (comments, task and project attachment lists, download metadata) were changed. Other multi-query reads (for example `listProjectTasks`, `listProjectMilestones`, `listLabels`) still check the project and then read by project id in a later statement. They were not audited here because the disposition names comments and attachments only. Recorded for the next review round.
- D1: there is no race test for listProjectAttachments with a privacy change, or for the download path. The predicate join is the same code as the tested listTaskAttachments path, and the existing isolation files run green.
- D3: the alias origin check and the task read are two statements outside a transaction. A move or deletion between them can still give the result of either moment. Neither result leaks a project the reader cannot read at the moment of that statement.

### Gates (one process at a time, main checkout)

- Affected files after each fix: `project-review-fixes.test.ts` (16), `project-task-keys.test.ts` (4), `project-move.test.ts` (13), `project-tasks-isolation.test.ts` (9), `project-delete.test.ts` (20), `project-core.test.ts` (11), `project-content-read-race.test.ts` (3), `project-comments-attachments.test.ts` (13), `project-content-isolation.test.ts` (20): all exit 0.
- `pnpm test`: exit 0. 50 files, 838 tests passed. This includes `project-operation-inventory.test.ts`, which is green.
- `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts` (Testcontainers, Colima socket env): exit 0. 91 files, 1222 tests passed.
- `pnpm exec next typegen`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (549 files, no fixes).
- `git grep -i -n gr8r -- src docs website README.md public prisma tests`: empty.

## F4 (Codex diff round 2)

Fixer: Claude (gsd-code-fixer), 2026-11-09. Branch `v2/run-loop`, main checkout (`workflow.use_worktrees` is false), so every test ran in the main checkout. Fix scope: the "Codex diff critique / Round 2" rows of `14-REVIEW.md` under run decision K73: R2D-1, R2D-2 and R2D-3. All three are fixed. No assertion was weakened, no existing expectation changed, and no fixed sleep was added. The operation inventory stays green.

### Rows

| Row | Commit | Failing-first evidence (red run, cause) | Fix |
|---|---|---|---|
| R2D-1 | bbf3d5c | `project-read-access-race.test.ts`, run against the unfixed code with only the test seam added: every "organization member row is removed" case failed, 23 of them. Each read returned content after the reader's `member` row was deleted while it waited, for example `listTaskComments` and `listTaskAttachments` returned their row (`expected { ok: true, …(3) } to deeply equal { ok: true, comments: [], …(2) }`), and `listProjects`, `listWorkspaceTasks`, `listWorkspaceMilestones` and `listFavorites` returned rows of a public project. One case was not red: `getTaskAttachmentForDownload` already answered MEMBERSHIP_ENDED, because its trailing `requireTask` re-reads the membership. | `readableProjectWhere` includes `actorOrganizationWhere(actor)`, an EXISTS on the actor's `member` row in the organization, so every query that uses the shared predicate carries it. New helpers in `access.ts`: `actorOrganizationWhere` (team rows), `readableProjectExistsWhere` (rows without a project relation: TaskKey, ProjectActivity), `stillReadableWhere` (a page over a readable set read earlier), `refuseUnreadable` (MEMBERSHIP_ENDED when the member row is gone, else NOT_FOUND) and `readableProjectSql` (the SQL form for raw statements). `runProjectRead` is now the same as `runProjectReadInTransaction`: one read transaction, membership first. |
| R2D-2 | bbf3d5c | Same red run: 58 of 70 failed. Apart from the R2D-1 cases, every project-member-removal, privacy and move case of `getTask`, `listProjectTasks`, `getProject`, `listLabels`, `listProjectMilestones`, `listProjectMembers`, `listEligibleAssignees`, `listProjectTeams`, `getProjectProgress`, `getProjectsProgress`, `getTaskProgress`, `listProjectActivity`, `listTaskActivity`, `listTeamActivity` and `getTeam` returned content after the change, for example `expected { ok: true, task: { …(28) } } to deeply equal { ok: false, code: 'NOT_FOUND' }`, `expected { ok: true, labels: [ { …(3) } ] } to deeply equal { ok: true, labels: [] }`, `expected { ok: true, rows: [ { …(14) } ], …(2) } to deeply equal { ok: true, rows: [], …(2) }` (10 activity cases), `getProjectsProgress` returned the project from its stale id list, and the `getTaskProgress` move case returned `{ ok: true, done: 0, total: 0 }`. Not red (correct already, single statement with the predicate): the project-member and privacy cases of `listWorkspaceTasks`, `listFavorites`, `listProjects` and `listWorkspaceMilestones`, and the `getTask` move case (the row read by the old project id finds nothing). | Every query that returns content, rows, counts, cursors or `hasMore` carries the predicate: getTask (row, labels, milestone, subtasks and predecessor through the predicate, then the task is re-read under it last); listProjectTasks (paged statement); listLabels; listProjectMilestones and its task counts; listProjectMembers (one statement, the C14 active-member filter included); listEligibleAssignees (the privacy branch is decided inside each statement, not taken from the check); listProjectTeams; listTeams and its member counts (actor membership); getTeam (members, projects through the predicate, team row last); getProject (anchor re-read after the check); getProjectProgress and getTaskProgress (both counts under the predicate, anchor last); getProjectsProgress (counts under the predicate, projects returned only if still readable at the last statement); listProjectActivity (the feed's project bound inside the paged statement); listTaskActivity (the task's current project bound inside the paged statement, plus a guard that no project of the earlier readable set became unreadable); listTeamActivity (membership and the same guard). Test seam `afterReadCheck` in `service.ts` (observer only); `createServiceRace.holdAt` parks reads at it and resolves with the read's backend PID. Shared harness `tests/support/project-read-race.ts`. |
| R2D-3 | 16dbf26 | `project-key-resolve-race.test.ts`, run against the old resolver with the seam placed after its key-kind read (and with the R2D-1 predicate already in): 2 of 5 failed. The alias race (key read as ACTIVE, then the task moves into a readable project, the key becomes an alias of its origin, and the reader is removed from that origin) returned `{ ok: true, …(4) }` instead of NOT_FOUND. The organization-member case returned NOT_FOUND instead of MEMBERSHIP_ENDED; before the R2D-1 predicate (first red run) it returned `{ ok: true, … }`. | One raw statement joins TaskKey, the task and its current project, and decides the key kind (ACTIVE or ALIAS), the K72 origin access and the current project's access through `readableProjectSql`. No row: `refuseUnreadable`. The prefix probe stays owner item 14-o3. |

Contract: `14-CONTRACT.md` (the list predicate, a new "Every read" paragraph, the download refusal, the resolver) and the `contract.ts` comments on `resolveTaskKey` and the content reads, in commit 16dbf26. No operation or refusal code was renamed.

### Tests

- `tests/integration/project-read-access-race.test.ts`, 65 cases in 6 families: task reads, lists, progress, activity feeds, team reads, and the F3 content reads under organization-member removal. Each case first runs the read without a change and asserts the content is there, then parks the read after its access check, applies the change and asserts the exact result: an empty page for lists, and MEMBERSHIP_ENDED or NOT_FOUND for single-object reads.
- `tests/integration/project-key-resolve-race.test.ts`, 5 cases: the key-resolution family (4 changes) and the alias race.
- The red runs were taken with the seam in the old code, before the fix.

### Not done, with reason

- The single-query proof for `resolveTaskKey` is an interleaving at the only gap that is left (between the membership check and the statement), plus the code. The number of statements is not measured in the test.
- The parks are JS gates bound to the read's own PID (`holdAt`). They are not lock waits through `waitForBlockedBy`: a read takes no lock that a change could block on, and the changes touch the tables the reads use.
- Deletion is not a separate race case. A deleted project or task drops out of every predicate in the same way, and the existing delete tests stay green.
- A response built from several statements is consistent per statement, not as one snapshot. Every statement carries the predicate, and single-object reads re-read their anchor last. Access that is lost and restored between two statements of one read is not detected.
- When a project of the earlier readable set becomes unreadable, the `listTaskActivity` and `listTeamActivity` guards return an empty page for that call, not a recomputed page.
- 14-o3 (prefix oracle) remains an owner item, as the disposition says.

### Gates (one process at a time, main checkout)

- Affected files after each fix: `project-read-access-race.test.ts` (65, on the commit-A state with the old resolver), `project-key-resolve-race.test.ts` + `project-task-keys.test.ts` + `project-review-fixes.test.ts` (25), and all `tests/integration/project*` files together (34 files, 466 tests): all exit 0.
- `pnpm test`: exit 0. 50 files, 838 tests passed, including `project-operation-inventory.test.ts`.
- `pnpm test:integration --exclude tests/integration/egress-isolation.test.ts` (Testcontainers, Colima socket env): exit 0. 93 files, 1292 tests passed.
- `pnpm exec next typegen`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (552 files, no fixes).
- `git grep -i -n gr8r -- src docs website README.md public prisma tests`: empty.
- Testcontainers cleanup (rule H): before the batch, no container had the label `org.testcontainers=true`. After the last run, only the batch's ryuk container remained, and it had exited by itself before the removal step. At the end no container with the label remains. No other container, image or volume was touched. `aida-dev-db` is still running.
