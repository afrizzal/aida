---
phase: 14-projects-foundation
reviewed: 2026-11-09T15:04:56Z
depth: deep
files_reviewed: 25
files_reviewed_list:
  - src/lib/projects/keys.ts
  - src/lib/projects/tasks.ts
  - src/lib/projects/comments.ts
  - src/lib/projects/attachments.ts
  - src/lib/projects/labels.ts
  - src/lib/projects/milestones.ts
  - src/lib/projects/recurrence.ts
  - src/lib/projects/recurrence-rules.ts
  - src/lib/projects/rank.ts
  - src/lib/projects/ordering.ts
  - src/lib/projects/bulk.ts
  - src/lib/projects/progress.ts
  - src/lib/projects/move.ts
  - src/lib/projects/duplicate.ts
  - src/lib/projects/archive.ts
  - src/lib/projects/favorites.ts
  - src/lib/projects/delete.ts
  - src/lib/projects/file-cleanup.ts
  - src/lib/worker/jobs/project-file-cleanup.ts
  - src/lib/worker/index.ts
  - src/lib/markdown/render.ts
  - src/lib/attachments/validate-upload.ts
  - docker-compose.yml
  - docker-compose.egress-test.yml
  - docs/OPERATIONS.md
findings:
  critical: 0
  warning: 5
  info: 9
  total: 14
status: issues_found
---

# Phase 14: Code Review Report (part b: task operations, content, recurrence, ordering, bulk, move, duplicate, archive, favorites, delete, file cleanup, rendering, upload, worker, compose)

**Reviewed:** 2026-11-09T15:04:56Z
**Depth:** deep (static only; no test suite, build or Docker run)
**Files Reviewed:** 25 (plus the README upgrade-notes diff; `access.ts`, `service.ts`, `activity.ts`, `contract.ts`, `projects.ts`, `staged-files.ts`, `local-file-storage.ts` and the Phase 14 migration were read as call-chain context)
**Status:** issues_found

## Summary

The diff `d88de64..HEAD` was read against 14-CONTRACT.md sections 1 to 17 and SUMMARYs 03, 05 to 07 and 09 to 12. Every requested hunt area was traced:

- **Isolation and existence oracles:** every operation in scope resolves its target through `requireProject`/`requireTask` or the read predicate after the membership read. Unknown ids, ids from other organizations and ids in unreadable private projects all return the same NOT_FOUND (attachments, comments, labels, milestones, bulk, move, duplicate, favorites, delete, progress, keys). `getTaskAttachmentForDownload` checks READ on the task's **current** project (`attachments.ts:171-183`) and never uses the organization-only lookup. No Critical leak was found.
- **Delete order:** locks, then storage-key reads, then TOMBSTONE, then the outbox, then FK-order deletes, then activity. This matches contract section 12. `ProjectKeyPrefix`, `ProjectActivity` and `AuditEvent` are never deleted.
- **Sweep:** only `ENOENT` counts as done. It uses `FOR UPDATE SKIP LOCKED`, the database clock and the backoff `min(2^attempts, 60)`, and every statement after the select carries the row's own organization. K68 is in place: the worker mounts `uploads_data` with `UPLOADS_DIR` in both compose files, and app and worker share one image and user, so file permissions do not differ.
- **Rendering:** K65 holds. Every `img`, `picture` and `source` is removed before sanitize, raw HTML never enters the tree, and links keep the safe `target` and `rel`.
- **Uploads:** size is checked before reading and again on the bytes read, and the type is sniffed from the bytes.

The defects found are correctness and privacy gaps at the edges:

1. A bulk completion builds the recurrence successor from values that the same call overwrites.
2. A task description is validated after trim but stored untrimmed, so a database CHECK violation surfaces as an unmapped error (HTTP 500).
3. The alias resolver gives back, to a target-only reader, the source key that the move activity redacts.
4. Uploaded file names keep bidi and C1 control characters, which allows file-name spoofing.
5. The milestone lists and `listFavorites` have no cursor, although the contract requires keyset paging, so entries past the limit cannot be reached.

## Warnings

### WR-01: A bulk completion builds the recurrence successor before the rest of the patch is applied

**File:** `src/lib/projects/bulk.ts:349-388` (with `src/lib/projects/recurrence.ts:369-406`)

**Issue:** For a task whose status changes, `bulkUpdateTasks` first calls `applyStatusChangeInTx` (line 350). For a recurring task moving into DONE, that call runs `spawnRecurrenceSuccessorInTx`. The spawn takes its snapshot of the predecessor from `UPDATE ... RETURNING` (recurrence.ts:369-376: dueDate, startDate, priority, assigneeUserId, title, estimate) and reads its `TaskLabel` rows (recurrence.ts:402-406). The other fields of the same bulk patch are written only afterwards: dates, assignee, priority and milestone at bulk.ts:357-362, label removals and additions at bulk.ts:370-388.

As a result, `bulkUpdateTasks([t], { status: "DONE", dueDate: "2026-12-01" })` on a WEEKLY task due 2026-11-01 gives:
- the predecessor due 2026-12-01;
- a successor due 2026-11-08, computed from the stale base and earlier than its own predecessor;
- a successor with the old priority, assignee and labels.

The TASK_RECURRED row records those stale dates while the TASK_STATUS_CHANGED row of the same batch records the new ones. `setTaskStatus` and `reorderTask` are not affected, because they change only status and rank.

**Fix:** Write the non-status fields and the label changes before the status change, so that the spawn reads the patched row:
```ts
if (plan.newStatus !== null) {
  if (fieldsChanged) {
    await tx.task.updateMany({ where: { id: task.id, organizationId: actor.orgId }, data: plan.data });
  }
  await applyLabelChanges(tx, actor.orgId, task, plan);   // remove, then add (moved up)
  await applyStatusChangeInTx(tx, ctx, task, plan.newStatus, { now, batchId, record: false });
} else { /* unchanged */ }
```
`applyStatusChangeInTx` matches on `version: task.version`, and the field update above does not increment the version, so the conditional update still matches. Add an integration case: a bulk call with `{ status: DONE, dueDate, priority, addLabelIds }` on a recurring task, asserting the successor's dates, priority and labels.

### WR-02: A task description is validated after trim but stored untrimmed, so a valid-looking description fails the CHECK with an unmapped error

**File:** `src/lib/projects/tasks.ts:110-116` (stored at `tasks.ts:325` and `tasks.ts:660-661`); the same pattern is in `src/lib/projects/projects.ts:64-70` (outside this part's file list)

**Issue:** `parseTaskInput` checks `codePointLength(raw.description.trim()) > TASK_DESCRIPTION_MAX` but stores `raw.description` unchanged (line 115). The migration's `Task_description_length_check` is `char_length("descriptionMarkdown") <= 20000` on the stored value. Take a description of 20,000 code points followed by a newline, which editors often append:
- the service accepts it, because the trimmed length is 20,000;
- PostgreSQL refuses it with 23514;
- `mapDatabaseError` (service.ts:131-144) maps only the subtask trigger messages, `Task_dates_check` and unique violations, so the error is rethrown out of `createTask`/`updateTask` and becomes HTTP 500 instead of `INVALID_INPUT` (contract section 14: "every other error ... a programming error"). Below the limit, whitespace around the description is kept in storage and in no-op detection.

**Fix:** Store the value that was validated, as comments and milestones already do:
```ts
else {
  const text = raw.description.trim();
  if (text.length === 0) value.description = null;
  else if (codePointLength(text) > TASK_DESCRIPTION_MAX) bad("description");
  else value.description = text;
}
```
Make the same change in `projects.ts` `validDescription`. If leading indentation must be preserved for Markdown, validate the untrimmed length instead, so the service check equals the CHECK.

### WR-03: `resolveTaskKey` gives back, to a target-only reader, the source key that the move activity redacts

**File:** `src/lib/projects/keys.ts:106-121` (alias written by `src/lib/projects/move.ts:241-250`)

**Issue:** After a move from private project P to project Q, the old key `P-7` becomes an ALIAS row whose `taskId` is the moved task. `resolveTaskKey` checks readability only on the task's **current** project. A reader of Q who cannot read P therefore gets `{ ok: true, taskId, key: "Q-3", projectId: Q, isAlias: true }` for `"P-7"`.

The same reader's TASK_MOVED row replaces the source side, including `taskKey`, with `{ redacted: true }` (contract section 5, reviews C1 and R2-1: "no ... task key of that side survives"). Prefixes are short, and the org-wide `PREFIX_TAKEN` refusal already shows which prefixes exist, so a Q reader can probe `PREFIX-1..N`. They learn the private source prefix, the task's number there, and that the task came from it. Contract section 6/11 permits this ("the old key resolves only for readers of the target project"), so the two guarantees contradict each other. This is a design gap, not a coding slip.

**Fix (owner decision):** Resolve an ALIAS only when the reader can read both the task's current project and the alias row's `projectId`:
```ts
if (row.kind === "ALIAS") {
  const readable = await readableProjectIds(db, actor, [row.projectId]);
  if (!readable.has(row.projectId)) refuse("NOT_FOUND");
}
```
The alternative is to record in 14-CONTRACT.md section 5 that redaction does not cover key probing.

### WR-04: The upload display-name cleaner keeps bidi overrides and C1 control characters (file-name spoofing)

**File:** `src/lib/attachments/validate-upload.ts:34-47`

**Issue:** `cleanDisplayName` removes only U+0000-U+001F and U+007F. It keeps:
- C1 controls (U+0080-U+009F);
- bidi embedding, override and isolate characters (U+202A-U+202E, U+2066-U+2069, U+200E/U+200F, U+061C);
- zero-width and line or paragraph separators (U+200B-U+200D, U+2028, U+2029, U+FEFF).

For example, the name `invoice` + U+202E (RIGHT-TO-LEFT OVERRIDE) + `fdp.exe` shows as `invoiceexe.pdf` wherever the name is shown as text: in the task attachment list, in the ATTACHMENT_ADDED and ATTACHMENT_DELETED activity values, and in the Phase 15 download's file name. D-14 treats file names as untrusted metadata shown as text. This is the classic right-to-left override disguise for executables, and the name reaches every reader of the project.

**Fix:** Drop format and control characters by Unicode category, not only C0:
```ts
const UNSAFE = /[\p{Cc}\p{Cf}  ]/u;
for (const char of raw) if (!UNSAFE.test(char)) kept += char;
```
Add unit cases for U+202E, U+2066 and U+0085.

### WR-05: The milestone lists and `listFavorites` cut results at the limit with no cursor

**File:** `src/lib/projects/milestones.ts:103-108`, `src/lib/projects/milestones.ts:153-162`, `src/lib/projects/favorites.ts:128-133,166-200`

**Issue:** Contract section 15 says the milestone and favorite lists have a default of 50, at most 200, and **keyset cursors**.
- `listProjectMilestones` and `listWorkspaceMilestones` take `take: LIST_MAX` with no cursor and no `hasMore`. In a project with more than 200 milestones, or a workspace whose readable projects hold more than 200 milestones in a date range, the later milestones are dropped silently. Timeline (AIDA-78) and the overview would show an incomplete, apparently complete list.
- `listFavorites` returns `hasMoreProjects` and `hasMoreTasks` but no cursor, so a caller can never fetch entries past the first `limit`.

**Fix:** Use the same keyset helpers as comments and attachments (`pageLimit`, `encodeCursor`, `decodeCursor`). For milestones, order by `(date, id)` with `take: limit + 1`, and return `{ milestones, hasMore, nextCursor }`. For favorites, add `projectsCursor` and `tasksCursor` over `(createdAt desc, id desc)`.

## Info

### IN-01: Several writes re-enter an earlier lock class after the counter and key classes

**File:** `src/lib/projects/move.ts:164-172`; `src/lib/projects/ordering.ts:143-170`; `src/lib/projects/bulk.ts:344-402`; `src/lib/projects/duplicate.ts:238-265,436-441`

**Issue:** Contract section 3 says every transaction "takes locks in this order and never goes back to an earlier class". The following paths break that:
- `moveTask` takes the target counter (class 4) and then calls `appendRankInTx` with `canRebalance: true`, which can update task rows of the target group (class 3).
- `reorderTask` goes through the recurrence spawn (counter, TaskKey, activity) and then rebalances and updates task rows.
- `bulkUpdateTasks` interleaves spawns and the next task's rank and field updates.
- `insertCopy` alternates counter and key for each copied task.

All of these run under the project's FOR UPDATE, so no other service transaction holds those rows and no deadlock is reachable today. The contract's sentence is still false as written.

**Fix:** In `moveTask`, compute `rootRank` before the counter loop. Elsewhere, amend section 3 with "under PROJECT_UPDATE or PROJECTS_UPDATE the class order inside the locked project is not binding".

### IN-02: The "start over once" in `requireTask` can lock a second project out of id order

**File:** `src/lib/projects/access.ts:299-318` (on the call path of every task write in this part)

**Issue:** When the task moved between the plain read and the locks, the second attempt calls `requireProject` on the new project while the first project's lock is still held. If another transaction holds those two projects in the opposite order, PostgreSQL aborts one of them with 40P01. `mapDatabaseError` does not map that error, so it surfaces as a 500. The window is tiny, and `move.ts` already chose CONFLICT for the same case (14-11 deviation 3).

**Fix:** Refuse with CONFLICT when `plain.projectId` changes between attempts, or retry only when the project id is unchanged (parent change only).

### IN-03: `getTask` returns `recurrencePredecessorId` even when the predecessor is in a project the reader cannot read

**File:** `src/lib/projects/tasks.ts:451,475-478`

**Issue:** After a successor or its predecessor is moved to another project, `TaskView.recurrencePredecessorId` gives the reader the opaque id of a task in a project they may not read. Only an id leaks, and it resolves to nothing for them.

**Fix:** Return the id only when `readableProjectIds` covers the predecessor's project; otherwise return null.

### IN-04: Near 2999-12-31, a recurring task cannot be completed, and in a bulk call it blocks the whole batch

**File:** `src/lib/projects/recurrence.ts:52-59,381-389`

**Issue:** When the next occurrence would pass `CALENDAR_DATE_MAX`, the completion itself is refused with INVALID_DATE_RANGE. This applies to `setTaskStatus`, `reorderTask` and `bulkUpdateTasks`, and in a bulk call it refuses every other task too. The user must clear the recurrence before they can mark the task done, and the refusal code does not say why. This is intended (14-09), and the date is far away.

**Fix:** Consider ending the series (completing with no successor) instead of refusing, or document the behavior for Phase 15's error copy.

### IN-05: The cleanup sweep has no terminal state and does file I/O inside a 30-second transaction

**File:** `src/lib/projects/file-cleanup.ts:120-171`

**Issue:**
- A permanent failure (`EACCES`, `EISDIR`, or the `invalid attachment key` error of `safeKey`, which has no `code` and is logged as `UNKNOWN`) is retried hourly forever and logged every hour, with no attempt cap and nothing an operator can see.
- Up to 100 `storage.delete` calls run while the transaction holds its rows. On slow storage the 30-second `TRANSACTION_OPTIONS.timeout` aborts the run after files are already gone. That outcome is safe, because ENOENT counts as done on the next run, but the job is reported as failed every minute.

**Fix:** Cap attempts (for example 20) and leave the row in place, with `lastErrorCode` set, for an operator query. Optionally claim the rows in one short transaction, do the file I/O outside it, and delete the rows in a second transaction.

### IN-06: Upload staging leaves orphan files on a crash, and the storage-key extension comes from the client's file name

**File:** `src/lib/projects/attachments.ts:219-275`; `src/lib/attachments/local-file-storage.ts` (`buildStorageKey`)

**Issue:**
- A process crash between `saveStagedFiles` and the commit leaves files that no row or outbox entry records.
- If COMMIT fails with an unknown outcome, the thrown error triggers `discard()` even though the row may already be committed, which leaves an attachment row with no file.
- The on-disk extension is taken from the uploaded name (`a.html` holding PNG bytes is stored as `<hex>.html`). That is harmless while the download route serves `mimeType`, but risky if the volume is ever served statically.

**Fix:** Derive the key extension from the sniffed type (`sniffed.ext`). Optionally write a pending `ProjectFileCleanup` row before staging and remove it in the committing transaction.

### IN-07: `text/plain` and `text/csv` in `ALLOWED_MIME` can never pass

**File:** `src/lib/attachments/validate-upload.ts:60-63`

**Issue:** `file-type` cannot sniff text, so these two entries never match, and every text upload is refused as UNSUPPORTED_FILE_TYPE. This is already recorded in the 14-03 SUMMARY and matches the four inline copies.

**Fix:** Remove the two entries, or add an explicit text check (valid UTF-8, no NUL) that maps to `text/plain`.

### IN-08: Duplicated helpers

**File:** `src/lib/projects/tasks.ts:538-562`, `recurrence.ts:78-102`, `archive.ts:45-69`, `labels.ts:69-93` (classifyTaskMiss); `tasks.ts:182`, `recurrence.ts:61`, `archive.ts:22`, `comments.ts:198`, `delete.ts:138-144`, `move.ts:100-106` (validVersion); `recurrence.ts:313-340` (a copy of `appendRankInTx`); the rebalance loops in `tasks.ts:246-250`, `ordering.ts:158-163`, `duplicate.ts:223-228`

**Issue:** The same logic appears in four to six places. A later fix to one copy, for example the classifyTaskMiss order or the rank update, will drift from the others.

**Fix:** Keep one exported `classifyTaskMissInTx`, `validVersion` and `rebalanceGroupInTx`. In recurrence.ts, call `appendRankInTx(..., { canRebalance: true })` from a small shared module to keep the import graph acyclic.

### IN-09: Limits are handled inconsistently, and `cleanupQueued` overstates

**File:** `src/lib/projects/comments.ts:44-50` vs `tasks.ts:1045-1051` and `favorites.ts:156-160`; `src/lib/projects/delete.ts:113`

**Issue:**
- `pageLimit` refuses a limit above 200 with INVALID_INPUT, while `listLimit` and `listFavorites` silently clamp it to 200.
- `cleanupQueued` reports the number of storage keys collected, not the number of rows `enqueueFileCleanupInTx` inserted (`deleteTaskAttachment` returns the inserted count).

**Fix:** Pick one limit rule, clamp or refuse. In `removeTasksInTx`, return the value `enqueueFileCleanupInTx` returns.

---

_Reviewed: 2026-11-09T15:04:56Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
