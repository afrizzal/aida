# Phase 15: Work Views - Plan Outline

**Written:** 2026-11-10 by gsd-planner, chunked mode (outline only), unattended run under `run-loop/PIAGAM.md`.
**Inputs:** `15-CONTEXT.md` (D-01 to D-23, K74 to K90, 15-o1), `15-UI-SPEC.md` (approved; P1 to P4), `15-PATTERNS.md` (C1 to C13), `14-CONTRACT.md`, code at `54a433a`.
**Shape:** 25 plans in 9 waves. D-23's 17-item split is reshaped and grown, never shrunk (mapping at the end of `## Plans`). Every plan is `autonomous: true`, has no checkpoint task, leads with a tracer task (TRACER_MODE), and lists its human checks under `## Manual items (left open)`.
**Reading rule for each single-plan planner:** this outline plus the shared planning context bind you. Where this outline fixes a name, path, signature, owner or semantic, use it exactly; where it is silent, decide inside 15-CONTEXT and record the reason in your plan.

## Plans

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|-----------|-------------|
| 15-01 | Freeze the Phase 15 contract amendment (D-23) in one commit: `14-CONTRACT.md` section 18 (route and refusal matrix, the 12 new and 9 extended operations, access level VIEW_OWNER, isolation class ORG, the date semantics of D-13, D-15 and K80, the payload and view-state schemas, the K90 delete step, the registration staging rule) together with the matching sets, constants and the frozen `PHASE_15_OPERATIONS` record in `contract.ts`. Also writes the strict validators in `src/lib/projects/view-payload.ts`, makes `project-contract` and `project-operation-inventory` registration-aware, and adds the unit tests `project-view-payload.test.ts` and the D-04 `project-import-boundary.test.ts`. | 1 | none | AIDA-72, AIDA-73, AIDA-74, AIDA-75, AIDA-76, AIDA-77, AIDA-78, AIDA-79, AIDA-80, AIDA-106 |
| 15-02 | One migration `20261114100000_work_views`: SavedView gains `scope` (INBOX default) and `projectId` with the composite Restrict relation, the scope and privacy CHECKs, the project payload size CHECK and scope-aware partial name indexes; new model `ProjectViewState` with the hand-written UNIQUE NULLS NOT DISTINCT index and size CHECK; DOMAIN_MODELS, schema parity and the `projectTableSnapshot` extension. Adds `scope: "INBOX"` at the six inbox call sites (C5), proven by the schema, populated-migration and `saved-views-scope` integration tests. | 2 | 15-01 | AIDA-80, AIDA-72, AIDA-74, AIDA-75, AIDA-76, AIDA-78, AIDA-106 |
| 15-03 | Project and people reads: `listProjects` gains `q`, `statuses`, `sort` and per-item `isFavorite` and `canManage` with the id-only cursor (C8, C9, K71); `getProject` gains `isFavorite`; `listProjectMembers` items gain `email`; new `listAddableProjectMembers` (C1, P1) and `resolvePeopleNames`, registered in PROJECT_OPERATIONS. Integration tests: behaviour, isolation blocks, the D-06 two-worlds comparison for every project-list search, filter and sort (new `tests/support/project-two-worlds.ts`), and PID-bound races. | 2 | 15-01 | AIDA-72, AIDA-73 |
| 15-04 | Project task reads in a new `src/lib/projects/task-query.ts`: `listProjectTasks` gains the array filters, the six task sorts with tagged cursors, the one-group page, server group counts, the date window with the 1000-task bound and the unscheduled read; list items gain labels, milestone and estimate; `getTask` gains `isFavorite`; `listProjectMilestones` gains `from` and `to`. Integration behaviour, isolation and PID-bound race tests (K73, K76, K87). | 2 | 15-01 | AIDA-73, AIDA-74, AIDA-75, AIDA-76, AIDA-77, AIDA-78 |
| 15-05 | UI kit A: `ui-copy.ts` (the whole Copywriting Contract), `outcome.ts` (every refusal code plus UNKNOWN, K88), `colors.ts` (K89), the server-action helper `src/lib/project-ui/action-support.ts` (D-03), `src/components/ui/sheet.tsx`, the chips, project icon map and picker, colour swatches, outcome callout, not-available state and `TaskLink`. Unit tests for copy, outcome and colours, plus the shared E2E seed helper `tests/e2e/support/projects.ts`. | 2 | 15-01 | AIDA-72, AIDA-73 |
| 15-06 | UI kit B: `calendar-date.ts` (CalendarDate math, Monday weeks, span, placement, shift of both ends, UTC display formatting; K79, K80) and `move-anchors.ts` (Board and subtask anchors and disabled reasons; P4, C4). Also the Pointer Events `drag-layer.tsx` with Escape cancel and reduced motion, `move-menu.tsx` (K85) and `view-announcer.tsx`, with unit tests for date math (month ends, 29 February, year end, daylight-saving days) and for anchors. | 2 | 15-01 | AIDA-75, AIDA-77, AIDA-78 |
| 15-07 | Workspace reads: `listWorkspaceTasks` gains `projectIds`, the array filters, the sorts (dueDate then key then id, K77), group counts by status, project, assignee and priority, the window and unscheduled reads, and project info on each row; `listWorkspaceMilestones` gains `from`, `to` and `projectIds`. Integration behaviour and isolation tests, the D-06 two-worlds comparison for every workspace read (complete page sequences, cursors, hasMore, group counts), and PID-bound races. | 3 | 15-03, 15-04 | AIDA-106, AIDA-77, AIDA-78 |
| 15-08 | Project view services: `src/lib/projects/saved-views.ts` (list, open, create, rename, update, delete; owner-only, fail-closed payload, stale references; K81) and `src/lib/projects/view-state.ts` (project and workspace get and save with the ON CONFLICT upsert; K82), registered in PROJECT_OPERATIONS. `deleteProject` removes the project's view rows before the Project row (D-19, K90, C12). Integration behaviour, isolation and race tests, including the delete against a concurrent view save in both orders. | 3 | 15-02, 15-03 | AIDA-80, AIDA-72, AIDA-74, AIDA-75, AIDA-76, AIDA-78, AIDA-79, AIDA-106 |
| 15-09 | Project detail shell `/projects/[projectId]`: header, tab nav with all eight tabs, archived notice, not-available, loading and error states. Builds the Overview tab (description, progress, details, members, upcoming milestones) and the Activity tab with redacted rows, plus header favorite, archive and restore, Copy link and the base actions menu. E2E `projects-detail.spec.ts` covers overview and progress, favorite and archive from the detail page, activity, and the identical not-available state. | 3 | 15-03, 15-04, 15-05 | AIDA-72 |
| 15-10 | Project list `/projects`: grid, list and table forms (PROJECT_LIST view state), search, status filter, archive scope, sort, load more, and favorite, archive and restore per card or row. Also the Create project dialog, both sidebar entries with explicit match prefixes (C11) and the top-bar titles. E2E `projects-list.spec.ts` covers the three forms with a reload, search, filter, sort, and favorite and archive from the list. | 4 | 15-03, 15-05, 15-08 | AIDA-72 |
| 15-11 | Project settings dialogs over existing operations (D-08, K84, 15-o1 interim): Edit project (ordered calls with the partial-save callout), Members (with `listAddableProjectMembers`), Labels, Milestones, Duplicate, and Delete with the typed name. They are wired into the header, the actions menu and the Overview manage buttons, with manager-only and archived disabled reasons. E2E `projects-settings.spec.ts` checks each dialog's write after a reload, LAST_MANAGER and the neutral prefix copy. | 5 | 15-03, 15-05, 15-06, 15-09, 15-10 | AIDA-72 |
| 15-12 | Shared view frame and the List view: `src/lib/projects/view-query.ts` (URL parsing; the effective config of URL, view state and the `?saved=` payload with the fail-closed notices), the view toolbar (filter, group, sort, columns, chips), group header, quick add, `view-actions.ts`, and `/projects/[projectId]/list` with server group counts, persisted collapsible groups and per-group load more. Unit tests for view-query; E2E `projects-task-list.spec.ts` checks collapse and grouping after a reload, and quick add. | 4 | 15-04, 15-05, 15-06, 15-08, 15-09 | AIDA-74 |
| 15-13 | List multi-select and bulk bar (D-10, K86): row selection with a Shift range over loaded rows, select all loaded, and the eight BulkTaskPatch pickers through `bulkUpdateTasks` within BULK_MAX, with the all-or-none line and the refusal and UNKNOWN states. E2E `projects-task-list-bulk.spec.ts` runs each offered bulk action and checks the result after a reload. | 5 | 15-12 | AIDA-74 |
| 15-14 | Board `/projects/[projectId]/board`: status columns ordered by (rank, id), per-column load more and quick add, persisted collapse, pointer drag through `reorderTask` with loaded anchors, the Move menu (Move to status, up, down, to top) and the live region. Also exports scope-neutral column and card blocks for the workspace Board. E2E `projects-board.spec.ts` runs each move by mouse and by keyboard, Escape cancel and collapse, and checks server state after a reload. | 5 | 15-06, 15-12 | AIDA-75 |
| 15-15 | Table `/projects/[projectId]/table`: an ARIA grid with roving tabindex (C3, P3), typed cell editors with client checks, and `expectedVersion` on every versioned edit with CONFLICT and UNKNOWN handling (K88). Column choice, grouping and sort persist, and a scope-neutral table block is exported. E2E `projects-table.spec.ts` covers edits and column choice after a reload, rejected invalid values, conflict and the keyboard model. | 5 | 15-12 | AIDA-76 |
| 15-16 | Calendar `/projects/[projectId]/calendar`: month and week grids with the range in the URL and today from the server, placement on the due or start date, the Unscheduled panel with Set date, add on a day, and the 1000-task bound. Pointer drag and the Move menu shift both dates in one `setTaskDates` call (K80). E2E `projects-calendar.spec.ts` runs each move by mouse and keyboard plus add on a day with reload checks; `projects-calendar-tz.spec.ts` runs Pacific/Kiritimati and Pacific/Pago_Pago. | 5 | 15-06, 15-12 | AIDA-77 |
| 15-17 | Timeline `/projects/[projectId]/timeline`: a CSS-grid scale with day, week and month zoom and grouping in view state, bars and point markers, the milestone lane, the today line, the Unscheduled section with Set dates, and the 1000-task bound. Bar drag and the Move menu offer four shifts plus Set dates. E2E `projects-timeline.spec.ts` covers zoom, grouping and collapse after a reload, each move by mouse and keyboard, and the two time-zone runs. | 5 | 15-06, 15-12 | AIDA-78 |
| 15-18 | Task drawer and full page (D-02, D-09): the `/tasks/[taskId]` page, the `@drawer` intercepting slot with `default.tsx` in the (app) layout, one loader and one TaskView with every property editor, the title, and the Markdown description with a server preview. Also the task actions menu (copy link, open full page, favorite, duplicate, move, archive and restore, delete). E2E `projects-task-drawer.spec.ts` covers drawer and page parity, deep links, back and forward, reload, focus return, the link after a move, and edits after a reload. | 6 | 15-05, 15-11, 15-12, 15-13, 15-14, 15-15, 15-16, 15-17 | AIDA-73 |
| 15-19 | Saved views UI (D-17): the Views menu in the project header, the save, rename, update and delete dialogs and their actions over the 15-08 services, and the active chip flow. E2E `projects-saved-views.spec.ts` covers persistence after a reload, another user of the organization not seeing the view, an unknown version, stale references and the not-available `?saved=` notice. | 6 | 15-08, 15-11, 15-12 | AIDA-80 |
| 15-20 | Workspace Tasks `/workspace/tasks`: the workspace layout and its complete nav, plus list, board and table forms in `?form=`, with grouping, columns and sort persisted per form (C2, P2). It adds project chips on every item and the status-only workspace Board (K77). E2E `projects-workspace.spec.ts` covers each form, grouping and columns after a reload, and the workspace Board move by mouse and keyboard. | 6 | 15-07, 15-12, 15-14, 15-15 | AIDA-106 |
| 15-21 | Files and attachments (D-16, K83): the download and upload route handlers with fixed safe headers, byte-identical 404 bodies and a fixed 403 body, the task attachments section (upload, download, delete), and the Files tab in grid and list forms with FILES view state. Integration route tests, the proxy privacy test, and E2E `projects-files.spec.ts` (upload in the drawer, download, form after a reload, non-member 404). | 7 | 15-08, 15-09, 15-18 | AIDA-79, AIDA-73 |
| 15-22 | Workspace Calendar and Timeline (`/workspace/calendar`, `/workspace/timeline`) over `listWorkspaceTasks` and `listWorkspaceMilestones`, with project stripes, project grouping and the add-on-a-day project picker dialog. E2E `projects-workspace-schedule.spec.ts` covers moves by mouse and keyboard and zoom and grouping after a reload; `projects-workspace-privacy.spec.ts` is the D-06 run over all three workspace pages. | 7 | 15-16, 15-17, 15-20 | AIDA-106, AIDA-77, AIDA-78 |
| 15-23 | Task content sections mounted in TaskView: subtasks (create, status, Move menu up, down and top), comments (add, edit own, delete under AUTHOR_OR_MANAGE) and history from `listTaskActivity` with redaction and load more. E2E `projects-task-content.spec.ts` checks each section after a reload and runs each subtask Move item by mouse and by keyboard. | 8 | 15-06, 15-21 | AIDA-73 |
| 15-24 | Design-system and boundary proofs (success criterion 5): extend `design-tokens.test.ts` to every Phase 15 path (tokens, `text-[Npx]` only, EmptyState use, sidebar and top-bar classes, no inline script) and make the D-04 import-boundary scan non-vacuous. Extend `a11y-contrast.spec.ts` to the new pages in both themes and fix any violation found. | 9 | 15-10, 15-11, 15-13, 15-14, 15-15, 15-16, 15-17, 15-19, 15-21, 15-22, 15-23 | AIDA-72, AIDA-73, AIDA-74, AIDA-75, AIDA-76, AIDA-77, AIDA-78, AIDA-79, AIDA-80, AIDA-106 |
| 15-25 | Phase gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:egress` (recorded as blocked under O-1), `pnpm test:e2e`, `pnpm build`, `pnpm audit --prod`, the clean-room grep and the automatable section 9 items. Results go into `15-GATE.md` with evidence per requirement and per success criterion, and every manual item is left open. | 10 | 15-24 | AIDA-72, AIDA-73, AIDA-74, AIDA-75, AIDA-76, AIDA-77, AIDA-78, AIDA-79, AIDA-80, AIDA-106 |

**D-23 mapping (reshape, nothing dropped):** 1 to 15-01; 2 to 15-02; 3 to 15-03 (grown by C1 and the people read); 4 to 15-04 and 15-07; 5 to 15-08 (the inbox scope filter moved to 15-02 so it lands before any PROJECT row can be written); 6 to 15-05 and 15-06; 7 to 15-10 and 15-11; 8 to 15-09, 15-18, 15-21 (attachments section) and 15-23; 9 to 15-12 and 15-13; 10 to 15-14; 11 to 15-15; 12 to 15-16; 13 to 15-17; 14 to 15-21; 15 to 15-20 and 15-22 (sidebar moved to 15-10, single owner); 16 to 15-19; 17 to 15-24 and 15-25.

**Decision and K coverage:** D-01 and K74 (15-01, 15-09, 15-18); D-02 (15-18); D-03 (15-05, every action file); D-04 and K75 (15-01, 15-24); D-05 and K76 (15-03, 15-04, 15-07); D-06 and K77 (15-07, 15-20, 15-22); D-07 (15-09, 15-10); D-08 and K84 (15-10, 15-11, 15-18); D-09 (15-18, 15-21, 15-23); D-10 and K86 (15-12, 15-13); D-11 (15-14); D-12 and K88 (15-15; K88 also 15-05); D-13, K79, K80 and K87 (15-01, 15-04, 15-06, 15-16); D-14 and K85 (15-06, 15-14, 15-16, 15-17, 15-23); D-15 (15-17); D-16 and K83 (15-21); D-17 and K81 (15-01, 15-02, 15-08, 15-19); D-18 and K82 (15-01, 15-02, 15-08); D-19 and K90 (15-08); D-20 and K78 (every plan, audited in 15-25); D-21 and K89 (15-05, 15-24); D-22 (15-21, 15-24); D-23 (this outline).

## File ownership

Paths of existing files were checked with `git ls-files`. Every other path is new and stays as written. "mod" means modified.

**15-01 (W1):** `.planning/phases/14-projects-foundation/14-CONTRACT.md` (mod: new section 18; section 12 step 5 and section 17 amended by reference); `src/lib/projects/contract.ts` (mod); `src/lib/projects/view-payload.ts`; `tests/unit/project-contract.test.ts` (mod); `tests/unit/project-operation-inventory.test.ts` (mod); `tests/unit/project-view-payload.test.ts`; `tests/unit/project-import-boundary.test.ts`.

**15-02 (W2):** `prisma/schema.prisma` (mod); `prisma/migrations/20261114100000_work_views/migration.sql`; `src/lib/scoped-db.ts` (mod); `src/lib/saved-views/service.ts` (mod); `tests/support/project-fixtures.ts` (mod: `projectTableSnapshot` adds SavedView rows of scope PROJECT and ProjectViewState rows); `tests/unit/project-schema-parity.test.ts` (mod); `tests/integration/project-views-schema.test.ts`; `tests/integration/project-views-migration.test.ts`; `tests/integration/saved-views-scope.test.ts`.

**15-03 (W2):** `src/lib/projects/projects.ts` (mod); `src/lib/projects/members.ts` (mod); `src/lib/projects/contract.ts` (mod, registration lines for `listAddableProjectMembers` and `resolvePeopleNames` only); `tests/support/project-two-worlds.ts`; `tests/integration/project-list-query.test.ts`; `tests/integration/project-list-query-isolation.test.ts`; `tests/integration/project-list-two-worlds.test.ts`; `tests/integration/project-list-query-race.test.ts`.

**15-04 (W2):** `src/lib/projects/task-query.ts`; `src/lib/projects/tasks.ts` (mod: `listProjectTasks`, `getTask`); `src/lib/projects/milestones.ts` (mod: `listProjectMilestones`); `tests/unit/project-task-query.test.ts`; `tests/integration/project-task-query.test.ts`; `tests/integration/project-task-query-isolation.test.ts`; `tests/integration/project-task-query-race.test.ts`.

**15-05 (W2):** `src/lib/projects/ui-copy.ts`; `src/lib/projects/outcome.ts`; `src/lib/projects/colors.ts`; `src/lib/project-ui/action-support.ts`; `src/components/ui/sheet.tsx`; `src/components/projects/status-chip.tsx`, `priority-chip.tsx`, `project-status-chip.tsx`, `label-chip.tsx`, `project-chip.tsx`, `project-icon.tsx` (Lucide map for the 25 PROJECT_ICONS keys), `icon-picker.tsx`, `color-swatches.tsx`, `progress-bar.tsx`, `outcome-callout.tsx`, `not-available.tsx`, `task-link.tsx`; `tests/unit/project-copy.test.ts`; `tests/unit/project-outcome.test.ts`; `tests/unit/project-colors.test.ts`; `tests/e2e/support/projects.ts`.

**15-06 (W2):** `src/lib/projects/calendar-date.ts`; `src/lib/projects/move-anchors.ts`; `src/components/projects/drag-layer.tsx`; `src/components/projects/move-menu.tsx`; `src/components/projects/view-announcer.tsx`; `tests/unit/project-calendar-date.test.ts`; `tests/unit/project-move-anchors.test.ts`.

**15-07 (W3):** `src/lib/projects/tasks.ts` (mod: `listWorkspaceTasks`); `src/lib/projects/task-query.ts` (mod); `src/lib/projects/milestones.ts` (mod: `listWorkspaceMilestones`); `tests/integration/project-workspace-query.test.ts`; `tests/integration/project-workspace-query-isolation.test.ts`; `tests/integration/project-workspace-two-worlds.test.ts`; `tests/integration/project-workspace-query-race.test.ts`.

**15-08 (W3):** `src/lib/projects/saved-views.ts`; `src/lib/projects/view-state.ts`; `src/lib/projects/delete.ts` (mod, after `:255`, before the Project row delete at `:256`); `src/lib/projects/contract.ts` (mod, registration lines for the ten view operations only); `tests/unit/project-contract.test.ts` (mod: completeness assertion, all 12 Phase 15 rows registered, 88 operations); `tests/integration/project-views.test.ts`; `tests/integration/project-views-isolation.test.ts`; `tests/integration/project-views-race.test.ts`.

**15-09 (W3):** `src/app/(app)/projects/[projectId]/layout.tsx`, `page.tsx` (Overview), `loading.tsx`, `error.tsx`, `not-found.tsx`, `actions.ts`, `activity/page.tsx`, `activity/loading.tsx`; `src/components/projects/project-header.tsx`, `project-tabs.tsx`, `project-actions-menu.tsx`, `archived-notice.tsx`; `src/components/projects/overview/*`; `src/components/projects/activity/*`; `tests/e2e/projects-detail.spec.ts`.

**15-10 (W4):** `src/app/(app)/projects/page.tsx`, `loading.tsx`, `error.tsx`, `actions.ts`; `src/components/projects/project-list/*`; `src/components/projects/create-project-dialog.tsx`; `src/components/sidebar.tsx` (mod); `src/components/top-bar.tsx` (mod); `tests/e2e/projects-list.spec.ts`.

**15-11 (W4):** `src/components/projects/settings/*` (edit, members, labels, milestones, duplicate, delete dialogs); `src/app/(app)/projects/[projectId]/settings-actions.ts`; `src/components/projects/project-header.tsx` (mod); `src/components/projects/project-actions-menu.tsx` (mod); `src/components/projects/overview/*` (mod: manage buttons); `tests/e2e/projects-settings.spec.ts`.

**15-12 (W4):** `src/lib/projects/view-query.ts`; `src/components/projects/view-toolbar.tsx`, `group-header.tsx`, `quick-add.tsx`; `src/components/projects/view/*` (filter popover, filter chips, columns menu, saved-view chip, view notices); `src/app/(app)/projects/[projectId]/view-actions.ts`; `src/app/(app)/projects/[projectId]/list/page.tsx`, `loading.tsx`, `actions.ts`; `src/components/projects/list/*`; `tests/unit/project-view-query.test.ts`; `tests/e2e/projects-task-list.spec.ts`.

**15-13 (W5):** `src/components/projects/list/*` (mod; new `bulk-bar.tsx` and selection module); `src/app/(app)/projects/[projectId]/list/actions.ts` (mod: bulk action); `tests/e2e/projects-task-list-bulk.spec.ts`.

**15-14 (W5):** `src/app/(app)/projects/[projectId]/board/page.tsx`, `loading.tsx`, `actions.ts`; `src/components/projects/board/*`; `tests/e2e/projects-board.spec.ts`.

**15-15 (W5):** `src/app/(app)/projects/[projectId]/table/page.tsx`, `loading.tsx`, `actions.ts`; `src/components/projects/table/*`; `tests/e2e/projects-table.spec.ts`.

**15-16 (W5):** `src/app/(app)/projects/[projectId]/calendar/page.tsx`, `loading.tsx`, `actions.ts`; `src/components/projects/calendar/*`; `tests/e2e/projects-calendar.spec.ts`; `tests/e2e/projects-calendar-tz.spec.ts`.

**15-17 (W5):** `src/app/(app)/projects/[projectId]/timeline/page.tsx`, `loading.tsx`, `actions.ts`; `src/components/projects/timeline/*`; `tests/e2e/projects-timeline.spec.ts`.

**15-18 (W5):** `src/app/(app)/layout.tsx` (mod: `drawer` slot); `src/app/(app)/@drawer/default.tsx`; `src/app/(app)/@drawer/(.)tasks/[taskId]/page.tsx`; `src/app/(app)/tasks/[taskId]/page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`; `src/app/(app)/tasks/actions.ts`; `src/lib/project-ui/load-task.ts`; `src/components/projects/task-view.tsx`; `src/components/projects/task/*` (drawer, properties, title, description, actions menu, move and delete dialogs); `tests/e2e/projects-task-drawer.spec.ts`.

**15-19 (W5):** `src/components/projects/saved-views/*`; `src/app/(app)/projects/[projectId]/saved-view-actions.ts`; `src/components/projects/project-header.tsx` (mod); `tests/e2e/projects-saved-views.spec.ts`.

**15-20 (W6):** `src/app/(app)/workspace/layout.tsx` (header and the complete nav Tasks, Calendar, Timeline), `workspace/error.tsx`, `workspace/tasks/page.tsx`, `workspace/tasks/loading.tsx`, `workspace/actions.ts`; `src/components/projects/workspace/*` (tasks forms, workspace board); `tests/e2e/projects-workspace.spec.ts`.

**15-21 (W6):** `src/app/api/projects/attachments/[attachmentId]/route.ts`; `src/app/api/projects/tasks/[taskId]/attachments/route.ts`; `src/lib/project-ui/attachment-download.ts`; `src/lib/project-ui/attachment-upload.ts`; `src/components/projects/task/attachments-section.tsx`; `src/components/projects/task-view.tsx` (mod); `src/app/(app)/tasks/[taskId]/attachment-actions.ts`; `src/app/(app)/projects/[projectId]/files/page.tsx`, `loading.tsx`, `actions.ts`; `src/components/projects/files/*`; `tests/integration/project-attachment-routes.test.ts`; `tests/unit/proxy.test.ts` (mod); `tests/e2e/projects-files.spec.ts`.

**15-22 (W7):** `src/app/(app)/workspace/calendar/page.tsx`, `loading.tsx`; `src/app/(app)/workspace/timeline/page.tsx`, `loading.tsx`; `src/app/(app)/workspace/schedule-actions.ts`; `src/components/projects/workspace/workspace-calendar.tsx`, `workspace-timeline.tsx`, `add-task-on-day-dialog.tsx`; `tests/e2e/projects-workspace-schedule.spec.ts`; `tests/e2e/projects-workspace-privacy.spec.ts`.

**15-23 (W7):** `src/components/projects/task/subtasks-section.tsx`, `comments-section.tsx`, `history-section.tsx`; `src/components/projects/task-view.tsx` (mod); `src/app/(app)/tasks/[taskId]/content-actions.ts`; `tests/e2e/projects-task-content.spec.ts`.

**15-24 (W8):** `tests/unit/design-tokens.test.ts` (mod); `tests/unit/project-import-boundary.test.ts` (mod: non-vacuity); `tests/e2e/a11y-contrast.spec.ts` (mod). Any Phase 15 UI file a proof shows in violation, fix only; it is the only plan in W8.

**15-25 (W9):** `.planning/phases/15-work-views/15-GATE.md` only. The gate records results and edits no product code; a red step is recorded as a gap for the verifier and the orchestrator.

### Shared files and their owners

| Shared file | Owner (wave) |
|---|---|
| `prisma/schema.prisma` | 15-02 (W2) only |
| `prisma/migrations/` (folder; new `20261114100000_work_views`) | 15-02 (W2) only |
| `src/lib/scoped-db.ts` | 15-02 (W2) only |
| `.planning/phases/14-projects-foundation/14-CONTRACT.md` | 15-01 (W1) only |
| `src/lib/projects/contract.ts` | 15-01 (W1) freeze; registration lines only in 15-03 (W2) and 15-08 (W3) |
| `tests/unit/project-operation-inventory.test.ts` | 15-01 (W1) only |
| `tests/unit/project-contract.test.ts` | 15-01 (W1), 15-08 (W3) |
| `src/lib/projects/delete.ts` | 15-08 (W3) only |
| `src/lib/saved-views/service.ts` | 15-02 (W2) only; `src/lib/saved-views/ui-state.ts` is not modified |
| `src/lib/projects/saved-views.ts`, `view-state.ts` | 15-08 (W3) only |
| `src/lib/projects/view-payload.ts` | 15-01 (W1) only |
| `src/lib/projects/tasks.ts`, `task-query.ts`, `milestones.ts` | 15-04 (W2), 15-07 (W3) |
| `src/lib/projects/projects.ts`, `members.ts` | 15-03 (W2) only |
| `src/lib/projects/ui-copy.ts`, `outcome.ts`, `colors.ts` | 15-05 (W2) only |
| `src/lib/projects/calendar-date.ts`, `move-anchors.ts` | 15-06 (W2) only |
| `src/lib/projects/view-query.ts` | 15-12 (W4) only |
| `src/components/sidebar.tsx`, `src/components/top-bar.tsx` | 15-10 (W4) only |
| `src/app/(app)/layout.tsx` | 15-18 (W5) only |
| `src/components/projects/project-header.tsx` | 15-09 (W3), 15-11 (W4), 15-19 (W5) |
| `src/components/projects/project-actions-menu.tsx` | 15-09 (W3), 15-11 (W4) |
| `src/components/projects/task-view.tsx` | 15-18 (W5), 15-21 (W6), 15-23 (W7) |
| `src/components/projects/list/*`, `projects/[projectId]/list/actions.ts` | 15-12 (W4), 15-13 (W5) |
| `src/components/projects/view-toolbar.tsx`, `group-header.tsx`, `quick-add.tsx`, `view/*` | 15-12 (W4) only |
| `src/app/(app)/workspace/layout.tsx` | 15-20 (W6) only |
| `tests/support/project-fixtures.ts` | 15-02 (W2) only |
| `tests/support/project-two-worlds.ts` | 15-03 (W2) only |
| `tests/support/project-read-race.ts`, `lock-wait.ts`, `project-race.ts` | not modified; plans add local helpers in their own test files |
| `tests/e2e/support/projects.ts` | 15-05 (W2) only |
| `tests/unit/project-import-boundary.test.ts` | 15-01 (W1), 15-24 (W8) |
| `tests/unit/design-tokens.test.ts`, `tests/e2e/a11y-contrast.spec.ts` | 15-24 (W8) only |
| `tests/unit/proxy.test.ts` | 15-21 (W6) only |
| `tests/unit/project-schema-parity.test.ts` | 15-02 (W2) only |
| `playwright.config.ts` | not modified by any plan; the time-zone runs use `test.use({ timezoneId })` inside the spec |
| `src/proxy.ts`, `next.config.*`, `src/app/globals.css`, `package.json`, `pnpm-lock.yaml` | not modified (D-16, C10, no new token, K78) |

### Cross-plan conventions (binding on every single-plan planner)

1. **Tracer first.** Every plan's first task is a production-quality tracer. For a UI plan it runs one route, its loader, one service call, the render and one E2E. For a service plan it is one operation end to end with its isolation block.
2. **Actions per feature.** Server actions live in the feature's own file (`projects/actions.ts`, `[projectId]/actions.ts`, `settings-actions.ts`, `view-actions.ts`, `saved-view-actions.ts`, `list|board|table|calendar|timeline|files/actions.ts`, `tasks/actions.ts`, `attachment-actions.ts`, `content-actions.ts`, `workspace/actions.ts`, `schedule-actions.ts`). Each is written over `src/lib/project-ui/action-support.ts`: `getSessionActor()` and one service call inside the `try`, `unstable_rethrow` first in the catch, `{ ok: false, code: "UNKNOWN" }` with no message, and revalidation per path in its own `try`. A later plan imports another plan's action file and never edits it in the same wave.
3. **One outcome path.** UI reads every result only through `outcome.ts`. All copy comes from `ui-copy.ts`, which 15-05 writes complete from the Copywriting Contract. No plan adds copy, a token or a package; a missing string stops the plan and is reported.
4. **TaskLink and focus return.** Every link that opens a task is `TaskLink` (15-05), which marks the opener so 15-18 can return focus on close. Every Move button carries the task id attribute that `move-menu.tsx` (15-06) uses to return focus after a reload.
5. **Scope-neutral blocks.** View plans (15-12, 15-14, 15-15, 15-16, 15-17) export blocks that take data and callbacks. The workspace plans (15-20, 15-22) compose them and own every workspace-only behaviour. View plans test project scope only.
6. **Navigation complete by its owner.** The tab nav (15-09), workspace nav (15-20) and sidebar entries (15-10) are built complete. A link to a page whose plan has not landed yet is transitional; no E2E follows a link to a page its plan does not depend on.
7. **E2E data.** Specs seed through `tests/e2e/support/projects.ts`, which calls the Phase 14 services as the E2E owner or member. Extra helpers stay local to the spec. Server state is read back through Prisma after a page reload. Specs log in with the existing `admin.json` (organization owner) and `member.json` (plain member) storage states.
8. **D-04 paths.** The import-boundary scan covers `src/app/(app)/projects`, `src/app/(app)/tasks`, `src/app/(app)/workspace`, `src/app/(app)/@drawer`, `src/app/api/projects`, `src/components/projects` and `src/lib/project-ui`. Code there imports no `@/lib/db`, no `@/lib/scoped-db`, no generated Prisma client, and neither `scopedDb` nor `getScopedDb`.
9. **Pure modules in `src/lib/projects/`** (`ui-copy`, `outcome`, `colors`, `calendar-date`, `move-anchors`, `view-query`, `view-payload`, `task-query`) use relative imports only, import nothing from `next`, and export no `async function x(actor, ...)`. The inventory scans that directory.

## Open points settled

- **P1** (15-03): new READ operation `listAddableProjectMembers` (MANAGE, keyset-paged, name, userId and email), frozen by 15-01; the Members dialog in 15-11 loads every page of it. This follows the UI-SPEC suggestion.
- **P2** (15-01 freeze, built by 15-20): the workspace Tasks form stays in `?form=`. Grouping, columns and sort persist per form as view-state rows LIST, BOARD and TABLE with `projectId` null; no new kind is added. This follows the UI-SPEC.
- **P3** (15-15): the grid is one Tab stop with roving tabindex. In edit mode Enter commits, Escape cancels and Tab or Shift+Tab commits and moves to the next or previous editable cell; outside edit mode Tab leaves the grid. This is recorded as a deviation from D-12's wording, and the E2E asserts both Tab paths.
- **P4** (15-06): "Move down" on the last loaded card of a column that has more is disabled with "Move down needs load reason". "Move to {status}" places at the top (anchor null). `move-anchors.ts` computes each anchor and disabled state; 15-14 and 15-23 consume it.
- **C1** (15-03): implemented as P1. Unlike PATTERNS, the result also carries `email`, because the Members dialog shows one.
- **C2** (15-01): the view-state key `(organizationId, userId, projectId, viewKind)` with NULLS NOT DISTINCT is read one way by every plan. Workspace Tasks forms and the workspace Timeline use `projectId` null, the project list uses PROJECT_LIST with null, and FILES exists only with a project.
- **C3** (15-15): settled as P3.
- **C4** (15-06): "Move up" anchors on the card two places above, or null when the target is the first place. "Move down" anchors on the card below. "Move to top" anchors on null. A unit test covers every case, including the first and last loaded cards.
- **C5** (15-02): `scope: "INBOX"` is added to every inbox read and write (`createSavedView` read at `:230`, `updateSavedView` `:396`, `deleteSavedView` `:427`, the list reads at `:314` and `:319`, `getSavedViewForPanel` `:464`). `saved-views-scope.test.ts` enumerates these six sites and proves that the sidebar, strip and palette lists stay the same while project views exist. This differs from D-23 item 5 in placement only: the filter lands with the migration, before any service can write a PROJECT row.
- **C6** (15-02): verified now. `model Project` already has `@@unique([organizationId, id])`, so the composite relations of SavedView and ProjectViewState need no change to Project.
- **C7** (15-21): the ticket download route is used only for `Cache-Control: private, no-store` and the `new Response(new Uint8Array(buffer))` shape. The header block is written fresh per D-16: RFC 5987 `filename*` from the cleaned stored name, `nosniff`, and the stored type only when it is in ALLOWED_MIME, otherwise `application/octet-stream`.
- **C8** (15-03): search does not rely on Prisma `contains`. `listProjects` with `q` runs raw SQL `ILIKE ... ESCAPE '\'` with `\`, `%` and `_` escaped by the service, in the same statement as `readableProjectSql`. A test proves the three characters match literally.
- **C9** (15-03): every project sort keeps the id-only cursor and re-reads the anchor's sort key under the read predicate; an unreadable or missing anchor is INVALID_INPUT `cursor`. No position or sort value ever enters a cursor.
- **C10** (15-21): the upload stays a route handler, and `next.config` gets no `serverActions.bodySizeLimit`.
- **C11** (15-10): each `navItems` entry gets an explicit `match` prefix list: "Projects" matches `/projects` and `/tasks`, and "Tasks" matches `/workspace`. Both entries come from 15-10, unlike D-23 item 15, which put the sidebar with the workspace pages; the reason is one owner for the sidebar.
- **C12** (15-08): two `deleteMany` calls (SavedView with `scope: "PROJECT"`, then ProjectViewState) run with `organizationId` and `projectId`, after the ProjectTaskCounter delete and before the Project row. The race test in `project-views-race.test.ts` uses `lock-wait.ts` in both orders.
- **C13** (15-01): every Phase 15 UI directory is new. 15-01 freezes the directory list that the D-04 scan covers (convention 8), and this outline assigns each new file to exactly one creating plan.
- **15-o1 interim** (15-11; task-side surfaces in 15-18, create in 15-10): Phase 15 builds the AIDA-103 and AIDA-104 UI, project settings and members over existing operations (D-08, K84). Team UI stays in Phase 16. REQUIREMENTS.md and PROJECT.md stay unchanged, and the owner item stays open (the orchestrator records it).

Additional planner decisions (gaps found while outlining, settled conservatively):

- **N1** (15-01, built by 15-03 and 15-04): the favorite toggles and manager-only controls need state that no read returns. `listProjects` items gain `isFavorite` and `canManage`, `getProject` gains `isFavorite`, and `getTask` gains `isFavorite`. Each value covers the actor's own row and is read under the predicate in the same statement. `canManage` follows the MANAGE rule without the archive check.
- **N2** (15-01, built by 15-03): the Activity tab, comments, attachments, Files and assignee avatars show names, but the Phase 14 views return user ids only. New `resolvePeopleNames` returns names only for users with a current member row (C14); every other id renders the "Someone" fallback.
- **N3** (15-01): the archive control on the project list is a per-card or per-row icon button "Archive project" in Current scope. The UI-SPEC focus table implies it and the AIDA-72 acceptance asks for archive from both pages. A non-manager sees it disabled with "Manager only reason".
- **N4** (15-01): project views list top-level tasks (Board per D-11; List, Table, Calendar and Timeline the same), and subtasks live in the task view. Workspace reads keep their Phase 14 behaviour, which includes non-archived subtasks.
- **N5** (15-01): workspace assignee filter options come from the assignee group counts of the unfiltered workspace read, so they hold readable data only. Project assignee options come from `listEligibleAssignees`.
- **N6** (15-01): URL parameters are parsed strictly by `view-query.ts`, and an invalid one is dropped, so its default applies before any service call. A service INVALID_INPUT reached from a loader is a programming error and goes to the error boundary.

## Contract amendment scope

15-01 freezes everything below in `14-CONTRACT.md` section 18 and `contract.ts` in one commit (contract section 0). Existing operation names, refusal codes and behaviour do not change: with every new option absent, an extended operation returns exactly what it returns today, with the same cursor format.

**1. Route and refusal matrix.**
- Each D-01 route with its loader calls:
  - `/projects`: `listProjects`, `getProjectsProgress` for the page, and `getWorkspaceViewState(PROJECT_LIST)`.
  - `/projects/[projectId]` (Overview): `getProject`, `getProjectProgress`, `listProjectMembers`, `listProjectMilestones` from today with limit 5, and `resolvePeopleNames`.
  - The task-view tabs: `getProject`, the `listProjectTasks` variants, `getProjectViewState`, `openProjectSavedView` when `?saved=` is present, and `listLabels`, `listProjectMilestones` and `listEligibleAssignees` for filter options.
  - `/files`: `listProjectAttachments` and FILES view state.
  - `/activity`: `listProjectActivity`.
  - `/tasks/[taskId]`, page and drawer: `getTask`, `getProject`, `listTaskComments`, `listTaskAttachments`, `listTaskActivity`, `getTaskProgress`, `listEligibleAssignees`, `listLabels`, `listProjectMilestones` and `resolvePeopleNames`.
  - The three workspace pages: `listWorkspaceTasks`, `listWorkspaceMilestones`, `listProjects` and `getWorkspaceViewState`.
- Loaders: NOT_FOUND calls `notFound()`, one not-available state with identical output for a missing, unreadable or deleted project or task (K74). MEMBERSHIP_ENDED follows the existing session handling.
- Actions return `ProjectResult` or `ActionUnknown`. The matrix lists per action file the operations it calls and the refusal codes each can return; `outcome.ts` maps every one.
- Download `GET /api/projects/attachments/[attachmentId]`:
  - Success is 200 with the D-16 headers.
  - Missing, unreadable, moved-away and revoked attachments, and a stored file that is gone, all get 404 `text/plain` "This file is not available.", byte-identical.
  - No member row gets 403 `text/plain` "You don't have access to this workspace.".
- Upload `POST /api/projects/tasks/[taskId]/attachments`:
  - A Content-Length above MAX_UPLOAD_FILES times MAX_BYTES plus 1 MiB gets 413 with `{ ok: false, code: "FILE_TOO_LARGE" }` before parsing.
  - Otherwise the response is JSON: 200 `{ ok: true, ... }`, 404 NOT_FOUND, 403 MEMBERSHIP_ENDED, 422 for any other refusal code, and 500 `{ ok: false, code: "UNKNOWN" }` with no error text.
- `src/proxy.ts` is unchanged, so both routes stay private.
- The D-04 path list (convention 8).

**2. Extended operations** (signature in words; implementing plan):
- `listProjects(actor, { archived, cursor, limit, q, statuses, sort })` (15-03):
  - `q`: 1 to 80 code points after trim (PROJECT_SEARCH_MAX), with a literal case-insensitive substring match on the name or the key prefix; empty after trim counts as absent.
  - `statuses`: 1 to 5 distinct PROJECT_STATUSES.
  - `sort`: one of PROJECT_SORTS. `manual` is the default (position, id). `name` sorts by lower(name) in C collation, then id; `dueDate` ascending with nulls last, then id; `createdAt` newest first, then id descending.
  - The cursor holds the id only and is re-read under the predicate (K71, C9).
  - Items gain `isFavorite` and `canManage` (N1).
- `getProject(actor, projectId)` (15-03): the result gains `isFavorite`.
- `listProjectMembers(actor, projectId, opts)` (15-03): items gain `email`, for current members only (C14).
- `listProjectTasks(actor, projectId, filters)` (15-04) gains:
  - Filters: `statuses`, `priorities`, `assigneeUserIds` (null means unassigned; a value matches only while that user is an eligible assignee of the task's project, so a stale assignee matches nothing), `labelIds` (any of) and `milestoneIds` (null means no milestone). Each holds 1 to VIEW_FILTER_VALUES_MAX (50) distinct values. Well-formed but unknown ids match nothing, and malformed ids are INVALID_INPUT with the parameter as field. The old single `status` and `assigneeUserId` keep working; combining the old and new form of one filter is INVALID_INPUT.
  - `sort`, one of TASK_SORTS:
    - `manual`: rank, id.
    - `dueDate` and `startDate`: ascending with nulls last, then key in C collation, then id.
    - `priority`: URGENT to NONE, then key, then id.
    - `title`: lower(title) in C collation, then key, then id.
    - `createdAt`: newest first, then id descending.
    - An explicit sort uses a tagged cursor `[sortName, ...values, id]`; a tag mismatch is INVALID_INPUT `cursor`.
  - `group`: `{ by, value }`, an equality filter for one group's page.
  - `groupCounts` (a group-by name): returns `groups` from the same read transaction. Each entry has value, count and label; the label is an assignee's name (current members only), a milestone's name and date, or a project's name, prefix, colour and icon. Status and priority list every value, zero counts included; assignee, milestone and project list only non-empty groups; the null group comes last. Project scope allows status, assignee, priority and milestone.
  - `window`: `{ from, to }` CalendarDates with a span of at most TASK_WINDOW_MAX_DAYS (400). It returns every task whose span overlaps the window, both ends inclusive, ordered by span start, span end, id. Above TASK_WINDOW_MAX (1000) tasks it returns `tooMany: true` and no rows (K87). There is no paging, and `window` cannot be combined with cursor, group or unscheduled.
  - `unscheduled: true`: tasks with neither date, keyset-paged.
  - Items gain `labels` (id, name, colour, ordered by name then id), `milestone` (id and name, or null) and `estimateMinutes`.
  - Every statement carries `readableProjectWhere` or `readableProjectSql` (K73).
- `getTask(actor, taskId)` (15-04): the result gains `isFavorite`.
- `listProjectMilestones(actor, projectId, { cursor, limit, from, to })` (15-04): the milestone date must fall within `from` and `to`, inclusive.
- `listWorkspaceTasks(actor, filters)` (15-07) takes the same filters, sorts except `manual` (INVALID_INPUT `sort`), group, window and unscheduled as `listProjectTasks`, plus:
  - `projectIds`: 1 to LIST_MAX values, each matched under the predicate in the same statement, so an unreadable id behaves like a missing id.
  - `groupCounts` by status, project, assignee or priority.
  - Rows also carry `project` (id, name, keyPrefix, colour, icon).
  - An absent sort keeps the Phase 14 id order.
- `listWorkspaceMilestones(actor, { cursor, limit, from, to, projectIds })` (15-07).
- `deleteProject(actor, projectId, { confirmName })` (15-08) amends section 12 step 5 (K90): after the ProjectTaskCounter delete and before the Project row, it deletes SavedView rows (organizationId, projectId, scope PROJECT) and ProjectViewState rows (organizationId, projectId). It writes no activity for them, and the result is unchanged.

**3. New operations** (module, access, lock, verbs, isolation; implementing plan). Each is frozen in `PHASE_15_OPERATIONS`:
- `listAddableProjectMembers(actor, projectId, { cursor, limit })` (members, MANAGE, NONE, none, TARGET; 15-03): active organization members (conservative read) with no ProjectMember row in the project. Returns `{ people: [{ userId, name, email }], hasMore, nextCursor }`, ordered by name then userId in code-unit order.
- `resolvePeopleNames(actor, { userIds })` (members, MEMBER, NONE, none, ORG; 15-03): 1 to LIST_MAX well-formed ids. Returns `{ people: [{ userId, name }] }` for ids with a current member row in the actor's organization, ordered by name then userId; every other id is omitted.
- `listProjectSavedViews(actor, projectId, { cursor, limit })` (saved-views, READ, NONE, none, TARGET; 15-08): the actor's own views of the project, as `{ views: [{ id, name, view, readable, updatedAt }], hasMore, nextCursor }` ordered by name then id.
- `openProjectSavedView(actor, viewId)` (saved-views, VIEW_OWNER, NONE, none, TARGET; 15-08): returns `{ view: { id, projectId, name, readable, payload, stale } }`. A view with an unknown version has `readable` false and payload null. `stale` is true when a label or milestone id is not in the project or an assignee is no longer eligible.
- `createProjectSavedView(actor, projectId, { name, payload })` (saved-views, READ, PROJECT_SHARE, none, TARGET; 15-08): name 1 to SAVED_VIEW_NAME_MAX (80). NAME_TAKEN is case-insensitive per owner and project. More than PROJECT_SAVED_VIEW_MAX (50) views per owner and project is TOO_MANY. The payload is checked structurally only, never for references. Returns `{ viewId }`.
- `renameProjectSavedView(actor, viewId, { name })`, `updateProjectSavedView(actor, viewId, { payload })` and `deleteProjectSavedView(actor, viewId)` (saved-views, VIEW_OWNER, PROJECT_SHARE, none, TARGET; 15-08). An unchanged value is a no-op `{ ok: true, changed: false }`.
- `getProjectViewState(actor, projectId, viewKind)` (view-state, READ, NONE, none, TARGET; 15-08): returns `{ state }`, null when there is no row or the row has an unknown version.
- `saveProjectViewState(actor, projectId, viewKind, state)` (view-state, READ, PROJECT_SHARE, none, TARGET; 15-08): a raw `INSERT ... ON CONFLICT ... DO UPDATE` that returns `{ changed }`. It is allowed on an archived project.
- `getWorkspaceViewState(actor, viewKind)` and `saveWorkspaceViewState(actor, viewKind, state)` (view-state, MEMBER, NONE, none, ORG; 15-08).

**4. New access level, isolation class and modules.**
- `VIEW_OWNER`: READ on the view's project (archived allowed) and the actor owns the view. Another user's view is NOT_FOUND, identical to a missing id, also for the project's manager and members.
- Isolation class `ORG`, added to section 17: the result is decided by the actor's organization membership alone and takes no project id. Each active member reads and writes only their own data, and a row one user writes is never returned to another. The outsider with organization A gets MEMBERSHIP_ENDED and nothing is written.
- PROJECT_MODULES gains `saved-views` and `view-state`.
- The inventory treats ORG operations like CREATE, LIST and KEY for `missingId()`. The six verbless writes join WRITES_WITHOUT_VERB, so their blocks compare `projectTableSnapshot` and the ProjectActivity count.

**5. Registration staging.** 15-01 adds the 12 rows to the frozen `PHASE_15_OPERATIONS` record only, and makes `project-contract.test.ts` and `project-operation-inventory.test.ts` registration-aware:
- The 76 Phase 14 names stay exact.
- A registered Phase 15 row must deep-equal its frozen spec.
- Export, isolation-block and verb rules apply to every registered operation, and an exported operation that is not registered remains a gap.

A plan registers an operation in PROJECT_OPERATIONS (one line per operation) in the same commit as its implementation and isolation block: 15-03 registers two, 15-08 registers ten. 15-08 then asserts completeness, 12 of 12 registered and 88 in total. Every test stays green at every commit, and no registration plan edits `14-CONTRACT.md` or the inventory test.

**6. Date semantics** (D-13, D-15, K79, K80):
- Span: from the start date (else due) to the due date (else start). A task with neither date is unscheduled.
- Window: overlap, both ends inclusive.
- Calendar: a task is placed once, on its due date, else its start date.
- Move by n days: every non-null end shifts by n in one `setTaskDates` call with `expectedVersion`. A result outside CALENDAR_DATE_MIN to CALENDAR_DATE_MAX is INVALID_INPUT, decided by the service.
- Calendar "Set date…": the chosen day becomes the due date when the task has one, else the start date, and the duration is kept. On an unscheduled task it sets the due date only.
- Timeline "Set dates…": sets either end directly, with start no later than due.
- Today: `todayInTimeZone(DEFAULT_TIME_ZONE, now)` on the server for each request.
- Weeks start on Monday. The calendar range lives in the URL as `?mode=month|week&date=YYYY-MM-DD`; the timeline start as `?from=YYYY-MM-DD`.
- Timeline windows: Day 4 weeks, Week 16 weeks, Month 12 months.
- Dates stay CalendarDate strings end to end. Display uses `Intl.DateTimeFormat("en-GB", { timeZone: "UTC" })` on UTC midnight.

**7. Payload and view-state schemas** (`view-payload.ts`, strict, fail closed; K81, K82):
- SavedView payload v1: `{ version: 1, view, filters, grouping, sort, columns, collapsed, zoom }`.
  - `view` is one of LIST, BOARD, TABLE, CALENDAR or TIMELINE.
  - `filters` may hold `statuses`, `priorities`, `assigneeUserIds`, `labelIds` and `milestoneIds`.
  - It is stored in the existing `filters` Json column with `scope` PROJECT and `visibility` PRIVATE, and `position` 0 (unused for PROJECT).
- View state v1: `{ version: 1, grouping, sort, columns, collapsed, zoom, form }`. The allowed keys and values depend on ProjectViewKind:
  - LIST: grouping, sort, collapsed.
  - BOARD: collapsed.
  - TABLE: grouping, sort, columns, collapsed.
  - TIMELINE: grouping, zoom, collapsed.
  - FILES: form grid or list.
  - PROJECT_LIST: form grid, list or table.
  - CALENDAR: version only.
- Both schemas:
  - Unknown keys are refused, and an unknown version opens as unreadable and applies nothing.
  - The serialized size is at most VIEW_PAYLOAD_MAX_BYTES (4096), measured like `octet_length(value::text)`; the CHECKs repeat the limit.
  - `collapsed` holds at most VIEW_COLLAPSED_MAX (50) group keys; the null group's key is GROUP_NONE_KEY `"~none"`.
- New sets:
  - SAVED_VIEW_SCOPES (INBOX, PROJECT).
  - PROJECT_VIEW_KINDS (LIST, BOARD, TABLE, CALENDAR, TIMELINE, FILES, PROJECT_LIST).
  - PROJECT_SORTS and TASK_SORTS.
  - TASK_GROUP_BYS (status, assignee, priority, milestone, project).
  - TABLE_COLUMNS (key, title, status, priority, assignee, startDate, dueDate, estimate, labels, milestone, project).
  - TIMELINE_ZOOMS (day, week, month), PROJECT_LIST_FORMS and FILES_FORMS.
- Kinds allowed with `projectId` null: LIST, BOARD, TABLE, CALENDAR, TIMELINE and PROJECT_LIST. With a project: LIST, BOARD, TABLE, CALENDAR, TIMELINE and FILES. Any other pair is INVALID_INPUT `viewKind`.

**8. Schema names** (implemented by 15-02):
- Enum `SavedViewScope`; SavedView columns `scope` and `projectId`.
- CHECKs `SavedView_scope_project_check` (INBOX exactly when projectId is null), `SavedView_project_private_check` and `SavedView_project_payload_size_check`.
- Indexes: `SavedView_private_name_key` and `SavedView_shared_name_key` are recreated with the same names plus `AND "scope" = 'INBOX'`, and `SavedView_project_name_key` is new.
- Model `ProjectViewState` (id, organizationId, userId, projectId nullable, viewKind `ProjectViewKind`, state Json, createdAt, updatedAt). It has the composite Restrict relation to Project, Cascade to organization and user, the hand-written `ProjectViewState_owner_kind_key` UNIQUE NULLS NOT DISTINCT on (organizationId, userId, projectId, viewKind), and `ProjectViewState_state_size_check`.
- Every hand-written object is listed in the migration header and above its model.

**9. Constants:** PROJECT_SEARCH_MAX 80, TASK_WINDOW_MAX 1000, TASK_WINDOW_MAX_DAYS 400, VIEW_FILTER_VALUES_MAX 50, VIEW_PAYLOAD_VERSION 1, VIEW_PAYLOAD_MAX_BYTES 4096, VIEW_COLLAPSED_MAX 50, PROJECT_SAVED_VIEW_MAX 50, SAVED_VIEW_NAME_MAX 80, GROUP_NONE_KEY "~none". The test protocol rows for VIEW_OWNER and ORG go into section 17, and the two-worlds rule of D-06 applies to every workspace read and every project-list search, filter and sort.

## E2E proof map

| Item | Plan | Proof |
|---|---|---|
| SC1 project pages | 15-10, 15-09, 15-11 | `projects-list.spec.ts`, `projects-detail.spec.ts`, `projects-settings.spec.ts` |
| SC1 task drawer and full page | 15-18, 15-21, 15-23 | `projects-task-drawer.spec.ts` (same values in drawer and page, deep links, back and forward, reload, focus return, link after a move), `projects-files.spec.ts` (attachments), `projects-task-content.spec.ts` |
| SC2 views read and write through Phase 14 logic | 15-12, 15-13, 15-14, 15-15, 15-16, 15-17, 15-21 | `projects-task-list.spec.ts`, `projects-task-list-bulk.spec.ts`, `projects-board.spec.ts`, `projects-table.spec.ts`, `projects-calendar.spec.ts`, `projects-timeline.spec.ts`, `projects-files.spec.ts`; no database import in view code: `project-import-boundary.test.ts` (15-01, non-vacuous in 15-24) |
| SC3 every drag has a keyboard alternative | 15-14, 15-16, 15-17, 15-20, 15-22, 15-23 | rows below |
| SC4 saved views per user and per project | 15-19 (15-08 integration) | `projects-saved-views.spec.ts`; `project-views.test.ts`, `project-views-isolation.test.ts` |
| SC5 clean-room grep and DS section 9 | 15-24, 15-25 | `design-tokens.test.ts`, `a11y-contrast.spec.ts` in both themes; gate grep `git grep -i -n gr8r -- src docs website README.md public prisma tests` with empty output in `15-GATE.md` |
| SC6 workspace pages never show a private project | 15-22 (15-07 integration) | `projects-workspace-privacy.spec.ts`; `project-workspace-two-worlds.test.ts` |
| Board drag (within a column and across columns) | 15-14 | `projects-board.spec.ts`, pointer drag, server order and status after a reload; Escape cancels |
| Board Move to {status}, Move up, Move down, Move to top | 15-14 | `projects-board.spec.ts`, each item once by mouse click and once by keyboard, reload check; disabled "Move down" at the loaded end and "Already first" asserted |
| Calendar drag to another day | 15-16 | `projects-calendar.spec.ts`, both dates shifted, exact dates read back after a reload |
| Calendar Earlier or Later by a day, Earlier or Later by a week, Set date… | 15-16 | `projects-calendar.spec.ts`, each item by mouse and by keyboard, reload check |
| Timeline bar drag | 15-17 | `projects-timeline.spec.ts`, both ends shifted, reload check; Escape returns focus to the label-cell Move button |
| Timeline four shifts and Set dates… | 15-17 | `projects-timeline.spec.ts`, each item by mouse and by keyboard, reload check |
| Subtask Move up, Move down, Move to top | 15-23 | `projects-task-content.spec.ts`, each item by mouse and by keyboard, reload check |
| Workspace Board drag and Move to {status} (setTaskStatus, K77) | 15-20 | `projects-workspace.spec.ts`, mouse and keyboard, reload check |
| Workspace Calendar and Timeline moves | 15-22 | `projects-workspace-schedule.spec.ts`, one drag and one menu item each by mouse and keyboard, reload check |
| Reload: collapse | 15-12, 15-14, 15-17 | List groups, Board columns and Timeline groups in their specs |
| Reload: column choice | 15-15, 15-20 | `projects-table.spec.ts`, `projects-workspace.spec.ts` (workspace Table) |
| Reload: grouping | 15-12, 15-15, 15-17, 15-20, 15-22 | List, Table, Timeline, workspace Tasks forms and workspace Timeline |
| Reload: zoom | 15-17, 15-22 | `projects-timeline.spec.ts`, `projects-workspace-schedule.spec.ts` |
| Reload: saved views | 15-19 | `projects-saved-views.spec.ts` (filters, grouping and collapse restored; second user sees nothing) |
| Reload: project list form and Files form | 15-10, 15-21 | `projects-list.spec.ts`, `projects-files.spec.ts` |
| D-13 time-zone runs | 15-16, 15-17 | `projects-calendar-tz.spec.ts` and the time-zone describe of `projects-timeline.spec.ts`, `test.use({ timezoneId })` with Pacific/Kiritimati and Pacific/Pago_Pago: a task stays on its date and a move stores the exact date |
| D-06 privacy run | 15-22 | `projects-workspace-privacy.spec.ts`: the member user on `/workspace/tasks` (list, board, table), `/workspace/calendar` and `/workspace/timeline` never sees the owner's private project's tasks, milestones or project chip; the private project and task URLs render the not-available state |
| AIDA-79 privacy | 15-21 | `projects-files.spec.ts` (non-member download 404) and `project-attachment-routes.test.ts` (byte-identical 404 across missing, unreadable, moved and revoked; fixed 403; headers) |

## Risks

- **Size.** 15-08 (ten operations), 15-12 (frame plus List), 15-18 (drawer mechanism plus every editor) and 15-04 (shared query builder) are the heaviest. Each is held to three tasks with a tracer first; a plan that cannot fit stops and reports rather than cutting scope.
- **Ordering of the contract.** The inventory and contract tests count operations. The `PHASE_15_OPERATIONS` staging keeps every commit green: rows are frozen in W1, each is registered with its implementation, and completeness is asserted in 15-08. `contract.ts` is touched in W1, W2 and W3 by one plan each.
- **Shared-file hot spots.** `tasks.ts` (15-04 then 15-07), `task-view.tsx` (15-18, 15-21, 15-23), `project-header.tsx` (15-09, 15-11, 15-19) and the list files (15-12, 15-13) are serialized across waves, never shared within one. Sidebar, top bar, schema, migration, `scoped-db.ts`, `delete.ts` and the inbox service each have a single owner.
- **Races.** Every new or extended read needs PID-bound interleavings (organization-member removal, project-member removal, privacy change, move), and K90 needs delete against save in both orders. The plans reuse `project-read-race.ts` and `lock-wait.ts` unchanged and keep the cases table-driven, never using sleeps.
- **The drawer mechanism is unverified in this repo.** The `@drawer` slot changes the (app) layout for every page, so 15-18 also runs the existing (app) E2E smoke specs. If the intercepting route fails its E2E, D-02's `?task=` fallback applies and is recorded. `TaskLink` keeps the views independent of that choice.
- **Test runtime.** About 17 new E2E specs plus mouse and keyboard pairs. Moves are batched per page load with one reload and one Prisma read-back, the Playwright config stays at one worker, and specs use `expect.poll` for first-hit 404s. Each long run writes a log, and only one test process runs at a time.
- **Raw SQL and the migration.** The NULLS NOT DISTINCT upsert, the scope-aware partial indexes, the ILIKE escaping and the group counts in the same statement are the riskiest SQL. 15-02 keeps every hand-written object and strips generated drops, and populated-data and schema tests prove the result before any service writes a PROJECT row.
- **Dates.** Off-by-one shifts across month and year ends, 29 February and daylight-saving days are contained by a single date module (15-06) with unit tests, CalendarDate strings end to end, today from the server, and the two time-zone E2E runs.


**Orchestrator amendment (2026-11-10, after plan 15-11):** 15-11 depends on 15-10 as well (its Task 3 needs `KEY_PREFIX_EXAMPLE` and the `/projects` page) and moves to wave 5; 15-19 depends on 15-11 and moves to wave 6. Nothing else moves: 15-24 (wave 8) already waits for both.


**Orchestrator amendment (2026-11-10, after plan 15-18):** 15-18 Task 3 proves the 768px layout on the Board, Table, Calendar and Timeline tabs and re-runs the 15-11 and 15-13 specs, so 15-18 depends on 15-11, 15-13, 15-14, 15-15, 15-16 and 15-17 and moves to wave 6. Plans that wait for it move one wave later: 15-21 to wave 7, 15-23 to wave 8, 15-24 to wave 9, 15-25 to wave 10. 15-19, 15-20 and 15-22 keep their waves (6, 6, 7). Plans run one at a time, so the extra waves cost no time.

## OUTLINE COMPLETE
