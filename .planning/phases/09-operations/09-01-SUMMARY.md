---
phase: 09-operations
plan: 01
subsystem: infra
tags: [docker-compose, postgres, database-url, boot-guard, privacy]

requires:
  - phase: 08-security-hardening (Part A)
    provides: "migrate on target builder as the non-root node user, CLI tools called through node (U-01)"
provides:
  - "src/lib/db-url.ts: encodeUrlComponent, encodeDatabaseUrl, parseDatabaseUrl, checkDatabaseUrlConsistency, assertDatabaseUrlConsistent, DatabaseUrlMismatchError"
  - "scripts/database-url.sh: POSIX sh generator printing one AIDA_DATABASE_URL line"
  - "scripts/check-database-url.ts: migrate pre-step running the same guard"
  - "docker-compose.yml: AIDA_DATABASE_URL override with the pre-phase URL as fallback, AIDA_EXPECT_DB_* on migrate, app and worker"
  - "boot guard in src/instrumentation.ts and src/lib/worker/index.ts"
affects: [09-11 stack proof, Phase 8.1 replan (docker-compose.yml, docs/OPERATIONS.md)]

actuals:
  tokens: 9164
  tasks: 3
  commits: 3
plan_head_before: b511b3b0e7b07f6b6dc8050df4bf1e2b5ca8cd7a

tech-stack:
  added: []
  patterns:
    - "Boot guard compares against AIDA_EXPECT_DB_* that only compose sets, so next dev and E2E stay inactive"
    - "Secret-bearing assertions pass only a label and a boolean to expect"

key-files:
  created:
    - src/lib/db-url.ts
    - scripts/database-url.sh
    - scripts/check-database-url.ts
    - tests/unit/db-url.test.ts
    - tests/integration/compose-database-url.test.ts
  modified:
    - docker-compose.yml
    - src/instrumentation.ts
    - src/lib/worker/index.ts
    - tests/unit/container-config.test.ts
    - .env.example
    - docs/OPERATIONS.md
    - website/src/content/docs/configuration/environment.md

key-decisions:
  - "Override variable is AIDA_DATABASE_URL, not DATABASE_URL: the .env DATABASE_URL line is the local-development URL (localhost) and must never reach the services (case E)"
  - "Guard compares the decoded URL with AIDA_EXPECT_DB_USER/PASSWORD/NAME (values of POSTGRES_*), active only when DATABASE_URL and AIDA_EXPECT_DB_PASSWORD are both non-empty"
  - "Docs cite openssl rand -hex 24 as the URL-safe example instead of an installer, because no installer exists in the code yet"

patterns-established:
  - "Compose-config tests: scrubbed CLI environment (shell variables win over --env-file), single-quoted temp env files, JSON parsed in memory"

requirements-completed: []

coverage:
  - id: D1
    description: "A POSTGRES_PASSWORD with / @ : # ? plus the generated AIDA_DATABASE_URL resolves, in docker compose config, to a URL for migrate, app and worker whose decoded user, password and database equal the inputs (AIDA-35 compose-config clause)"
    requirement: AIDA-35
    verification:
      - kind: integration
        ref: "tests/integration/compose-database-url.test.ts#case A, reserved"
        status: pass
    human_judgment: false
  - id: D2
    description: "URL-safe installs need no new variable, and a localhost DATABASE_URL in .env never reaches the services"
    requirement: AIDA-35
    verification:
      - kind: integration
        ref: "tests/integration/compose-database-url.test.ts#case B, url-safe fallback"
        status: pass
      - kind: integration
        ref: "tests/integration/compose-database-url.test.ts#case E, localhost DATABASE_URL ignored"
        status: pass
    human_judgment: false
  - id: D3
    description: "The guard refuses a mismatching or unparsable URL by component name only, in app, worker and migrate"
    requirement: AIDA-35
    verification:
      - kind: integration
        ref: "tests/integration/compose-database-url.test.ts#case C, mismatch"
        status: pass
      - kind: integration
        ref: "tests/integration/compose-database-url.test.ts#case D, raw reserved refused"
        status: pass
      - kind: unit
        ref: "tests/unit/db-url.test.ts#scripts/check-database-url.ts (the migrate pre-step, D-12(4))"
        status: pass
    human_judgment: false
  - id: D4
    description: "Generator percent-encodes user, password and database per UTF-8 byte and exits 2 on an empty password"
    requirement: AIDA-35
    verification:
      - kind: unit
        ref: "tests/unit/db-url.test.ts#scripts/database-url.sh"
        status: pass
    human_judgment: false
  - id: D5
    description: "AIDA-35 stack clause: a stack booted with the reserved-character password connects from migrate, app and worker"
    requirement: AIDA-35
    verification: []
    human_judgment: true
    rationale: "Not run (waiting for the Phase 8.1 harness and the owner); specified by plan 09-11 (U-15)"

duration: 9min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 01: Database URL encoding and boot guard Summary

**A percent-encoded `AIDA_DATABASE_URL` (from `scripts/database-url.sh`) now overrides the raw-password URL compose builds for migrate, app and worker. URL-safe installs keep the old URL with no new variable. All three services refuse to boot on a URL that disagrees with `POSTGRES_*`, and the refusal names only the component.**

## Performance

- **Duration:** about 9 min (ledger start 2026-11-12T06:37:15Z, end 2026-11-12T06:46:18Z)
- **Tasks:** 3 of 3
- **Files:** 5 created, 7 modified

## Accomplishments

- `src/lib/db-url.ts` (node built-ins only, no project imports): per-byte RFC 3986 encoding with uppercase hex; parsing through `new URL` and `decodeURIComponent` (null on failure); a consistency check in the fixed order url, user, password, database; fixed error messages that never contain a value.
- `scripts/database-url.sh` (POSIX sh, mode 100755): uses `od -An -tx1 -v`, works under dash and macOS sh, prints exactly one `AIDA_DATABASE_URL=` line, and exits 2 with nothing on stdout when the password is empty or unset.
- `docker-compose.yml`: `DATABASE_URL: ${AIDA_DATABASE_URL:-postgresql://${POSTGRES_USER:-aida}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-aida}}` plus `AIDA_EXPECT_DB_*` on migrate, app and worker. migrate now runs the guard before `migrate deploy`.
- Boot guard placement: first step of the nodejs branch in `src/instrumentation.ts`; before `new PgBoss` in the worker (relative import); `scripts/check-database-url.ts` for migrate.
- Operator docs: `.env.example`, the `docs/OPERATIONS.md` table and Troubleshooting, and the website env page.

## Task Commits

1. **Task 1 (tracer): generator, pure URL module, compose override, compose-config proof** - `0a038e1` (feat)
2. **Task 2: startup guard in app, worker and migrate** - `14087d8` (feat)
3. **Task 3: operator docs, .env.example, log leak check** - `9e92010` (docs)

## Verification (exit codes read without a pipe)

| Command | Exit | Counts |
|---|---|---|
| `pnpm exec vitest run tests/unit/db-url.test.ts` (final) | 0 | 1 file, 25 passed |
| `pnpm test:integration tests/integration/compose-database-url.test.ts` (final, with `AIDA_TEST_RUN_ID=mwd6amvt-02e36c7d3f46a1da`, `DOCKER_HOST`, `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE`) | 0 | 1 file, 5 passed |
| `pnpm typecheck` | 0 | 0 `error TS` (an earlier run exited 2 with 4 errors; fixed, see Deviations) |
| `pnpm lint` | 0 | 620 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`, `noTemplateCurlyInString`) |
| `pnpm test` (full unit suite, run once after Task 2) | 0 | 79 files, 1421 passed |
| `pnpm exec vitest run tests/unit/db-url.test.ts tests/unit/container-config.test.ts` | 0 | 2 files, 41 passed |
| `colima status` / `docker info` (Docker health before the first Docker step) | 0 / 0 | n/a |

The tracer gate re-ran the integration verify on the formatted Task 1 files before Task 2 (exit 0, 5 passed).

### Acceptance criteria

- Task 1: `grep -c 'DATABASE_URL: \${AIDA_DATABASE_URL:-postgresql://'` prints 3; `grep -c 'AIDA_EXPECT_DB_PASSWORD: \${POSTGRES_PASSWORD}'` prints 3; `git diff --quiet HEAD -- docker-compose.egress-test.yml` exits 0; `POSTGRES_PASSWORD= sh scripts/database-url.sh` exits 2 with 0 bytes on stdout; `git ls-files -s` shows 100755; cases A to E are named in the test; the project-import grep on `src/lib/db-url.ts` prints nothing (exit 1). PASS.
- Task 2: one call of `assertDatabaseUrlConsistent(` in each of `src/instrumentation.ts:8` and `src/lib/worker/index.ts:26`. `grep -c` prints 2 per file because it also counts the import. `scripts/check-database-url.ts` matches. The migrate `command:` line equals the specified string exactly after indentation (`grep -Fx`, exit 0). There is no `from "@/` in the worker (exit 1). PASS.
- Task 3: all three files have an `AIDA_DATABASE_URL` entry that names `scripts/database-url.sh` (each check exit 0). The table comparison script output:
  - `docs/OPERATIONS.md: rows=22 env=22 missing=[] extra=[] duplicates=[] equal=true`
  - `website/src/content/docs/configuration/environment.md: rows=22 env=22 missing=[] extra=[] duplicates=[] equal=true`

  `pnpm lint` exits 0. PASS.

Task 2 confirmations, made by reading the files: `node_modules/tsx/package.json` has version 4.22.4 and `bin` `./dist/cli.mjs`. The Dockerfile builder stage runs `COPY . .`, and `.dockerignore` excludes neither `scripts/` nor `src/`. The stage ends with `USER node`.

### Leak check (no password in logs)

Both Task 1 test commands were run once more, each to its own log in the plan's `mktemp -d` directory. Every grep below exited 1 (no match) on both logs:

| Log | `postgresql://…:<char>…@` | raw `/@:#?` | encoded `%2F%40%3A%23%3F` | reserved-only vector `/@:#?[]!` |
|---|---|---|---|---|
| unit (exit 0, 25 passed) | exit 1 | exit 1 | exit 1 | exit 1 |
| integration (exit 0, 5 passed) | exit 1 | exit 1 | exit 1 | exit 1 |

## U-02 contract (for the Phase 8.1 replan)

**`docker-compose.yml`, on the services migrate, app and worker (no other service touched):**
- `DATABASE_URL: ${AIDA_DATABASE_URL:-postgresql://${POSTGRES_USER:-aida}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-aida}}`
- `AIDA_EXPECT_DB_USER: ${POSTGRES_USER:-aida}`
- `AIDA_EXPECT_DB_PASSWORD: ${POSTGRES_PASSWORD}`
- `AIDA_EXPECT_DB_NAME: ${POSTGRES_DB:-aida}`
- The migrate `command` is `["sh", "-c", "node node_modules/tsx/dist/cli.mjs scripts/check-database-url.ts && exec node node_modules/prisma/build/index.js migrate deploy"]`. It still runs on `target: builder` as `node` and keeps `CHECKPOINT_DISABLE: "1"`. One why-comment block above the migrate `environment:` explains D-12(1), D-12(2), D-12(4) and the naming.
- `docker-compose.egress-test.yml` is unchanged (D-13). Its migrate keeps the plain command and its own fixture URL. `tests/unit/container-config.test.ts` now expects each compose file's command separately.

**`docs/OPERATIONS.md`:**
- In the Environment variable reference, the `DATABASE_URL` row is rewritten (local-development only; compose builds the services' URL from `POSTGRES_*` unless `AIDA_DATABASE_URL` is set) and a new `AIDA_DATABASE_URL` row follows it. The table still lists exactly the `.env.example` variables (22).
- Troubleshooting: the "`app` is unhealthy" entry no longer says "a local `.env` override can conflict" and explains `AIDA_DATABASE_URL` instead. A new entry precedes "Worker heartbeat is stale". It covers `DATABASE_URL ... does not match POSTGRES_PASSWORD` / `could not be parsed`: the cause, the generator command, and the `[migrate]`/`[boot]` log prefixes.

## Decisions Made

- The override is named `AIDA_DATABASE_URL` and the guard reads `AIDA_EXPECT_DB_*`, as the plan's flagged assumptions describe. The guard's messages name POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB, because those are the variables operators set.
- The guard's log prefix is `[boot]` in both the app and the worker, and `[migrate]` in the pre-step. Errors other than `DatabaseUrlMismatchError` are rethrown unchanged.
- The compose test passes a scrubbed environment to the compose CLI (PATH, HOME, DOCKER_* and TMPDIR only). Shell variables take precedence over `--env-file` (Compose docs, checked through Context7), so a `POSTGRES_*` or `DATABASE_URL` in the test process would otherwise override the case files. `--env-file` also stops the repository's `.env` from loading.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing static guard pinned the old migrate command**
- **Found during:** Task 2
- **Issue:** `tests/unit/container-config.test.ts` asserted `command: ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]` for both compose files. That would fail once docker-compose.yml took the planned pre-step.
- **Fix:** the test now expects a command per file: the new one for `docker-compose.yml` and the unchanged one for the egress file. It also checks that tsx's `bin` is `dist/cli.mjs` and that no pnpm/corepack/npx line runs `migrate deploy`.
- **Files modified:** tests/unit/container-config.test.ts
- **Verification:** 2 files, 41 passed; full unit suite 1421 passed
- **Committed in:** 14087d8

**2. [Rule 1 - Bug] Task 1 test files did not typecheck**
- **Found during:** Task 2 (`pnpm typecheck` exit 2, 4 `error TS`)
- **Issue:** this project's `NodeJS.ProcessEnv` requires `NODE_ENV`, so the minimal child environments in both new test files were rejected. Vitest does not typecheck, which is why Task 1's verify passed.
- **Fix:** added `NODE_ENV: "test"` to each minimal child environment.
- **Files modified:** tests/unit/db-url.test.ts, tests/integration/compose-database-url.test.ts
- **Verification:** `pnpm typecheck` exit 0; unit 25 passed; integration re-run in Task 3, 5 passed
- **Committed in:** 14087d8

**3. [Honest claims] No installer reference**
- **Found during:** Task 3
- **Issue:** the plan's `.env.example` text says "the installer generates hex", but no installer exists in the code.
- **Fix:** the docs cite `openssl rand -hex 24` as the URL-safe example.
- **Committed in:** 9e92010

**Total deviations:** 3 (1 Rule 3, 1 Rule 1, 1 wording). **Impact:** all three were needed for correctness, a green typecheck and honest docs. No scope creep.

## Not run

- AIDA-35 stack clause: a stack booted with the reserved-character password, connecting from migrate, app and worker with a positive database proof from the worker. Status: not run (waiting for the Phase 8.1 harness and the owner). Plan 09-11 specifies it (U-15). This plan claims only the compose-config clause.
- No image was built and no compose stack was started. This plan created no Docker resource of its own: `docker compose config` only renders files, and the integration suite's global setup started its usual Testcontainers Postgres under the run id.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the migrate pre-step, which the threat model covers (T-09-04b, accepted). Mitigations T-09-01 to T-09-04a are in place and tested.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None. Operators with a URL-safe password change nothing. Operators with a reserved-character password run `sh scripts/database-url.sh` once, as documented.

## Next Phase Readiness

Ready for the next 09 plan. 09-11 can build the stack proof on these compose variables once the Phase 8.1 harness exists.

## Self-Check: PASSED

- Files exist: src/lib/db-url.ts, scripts/database-url.sh, scripts/check-database-url.ts, tests/unit/db-url.test.ts, tests/integration/compose-database-url.test.ts
- Commits exist: 0a038e1, 14087d8, 9e92010
