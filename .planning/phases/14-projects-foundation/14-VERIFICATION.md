---
phase: 14-projects-foundation
verified: 2026-11-09T23:58:00Z
status: human_needed
score: 7/7 roadmap success criteria verified (owner items and stated limitations open, not claimed)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/14-projects-foundation/14-01-PLAN.md
  - .planning/phases/14-projects-foundation/14-01-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-02-PLAN.md
  - .planning/phases/14-projects-foundation/14-02-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-03-PLAN.md
  - .planning/phases/14-projects-foundation/14-03-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-04-PLAN.md
  - .planning/phases/14-projects-foundation/14-04-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-05-PLAN.md
  - .planning/phases/14-projects-foundation/14-05-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-06-PLAN.md
  - .planning/phases/14-projects-foundation/14-06-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-07-PLAN.md
  - .planning/phases/14-projects-foundation/14-07-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-08-PLAN.md
  - .planning/phases/14-projects-foundation/14-08-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-09-PLAN.md
  - .planning/phases/14-projects-foundation/14-09-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-10-PLAN.md
  - .planning/phases/14-projects-foundation/14-10-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-11-PLAN.md
  - .planning/phases/14-projects-foundation/14-11-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-12-PLAN.md
  - .planning/phases/14-projects-foundation/14-12-SUMMARY.md
  - .planning/phases/14-projects-foundation/14-13-PLAN.md
  - .planning/phases/14-projects-foundation/14-13-SUMMARY.md
  - src/lib/projects/access.ts
  - src/lib/projects/keys.ts
  - src/lib/projects/progress.ts
  - src/lib/projects/recurrence.ts
  - src/lib/projects/teams.ts
  - src/lib/scoped-db.ts
covered_digest: "v1:sha256:c4302d7fb48ff65e7e1160205f73b451c39341a1d7ba9d15444f95cccecf4e3c"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Owner item 14-o1: decide K62 (org owner and admin do not see private projects), the orphan risk T-14-42 (private project whose managers all leave) and whether live team-based access to private projects is wanted after K69"
    expected: "Owner confirms or changes the default; code currently refuses orgAdmin and teamMember on private projects (access.ts:204-207)"
    why_human: "Product decision reserved to the owner; not verifiable by code"
  - test: "Owner item 14-o2: the audit clauses of AIDA-103 and AIDA-104 (delete writes an audit event)"
    expected: "Owner accepts TASK_DELETED / PROJECT_DELETED ProjectActivity rows (K63) as the audit record, or asks for AuditEvent rows; retention and readers of a deleted project's activity decided"
    why_human: "The requirement text says AuditEvent; the implementation uses ProjectActivity by default pending owner confirmation. Open, not passed"
  - test: "Owner item 14-o3: organization-unique key prefixes let a member probe whether a hidden private project uses a prefix (a-WR-06, b-WR-03, R3D-2)"
    expected: "Owner decides whether prefixes should be scoped or the oracle accepted; alias oracle already closed by K72"
    why_human: "HIGH-rated owner decision; open, not passed"
  - test: "Stated limitation review C8 (tied to 12.2-o4): Better Auth member delete is not serialized against project writes"
    expected: "Owner accepts the limitation or schedules a fix"
    why_human: "Known limitation; no test proves serialization"
  - test: "Stated limitation: a multi-statement read response is not one snapshot (K73 puts the predicate in every query, but statements may see different commits)"
    expected: "Owner accepts or schedules a REPEATABLE READ / single-statement change"
    why_human: "Known limitation; consistency across statements is not claimed"
  - test: "O-1 blocked steps and manual item of plan 14-05: full integration with the egress file, pnpm test:egress, compose stack; attachment cleanup sweep and inbound-email attachments in the running stack (K68 worker uploads volume)"
    expected: "Stack up, worker mounts uploads volume, cleanup outbox empties, inbound attachments stored"
    why_human: "Blocked by O-1; the K68 compose change is proven statically only"
---

# Phase 14: Projects Foundation Verification Report

**Phase Goal:** The Projects module has a correct, tenant-safe data and logic layer before any view is built.
**Verified:** 2026-11-09 on `v2/run-loop` HEAD `57c7bad` (no `src/` or `prisma/` change since the final gate commit `41b1597`; `git diff --stat 41b1597 HEAD -- src prisma` empty)
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Projects, tasks, subtasks, comments, attachments, activity and teams scoped through `scopedDb`, with unmocked isolation tests | VERIFIED | `src/lib/scoped-db.ts:39-57` registers all 18 Phase 14 models; `tests/unit/project-schema-parity.test.ts` (run here, passed); `tests/integration/projects-schema.test.ts` "scopedDb of another organization never sees or changes organization A's rows in the 18 models" (run here, passed); no `vi.mock` in any `tests/integration/project-*.test.ts` (grep count 0) |
| 2 | Every mutation writes one activity record | VERIFIED | `src/lib/projects/activity.ts` single writer; `tests/integration/project-activity.test.ts` (run here, passed); `tests/unit/project-operation-inventory.test.ts` (run here, 40 tests with parity, passed) checks every operation has a behaviour test with the ProjectActivity count check; refused writes compare `projectTableSnapshot()` and activity count in every isolation file run here |
| 3 | A private project can be neither read nor changed by a non-member, a team member (K69), an org admin or another organization through any path, including existence oracles (K71, K72, K73) | VERIFIED (prefix oracle 14-o3 excepted, open) | `access.ts:204` private without own ProjectMember row is NOT_FOUND; `access.ts:207` admin manages only non-private; `access.ts:386-397` shared read predicate has org membership plus `isPrivate=false OR own member row`, no team branch; K69 copy on assignment `teams.ts:516-540`; tests run here and passed: `project-access.test.ts` "private project: manager and member by role, teamMember, nonMember, orgAdmin and outsider NOT_FOUND", `project-core-isolation`, `project-content-isolation`, `project-tasks-isolation`, `project-ops-isolation`, `project-move-duplicate-isolation`, `project-members-isolation`, `project-archive-delete-isolation`, `project-recurrence-isolation`, `project-review-fixes.test.ts` (K71 two-world position/updatedAt, K72 alias origin), `project-key-resolve-race.test.ts` (K73 single-query resolver) |
| 4 | Every Phase 15 operation (move, reorder, bulk update, date change) authorized on the server | VERIFIED | `move.ts:93 moveTask`, `ordering.ts:79 reorderTask`, `bulk.ts:185 bulkUpdateTasks`, `tasks.ts:718 setTaskDates`, each through `requireProject`/`requireTask`; `project-ops-isolation.test.ts` blocks "reorderTask", "bulkUpdateTasks"; `project-move-duplicate-isolation.test.ts` block "moveTask"; `project-tasks-isolation.test.ts` block "setTaskDates"; `project-ops-race.test.ts` (all run here, passed) |
| 5 | Archive, restore and favorite work | VERIFIED | `archive.ts:79,114,155,195`, `favorites.ts:38-175`; `project-archive-favorites.test.ts` "archiveProject by the manager writes PROJECT_ARCHIVED and leaves the default list", "favorites are per user" (run here, passed) |
| 6 | `git grep -i -n gr8r -- src docs website README.md public prisma tests` empty | VERIFIED | Run here on HEAD: no output, exit 1 |
| 7 | Task keys unique under concurrency, recurrence exactly once, progress derived | VERIFIED | `keys.ts:24-39` atomic `UPDATE ... RETURNING` counter; `recurrence.ts:370-372` conditional `recurrenceSpawned` flip plus partial unique index; no progress column in `prisma/schema.prisma` (only enum `IN_PROGRESS`); tests run here and passed: `project-task-keys.test.ts` "20 parallel creates ... 20 distinct keys", `project-recurrence-race.test.ts` "two completions ... one successor", `project-progress.test.ts` "an empty project is 0 percent of 0" |

**Score:** 7/7 truths verified (0 present, behavior-unverified). Owner items and stated limitations are listed below as open and are not counted as passed.

### Behavioral Spot-Checks (this verifier, one process at a time)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Inventory and schema parity | `pnpm exec vitest run tests/unit/project-operation-inventory.test.ts tests/unit/project-schema-parity.test.ts` | 2 files, 40 passed | PASS |
| Access, schema isolation, review fixes, keys, recurrence race, progress, archive/favorites, activity | integration config, 8 named files | exit 0, 8 files, 123 passed | PASS |
| Isolation files (core, content, tasks, ops, move/duplicate, members, archive/delete, recurrence), key-resolve race, ops race, members/teams, delete | integration config, 12 named files | exit 0, 12 files, 139 passed | PASS |
| Clean-room grep | `git grep -i -n gr8r -- src docs website README.md public prisma tests` | empty, exit 1 | PASS |

The full gate was not rerun (per instruction). Gate record on `41b1597`: lint, typecheck, unit 838, integration without egress 1297, build green; E2E red on `snooze.spec.ts:101` fixed by `a60d339` (tests only, portable `stopWorker`), full E2E after fix 209 passed, 1 skipped, 0 failed (`14-GATE.md`). The one Testcontainers reaper left by this verifier's runs was removed.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| AIDA-64, 65, 66, 67, 68, 69, 70, 71, 100, 101, 102, 105 | SATISFIED | Truths 1 to 7 and the tests named above; requirement-by-requirement table in `14-GATE.md` "Requirements" |
| AIDA-103, AIDA-104 | SATISFIED except the audit clause | Duplicate, move with alias, archive, restore, confirmed delete with tombstones (`project-delete.test.ts`, run here). The "writes an audit event" clause is a `ProjectActivity` row (K63), owner item 14-o2, open |

No orphaned requirement: all 14 IDs mapped to Phase 14 in REQUIREMENTS.md are claimed by plans.

### Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` in `src/lib/projects/` or the phase migration. No source `auditEvent.delete` (only generated Prisma docstrings).

### Human Verification Required (open, never passed)

1. **14-o1** (owner): K62 org owner/admin exclusion from private projects, orphan risk T-14-42, team-based access after K69.
2. **14-o2** (owner): audit clause of AIDA-103 and AIDA-104, recorded in ProjectActivity, owner confirmation pending.
3. **14-o3** (owner, HIGH): prefix reservation oracle for hidden private projects.
4. **Limitation C8** (tied to 12.2-o4): Better Auth member delete not serialized against project writes.
5. **Limitation**: multi-statement read responses are not one snapshot.
6. **O-1 / plan 14-05 manual item**: egress suite, `pnpm test:egress`, compose stack, attachment cleanup and inbound-email attachments in the running stack. Also still open from earlier phases: O-3 (AIDA-43), 12-o1, 12.2-o4.

### Gaps Summary

No code gap found. Every roadmap success criterion holds in code and in unmocked tests run by this verifier. The status is `human_needed` because owner items 14-o1, 14-o2, 14-o3, the two stated limitations and the O-1-blocked runtime checks need owner decision or a human run.

---

_Verified: 2026-11-09T23:58:00Z_
_Verifier: Claude (gsd-verifier)_
