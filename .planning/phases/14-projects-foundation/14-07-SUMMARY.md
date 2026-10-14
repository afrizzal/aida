---
phase: 14-projects-foundation
plan: 07
subsystem: projects
tags: [comments, attachments, labels, milestones, isolation, activity]
status: complete
requires: [14-04, 14-05]
provides:
  - "comments.ts: listTaskComments, addTaskComment, editTaskComment, deleteTaskComment, plus the shared paging helpers and validVersion"
  - "attachments.ts: listTaskAttachments, listProjectAttachments, getTaskAttachmentForDownload, uploadTaskAttachments, deleteTaskAttachment"
  - "labels.ts: listLabels, createLabel, updateLabel, deleteLabel, setTaskLabels, resolveProjectLabelIdsInTx, classifyTaskMissInTx"
  - "milestones.ts: listProjectMilestones, listWorkspaceMilestones, createMilestone, updateMilestone, deleteMilestone, setTaskMilestone"
affects: [14-10, 14-11, 14-12, 14-13, phase-15]
tech-stack:
  added: []
  patterns:
    - "validate, stage, transact, discard on refusal or error (C10)"
    - "INSERT ... ON CONFLICT DO NOTHING plus a re-read for case-insensitive names"
    - "conditional update on (id, organizationId, version) with the miss classified"
key-files:
  created:
    - src/lib/projects/comments.ts
    - src/lib/projects/attachments.ts
    - src/lib/projects/labels.ts
    - src/lib/projects/milestones.ts
    - tests/integration/project-comments-attachments.test.ts
    - tests/integration/project-labels-milestones.test.ts
    - tests/integration/project-content-isolation.test.ts
  modified: []
decisions:
  - "The keyset cursor helpers, pageLimit and validVersion live in comments.ts and are imported by attachments.ts, labels.ts and milestones.ts (files_modified allowed no new shared module)"
  - "classifyTaskMissInTx is exported from labels.ts (tasks.ts keeps its own private copy); milestones.ts imports it"
  - "updateLabel and updateMilestone check a name clash under the project FOR UPDATE lock; the lower(name) index stays the database fence through mapDatabaseError"
  - "deleteLabel does not increment the versions of the tasks it unlinks (the plan asks for that only for deleteMilestone); setTaskLabels does increment"
  - "Activity values: LABEL_DELETED and MILESTONE_DELETED carry affectedTaskCount in after; ATTACHMENT_ADDED and ATTACHMENT_DELETED carry the file name cut to 200 code points"
  - "listWorkspaceMilestones and listProjectMilestones return at most LIST_MAX rows without a cursor"
metrics:
  duration: "not measured (no start time recorded)"
  completed: 2026-11-09
estimate:
  tokens: 130000
actuals:
  tokens: 27500
  tasks: 3
  commits: 3
plan_head_before: 99afd1f201388e7ebba24f858392d9b60b4146f5
---

# Phase 14 Plan 07: Comments, attachments, labels and milestones Summary

Task comments read back as renderTaskMarkdown HTML and recorded by id only; attachments validated before staging, discarded on every refusal or error, readable only with project access and queued for file cleanup on delete; per-project labels and milestones with case-insensitive names and versioned task links; a section 17 isolation matrix over all 20 operations.

## What was built

- **comments.ts.** addTaskComment runs CONTENT under PROJECT_SHARE with the task FOR SHARE. It writes COMMENT_ADDED with `after { commentId }`. listTaskComments (READ) returns comments oldest first with a keyset cursor and `bodyHtml` from renderTaskMarkdown. editTaskComment (AUTHOR) and deleteTaskComment (AUTHOR_OR_MANAGE) resolve the comment to its task with an organization term, after the membership read. The edit is versioned (CONFLICT on a stale version, `editedAt` set). The delete writes COMMENT_DELETED with `before { commentId, authorUserId }`. No activity row holds a body.
- **attachments.ts.** uploadTaskAttachments runs these steps in order:
  1. Checks the file count (TOO_MANY above 10, INVALID_INPUT for none).
  2. Runs a CONTENT pre-check without a lock.
  3. Runs validateUpload on every file.
  4. Builds the storage keys with buildStorageKey.
  5. Stages the files with saveStagedFiles.
  6. Inside the transaction, re-checks requireTask under PROJECT_SHARE and inserts the rows, one ATTACHMENT_ADDED per file.
  Every refusal or thrown error after staging calls `discard()`. getTaskAttachmentForDownload returns metadata only (storageKey, mimeType, originalFilename, sizeBytes), and only after the READ check through requireTask, so it never uses the organization-only lookup. deleteTaskAttachment (UPLOADER_OR_MANAGE) deletes the row, calls enqueueFileCleanupInTx in the same transaction and writes ATTACHMENT_DELETED.
- **labels.ts.** Managing labels is MANAGE under PROJECT_UPDATE:
  - createLabel uses `ON CONFLICT DO NOTHING` and a re-read, and returns NAME_TAKEN on a clash.
  - deleteLabel removes the TaskLabel links first and writes affectedTaskCount.

  setTaskLabels is CONTENT under PROJECT_SHARE with the task FOR UPDATE. It accepts at most 20 labels, all from the same project (otherwise INVALID_INPUT with field labelIds). It increments the task version and writes TASK_UPDATED with labelNames before and after. Plans 14-11 and 14-12 import resolveProjectLabelIdsInTx.
- **milestones.ts.** create, update and delete are MANAGE under PROJECT_UPDATE. Dates are CalendarDate strings. updateMilestone is a conditional update on the milestone version, with the miss classified. deleteMilestone clears the milestone from its tasks first (their versions increment) and writes affectedTaskCount. setTaskMilestone is a conditional update on the task version, and a milestone from another project is INVALID_INPUT with field milestoneId. listProjectMilestones returns task and done counts. listWorkspaceMilestones covers readable, non-archived projects only, within an optional date range.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 | Tracer: comment add and list with safe rendering | da214e3 |
| 2 | Attachments end to end, comment edit and delete | 8dbaa57 |
| 3 | Labels, milestones and the content isolation matrix | fe9c698 |

## Verification

- **Task 1:** the plan's verify command exited 0 (1 file, 3 passed). `renderTaskMarkdown` appears 4 times in comments.ts. `grep -cE 'renderMarkdown\(|renderMarkdownPreview\(' src/lib/projects/comments.ts` prints 0. The tracer gate re-ran the verify end to end before Task 2 started.
- **Task 2:** the plan's verify command exited 0 (1 file, 13 passed).
  - attachments.ts calls validateUpload, saveStagedFiles, buildStorageKey, discard and enqueueFileCleanupInTx.
  - The five `export async function <name>(actor` declarations are wrapped across lines by biome. They were matched with an equivalent multiline perl match (1 each).
  - The test file contains TOO_MANY, UNSUPPORTED_FILE_TYPE, FILE_TOO_LARGE, ProjectFileCleanup, getTaskAttachmentForDownload and editTaskComment.
- **Task 3:** the plan's full verify command (three integration files, `next typegen`, `pnpm typecheck` over the whole repository, biome) exited 0 on its second run: 3 files, 42 passed, typegen OK, biome clean on 17 files. The first run passed the tests but typecheck failed (see deviation 1).
  - The isolation file has one `describe("<op> isolation"` per operation, 1 each for all 20.
  - project-labels-milestones.test.ts contains NAME_TAKEN, affectedTaskCount, assertNoDeadlock and waitForBlockedBy.
  - Both stale-version greps print 1.
  - No case is skipped or focused.
- No `@/` import in the four modules. `git grep -i -n gr8r -- src docs website README.md public prisma tests` prints nothing.
- The race is PID-bound (createServiceRace, waitForBlockedBy on the one-connection observer client, assertNoDeadlock) and uses no sleep.

## Deviations from Plan

1. **[Rule 1 - Bug] Typecheck errors fixed before the Task 3 commit.** In attachments.ts the staged list `validated` was inferred as `any[]`; it is now typed. The test helpers returned `ArrayBuffer | SharedArrayBuffer` from `arrayBuffer()`; they now use `Uint8Array.from(...).buffer`. Both fixes went into the Task 3 commit fe9c698. The Task 2 commit 8dbaa57 does not pass the whole-repository typecheck on its own.
2. **[TDD shape] No separate RED commits.** Tasks 2 and 3 are `tdd="true"`. The tests and code of each task went into one commit, the same disposition as 14-04 and 14-06.
3. **Acceptance grep for the five attachment declarations.** Biome wraps the signatures, so a multiline match was used, as the run notes allow.
4. **Temporary upload directories are not removed.** Both attachment test files create a fresh `mkdtemp` directory under the OS temporary directory and leave it (a few small PNG files), because of the no-recursive-delete rule.

## Known Stubs

None.

## Threat Flags

None. The new surface is the one in the plan's register: T-14-33 (download read gated by READ), T-14-34 (renderTaskMarkdown), T-14-35 (validate before staging, discard), T-14-36 (ids only in activity) and T-14-37 (same-project checks). No route or endpoint was added.

## Manual items

None in this plan.

## Self-Check: PASSED

- FOUND: all seven files in key-files.created
- FOUND: commits da214e3, 8dbaa57, fe9c698 (`git rev-list --count 99afd1f..HEAD` = 3 before this SUMMARY)
