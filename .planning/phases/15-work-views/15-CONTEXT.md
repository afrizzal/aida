# Phase 15: Work Views - Context

**Gathered:** 2026-11-10, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for the UI design contract (`/gsd-ui-phase 15`), then planning
**Sources:** facts checked against the code at `7718899`; Codex brainstorm `run-loop/codex/fase15-jawab.md` (round 1, areas 1 to 9; question `run-loop/codex/fase15-tanya.md`); the Phase 14 contract `phases/14-projects-foundation/14-CONTRACT.md`, `14-CONTEXT.md` with its K69 amendment, and run decisions K71 to K73 in `14-REVIEW.md`. Run decisions K74 to K90 are taken here by the run-loop orchestrator: Codex's recommendation where it gave one, otherwise the option most conservative for security, authorization, privacy and schema (charter rule 4), with no new package. Every Codex claim used below was re-checked in the code unless marked *unverified*.

<domain>
## Phase Boundary

Phase 15 builds the **views and the thin server layer** on top of the Phase 14 services in `src/lib/projects/`:

- the project list page and the project detail page with its tabs;
- the task drawer and the full task page;
- the List, Board, Table, Calendar, Timeline and Files views of a project;
- workspace-level Tasks, Calendar and Timeline across every project the user may read;
- saved views per user and per project;
- drag and drop with keyboard alternatives, multi-select with bulk actions, and in-cell editing.

Requirements AIDA-72 to AIDA-80 and AIDA-106 in `.planning/REQUIREMENTS.md`; ROADMAP Phase 15 success criteria 1 to 6. Service and schema changes are allowed only where a view needs a query or a stored setting that Phase 14 lacks (D-05, D-17, D-18), under the Phase 14 contract amendment rule (`14-CONTRACT.md` section 0).

Parts that belong to later phases:

- Phase 16: Home, My Tasks (AIDA-82 reuses these views), the notification center, the Activity page, search, Members and Teams pages, onboarding, favorites and archive pages (AIDA-108), and preferences (AIDA-98: week start, date format, time zone, start page, how a task opens, which view a project opens on).
- Phase 16: palette commands, shortcuts and context menus for Projects (AIDA-86, one mechanism through the AIDA-49 registry).
- Phase 17: ticket to task, task status back to the ticket, AI suggestions.

**Clean-room.** The feature list follows a reference product whose repository has no licence: "tanpa lisensi, menurut owner 2026-11-08" (charter, owner rule E and section "Clean-room modul Projects"). The only allowed sources are `run-loop/FITUR-PROJECTS.md` and the demo behaviour recorded there. Nothing is copied: no code, CSS, colour tokens, special icons, UI text, sample data, exact layout or product name. The repository is not cloned, fetched or opened, and the demo's JS and CSS bundles are not read. No screenshot of the demo is stored in the repo. The look follows `.planning/DESIGN-SYSTEM.md`, and all UI text is written fresh. The reference product is never named outside `.planning/`. At the end of the phase, `git grep -i -n gr8r -- src docs website README.md public prisma tests` must print nothing (it prints nothing at `7718899`). If code or an asset of the reference product enters the repo, it is removed with a new commit, and the run stops and reports.

Phases 8, 9 and 10 stay **parked**. `getScopedDb` (`src/lib/session.ts:38`) and `getSessionActor` (`src/lib/session.ts:53`) do not check membership; the Phase 14 services do. AIDA-43 (deactivation) stays open (O-3).

**Privacy guarantees carried from Phase 14 (binding).**

- A private project is read only by direct project members; organization owners and admins do not bypass it (K62, 14-o1 default), and a team grants nothing by itself (K69).
- No existence oracle: a private project, task, attachment or view the reader cannot read gives the same result as a missing id.
- Every query that returns rows, counts, cursors or `hasMore` carries the current read predicate in the same statement (K73).
- The stored project position is never exposed (K71).
- An alias key resolves only for readers of its origin project (K72).
- Views call only Phase 14 services (K75), and workspace-level pages list only readable projects and their tasks.

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex area N" is section N of `run-loop/codex/fase15-jawab.md`. "Orchestrator" means the run-loop orchestrator decided it. "Charter rule 4" means the conservative option was taken on security, authorization, privacy or schema. Run decisions K74 to K90 are listed with one-line reasons at the end of this section.

### Routes and the server layer

- **D-01:** Route matrix (run decision K74):
  - `/projects`: the project list (grid, list and table forms), search, status filter, sort, favorite and archive controls, and "New project".
  - `/projects/[projectId]`: the Overview tab. `/projects/[projectId]/list`, `/board`, `/table`, `/calendar`, `/timeline`, `/files` and `/activity`: one URL segment per tab, so every tab deep-links and survives a reload.
  - `/tasks/[taskId]`: the one canonical task URL. Direct entry and reload render the full page; navigation from a view opens the same URL in a drawer over the view (D-02).
  - `/workspace/tasks` (list, board and table forms), `/workspace/calendar` and `/workspace/timeline`: the AIDA-106 pages.
  - `GET /api/projects/attachments/[attachmentId]` (download) and `POST /api/projects/tasks/[taskId]/attachments` (upload): D-16.
  - The sidebar gains "Projects" and "Tasks" entries next to the existing items (`src/components/sidebar.tsx:24-28`), styled with `sidebar-*` tokens.

  The task URL carries the task id, never the key. The id survives a move (comments, attachments and favorites follow the id, `14-CONTRACT.md` section 11), so an old link keeps working without alias logic, and the route adds no key probe next to owner item 14-o3. The key is shown in the UI and is part of the copied link text only as a label. A missing, unreadable or deleted project or task renders one "not available" state, identical in every case (Next `notFound()`); MEMBERSHIP_ENDED follows the existing session handling. Source: Codex area 1; orchestrator, K74; charter rule 4.
- **D-02:** Drawer and full page (AIDA-73). One component renders the task and one loader feeds it. The loader calls `getTask` (`src/lib/projects/tasks.ts:424`), `listTaskComments`, `listTaskAttachments`, `listTaskActivity` (`src/lib/projects/activity.ts:394`) and `getTaskProgress`, and every request authorizes again. The preferred mechanism is a Next 16 parallel route with an intercepting route, so client navigation shows `/tasks/[taskId]` as a drawer while direct entry renders the full page. This mechanism is *unverified* in this repo (Codex area 1): the researcher checks it against current Next 16 documentation, and an E2E proves back and forward, reload, direct entry, closing the drawer with focus returned to the control that opened it, the link of a task after a move, and that drawer and page show the same field values. If the intercepting route fails that E2E, the fallback is drawer state in `?task=<taskId>` on the view URL, with "Open full page" leading to `/tasks/[taskId]`; both URLs deep-link, and the deviation is recorded in the SUMMARY. Source: Codex area 1; orchestrator.
- **D-03:** Server actions are a thin layer, following `src/app/(app)/kb/proposals/actions.ts` (header `:1-22`):
  - The actor comes from `getSessionActor()` (`src/lib/session.ts:53`). The service checks membership and access.
  - Ids from the browser are passed on as untrusted strings. The services treat a malformed id as NOT_FOUND (`14-CONTRACT.md` section 2, step 1).
  - Only `getSessionActor()` and the service call sit inside the `try`. The `catch` calls `unstable_rethrow` first, then returns `{ ok: false, code: "UNKNOWN" }` without the error message (`ActionUnknown`, `actions.ts:43`; `unknownResult`, `:51`).
  - After a successful result, `revalidatePath` runs per path in its own `try` (`revalidateAfterCommit`, `actions.ts:60`). A revalidation failure never changes the result.
  - One central module maps every `PROJECT_REFUSAL_CODES` value plus UNKNOWN to copy, focus and control state, in the role `resolveActionOutcome` plays for proposals (`src/lib/kb/proposal-outcome.ts:216`). NOT_FOUND has one copy for missing and unreadable. UNKNOWN means "the outcome is unknown", never "failed": the UI says the change may or may not have been saved, reloads the data, and keeps the risky control disabled until then (K88).
  - Pages and loaders (server components) call the services the same way.

  Source: Codex area 1; orchestrator.
- **D-04:** One authorization point (run decision K75). Pages, loaders, actions, route handlers and components of this phase call only the services of `src/lib/projects/` and the saved-view services. None of them imports `@/lib/db`, the Prisma client, `scopedDb` or `getScopedDb`. A unit test scans the Phase 15 paths and fails on such an import. Source: Codex area 6; orchestrator, K75; charter rule 4.

### Service gaps closed as contract amendments

- **D-05:** The Phase 14 reads do not cover every query the views need (Codex finding, verified):
  - `listProjects` (`src/lib/projects/projects.ts:640`) takes only `archived`, `cursor` and `limit`. There is no search, no status filter and no sort.
  - `listProjectTasks` (`tasks.ts:1133`) has no date filter.
  - `listWorkspaceTasks` (`tasks.ts:1195`) filters only by a due-date range and orders by id. A task whose start-to-due range crosses a window, or one with only a start date, is missed.
  - `TaskListItem` (`tasks.ts:1025-1039`) has no labels, milestone or estimate, which the Table and grouping need.
  - Workspace reads have no project filter and no sort.

  Run decision K76 closes these gaps inside `src/lib/projects/`:
  - **listProjects** gains:
    - `q`: case-insensitive substring of the name or the key prefix, trimmed, 1 to 80 code points, with LIKE wildcards matched literally.
    - `statuses`: a subset of `PROJECT_STATUSES`.
    - `sort`: one of `manual` (the default, the organization order of K71), `name`, `dueDate` (nulls last) and `createdAt`, each with id as the tie-breaker.

    The cursor holds only the last returned project id. The server re-reads that project's sort key under the read predicate, the K71 pattern (`projects.ts:617-632`).
  - **Task reads** (project and workspace) gain:
    - A date window `{ from, to }`. A task is included when the range from (start, else due) to (due, else start) overlaps the window, both ends inclusive.
    - A separate read of the tasks with no date (the "Unscheduled" list).
    - Filters by status, assignee, priority, label and milestone where a view offers them.
    - Sorts with a unique tie-breaker.
    - On the workspace, `projectIds` (at most `LIST_MAX`). Each id is matched under the predicate in the same statement, so an unreadable id matches nothing, exactly like a missing id.
  - **Group counts**: a count per group under the same predicate, in the same read transaction as the page.
  - **List items** gain labels (id, name, colour), the milestone id and name, `estimateMinutes`, and for workspace rows the project's name, key prefix and colour. All of them are read through the predicate.

  Rules:
  - Each new or extended operation is entered in `14-CONTRACT.md` and `src/lib/projects/contract.ts` in one commit (contract section 0). It is added to `PROJECT_OPERATIONS` (`contract.ts:395`) with its access level, lock `NONE` and isolation class, and covered by the isolation file shape of contract section 17 and by `tests/unit/project-operation-inventory.test.ts`.
  - Every query that returns rows, counts, cursors or `hasMore` carries `readableProjectWhere` (`src/lib/projects/access.ts:386`) in the same statement (K73). No list of readable project ids is read first and reused.
  - The browser never filters, groups, counts or searches a partial page and presents the result as complete.
  - Existing operation names, refusal codes and behaviour do not change, and existing tests stay green.

  Source: Codex areas 6 and 8; orchestrator, K76; charter rule 4.
- **D-06:** Workspace level (AIDA-106):
  - The workspace Tasks page offers list, board and table forms, with grouping by status, project, assignee or priority and a column choice. Calendar and Timeline follow D-13 and D-15.
  - Archived projects, archived tasks and subtasks of archived parents are left out (current behaviour of `listWorkspaceTasks`).
  - The workspace Board changes status only (run decision K77). It calls `setTaskStatus` (`tasks.ts:834`) with `expectedVersion`, and the service appends the task to its project's column. No order inside a workspace column is stored, because rank is per (project, status) and has no global meaning (Codex area 2). A workspace column is ordered by due date (nulls last), then key, then id.
  - **Proof, unmocked Testcontainers.** Two worlds that differ only by a private project the reader cannot read (with tasks, subtasks, labels, milestones and dates inside every tested window) give deep-equal complete page sequences: rows, `hasMore`, cursors and group counts. This covers every workspace read and every project-list search, filter and sort, for the nonMember, teamMember, orgAdmin and outsider actors of contract section 17.
  - **Races.** PID-bound interleavings (`tests/support/project-read-race.ts`, `tests/support/lock-wait.ts`) cover organization-member removal, project-member removal, privacy change and move during a paused read of each new operation.
  - **E2E.** A non-member never sees the private project's tasks or milestones on the three workspace pages.

  Source: Codex areas 2 and 6; orchestrator, K77.

### Views

- **D-07:** Project list and detail (AIDA-72):
  - The grid, list and table forms render the same server page. The chosen form is kept in view state (D-18).
  - Search, status filter and sort follow D-05. Archived projects appear only under an "Archived" filter (`archived: "only"`).
  - Progress comes from `getProjectsProgress` (`src/lib/projects/progress.ts:73`) for the loaded page, and from `getProjectProgress` (`:56`) on the detail page.
  - Favorite and archive controls exist on both pages (`favoriteProject`, `unfavoriteProject`, `archiveProject`, `restoreProject`).
  - The Overview tab shows description, status, due date, progress, direct members and upcoming milestones. The description is rendered through the sanitized task Markdown path (`renderTaskMarkdown`, `src/lib/markdown/render.ts:204`) or as plain text, never as raw HTML.
  - The Activity tab shows `listProjectActivity` (`activity.ts:358`) exactly as returned, including the redacted projection. It never re-derives hidden data.
  - E2E covers the three forms, search, filter and sort, the overview and progress, and favorite and archive from both pages.

  Source: AIDA-72; Codex area 9; orchestrator.
- **D-08:** Supporting surfaces over existing operations (run decision K84). No view can be used without them, and no later phase lists them:
  - Create a project (name, key prefix, colour, icon, privacy).
  - Edit a project: `updateProject`, `setProjectStatus`, `setProjectPrivacy` and `changeProjectKeyPrefix`.
  - Manage direct members: `listProjectMembers`, `addProjectMember`, `removeProjectMember` and `setProjectMemberRole`, with LAST_MANAGER explained.
  - Manage labels and milestones: create, update and delete.
  - Duplicate a project with or without tasks, and delete it with the typed name (`confirmName`).
  - Task actions in the drawer and on the full page: duplicate, move to another readable project, favorite, copy link (`/tasks/[taskId]`), open full page, archive and restore, and delete with `{ confirm: true }`.

  PREFIX_TAKEN and PREFIX_INVALID show one neutral copy ("this key prefix is not available"), so the form says nothing about which project holds a prefix; the probe itself stays owner item 14-o3. Team assignment and team management stay in Phase 16 (AIDA-109), because the K69 copy semantics need their own UI. The placement is owner item 15-o1. Source: FITUR-PROJECTS.md (project page settings and members; task and project actions); orchestrator, K84.
- **D-09:** Task drawer and full page (AIDA-73). Both show and edit the same fields:
  - title, key, status, priority, assignee (from `listEligibleAssignees`, `src/lib/projects/members.ts:193`), start and due dates, estimate, labels, milestone and recurrence;
  - the description: a Markdown textarea with a server-rendered preview through `renderTaskMarkdown`, with no WYSIWYG editor and no editor package;
  - subtasks one level deep (create, change status, reorder within the parent);
  - comments: add, edit own, delete under AUTHOR_OR_MANAGE;
  - attachments: upload, download and delete (D-16);
  - history from `listTaskActivity`.

  Task text is untrusted input and is rendered only through the sanitized path. Source: AIDA-73; Phase 14 D-14 and K65; orchestrator.
- **D-10:** List (AIDA-74), run decision K86:
  - Rows are grouped by status (the default), assignee, priority or milestone. Collapsed groups are kept in view state.
  - Each group has a quick-add composer that calls `createTask` with the group's value.
  - Multi-select: a checkbox per row, Shift selects a range of loaded rows, and "select all" selects the loaded rows and says so. Nothing hidden or unloaded is ever selected.
  - The bulk actions are exactly the fields of `BulkTaskPatch` (`src/lib/projects/bulk.ts:46-54`): status, assignee, priority, start date, due date, milestone, add labels and remove labels. A selection is at most `BULK_MAX` (100; `contract.ts:274`), and the bar says the change applies to every selected task or to none. The selection clears after success and stays after a refusal. TOO_MANY and NOT_FOUND have their own copy.
  - Bulk archive and bulk delete are not offered: no bulk service exists, and AIDA-74 asks for "each bulk action offered".
  - A move into DONE may create recurrence successors. The view reloads and shows them, and the copy claims nothing more.
  - E2E covers collapsing a group, quick add and each offered bulk action, and checks the result after reload.

  Source: AIDA-74; Codex area 9; orchestrator, K86.
- **D-11:** Board (AIDA-75):
  - The project Board has one column per `TASK_STATUSES` value. It shows top-level tasks only (subtasks live in the drawer), ordered by (rank, id).
  - Columns can be collapsed, and the collapsed state is kept in view state.
  - Each column has a quick-add control and its own keyset "load more".
  - A pointer drag within or across columns calls `reorderTask` (`src/lib/projects/ordering.ts:79`) with the target status and `placeAfterTaskId` (`ordering.ts:31-36`). The anchor is always a loaded neighbour, or null for the first place. A stale anchor or a refusal reloads the column and announces it.
  - `reorderTask` takes no version and locks instead, so the UI makes no conflict promise for moves (K88).
  - The keyboard alternative follows D-14. The workspace Board follows D-06.
  - E2E moves two equivalent tasks the same way, one by mouse and one by keyboard, and collapses a column. After a reload, status, order and collapse state are read back from the server.

  Source: AIDA-75; Codex area 2; orchestrator.
- **D-12:** Table (AIDA-76), run decision K88:
  - Editors by type:
    - title: text;
    - status and priority: select;
    - assignee: select from `listEligibleAssignees`;
    - start and due: a native date input with `YYYY-MM-DD` values;
    - estimate: whole minutes from 0 to `ESTIMATE_MAX_MINUTES`;
    - labels: multi-select through `setTaskLabels` (`src/lib/projects/labels.ts:281`), at most 20;
    - milestone: select through `setTaskMilestone` (`src/lib/projects/milestones.ts:428`).
  - Client checks mirror the contract (lengths, date order, number range) for early feedback, and the service decides. An invalid value is refused with the field's copy, and the stored value stays.
  - Every edit that takes `expectedVersion` sends it: `updateTask`, `setTaskDates`, `setTaskStatus`, `setTaskLabels`, `setTaskMilestone` and `setTaskRecurrence`. On CONFLICT the typed value stays, the UI says the task changed, and it offers a reload. It never overwrites.
  - Enter commits, Escape cancels, and Tab moves to the next cell. Focus stays in the grid.
  - Visible columns, grouping and sort are kept in view state, per project or for the workspace.
  - E2E shows that an edit and the column choice persist after reload and that an invalid value is rejected.

  Source: AIDA-76; Codex area 3; orchestrator, K88.
- **D-13:** Calendar (AIDA-77), run decisions K79, K80 and K87:
  - Month and week views. The week starts on Monday, and "today" comes from the server as `todayInTimeZone(DEFAULT_TIME_ZONE, now)` (`contract.ts:265`, `:676`), until AIDA-98 adds a per-user zone and week start.
  - A task appears on its due date. A task with only a start date appears on its start date. A task with neither date sits in an "Unscheduled" list beside the grid, with a "Set date" control.
  - Adding a task on a chosen day calls `createTask` with that day as the due date. At workspace level the user first picks one of the readable, non-archived projects.
  - Moving a task, by pointer drag to another day or by keyboard (D-14), shifts start and due by the same number of days in one `setTaskDates` call with `expectedVersion` (K80).
  - Previous, next and today controls are offered, and the visible range is part of the URL.
  - Dates stay `CalendarDate` strings end to end and are never converted to local time.
  - **Time-zone tests.** An E2E runs the calendar with a browser `timezoneId` far ahead of UTC and one far behind it (for example `Pacific/Kiritimati` and `Pacific/Pago_Pago`) and checks that a task stays on its calendar date and that a move stores the exact date. Unit tests of the date-math module cover month ends, 29 February, the year end and daylight-saving change days.
  - E2E: a move persists after reload, and the keyboard alternative works.

  Source: AIDA-77; Phase 14 contract section 7; Codex area 4; orchestrator, K79, K80, K87.
- **D-14:** Keyboard alternatives (run decision K85):
  - Every draggable card, row or bar has a "Move" control reachable by Tab. It opens a menu, built from the existing `dropdown-menu` and `dialog` components, with the moves that fit the view:
    - Board: "Move to <status>", "Move up", "Move down", "Move to top".
    - Calendar: "Earlier by a day", "Later by a day", "Earlier by a week", "Later by a week", and "Set date…".
    - Timeline: the Calendar moves plus "Set dates…" for either end.
  - Each item calls the same server operation as the pointer drag.
  - A polite live region announces the result. Focus returns to the moved item after the reload, Escape cancels a pointer drag, and motion follows `prefers-reduced-motion`.
  - Phase 15 adds no global shortcut and no palette command. Those belong to AIDA-86 through the existing registry (`src/lib/commands/registry.ts:109`, `src/components/command-provider.tsx:79`) and the keymap (`src/lib/keyboard/keymap.ts:41`).
  - E2E proves each keyboard alternative against the same server result as the mouse path.

  Source: Codex area 2; ROADMAP Phase 15 criterion 3; orchestrator, K85.
- **D-15:** Timeline (AIDA-78):
  - Zoom levels are day, week and month. Grouping is none, status, assignee or milestone in a project, plus project at workspace level. Zoom and grouping are kept in view state.
  - A bar spans from (start, else due) to (due, else start). A single-date task is a point marker. Tasks without dates sit in the "Unscheduled" list.
  - Moving a schedule, by dragging a bar or by keyboard, shifts both ends by the same number of days (K80).
  - One end changes through the "Set dates…" dialog. Pointer resize handles are optional (Claude's discretion); if built, they call the same `setTaskDates`.
  - Milestones from `listProjectMilestones` (`milestones.ts:114`) and `listWorkspaceMilestones` (`:180`) are read-only markers (AIDA-105).
  - Rendering uses a CSS grid with no chart or timeline package (K78), and the window bound of K87.
  - E2E checks that a zoom change, a grouping change and a schedule move (by mouse and by keyboard) each persist after reload.

  Source: AIDA-78, AIDA-105; Codex area 4; orchestrator.
- **D-16:** Files (AIDA-79), run decision K83:
  - The grid and list forms read `listProjectAttachments` (`src/lib/projects/attachments.ts:131`), with keyset paging.
  - Every download goes through the new route, which calls `getTaskAttachmentForDownload` (`attachments.ts:170`) on every request. The storage key never reaches the browser.
  - The download response is always an attachment:
    - `Content-Disposition: attachment` with an RFC 5987 `filename*` built from the cleaned stored name;
    - `X-Content-Type-Options: nosniff`;
    - `Cache-Control: private, no-store`;
    - `Content-Type`: the stored sniffed type when it is in `ALLOWED_MIME` (`src/lib/attachments/constants.ts:2-10`), else `application/octet-stream`.
  - No inline preview and no image thumbnail is served in this phase. The grid shows type icon, name, size, task key, uploader and date.
  - Missing, unreadable, moved-away and revoked attachments get byte-identical 404 responses. A session without an organization member row gets one fixed 403 that names no object. A test compares the responses.
  - Uploads go through `POST /api/projects/tasks/[taskId]/attachments`, which calls `uploadTaskAttachments` (`attachments.ts:219`). It is a route handler, not a server action, because `MAX_BYTES` is 10 MB (`constants.ts:1`) and `next.config` sets no server-action body limit (the Next default is 1 MB, *unverified* for Next 16; the researcher checks).
  - The routes stay behind the session check: `PUBLIC_PREFIXES` and `BLOCKED_PUBLIC_ROUTES` (`src/proxy.ts:4`, `:30`) are not changed.

  Source: AIDA-79; Codex area 7; orchestrator, K83; charter rule 4.

### Saved views and view state

- **D-17:** Saved views (AIDA-80) use the Phase 11 `SavedView` model (`prisma/schema.prisma:667-684`), as the acceptance requires. Run decision K81 (charter rule 4).

  Schema:
  - New column `scope`: an enum with `INBOX` (the default) and `PROJECT`.
  - New column `projectId`: nullable, with a composite relation `(organizationId, projectId)` to `Project (organizationId, id)`, `onDelete: Restrict, onUpdate: Restrict`.
  - CHECKs: `scope = 'INBOX'` exactly when `projectId` is null, and `scope = 'PROJECT'` implies `visibility = 'PRIVATE'`.
  - Name uniqueness: the partial indexes `SavedView_private_name_key` and `SavedView_shared_name_key` (`prisma/migrations/20261108140000_inbox/migration.sql:77-83`) gain `AND "scope" = 'INBOX'`. A new partial unique index covers `(organizationId, ownerUserId, projectId, lower(name)) WHERE scope = 'PROJECT'`.
  - Existing rows become `INBOX`. A migration test on populated data proves every inbox view is unchanged.

  Services:
  - The inbox service (`src/lib/saved-views/service.ts`) adds `scope: "INBOX"` to every read and write. The sidebar, strip and palette lists (`listSavedViewsForViewer`, `:306`; `src/app/(app)/layout.tsx:44`) stay exactly as today while project views exist. A test proves it.
  - Project views get their own operations in `src/lib/projects/`: list, create, rename, update, delete and open. They read membership with `findConservativeMembership` (K59), never the older single-row read the inbox service uses (`service.ts:33`, `:115`), and need READ on the project in the same statement.
  - Only the owner lists, opens, renames, updates or deletes a project view. To anyone else its id is NOT_FOUND, like a missing id.
  - Project views are allowed on an archived project (a preference, like favorites) and write no activity.

  Payload, fail-closed:
  - The payload is a versioned strict schema: `{ version: 1, view, filters, grouping, sort, columns, collapsed, zoom }`.
  - Unknown keys are refused, and the serialized payload is at most 4096 bytes; a CHECK repeats the size limit.
  - A view with an unknown version cannot be opened. It shows its name and a delete control, and nothing is applied.
  - A label, milestone or assignee reference that is no longer valid stays in the filter and matches nothing, with a visible notice. A view never widens its result.

  Shared project views are not built: AIDA-80 says "stored per user". E2E checks that a saved project view persists after reload and that another user of the same organization does not see it.

  Source: AIDA-80; ROADMAP cross-phase risks (the SEED-005 model, AIDA-47 and AIDA-49 closed); Codex area 5; orchestrator, K81; charter rule 4.
- **D-18:** View state (run decision K82). A new organization-scoped model, named by the planner (for example `TaskViewState`), stores the unnamed per-user settings that must survive a reload: collapsed groups and columns, visible columns, grouping, sort, zoom and the project-list form.
  - Columns: `organizationId`, `userId`, `projectId` (null for the workspace pages and the project list), `viewKind` (LIST, BOARD, TABLE, CALENDAR, TIMELINE, FILES, PROJECT_LIST), `state` (the strict versioned schema family of D-17, at most 4096 bytes) and `updatedAt`.
  - Uniqueness: one row per `(organizationId, userId, projectId, viewKind)`, through a hand-written `UNIQUE NULLS NOT DISTINCT` index (PostgreSQL 16), recorded in the migration header and above the model.
  - A composite relation to Project (Restrict), and the model is appended to `DOMAIN_MODELS`.
  - Reads and writes need READ on the project (allowed when archived) or MEMBER for the workspace. Writes use an upsert with `ON CONFLICT` and write no activity.
  - Isolation tests follow contract section 17.

  Browser storage and URL-only state are not used for these settings: they are neither per user nor stable across navigation. Source: Codex areas 3 and 4 (keep column choice, grouping and zoom per user and project); orchestrator, K82; charter rule 4.
- **D-19:** Delete (run decision K90). `deleteProject` also deletes the project's saved views and view-state rows in its transaction, after its locks and before the Project row (`src/lib/projects/delete.ts:254-256`). It writes no activity for them. This amends `14-CONTRACT.md` section 12 step 5 under the section 0 rule, with a race test against a concurrent view save in both orders. Source: orchestrator, K90.

### Plan shape, design and limits

- **D-20:** No new package in this phase (run decision K78):
  - Drag uses Pointer Events.
  - Date math runs on `CalendarDate` strings with UTC arithmetic and the contract helpers.
  - Grids and tables are CSS.
  - The drawer, tabs, menus and dialogs come from the installed `radix-ui` package (`package.json:51`) and `src/components/ui/`.
  - Icons are `lucide-react` (`package.json:41`).

  If a plan finds an own implementation inadequate, it stops and reports. A package then needs a recorded run decision that meets the charter: exact version; MIT, Apache-2.0, BSD or ISC licence; no new critical or high audit finding; reason recorded; never AGPL or GPL. Source: charter "Aturan teknis AIDA"; Codex area 2 (evaluate before choosing); orchestrator, K78.
- **D-21:** Design (`.planning/DESIGN-SYSTEM.md`, run decision K89):
  - Use tokens only, explicit `text-[Npx]` sizes, the sticky blurred top bar (section 4.2), the empty state with halo and icon box (section 4.3, `src/components/empty-state.tsx`), `sidebar-*` tokens and Lucide icons.
  - Project and label colour keys (`PROJECT_COLORS`, `contract.ts:158`) map to the existing state palette tokens through one mapping module, in the style of `src/lib/tickets/state-colors.ts:7`, `:32`. `violet` maps to `--state-purple`. Colour is never the only signal.
  - A new token is added only when the UI-SPEC shows one is needed. It then goes into `src/app/globals.css` in both themes and into `tests/unit/design-tokens.test.ts`.
  - Screen states:
    - loading: `src/components/ui/skeleton.tsx`;
    - empty: section 4.3;
    - error: a route error boundary, as in `src/app/(app)/tickets/error.tsx`;
    - access lost while a view is open: the not-available copy and a reload control;
    - narrow screens: the Board and Timeline scroll inside their own region, never the page.
  - Dark mode comes from tokens. The contrast E2E (`tests/e2e/a11y-contrast.spec.ts`) is extended to the new pages in both themes.

  Source: DESIGN-SYSTEM sections 2 to 9; FITUR "Keadaan layar"; orchestrator, K89.
- **D-22:** No AI, no new egress, no new public route and no inline script (the nonce CSP risk in the ROADMAP cross-phase table). Source: orchestrator.
- **D-23:** Order and freeze (Codex area 8):
  - `/gsd-ui-phase 15` runs before planning. The UI-SPEC fixes states, focus, keyboard, live-region text, responsive behaviour and dark mode for every view.
  - The first plan freezes, as a contract amendment: the route and refusal matrix; the operations of D-05, D-17 and D-18; the delete change of D-19; the date semantics of D-13, D-15 and K80; and the payload schemas.
  - Suggested split, which the planner may reshape but never shrink:
    1. contract amendment;
    2. one migration (SavedView scope, view-state model) with `scopedDb` registration and the parity test;
    3. project-list query extensions;
    4. task-read extensions;
    5. saved-view and view-state services, and the inbox scope filter;
    6. the shared UI kit: action layer, outcome map, colour map, date math, drag primitive, live region;
    7. the project list and the supporting project surfaces;
    8. the project detail shell, Overview, Activity, the task drawer and full page, and task actions;
    9. List and bulk;
    10. Board;
    11. Table;
    12. Calendar;
    13. Timeline;
    14. Files and the two routes;
    15. the workspace pages and the sidebar;
    16. the saved-views UI;
    17. the phase gate with the evidence per requirement and criterion.
  - Schema and contract changes each live in one plan, so parallel plans do not collide.

  Source: Codex area 8; orchestrator.

### Run decisions taken in this CONTEXT

| K | Decision | Reason |
|---|---|---|
| K74 | Canonical task URL `/tasks/[taskId]`; tabs as URL segments; one not-available state | The id survives a move, and the route adds no key probe (14-o3). |
| K75 | Phase 15 code calls only the Phase 14 and saved-view services; a unit test forbids database imports | One authorization point (K73). |
| K76 | Service gaps closed as contract amendments, with the predicate in every statement and server-side filter, sort and group | Partial pages mislead, and K73 needs the predicate per query. |
| K77 | The workspace Board changes status only; no stored order across projects | Rank is per (project, status). |
| K78 | No new package in Phase 15 | Charter package rule; smallest surface. |
| K79 | Calendar dates stay strings; "today" in UTC on the server; weeks start Monday until AIDA-98 | Phase 14 contract section 7. |
| K80 | Calendar and Timeline moves shift start and due by the same days in one versioned call | Keeps the duration and never creates start after due. |
| K81 | Saved views extend `SavedView` with `scope` and `projectId`; project views are private only, scope-aware unique names, strict versioned payload, fail closed | AIDA-80 acceptance; charter rule 4 for schema and privacy. |
| K82 | Unnamed view settings in a new per-user, org-scoped view-state model | Per-user persistence across reloads without browser storage. |
| K83 | Files without inline preview; downloads and uploads through authenticated route handlers that call the Phase 14 services per request, with fixed safe headers | The ticket route checks only the organization and sends no `nosniff` (`src/app/api/attachments/[id]/route.ts:22`, `:29-35`). |
| K84 | Supporting project and task surfaces over existing operations; team UI stays in Phase 16 | The views are unusable without them (owner item 15-o1). |
| K85 | Keyboard alternatives as explicit Move menus calling the same operations; no global shortcuts | Proven equivalence; AIDA-86 owns shortcuts. |
| K86 | Bulk actions are exactly `BulkTaskPatch`, at most 100 loaded rows, all or nothing | Atomic service contract; no new bulk service. |
| K87 | Calendar and Timeline load the whole window from the server up to a bound of at most 1000 tasks, else an explicit "narrow the filter" state | No silently partial grid. |
| K88 | Versioned edits send `expectedVersion`; CONFLICT keeps the input and offers reload; UNKNOWN disables risky controls until reload; no conflict promise for reorder and bulk | Codex areas 1, 3 and 9. |
| K89 | Project colours map to the existing state palette tokens; `violet` maps to `--state-purple` | Token-only rule. |
| K90 | `deleteProject` deletes the project's saved views and view-state rows before the Project row | The Restrict relations would otherwise block the delete. |

### Claude's Discretion

- Component and file layout, and the exact names of new operations, models, columns and enums.
- Editor widgets inside the rules of D-12.
- Zoom column widths, the page size within `LIST_MAX`, and the window bound up to 1000 tasks.
- Optional pointer resize handles in the Timeline (D-15).
- The place of the quick-add composer in a group.
- All UI copy, written fresh (clean-room), within the UI-SPEC.

All of these stay inside D-01 to D-23.

</decisions>

<specifics>
## Specific Ideas

### Points the researcher must verify (none is decided by guessing)

1. Next 16 parallel and intercepting routes for the drawer (D-02): back and forward, reload, focus return. *Unverified*; check current docs through Context7.
2. That Playwright `page.mouse` drives Pointer Events in Chromium for the drag primitive, and how a drag is aborted with Escape.
3. That a native `<input type="date">` yields `YYYY-MM-DD` in every browser locale and `timezoneId` that the E2E uses.
4. Whether Prisma `contains` with `mode: "insensitive"` escapes `%` and `_` on PostgreSQL. If not, the service escapes them itself. *Unverified.*
5. The server-action body size default in Next 16 (D-16). *Unverified.*
6. That `UNIQUE NULLS NOT DISTINCT` and the partial indexes of D-17 and D-18 survive `prisma migrate dev --create-only` only when written by hand. Record them in the migration header and above the model, like the existing `SavedView` partial indexes.

### Precedents

- **Not to follow:** the ticket attachment download looks up by organization only (`db.attachment.findFirst({ where: { id } })`, `src/app/api/attachments/[id]/route.ts:22`) and sends no `nosniff` (`:29-35`). Task files use D-16.
- **Not to follow:** the inbox saved-view service reads membership with `findActiveMembership` (`src/lib/saved-views/service.ts:115`). New project-view paths use `findConservativeMembership` (K59).
- **Follow:** the action pattern of `src/app/(app)/kb/proposals/actions.ts` (D-03), the bulk bar of `src/app/(app)/tickets/bulk-action-bar.tsx` and `bulk-actions.ts`, and the saved-view actions of `src/app/(app)/tickets/saved-view-actions.ts`.
- **Follow:** the upload precedent in `src/app/api/tickets/[id]/messages/route.ts`, which validates every file before storing any (`:71-74`). Phase 14's shared validator is `src/lib/attachments/validate-upload.ts`, used by `uploadTaskAttachments`.

### Edge cases to cover in plans and tests

- Recurring task moved into DONE by drag, by keyboard or in bulk creates one successor. The view reloads; the copy says nothing beyond the data.
- A drag anchor that was moved or deleted meanwhile; a task moved to another project while its drawer is open; access revoked while a view is open.
- A click after UNKNOWN must not double an effect (K88).
- Archived projects are read-only except restore, delete and favorites (contract section 10). Controls reflect ARCHIVED, and a subtask of an archived parent counts as archived.
- Subtasks stay one level (SUBTASK_DEPTH). A subtask cannot be moved alone (SUBTASK_MOVE).
- Calendar and Timeline across month and year ends, 29 February, and daylight-saving change days in both test time zones.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/REQUIREMENTS.md`: AIDA-72 to AIDA-80 and AIDA-106 (acceptance text). For boundaries: AIDA-47, AIDA-49, AIDA-82, AIDA-86, AIDA-98, AIDA-103, AIDA-104, AIDA-105, AIDA-108, AIDA-109.
- `.planning/ROADMAP.md`: Phase 15 (success criteria 1 to 6), the Gates section, and the cross-phase risks (the AIDA-80 saved-view row and the nonce CSP row).
- `.planning/run-loop/FITUR-PROJECTS.md`: the only allowed feature source (clean-room).

### Binding rules
- `.planning/run-loop/PIAGAM.md`: sections "Clean-room modul Projects", "Aturan owner 2026-11-08" (A to H), "Aturan teknis AIDA", "Test dan bukti", "Larangan" and "Aturan eksekutor".
- `.planning/DESIGN-SYSTEM.md`: sections 2 to 9, including the section 9 checklist.
- `.planning/run-loop/ANTREAN.md`: owner items 14-o1, 14-o2, 14-o3, 12.2-o4, and 15-o1 once the orchestrator records it.

### Decisions this phase builds on
- `.planning/run-loop/codex/fase15-tanya.md` and `.planning/run-loop/codex/fase15-jawab.md`: this phase's brainstorm.
- `.planning/phases/14-projects-foundation/14-CONTRACT.md`: section 0 (amendment rule), 1 (operation table), 2 (access, list predicate, every read), 5 (activity and redaction), 7 (dates), 8 (ordering, K71), 10 (archive and favorites), 12 (delete), 14 (refusal codes, version), 15 (sets and bounds) and 17 (test protocol).
- `.planning/phases/14-projects-foundation/14-CONTEXT.md`: D-04, D-10, D-14 and the K69 amendment.
- `.planning/phases/14-projects-foundation/14-REVIEW.md`: K71, K72 and K73.
- `.planning/phases/11-inbox/11-CONTEXT.md`: saved views (D-03 to D-05) and the palette registry.
- `.planning/phases/12.2-ticket-lifecycle-knowledge-from-resolved-work/12.2-CONTEXT.md`: typed refusals and the action outcome pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 14 services** (`src/lib/projects/`):
  - Projects: `listProjects` (`projects.ts:640`), `getProject` (`:275`), `createProject` (`:179`), `updateProject` (`:398`).
  - Tasks: `getTask` (`tasks.ts:424`), `createTask` (`:282`), `updateTask` (`:656`), `setTaskDates` (`:718`), `setTaskStatus` (`:834`), `listProjectTasks` (`:1133`), `listWorkspaceTasks` (`:1195`).
  - Ordering and bulk: `reorderTask` (`ordering.ts:79`), `bulkUpdateTasks` (`bulk.ts:185`).
  - Attachments: `listProjectAttachments` (`attachments.ts:131`), `getTaskAttachmentForDownload` (`:170`), `uploadTaskAttachments` (`:219`).
  - Milestones: `listProjectMilestones` (`milestones.ts:114`), `listWorkspaceMilestones` (`:180`), `setTaskMilestone` (`:428`).
  - Labels and members: `setTaskLabels` (`labels.ts:281`), `listProjectMembers` (`members.ts:148`), `listEligibleAssignees` (`:193`).
  - Progress and activity: `getProjectProgress` and `getProjectsProgress` (`progress.ts:56`, `:73`), `listProjectActivity` and `listTaskActivity` (`activity.ts:358`, `:394`).
  - Favorites and archive: `favorites.ts:38-175` and `archive.ts:79-195`.
- **Contract module** (`src/lib/projects/contract.ts`): `PROJECT_OPERATIONS` (`:395`), `PROJECT_COLORS` (`:158`), `DEFAULT_TIME_ZONE` (`:265`), `BULK_MAX` (`:274`), `LIST_MAX` (`:278`), `todayInTimeZone` (`:676`), and the `CalendarDate` helpers (contract section 7).
- **Read machinery**: `readableProjectWhere` (`access.ts:386`), `runProjectRead` (`service.ts:226`), the `afterReadCheck` test seam (`service.ts:90`), and the race helpers `tests/support/project-read-race.ts`, `tests/support/project-race.ts` and `tests/support/lock-wait.ts`.
- **Test fixtures**: `tests/support/project-fixtures.ts` (the privacy world of contract section 17); `tests/support/project-hard-delete.ts`; E2E helpers in `tests/e2e/support/` (`fixtures.ts`, `db.ts`, `test-env.ts`). Playwright runs one worker (`playwright.config.ts:8`).
- **Action pattern**: `src/app/(app)/kb/proposals/actions.ts` (`:1-22`, `:43`, `:51`, `:60`), `ACTION_UNKNOWN_CODE` (`src/lib/kb/proposal-outcome.ts:50`) and `resolveActionOutcome` (`:216`).
- **Saved views**: `src/lib/saved-views/service.ts` (rules `:1-30`, `listSavedViewsForViewer` `:306`), `src/lib/saved-views/ui-state.ts`, `src/app/(app)/tickets/saved-view-actions.ts`, the sidebar wiring in `src/app/(app)/layout.tsx:44`, `:49`, and `tests/e2e/saved-views.spec.ts`.
- **UI kit**: `src/components/ui/` (avatar, badge, button, card, checkbox, command, dialog, dropdown-menu, form, input, label, popover, select, separator, skeleton, sonner, switch, textarea; there is no sheet, tabs or table component yet, and `radix-ui` provides the primitives), `src/components/empty-state.tsx`, `src/components/top-bar.tsx` and `src/components/sidebar.tsx`.
- **Markdown**: `renderTaskMarkdown` (`src/lib/markdown/render.ts:204`): no images, live safe links (K65).
- **Colour mapping precedent**: `src/lib/tickets/state-colors.ts` (`STATE_COLOR_KEYS` `:7`, `STATE_COLORS` `:32`).

### Established Patterns
- Services return `{ ok: true, ... }` or `{ ok: false, code, field? }` and rethrow anything else (contract section 14). Actions add only UNKNOWN.
- Every list is keyset-paged with `hasMore` and `nextCursor`. A limit above the maximum is INVALID_INPUT, never clamped (contract section 15).
- Raw SQL and `findUnique`-style calls always write the organization term (Phase 14 D-01).
- Migrations come from `prisma migrate dev --create-only` in a scratch database inside `aida-dev-db`, with every hand edit recorded in the header. Never `prisma db push`. The newest migration is `prisma/migrations/20261113100000_projects_foundation`.
- Modules read by both app and worker use relative imports only.

### Integration Points
- `src/components/sidebar.tsx:24-28`: the new "Projects" and "Tasks" entries.
- `src/app/(app)/`: new route groups `projects`, `tasks` and `workspace`.
- `src/app/api/projects/`: the download and upload routes (D-16).
- `prisma/schema.prisma` (`SavedView` at `:667`) and a new migration; `src/lib/scoped-db.ts` `DOMAIN_MODELS` for the view-state model.
- `src/lib/projects/delete.ts:254-256` (D-19), `src/lib/projects/contract.ts`, and `14-CONTRACT.md` (amendments).
- `tests/unit/project-operation-inventory.test.ts` and `tests/unit/project-contract.test.ts` for the new operations.

</code_context>

<deferred>
## Deferred Ideas

- Shared (team-wide) project saved views, and saved views at workspace level.
- Team assignment to projects and team management UI (AIDA-109, Phase 16).
- A sidebar list of projects and reordering projects by hand (`moveProjectPosition`) in the UI.
- Inline previews and image thumbnails for attachments.
- Global shortcuts, palette commands and context menus for Projects (AIDA-86, Phase 16).
- Per-user time zone, week start, date format, default project view and how a task opens (AIDA-98, Phase 16).
- Bulk archive and bulk delete.
- A stored order inside workspace Board columns.
- Touch-specific drag behaviour beyond Pointer Events, and list virtualization.
- Favorites and archive pages (AIDA-108, Phase 16).

</deferred>

## Owner items (not decided here)

### 15-o1: where the UI of AIDA-103, AIDA-104 and project settings lives

- **Status:** `menunggu owner` (the orchestrator records it in `ANTREAN.md`).
- **Question:** Phase 14 closed AIDA-103 and AIDA-104 as logic, and no later phase lists their UI. `FITUR-PROJECTS.md` places project settings and members on the project page. Should Phase 15 build these surfaces (create and edit project, direct members, labels and milestones, the task and project actions with their confirmations), or should they wait for a phase the owner names?
- **Default applied:** Phase 15 builds them as UI over existing operations (D-08, K84). No text in `REQUIREMENTS.md` or `PROJECT.md` changes. Team assignment and team management stay in Phase 16.
- **Blocks:** nothing in the build. The owner may later move or remove these surfaces.

### Related open owner items (unchanged; Phase 15 follows their defaults)

- **14-o1:** organization owners and admins do not see private projects, and teams grant no live access (K62, K69). The workspace pages follow this.
- **14-o2:** the delete record in `ProjectActivity`. The Activity tab shows what the feed returns and claims nothing about audit.
- **14-o3:** the prefix reservation probe and old keys. Phase 15 adds no key routing (K74), and the prefix copy is neutral (D-08). The probe itself stays open.
- **12.2-o4:** no unique key on `member (organizationId, userId)`, hence the conservative membership read.
- **O-1:** container and compose-stack tests on the shared Docker VM. `pnpm test:egress` stays blocked (K26).
- **O-3:** unparking Phases 8, 9 and 10. AIDA-43 stays open.

The orchestrator decided the other choices Codex left open (route shape, drag implementation, dates, view-state storage, file previews) in this CONTEXT as K74 to K90. No other owner item was opened.

## Human boundary

The charter's phase table lists no human item for Phase 15. As a UI phase, these stay manual items for a human, open and never claimed:

- the visual pass of every new page, in light and dark mode;
- dark-mode approval by eye;
- screen-reader checks of the drawer, the Move menus, the live-region announcements, the Table grid and the Calendar;
- the visual items of the DESIGN-SYSTEM section 9 checklist, including "Dark mode diuji?";
- the look at narrow widths, and how touch drag feels.

Tests prove only what they can: tokens, typography classes, contrast in both themes, keyboard paths and `tsc --noEmit`. Open for the owner: 15-o1, plus the related items above.

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks or any other checkpoint. Write every human check as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. `/gsd-ui-phase 15` runs before planning, and the plans follow its UI-SPEC. Every executor dispatch includes the charter's "Aturan eksekutor" section.

Binding for this phase:

- **Tests.**
  - Integration tests run against a real Postgres through Testcontainers, with no mocks for isolation. They use the privacy world of contract section 17: two organizations and the manager, member, teamMember, nonMember, orgAdmin and outsider actors.
  - Every new or extended operation gets an isolation block of the section 17 shape. Every workspace read and project-list search, filter and sort gets the two-worlds comparison of D-06.
  - Races are bound to backend PIDs (`waitForBlockedBy`), never to a sleep. Time-dependent tests pass `opts.now`.
  - Testcontainers needs the Colima socket environment that the orchestrator supplies.
- **E2E.**
  - Every keyboard alternative is proven: Board move, Calendar move, Timeline move and every Move menu item each run once by mouse and once by keyboard, with the server state checked after a reload.
  - Collapse, column choice, grouping, zoom and saved views are each checked after a reload.
  - The time-zone runs of D-13 and the privacy run of D-06 are required.
  - A 404 on the first hit of a route during E2E usually means the router has not compiled yet. Use `expect.poll`; never loosen the product.
- **Migrations.**
  - Generate with `prisma migrate dev --create-only` against a scratch database inside the `aida-dev-db` container (`127.0.0.1:55432`, same image as service `db`), with `DATABASE_URL` given on the command line. Then run `prisma migrate deploy`, and drop the scratch database afterwards.
  - Never `prisma db push`.
  - Keep every hand-written SQL object (the `SavedView` partial indexes, `searchVector`, the Phase 14 triggers and CHECKs). Remove any generated drop of one, and record the edits in the migration header.
  - An applied migration is final; a fix is a new migration.
- **Hard limits.**
  - No `rm -rf`. No `.env` change.
  - No new package (K78) unless a recorded run decision meets the charter rules.
  - Never name the reference product outside `.planning/`. Run the clean-room grep at the end of the phase.
  - No AI, no new egress, no new public route, no inline script (D-22). No paid API, no real email, no real credentials.
- **Process.**
  - One test process at a time. Long commands write to a log, and exit codes are read without a pipe.
  - Acceptance criteria point at the file where the code actually lives, and never contradict the plan's own action.
  - No edit after a review without a new review of that edit.
  - The phase gate runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:egress` (blocked under O-1, recorded as blocked), `pnpm test:e2e`, `pnpm build` and `pnpm audit --prod`, plus the clean-room grep and the automatable section 9 items.
- **Requirements and repo.**
  - A requirement is closed only on acceptance and evidence.
  - `RUN-LOG.md`, `LAPORAN.md`, `ANTREAN.md` and `REQUIREMENTS.md` belong to the orchestrator. Do not run `requirements mark-complete`.
  - Stage your own paths only, never `git add .`.

## Owner rules of 2026-11-08 (binding, summary)

- **D:** all code is written by Claude (Opus 5.5); Codex reviews only. GSD agents inherit the session model (`model_profile: inherit`); no `model` parameter on dispatch.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout. Temporary exports are deleted only by the round that made them.
- **E:** the reference repository for project management is, according to the owner (2026-11-08), without a licence and not the owner's. Only the "no licence" branch applies: clean-room only. Its licence is not re-checked, and the repository is not opened or fetched.
- **F:** owner-only decisions (licences, feature scope, anything that changes `PROJECT.md` or `REQUIREMENTS.md`) are not chosen here. They are recorded in `ANTREAN.md` as `menunggu owner`, with question, options and what they block, and treated as parked. Updating traceability status from acceptance and evidence is not an owner decision.
- **G:** no push.
- **A, B and H:** disk and Docker health are checked every round. Docker is never stopped, restarted or deleted. Leftover Testcontainers containers of the round itself are removed at its end, and nothing of other projects is touched.

## Larangan dari piagam (verbatim, binding)

- Dilarang `git push`, `gh pr`, `gh release`, `gh workflow run`, dan apa pun yang memindahkan commit ke remote. Jangan melepas kunci `pushurl`.
- Dilarang commit ke `master`, `git merge`, `git rebase`, `git reset --hard`, `git clean`, `git stash`, `git tag`, dan `--no-verify`.
- Dilarang menyentuh `~/Public/aff/recruitment` dan project lain.
- Dilarang menghentikan, menghapus, atau mengubah container dan volume selain milik project `aida` dan `aida-dev-db`. Dilarang `docker system prune` dan `docker volume prune`.
- Dilarang memanggil API LLM berbayar sungguhan, mengirim email nyata, dan memakai kredensial asli. Test memakai fake dan server tiruan.
- Dilarang menaruh API key di `.env` dan mengubah aturan izin Claude Code.
- Dilarang `--auto` dan `--chain`, dan dilarang menyalakan `workflow.auto_advance`.
- Dilarang `/gsd-autonomous`, `/gsd-discuss-phase`, `/gsd-new-milestone`, `/gsd-verify-work`, `/gsd-audit-milestone`, `/gsd-complete-milestone`, `/gsd-cleanup`, `/gsd-ship`, dan `/gsd-update`.
- Dilarang `/gsd-review`, `/gsd-plan-review-convergence`, `--codex`, `--all`, `--converge`, dan `--cross-ai`. Jalur itu menjalankan reviewer di repo asli, bukan di ekspor.
- Dilarang mengisi hasil UAT, visual pass, atau penilaian manusia rekaan. Kosong tetap kosong.
- Dilarang menulis backslash ke `last_activity_desc` di `STATE.md`.

---

*Phase: 15-work-views*
*Context gathered: 2026-11-10*
