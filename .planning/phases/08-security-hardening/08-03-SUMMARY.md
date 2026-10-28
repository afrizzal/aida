---
phase: 08-security-hardening
plan: 03
subsystem: auth
status: complete
tags: [better-auth, regression-tests, integration, migration-proof]
requires: ["08-02"]
provides:
  - "tests/integration/support/isolated-database.ts (createIsolatedDatabase, deployHeadMigrations)"
  - "permanent D-02 regression tests: populated pre-upgrade copy, bootstrap, /setup"
affects: ["08-04", "phase 10 invitations"]
tech-stack:
  added: []
  patterns: ["one isolated database per test file on the shared Testcontainers server, applied-migration set asserted after every deploy"]
key-files:
  created:
    - tests/integration/support/isolated-database.ts
    - tests/integration/auth-upgrade.test.ts
    - tests/integration/auth-bootstrap.test.ts
    - tests/integration/auth-setup.test.ts
  modified: []
decisions:
  - "Subset migrations deploy through the existing tests/support/prisma-migrate-test.config.ts (--config, schema and migrations path from env), not a --schema flag"
  - "Isolated databases are dropped WITH (FORCE) without prisma.$disconnect, so the adapter's idle-client error listener stays attached"
  - "Each test file restores DATABASE_URL and the auth env it changed, and clears globalThis.prisma, in afterAll"
metrics:
  duration: "about 25m"
  completed: 2026-11-11
  tasks: 2
  files: 4
estimate:
  tokens: 80000
actuals:
  tokens: 5474
  tasks: 2
  commits: 2
plan_head_before: 2355bc4938a141547a1cfdcf32a0b8ec231c76b0
---

# Phase 8 Plan 03: Better Auth Upgrade Regression Tests Summary

D-02's proof from plan 08-02 is now a set of permanent integration tests. A database migrated to the 1.6.22-era migration set is populated with the rows 1.6.22 wrote, then migrated to head with the real `prisma migrate deploy`. On that database, better-auth 1.7.20 accepts the old signed cookie, the old password hash and the old membership. Both first-run paths (headless bootstrap and the `/setup` Server Action) work on the new version. Everything runs in `pnpm test:integration` against real Postgres, with no mocks of the database or Better Auth.

`actuals.tokens` is chars/4 over the realized diff (21,897 chars).

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 7d06455 | test(08-03): prove better-auth upgrade keeps pre-upgrade sessions and logins (D-02) |
| 2 | b630886 | test(08-03): prove bootstrap and /setup on the upgraded better-auth (D-02) |

## Migration-path mechanism that worked

- **Subset (pre-upgrade list):** the listed folders and `migration_lock.toml` are copied into a `mkdtemp` directory under `os.tmpdir()`. Then `pnpm exec prisma migrate deploy --config tests/support/prisma-migrate-test.config.ts` runs with `AIDA_TEST_SCHEMA=<repo>/prisma/schema.prisma` and `AIDA_TEST_MIGRATIONS_DIR=<copy>`. This config file already exists, and `ticket-states-deploy.test.ts` proved it. The `--schema` flag was not tried (Deviation 1).
- **Head:** the repository's own `pnpm exec prisma migrate deploy` (`prisma.config.ts`), with `DATABASE_URL` pointed at the isolated database.
- After every deploy, the helper reads `_prisma_migrations` (`finished_at IS NOT NULL`) and throws, naming both lists, if the set differs from the expected one. Both assertions ran and passed: the pre-upgrade list in `auth-upgrade`, and head in all three files.
- `PRE_UPGRADE_MIGRATIONS` holds the 14 folders from 08-02's fixture, which are every folder under `prisma/migrations` today. The head deploy after the fixture insert therefore applies no new migration. It still exits 0 and re-asserts head. When a later plan adds a migration, the same test deploys that migration onto the populated copy.
- The copied directory is removed in `drop()`. No `aida-isolated-db-*` directory was left under `${TMPDIR}`.

## Test results

| File | Test | Result |
|---|---|---|
| auth-upgrade | D-02: every migration applied on top of the populated pre-upgrade database; five row counts 1; stored values (ids, hash, token, role, slug, `createdAt` text) unchanged | passed |
| auth-upgrade | D-02: the 1.6.22 signed session cookie survives (user id, session id, `activeOrganizationId`) | passed |
| auth-upgrade | D-02: login against the 1.6.22 hash succeeds, and a wrong password is rejected | passed |
| auth-upgrade | D-02: `auth.api.listOrganizations` with the old cookie includes the fixture org; the member role is still `owner` | passed |
| auth-bootstrap | D-02: first call creates 1 user, 1 org `aida`, 1 owner member, `setupComplete` = `true` | passed |
| auth-bootstrap | D-02: a second call changes nothing | passed |
| auth-bootstrap | D-02: the bootstrapped admin can sign in | passed |
| auth-setup | D-02: invalid input (short password) returns an error and creates nothing | passed |
| auth-setup | D-02: valid input creates the admin, org `setup-org`, owner member and `setupComplete`, then throws `NEXT_REDIRECT:/login?setup=complete` | passed |
| auth-setup | D-02: the `/setup` admin can sign in | passed |
| auth-setup | D-02: a second call returns `Setup has already been completed. Please sign in.` and creates nothing | passed |

## Commands and exit codes

| Command | Exit | Counts |
|---|---|---|
| `colima status` / `docker info` before Task 1 | 0 / 0 | colima running, runtime docker |
| `pnpm test:integration tests/integration/auth-upgrade.test.ts` (run id `mwc2c8sz-5506a6a70e73f18b`), final run after the lint fix | 0 | Test Files 1 passed; Tests 4 passed |
| `colima status` / `docker info` before Task 2 | 0 / 0 | |
| `pnpm test:integration tests/integration/auth-bootstrap.test.ts tests/integration/auth-setup.test.ts` | 0 | Test Files 2 passed; Tests 7 passed |
| `colima status` / `docker info` before the full run | 0 / 0 | |
| `pnpm test:integration` (full) | 0 | Test Files 97 passed (97); Tests 1308 passed (1308); `grep -c egress-isolation` on the log = 0 |
| `pnpm typecheck` | 0 | 0 `error TS` |
| `pnpm lint` (Task 1, first run) | 1 | `noNonNullAssertion` in auth-upgrade.test.ts; fixed (Deviation 3) |
| `pnpm lint` (Task 1 final, Task 2) | 0 | Checked 573 / 575 files, no fixes |
| `grep -n "^import .*src/" tests/integration/auth-upgrade.test.ts` | 1 (no match) | empty |
| `grep -nE 'vi\.mock\(".*db\|vi\.mock\(".*auth'` on the two Task 2 files | 1 (no match) | empty |

## Docker

- Run id `mwc2c8sz-5506a6a70e73f18b`, `DOCKER_HOST` from `docker context inspect`. One test process at a time.
- Isolated databases are created and dropped (`DROP DATABASE ... WITH (FORCE)`) inside the run's labelled Testcontainers server from `global-setup.ts`. No other container was created. `aida-dev-db` was not used. `pnpm test:docker-cleanup --apply` was not run.

## Deviations from Plan

**1. [Rule 3 - Blocking/simplification] The existing subset config replaced the `--schema` attempt**
- **Plan:** first try `--schema <copy>/schema.prisma` under `os.tmpdir()`. If that failed, write a `prisma.config.ts` under `node_modules/.cache/aida-isolated-db/`.
- **Done:** the repo already ships `tests/support/prisma-migrate-test.config.ts`, which takes the schema and migrations path from the environment and was proven by `ticket-states-deploy.test.ts`. The helper reuses it with the copy under `os.tmpdir()`. Nothing is written under `node_modules`. The schema is not copied: it comes from the repo, and `migrate deploy` only applies the SQL files. The applied-set assertion confirms that the copied directory was the one deployed.

**2. `deployHeadMigrations` is async (`Promise<void>`)**
- The plan typed it as `void`, but the applied-set check needs a database query. Callers await it.

**3. [Rule 1] Lint `noNonNullAssertion`**
- The first `pnpm lint` failed on `client!` in auth-upgrade.test.ts. A throwing `conn()` getter replaced it. The test was rerun and passed.

**4. [Rule 2] Env and global restore, extra assertions**
- Each file saves and restores `DATABASE_URL` and the auth env it sets, and clears `globalThis.prisma`, in `afterAll`. Without this, a later file in the same worker could point at a dropped database.
- Extra assertions beyond the plan: a wrong password is rejected, and the second `/setup` call leaves the user and org counts at 1 (T-08-10).

**5. `prisma.$disconnect()` deliberately not called before the drop**
- `@prisma/adapter-pg` 7.8.0 does not end an external pool on dispose, but it does remove its idle-client error listener. Dropping WITH (FORCE) after that would raise an unhandled pool `error`. Without the disconnect, the listener stays attached and the forced drop is handled.

## Threat model check

- T-08-09 mitigated: the populated pre-upgrade test is in every `pnpm test:integration` run.
- T-08-10 mitigated: both first-run paths are proven to refuse a second run and leave exactly one admin and one org.
- T-08-11 mitigated: each file has its own database, created and dropped by the helper, with the applied-migration set asserted.

No new security surface.

## Known Stubs

None.

## Manual items

None for this plan.

## Self-Check: PASSED

- FOUND: tests/integration/support/isolated-database.ts, tests/integration/auth-upgrade.test.ts, tests/integration/auth-bootstrap.test.ts, tests/integration/auth-setup.test.ts
- FOUND: 7d06455, b630886 (`git log`)
- `git rev-list --count 2355bc4..HEAD` = 2 before this SUMMARY commit
