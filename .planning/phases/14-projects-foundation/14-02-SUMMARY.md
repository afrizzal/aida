---
phase: 14-projects-foundation
plan: 02
subsystem: database
status: complete
tags: [prisma, postgres, migration, tenancy, triggers, fixtures]
requires: ["14-01"]
provides:
  - "migration 20261113100000_projects_foundation (18 tables, 8 enums, 16 composite RESTRICT keys, CHECKs, triggers)"
  - "tests/support/project-fixtures.ts (seedPrivacyWorld, per-model seeds, projectTableSnapshot)"
affects: ["14-03", "14-04", "14-05", "14-06", "14-07", "14-08", "14-09", "14-10", "14-11", "14-12", "14-13"]
tech-stack:
  added: []
  patterns: ["composite (organizationId, ...) foreign keys ON DELETE RESTRICT ON UPDATE RESTRICT", "hand-written objects listed in a schema comment and the migration header"]
key-files:
  created:
    - prisma/migrations/20261113100000_projects_foundation/migration.sql
    - tests/support/project-fixtures.ts
    - tests/unit/project-schema-parity.test.ts
    - tests/integration/projects-schema.test.ts
  modified:
    - prisma/schema.prisma
    - src/lib/scoped-db.ts
decisions:
  - "Every Phase 14 model except ProjectTaskCounter and TaskLabel has id String @id @default(cuid()), ProjectMember, TeamMember, ProjectTeam and the favorites included (review C4)"
  - "Project's back-relation to ProjectTaskCounter is a list (taskCounters) so the counter's relation needs no extra unique index on (organizationId, projectId); projectId stays its primary key"
  - "seedTask takes an optional labelIds list (extra option) so seedPrivacyWorld links its label through the fixture"
metrics:
  duration: "about 25 minutes"
  completed: 2026-11-09
estimate:
  tokens: 125000
actuals:
  tokens: 28800
  tasks: 3
  commits: 3
plan_head_before: 66621d2819ba723c0fcffcbc3f7182122d1b66c2
---

# Phase 14 Plan 02: Projects schema foundation Summary

One hand-edited migration lays all 18 Phase 14 tables with 16 composite RESTRICT foreign keys, so the database itself refuses cross-project and cross-organization links. It also enforces one subtask level with a trigger and keeps ProjectActivity append-only. Shared fixtures and 49 integration and 11 unit proofs cover it.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Tracer: whole schema in one applied migration | 3833800 | prisma/schema.prisma, migration.sql, src/lib/scoped-db.ts, tests/integration/projects-schema.test.ts |
| 2 | Shared fixtures and the C1 parity proof | 9c580be | tests/support/project-fixtures.ts, tests/unit/project-schema-parity.test.ts |
| 3 | Constraint, trigger, tenancy, move, date and catalog proofs | 5cfd3e6 | tests/integration/projects-schema.test.ts |

## Migration evidence (C18)

- Scratch database: `aida_p14_projects` inside the running `aida-dev-db` container, created with `docker exec aida-dev-db createdb -U aida aida_p14_projects`. The password was read at command time into the command environment only and was written nowhere.
- Generator: `pnpm prisma migrate dev --create-only --name projects_foundation` ran non-interactively and exited 0, so no pseudo-terminal was needed. It produced folder `20261109122218_projects_foundation`, which was renamed to `20261113100000_projects_foundation`.
- Removed generated statements, each recorded in the migration header:
  - Prisma's warning comment block;
  - `DROP INDEX "Message_searchVector_idx"`;
  - `DROP INDEX "Ticket_searchVector_idx"`;
  - `ALTER TABLE "Message" DROP COLUMN "searchVector"`;
  - `ALTER TABLE "Ticket" DROP COLUMN "searchVector"`.

  All four are hand-written in `20260701234808_ticket_search`. The diff named no other earlier hand-written object.
- `pnpm prisma migrate deploy` on aida_p14_projects: exit 0, "All migrations have been successfully applied."
- `pnpm prisma migrate status`: exit 0, "14 migrations found in prisma/migrations / Database schema is up to date!"
- `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`: exit 0, output only the known searchVector drift:

  ```
  -- DropIndex
  DROP INDEX "Message_searchVector_idx";
  -- DropIndex
  DROP INDEX "Ticket_searchVector_idx";
  -- AlterTable
  ALTER TABLE "Message" DROP COLUMN "searchVector";
  -- AlterTable
  ALTER TABLE "Ticket" DROP COLUMN "searchVector";
  ```
- `pnpm prisma generate`: exit 0.
- Drop: `docker exec aida-dev-db dropdb -U aida --if-exists aida_p14_projects` exit 0. `docker exec aida-dev-db psql -U aida -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname = 'aida_p14_projects'"` printed `0`.
- `prisma db push` was never run. `.env` was neither read nor edited (`git status` shows no change to it). No container was created, started, stopped or removed.

## Hand-written objects of 20261113100000_projects_foundation

- **CHECKs:**
  - Project_name_length_check, Project_description_length_check, Project_color_check, Project_icon_check, Project_key_prefix_check, Project_position_check, Project_version_check;
  - ProjectKeyPrefix_prefix_check;
  - Team_name_length_check;
  - ProjectLabel_name_length_check, ProjectLabel_color_check;
  - ProjectMilestone_name_length_check, ProjectMilestone_description_length_check, ProjectMilestone_version_check;
  - Task_no_self_parent_check, Task_dates_check, Task_title_length_check, Task_description_length_check, Task_estimate_check, Task_rank_check, Task_version_check, Task_number_check, Task_key_format_check, Task_recurrence_fields_check, Task_recurrence_top_level_check, Task_recurrence_time_zone_check;
  - TaskKey_key_format_check;
  - TaskComment_body_length_check, TaskComment_version_check;
  - TaskAttachment_storage_key_check, TaskAttachment_filename_length_check, TaskAttachment_size_check;
  - ProjectFileCleanup_storage_key_check, ProjectFileCleanup_attempts_check;
  - ProjectTaskCounter_last_number_check;
  - ProjectActivity_scope_check, ProjectActivity_before_size_check, ProjectActivity_after_size_check.
- **Expression unique indexes:** Team_organizationId_lower_name_key, ProjectLabel_project_lower_name_key, ProjectMilestone_project_lower_name_key.
- **Partial unique index:** Task_recurrence_predecessor_key.
- **Function and trigger pairs:**
  - aida_task_subtask_depth_guard() with trigger aida_task_subtask_depth (BEFORE INSERT OR UPDATE OF "parentId" ON "Task");
  - aida_project_activity_immutable() with trigger aida_project_activity_no_update_delete.

The same list appears in the migration header and in the comment blocks above Project, Task and ProjectActivity in schema.prisma.

## Verification

- Task 1 verify (prisma validate, the 16-key loop, scratch count 0, integration): exit 0, 2 passed.
- Task 2 verify (parity unit, biome, next typegen, typecheck): exit 0, 11 passed.
- Task 3 verify (integration, two unit files, typegen, typecheck, biome): exit 0.
  - Integration: 49 passed.
  - Unit: project-schema-parity and project-contract, 35 passed.
- Acceptance greps:
  - non-comment DROP and searchVector lines: 0;
  - explicit transaction statements: 0;
  - composite foreign keys: 16, and 0 of them are not RESTRICT/RESTRICT;
  - `@db.Date`: 5;
  - `it(` in the integration file: 49;
  - all 16 constraint names are present in the test file;
  - `review C4` appears 2 times and `labelId` 6 times in the fixtures.

## Deviations from Plan

1. **[Rule 3] No pseudo-terminal.** `migrate dev --create-only` ran non-interactively and exited 0, so the `script` fallback was not used.
2. **[Rule 2] ProjectTaskCounter back-relation is a list.** A Prisma one-to-one relation would need a unique index on exactly (organizationId, projectId), which would be an index beyond the plan. The back-relation on Project is therefore a list, `taskCounters ProjectTaskCounter[]`. The constraint name and its RESTRICT actions are unchanged.
3. **Extra fixture option.** `seedTask` accepts an extra `labelIds` option. This adds an option and renames nothing that the plan lists.
4. **TDD RED not committed separately.** The plan places the DOMAIN_MODELS entries in Task 1, before the parity test of Task 2, so the parity test passed on first run. No intentional RED commit exists for Tasks 2 and 3. Both are proof tests over the schema that Task 1 had already applied.
5. **Two CHECK cases beyond the plan list.** The CHECK cases also cover ProjectKeyPrefix_prefix_check, TaskKey_key_format_check and ProjectFileCleanup_storage_key_check next to the listed ones. These are extra assertions; no listed case was dropped.

## Known Stubs

None.

## Threat Flags

None. The plan's threat model covers all new surface: no endpoint, auth path or file access was added.

## Self-Check: PASSED

- Files found: migration.sql, project-fixtures.ts, project-schema-parity.test.ts, projects-schema.test.ts.
- Commits found: 3833800, 9c580be, 5cfd3e6.
