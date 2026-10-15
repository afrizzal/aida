Tested commit: 4d6a498319774712de8870c503cf951831be92cd

# Phase 14 Gate: Projects foundation

Branch `v2/run-loop`. The tested commit is the commit that revised the operation inventory under run decision K70 (`tests/unit/project-operation-inventory.test.ts`, 21 of 21 passed before the gate). Every command below ran once on that commit, one at a time, each into its own log under `${TMPDIR:-/tmp}`, with its exit code read without a pipe. No command was rerun.

## Gate table

| Command | Exit code | Counts | Log summary | Verdict |
|---|---|---|---|---|
| `pnpm lint` | 0 | 544 files checked | "Checked 544 files in 208ms. No fixes applied." (`aida-14-gate-lint.log`) | green |
| `pnpm exec next typegen` then `pnpm typecheck` | 0 and 0 | n/a | "Types generated successfully"; `tsc --noEmit` silent (`aida-14-gate-typegen.log`, `aida-14-gate-typecheck.log`) | green |
| `pnpm test` | 0 | 49 files, 795 passed, 0 failed, 0 skipped | "Tests 795 passed (795)" (`aida-14-gate-unit.log`) | green |
| `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm test:integration --exclude tests/integration/egress-isolation.test.ts --reporter=verbose` | 0 | 88 files, 1198 passed, 0 failed, 0 skipped | "Test Files 88 passed (88)", "Tests 1198 passed (1198)", 87.15 s; the egress file appears only in the command line (`aida-14-gate-integration.log`) | green |
| `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm test:e2e` | 1 | 191 passed, 3 failed, 1 skipped, 15 did not run, 0 flaky | failed: `tests/e2e/phase4-ai.spec.ts:387` "T7 re-run triage: failure shows Triage failed + Re-run; retry succeeds" (the "Re-run AI triage" button not found within 7.5 s, line 427); `tests/e2e/phase4-ai.spec.ts:433` "T8 AI Activity lists triage runs ..." (`triagedTicketId` empty, line 436, state that T7 sets in the same serial file); `tests/e2e/ticket-statuses.spec.ts:313` "a set-default refusal shows the callout and focuses the row's Options button" (the row's Options button not found, line 332); 15 cases after them did not run; 5.6 min (`aida-14-gate-e2e.log`) | red: 3 failures in pre-Phase-14 UI specs (AI triage re-run, ticket statuses); cause not diagnosed and not rerun; Phase 14 changed no file under `src/app` or `src/components` |
| `pnpm build` | 0 | n/a | "Compiled successfully in 4.2s"; one Turbopack warning, "Encountered unexpected file in NFT list" for `next.config.ts` (the same NFT warning the 12.2 gate recorded) (`aida-14-gate-build.log`) | green (one known warning) |
| `pnpm audit --prod` | 1 | 141 vulnerabilities: 13 low, 69 moderate, 52 high, 7 critical | same counts as the 12.2 gate baseline (141: 13 low, 69 moderate, 52 high, 7 critical); the phase adds no package (`git diff --stat PHASE_START..HEAD -- package.json pnpm-lock.yaml` is empty) (`aida-14-gate-audit.log`) | baseline unchanged (not passed) |
| `git grep -i -n gr8r -- src docs website README.md public prisma tests` (clean-room) | 1 | 0 lines | no output (`aida-14-gate-cleanroom.log` empty) | green (no match) |
| `pnpm test:integration` as-is (with `tests/integration/egress-isolation.test.ts`) | not run | n/a | the egress file drives a compose project | blocked (O-1) |
| `pnpm test:egress` | not run | n/a | needs the compose stack | blocked (O-1) |
| `docker compose -p aida up -d --build` (the stack that would show K68, the worker mounting `uploads_data`, at run time) | not run | n/a | the compose change is checked statically only (`tests/unit/compose-uploads.test.ts`, `docker compose config --quiet` in plan 14-05) | blocked (O-1) |

Red: `pnpm test:e2e` (exit 1, three failures named above, cause not diagnosed). `pnpm audit --prod` is exit 1 with the unchanged baseline, not a pass. No flake was observed (the E2E log shows no retry) and no command was rerun. The full integration suite, the egress suite and the compose stack are blocked (O-1).

## Requirements

One row per acceptance clause. Test files are under `tests/integration/` unless the path says `tests/unit/`.

| Clause | Implementing files | Named tests (file: case) |
|---|---|---|
| AIDA-64 projects with name, color, order, overview, members | `src/lib/projects/projects.ts`, `members.ts`, `prisma/schema.prisma`, migration `20261113100000_projects_foundation` | `project-core.test.ts`: "a member creates a private project, reads it back, and one PROJECT_CREATED row exists", "updateProject changes the fields, increments version and writes one PROJECT_UPDATED row with the changed keys"; `project-members-teams.test.ts`: "a manager adds a member to a private project, who can then read it and create a task in it" |
| AIDA-64 accept: scoped through `scopedDb`, unmocked isolation | `src/lib/scoped-db.ts` (18 models in `DOMAIN_MODELS`), `src/lib/projects/service.ts` | `projects-schema.test.ts`: "inserts a project with its counter and one task, readable through scopedDb", "scopedDb of another organization never sees or changes organization A's rows in the 18 models"; `project-core-isolation.test.ts`: "getProject (TARGET)", "createProject (CREATE)" |
| AIDA-65 tasks with status, assignee, due date, priority, labels | `src/lib/projects/tasks.ts`, `labels.ts`, `contract.ts` | `project-tasks.test.ts`: "a member creates OPS-1 and reads it back with the description safely rendered", "an assignee outside the organization, or not a direct member of a private project, is NOT_ELIGIBLE"; `project-labels-milestones.test.ts`: "setTaskLabels writes labelNames, increments the version, and refuses TOO_MANY, a foreign label and a stale version" |
| AIDA-65 accept: create, update, reorder, status change; unmocked isolation | `tasks.ts`, `ordering.ts` | `project-tasks.test.ts`: "changes the content fields once, records only the changed keys and treats a repeat as a no-op"; `project-ordering-bulk.test.ts`: "drags a TODO task between two IN_PROGRESS tasks: lands there, one TASK_STATUS_CHANGED row", "moves a task first in its column: one TASK_REORDERED row, no version change"; `project-tasks-isolation.test.ts` and `project-ops-isolation.test.ts` (one block per operation) |
| AIDA-66 subtasks; parent progress derived | `tasks.ts` (`setTaskParent`), `progress.ts` | `project-progress.test.ts`: "is 0 without subtasks and counts non-archived subtasks only", "a DONE parent with one open of two subtasks shows 50 percent as it is" |
| AIDA-66 accept: a subtask cannot cross project or organization | migration (composite FK `Task_organizationId_projectId_parentId_fkey`, depth trigger), `tasks.ts` | `projects-schema.test.ts`: "refuses a subtask whose parent is in another project (Task_organizationId_projectId_parentId_fkey)"; `project-tasks-race.test.ts`: "setTaskParent held after its locks: createTask under A waits and gets SUBTASK_DEPTH"; `project-move.test.ts`: "refuses SUBTASK_MOVE, INVALID_INPUT, ARCHIVED, NOT_FOUND and CONFLICT and changes nothing" |
| AIDA-67 accept: comments use the sanitized markdown path; content untrusted | `comments.ts`, `src/lib/markdown/render.ts` (`renderTaskMarkdown`, K65) | `project-comments-attachments.test.ts`: "a member comments and reads it back safely rendered, with one COMMENT_ADDED row and no body"; `tests/unit/markdown-render.test.ts`: "drops raw HTML: no img, no script, no onerror", "removes the same-origin relative image the preview keeps" |
| AIDA-67 accept: attachments use the existing pipeline | `attachments.ts`, `src/lib/uploads/validate-upload.ts`, `file-cleanup.ts` | `project-comments-attachments.test.ts`: "a member attaches a PNG: cleaned name, file under the organization directory, one ATTACHMENT_ADDED", "refuses TOO_MANY, UNSUPPORTED_FILE_TYPE and FILE_TOO_LARGE with no file and no row"; `tests/unit/validate-upload.test.ts` |
| AIDA-68 accept: each mutation records actor, verb, old and new values | `activity.ts`, every write module | `project-activity.test.ts`: "refuses 17 keys, description and body keys, a non-camelCase key and a value over 4096 bytes, and cuts long strings"; `project-core.test.ts`: "updateProject changes the fields, increments version and writes one PROJECT_UPDATED row with the changed keys"; `project-members-teams.test.ts`: "promotes and demotes with MEMBER_ROLE_CHANGED, refuses the last manager and treats the same role as a no-op"; one case per (operation, verb) pair, listed by the completeness check |
| AIDA-68 single source for feed and task history | `activity.ts` (`listProjectActivity`, `listTaskActivity`, `listTeamActivity`) | `project-activity.test.ts`: "returns rows newest first with id as tie-breaker, filters by verbs and actor, and includes related rows" |
| AIDA-69 teams, members, project assignment | `teams.ts`, `members.ts` (K69) | `project-members-teams.test.ts`: "createTeam, NAME_TAKEN, renameTeam, addTeamMember, NOT_ELIGIBLE and removeTeamMember with their activity rows", "assignTeamToProject on a private project copies the active members without a direct row (TEAM_ASSIGNED and MEMBER_ADDED, one batch)", "later team changes change no access: ..." |
| AIDA-69 accept: org-scoped `Team` with unmocked isolation | migration (`TeamMember_organizationId_teamId_fkey`, `ProjectTeam_*_fkey`) | `projects-schema.test.ts`: "refuses a TeamMember of the other organization's team (TeamMember_organizationId_teamId_fkey)"; `project-members-isolation.test.ts`: "getTeam: hidden private link gives identical results", "addTeamMember: hidden private link gives identical results and grants nothing" |
| AIDA-70 accept: archived projects leave default lists and can be restored | `archive.ts`, `projects.ts` | `project-archive-favorites.test.ts`: "archiveProject by the manager writes PROJECT_ARCHIVED and leaves the default list", "restoreProject writes PROJECT_RESTORED and the project is back in the default list" |
| AIDA-70 accept: favorites are per user | `favorites.ts` | `project-archive-favorites.test.ts`: "favorites are per user: the manager's list does not show the member's favorite", "favoriteProject and unfavoriteProject by a member toggle the favorite and write no activity" |
| AIDA-71 accept: member, non-member of the same organization, other organization, every read and write path | `access.ts` (one policy, K62, K69) | `project-access.test.ts`: "private project: manager and member by role, teamMember, nonMember, orgAdmin and outsider NOT_FOUND"; the eight isolation files (`project-core-isolation.test.ts`, `project-tasks-isolation.test.ts`, `project-content-isolation.test.ts`, `project-members-isolation.test.ts`, `project-recurrence-isolation.test.ts`, `project-archive-delete-isolation.test.ts`, `project-move-duplicate-isolation.test.ts`, `project-ops-isolation.test.ts`), one block per operation for all 76 |
| AIDA-71 accept: no relation points to a task in another project or organization | migration (16 composite FKs RESTRICT) | `projects-schema.test.ts`: "refuses a TaskComment on the other organization's task (TaskComment_organizationId_taskId_fkey)", "refuses a TaskAttachment on the other organization's task (TaskAttachment_organizationId_taskId_fkey)", "refuses a TaskFavorite on the other organization's task (TaskFavorite_organizationId_taskId_fkey)" |
| AIDA-71 search, notifications (Phase 16), ticket links, AI suggestions (Phase 17) | not in this phase | belongs to Phases 16 and 17 |
| AIDA-100 icon, description, status set, due date | `projects.ts`, `contract.ts` (icon allowlist, status set) | `project-core.test.ts`: "getProject renders the description with renderTaskMarkdown", "setProjectStatus writes PROJECT_STATUS_CHANGED" |
| AIDA-100 accept: progress computed, never typed, empty project tested | `progress.ts` | `project-progress.test.ts`: "an empty project is 0 percent of 0", "counts top-level non-archived tasks only and follows a status change without a stored value", "rounds the percent down" |
| AIDA-100 accept: status changes write activity | `projects.ts` | `project-core.test.ts`: "setProjectStatus writes PROJECT_STATUS_CHANGED" |
| AIDA-101 accept: keys unique under concurrent creation | `keys.ts`, `tasks.ts` | `project-task-keys.test.ts`: "20 parallel creates in one project get the numbers 1 to 20 and 20 distinct keys", "createTask in a project whose counter is at 999999999 is KEY_SPACE_EXHAUSTED and writes nothing" |
| AIDA-101 accept: description through the sanitized path | `tasks.ts`, `render.ts` | `project-tasks.test.ts`: "a member creates OPS-1 and reads it back with the description safely rendered"; `tests/unit/markdown-render.test.ts`: "strips a remote image source, so the browser fetches nothing" |
| AIDA-101 accept: start after due rejected | `tasks.ts`, migration (`Task_dates_check`) | `project-tasks.test.ts`: "refuses a start after the due date, records valid dates and the database fences Task_dates_check"; `projects-schema.test.ts`: "refuses a start date after the due date (Task_dates_check)" |
| AIDA-102 accept: each rule, month ends, time zones | `recurrence.ts`, `recurrence-rules.ts` | `project-recurrence.test.ts`: "WEEKLY follows the anchor weekday even after the due date moved", "MONTHLY anchored on the 31st clamps to the month end and returns to the anchor day", "DAILY keeps the start-to-due gap, and a start-only task gets the next start date only", "a task without dates is dated by its occurrence in the series time zone"; `tests/unit/project-recurrence-rules.test.ts` |
| AIDA-102 accept: next occurrence exactly once, even on retry | `recurrence.ts` (`recurrenceSpawned` under the task lock, unique predecessor index) | `project-recurrence-race.test.ts`: "two completions of one task with the same version: the second waits, gets CONFLICT, one successor", "a direct SQL insert of a second successor fails on Task_recurrence_predecessor_key"; `project-recurrence.test.ts`: "creates exactly one next occurrence with the right dates, key, copies and activity" |
| AIDA-103 duplicate, favorite, archive, restore | `duplicate.ts`, `favorites.ts`, `archive.ts` | `project-duplicate.test.ts`: "copies a task and its non-archived subtasks without comments, attachments or recurrence"; `project-archive-favorites.test.ts`: "archiveTask by a member writes TASK_ARCHIVED and restoreTask writes TASK_RESTORED" |
| AIDA-103 accept: moved task gets a new key, old link resolves | `move.ts`, `keys.ts` | `project-move.test.ts`: "moves a task to another project with a new key; the old key resolves as an alias"; `project-task-keys.test.ts`: "an alias and a new active key both resolve, tombstones and malformed keys are NOT_FOUND" |
| AIDA-103 accept: archive keeps history | `archive.ts` | `project-archive-favorites.test.ts`: "archiving a parent hides and freezes its subtasks without touching their archivedAt; restore brings them back as they were" |
| AIDA-103 accept: delete needs confirmation | `delete.ts` | `project-delete.test.ts`: "needs confirmation, the current version and the creator or a manager; then removes the tree with TASK_DELETED rows" |
| AIDA-103 accept: delete writes an audit event | `delete.ts` (TASK_DELETED in `ProjectActivity`, K63) | recorded in ProjectActivity, owner confirmation pending (14-o2); `project-delete.test.ts`: "after deleteTask the key and its alias are NOT_FOUND, the key rows are TOMBSTONE, earlier activity stays and the sweep removes the files" |
| AIDA-103 accept: private rules hold across a move | `move.ts`, `activity.ts` (redaction) | `project-move.test.ts`: "an old key and the task are NOT_FOUND for a former reader after a move into a private project"; `project-activity.test.ts`: "redaction: source reader", "redaction: target reader" |
| AIDA-104 edit | `projects.ts` | `project-core.test.ts`: "updateProject refuses a stale version, a member, an archived project and invalid input, writing nothing" |
| AIDA-104 accept: both duplicate options | `duplicate.ts` | `project-duplicate.test.ts`: "includeTasks: false copies metadata, labels and milestones with the duplicating user as only member", "includeTasks: true copies every non-archived task and subtask with mapped labels and milestones" |
| AIDA-104 accept: delete needs confirmation, never removes `AuditEvent` rows | `delete.ts` | `project-delete.test.ts`: "needs the exact name and a manager; removes every owned row, keeps the prefix, activity and AuditEvent rows, and its feed is NOT_FOUND" |
| AIDA-104 accept: delete writes an audit event | `delete.ts` (PROJECT_DELETED in `ProjectActivity`) | recorded in ProjectActivity, owner confirmation pending (14-o2); same case as above |
| AIDA-105 accept: milestones org-scoped with unmocked isolation; a task belongs to one | `milestones.ts` | `projects-schema.test.ts`: "refuses a ProjectMilestone of the other organization's project (ProjectMilestone_organizationId_projectId_fkey)"; `project-labels-milestones.test.ts`: "createMilestone, NAME_TAKEN, updateMilestone and deleteMilestone with affectedTaskCount", "listWorkspaceMilestones returns readable, non-archived projects' milestones in range, never a hidden private one"; `project-content-isolation.test.ts` blocks "setTaskMilestone", "createMilestone" |
| AIDA-105 display in Timeline (AIDA-78) and overview (AIDA-107) | reads built here (`listProjectMilestones`, `listWorkspaceMilestones`) | display belongs to Phases 15 and 16 |

## ROADMAP success criteria

| Criterion | Evidence | Implementing files | Result |
|---|---|---|---|
| SC1 | `tests/integration/projects-schema.test.ts`: "scopedDb of another organization never sees or changes organization A's rows in the 18 models", the 16 "refuses a ... of the other organization's ..." cases; `tests/unit/project-schema-parity.test.ts` | `src/lib/scoped-db.ts`, migration `20261113100000_projects_foundation` | green on the tested commit (integration and unit rows) |
| SC2 | `tests/integration/project-activity.test.ts`: "returns rows newest first with id as tie-breaker, filters by verbs and actor, and includes related rows"; `tests/integration/project-core.test.ts`: "updateProject changes the fields, increments version and writes one PROJECT_UPDATED row with the changed keys"; `tests/integration/project-tasks.test.ts`: "changes the content fields once, records only the changed keys and treats a repeat as a no-op"; every isolation block compares `projectTableSnapshot()` and the ProjectActivity count for refused writes | `src/lib/projects/activity.ts` | green |
| SC3 | `tests/integration/project-access.test.ts`: "private project: manager and member by role, teamMember, nonMember, orgAdmin and outsider NOT_FOUND"; `tests/integration/project-core-isolation.test.ts`, `tests/integration/project-content-isolation.test.ts`, `tests/integration/project-tasks-isolation.test.ts` (refused actors deep-equal `missingId()`, outsider in A MEMBERSHIP_ENDED); `tests/integration/project-activity.test.ts`: "redaction: source reader" | `src/lib/projects/access.ts` | green |
| SC4 | moveTask: `tests/integration/project-move.test.ts` "two opposite moves (A to B and B to A) serialize on the project rows with no 40P01" and `tests/integration/project-move-duplicate-isolation.test.ts` block "moveTask"; reorderTask: `tests/integration/project-ops-race.test.ts` "the second reorder waits on the project and both placements apply in order" and `tests/integration/project-ops-isolation.test.ts` block "reorderTask"; bulkUpdateTasks: `tests/integration/project-ops-race.test.ts` "bulk DONE holds while setTaskStatus DONE waits; exactly one successor" and block "bulkUpdateTasks"; setTaskDates: `tests/integration/project-tasks.test.ts` "refuses a start after the due date, records valid dates and the database fences Task_dates_check" and `tests/integration/project-tasks-isolation.test.ts` block "setTaskDates" | `move.ts`, `ordering.ts`, `bulk.ts`, `tasks.ts` | green |
| SC5 | `tests/integration/project-archive-favorites.test.ts`: "archiveProject by the manager writes PROJECT_ARCHIVED and leaves the default list", "favorites are per user: the manager's list does not show the member's favorite" | `archive.ts`, `favorites.ts` | green |
| SC6 | `git grep -i -n gr8r -- src docs website README.md public prisma tests` on the tested commit: no output, exit 1 (no match) | whole tree | green (no match) |
| SC7 | `tests/integration/project-task-keys.test.ts`: "20 parallel creates in one project get the numbers 1 to 20 and 20 distinct keys"; `tests/integration/project-recurrence-race.test.ts`: "two completions of one task with the same version: the second waits, gets CONFLICT, one successor"; `tests/integration/project-progress.test.ts`: "an empty project is 0 percent of 0" | `keys.ts`, `recurrence.ts`, `progress.ts` | green |

The operation inventory (tests/unit/project-operation-inventory.test.ts) is a completeness check only; the proof of isolation and activity is the behaviour tests named in each row, which assert per actor the result, snapshot equality and verb values.

## Decisions, run decisions, findings and review items

| Item | Plan | Evidence |
|---|---|---|
| D-01 org-scoped models, composite FKs | 14-02 | `projects-schema.test.ts` (16 FK refusals, scopedDb case) |
| D-02 model set | 14-02 | `projects-schema.test.ts`: "inserts a project with its counter and one task, readable through scopedDb"; `tests/unit/project-schema-parity.test.ts` |
| D-03 one-level subtasks in the database | 14-02, 14-06 | `projects-schema.test.ts`: "refuses a subtask whose parent is in another project ..."; `project-tasks-race.test.ts` SUBTASK_DEPTH cases |
| D-04 private access, K62 and K69 | 14-04, 14-08 | `project-access.test.ts`; `project-members-teams.test.ts`: "later team changes change no access: ..." |
| D-05 append-only activity | 14-02, 14-04 | `project-activity.test.ts`; append-only trigger in the migration (`projects-schema.test.ts`) |
| D-06 delete record in ProjectActivity | 14-10 | `project-delete.test.ts` (14-o2 open) |
| D-07 hard delete, tombstones, cleanup (K64, K66) | 14-05, 14-10 | `project-delete.test.ts`; `project-file-cleanup.test.ts` |
| D-08 task keys | 14-06, 14-11 | `project-task-keys.test.ts`; `project-move.test.ts` |
| D-09 recurrence | 14-03, 14-09 | `project-recurrence.test.ts`; `project-recurrence-race.test.ts`; `tests/unit/project-recurrence-rules.test.ts` |
| D-10 ordering and Phase 15 operations | 14-03, 14-12 | `project-ordering-bulk.test.ts`; `project-ops-race.test.ts`; `tests/unit/project-rank.test.ts` |
| D-11 progress and status | 14-12, 14-04 | `project-progress.test.ts`; `project-core.test.ts` |
| D-12 archive and favorites | 14-10 | `project-archive-favorites.test.ts` |
| D-13 duplicate and move | 14-11 | `project-duplicate.test.ts`; `project-move.test.ts` |
| D-14 comments and attachments | 14-03, 14-07 | `project-comments-attachments.test.ts`; `tests/unit/markdown-render.test.ts` |
| D-15 teams (amended by K69) | 14-08 | `project-members-teams.test.ts` |
| D-16 no AI, no egress | all | phase-diff greps below (no fetch, http, https or `src/lib/llm` import in `src/lib/projects`) |
| D-17 contract frozen first | 14-01 | `tests/unit/project-contract.test.ts`; `14-CONTRACT.md`; the completeness check |
| K59 membership read through one module, no single-row read | 14-04 | grep below (no `findActiveMembership` in `src/lib/projects`); `project-members-teams.test.ts`: "a user removed from the organization whose TeamMember and ProjectMember rows remain gets MEMBERSHIP_ENDED" |
| K61 subtasks one level, enforced in the database | 14-02 | `project-tasks-race.test.ts`: "order 1: an insert under A holds A FOR SHARE, so making A a subtask waits and then fails" |
| K62 owner and admin do not see private projects | 14-04 | `project-access.test.ts`: "private project: ... orgAdmin and outsider NOT_FOUND" (14-o1 open) |
| K63 delete record in ProjectActivity, not AuditEvent | 14-10 | `project-delete.test.ts`: "needs the exact name and a manager; ... keeps the prefix, activity and AuditEvent rows ..." |
| K64 hard delete with key tombstones | 14-10 | `project-delete.test.ts`: "after deleteTask the key and its alias are NOT_FOUND, the key rows are TOMBSTONE, ..." |
| K65 task markdown without any image, links live | 14-03 | `tests/unit/markdown-render.test.ts`: "removes the same-origin relative image the preview keeps", "keeps a linked image's link live, with the alt text as its text" |
| K66 cleanup outbox swept by a scheduled job | 14-05 | `project-file-cleanup.test.ts`: "two overlapping sweeps never handle the same row (FOR UPDATE SKIP LOCKED): ..." |
| K67 task-owned rows reference `(organizationId, taskId)` only | 14-02, 14-11 | `project-move.test.ts`: "maps labels and milestone by name, keeps comments, attachments and favorites, aliases every key" |
| K68 worker mounts `uploads_data` | 14-05 | `tests/unit/compose-uploads.test.ts`: "the worker service sets UPLOADS_DIR and mounts uploads_data at /data/uploads" (static only; the stack is blocked (O-1)) |
| K69 team membership never grants private access; copy at assignment | 14-08 | `project-members-teams.test.ts`: "assignTeamToProject on a private project copies ...", "later team changes change no access: ..." |
| C1 scopedDb registration | 14-02 | `projects-schema.test.ts` scopedDb case |
| C2 composite FK shape | 14-02 | `projects-schema.test.ts` 16 FK refusals |
| C3 RESTRICT and move | 14-11 | `project-move.test.ts` |
| C4 no SetNull on composite relations | 14-02 | migration; `projects-schema.test.ts` |
| C5 rows outliving delete carry no FK | 14-02, 14-10 | `project-delete.test.ts` (prefix, activity kept) |
| C6 counter location, content never updates the project row | 14-06 | `project-task-keys.test.ts`; `project-tasks-race.test.ts` prefix cases |
| C7 FK check does not block non-key updates (lock protocol) | 14-04, 14-06 | `project-access.test.ts`: "parent archive first: the subtask write waits and then refuses with ARCHIVED" |
| C8 activity writer differences | 14-04 | `project-activity.test.ts` limits case |
| C9 renderer without images | 14-03 | `tests/unit/markdown-render.test.ts` |
| C10 shared upload validator, download checks project access | 14-03, 14-07 | `tests/unit/validate-upload.test.ts`; `project-content-isolation.test.ts` block "getTaskAttachmentForDownload" |
| C11 worker cannot see uploads | 14-05 | `tests/unit/compose-uploads.test.ts` (static only) |
| C12 cleanup atomic with the delete | 14-05 | `project-file-cleanup.test.ts`: "a cleanup row written in a committed transaction is swept by the worker handler, ..." |
| C13 refusal and unique-violation precedent | 14-04 | `project-labels-milestones.test.ts` NAME_TAKEN cases |
| C14 membership read | 14-04 | as K59 |
| C15 dates and time zones | 14-01, 14-09 | `tests/unit/project-contract.test.ts`: "validates IANA time zones and computes today in a zone"; `project-recurrence.test.ts` time-zone case |
| C16 shared integration database | all | fresh organizations per case (`seedPrivacyWorld`); integration row green |
| C17 race seams, one wait protocol | 14-04 onward | `project-access-race.test.ts`, `project-tasks-race.test.ts`, `project-ops-race.test.ts` |
| C18 migration generation edits | 14-02 | migration; `tests/unit/project-schema-parity.test.ts` |
| review P1 section 17 test shape for 14-04 | 14-04 | `project-core-isolation.test.ts` (inventory lists it complete) |
| review P2 same for 14-10 | 14-10 | `project-archive-delete-isolation.test.ts` |
| review P3 same for 14-12, reorder write check | 14-12 | `project-ops-isolation.test.ts` blocks "reorderTask", "bulkUpdateTasks" |
| review C1 TASK_MOVED redaction per side | 14-04, 14-11 | `project-activity.test.ts`: "redaction: source reader", "redaction: target reader", "redaction: reader of both" |
| review C2 no private-link leak from addTeamMember | 14-08 | `project-members-teams.test.ts`: "no private-link refusal (review C2): ..."; `project-members-isolation.test.ts` "hidden private link" cases |
| review C3 parent lock for subtask writes | 14-04, 14-10 | `project-access.test.ts`: "subtask write first: the parent archive waits for it and then completes" |
| review C4 snapshot ordered by primary key | 14-02 | `tests/support/project-fixtures.ts` `SNAPSHOT_ORDER`; every isolation file |
| review C5 isolation expectation per operation | 14-01, 14-13 | `tests/unit/project-contract.test.ts`; the eight isolation files |
| review C6 duplicateTask under PROJECT_UPDATE | 14-11 | `project-ops-race.test.ts`; `project-duplicate.test.ts` |
| review C7 inventory is a completeness check only | 14-13 | `tests/unit/project-operation-inventory.test.ts` (negative and positive cases); the sentence under the criteria table |
| review C8 Better Auth member delete not serialized | none (stated limitation) | open items below |
| review R2-1 redacted projection, top-level ids null | 14-04, 14-11 | `project-activity.test.ts` "redaction: ..." cases; `project-move.test.ts`; `project-duplicate.test.ts`: "duplicate redaction: copy reader", "duplicate redaction: source reader" |
| review R2-2 favorite archive exception, favorite against delete | 14-10 | `project-archive-favorites.test.ts`; `project-delete.test.ts`: "favoriteTask: favorite first on a subtask, then deleteTask of the parent removes it with the favorite" |
| review R2-3 delete order; deleteTask against createTask | 14-10 | `project-delete.test.ts`: "deleteTask: createTask, delete first, the subtask create is NOT_FOUND while a top-level create commits", "deleteTask: createTask, create first, then the delete removes P, its two subtasks and the new one" |
| review P4 project favorite toggles under PROJECT_SHARE | 14-01, 14-10 | `project-delete.test.ts`: "favoriteProject: delete first, ...", "favoriteProject: favorite first, ...", "unfavoriteProject: delete first, ...", "unfavoriteProject: unfavorite first, ..."; archive-exception case of `project-archive-favorites.test.ts`; lock assertions of `tests/unit/project-contract.test.ts` |
| review R3-1 redaction scope | 14-11 | `project-move.test.ts`: "move redaction: source history kept" |
| review R3-2 duplicateProject under PROJECT_UPDATE | 14-11 | `project-duplicate.test.ts`: "duplicateProject: setTaskLabels, duplicate first", "duplicateProject: setTaskLabels, edit first", "duplicateProject: deleteTask, duplicate first", "duplicateProject: deleteTask, delete first" |
| review R3-3 feed page rule | 14-04 | `project-activity.test.ts`: "team feed pages: hidden private rows", "task history pages: hidden rows" |
| review R3-4 redaction after a real deleteProject | 14-10 | `project-delete.test.ts`: "redaction: after deleteProject the remaining project's feed shows the redacted projection and the deleted feed is NOT_FOUND" |

## Greps over the phase diff

PHASE_START = `d88de64feae2004012ceeb8b507d654774bc52b6` (parent of `842120a`, the first commit that added `src/lib/projects/contract.ts`).

| Command | Output | Expected |
|---|---|---|
| `git diff --stat PHASE_START..HEAD -- package.json pnpm-lock.yaml` | empty | empty: no new package |
| Untracked-secret check: the secret-file guard refuses any command that names the environment file, so the equivalent `git diff --name-only PHASE_START..HEAD -- . ':!src' ':!tests' ':!.planning' ':!prisma'` was run instead | `README.md`, `docker-compose.egress-test.yml`, `docker-compose.yml`, `docs/OPERATIONS.md` (no environment file) | no environment file changed |
| `git grep -nE "from ['\"](node:)?(https?\|undici\|axios\|node-fetch)['\"]\|\bfetch\(\|lib/llm" -- src/lib/projects` | empty, exit 1 | none (D-16) |
| `git grep -n findActiveMembership -- src/lib/projects` | empty, exit 1 | none (K59) |
| `git grep -nE "from ['\"]@/" -- src/lib/projects` | empty, exit 1 | none |
| `git diff PHASE_START..HEAD --name-only -- prisma/migrations` | `prisma/migrations/20261113100000_projects_foundation/migration.sql` | only the Phase 14 migration |

## Design checklist

Phase 14 has no UI, so the DESIGN-SYSTEM section 9 checklist does not apply, and no visual, dark-mode or screen-reader item exists.

## Open items

- **14-o1** (owner): default K62, owner and admin do not see private projects; the orphan risk T-14-42 (a private project whose managers all leave) stays; and, since K69, whether live team-based access to private projects is wanted. Open.
- **14-o2** (owner): default K63, the delete record is a `ProjectActivity` row (TASK_DELETED, PROJECT_DELETED), not an `AuditEvent`; retention and who reads a deleted project's activity are undecided. The audit clauses of AIDA-103 and AIDA-104 read "recorded in ProjectActivity, owner confirmation pending". Open.
- Stated limitation (review C8, tied to 12.2-o4): a Better Auth member delete is not serialized against project writes.
- **O-1**: the integration suite with the egress file, `pnpm test:egress` and the compose stack are blocked; the K68 compose change and the inbound-email attachment fix are proven statically only.
- **O-3** (AIDA-43) stays open.
- **12-o1** and **12.2-o4** stay open.
- Manual item of plan 14-05: once O-1 allows, run the stack and check attachment cleanup and inbound email attachments.

Nothing in this phase is claimed for an owner item, and no human, visual or UAT result is recorded.

---

## E2E red diagnosed and fixed (run-loop orchestrator)

The red E2E step above (3 failed, 15 not run on `4d6a498`) was diagnosed by a debugger (session file `.planning/debug/e2e-14-gate-t7-statuses.md`): two timing races in specs older than Phase 14, not a product regression and not caused by Phase 14 code, tests or data (the E2E database is a fresh container per run).

1. `tests/e2e/phase4-ai.spec.ts` T7 (and T8 through it): the `ai-triage` queue has `retryBackoff` without `retryDelay`, so pg-boss 12.23 retries a failed job at once; that retry completed after the stub switched to "ok" and before the Re-run click wrote PENDING. Fix `1092d7a`: T7 waits until no `ai-triage` job for the ticket is waiting, retrying or running before switching the stub. Failing-first probe: one unfinished job right after FAILED.
2. `tests/e2e/ticket-statuses.spec.ts` set-default refusal: the 5-minute session cookie cache expired mid-suite, and the renewed cookie made Next.js re-render the page inside the refused action's response. Fix `059b3e9`: renew the session cookie cache before each test in that spec. Failing-first: deleting the session-data cookie reproduced the gate failure.

Full `pnpm test:e2e` after both fixes: exit 0, 209 passed, 1 skipped, 0 failed. Open notes (not fixed here): other specs could hit the same cookie expiry (a shared fixture would cover them); while pg-boss still retries, the UI offers Re-run (pre-existing, may cause a second LLM call); the other queues' zero retry delay is the item deferred in Phase 12.2 (a2-WR-03, K55). This gate result is superseded by the final gate after code review.
