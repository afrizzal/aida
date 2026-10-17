---
phase: 14-projects-foundation
reviewed: 2026-11-09T15:03:31Z
depth: deep
scope: "part a (schema, access, service kit, activity, projects, members, teams); diff d88de64..HEAD"
files_reviewed: 10
files_reviewed_list:
  - prisma/migrations/20261113100000_projects_foundation/migration.sql
  - prisma/schema.prisma
  - src/lib/scoped-db.ts
  - src/lib/projects/contract.ts
  - src/lib/projects/service.ts
  - src/lib/projects/access.ts
  - src/lib/projects/activity.ts
  - src/lib/projects/projects.ts
  - src/lib/projects/members.ts
  - src/lib/projects/teams.ts
findings:
  critical: 1
  warning: 7
  info: 7
  total: 15
status: issues_found
---

# Phase 14: Code Review Report (part a)

**Reviewed:** 2026-11-09T15:03:31Z
**Depth:** deep (static only; no test suite, build or Docker run)
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Scope: the Phase 14 migration and schema, the `DOMAIN_MODELS` addition in `scoped-db.ts`, and in `src/lib/projects/` the contract module, the service kit, the access policy, the activity writer and feeds, and the project, member and team operations. `src/lib/membership.ts` is unchanged in `d88de64..HEAD`. It was read only as the callee of `findConservativeMembership` and `isAdminRole`.

Checked and holding:
- **No path in scope lets a non-member read or write a private project.** That covers a non-member of the same organization, a team member (K69), an org admin, and a member of another organization.
  - `requireProject` has no team branch. It refuses an unreadable private project with NOT_FOUND, the same result as a missing id. It grants MANAGE to an org admin only on a non-private project.
  - `readableProjectWhere` carries the organization term at the top level and inside the nested `members.some` filter.
  - Every raw statement, `aggregate` and `createMany` writes `organizationId` itself.
- **Redaction and feed paging match contract section 5 (R2-1, R3-3).** The access filter sits inside the paged query, before the limit and the keyset cursor.
- **The migration matches the contract.** The composite FKs are RESTRICT/RESTRICT, the subtask depth trigger works in both interleavings, and the append-only trigger is in place.
- **The last-manager rule is serialized** under the project lock (FOR UPDATE).

The main defect is an existence and count leak of hidden private projects. It comes through the organization-wide `position` value and the `changed` flag of `moveProjectPosition`. Below it are several real problems:
- two lock-order paths that can end in an unmapped `40P01` deadlock error
- a team delete that can be refused because of a race on a project link
- a service path that orphans a project as private
- a description length check that lets a CHECK violation escape as an exception
- silent truncation of people and team lists

## Critical Issues

### CR-01: The organization-wide `position` and the `changed` flag of moveProjectPosition reveal whether hidden private projects exist, how many there are and where they sit

**Files:**
- `src/lib/projects/projects.ts:174-180` (createProject appends after the largest position of all projects)
- `src/lib/projects/projects.ts:510-533` (moveProjectPosition: neighbours and rebalance over all projects)
- `src/lib/projects/projects.ts:546-547` (PROJECT_REORDERED values)
- `src/lib/projects/projects.ts:242,272` (getProject returns `position`)
- `src/lib/projects/projects.ts:567,635,648,571-573` (listProjects returns `position`, and its cursor encodes it)

**Issue:** Contract section 8 calls `Project.position` "internal values only", and D-04 says a private project's existence is never revealed. The code breaks both in three ways:

1. **The `changed` flag.** `moveProjectPosition` takes `ordered` from every project of the organization, including private projects the caller cannot read (`:510-514`). It decides the no-op by comparing against `currentPrev` from that full list (`:515-517`).
   - Visible order `A, P` with a hidden private `H` between them (`A, H, P`): `moveProjectPosition(P, { placeAfterProjectId: A })` returns `{ changed: true }`, moves P between A and H, and writes PROJECT_REORDERED.
   - Without H, the same call returns `{ changed: false }` and writes nothing.
   - So the result itself depends on a project the caller cannot read. Any active member can run this probe on a project they create (they become its MANAGER).
2. **Rebalanced positions.** On a rebalance (`:524-533`), every project of the organization, hidden ones included, gets `(i + 1) * 1024`.
   - After that, the positions `listProjects` and `getProject` return show exactly how many hidden projects sit between two visible ones. A gap of 2048 means one hidden project, and so on.
   - `after.position` of the PROJECT_REORDERED row (`:547`), readable in P's feed, equals `(number of projects before P, hidden ones included, + 1) * 1024`.
   - A member can force a rebalance on purpose by moving their own project into the same gap about 10 times. RANK_GAP 1024 is halved each time until no integer is left.
3. **New positions.** `createProject` places a new project at `max(position over all projects) + 1024` (`:174-180`). The position of a newly created project therefore shows whether a hidden project was created since the last visible one.

**Fix:** Keep the organization-wide order internal and decide everything a caller sees from readable projects only.
```ts
// moveProjectPosition: the no-op test and the neighbours come from the readable order only
const readable = await tx.project.findMany({
  where: readableProjectWhere(actor),
  orderBy: [{ position: "asc" }, { id: "asc" }],
  select: { id: true, position: true },
});
const visibleIndex = readable.findIndex((r) => r.id === projectId);
const visiblePrev = visibleIndex > 0 ? readable[visibleIndex - 1].id : null;
if (visiblePrev === placeAfter) return { changed: false };
// place P directly after placeAfter in the full order (hidden rows stay where they are),
// rebalance over the full order as today, but never return or record the raw value:
await recordProjectActivity(tx, { /* ... */ before: { placeAfterProjectId: oldVisiblePrev }, after: { placeAfterProjectId: placeAfter } });
```
- Remove `position` from `ProjectView` and `ProjectListItem`. If the UI needs an order key, return the list already ordered, or an ordinal among the caller's readable projects.
- Change the listProjects cursor to an opaque id-based keyset that does not expose the integer. For example, encode `id` only and re-read that row's position on the server under the read predicate.
- Add a hidden-private-project test for moveProjectPosition and listProjects in the style of contract section 17's "hidden private link". It should compare two worlds that differ only by one private project placed between two visible ones.

## Warnings

### WR-01: requireTask's restart takes a second project lock while still holding the first, out of id order (deadlock against moveTask and bulkUpdateTasks)

**File:** `src/lib/projects/access.ts:299-318`
**Issue:** When the locked task's `projectId` differs from the plain read (`:318`), the loop runs `continue`. The next iteration calls `requireProject` (`:305`) for the new project and locks it FOR SHARE or FOR UPDATE. The lock on the old project is still held.
- The trigger is a moveTask that commits while this write waits on project A. After that, the write holds A and asks for B.
- If another transaction locks `{A, B}` in one id-ordered statement and B < A, the cycle closes. That transaction can be bulkUpdateTasks, or moveTask of another task between A and B. It holds B and waits on A, while this write holds A and waits on B.
- PostgreSQL aborts one of the two with `40P01`. `mapDatabaseError` does not map that code, so it is rethrown as an exception (a 500), not a refusal.

This breaks contract section 3 ("project rows in id order ... never going back to an earlier class").

**Fix:** Do not lock a second project inside one transaction. Refuse when the project changed, and keep the single restart only for a changed `parentId`.
```ts
if (task.projectId !== plain.projectId) refuse("CONFLICT"); // caller retries with a fresh transaction
if (task.parentId !== plain.parentId) continue;
```
If a restart across projects is wanted, it has to roll back first (a new transaction) so that no project lock is held.

### WR-02: createProject and changeProjectKeyPrefix take the prefix-unique index and the ProjectKeyPrefix row in opposite orders (deadlock, rethrown as an exception)

**Files:**
- `src/lib/projects/projects.ts:181-208` (createProject: inserts Project with `keyPrefix`, then `reservePrefix`)
- `src/lib/projects/projects.ts:333-337,474` (changeProjectKeyPrefix: `reservePrefix` in `beforeWrite`, then the Project `updateMany` that sets `keyPrefix`)

**Issue:** One interleaving with the same new prefix `FOO` deadlocks:
1. T_B, createProject `FOO`: inserts a `Project` row with `(org, FOO)`. The entry in `Project_organizationId_keyPrefix_key` is not committed yet.
2. T_A, changeProjectKeyPrefix of another project to `FOO`: inserts `ProjectKeyPrefix (org, FOO)` with ON CONFLICT DO NOTHING. There is no conflict yet, so the row is written but not committed.
3. T_A updates `Project.keyPrefix = FOO` and waits on T_B's uncommitted index entry.
4. T_B reaches `reservePrefix` and waits on T_A's uncommitted `ProjectKeyPrefix` row.

The result is `40P01`. `mapDatabaseError` returns null, so the caller gets a thrown error instead of PREFIX_TAKEN.

**Fix:** Take the reservation first in both paths. In createProject, generate the project id before the insert and reserve the prefix before inserting `Project`:
```ts
const projectId = createId(); // or randomUUID(); the id pattern allows both
await reservePrefix(tx, actor.orgId, projectId, keyPrefix); // ProjectKeyPrefix first
await tx.project.create({ data: { id: projectId, /* ... */ keyPrefix } });
```
With that, both operations meet first on `ProjectKeyPrefix_organizationId_prefix_key`. Map `40P01` to CONFLICT in `mapDatabaseError` as a second fence.

### WR-03: deleteTeam reads the team's project links before locking those projects, so a concurrent deleteProject makes it fail with NOT_FOUND on an existing team

**Files:** `src/lib/projects/teams.ts:280-292`, `src/lib/projects/access.ts:131`
**Issue:** deleteTeam does three steps in order:
1. It locks the team.
2. It reads the `ProjectTeam` links with a plain read.
3. Only then does it call `lockProjectsInIdOrder`, which refuses NOT_FOUND when any id is missing.

deleteProject locks only its project (not the team) and deletes its `ProjectTeam` rows and the `Project` row (contract section 12 step 5). If it commits between steps 2 and 3, the project is gone and deleteTeam returns NOT_FOUND for a team that exists.
- The refusal depends on a link to a project. That project may be private and unreadable to the org admin, which goes against review C2: "no refusal ... differs because a team is linked to a private project the caller cannot read".
- deleteTeam would also write TEAM_UNASSIGNED for a link it never deleted, if the lock helper did not refuse.

**Fix:** Lock without refusing on missing rows, then re-read the links under the locks:
```ts
const candidates = await tx.projectTeam.findMany({ where: { organizationId: actor.orgId, teamId }, select: { projectId: true } });
if (candidates.length > 0) {
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "organizationId" = ${actor.orgId}
    AND "id" = ANY(${[...new Set(candidates.map((c) => c.projectId))]}::text[]) ORDER BY "id" FOR UPDATE`;
}
const links = await tx.projectTeam.findMany({ where: { organizationId: actor.orgId, teamId }, orderBy: { projectId: "asc" }, select: { id: true, projectId: true } });
// use `links` (read under the locks) for the deletes and the TEAM_UNASSIGNED rows
```
A link can no longer be added in between, because assignTeamToProject needs the team FOR SHARE.

### WR-04: setProjectPrivacy(true) can orphan a project through the service itself (no active manager or member check)

**File:** `src/lib/projects/projects.ts:440-455` (with `access.ts:207`)
**Issue:** On a non-private project, an org owner or admin has MANAGE without a ProjectMember row (`access.ts:207`). When every MANAGER row of the project belongs to a user who has left the organization, the following happens:
- Such rows grant nothing and do not count for LAST_MANAGER.
- An org admin can still call `setProjectPrivacy(true)`, which then succeeds.
- Afterwards no active user can read or manage the project. The admin is locked out as well, because owners and admins do not bypass privacy (14-o1). Nothing can reverse it.

The contract (section 2) accepts orphaning only through an outside Better Auth member delete. Here a service call that this phase owns creates the orphan.

**Fix:** In `setProjectPrivacy`, when `next === true`, refuse unless at least one MANAGER row belongs to an active organization member:
```ts
if (next && !p.isPrivate) {
  const managers = await tx.projectMember.findMany({ where: { organizationId: actor.orgId, projectId, role: "MANAGER" }, select: { userId: true } });
  if ((await activeOrgUserIds(tx, actor.orgId, managers.map((m) => m.userId))).size === 0) refuse("LAST_MANAGER");
}
```
This needs the `plan` callback of `editProject` to become async, or a pre-check before `plan`. Add the rule to contract section 2 in the same commit (section 0 amendment rule).

### WR-05: The project description is length-checked after trim but stored untrimmed, so the CHECK violation escapes as an exception

**Files:** `src/lib/projects/projects.ts:64-70`; `prisma/migrations/20261113100000_projects_foundation/migration.sql:564-565`
**Issue:** `validDescription` checks `codePointLength(raw.trim()) > PROJECT_DESCRIPTION_MAX` but returns `raw`. A description of 5000 code points plus surrounding whitespace (one trailing newline, as a Markdown editor adds) passes the service. It then fails `Project_description_length_check` (`char_length("descriptionMarkdown") <= 5000`) with SQLSTATE 23514.

`mapDatabaseError` does not map that code, so `createProject` and `updateProject` throw instead of returning `INVALID_INPUT` with field `description`.

**Fix:** Validate the value that is stored.
```ts
const value = raw; // or raw.trim() if trimming is intended
if (codePointLength(value) > PROJECT_DESCRIPTION_MAX) refuse("INVALID_INPUT", "description");
return value;
```
Check the same pattern in the task description, milestone description and comment validators (part b).

### WR-06: Organization-wide prefix uniqueness is an existence oracle for private projects

**Files:** `src/lib/projects/projects.ts:124-139,166,208,474`
**Issue:** `createProject` and `changeProjectKeyPrefix` return PREFIX_TAKEN when the prefix belongs to, or was ever reserved by, any project of the organization. That includes a private project the caller cannot read.
- Any active member can test candidate prefixes (`HR`, `LEGAL`, `ACQ`, ...) and learn that a project with that prefix exists or existed.
- Through task keys, the same answer carries over to activity rows and links people share.
- Reservations of deleted projects make the answer ambiguous, but they do not remove the oracle.

Contract section 6 requires organization-wide uniqueness. Neither the contract nor the threat model records this oracle against D-04 ("existence ... never revealed").

**Fix:** This is an owner decision under section 0 and must not be changed silently. The options:
- (a) Record the oracle as an accepted, stated limitation next to 14-o1 in contract section 13 and ANTREAN.
- (b) Make prefixes unique per project namespace and add the project id to the key resolution.
- (c) Rate-limit and audit PREFIX_TAKEN refusals.

Until then, do not claim "no existence leak" for private projects without this exception.

### WR-07: People and team lists are silently cut at LIST_MAX with no `hasMore` and no cursor

**Files:**
- `src/lib/projects/members.ts:152-160` (listProjectMembers `.slice(0, LIST_MAX)`)
- `src/lib/projects/members.ts:196-199` (listEligibleAssignees `.slice(0, LIST_MAX)`)
- `src/lib/projects/teams.ts:125-129` (listTeams `take: LIST_MAX`)
- `src/lib/projects/teams.ts:418-426` (listProjectTeams `take: LIST_MAX`)

**Issue:** Contract section 15 says the lists (members, teams and the rest) have a default of 50, a maximum of 200, and use keyset cursors. These four return at most 200 rows and give the caller no sign that rows were dropped.
- In an organization with more than 200 members, listEligibleAssignees on a non-private project never returns the users that sort after the 200th name. Phase 15 cannot offer them as assignees.
- listTeams drops teams that sort after the 200th name.

The 14-08 SUMMARY records this as a decision, but it contradicts the frozen contract, and no section 0 amendment was made.

**Fix:** Add `{ cursor?, limit? }` and return `{ ..., hasMore, nextCursor }` with a (name, id) keyset, the same shape as `listProjects`. At minimum, return `hasMore: true` when the full set is larger than the cut, and record the deviation as a contract amendment.

## Info

### IN-01: Some input validation runs before the membership and access checks, against the recorded 14-04 decision

**Files:**
- `src/lib/projects/projects.ts:326` (`validVersion` before `requireProject`)
- `src/lib/projects/members.ts:99-100,240,281-282`
- `src/lib/projects/teams.ts:198,238,340,381`

**Issue:** A former member, or an outsider using the victim's organization, gets `INVALID_INPUT` instead of `MEMBERSHIP_ENDED` for a malformed version, user id, role or name. In teams.ts, a non-admin gets `INVALID_INPUT` instead of `NOT_ALLOWED`. No existence leak, because the answer is the same for missing and hidden targets. It does not match the 14-04 SUMMARY ("Input validation of the MANAGE edits runs after the project lock and the access check").
**Fix:** Move these validations after `requireProject` or `requireOrgAdmin`, or record the order as intended.

### IN-02: editProject reports a no-op before it checks `expectedVersion`

**File:** `src/lib/projects/projects.ts:329-338`
**Issue:** A stale `expectedVersion` with values equal to the stored ones returns `{ ok: true, changed: false }` rather than CONFLICT. This is harmless, but a client cannot tell from the result that its version is stale.
**Fix:** Compare `access.project.version !== expectedVersion` (the row is locked FOR UPDATE) and return CONFLICT before the no-op test, or document the precedence.

### IN-03: The activity byte bound is measured differently in the writer and in the CHECK

**Files:** `src/lib/projects/activity.ts:104`; `prisma/migrations/20261113100000_projects_foundation/migration.sql:658-661`
**Issue:** The writer measures `JSON.stringify(out)`, which has no whitespace. The CHECK measures `octet_length("before"::text)`, and `jsonb::text` prints `{"a": 1, "b": ["x", "y"]}` with a space after every `:` and `,`. A value of up to 4096 bytes in JS can exceed 4096 in the database, about one byte more per key and per array separator. The insert then fails with an unmapped 23514. Current values are far below the bound.
**Fix:** Leave headroom in the writer, for example by checking `JSON.stringify(out).length + 2 * keys + arrayItems` against the bound. Alternatively, compare against the same `jsonb::text` form with `pg_column_size`.

### IN-04: setProjectMemberRole promotes a user whose organization member row is gone

**File:** `src/lib/projects/members.ts:286-296`
**Issue:** addProjectMember checks eligibility (C14). setProjectMemberRole does not, so a stale ProjectMember row can be promoted to MANAGER. That manager never counts for LAST_MANAGER and never passes `requireMembership`. The project gets a manager who cannot act, and the UI may show it as managed.
**Fix:** Refuse `NOT_ELIGIBLE` when promoting to MANAGER a user for whom `findConservativeMembership` returns null.

### IN-05: The append-only trigger does not cover TRUNCATE

**File:** `prisma/migrations/20261113100000_projects_foundation/migration.sql:702-704`
**Issue:** `BEFORE UPDATE OR DELETE ... FOR EACH ROW` does not fire on `TRUNCATE "ProjectActivity"`. This is the same as the TicketAuditEvent precedent, so it is not a regression.
**Fix (later migration):** `CREATE TRIGGER ... BEFORE TRUNCATE ON "ProjectActivity" FOR EACH STATEMENT EXECUTE FUNCTION aida_project_activity_immutable();`

### IN-06: "Reserved forever" depends only on the service fence

**Files:** `prisma/migrations/20261113100000_projects_foundation/migration.sql:317,398`
**Issue:** No database constraint ties `Project(organizationId, keyPrefix)` to a `ProjectKeyPrefix` row owned by that project. A write outside `reservePrefix` can give a project another project's retired prefix, and `Project_organizationId_keyPrefix_key` will not catch it. That write could be a later service, the duplicate path, or a seed script.
**Fix:** Add a trigger on `Project` (INSERT, or UPDATE OF `keyPrefix`) that requires `EXISTS (SELECT 1 FROM "ProjectKeyPrefix" WHERE "organizationId" = NEW."organizationId" AND "prefix" = NEW."keyPrefix" AND "projectId" = NEW."id")`, or record that the service is the only fence.

### IN-07: mapDatabaseError classifies errors by substring over the whole error text

**File:** `src/lib/projects/service.ts:103-144`
**Issue:** The mapping searches a string joined from code, message, meta and the cause chain. It checks `PREFIX_INDEXES` before `NAME_INDEXES`, and maps `Task_dates_check` or the trigger messages wherever they appear. If a driver or Prisma version adds constraint details or values to `message` or `meta`, user text could shift the mapping, or turn an unrelated failure into a refusal instead of a rethrow. No such path was shown with the current driver.
**Fix:** Match on the structured constraint or index name (`meta.target`, `meta.driverAdapterError.cause.constraint`, `err.constraint`) and SQLSTATE (`P0001` for the trigger, `23514` with `constraint === "Task_dates_check"`). Do not search free text.

---

_Reviewed: 2026-11-09T15:03:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Orchestrator dispositions (parts a, b, c)

Reviews: part a (this file), b (`14-REVIEW-b.md`), c (`14-REVIEW-c.md`), static, on `d88de64..HEAD` (after `a2d54fa`). No reviewer found a read or write path into a private project for a non-member, a team member (K69), an org admin or another organization.

Run decision **K71** (a-CR-01, charter rule 4): the stored organization-wide project `position` is never exposed; `listProjects`, `getProject`, cursors and `PROJECT_REORDERED` activity use only order among the projects the reader can read (cursor by visible order key, not raw position); `moveProjectPosition` takes a visible neighbour as anchor, rebalances internally, and its `changed` result and activity depend only on the visible order.

Owner item **14-o3** (a-WR-06, b-WR-03): organization-unique key prefixes (contract) let a member probe whether a hidden private project uses a prefix, and an old key moved out of a private project still resolves for readers of the target project, which with the probe can recover the redacted source key. Default kept as the contract states; owner decides whether prefixes and aliases should be scoped differently.

| ID | Severity | Disposition | Batch |
|---|---|---|---|
| a-CR-01 | Critical | accept (K71); tests: two worlds differing only by hidden private projects give identical list, cursor, position-related results and activity | F1 |
| a-WR-01, b-IN-02 | Warning | accept: `requireTask` returns CONFLICT when the task's project changed under the lock, never locks a second project out of order; 40P01 mapped to CONFLICT as a last resort | F1 |
| a-WR-02 | Warning | accept: `createProject` and `changeProjectKeyPrefix` take prefix rows in one order; a unique violation maps to PREFIX_TAKEN | F1 |
| a-WR-03 | Warning | accept: `deleteTeam` locks the team and then its linked projects in id order before reading links | F1 |
| a-WR-04 | Warning | accept: `setProjectPrivacy(true)` requires at least one active manager to remain, else `LAST_MANAGER` | F1 |
| a-WR-05, b-WR-02 | Warning | accept: store the trimmed text that was validated; map the length CHECKs to INVALID_INPUT | F1 |
| a-WR-06, b-WR-03 | Warning | owner item 14-o3 | — |
| a-WR-07, b-WR-05 | Warning | accept: keyset paging with `hasMore` and `nextCursor` per contract section 15 for members, eligible assignees, teams, project teams, milestones and favorites | F1 |
| b-WR-01 | Warning | accept: `bulkUpdateTasks` applies the patch before creating a recurrence successor; test that the successor carries the new values | F1 |
| b-WR-04 | Warning | accept: `cleanDisplayName` removes bidi overrides and isolates, C0 and C1 controls and zero-width characters; unit tests | F2 |
| c-WR-01 | Warning | accept: `filesOnDisk` returns empty only on ENOENT, rethrows other errors | F2 |
| c-WR-02 | Warning | accept: refused-upload isolation cases also assert no new file on disk | F2 |
| c-WR-03 | Warning | accept: the inventory strips string literals, test titles and comments before matching markers, and does not expand seeding helpers such as `seedActivity`; negative cases for each | F2 |
| c-WR-04 | Warning | accept: isolation snapshots and activity counts cover the outsider's organization too | F2 |
| a-IN-02 | Info | accept: version checked before the no-op check in `editProject` | F1 |
| a-IN-03 | Info | accept: the activity writer measures size as the database does (`jsonb::text`) or keeps a margin | F1 |
| a-IN-04 | Info | accept: `setProjectMemberRole` to MANAGER requires an active organization member | F1 |
| a-IN-07 | Info | accept: `mapDatabaseError` classifies by constraint name and SQLSTATE | F1 |
| b-IN-03 | Info | accept: `getTask` returns no predecessor id the reader cannot read | F1 |
| b-IN-05 | Info | accept: bounded attempts for the sweep (a permanent failure stops after the limit and is reported in the row); file I/O stays inside the locked row's transaction only if bounded by the job timeout, else after commit with the row kept until success | F1 |
| b-IN-09 | Info | accept: one rule for list limits (refuse above the maximum) | F1 |
| c-IN-01 | Info | accept: comment in the cleanup test naming its dependency on `fileParallelism: false` | F2 |
| c-IN-02 | Info | accept: tests restore `UPLOADS_DIR` (temporary directories stay; no recursive delete under the charter) | F2 |
| c-IN-03 | Info | accept: the second-sweep blocker assertion can fail, and a SKIP LOCKED regression fails fast instead of hanging | F2 |
| c-IN-04 | Info | accept: correct the T7 comment | F2 |
| a-IN-01 | Info | reject: validation before access gives the same answer for a missing and an inaccessible id, so it reveals nothing |  — |
| a-IN-05, a-IN-06, b-IN-06 | Info | defer: TRUNCATE on append-only tables (same as existing pattern), database-level prefix reservation, orphan staging files after a crash |  — |
| b-IN-01 | Info | reject: cannot deadlock while every such operation holds the project `FOR UPDATE` |  — |
| b-IN-04 | Info | accept as documented limit (recurring task near 2999-12-31 cannot complete) |  — |
| b-IN-07 | Info | already deferred (14-03) |  — |
| b-IN-08 | Info | reject: duplication, no defect |  — |

## Codex diff critique

### Round 1

- Question `run-loop/codex/fase14-diff-tanya.md` (commit `4d4b84b`); answer `run-loop/codex/fase14-diff-jawab.md`; log `model: gpt-6.1-terra`, `reasoning effort: xhigh`. Verdict: not ready (3 HIGH, 1 LOW).

| ID | Severity | Finding (short) | Disposition |
|---|---|---|---|
| D1 | HIGH | `listTaskComments` and the attachment list check task access, then read content by organization and task id outside a transaction; a move into a private project in between can return private content (`comments.ts:113`, `service.ts:212`, `attachments.ts:100`) | accept: content queries join the current access predicate (or run in one transaction under the read locks of the contract), so content is returned only while the reader can read the task's current project; PID-bound race: read paused after the check, task moved into a private project, private comment added, nothing private returned; same for membership revocation and for attachments |
| D2 | HIGH | The K71 rebalance updates `updatedAt` of every project, including hidden ones, so timestamps reveal hidden projects (`projects.ts:558`, `:298`); the K71 test replaces `updatedAt` with a constant and cannot see it | accept: position rebalancing never changes `updatedAt` (or any other observable field) of projects other than the moved one; the two-world test compares, per project, whether `updatedAt` changed |
| D3 | HIGH | Prefixes and aliases remain historical oracles (owner item 14-o3) | run decision **K72** (charter rule 4): resolving an ALIAS also requires read access to the alias's origin project, else NOT_FOUND identical to a missing key (an alias whose origin project was deleted no longer resolves); two-world test. The prefix probe stays owner item 14-o3 |
| D4 | LOW | The sweep test clears the global outbox and depends on serial files | reject: the dependency on `fileParallelism: false` is documented in the test (c-IN-01) |

### Round 2

- Question `run-loop/codex/fase14-diff-r2-tanya.md` (commit `f81ec37`); answer `run-loop/codex/fase14-diff-r2-jawab.md`; log `model: gpt-6.1-terra`, `reasoning effort: xhigh`. Verdict: not ready (3 HIGH). D2 closed; D1 closed for project-level changes only.

Run decision **K73** (charter rule 4): every read in `src/lib/projects/` carries the full current access predicate in every query that returns content, rows, counts, cursors or `hasMore` (organization membership of the actor plus project readability, through one shared predicate that `readableProjectWhere` itself includes), including follow-up queries of a multi-query response; `resolveTaskKey` decides key kind, alias origin access and the task's current project in one query. Test helper: a PID-bound interleaving per read family (task reads, lists, progress, activity feeds, team reads, key resolution) for organization-member removal, project-member removal, privacy change and move.

| ID | Severity | Finding (short) | Disposition |
|---|---|---|---|
| R2D-1 | HIGH | `readableProjectWhere` does not check organization membership; an organization member removed after the initial check can still read public-project content in the D1 reads and every `runProjectRead` read (`access.ts:372`, `service.ts:213`) | accept (K73) |
| R2D-2 | HIGH | Many reads check access once and then query by id: `getTask`, `listProjectTasks`, `listLabels`, `listProjectMilestones` (task counts), `listProjectMembers`, `listEligibleAssignees`, `listProjectTeams`, `getTeam`, the three progress functions, and the three activity feeds | accept (K73); each listed function fixed and covered |
| R2D-3 | HIGH | `resolveTaskKey` reads kind, origin access and task in separate statements; the prefix oracle stays owner item 14-o3 | accept (K73, single query); prefix stays 14-o3 |
