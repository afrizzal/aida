# Phase 14: Projects Foundation - Context

**Gathered:** 2026-11-09, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for planning (no UI in this phase, so the UI design contract step does not apply)
**Sources:** facts checked against the code at `77d77e6`; Codex brainstorm `run-loop/codex/fase14-jawab.md` (round 1, areas 1 to 11); orchestrator decisions K61 to K64 in `run-loop/RUN-LOG.md`, taken under charter rule 4 (when Claude and Codex differ on security, authorization or schema, take the most conservative option and report it to the owner). Every Codex claim used below was re-checked in the code unless marked *unverified*.

<domain>
## Phase Boundary

Phase 14 builds the **data and logic layer** of the Projects module only: schema, migrations, database constraints and triggers, and typed services in `src/lib/projects/` (the directory does not exist at `77d77e6`) for projects, project members, tasks, subtasks, comments, attachments, labels, milestones, teams, favorites, task keys, recurrence and activity. No UI, no pages, no server actions and no API routes. Phase 15 builds the views and the actions on these services; Phase 16 builds the workspace pages. Requirements AIDA-64 to AIDA-71 and AIDA-100 to AIDA-105 in `.planning/REQUIREMENTS.md`; ROADMAP Phase 14 success criteria 1 to 7. No feature beyond them.

Parts that belong to later phases: AIDA-71 itself says search and notifications inherit the privacy rule in Phase 16, ticket links and AI suggestions in Phase 17. AIDA-105's display in the Timeline (AIDA-78, Phase 15) and the workspace overview (AIDA-107, Phase 16) is built there, on the reads built here. Guests and role settings are AIDA-110 (Phase 16); invitations and role management are AIDA-42 and AIDA-43 (Phase 10, parked). A per-user time zone is AIDA-98 (Phase 16).

**Clean-room.** The feature list follows a reference product whose repository has no licence: "tanpa lisensi, menurut owner 2026-11-08" (charter, owner rule E and section "Clean-room modul Projects"). The only allowed sources are `run-loop/FITUR-PROJECTS.md` and the demo behaviour recorded there. Nothing is copied: no code, CSS, colour tokens, special icons, UI text, sample data, exact layout or product name. The repository is not cloned, fetched or opened, and the demo's JS and CSS bundles are not read. The reference product is never named outside `.planning/`. At the end of the phase, `git grep -i -n gr8r -- src docs website README.md public prisma tests` must print nothing (it prints nothing at `77d77e6`). If code or an asset of the reference product enters the repo, it is removed with a new commit, and the run stops and reports.

Phases 8, 9 and 10 stay **parked**: `getScopedDb` (`src/lib/session.ts:38-43`) does not check membership; in this run "active member" means the `member` row exists (`src/lib/membership.ts:4`); AIDA-43 (deactivation) stays open (O-3).

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex area N" is section N of `run-loop/codex/fase14-jawab.md`. "Orchestrator" means the run-loop orchestrator decided it (run decisions are logged in `run-loop/RUN-LOG.md`). "Charter rule 4" means the conservative option was taken on security, authorization or schema.

### Tenancy and data model

- **D-01:** Every new model carries `organizationId`, is added to `DOMAIN_MODELS` (`src/lib/scoped-db.ts:14-39`), and every query **also** writes the organization term explicitly. `scopedDb` injects the term only on `create`, `upsert` and the operations in `WHERE_SCOPED_OPERATIONS` (`findMany`, `findFirst`, `count`, `update`, `updateMany`, `delete`, `deleteMany`; `scoped-db.ts:55-64`, `91-99`). It does not touch `findUnique`, `findUniqueOrThrow`, `findFirstOrThrow`, `aggregate`, `groupBy`, `createMany`, `createManyAndReturn`, `updateManyAndReturn` or raw SQL. Composite foreign keys: every project-owned row references `(organizationId, projectId)`; a relation that must stay inside one project (subtask parent, comment, attachment, task milestone, task label) references `(organizationId, projectId, taskId)` or the equivalent composite target, so the database itself refuses a cross-project or cross-organization link. Isolation is proven by unmocked Testcontainers tests with two organizations. Source: charter "Aturan teknis AIDA"; Codex area 1; orchestrator.
- **D-02:** Models: Project; ProjectMember (role `manager` or `member`); Task; TaskComment; TaskAttachment; Label (per project); Milestone (per project, dated); Team; TeamMember; ProjectTeam; ProjectFavorite and TaskFavorite (per user, unique); a TaskKey namespace (D-08); ProjectActivity (D-05). Exact names are the planner's. Project fields follow AIDA-64 and AIDA-100 (name, colour, order, icon, description, status, due date) plus privacy, key prefix and `archivedAt`; task fields follow AIDA-65 and AIDA-101 (status `backlog`, `todo`, `in_progress`, `review`, `done`; assignee; start and due dates; priority; labels; estimate; Markdown description; milestone from AIDA-105) plus what D-03 and D-08 to D-12 need. The task-label link and any recurrence series table are implied and named by the planner. TaskAttachment is a **new** model that reuses the storage, size, type and staging pipeline of `src/lib/attachments/`; the ticket `Attachment` stays message-bound (`messageId` is required, `prisma/schema.prisma:438`, `445`). Better Auth's `member` table has no unique key on `(organizationId, userId)` (`prisma/schema.prisma:129-140`; owner item 12.2-o4), so a foreign key from ProjectMember or TeamMember to one `member` row would be ambiguous (Codex area 1). Access re-reads the organization member rows on every call (D-04, D-15), so a removed organization member loses access even when a ProjectMember or TeamMember row remains. Source: Codex area 1; orchestrator.
- **D-03:** Subtasks are `Task.parentId`, **one level only**: a subtask cannot have subtasks, and parent and subtask share project and organization (composite foreign key, D-01). This is enforced in the database, not only in services. A CHECK cannot read another row, so a trigger enforces "the parent has no parent" and "a task with subtasks cannot become a subtask", with a lock protocol that the contract plan (D-17) defines and a PID-bound race test proves; a CHECK covers "parent is not the task itself". Services refuse the same cases first with typed codes. Source: Codex area 1 (Codex noted that if one level is read as narrowing AIDA-66 it is an owner question; no owner item was opened); orchestrator, run decision K61; charter rule 4.

### Access and privacy

- **D-04:** Private project access, conservative (run decision K62):
  - A **private** project is readable and writable only by active organization members who are direct project members or members of a team assigned to the project. Organization owners and admins do **not** bypass privacy by default (owner item 14-o1).
  - A **non-private** project is readable, and its tasks writable, by every active organization member.
  - Project settings, membership, privacy, archive and delete: project managers; for non-private projects also organization owner or admin. The creator becomes manager.
  - Membership reads use the conservative rule: all of the user's member rows in the organization, admin only if every row is owner or admin (`findConservativeMembership`, `src/lib/membership.ts:79-91`; run decision K59). `findActiveMembership` (`membership.ts:28-39`) is not used on new paths.
  - One shared policy module produces a **query predicate** for reads and a **check** for writes, applied to every path: detail, lists, aggregates, comments, attachment upload and every download, activity, key aliases, favorites and cross-project operations.
  - Lock protocol: content mutations take the project row `FOR SHARE` and check access inside the transaction; membership, team assignment and privacy changes take the project row `FOR UPDATE`. PID-bound race tests prove it (`tests/support/lock-wait.ts`).
  - The existence of a private project or task is never revealed to someone without access: the refusal is the same as for a missing id.

  Source: Codex area 2; orchestrator, run decision K62; charter rule 4.

### Activity and delete

- **D-05:** Activity (AIDA-68): one append-only `ProjectActivity` table; a database trigger refuses `UPDATE` and `DELETE`. It is written in the same transaction as the mutation, with actor, verb, entity type and id, project id, bounded before and after values, and a batch id. There is one record per changed entity per successful mutation, including create, comments, attachments, membership and team assignment, archive, restore, move, duplicate and delete. Favorites write none (a user preference); a no-op writes none. Rows store ids and short labels, never full descriptions or comment bodies. There is no foreign-key cascade from activity to projects or tasks, so activity survives deletion. Reading a feed requires current read access to the project (D-04). Pattern: `TicketAuditEvent` (`prisma/schema.prisma:661-676`, no relation to `Ticket`; trigger `aida_ticket_audit_event_immutable` in `prisma/migrations/20261108140000_inbox/migration.sql:95-106`; single write path `recordTicketAudit`, `src/lib/tickets/ticket-audit.ts:62`). Source: AIDA-68; Codex area 3; orchestrator.
- **D-06:** Delete audit (AIDA-103, AIDA-104): `AuditEvent` stays AI-only (Phase 11 D-07; its AI columns `provider`, `model`, `input`, `output` are required, `prisma/schema.prisma:465-483`). The delete record is the append-only `ProjectActivity` row (run decision K63). Three questions are owner item 14-o2, linked to 12-o1: whether that row satisfies "writes an audit event", who may read activity of deleted projects, and retention. The audit clause of AIDA-103 and AIDA-104 is claimed only as "recorded in ProjectActivity, owner confirmation pending". Source: 11 D-07; Codex area 3; orchestrator, run decision K63.
- **D-07:** Delete semantics (run decision K64): a service call with an explicit confirmation parameter hard-deletes the project or task together with its comments, attachments, subtasks and favorites in one transaction. Issued task keys stay reserved as tombstones (D-08). Attachment files are removed after commit by an idempotent pg-boss cleanup job. `AuditEvent` rows are never removed, and `ProjectActivity` rows stay (D-05). Source: Codex area 8 (Codex's first choice was a hidden soft-delete tombstone row); orchestrator, run decision K64; charter rule 4.

### Task identity and recurrence

- **D-08:** Task keys (AIDA-101, AIDA-103):
  - The project prefix is uppercase letters and digits, 2 to 10 characters, unique per organization, and reserved forever once used. A prefix change applies to new tasks; old keys keep working.
  - A counter per project is incremented atomically in the creating transaction. The concurrency test follows `TicketCounter` (model `prisma/schema.prisma:310-314`; upsert in `src/lib/tickets/create-ticket.ts:96-106`; test `tests/integration/create-ticket.test.ts:37-57`, 20 parallel creates, all numbers distinct).
  - One key namespace table, unique on `(organizationId, normalizedKey)`, holds active keys, aliases and tombstones.
  - A moved task gets a new key in the target project, and its old key becomes an alias.
  - The resolver checks current access (D-04) before revealing anything.
  - Duplicates get new keys.

  Source: Codex area 4; orchestrator.
- **D-09:** Recurrence (AIDA-102):
  - Rules are daily, weekly or monthly, on top-level tasks only.
  - The anchor is stored as a calendar date (`DATE`, not a timestamp), plus an IANA time zone per series. The default is `UTC` until user preferences exist (AIDA-98, Phase 16).
  - Monthly keeps the anchor day and clamps to the last day of shorter months, returning to the anchor day when it exists.
  - The next occurrence is created in the same transaction as the transition to `done`. A unique predecessor link ensures one occurrence yields at most one successor, even under retry, concurrency, or reopen and complete again.
  - The successor copies title, description, assignee, priority, labels, estimate and recurrence, shifts start and due dates by the rule, and starts open.
  - Today the schema has no `@db.Date` column and `src/lib` has no time-zone setting. `package.json` lists no date library; a new one follows the charter's package rules.

  Source: Codex area 5; orchestrator.

### Operations for Phase 15

- **D-10:** Ordering and the Phase 15 operations:
  - An integer rank with gaps orders top-level tasks within `(project, status)` and subtasks within their parent. It is rebalanced inside the transaction.
  - Reorder and status moves lock the project row `FOR UPDATE`.
  - Edits use a version column with conditional updates and a typed `CONFLICT`. Pattern: `saveProposalDraft`, `src/lib/kb/proposal-review.ts:257-295`, with the miss classification at `:202-223`.
  - Bulk update is atomic for at most 100 tasks: ids are validated and locked in id order, and each task gets one activity row with a shared batch id. Pattern: `runTicketMutation`, `src/lib/tickets/mutations.ts`: `MAX_BULK_TICKETS` at `:59`, one locking statement in id order at `:279-286`, result type at `:107-109`.
  - A date change with start after due is rejected in the service and by a CHECK. Dates are calendar dates.
  - Services in `src/lib/projects/` take the actor and organization from the server context (`getSessionActor`, `src/lib/session.ts:53-58`, does no membership check, so the service checks it). They return `{ ok: true, ... }` or typed refusal codes, as in Phase 12.2 (`src/lib/kb/proposal-contract.ts:234-249`).

  Source: Codex area 6; orchestrator.
- **D-11:** Progress and status (AIDA-100, AIDA-66):
  - Project progress is top-level tasks done divided by top-level tasks not archived; it is 0 for an empty project.
  - Task progress is subtasks done divided by subtasks not archived; it is 0 without subtasks.
  - Progress is computed on read, never stored or typed in.
  - Project status is a fixed set, `planning`, `active`, `at_risk`, `on_hold`, `completed`, independent of progress. Status changes write activity.

  Source: Codex area 7; orchestrator (AIDA-100 says the status set is decided in this CONTEXT).
- **D-12:** Archive and favorites (AIDA-70, AIDA-103): `archivedAt` exists on project and task. Archived items leave default lists and can be restored. An archived project is read-only except for restore. Favorites are unique per user and entity, and filtered by current access on read. Source: Codex area 8; orchestrator.
- **D-13:** Duplicate and move (AIDA-103, AIDA-104):
  - A project duplicate, with or without tasks, copies metadata, labels and milestones. With tasks, it also copies tasks and subtasks with status, priority, dates, labels, milestone mapping, and assignees who are still eligible. It never copies comments, attachments, activity, favorites, or members other than the duplicating user, who becomes manager. It needs a new unique prefix.
  - A task duplicate stays in its project and copies subtasks, not comments or attachments.
  - Move requires edit access to both projects and moves the whole tree. Moving a subtask alone is refused. Labels and milestone are mapped by name or cleared. A move writes one activity record.

  Source: Codex areas 2 and 8; orchestrator.

### Content, teams and AI

- **D-14:** Comments and attachments (AIDA-67):
  - Comment and description Markdown is untrusted. It renders through the sanitized path with remote images stripped and links safe (`src/lib/markdown/render.ts`, with `renderMarkdownPreview` as the reference).
  - File names are untrusted.
  - Attachment access is checked on upload and on every download.

  Source: AIDA-67; charter "Aturan teknis AIDA" (task content is untrusted input); Codex area 11; orchestrator.
- **D-15:** Teams (AIDA-69):
  - Teams are organization-scoped and built only from current active organization members. Membership is checked on every access and on every assignment.
  - Team management is for organization owner or admin, read conservatively (D-04).
  - Guests, invitations and role settings stay in Phase 16 (AIDA-110) and Phase 10 (parked). There is no pseudo guest role.

  Source: Codex area 9; orchestrator.
- **D-16:** No AI and no new egress in this phase. Source: orchestrator.

### Plan shape

- **D-17:** Freeze first: a contract plan fixes these before any other plan runs:
  - the access matrix
  - the invariants
  - the activity verbs
  - the key and date formats
  - the refusal codes
  - the delete contract

  Codex's suggested shape is about 10 to 12 plans in 5 waves: (1) the contract and owner items; (2) schema, migration and constraints, then the authorization service and isolation tests; (3) project, team and task CRUD, activity and attachments; (4) keys, move and duplicate, then recurrence, then reorder, bulk and progress; (5) cross-feature tests for all seven success criteria, the clean-room grep and the Phase 15 integration paths. Codex warns that parallel plans that each change the schema or define activity collide. The planner may reshape the waves but never drops scope. Source: Codex areas 10 and 11; orchestrator.

### Claude's Discretion

- Exact table and column names.
- Index choices.
- The rank gap size.
- Refusal code names.
- Test file layout.

All of these stay inside D-01 to D-17.

</decisions>

<specifics>
## Specific Ideas

### Points the contract plan must settle (D-17)

None of these is decided here. They come from Codex's risk notes and fall inside D-01 to D-16. The contract plan records its choice for each.

1. **Global lock order.** Covers two project rows in a move (Codex area 6), project rows before task rows in bulk, and what a TeamMember change locks. A TeamMember change alters access to every project the team is assigned to (Codex areas 2 and 9).
2. **Who assigns a team to a project.** D-04 groups team assignment with project membership (project managers). D-15 gives team management to organization owner or admin.
3. **The subtask trigger's lock protocol** (D-03).
4. **Cascades and recurrence in activity.** How "one record per changed entity" (D-05) applies to cascades, meaning subtasks, comments and attachments removed with their task or project, and to a recurrence successor (Codex area 11).
5. **Activity of a moved task that names the source project**, and what it shows in the target project (Codex area 2).
6. **Recurrence edge cases.** A task without start or due date, a change of the series time zone after creation (Codex area 5), and deleting a task that already has a successor (Codex area 11).
7. **Archive and progress edge cases.** Archiving a parent task with subtasks, and a parent `done` with open subtasks; D-11 progress shows the latter as is (Codex areas 7 and 11).
8. **The last manager.** Whether a service refuses removing or demoting the last manager of a project. An organization member removal, written by Better Auth outside these services, can still orphan a private project (14-o1).
9. **Formats and sets.** The task priority set, how a project icon is stored (no icon asset from the reference product), the scope of project order (AIDA-64), the key separator, and the counter limit (Codex area 4: format, length, overflow).
10. **Bounds.** The bounds of activity before and after values and of list reads (Codex area 11).

### Precedents

- **Not to follow:** the ticket attachment download route checks only the organization (`db.attachment.findFirst({ where: { id } })` through `scopedDb`, `src/app/api/attachments/[id]/route.ts:19-22`). Task attachments need the D-04 check on every download, in the service read that Phase 15's route will call.
- **Not to follow:** `findActiveMembership` reads one unordered member row; new paths use `findConservativeMembership` (K59).
- **Rendering.** `renderMarkdown` (`render.ts:53-55`) stamps safe links (`rehypeSafeLinks`, `:31-43`) and sanitizes, but does **not** strip remote images. `renderMarkdownPreview` (`:154-156`) strips every image source that is not same-origin relative (`rehypeStripCrossOriginImageSources`, `:86-104`), but it also renders every link inert (K58, `:106-137`). D-14 needs stripped images **and** live safe links. The planner builds that from the plugins in `render.ts`, which stays the one Markdown pipeline (`:12-15`).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/REQUIREMENTS.md`: AIDA-64 to AIDA-71 and AIDA-100 to AIDA-105 (acceptance text). For boundaries: AIDA-42, AIDA-43, AIDA-78, AIDA-98, AIDA-106, AIDA-107, AIDA-110.
- `.planning/ROADMAP.md`: Phase 14 (success criteria 1 to 7) and Phase 15, the consumer of these services.
- `.planning/run-loop/FITUR-PROJECTS.md`: the only allowed feature source (clean-room).

### Binding rules
- `.planning/run-loop/PIAGAM.md`: sections "Clean-room modul Projects", "Aturan owner 2026-11-08" (E and F), "Aturan teknis AIDA", "Test dan bukti", "Larangan" and "Aturan eksekutor".
- `.planning/run-loop/ANTREAN.md`: owner items 14-o1, 14-o2, 12-o1 and 12.2-o4.

### Decisions this phase builds on
- `.planning/run-loop/codex/fase14-tanya.md` and `.planning/run-loop/codex/fase14-jawab.md`: this phase's brainstorm.
- `.planning/run-loop/RUN-LOG.md`: run decisions K59 and K61 to K64.
- `.planning/phases/11-inbox/11-CONTEXT.md`: D-01 (membership check on new paths) and D-07 (`AuditEvent` AI-only; `TicketAuditEvent` append-only).
- `.planning/phases/12.2-ticket-lifecycle-knowledge-from-resolved-work/12.2-CONTEXT.md`: typed refusals, conditional updates with version, composite foreign keys, K59.

No design system reference: this phase has no UI.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Tenancy.** `scopedDb` and `DOMAIN_MODELS` (`src/lib/scoped-db.ts:14-39`, `66-106`).
- **Membership.** `findConservativeMembership` (`src/lib/membership.ts:79-91`) and `isAdminRole` (`:147-150`). `shareLockActiveMembership` (`:122-136`) locks every member row of the user `FOR SHARE` in id order; today only the 12.2 publish uses it.
- **Server context.** `getSessionActor` (`src/lib/session.ts:53-58`).
- **Counter.** `TicketCounter` (`prisma/schema.prisma:310-314`) and its upsert in the create transaction (`src/lib/tickets/create-ticket.ts:96-106`). Concurrency test: `tests/integration/create-ticket.test.ts:37-57`.
- **Attachments pipeline:**
  - `FileStorage` (`src/lib/attachments/file-storage.ts:3-11`).
  - `localFileStorage` with the `safeKey` path guard (`local-file-storage.ts:11-29`), and `buildStorageKey`, which never uses the file name for the path (`:31-42`).
  - `MAX_BYTES` and `ALLOWED_MIME` (`constants.ts:1-11`).
  - `saveStagedFiles` with `discard()` (`staged-files.ts:68-94`).
  - Usage: validate size and sniff the type with `file-type` before storing (`src/app/api/tickets/[id]/messages/route.ts:71-90`); stage before the transaction (`:98-104`); discard on refusal or error (`:163-169`).
- **Markdown.** `renderMarkdown`, `renderMarkdownPreview` and their plugins in `src/lib/markdown/render.ts` (see Specific Ideas).
- **Activity pattern:**
  - `TicketAuditEvent` (`prisma/schema.prisma:661-676`).
  - `recordTicketAudit` (`src/lib/tickets/ticket-audit.ts:62`): before and after are flat ids, enum values and booleans, never free text (`:5-7`, `:16-17`).
- **Append-only triggers.** `aida_audit_event_immutable` (`prisma/migrations/20260707053633_ai_foundation/migration.sql:45-57`) and `aida_ticket_audit_event_immutable` (`prisma/migrations/20261108140000_inbox/migration.sql:95-106`).
- **Bulk mutation.** `runTicketMutation` (`src/lib/tickets/mutations.ts`). The header at `:1-42` documents lock order, the error contract (typed refusal returned, other errors rethrown, `:30-32`) and the membership guarantee (`:34-37`).
- **Typed results and conditional updates.** `src/lib/kb/proposal-contract.ts` (refusal code arrays) and `src/lib/kb/proposal-review.ts:202-223`, `:257-295`.
- **Race helpers.** `tests/support/lock-wait.ts`: `deferred` (`:28-34`), `backendPid` (`:37-42`), `waitForBlockedBy` (`:50-77`).
- **Migration pattern.** `prisma/migrations/20261111100000_kb_proposals/migration.sql`:
  - header recording every hand edit of the generated diff: `:1-21`
  - composite unique targets: `:84`, `:96`, `:99`
  - composite foreign keys with `ON DELETE RESTRICT ON UPDATE RESTRICT`: `:102`, `:108`, `:114`, `:117`
  - CHECKs: `:126-154`
  - the status fence trigger: `:160-183`

  The schema side is `@@unique([organizationId, id])` (`prisma/schema.prisma:302`, `514`) and the composite relations of `KbProposalSource` (`:855-870`). `tests/support/migration-harness.ts` applies migration files to an isolated Testcontainers database (header `:1-11`).
- **Isolation test precedents.** `tests/integration/workspace-isolation.test.ts`, `tests/integration/kb-proposal-reader-isolation.test.ts`; shared container setup in `tests/integration/global-setup.ts`.

### Established Patterns
- Raw SQL always carries an explicit `organizationId` term (for example `mutations.ts:283`).
- Services return typed refusals and never raw errors. In Phase 12.2 they are refusal codes declared as `const` arrays.
- **Membership guarantee.** A plain member read inside the transaction refuses a removal committed before it; nothing stronger is claimed (`mutations.ts:34-37`). Organization `member` rows are written by Better Auth outside these services, so D-04's lock protocol covers project rows, not the `member` table.
- **Append-only tables and organization deletion.** `AuditEvent` and `TicketAuditEvent` keep `onDelete: Cascade` to `organization` (for example `prisma/schema.prisma:477`) while their triggers refuse `DELETE`. AIDA has no organization deletion (11 D-07). The same consequence applies to `ProjectActivity`: it is recorded, not solved.
- **Hand-written migration objects are preserved.** For example, the `searchVector` columns and indexes from `20260701234808_ticket_search` are invisible to Prisma. The `migrate dev --create-only` output is edited by hand and the edits are recorded in the header; never `prisma db push`.
- Modules read by both app and worker use relative imports only (charter; for example `membership.ts:6`, `ticket-audit.ts:12`).

### Integration Points
- `src/lib/scoped-db.ts` `DOMAIN_MODELS`: every new model.
- `prisma/schema.prisma`: new models and their `organization` back-relations (`model organization` at `:92`).
- The D-07 cleanup job: `src/lib/worker/index.ts` (queues are created before `work()`, `:25-27`) and `src/lib/queue/boss-client.ts` (app-side queue creation, `:20-59`).
- `src/lib/projects/` (new): the services Phase 15 calls.

</code_context>

<deferred>
## Deferred Ideas

- Views, pages, server actions and routes (Phase 15). Workspace pages, search, notifications, Activity page and Members page (Phase 16).
- Guests, invitations and role settings (AIDA-110 in Phase 16; AIDA-42 and AIDA-43 in parked Phase 10).
- A per-user time zone as the recurrence default (AIDA-98, Phase 16).
- Ticket-to-task links and AI suggestions on tasks (Phase 17).
- Subtasks deeper than one level.
- Organization owner or admin override of private projects, and recovery of an orphaned private project (14-o1).
- Activity retention and purge (14-o2).
- Row-level security as an extra layer. Codex area 2 mentioned it; no decision here uses it, and no RLS protection is claimed.
- Public share links (`FITUR-PROJECTS.md`, "Ada di demo, tidak dibangun").

</deferred>

## Owner items (not decided here)

### 14-o1: owner and admin access to private projects

- **Status:** `menunggu owner`.
- **Question:** do organization owners and admins see and manage private projects?
- **Default applied:** no (D-04).
- **Risk:** a private project is orphaned when its last manager leaves. The default recovery in this phase is none.
- **Blocks:** the final access rule for organization owners and admins on private projects, and any recovery path for an orphaned private project. The build itself is not blocked.

### 14-o2: the delete record as the audit event

- **Status:** `menunggu owner`. Linked to 12-o1.
- **Question:** is the `ProjectActivity` delete record the "audit event" that AIDA-103 and AIDA-104 ask for? How long is activity kept, and who may read activity of deleted projects?
- **Default applied:** append-only activity, no purge, readable only with current project access (D-05, D-06). Consequence: after a project is hard-deleted, nobody has current access to it, so no service returns its activity. The delete record of a task stays visible in the project feed to everyone with project access.
- **Blocks:** the literal claim of the audit clause of AIDA-103 and AIDA-104, which is claimed only as "recorded in ProjectActivity, owner confirmation pending".

### Related open owner items (unchanged here)

- **12-o1:** the AIDA-53 "full `AuditEvent`" wording.
- **12.2-o4:** a unique key on `(organizationId, userId)` in `member`. It is the reason for the conservative read.
- **O-1:** how container tests may run on the shared Docker VM. `pnpm test:egress` stays blocked (K26), and no compose-stack test runs.
- **O-3:** unparking Phases 8, 9 and 10. AIDA-43 stays open.

The orchestrator decided Codex's other owner flags in this CONTEXT: one subtask level (D-03), the default time zone (D-09), the progress formula and status set (D-11), and the duplicate content (D-13). No owner item was opened for them.

## Human boundary

The charter's phase table lists no human item for Phase 14. No UI is built, so visual, dark-mode and screen-reader items do not apply. Open for the owner: 14-o1 and 14-o2. No human verification is claimed.

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks. Write every human check as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. Every executor dispatch includes the charter's "Aturan eksekutor" section.

Binding for this phase:

- **Tests.**
  - Run against a real Postgres through Testcontainers, with no mocks for isolation. Cover two organizations and three actors: a member, a non-member of the same organization, and a user of another organization (AIDA-71).
  - Testcontainers needs the Colima socket environment that the orchestrator supplies.
  - Race tests are bound to backend PIDs (`waitForBlockedBy`), never to a sleep.
  - Time-dependent tests (recurrence) use an injected clock.
- **Migrations.**
  - Generate with `prisma migrate dev --create-only` against a scratch database inside the `aida-dev-db` container (`127.0.0.1:55432`, same image as service `db`), with `DATABASE_URL` given on the command line. Then run `prisma migrate deploy`, and drop the scratch database afterwards.
  - Never `prisma db push`.
  - Keep every hand-written SQL object. Remove any generated drop of one, and record the edits in the migration header.
  - An applied migration is final; a fix is a new migration.
- **Hard limits.**
  - No `rm -rf`. No `.env` change.
  - No new package without the charter's rules: pinned version; licence MIT, Apache-2.0, BSD or ISC; no new critical or high finding; reason recorded; never AGPL or GPL.
  - Clean-room rules as in the Phase Boundary, with the grep at the end of the phase.
  - No AI and no new egress (D-16). No paid API, no real email, no real credentials.
- **Process.**
  - One test process at a time. Long commands write to a log, and exit codes are read without a pipe.
  - Acceptance criteria point at the file where the code actually lives, and never contradict the plan's own action.
  - No edit after a review without a new review of that edit.
- **Requirements and repo.**
  - A requirement is closed only on acceptance and evidence. The audit clause of AIDA-103 and AIDA-104 follows D-06.
  - `RUN-LOG.md`, `LAPORAN.md`, `ANTREAN.md` and `REQUIREMENTS.md` belong to the orchestrator. Do not run `requirements mark-complete`.
  - Stage your own paths only, never `git add .`.

## Owner rules of 2026-11-08 (binding, summary)

- **D:** all code is written by Claude (Opus 5.5); Codex reviews only. GSD agents inherit the session model (`model_profile: inherit`); no `model` parameter on dispatch.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout. Temporary exports are deleted only by the round that made them.
- **E:** the reference repository for project management is, according to the owner (2026-11-08), without a licence and not the owner's. Only the "no licence" branch applies: clean-room only. Its licence is not re-checked, and the repository is not opened or fetched.
- **F:** owner-only decisions (licences, feature scope, anything that changes `PROJECT.md` or `REQUIREMENTS.md`) are not chosen here. They are recorded in `ANTREAN.md` as `menunggu owner`, with question, options and what they block, and treated as parked. Updating traceability status from acceptance and evidence is not an owner decision.
- **G:** no push.
- **A and B:** disk and Docker health are checked every round. Docker is never stopped, restarted or deleted.
- **Container rule:** only projects `aida` and `aida-dev-db`, plus the Testcontainers suites. `pnpm test:egress` stays blocked while O-1 is open (K26).

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

*Phase: 14-projects-foundation*
*Context gathered: 2026-11-09*

## Amendments after Codex plan review cycle 1 (run-loop orchestrator, 2026-11-09)

- **K69 (amends D-04 and D-15; charter rule 4):** team membership never grants access to a private project by itself. Assigning a team to a private project (a project-manager action) copies the team's current active members into direct `ProjectMember` rows in the same transaction and records it in activity; later changes to the team's membership do not change any private project's access (managers add or remove direct members). For non-private projects, a team assignment is informational, since every active organization member already has access. Reason: with live team-based access, any rule for who may add team members either lets an organization admin reach a private project through a team (against the 14-o1 default) or refuses only when a hidden private link exists, which reveals that link (Codex plan review cycle 1, finding 2). Owner item 14-o1 now also asks whether live team-based access to private projects is wanted.
- **Move activity (amends D-05 and D-13):** in a `TASK_MOVED` record, every side the reader cannot read is reduced to a fixed safe projection with no identifiers, names, labels, milestone or assignee of that side (Codex finding 1).
- **Better Auth member deletion is not serialized** against project writes; the services re-read membership inside their transactions, which narrows but does not close the window. This is a stated limitation tied to owner item 12.2-o4, not a claim that every revocation race is closed.
