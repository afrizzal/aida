---
phase: 14-projects-foundation
plan: 13
subsystem: projects
tags: [inventory, completeness-check, gate, review-C5, review-C7]
status: blocked
stopped_at: "Task 1: the inventory fails with 59 gaps; Tasks 2 and 3 (gate, 14-GATE.md) not run, per the plan's stop-and-report rule"
requires: ["14-08", "14-09", "14-10", "14-11", "14-12"]
provides:
  - tests/unit/project-operation-inventory.test.ts (completeness check only, red on the repository)
affects: [14-02, 14-04, 14-06, 14-07, 14-08, 14-09, 14-10, 14-11, 14-12]
tech-stack:
  added: []
  patterns: ["pure block parser and rules over a path-to-text map, shared by the repository run and fixed-string negative cases"]
key-files:
  created: [tests/unit/project-operation-inventory.test.ts]
  modified: []
decisions:
  - "The inventory is committed red as written; no earlier plan's file was edited and no rule was loosened"
  - "Export rule matches the plan's literal `export async function <name>(actor` (no generic parameter), so the generic helpers runProjectTransaction and runProjectRead of service.ts are not operations"
metrics:
  duration: "about 25 minutes"
  completed: 2026-11-09
  tasks_completed: "1 of 3 (Task 1 committed red; Tasks 2 and 3 not run)"
plan_head_before: 0b51266902038c694ea4561bb67a584bb371f516
actuals:
  tokens: 6500
  tasks: 1
  commits: 1
---

# Phase 14 Plan 13: Operation inventory and gate Summary

**Outcome: stopped at Task 1.** The operation inventory (a completeness check only, review C7) runs red on the repository with 59 gaps. Following the plan, the inventory test was committed as written (`d5ceb9c`), no file of an earlier plan was touched, and Tasks 2 and 3 did not run: there is no tested commit, no gate run and no `14-GATE.md`. The orchestrator plans the gap closure.

## What the inventory checks and what passed

`tests/unit/project-operation-inventory.test.ts` reads `src/lib/projects`, `tests/integration/project-*.test.ts`, `tests/unit/project*-*.test.ts` (itself excluded, its fixtures are strings) and `tests/support/project-fixtures.ts` with `node:fs`, and checks them against `PROJECT_OPERATIONS` through pure functions. Run: `pnpm exec vitest run tests/unit/project-operation-inventory.test.ts`, exit 1, 18 tests: 16 passed, 2 failed (log `${TMPDIR}/aida-14-13-inventory.log`).

| Rule | Result |
|---|---|
| 76 operations; NO_TARGET_ID_OPERATIONS equals the CREATE, LIST and KEY operations plus listTeams and createTeam (review C5) | pass |
| Exported `export async function <name>(actor` of src/lib/projects equal the 76 operations, each in its module file | pass |
| Isolation block per operation (call, MEMBERSHIP_ENDED, missingId() by class, "hidden private link" for TEAM except createTeam, projectTableSnapshot( and ProjectActivity for writes), all in one block's own non-comment text | **fail: 58 gaps** |
| projectTableSnapshot function block of the fixtures names ProjectActivity | **fail: 1 gap** |
| Every (operation, verb) pair: one it or test block calls the operation and names the verb | pass (every pair found) |
| No skipped, focused or todo case in a project test file | pass |
| No path-alias import, Next.js import or `findActiveMembership` in src/lib/projects | pass |
| 10 cases "negative: ..." (near-miss title getTaskProgress for getTask, title without call, MEMBERSHIP_ENDED only in a sibling, call only in a comment, write block without projectTableSnapshot(, TARGET block without missingId(, TEAM block without hidden private link, verb in another it block, it.skip(, describe.only() and "positive control" (including CREATE, LIST and KEY blocks without missingId()) | pass |

`pnpm exec biome check` on the file: exit 0.

Nature of the 58 isolation gaps: the titled blocks exist and call their operation, but the markers sit outside the block's own text, in file-level helpers (`expectTargetRead`, `expectTargetWrite`, `refusedWrite`, `expectRefusedWrites`, `activityCount`) or constants (`ENDED`). Under the plan's rule ("that block's own text contains ..."; the negative case "MEMBERSHIP_ENDED present only in a sibling block") these count as missing. This is a gap between the test shape contract section 17 prescribes and the shape the isolation files use; the inventory does not claim that the behaviour itself is untested.

## Gaps, with the plan that owns the file concerned

Each line: operation (Isolation class), the closest titled block (file:line) and the markers it lacks in its own text.

### 14-02 (fixtures, `tests/support/project-fixtures.ts`)

- `projectTableSnapshot` (line 383): its function block names no `projectActivity` or `ProjectActivity`; it reads the 18 tables through `SNAPSHOT_ORDER` (whose `ProjectActivity` key is at line 371, outside the function block).

### 14-04 (`tests/integration/project-core-isolation.test.ts`; modules projects and activity)

- createProject (CREATE), :89: projectTableSnapshot(
- getProject (TARGET), :120: MEMBERSHIP_ENDED, missingId(
- updateProject (TARGET), :145: MEMBERSHIP_ENDED, missingId(, projectTableSnapshot(, ProjectActivity
- setProjectStatus (TARGET), :152: MEMBERSHIP_ENDED, missingId(, projectTableSnapshot(, ProjectActivity
- setProjectPrivacy (TARGET), :159: MEMBERSHIP_ENDED, missingId(, projectTableSnapshot(, ProjectActivity
- changeProjectKeyPrefix (TARGET), :166: MEMBERSHIP_ENDED, missingId(, projectTableSnapshot(, ProjectActivity
- moveProjectPosition (TARGET), :173: MEMBERSHIP_ENDED, missingId(, projectTableSnapshot(, ProjectActivity
- listProjectActivity (TARGET), :187: MEMBERSHIP_ENDED, missingId(
- listTaskActivity (TARGET), :195: MEMBERSHIP_ENDED, missingId(

### 14-06 (`tests/integration/project-tasks-isolation.test.ts`; modules keys and tasks)

- createTask (TARGET), :43: MEMBERSHIP_ENDED, ProjectActivity
- getTask (TARGET), :62: MEMBERSHIP_ENDED
- listWorkspaceTasks (LIST), :95: MEMBERSHIP_ENDED
- listProjectTasks (TARGET), :79: MEMBERSHIP_ENDED
- updateTask (TARGET), :115: MEMBERSHIP_ENDED, ProjectActivity
- setTaskDates (TARGET), :141: MEMBERSHIP_ENDED, ProjectActivity
- setTaskParent (TARGET), :189: MEMBERSHIP_ENDED, ProjectActivity
- resolveTaskKey (KEY), :215: MEMBERSHIP_ENDED

### 14-07 (`tests/integration/project-content-isolation.test.ts`; comments, attachments, labels, milestones)

Each lacks ProjectActivity only: addTaskComment :96, editTaskComment :117, deleteTaskComment :143, uploadTaskAttachments :219, deleteTaskAttachment :240, createLabel :279, updateLabel :303, deleteLabel :326, setTaskLabels :345, createMilestone :382, updateMilestone :405, deleteMilestone :431, setTaskMilestone :452 (all TARGET).

### 14-08 (`tests/integration/project-members-isolation.test.ts`; members and teams)

- addProjectMember (TARGET), :184: MEMBERSHIP_ENDED, projectTableSnapshot(, ProjectActivity
- removeProjectMember (TARGET), :192: MEMBERSHIP_ENDED, projectTableSnapshot(, ProjectActivity
- setProjectMemberRole (TARGET), :207: MEMBERSHIP_ENDED, projectTableSnapshot(, ProjectActivity
- assignTeamToProject (TARGET), :221: MEMBERSHIP_ENDED, projectTableSnapshot(, ProjectActivity
- unassignTeamFromProject (TARGET), :230: MEMBERSHIP_ENDED, projectTableSnapshot(, ProjectActivity
- createTeam (TEAM), :291: projectTableSnapshot(, ProjectActivity
- renameTeam (TEAM), :315: projectTableSnapshot(, ProjectActivity
- deleteTeam (TEAM), :333: projectTableSnapshot(
- addTeamMember (TEAM), :356: projectTableSnapshot(, ProjectActivity
- removeTeamMember (TEAM), :382: projectTableSnapshot(, ProjectActivity

### 14-09 (`tests/integration/project-recurrence-isolation.test.ts`)

- setTaskRecurrence (TARGET), :61: MEMBERSHIP_ENDED
- clearTaskRecurrence (TARGET), :95: MEMBERSHIP_ENDED
- setTaskStatus (TARGET, module tasks of 14-06; its isolation block lives in this 14-09 file), :128: MEMBERSHIP_ENDED

### 14-10 (`tests/integration/project-archive-delete-isolation.test.ts`; archive, favorites, delete)

Each lacks ProjectActivity only: archiveProject :103, restoreProject :121, archiveTask :136, restoreTask :155, favoriteProject :171, unfavoriteProject :186, favoriteTask :206, unfavoriteTask :221, deleteTask :294, deleteProject :312 (all TARGET).

### 14-11 (`tests/integration/project-move-duplicate-isolation.test.ts`)

Each lacks projectTableSnapshot( only: moveTask :45, duplicateTask :88, duplicateProject :117 (all TARGET).

### 14-12 (`tests/integration/project-ops-isolation.test.ts`)

Each lacks projectTableSnapshot( only: reorderTask :49, bulkUpdateTasks :84 (both TARGET).

Operations with no gap (18): listProjects, listTeamActivity, listLabels, listProjectMilestones, listWorkspaceMilestones, listTaskComments, listTaskAttachments, listProjectAttachments, getTaskAttachmentForDownload, listProjectMembers, listEligibleAssignees, listTeams, getTeam, listProjectTeams, listFavorites, getProjectProgress, getProjectsProgress, getTaskProgress.

## Deviations from Plan

1. **[Parser alignment, own file only] Export pattern.** The first draft also accepted a generic parameter (`<name><T ...>(actor`), which reported `runProjectTransaction` and `runProjectRead` of `service.ts` as operations missing from the table. The plan's rule is the literal `export async function <name>(actor` (biome may wrap after the parenthesis, which is still accepted), so the parser was aligned with it; the 76 operations are all found either way. Both helpers are documented here; if the orchestrator reads the rule as covering generic declarations, they are two further gaps owned by 14-04 (`service.ts`).
2. **[Stricter, own file only] Comment lines.** Lines starting with `/*` are excluded from block text as well as `//` and `*` lines (only ever removes matches).
3. **[Scope] Skip and focus files.** The rule covers `tests/integration/project*-*.test.ts` and `tests/unit/project*-*.test.ts` except the inventory itself, whose negative fixtures contain `it.skip(` and `describe.only(` as strings.

No rule was dropped, loosened or narrowed; PROJECT_OPERATIONS and NO_TARGET_ID_OPERATIONS are unchanged; no negative case was weakened; no file of an earlier plan was edited (`git diff --name-only 0b51266..HEAD -- . ':!.planning'` lists only the inventory test).

## Not done (stop rule)

- Task 2 (tested commit, gate table, blocked rows) and Task 3 (evidence tables, greps, open items, post-gate check): not run. No `14-GATE.md` exists. No lint, typecheck, unit, integration, E2E, build, audit or clean-room grep result is recorded by this plan.
- Owner and human items (14-o1, 14-o2, O-1, O-3, 12-o1, 12.2-o4, the 14-05 manual item) stay open and untouched; nothing is claimed for them.

## Self-Check: PASSED

- FOUND: tests/unit/project-operation-inventory.test.ts
- FOUND: d5ceb9c (test(14-13): operation inventory (completeness check only) fails with 59 gaps)
- `git status --porcelain -- . ':!.planning'` printed nothing after the commit.
