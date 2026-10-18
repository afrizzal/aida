# Phase 15: Work Views - Pattern Map

**Mapped:** 2026-11-10 (code at `16842c7`, branch `v2/run-loop`)
**Files analyzed:** 58 new or modified files, grouped below
**Analogs found:** 52 / 58 (6 with no analog, listed at the end)
**Clean-room:** this map names no reference product and copies nothing from one. All analogs are AIDA's own tracked source (`git ls-files` origin; no gitignored mirrors).

## 0. Findings that change or sharpen CONTEXT

- **C1 (P1, confirmed): no read of addable workspace members exists.** `src/lib/projects/members.ts` exports `activeOrgUserIds(db, orgId, userIds)` (`:66`), an in-transaction helper that takes a `ProjectDb` and so cannot be called from Phase 15 code under D-04, plus `listProjectMembers` (`:148`) and `listEligibleAssignees` (`:193`, project assignees only). The only `member.findMany` reads outside projects are ticket loaders (`src/lib/tickets/ticket-detail-data.ts`, `list-panel-data.ts`), and D-04 forbids routing around the scan. The contract-amendment plan must add one READ operation (for example `listAddableProjectMembers(actor, projectId)`: MANAGE on the project, active org members not already direct members, keyset-paged) to `PROJECT_OPERATIONS` (`contract.ts:395`) with an isolation block. Add it to the D-05 list; it is not optional, the Members dialog (UI-SPEC 3f) cannot work without it.
- **C2 (P2): the workspace Tasks form needs no new `viewKind`.** Keep `?form=` in the URL as the UI-SPEC says. But D-18 stores grouping, columns and sort "per form" with `projectId = null`; with one `viewKind` per (user, project, kind) the planner must key them as `LIST`, `BOARD`, `TABLE` with `projectId` null, which collides with nothing because the project rows carry a project id. Record this mapping in the contract amendment so the unique index `(organizationId, userId, projectId, viewKind) NULLS NOT DISTINCT` is read the same way by every plan. Also note `FILES` and `PROJECT_LIST` are the only kinds outside the task views.
- **C3 (P3): adopt the UI-SPEC grid keyboard model as a recorded deviation from D-12's wording.** "Tab moves to the next cell" holds only in edit mode; otherwise the grid is one Tab stop with roving `tabIndex`. The E2E for D-12 must assert Tab-in-edit moves cell to cell and Tab-outside-edit leaves the grid. No analog exists in the repo for a roving-tabindex grid (see No Analog).
- **C4 (P4): "Move down" at the loaded end is disabled, not auto-loaded.** `ReorderTaskInput` (`ordering.ts:31-36`) takes `placeAfterTaskId` only; "Move down" from position n needs the card at n+1 as anchor. The disabled reason copy is in the UI-SPEC. "Move to {status}" uses `placeAfterTaskId: null` (top). The planner must state that "Move up" uses the card two above as anchor (or null when the target is first): this is the one non-obvious anchor rule and needs a unit test in the drag/move helper.
- **C5: the inbox saved-view service writes and deletes by id plus organization only.** `updateSavedView` uses `where: { id: view.id, organizationId }` (`src/lib/saved-views/service.ts:396`) and `deleteSavedView` the same (`:427`); the list reads at `:314` and `:319` filter by owner or `visibility` only. Once `PROJECT` rows exist in the same table, every one of these, and every read inside `createSavedView` (`:230`) and `getSavedViewForPanel` (`:464`), must add `scope: "INBOX"`, or an inbox action called with a project view id would rename or delete it (and a shared-list read would not see it only because project views are forced PRIVATE). D-17 says "every read and write"; make the test enumerate these six call sites by line.
- **C6: `SavedView` has no Project relation today.** `prisma/schema.prisma:667-684` relates only to `organization` and `user` (both `onDelete: Cascade`). The composite relation of D-17 needs `Project @@unique([organizationId, id])`; verify it exists in the Phase 14 model before writing the migration (the Phase 14 child tables use composite relations, so it most likely does, but this map did not read that model). The view-state model needs the same.
- **C7: the ticket download route is a worse analog than CONTEXT states.** Beyond the org-only lookup (`src/app/api/attachments/[id]/route.ts:22`) and no `nosniff`, it sends the stored `mimeType` unfiltered as `Content-Type` and builds `filename="${encodeURIComponent(...)}"` (`:31-33`), which is neither RFC 5987 `filename*` nor safe ASCII. Copy only its `Cache-Control: private, no-store` and the `new Response(new Uint8Array(buffer))` body shape; write the header block fresh per D-16.
- **C8: no case-insensitive search precedent exists in `src/lib/projects/`.** `grep 'contains\|mode: "insensitive"'` over the directory prints nothing. Research point 4 stays open; the K76 search must escape `%`, `_` and `\` itself if it uses raw SQL `ILIKE` (raw SQL is also the only way to keep `readableProjectSql` (`access.ts:424`) in the same statement for the group counts).
- **C9: `listProjects` cursor shape already matches K76.** `encodeProjectCursor` and `decodeProjectCursor` (`projects.ts:617-632`) hold only `[id]` and refuse `INVALID_INPUT` on anything else. The new sorts re-read the anchor's sort key under the predicate; do not widen the cursor to carry the sort value (that would leak `position` for `manual`, K71).
- **C10: `next.config` sets no `serverActions` limit (confirmed by grep).** The upload stays a route handler (D-16). Do not add `serverActions.bodySizeLimit` as a shortcut; that would widen every action.
- **C11: the sidebar active rule is `pathname.startsWith(href)` (`src/components/sidebar.tsx:61`).** `/tasks` must light "Projects", not anything else, and `/workspace` "Tasks"; the UI-SPEC's explicit `match` prefix list is required, because `startsWith("/projects")` alone would leave `/tasks/[id]` unlit. `navItems` is at `:24-30` (CONTEXT says `:24-28`; the array closes at `:30`).
- **C12: `deleteProject` insertion point.** The child deletes run at `src/lib/projects/delete.ts:250-255` and the Project row at `:256` (`tx.project.deleteMany`, then `refuse("NOT_FOUND")` on count ≠ 1). K90's two new `deleteMany` calls go after `:255` and before `:256`, each with `organizationId` and `projectId` (Phase 14 D-01 form). The race test reuses `tests/support/lock-wait.ts` against a concurrent view-state upsert.
- **C13: no `src/app/(app)/projects`, `tasks`, `workspace` or `src/app/api/projects` directory exists yet**, and there is no `src/components/projects/`. Every UI file in this phase is new; analogs come from tickets and KB.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/projects/contract.ts` (mod: new ops K76, C1, D-17, D-18) | config | n/a | itself `:395-580` (`op(...)` rows) | exact |
| `.planning/phases/14-projects-foundation/14-CONTRACT.md` (mod) | contract doc | n/a | its section 0 amendment rule | exact |
| `src/lib/projects/projects.ts` (mod: `listProjects` q/statuses/sort) | service | CRUD read, keyset | itself `:603-695` | exact |
| `src/lib/projects/tasks.ts` (mod: windows, filters, sorts, group counts, list-item fields) | service | CRUD read, keyset | `listProjectTasks` `:1133`, `listWorkspaceTasks` `:1195` | exact |
| `src/lib/projects/members.ts` (mod: addable members, C1) | service | read | `listEligibleAssignees` `:193` | exact |
| `src/lib/projects/delete.ts` (mod: K90) | service | transaction | itself `:250-256` | exact |
| `src/lib/projects/saved-views.ts` (new: project views) | service | CRUD | `src/lib/saved-views/service.ts` (shape) + `src/lib/projects/favorites.ts` (access) | role-match |
| `src/lib/projects/view-state.ts` (new: K82) | service | upsert | `src/lib/projects/favorites.ts:38-75` | role-match |
| `src/lib/projects/view-payload.ts` (new: strict versioned schema) | utility | transform | `src/lib/tickets/list-filters.ts` (stored filters versioning) | role-match |
| `src/lib/saved-views/service.ts` (mod: `scope: "INBOX"`, C5) | service | CRUD | itself | exact |
| `prisma/schema.prisma` (mod: SavedView scope/projectId, view-state model) | model | n/a | `SavedView` `:667-684` | exact |
| `prisma/migrations/<ts>_work_views/migration.sql` (new) | migration | n/a | `prisma/migrations/20261113100000_projects_foundation`, `20261108140000_inbox/migration.sql:77-83` | exact |
| `src/lib/scoped-db.ts` (mod: `DOMAIN_MODELS` `:14`) | config | n/a | itself | exact |
| `src/app/(app)/projects/actions.ts`, `src/app/(app)/tasks/actions.ts`, `src/app/(app)/workspace/actions.ts` (new) | server action | request-response | `src/app/(app)/kb/proposals/actions.ts` | exact |
| `src/lib/projects/outcome.ts` (new) | utility | transform | `src/lib/kb/proposal-outcome.ts:50`, `:216` | exact |
| `src/lib/projects/ui-copy.ts` (new) | utility | n/a | `src/lib/kb/proposal-copy.ts` (+ `tests/unit/proposal-copy.test.ts`) | exact |
| `src/lib/projects/colors.ts` (new) | utility | transform | `src/lib/tickets/state-colors.ts:7`, `:32` | exact |
| `src/lib/projects/calendar-date.ts` (new) | utility | transform | `contract.ts:630-692`, `recurrence-rules.ts:88` (`addDays`) | exact |
| `src/app/(app)/projects/page.tsx`, `loading.tsx`, `error.tsx` | route | request-response | `src/app/(app)/tickets/page.tsx`, `tickets/error.tsx` | role-match |
| `src/app/(app)/projects/[projectId]/layout.tsx` + `page.tsx`, `list/`, `board/`, `table/`, `calendar/`, `timeline/`, `files/`, `activity/` | route | request-response | `src/app/(app)/tickets/layout.tsx`, `tickets/[id]` | role-match |
| `src/app/(app)/tasks/[taskId]/page.tsx` + intercepting `@drawer/(.)tasks/[taskId]/page.tsx` + `@drawer/default.tsx` | route | request-response | none for intercepting routes | partial |
| `src/app/(app)/workspace/{tasks,calendar,timeline}/page.tsx` | route | request-response | `src/app/(app)/tickets/page.tsx` | role-match |
| `src/app/api/projects/attachments/[attachmentId]/route.ts` | route handler | file-I/O download | `src/app/api/attachments/[id]/route.ts` (partial, see C7) | partial |
| `src/app/api/projects/tasks/[taskId]/attachments/route.ts` | route handler | file-I/O upload | `src/app/api/tickets/[id]/messages/route.ts` (`:71-74`) | role-match |
| `src/components/ui/sheet.tsx` | component | n/a | `src/components/ui/dialog.tsx` | exact |
| `src/components/projects/*` (header, tabs, toolbar, group header, quick add, task-view, move-menu, view-announcer, drag-layer, chips, project-icon, outcome-callout) | component | event-driven | tickets components (below) | role-match |
| `src/components/projects/bulk-bar.tsx` | component | request-response | `src/app/(app)/tickets/bulk-action-bar.tsx`, `bulk-actions.ts` | exact |
| `src/components/projects/saved-views-menu.tsx` + dialogs | component | CRUD | `tickets/save-view-dialog.tsx`, `delete-view-dialog.tsx`, `saved-view-actions.ts` | exact |
| `src/components/sidebar.tsx`, `src/components/top-bar.tsx` (mod) | component | n/a | themselves | exact |
| `tests/unit/project-operation-inventory.test.ts`, `project-contract.test.ts` (mod) | test | n/a | themselves | exact |
| `tests/unit/project-import-boundary.test.ts` (new, D-04) | test | n/a | `tests/unit/design-tokens.test.ts` (file scan) | role-match |
| `tests/unit/project-calendar-date.test.ts`, `project-colors.test.ts`, `project-outcome.test.ts`, `project-copy.test.ts`, `project-view-payload.test.ts` | test | n/a | `proposal-outcome.test.ts`, `proposal-copy.test.ts`, `project-recurrence-rules.test.ts` | exact |
| `tests/integration/project-views-isolation.test.ts`, `project-views-race.test.ts`, `project-two-worlds.test.ts`, `saved-views-scope.test.ts`, migration test | test | n/a | `project-tasks-isolation.test.ts`, `project-read-access-race.test.ts`, `saved-views.test.ts`, `projects-schema.test.ts` | exact |
| `tests/e2e/projects-*.spec.ts` (list, drawer, list-bulk, board, table, calendar-tz, timeline, files, workspace-privacy, saved-views) + `a11y-contrast.spec.ts` (mod) | test | n/a | `tests/e2e/bulk-actions.spec.ts`, `saved-views.spec.ts`, `attachments.spec.ts`, `a11y-contrast.spec.ts` | role-match |

## Pattern Assignments

### Contract amendments (`contract.ts`, `14-CONTRACT.md`)
**Analog:** `src/lib/projects/contract.ts:395-402`:
```ts
export const PROJECT_OPERATIONS = Object.freeze({
  createProject: op("projects", "MEMBER", "NONE", ["PROJECT_CREATED"], "CREATE"),
  getProject: op("projects", "READ", "NONE", [], "TARGET"),
  listProjects: op("projects", "READ", "NONE", [], "LIST"),
```
Copy: every new read is `op(<module>, "READ"|"MEMBER"|"MANAGE", "NONE", [], "LIST"|"TARGET")`; view-state and project saved views write `[]` verbs (no activity, D-17, D-18). If a new module name is needed (`"views"`), extend `PROJECT_MODULES` (`:234`) in the same commit. Constants live next to `LIST_MAX` (`:278`): add the view payload max (4096), the window bound (≤1000), the search length (80). One commit for `contract.ts` + `14-CONTRACT.md` + `tests/unit/project-operation-inventory.test.ts` (section 0 rule).

### `listProjects` and task-read extensions (`projects.ts`, `tasks.ts`)
**Analog:** `projects.ts:617-645` cursor and signature (quoted in C9); filters interfaces `tasks.ts:1117-1125` (`ListProjectTasksFilters`) and `:1179-1187` (`ListWorkspaceTasksFilters`, currently `dueFrom`/`dueTo` only).
Copy: extend the existing option objects (no new positional args); keep `null` meaning "unassigned"; keep `listLimit` (`service.ts:99`) and `encodeKeyset`/`decodeKeyset` (`service.ts:118`, `:126`); run under `runProjectRead` (`service.ts:226`) and call `afterReadCheck` (`service.ts:90`) so `tests/support/project-read-race.ts` can pause the read. The predicate goes in the same query through `readableProjectWhere` (`access.ts:386`) or `readableProjectSql` (`access.ts:424`) for raw SQL. **Avoid** `readableProjectIds` (`access.ts:435`): it reads ids first and reuses them, which K73 forbids for these reads. Group counts: one extra `groupBy`/raw `COUNT ... GROUP BY` in the same `runProjectReadInTransaction` (`service.ts:241`).

### Addable members (C1, `members.ts`)
**Analog:** `listEligibleAssignees` (`members.ts:193`) for the public signature and access; `activeOrgUserIds` (`:66`) is the internal helper it can call inside the transaction.

### `deleteProject` (K90)
**Analog:** `delete.ts:250-256` (quoted in C12). Copy the `tx.<model>.deleteMany({ where: { organizationId: orgId, projectId } })` line twice (saved views with `scope: "PROJECT"`, view-state rows).

### Project saved views and view state (`src/lib/projects/saved-views.ts`, `view-state.ts`)
**Analogs:** owner-only CRUD shape from `src/lib/saved-views/service.ts` (`createSavedView` `:230`, `updateSavedView` `:372`, `deleteSavedView` `:417`, name max `MAX_VIEW_NAME_LENGTH` `:44`); access and transaction shape from `src/lib/projects/favorites.ts` (`favoriteProject` `:38`, `unfavoriteProject` `:55`: allowed on archived projects, no activity, READ on the project).
**Avoid:** `findActiveMembership` (`src/lib/membership.ts:28`) used by the inbox service; use `findConservativeMembership` (`src/lib/membership.ts:79`) via the projects access path (`requireMembership`, `access.ts:78`). Results use `ProjectResult` (`contract.ts:369`), not `SavedViewError` (`service.ts:60`), so the one outcome map covers them. View-state upsert: raw `INSERT ... ON CONFLICT ON CONSTRAINT/INDEX ... DO UPDATE` (Prisma `upsert` cannot target a `NULLS NOT DISTINCT` index).

### Migration
**Analog:** newest migration `prisma/migrations/20261113100000_projects_foundation/migration.sql` (header lists hand edits) and the partial indexes `20261108140000_inbox/migration.sql:77-83`. Copy the header format; drop the old partial indexes and recreate them with `AND "scope" = 'INBOX'`; write `UNIQUE NULLS NOT DISTINCT`, the two CHECKs and the 4096-byte `octet_length(state::text)` CHECK by hand. Parity test: `tests/unit/project-schema-parity.test.ts`; schema test: `tests/integration/projects-schema.test.ts`.

### Server actions (all `actions.ts` files)
**Analog:** `src/app/(app)/kb/proposals/actions.ts:1-25` (header and imports), `:43` (`ActionUnknown`), `:51` (`unknownResult`), `:60` (`revalidateAfterCommit`), `:78-87` (body):
```ts
): Promise<ProposalRequestResult | ActionUnknown> {
  ... try { const actor = await getSessionActor(); result = await service(actor, ...); }
  catch (error) { unstable_rethrow(error); return unknownResult("request"); }
  if (result.ok) revalidateAfterCommit([PROPOSALS_PATH, proposalPath(result.proposalId)]);
```
Copy exactly: `"use server"`, `unstable_rethrow` first in every catch, no error message in the result, revalidation in its own try. Import only from `@/lib/projects/*`, `@/lib/saved-views/*`, `@/lib/session`. **Avoid** the admin guard in `src/lib/authz.ts` (named in the header as pattern finding C1 of 12.2).

### Outcome map and copy (`outcome.ts`, `ui-copy.ts`)
**Analog:** `src/lib/kb/proposal-outcome.ts:50` (`ACTION_UNKNOWN_CODE = "UNKNOWN"`), `:216-221` (`resolveActionOutcome` switches on `ACTION_UNKNOWN_CODE` first), `src/lib/kb/proposal-copy.ts`, tests `tests/unit/proposal-outcome.test.ts`, `proposal-copy.test.ts`. Key the map on `PROJECT_REFUSAL_CODES` (`contract.ts:133`) with an exhaustiveness test (a missing code fails). Reuse `ACTION_UNKNOWN_CODE`; do not define a second "UNKNOWN".

### Colour map (`colors.ts`)
**Analog:** `src/lib/tickets/state-colors.ts` (`STATE_COLOR_KEYS` `:7`, `STATE_COLORS` `:32`): full literal class strings per key so Tailwind sees them, gray fallback. Map keys from `PROJECT_COLORS` (`contract.ts:158`), `violet` → `state-purple`. Test like `tests/unit/design-tokens.test.ts` + `state-copy.test.ts`.

### Date math (`calendar-date.ts`)
**Analog:** `contract.ts:630` `parseCalendarDate`, `:648` `fromCalendarDate`, `:655` `toCalendarDate`, `:676` `todayInTimeZone`; `recurrence-rules.ts:88` `addDays(date, days)` already does UTC day arithmetic. Re-export or call these; add only month grid, week start (Monday), shift-both-ends and formatting. Test analog: `tests/unit/project-recurrence-rules.test.ts`.

### Download route (`/api/projects/attachments/[attachmentId]`)
**Analog (partial):** `src/app/api/attachments/[id]/route.ts:18-36`. Keep `new Response(new Uint8Array(buffer), { headers })` and `Cache-Control: private, no-store`. Replace the lookup with `getTaskAttachmentForDownload` (`attachments.ts:170`), and the headers per D-16 (C7). 404 body and 403 body are fixed `text/plain` constants from `ui-copy.ts`; a unit or integration test compares bytes across missing, unreadable, moved and revoked.

### Upload route (`/api/projects/tasks/[taskId]/attachments`)
**Analog:** `src/app/api/tickets/[id]/messages/route.ts` (validates every file before storing any, `:71-74`); the service `uploadTaskAttachments` (`attachments.ts:219`) already runs `src/lib/attachments/validate-upload.ts`. Route only parses `formData`, gets the actor, calls the service, maps the result to JSON with a fixed status. Keep `src/proxy.ts` `PUBLIC_PREFIXES` (`:4`) and `BLOCKED_PUBLIC_ROUTES` (`:30`) unchanged; `tests/unit/proxy.test.ts` proves both routes stay private.

### Pages, loaders, error and loading
**Analogs:** `src/app/(app)/tickets/page.tsx`, `tickets/layout.tsx`, `tickets/error.tsx` (error boundary pattern for Surface 18), `src/components/ui/skeleton.tsx`, `src/components/empty-state.tsx` (DS §4.3). Not-available: `notFound()` from the page on any NOT_FOUND result (K74). Drawer route: no in-repo analog for `@slot`/`(.)` (see No Analog); `default.tsx` returning `null` is required (UI-SPEC, C7 check).

### UI components
- `sheet.tsx`: copy `src/components/ui/dialog.tsx` overlay and content wrapper, change position classes per UI-SPEC "New modules".
- Bulk bar: copy `src/app/(app)/tickets/bulk-action-bar.tsx` (sticky bar shape, `aria-live`) and `tickets/bulk-actions.ts` (action file), limited to `BulkTaskPatch` fields (`bulk.ts:46-54`), `BULK_MAX` (`contract.ts:274`).
- Selection: `src/app/(app)/tickets/ticket-selection.tsx` (selection state and shift-range).
- Filter chips: `tickets/filter-chip-row.tsx`; search box: `tickets/ticket-search-input.tsx`.
- Saved views UI: `tickets/save-view-dialog.tsx`, `delete-view-dialog.tsx`, `saved-view-actions.ts`, `saved-view-strip.tsx` (active chip).
- Missing-reference notice: `tickets/missing-status-notice.tsx` (warning notice for stale saved-view references, D-17).
- Focus after list actions: `tickets/list-panel-focus.tsx`.
- Sidebar: `src/components/sidebar.tsx:24-30`, `:61` (C11); top bar `src/components/top-bar.tsx` `pageTitles`.

### Tests
- Isolation and two worlds: `tests/integration/project-tasks-isolation.test.ts`, fixtures `tests/support/project-fixtures.ts` (section 17 actors).
- Races: `tests/integration/project-read-access-race.test.ts` with `tests/support/project-read-race.ts`, `lock-wait.ts`.
- Delete: `tests/integration/project-delete.test.ts`, `project-feed-delete-race.test.ts`, `tests/support/project-hard-delete.ts`.
- Inbox unchanged: `tests/integration/saved-views.test.ts`, `saved-views-ui-state.test.ts`.
- E2E: `tests/e2e/saved-views.spec.ts`, `bulk-actions.spec.ts`, `attachments.spec.ts`, `keyboard.spec.ts`, `a11y-contrast.spec.ts`; helpers `tests/e2e/support/`.

## Shared Patterns

- **Authorization (all actions, pages, routes):** `getSessionActor()` (`src/lib/session.ts:53`) then one `src/lib/projects/*` call. No `@/lib/db`, Prisma, `scopedDb`, `getScopedDb` import (D-04 scan).
- **Result shape:** `ProjectResult` (`contract.ts:368-369`) plus `ActionUnknown`; UI reads it only through `outcome.ts`.
- **Read predicate:** `readableProjectWhere` / `readableProjectSql` in the same statement; never `readableProjectIds` for listed rows.
- **Paging:** `listLimit` (over max is INVALID_INPUT), keyset cursor with id tie-breaker, `hasMore` + `nextCursor`.
- **Design:** token-only, `text-[Npx]`, `EmptyState`, `state-*` via `colors.ts`, Buttons with `className="text-[13px]"`.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `@drawer` parallel slot + `(.)tasks/[taskId]` intercepting route | route | No parallel or intercepting route in `src/app` yet; follow Next 16 docs (Context7) and the D-02 fallback |
| `src/components/projects/drag-layer.tsx` | component | No Pointer Events drag in the repo (K78, no package) |
| Table roving-tabindex grid | component | No ARIA grid in the repo (C3) |
| Calendar month and week grid | component | No calendar UI in the repo |
| Timeline CSS grid | component | No timeline UI in the repo |
| `view-state.ts` `NULLS NOT DISTINCT` upsert | service | No such index or raw upsert in Phase 14 |

## Metadata

**Analog search scope:** `src/lib/projects`, `src/lib/saved-views`, `src/lib/kb`, `src/lib/tickets`, `src/lib/membership.ts`, `src/app/(app)`, `src/app/api`, `src/components`, `prisma`, `tests/{unit,integration,support,e2e}`.
**Verified in code at `16842c7`:** every file:line above except the Project composite unique (C6) and the exact line of `tickets/[id]/messages/route.ts:71-74` (taken from CONTEXT, not re-read).
