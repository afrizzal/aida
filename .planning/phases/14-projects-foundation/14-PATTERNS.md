# Phase 14: Projects Foundation - Pattern Map

**Mapped:** 2026-11-09, against `v2/run-loop` at `4dbd34b` (code unchanged since `77d77e6`)
**Files analyzed:** 38 new or modified files (names are proposals; exact names are the planner's, D-17 discretion)
**Analogs found:** 34 / 38 (4 have no close analog: recurrence date math, progress, rank rebalance, cleanup outbox)
**Clean-room:** every analog below is AIDA's own tracked code (checked with `git ls-files`). No reference-product code, text, name or asset was opened or is named here. Feature source stays `run-loop/FITUR-PROJECTS.md` only.

---

## 0. Findings that change or sharpen CONTEXT

Each finding was checked in the code at the cited lines. C3 and C7's lock claim rest on SQL probes that were run on PostgreSQL 16 (`aida-dev-db`, image `pgvector/pgvector:pg16`, the same image as service `db`). The probes used TEMP tables inside `BEGIN … ROLLBACK`, so nothing was left behind. Claims that were not run are marked *unverified*.

**C1. How `scopedDb` registers and scopes models.**
- **Mechanism.** Registration is a string match against `DOMAIN_MODELS` (`src/lib/scoped-db.ts:14-39`, checked by `isDomain` at `:41-42`). One `$allOperations` hook (`:78-102`) does all the injection:
  - `create` merges `organizationId` into top-level `data` (`:92-93`).
  - `upsert` merges it into both `where` and `create` (`:94-96`).
  - Every other operation in `WHERE_SCOPED_OPERATIONS` merges it into `where` (`:97-98`). That set (`:55-64`) also lists `upsert`, but the earlier branch handles it first, so the entry is dead. CONTEXT D-01 leaves `upsert` out of the list. That omission is harmless.
- **What it does not scope.**
  - Nested writes inside `data`: nested `create`/`connect` get no `organizationId`.
  - Rows loaded through `include` or nested `select`.
  - `findUnique*`, `findFirstOrThrow`, `aggregate`, `groupBy`, `createMany`, `createManyAndReturn`, `updateManyAndReturn` and raw SQL (D-01 is right about these).
- **Nothing tests registration.** No test reads `DOMAIN_MODELS` (grep of `tests/`), so a misspelt model name silently turns scoping off. Add a unit test that checks every new model name against the generated `Prisma.ModelName`. The generated client exports it (`src/generated/prisma/internal/prismaNamespace.ts:386`, gitignored, built by `pnpm prisma generate`). The parity-test shape is `tests/unit/proposal-contract.test.ts:1-9`, which imports `src/generated/prisma/enums`.
- **Which transaction client to use.** Existing write services run either on the unscoped `prisma.$transaction` (`mutations.ts:268`; `relations.ts:206` on the `client` it is given) or on `scopedDb(orgId).$transaction` (`proposal-review.ts:269`, `create-ticket.ts:85`). Both write the organization term explicitly. Inside a scoped transaction the injection still fires (`tests/integration/scoped-tx.test.ts:13-33`).
- **Creates must use scalar foreign-key fields** (Prisma's "unchecked" create input), because scopedDb injects the scalar `organizationId`. Mixing that scalar with a relation `connect` is a Prisma validation error (known Prisma behaviour, *not run here*). Copy the cast at `create-ticket.ts:116-136`, or pass `organizationId` explicitly as `proposal-request.ts:103-118` does.

**C2. How the 12.1 and 12.2 migrations wrote composite foreign keys.**
- **Target and schema side.** Each target gets `@@unique([organizationId, id])` (`prisma/schema.prisma:302`, `:514`, `:759`, `:851`), which generates `CREATE UNIQUE INDEX "<Model>_organizationId_id_key"` (`kb_proposals/migration.sql:84`, `:96`, `:99`). The schema relation states both actions: `@relation(fields: [organizationId, proposalId], references: [organizationId, id], onDelete: Restrict, onUpdate: Restrict)` (`schema.prisma:864-865`, `:288`).
- **Prisma's default is not safe here.** Left alone, Prisma generates `ON DELETE RESTRICT ON UPDATE CASCADE` for a composite relation (`20261110100000_ticket_states/migration.sql:15`, `:265`).
- **Why the 12.1 migration switched to `ON UPDATE RESTRICT`.** One `UPDATE "TicketState" SET "organizationId"` moved every ticket into another organization (header of `20261110110000_ticket_state_fk_on_update_restrict/migration.sql:1-5`). 12.2 followed the same rule (`kb_proposals/migration.sql:15-16`).
- **For a project-scoped target**, the unique key becomes `@@unique([organizationId, projectId, id])` on Task, Milestone and Label.

**C3. RESTRICT foreign keys block D-13's move unless the contract changes how children reference a task (verified by probe on pg16).**
- **Probe results.** In a schema where Task has `UNIQUE (org, project, id)` and a self-referencing foreign key `(org, project, parentId)` with `ON UPDATE RESTRICT`:
  1. One `UPDATE … SET project = B WHERE id IN (parent, subtasks)` **succeeds**.
  2. One `DELETE` of the whole tree **succeeds**.
  3. Moving the parent alone **fails** with "still referenced".
  4. A row in **another table** that references `(org, project, taskId)` with `ON UPDATE RESTRICT` (a comment, for example) **blocks the move** with "still referenced".
  5. `ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED` lets the task and then its child be updated in two statements.
- **What the contract must choose for the rows hanging off a task** (comment, attachment, task favorite, task-label link, task key):
  - **(a)** No `projectId` column: reference `(organizationId, taskId)` → `Task(organizationId, id)`. Such a row cannot sit in a different project from its task, because it has no project of its own.
  - **(b)** Hand-written deferrable `NO ACTION` foreign keys. Prisma cannot express these. Keep them the way `searchVector` is kept.
  - **(c)** `onUpdate: Cascade`, plus a trigger that refuses any change of `organizationId`. This is the WR-01 risk of C2.
- **Milestone and label references during a move.** The task's `(org, project, milestoneId)` foreign key, and label links that carry a project, must be remapped in the **same** statement as the project change, or cleared or deleted first (D-13 "mapped by name or cleared").
- **Deletes.** D-07's hard delete under RESTRICT must delete leaves first: label links, comments, attachments, favorites, then the task tree in one statement, then project-level rows, then the project.

**C4. `SetNull` cannot be used on a composite relation.**
- **Why.** Prisma's `onDelete: SetNull` on `(organizationId, x)` generates `ON DELETE SET NULL`, which nulls `organizationId` too. That column is `NOT NULL`, so the delete fails.
- **Consequences.**
  - Deleting a milestone or label must clear or delete its references in the service (under RESTRICT).
  - A task assignee must be a single-column foreign key to `user` with `onDelete: SetNull`, like `Ticket.assignee` (`schema.prisma:289`). Its eligibility (an active member, and on a private project a project member or team member) is checked in the service, as `resolveOp` does for tickets (`mutations.ts:197-202`), but with `findConservativeMembership`.
- **The only database-level alternative.** PostgreSQL 15+ supports `ON DELETE SET NULL ("col")` with a column list. It can only be hand-written, and Prisma would try to drop it in later diffs (*not run here*).

**C5. Tombstones, prefix reservations and activity outlive the delete, so they cannot hold a foreign key to Project or Task.**
- **The conflict.** D-01 says every project-owned row references `(organizationId, projectId)`. D-07 and D-08 keep task keys and aliases as tombstones after a hard delete, D-08 reserves prefixes "forever", and D-05 keeps activity. A RESTRICT foreign key would block the delete; a CASCADE foreign key would destroy the tombstone.
- **Precedent for these three.** Use the `TicketAuditEvent` shape: `ticketId` and `actorUserId` carry no relation on purpose, and the only foreign key is to `organization`, with Cascade (`schema.prisma:655-676`).
- **What the key resolver must do.** It re-reads the target task with an explicit organization term and runs the D-04 check before it answers. "Missing" and "no access" must give the same refusal.

**C6. Where the task counter lives (the `TicketCounter` precedent, and why a column on Project would deadlock).**
- **The precedent.** `TicketCounter` has `organizationId` as its `@id` (`schema.prisma:310-314`). `createTicket` upserts it through the scoped transaction client with `create: { lastNumber: 1 }, update: { lastNumber: { increment: 1 } }`, cast because scopedDb injects `organizationId` (`create-ticket.ts:96-106`).
- **The proof.** The parallel test starts with **no** counter row and still gets 20 distinct numbers (`tests/integration/create-ticket.test.ts:37-57`). Whether Prisma runs this upsert as a native `INSERT … ON CONFLICT` is *not checked here*; the test is the evidence.
- **Why the counter cannot be a column on Project.** D-04 makes content writers take the project row `FOR SHARE`. Two task creators that both hold `FOR SHARE` and then `UPDATE "Project"` wait on each other: PostgreSQL deadlock, 40P01. The same applies to **any** `UPDATE` of the project row inside a `FOR SHARE` transaction, for example touching `updatedAt`.
- **What to do instead.** Use a separate counter row keyed `(organizationId, projectId)`, inserted in the project-create transaction. Increment it with `UPDATE … SET "lastNumber" = "lastNumber" + 1 … RETURNING "lastNumber"` (explicit organization term). Lock order: project `FOR SHARE`, then counter row.

**C7. A foreign-key check does not block a non-key update, so the D-03 trigger and D-04 need explicit `FOR SHARE`.**
- **The code already says so.** "A soft delete takes a non-key update lock that the foreign key's key-share lock does not wait for, so every writer … takes this explicit share lock first" (`src/lib/tickets/ticket-states.ts:79-96`). In PostgreSQL's row-lock rules, `FOR KEY SHARE` (what a foreign-key check takes) conflicts only with `FOR UPDATE`, while `FOR SHARE` also conflicts with `FOR NO KEY UPDATE` (documented PostgreSQL behaviour).
- **Applied to this phase.**
  - **Archive and privacy.** Archive sets `archivedAt` and a privacy change sets a non-key column. Content writers must therefore take the project row `FOR SHARE` explicitly and re-check `archivedAt`, privacy and access **after** that lock.
  - **Subtask trigger.** It must run `BEFORE INSERT OR UPDATE OF "parentId"` and do two things:
    1. `SELECT "parentId" FROM "Task" WHERE id = NEW."parentId" AND "organizationId" = NEW."organizationId" FOR SHARE` and refuse when the parent has a parent.
    2. On UPDATE, refuse when `EXISTS` a child of `NEW.id`.
  - **Why that is enough.** Updating a task's own `parentId` is a non-key update, so it takes `FOR NO KEY UPDATE`, which conflicts with another transaction's `FOR SHARE` on that row. Whichever transaction locks first, the other waits, then re-reads the committed row and refuses. A PID-bound race test proves both orders (C17).
  - **Self-parent.** "Parent is not the task itself" is a plain `CHECK ("parentId" IS NULL OR "parentId" <> "id")`, the same shape as `TicketRelation_no_self_check` (`20261109100000_ticket_lifecycle/migration.sql:92-94`).

**C8. Activity writer: the ticket audit precedent differs from D-05 in two places.**
1. **Value type.** `TicketAuditValue = string | boolean | null` forbids numbers and every free text (`ticket-audit.ts:5-7`, `:15-17`). D-05 needs short labels such as a title, plus dates, estimates and keys, so the new type must be bounded (lengths decided in contract point 10), not copied.
2. **No-ops.** Ticket mutations **write a row on a no-op** (`mutations.ts:373-380`: assign records even when the value is unchanged; `:396` "A no-op (same state) writes before equal to after"). D-05 says a no-op writes nothing. Do not copy that branch.

The parts to copy:
- The single write path with an explicit `organizationId` guard (`ticket-audit.ts:62-81`).
- The structural transaction-client interface (`:38-59`).
- The `batchId` column with an index on `(organizationId, batchId)` (`schema.prisma:670`, `:675`).
- The trigger text (`20261108140000_inbox/migration.sql:95-106`).

**C9. How to build the D-14 renderer: images limited, links live.**
- **The pipeline.** The preview processor is `remarkParse, remarkGfm, remarkRehype, rehypeSafeLinks, rehypeStripCrossOriginImageSources, rehypeSanitize(schema), rehypeInertLinks, rehypeStringify` (`render.ts:139-147`). D-14's renderer is that same chain **without `rehypeInertLinks`**. It belongs in `render.ts`, which stays the one Markdown pipeline (`:12-15`), as a new export next to `renderMarkdownPreview` (`:154-156`).
- **Caveat.** `rehypeStripCrossOriginImageSources` **keeps same-origin relative images** (`render.ts:68-75`; unit test "keeps a same-origin relative image", `tests/unit/markdown-render.test.ts:55`). So `![](/api/…)` in a task description makes every viewer's browser send a cookie-bearing GET to an app route. The contract decides whether task Markdown drops every image or keeps relative ones.

**C10. Attachments: there is no shared upload validator, and the download precedent only checks the organization.**
- **Validation is copied inline in four places.** Size is checked against `File.size` before the buffer is read, then the type is sniffed with `file-type` against `ALLOWED_MIME`:
  - `src/app/api/tickets/[id]/messages/route.ts:71-90`
  - `src/app/api/public/status/[token]/follow-up/route.ts:75`
  - `src/app/api/public/intake/route.ts:82`
  - `src/lib/channels/email/ingest-message.ts:136`
- **What Phase 14 needs.** It has no route, so the service needs a validator in `src/lib`: a new helper, not a fifth copy.
- **Staging.** Stage before the transaction, discard on refusal or error, and only after commit is the row live (`messages/route.ts:98-104`, `:163-169`).
- **Delete behaviour.** `localFileStorage.delete` throws `ENOENT` for a missing file (`local-file-storage.ts:26-28`), so the cleanup job must count `ENOENT` as done. Copy `deleteEach` (`staged-files.ts:43-61`).
- **Tests.** `ROOT` is read when the module loads (`local-file-storage.ts:6`), so tests set `UPLOADS_DIR` first and then use a dynamic `import()` (`tests/unit/staged-files.test.ts:109-132`).
- **Download.** Do not copy the ticket download route: it checks only the organization (`src/app/api/attachments/[id]/route.ts:19-22`).

**C11. The worker cannot see uploaded files, so a D-07 cleanup job in the worker would silently delete nothing.**
- **The gap.** In `docker-compose.yml` the `worker` service (`:92-110`) has no `uploads_data` volume and no `UPLOADS_DIR`. The volume comment says "only `app` mounts this … never via a worker job" (`:130-131`). `docker-compose.egress-test.yml:127-141` is the same. A cleanup job in the worker would get `ENOENT` on its own container filesystem and report success.
- **What the plan must do.** Add the volume and `UPLOADS_DIR: /data/uploads` to the worker in both compose files, or run the cleanup on the app side. This is in scope for D-07 and touches deployment files.
- **Side observation, outside Phase 14.** The worker's inbound email poll already calls `ingestMessage` (`src/lib/channels/email/poll-inbox.ts:8`, `:55`), which saves attachments with `localFileStorage.save` (`ingest-message.ts:146`) on that unmounted path. Inbound email attachments therefore probably never reach the app's volume (*not run here*). Report this to the orchestrator; do not fix it in this phase.

**C12. Sending the cleanup job after commit is not atomic.**
- **The precedent.** Every existing enqueue happens after commit, and a lost send is accepted: "pg-boss send must NEVER live inside the Prisma transaction" (`create-ticket.ts:163-167`); "No transactional outbox" (`proposal-review.ts:42-44`).
- **The gap.** For D-07's "idempotent cleanup", a send that fails or a crash after commit leaves the files orphaned forever.
- **The contract chooses one of two:**
  - Accept the gap and document it, as 12.2 did.
  - Write the storage keys into an org-scoped cleanup table **inside** the delete transaction, and add a scheduled sweep (schedule pattern `src/lib/worker/index.ts:59-63`) next to the post-commit send.

**C13. Two precedents for refusals and unique violations.**
- **Result shape.** Tickets, saved views and relations return `{ ok: false, error }` (`mutations.ts:107-109`, `:346-349`). Phase 12.2 returns `{ ok: false, code, field? }` (`proposal-review.ts:133`, `:157-160`). D-10 says "as in Phase 12.2", so use `code`, with the refusal-code arrays declared as `const` (`proposal-contract.ts:234-249`).
- **Unique violations.** A unique violation inside an interactive transaction aborts that transaction. Either use `INSERT … ON CONFLICT DO NOTHING` and re-read (`mutations.ts:236-250`), or map the violation by index name after the throw (`relations.ts:132-144` `violatedIndex`; `saved-views/service.ts:213-220`). Never check first and then insert.

**C14. How membership is read.**
- **The read.** `findConservativeMembership(client, userId, orgId)` (`membership.ts:79-91`) takes any client with `member.findMany` (`:46-54`). It reads every row of the user in id order and returns the deciding row (`decidingRow`, `:61-64`). Admin means `isAdminRole` (`:147-150`), exactly `owner` or `admin`.
- **Stale comment.** `getSessionActor`'s docstring (`session.ts:46-52`) still names `findActiveMembership`. New services call the conservative read regardless.
- **No foreign key to `member`.** ProjectMember and TeamMember hold `userId` (foreign key to `user`, `onDelete: Cascade`, the `SavedView.owner` shape at `schema.prisma:649`).
- **Lists must re-check membership.** Every list that shows people or decides eligibility (project members, team members, assignee pick) joins or reads `member` again. Rows of users who left the organization stay in the table and must be filtered out (D-02, D-15).

**C15. Dates and time zones.**
- **No calendar-date columns yet.** The schema has no `@db.Date` column; the only explicit type is `@db.Timestamptz(3)` at `schema.prisma:282`. Prisma `DateTime` maps to `timestamp(3)` without zone.
- **Reading DATE values.** Prisma returns `@db.Date` as a JS `Date` at UTC midnight. For raw SQL reads through `@prisma/adapter-pg`, select dates as `"dueDate"::text`, because the adapter's DATE parsing was *not checked here*.
- **Probably no new package.** Node 22 (`package.json` engines, volta `22.23.1`) validates IANA zones with `Intl.DateTimeFormat`/`Intl.supportedValuesOf("timeZone")`. Arithmetic on Y-M-D can stay in UTC, so D-09 likely needs no date package (*a design reading, to confirm in the contract*).
- **Clock injection precedents.** `hooks.clock` read once after the lock (`mutations.ts:124-125`, `:320`), or `opts.now` (`proposal-review.ts:85-88`, `:266`).

**C16. Integration tests share one database.**
- **The setup.** `tests/integration/global-setup.ts:15-38` starts one container and runs `prisma migrate deploy` once. `vitest.integration.config.ts` sets `fileParallelism: false` and has no reset between files.
- **Rules for fixtures.**
  - Every case seeds fresh organizations (`seedOrgWithMembers`, `tests/support/inbox-fixtures.ts:72-101`, random UUID slug).
  - Better Auth rows need explicit `id` and `createdAt`.
  - Every organization insert also seeds five ticket states through the trigger `aida_organization_ticket_states` (`20261110100000_ticket_states/migration.sql:294-305`). This is harmless for projects.
- **Three-actor isolation.** Seed two organizations, then the AIDA-71 actors from them: a member, a non-member of the same organization, and a user of the other organization.

**C17. Race tests: two kinds of test seam, one wait protocol.**
- **The seams.**
  - A `hooks` parameter (`mutations.ts:118-126`, `relations.ts:77`).
  - A module-level observer setter (`create-ticket.ts:53-69`; `proposal-review.ts:95-116` `setProposalReviewObserverForTests`).
- **The protocol.**
  1. Each run records its own `backendPid(tx)` (`tests/support/lock-wait.ts:37-42`) from inside its transaction.
  2. The holder parks on a `deferred` (`:28-34`).
  3. `waitForBlockedBy(observer, holderPid, [waiterPid])` (`:50-77`) runs on a **separate one-connection** `PrismaClient` with `PrismaPg` and `pg.Pool({ max: 1 })` (`tests/integration/kb-proposal-publish-race.test.ts:63-94`).
  4. `settleAll` asserts that no promise rejected with 40P01 (`:112-124`).
  5. `afterEach` releases every held deferred and clears the observer (`:100-104`).
- **Choose one seam style** for all `src/lib/projects/` services.

**C18. Migration generation leaves known edits to undo.**
- **What to expect.** Every generated diff since Phase 11 has contained DROPs of the hand-written `searchVector` columns and their indexes, which must be deleted by hand (`kb_proposals/migration.sql:7-11`; `kb_proposal_final_fence/migration.sql:10-14`).
- **Folder name.** The generated folder is renamed so it sorts after `20261112100000_kb_proposal_final_fence`.
- **Enum values.** A new enum value cannot be used in the same file that adds it (`kb_proposals/migration.sql:18-19`).
- **Schema comment.** Every hand-written object is listed in a comment above its model in `schema.prisma` (copy `:804-816` for KbProposal and `:631-635` for SavedView).

---

## File Classification

| # | New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| 1 | `prisma/schema.prisma` (modify) | model | schema | `KbProposal`/`KbProposalSource`/`TicketAuditEvent`/`TicketCounter` blocks, `schema.prisma:310-314`, `:655-676`, `:804-870` | exact |
| 2 | `prisma/migrations/2026111x_projects_foundation/migration.sql` | migration | DDL | `prisma/migrations/20261111100000_kb_proposals/migration.sql` | exact |
| 3 | (optional) a follow-up migration for a later fix | migration | DDL | `20261112100000_kb_proposal_final_fence/migration.sql` | exact |
| 4 | `src/lib/scoped-db.ts` (modify) | config | tenancy | itself `:14-39` | exact |
| 5 | `src/lib/projects/contract.ts` | utility (frozen contract) | pure | `src/lib/kb/proposal-contract.ts` | exact |
| 6 | `src/lib/projects/access.ts` (policy: read predicate, write check, locks) | service | request-response | `src/lib/saved-views/service.ts:345-366` + `src/lib/tickets/ticket-states.ts:79-96` + `src/lib/membership.ts:79-91` | role-match |
| 7 | `src/lib/projects/activity.ts` (single write path + feed read) | service | append-only write | `src/lib/tickets/ticket-audit.ts` + `src/lib/tickets/activity-feed.ts` | exact |
| 8 | `src/lib/projects/projects.ts` (create, edit, status, list, detail) | service | CRUD | `src/lib/kb/proposal-review.ts` (conditional update) + `saved-views/service.ts` (visibility) | role-match |
| 9 | `src/lib/projects/members.ts` | service | CRUD | `src/lib/tickets/mutations.ts:197-202` (eligibility) + `saved-views/service.ts` | role-match |
| 10 | `src/lib/projects/teams.ts` (teams, team members, project-team) | service | CRUD | `src/lib/kb/proposal-review.ts:244-248` (`requireAdmin`) + `mutations.ts:236-250` | role-match |
| 11 | `src/lib/projects/tasks.ts` (create, edit with version, status, dates) | service | CRUD | `src/lib/tickets/create-ticket.ts` + `src/lib/kb/proposal-review.ts:257-295` | exact |
| 12 | `src/lib/projects/subtasks.ts` (or inside tasks) | service | CRUD | `src/lib/tickets/relations.ts:206-260` (hierarchy guard) | role-match |
| 13 | `src/lib/projects/comments.ts` | service | CRUD | `src/app/api/tickets/[id]/messages/route.ts:107-162` (insert under lock, rendered body) | role-match |
| 14 | `src/lib/projects/attachments.ts` (upload, download read, delete) | service | file I/O | `messages/route.ts:63-177` + `src/lib/attachments/staged-files.ts` | exact |
| 15 | `src/lib/attachments/validate-upload.ts` (shared size + sniff) | utility | file I/O | inline code `messages/route.ts:71-90` | exact (extraction) |
| 16 | `src/lib/projects/keys.ts` (prefix, counter, namespace, alias, tombstone, resolver) | service | CRUD + concurrency | `create-ticket.ts:96-106` + `mutations.ts:236-250` | role-match |
| 17 | `src/lib/projects/recurrence.ts` (pure date rules + successor) | utility + service | transform | none for date math; clock: `mutations.ts:124-125` | no analog (math) |
| 18 | `src/lib/projects/ordering.ts` (rank, rebalance, reorder) | service | batch | `saved-views/service.ts:195-207` (`nextPosition`) | partial |
| 19 | `src/lib/projects/bulk.ts` (≤100 tasks, batch id) | service | batch | `src/lib/tickets/mutations.ts:255-350` | exact |
| 20 | `src/lib/projects/progress.ts` | service | read aggregate | `saved-views/service.ts:195-207` (explicit org on `aggregate`) | partial |
| 21 | `src/lib/projects/lifecycle.ts` (archive, restore, favorite, duplicate, move, delete) | service | CRUD + multi-row | `src/lib/tickets/merge.ts:171-186`, `:199-240` (two-row lock) | role-match |
| 22 | `src/lib/projects/labels-milestones.ts` | service | CRUD | `mutations.ts:235-251` (`addTagByName`) | role-match |
| 23 | `src/lib/projects/cleanup-queue.ts` (queue name + options) | config | event-driven | `src/lib/kb/proposal-queue.ts` | exact |
| 24 | `src/lib/worker/jobs/project-file-cleanup.ts` | job | event-driven / batch | `src/lib/worker/jobs/snooze-wake.ts` + `staged-files.ts:43-61` | role-match |
| 25 | `src/lib/worker/index.ts` (modify) | config | event-driven | itself `:121-134` | exact |
| 26 | `src/lib/queue/boss-client.ts` (modify) | config | event-driven | itself `:56-59` | exact |
| 27 | `src/lib/markdown/render.ts` (modify: new export) | utility | transform | itself `:139-156` | exact |
| 28 | `docker-compose.yml`, `docker-compose.egress-test.yml` (modify, C11) | config | deploy | `docker-compose.yml:66`, `:71-72` (app `UPLOADS_DIR` and volume) | exact |
| 29 | `tests/support/project-fixtures.ts` | test support | seed | `tests/support/kb-proposal-fixtures.ts`, `inbox-fixtures.ts:72-101` | exact |
| 30 | `tests/unit/project-contract.test.ts` (enum parity, DOMAIN_MODELS) | test | pure | `tests/unit/proposal-contract.test.ts` | exact |
| 31 | `tests/unit/project-recurrence.test.ts` | test | pure | `tests/unit/state-transition.test.ts` (pure rules) | partial |
| 32 | `tests/unit/markdown-render.test.ts` (modify) | test | pure | itself `:32-70` | exact |
| 33 | `tests/integration/projects-schema.test.ts` (FKs, CHECKs, triggers, catalog) | test | DDL proof | `tests/integration/kb-proposal-schema.test.ts` | exact |
| 34 | `tests/integration/projects-isolation.test.ts` (2 orgs × 3 actors × every path) | test | CRUD | `tests/integration/kb-proposal-reader-isolation.test.ts`, `workspace-isolation.test.ts` | exact |
| 35 | `tests/integration/projects-access-race.test.ts` (FOR SHARE vs FOR UPDATE, subtask trigger, move lock order) | test | concurrency | `tests/integration/kb-proposal-publish-race.test.ts` | exact |
| 36 | `tests/integration/task-keys.test.ts` (20 parallel creates, alias after move) | test | concurrency | `tests/integration/create-ticket.test.ts:37-57` | exact |
| 37 | `tests/integration/project-activity.test.ts` (append-only + one row per mutation) | test | append-only | `tests/integration/audit-append-only.test.ts`, `activity-feed.test.ts` | exact |
| 38 | `tests/integration/project-tasks.test.ts`, `project-recurrence.test.ts`, `project-bulk.test.ts`, `project-lifecycle.test.ts`, `project-attachments.test.ts` | test | CRUD | `tests/integration/ticket-mutations.test.ts`, `kb-proposal-review.test.ts` | role-match |

---

## Pattern Assignments

### 1. `prisma/schema.prisma` (model)

**Analogs:** `KbProposal` (`:817-853`), `KbProposalSource` (`:855-870`), `TicketAuditEvent` (`:655-676`), `TicketCounter` (`:310-314`), `Tag` (`:364-374`), `SavedView.owner` (`:649`), `Ticket.assignee` (`:289`).

- **Header comment block.** Above each model, list the hand-written objects that live only in the migration. Copy the wording of `:804-816`: "Hand-written objects that live ONLY in migration …, because Prisma cannot express them … Any migration Prisma generates after that one must keep them (delete any DROP statement for them by hand)."
- **Composite target and relation:**
  ```prisma
  @@unique([organizationId, id])            // schema.prisma:851
  proposal KbProposal @relation(fields: [organizationId, proposalId], references: [organizationId, id], onDelete: Restrict, onUpdate: Restrict)  // :864
  ```
  For a project scope: Task `@@unique([organizationId, projectId, id])`, and a subtask relation `fields: [organizationId, projectId, parentId], references: [organizationId, projectId, id]`. The optional composite relation with a required `organizationId` and a nullable second field is legal, as `AuditEvent.kbProposal` shows (`:465-483`). For `onUpdate`, see C3.
- **Organization relation.** Every model has `organization organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)` and a back-relation list in `model organization` (`:92-127`).
- **Rows that outlive a delete** (activity, key namespace, prefix reservation): no relation besides `organization` (`:655-660` comment, C5).
- **Join tables carry `organizationId`.** Do not copy `TicketTag` (`:376-384`), which has no `organizationId` and is excluded from `DOMAIN_MODELS` (`scoped-db.ts:5-6`). D-01 requires the column on every new model, including the task-label link.
- **Per-user rows** (favorites, members): `userId` with a foreign key to `user`, `onDelete: Cascade` (`:649`), plus `@@unique([organizationId, userId, projectId])`.
- **Calendar dates.** `DateTime? @db.Date`, a new pattern (C15).
- **Version column.** `version Int @default(0) // incremented by every write; conditional updates match it` (`:821`).

### 2. `prisma/migrations/<ts>_projects_foundation/migration.sql` (migration)

**Analog:** `prisma/migrations/20261111100000_kb_proposals/migration.sql`.

- **Header (`:1-21`).** What the migration adds; the exact `prisma migrate dev --create-only --name …` command and the renamed folder; each hand edit as a bullet (removed `searchVector` drops, kept every generated statement, the referential actions chosen); "The file holds no explicit transaction statement. This file is final once applied."
- **Separator (`:119-122`):**
  ```sql
  -- ---------------------------------------------------------------------------
  -- Hand-written below (D-03, D-05, …). Keep in any later Prisma-generated migration.
  -- ---------------------------------------------------------------------------
  ```
- **CHECKs.**
  - Value bounds use the `KbProposal_version_check` shape (`:126`).
  - Length uses `char_length` (`:132-133`).
  - Multi-column invariants (`:139-150`), for example `("startDate" IS NULL OR "dueDate" IS NULL OR "startDate" <= "dueDate")` (D-10).
  - Prefix format: `CHECK ("keyPrefix" ~ '^[A-Z0-9]{2,10}$')`.
  - No self-parent: copy `TicketRelation_no_self_check` (`20261109100000_ticket_lifecycle/migration.sql:92-94`).
- **Partial unique index.** Copy `TicketRelation_one_parent_key` (`ticket_lifecycle/migration.sql:96-98`) and `SavedView_*_name_key` (`20261108140000_inbox/migration.sql:77-83`). D-09's "one successor per predecessor" is `CREATE UNIQUE INDEX … ("organizationId", "recurrencePredecessorId") WHERE "recurrencePredecessorId" IS NOT NULL`. Case-insensitive names use `lower("name")`.
- **Append-only trigger (D-05).** Copy `20261108140000_inbox/migration.sql:95-106` verbatim, renamed:
  ```sql
  CREATE OR REPLACE FUNCTION aida_project_activity_immutable()
  RETURNS TRIGGER AS $$
  BEGIN
    RAISE EXCEPTION 'ProjectActivity is append-only: % is not permitted', TG_OP;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER aida_project_activity_no_update_delete
    BEFORE UPDATE OR DELETE ON "ProjectActivity"
    FOR EACH ROW EXECUTE FUNCTION aida_project_activity_immutable();
  ```
- **Subtask trigger (D-03).** Use the structure of `aida_kb_proposal_status_immutable` (`kb_proposals/migration.sql:160-183`, a plpgsql `BEFORE UPDATE … FOR EACH ROW` with `RAISE EXCEPTION`) and the `WHEN`-guarded column trigger of `aida_ticket_state_group_fixed` (`20261110100000_ticket_states/migration.sql:306-319`). The body is the `FOR SHARE` read of C7. Make the `RAISE` messages stable strings the service can map, as the KbProposal fence does (`'KbProposal is final'`).
- **Composite foreign keys.** The generated statements are kept unchanged and only the referential action is chosen (`:101-117`). See C3 for the move-safe choice.

### 4. `src/lib/scoped-db.ts` (modify)

Append every new model name to `DOMAIN_MODELS` (`:14-39`). Keep the header comment style (`:3-13`): one line per exclusion and why. Rows without `organizationId` cannot be registered, so every new model has the column (D-01). Guard the list with the unit test of C1.

### 5. `src/lib/projects/contract.ts` (frozen contract, D-17)

**Analog:** `src/lib/kb/proposal-contract.ts`.
- **Header.** "the frozen contract every later plan of the phase imports (D-17, freeze first). Pure and client-safe: no runtime Prisma import, relative imports only" (`:1-5`), followed by the rules as prose: status machine, version rule, lock order (`:7-20`).
- **Refusal codes as `const` arrays plus derived types** (`:232-271`):
  ```ts
  export const REVIEW_REFUSAL_CODES = ["NOT_ALLOWED", "MEMBERSHIP_ENDED", "NOT_FOUND", "CONFLICT", …] as const;
  export type ReviewRefusalCode = (typeof REVIEW_REFUSAL_CODES)[number];
  ```
- **Enum sets equal to the generated Prisma enums**, checked by a unit test (`tests/unit/proposal-contract.test.ts:1-9`).
- **Payload guard for the cleanup job.** Copy `isProposalJobPayload`'s exact-keys check (`:197-209`).

### 6. `src/lib/projects/access.ts` (shared policy: read predicate + write check + locks)

**Analogs:**
- **Write check.** `lockViewForWrite` (`src/lib/saved-views/service.ts:345-366`): membership first, then one `SELECT … FOR UPDATE` with an explicit organization term, then the decision from the locked row only. A private row the actor may not see throws `NOT_FOUND`, exactly like an unknown id:
  ```ts
  const rows = await tx.$queryRaw<LockedView[]>`
    SELECT id, "ownerUserId", visibility::text AS visibility
    FROM "SavedView"
    WHERE id = ${id} AND "organizationId" = ${actor.orgId}
    FOR UPDATE
  `;
  …
  if (view.visibility === "PRIVATE" && !isOwner) throw new SavedViewError("NOT_FOUND");
  if (!isOwner && !isAdminRole(membership.role)) throw new SavedViewError("NOT_ALLOWED");
  ```
  For D-04 use `FOR SHARE` on content paths and `FOR UPDATE` on membership, team-assignment, privacy and archive paths.
- **Share-lock helper shape.** `shareLockActiveState` (`ticket-states.ts:84-97`): a structural `$queryRaw` client (`StateQueryClient`, `:38-41`), a `null` return meaning "missing or another organization's", and the JSDoc explaining why the explicit share lock is needed (C7).
- **Two project rows in id order** (move, contract point 1). Copy `lockTicketsInIdOrder` (`merge.ts:171-186`): one statement, `id = ANY(${unique}::text[]) ORDER BY id FOR UPDATE`, followed by a length check (`relations.ts:117-126` `lockPair`).
- **Membership.** `findConservativeMembership` + `isAdminRole` as `requireAdmin` does (`proposal-review.ts:236-248`).
- **Read predicate.** A typed Prisma `where` fragment with the visibility OR, always combined with `organizationId: orgId`. The precedent with two explicit visibility branches and no leakage is `listSavedViewsForViewer` (`saved-views/service.ts:306-327`).
- **Untrusted ids.** `asId`/`hasNul` (`proposal-review.ts:170-177`) and `isPlausibleId` (`saved-views/service.ts:328-330`): a malformed id becomes `NOT_FOUND` and never a raw database error.

### 7. `src/lib/projects/activity.ts` (append-only writer + feed reader)

**Analogs:** `src/lib/tickets/ticket-audit.ts` (whole file) and `src/lib/tickets/activity-feed.ts`.
- **Copy:**
  - The header saying this is the ONE write path, append-only, and relative imports only (`:1-12`).
  - The structural client interface (`:38-59`).
  - The empty-org guard and `select: { id: true }` (`:62-81`).
  - The USER/SYSTEM actor union (`:28-36`), if the recurrence successor or the cleanup job writes as SYSTEM.
- **Change** the value type (C8) and drop no-op rows (C8).
- **Feed read.** Copy the stable order by (createdAt, id) with plain code-unit comparison, not `localeCompare` (`activity-feed.ts:19-28`), and the extraction of referenced ids to resolve labels (`:56-87`). Gate the feed on current read access (D-04).

### 8-10. `projects.ts`, `members.ts`, `teams.ts` (CRUD services)

**Analog:** `src/lib/kb/proposal-review.ts`.
- **Header blocks to reproduce as prose:** authorization (`:6-16`), lock order (`:18-20`), version rule (`:22-26`), and error contract (`:34-41`): "a ProposalReviewError thrown inside a transaction rolls it back and is RETURNED as { ok: false, code }; any other error rolls back and is RETHROWN".
- **Skeleton (`:257-295`):**
  ```ts
  try {
    const version = await scopedDb(orgId).$transaction(async (tx) => {
      if (reviewObserver?.onTransactionStart) await reviewObserver.onTransactionStart(tx);
      await requireAdmin(tx, userId, orgId);
      …
      const updated = await tx.kbProposal.updateMany({
        where: { id: proposalId, organizationId: orgId, status: "DRAFT", version: expectedVersion },
        data: { …, version: { increment: 1 }, lastEditedByUserId: userId, lastEditedAt: now },
      });
      if (updated.count === 0) throw await missRefusal(tx, orgId, proposalId, "DRAFT", "NOT_DRAFT");
      return expectedVersion + 1;
    }, TRANSACTION_OPTIONS);
    return { ok: true, version };
  } catch (err) {
    if (err instanceof ProposalReviewError) return toReviewRefusal(err);
    throw err;
  }
  ```
- **Miss classification.** `missRefusal` (`:202-223`): re-read with an explicit organization term; missing gives `NOT_FOUND`, the expected state gives `CONFLICT`, anything else the wrong-state code. For a private project the re-read must apply the access predicate, so "no access" stays `NOT_FOUND`.
- **Transaction options:** `const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;` (`:73`, `mutations.ts:61`).
- **Assignee or member eligibility.** Follow `resolveOp` "assign" (`mutations.ts:197-202`), but call `findConservativeMembership` (C14).
- **Team and label names.** Use `INSERT … ON CONFLICT DO NOTHING`, then re-read (`mutations.ts:236-250`), or map the violation by index (`relations.ts:132-144`).

### 11-12. `tasks.ts`, `subtasks.ts`

**Analogs:** `create-ticket.ts:79-161` (create transaction with counter), `proposal-review.ts:257-295` (versioned edit), `relations.ts:206-235` (hierarchy guard before write).
- **Create order:** lock the project `FOR SHARE`, check access, then the counter (C6), then the task insert, then the key-namespace insert, then the activity row. The test seam goes first (`create-ticket.ts:86`).
- **Subtask.** The service refuses one level first (typed code), as `relations.ts:227-232` refuses `PARENT_EXISTS` before the insert. The database trigger (C7) is the second fence; map its `RAISE` text in the catch, as `relations.ts:243-250` maps index names.

### 13-15. `comments.ts`, `attachments.ts`, `src/lib/attachments/validate-upload.ts`

**Analog:** `src/app/api/tickets/[id]/messages/route.ts:63-177`.
- **Validate before storing anything** (`:71-90`):
  ```ts
  if (file.size > MAX_BYTES) return … "file_too_large";
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = await fileTypeFromBuffer(buffer);
  if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) return … "unsupported_file_type";
  stored.push({ storageKey: buildStorageKey(file.name), originalFilename: file.name, mimeType: sniffed.mime, … });
  ```
  Extract this as a function returning a typed refusal (C10). `buildStorageKey` never uses the file name for the path (`local-file-storage.ts:31-42`). The file name is stored only as metadata and is untrusted (D-14).
- **Stage, transact, discard** (`:98-104`, `:107-166`, `:168-177`): `saveStagedFiles(localFileStorage, orgId, …)`. Discard on a thrown error and on a refusal outcome.
- **Comment body.** `bodyHtml` comes from the new D-14 renderer (C9), never `renderMarkdown` (`messages/route.ts:131` uses `renderMarkdown`; do not copy that call).
- **Download read.** Return `{ storageKey, mimeType, originalFilename }` only after the D-04 read check. Phase 15's route then streams it with the headers of `src/app/api/attachments/[id]/route.ts:29-35`. Do not copy its org-only lookup (`:19-22`).

### 16. `keys.ts`

**Analogs:** `create-ticket.ts:96-106` (counter in the creating transaction), `mutations.ts:236-250` (`ON CONFLICT DO NOTHING` + re-read for idempotent namespace inserts), `relations.ts:132-144` (unique-violation mapping).
- **The concurrency proof** copies `tests/integration/create-ticket.test.ts:37-57`: N parallel creates in one project, then `new Set(keys).size === N`.
- **Move.** Insert the new key, turn the old key row into an alias (an UPDATE on a namespace row, not on activity), and lock both projects in id order.

### 17. `recurrence.ts`

**No analog** for daily, weekly and monthly date math with clamping. Keep the pure functions separate from the transactional successor creation, the way `state-transition.ts` keeps its rules pure (`tests/unit/state-transition.test.ts`). Clock injection: `hooks.clock` read once after the lock (`mutations.ts:319-320`). The "exactly once" guarantee is the partial unique index on the predecessor (section 2) plus `ON CONFLICT DO NOTHING`.

### 18-20. `ordering.ts`, `bulk.ts`, `progress.ts`

**Analog for bulk:** `runTicketMutation` (`mutations.ts:255-350`).
- `validateInput` deduplicates ids and refuses `TOO_MANY` above `MAX_BULK_TICKETS = 100` (`:58-59`, `:144-176`).
- Membership is read inside the transaction (`:271-273`).
- References are resolved before the lock (`:275`).
- One statement locks every row in id order with the organization term (`:279-287`).
- Each row gets its own activity entry, all sharing one `batchId` (`:318`, `:332-340`).
- The result is `{ ok: true, count, batchId }` (`:107-109`).
- Copy the header (`:1-42`) as the doc model.
- Under D-04 and D-10 the project row is locked `FOR UPDATE` **before** the task rows (contract point 1).

**Ordering:** `nextPosition` (`saved-views/service.ts:195-207`, `aggregate` with explicit org: max + 1). The integer rank with gaps and its rebalance is new. A raw `UPDATE` must set `"updatedAt" = now()` itself, as `snooze-wake.ts:53-60` does, because Prisma's `@updatedAt` does not apply to raw SQL.

**Progress:** `count`/`groupBy` with an explicit `organizationId` (C1: `groupBy` is not scoped). Computed on read, never stored (D-11).

### 21-22. `lifecycle.ts`, `labels-milestones.ts`

**Analogs:** `mergeTickets` (`merge.ts:199-240`, two rows locked by `lockTicketsInIdOrder`, then validated on the locked rows) and `addTagByName` (`mutations.ts:235-251`).
- **Delete with confirmation.** The leaf-first order is set by RESTRICT (C3). Write one activity row per removed entity (contract point 4). Then a post-commit send or an outbox (C12).
- **Archive.** A conditional `updateMany` on `archivedAt: null` (restore: `not: null`). A count of 0 is classified with the `missRefusal` pattern.

### 23-26. Cleanup job and queue wiring

**Analogs:** `src/lib/kb/proposal-queue.ts` (whole file: pure, relative imports, a shared options object with `ensure…Queue` calling `createQueue` and then `updateQueue`), `worker/index.ts:121-134` (registration after `ensureKbProposalQueue`), `boss-client.ts:56-59` (app side).
- **Handler body.** Copy `deleteEach`'s per-key try/catch with `ENOENT` treated as done, logging the key and error code only, never file content (`staged-files.ts:43-61`).
- **Payload.** Carries only `{ orgId, storageKeys }`, checked by an exact-keys guard (`proposal-contract.ts:197-209`).
- **Scheduled sweep (C12).** Copy `boss.schedule(name, cron, {})` (`worker/index.ts:59-63`).
- **Prerequisite:** C11, the worker's volume mount.

### 27. `src/lib/markdown/render.ts` (modify)

Add one exported processor and function after `renderMarkdownPreview` (`:139-156`), built as C9 describes, with a K-style comment block explaining why, like `:57-63` and `:106-112`. Tests go into `tests/unit/markdown-render.test.ts`, mirroring `:32-70`: remote, protocol-relative and backslash image forms are stripped; links stay live with `rel="nofollow noopener noreferrer"`; `javascript:` is stripped.

### 29. `tests/support/project-fixtures.ts`

**Analog:** `tests/support/kb-proposal-fixtures.ts:1-20`.
- **Header:** test-only, relative imports only, fresh uniquely named rows per call, and rows inserted directly where the service is not under test.
- **Re-exports:** `seedOrgWithMembers` (`inbox-fixtures.ts:72-101`).
- **Three-actor helper** for AIDA-71: two `seedOrgWithMembers` calls, then member, non-member of the same organization, and other-organization user.

### 33. `tests/integration/projects-schema.test.ts`

**Analog:** `tests/integration/kb-proposal-schema.test.ts`.
- `errorText` and `rejection` helpers (`:15-36`, copied, since test files do not import each other).
- Raw-SQL inserts, so constraint names reach the error text (`:66-80`).
- A cross-organization foreign-key refusal per relation (`:134`, `:458`, `:476`).
- A scopedDb read/count/update/delete isolation case per model (`:526-570`).
- A catalog check of `pg_constraint` (`confupdtype`, `confdeltype`) and `pg_trigger` (`:575-673`).
- A "keeps the earlier triggers and hand-written indexes" case (`:674-779`), so this migration provably dropped nothing from Phases 11 to 12.2.

### 34. `tests/integration/projects-isolation.test.ts`

**Analog:** `tests/integration/kb-proposal-reader-isolation.test.ts:1-60`. The header lists every reader and writer it covers by calling the product code, never a copy of its query. Doubles are only `next/headers`, `@/lib/auth` and `next/cache` when a server-context function is used. Unmocked database.

### 35. `tests/integration/projects-access-race.test.ts`

**Analog:** `tests/integration/kb-proposal-publish-race.test.ts:1-260` (C17).
- `holdFirstAt` (`:166-192`, function at `:172`): the holder resolves its PID at a named seam and parks; the waiter's PID comes from `onTransactionStart`.
- `expectBlocked` records the pairs printed in `afterAll` (`:71`, `:88-94`, `:106-110`).
- **Races to cover:**
  - A privacy, membership or team change holding `FOR UPDATE`, with a content write waiting and then refused.
  - The reverse order.
  - Subtask trigger, both interleavings (C7).
  - Two moves A→B and B→A, with no 40P01.
  - Bulk against reorder.

### 36-38. Remaining integration tests

- **Keys:** `create-ticket.test.ts:37-57`.
- **Append-only:** `audit-append-only.test.ts:5-33` (`update` and `delete` both reject).
- **Activity per mutation:** the shape of `activity-feed.test.ts`.
- **Bulk, conflict and version:** `ticket-mutations.test.ts` and `kb-proposal-review.test.ts`.
- **Recurrence:** pass an injected clock.
- **Attachments:** a temporary `UPLOADS_DIR` with dynamic import (`staged-files.test.ts:109-132`).

---

## Shared Patterns

### Server context and membership
**Source:** `src/lib/session.ts:53-58`, `src/lib/membership.ts:79-91`, `:147-150`. **Apply to:** every `src/lib/projects/*` export. Services take `actor: { userId, orgId }` as a parameter and never import `next/*` (`mutations.ts:41-42`: "Relative imports only and no Next.js import: cache revalidation belongs to the server actions"). Membership is read inside the transaction, before any lock or write (`mutations.ts:34-37`, the "nothing stronger is claimed" wording).

### Explicit organization term
**Source:** `mutations.ts:283`, `snooze-wake.ts:44-46`, `:56-58`. **Apply to:** every raw statement, every `aggregate`, `groupBy`, `createMany`, `updateManyAndReturn` and `findFirst`, even on a scoped client (D-01).

### Typed refusal, rethrow the rest
**Source:** `proposal-review.ts:34-41`, `:121-131`, `:288-298`; `mutations.ts:96-105`, `:346-349`. **Apply to:** all write services. Refusals use `{ ok: false, code }` (C13).

### Relative imports
**Source:** `ticket-audit.ts:12`, `membership.ts:6`, `proposal-queue.ts:13`. **Apply to:** every module the worker can reach (activity, keys, recurrence, the cleanup job and its contract). `create-ticket.ts:1-12` uses `@/` and is app-only; do not copy that.

### Test seams
**Source:** `proposal-review.ts:95-116` (observer setter) or `mutations.ts:118-126` (hooks parameter). **Apply to:** every service a race test must hold. Choose one style (C17).

### Hand-written SQL objects survive later migrations
**Source:** `schema.prisma:804-816` comment, `kb_proposals/migration.sql:1-21`. **Apply to:** the CHECKs, triggers, partial indexes and any deferrable foreign key of this phase.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/projects/recurrence.ts` (date rules) | utility | transform | no calendar-date math or time-zone handling exists in `src/lib` (C15) |
| `src/lib/projects/ordering.ts` (rank with gaps, rebalance) | service | batch | only `max + 1` positions exist (`saved-views/service.ts:195-207`) |
| `src/lib/projects/progress.ts` | service | aggregate | no derived ratio exists; use explicit-org `count`/`groupBy` |
| cleanup outbox table + sweep (if chosen, C12) | model + job | event-driven | the project has no transactional outbox (`proposal-review.ts:42-44`) |

## Metadata

**Analog search scope:** `src/lib/**`, `src/app/api/**`, `prisma/schema.prisma`, `prisma/migrations/**`, `tests/support/**`, `tests/integration/**`, `tests/unit/**`, `docker-compose*.yml`, `vitest*.config.ts`, `package.json`.
**Files read:** about 40 (every cited range was opened).
**Database probes:** three rolled-back TEMP-table transactions on `aida-dev-db` (pg16): foreign-key RESTRICT vs NO ACTION vs DEFERRABLE on move and delete (C3). Nothing persisted. No migration was run.
**Pattern extraction date:** 2026-11-09
