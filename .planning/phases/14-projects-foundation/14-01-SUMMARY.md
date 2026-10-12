---
phase: 14-projects-foundation
plan: 01
subsystem: projects
status: complete
tags: [projects, contract, access-matrix, lock-order, activity, redaction, d-17]
requires: []
provides:
  - "src/lib/projects/contract.ts: frozen sets, codes, verbs, bounds, formats, validators and PROJECT_OPERATIONS (76 operations)"
  - ".planning/phases/14-projects-foundation/14-CONTRACT.md: the frozen Phase 14 contract, sections 0 to 17"
affects: [14-02, 14-03, 14-04, 14-05, 14-06, 14-07, 14-08, 14-09, 14-10, 14-11, 14-12, 14-13]
tech-stack:
  added: []
  patterns:
    - "const arrays with derived union types (proposal-contract.ts style)"
    - "operation table as frozen data (access matrix checked by plan 14-13)"
    - "Intl.DateTimeFormat formatToParts for time zones, no date package"
key-files:
  created:
    - src/lib/projects/contract.ts
    - tests/unit/project-contract.test.ts
    - .planning/phases/14-projects-foundation/14-CONTRACT.md
  modified: []
decisions:
  - "normalizePrefix returns null for an invalid prefix (not the raw normalized string); isValidPrefix is normalizePrefix(raw) !== null"
  - "CalendarDate is a plain string alias (no brand); parseCalendarDate returns the date or null and fromCalendarDate throws RangeError on an invalid date"
  - "PROJECT_OPERATIONS, each entry, each verbs array, REDACTED_SIDE and TRANSACTION_OPTIONS are Object.freeze'd"
  - "14-CONTRACT.md is generated from the plan's contract block verbatim (diff-checked), with a 'Module names' bullet added under sections 1, 2, 3, 5, 6, 7, 8, 12, 14 and 15"
metrics:
  duration: "about 6 minutes"
  completed: 2026-11-09
actuals:
  tokens: 30564
  tasks: 2
  commits: 2
plan_head_before: d88de64feae2004012ceeb8b507d654774bc52b6
---

# Phase 14 Plan 01: Frozen projects contract Summary

The Phase 14 contract is frozen (D-17) as one pure, client-safe module, `src/lib/projects/contract.ts`, holding the sets, 20 refusal codes, 41 activity verbs, bounds, key and date formats, validators and the 76-entry operation table, plus `14-CONTRACT.md`, which reproduces sections 0 to 17 of the plan's contract block verbatim. The two agree, and both include review rounds 1 to 3 and K69.

## What was built

- **Task 1 (tracer), `842120a`:** `src/lib/projects/contract.ts` has no Prisma import, no `node:` import and no path alias. Its module comment names `14-CONTRACT.md` and summarizes the lock order (parent before subtask, review C3), the access steps with K69, redaction and its projection (review C1, R2-1, R3-1), feed pages (review R3-3), the favorite archive exception and the toggles' share lock (review R2-2, P4), duplicateProject's source lock (review R3-2), the delete order (review R2-3) and the exactly-once recurrence rule. `tests/unit/project-contract.test.ts` has 24 cases covering every behavior line of the plan. The lucide-react icon check runs only in the test.
- **Task 2, `301684a`:** `.planning/phases/14-projects-foundation/14-CONTRACT.md` has a title, the line "Frozen by plan 14-01 (D-17)", and sections 0 to 17. `diff -B` against the plan's contract block, with the added "Module names" bullets left out, shows the text is verbatim. The document never names the reference product.

## Names the module chose that the contract block left open

- Section 1: `PROJECT_MODULES` (`ProjectModule`), the 19 values of the Module column. Also `ProjectOperationSpec` and `ProjectOperationName`, and the union types `AccessLevel`, `LockMode` and `IsolationExpectation`.
- Section 2: `isWellFormedId(value)`, which implements step 1, and `ID_MAX_LENGTH` (64).
- Section 5: `ActivityVerb`, `ActivityEntityType`, `ActivityFeedRowKey`, `ActivityScalar`, `ACTIVITY_LIST_DEFAULT` (50), `ACTIVITY_ARRAY_MAX_ITEMS` (50), `ACTIVITY_ARRAY_TEXT_MAX` (80), `ACTIVITY_KEY_PATTERN` and `ACTIVITY_FORBIDDEN_KEYS`.
- Section 6: `PREFIX_PATTERN`, `TASK_KEY_PATTERN`, `TASK_KEY_SEPARATOR` and `TaskKeyKind`. `normalizePrefix` returns `string | null`, and `parseTaskKey` returns `{ prefix, number } | null`.
- Section 7: `isCalendarDate`, `CALENDAR_DATE_MIN`, `CALENDAR_DATE_MAX`, `TIME_ZONE_MAX_LENGTH` (64), `DEFAULT_TIME_ZONE` and `RecurrenceRule`. `fromCalendarDate` throws RangeError on an invalid date. `todayInTimeZone` pins the Gregorian calendar and Latin digits.
- Section 12: `PROJECT_FILE_CLEANUP_BATCH` (100) and `PROJECT_FILE_CLEANUP_MAX_BACKOFF_MINUTES` (60).
- Section 14: `ProjectRefusal` and `ProjectResult<T>`.
- Section 15:
  - The defaults `DEFAULT_TASK_STATUS`, `DEFAULT_PROJECT_STATUS`, `DEFAULT_TASK_PRIORITY`, `DEFAULT_PROJECT_COLOR` and `DEFAULT_LABEL_COLOR`.
  - The length constants `PROJECT_NAME_MAX`, `PROJECT_DESCRIPTION_MAX`, `TASK_TITLE_MAX`, `TASK_DESCRIPTION_MAX`, `COMMENT_BODY_MAX`, `LABEL_NAME_MAX`, `MILESTONE_NAME_MAX`, `MILESTONE_DESCRIPTION_MAX`, `TEAM_NAME_MAX` and `FILE_NAME_MAX`, gathered with their minimums in `TEXT_LENGTHS`.
  - The union types `TaskStatus`, `ProjectStatus`, `TaskPriority`, `ProjectMemberRole`, `ProjectColor` and `ProjectIcon`.

Each of these is also listed in 14-CONTRACT.md as a "Module names" bullet under its section.

## Verification

- Task 1 verify, run literally as one chain (vitest, biome, the alias grep, the import grep, `pnpm exec next typegen`, `pnpm typecheck`): exit 0, 1 test file, 24 passed.
- Task 1 acceptance greps all pass:
  - `14-CONTRACT.md` appears twice in contract.ts.
  - Every required name appears in the test, including favoriteProject, duplicateProject and PROJECT_UPDATE.
  - Every required export is present.
- Task 2 verify, run literally: exit 0. It prints "contract consistent 164", and every section heading, review row and rule name is present.
- Task 2 acceptance:
  - `grep -ci gr8r` on the document prints 0.
  - `D-12 (recorded deviation)` appears exactly once.
  - The operation table has 76 rows.
  - Both RAISE messages are present.
  - Rows C1 to C18, K59 and K61 to K69 are present.
  - 14-o1, 14-o2 and 12.2-o4 are present.
- Tracer gate: the run has no human, so the tracer was treated as auto mode. Task 1's verify was re-run end to end in the chain above before Task 2 started, and passed.

## Deviations from Plan

- **[Rule 3, formatting] biome formatter applied.** biome check failed the first time on line wrapping only (short `op(...)` calls that fit in 100 columns). `biome check --write` reformatted the two files, and the check then passed. No logic changed. This was folded into commit `842120a`.

Otherwise the plan was executed as written.

## Known Stubs

None.

## Threat Flags

None. The module is pure data and pure functions, and it adds no endpoint, file access or schema.

## Self-Check: PASSED

- FOUND: src/lib/projects/contract.ts
- FOUND: tests/unit/project-contract.test.ts
- FOUND: .planning/phases/14-projects-foundation/14-CONTRACT.md
- FOUND: 842120a
- FOUND: 301684a
