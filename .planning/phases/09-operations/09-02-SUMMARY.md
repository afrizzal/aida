---
phase: 09-operations
plan: 02
subsystem: database
tags: [seed, demo-mode, advisory-lock, postgres, privacy, testcontainers]

requires:
  - phase: 09-operations plan 09-01
    provides: "AIDA_DATABASE_URL override, named in the manual recovery (point the demo at a new database)"
provides:
  - "src/lib/tenant-seed-lock.ts: TENANT_SEED_LOCK_KEY_SQL, withTenantSeedLock(fn, opts), TenantSeedLockTimeout (relative imports only)"
  - "src/lib/demo/tenant-guard.ts: DEMO_SEED_COMPLETE_KEY, DEMO_SEED_COMPLETE_VALUE, INFRASTRUCTURE_TABLES, DEMO_SEED_STAGES, demoIdentityEmails(env), classifyTenantData(tx, env), runGuardedDemoSeed({ caller, hooks, lockTimeoutMs? })"
  - "createDemoIdentities(hooks?) replaces ensureDemoIdentities(); createFirstOrgAndAdmin(input, hooks?); SeedDemoDataOptions.onStage?"
  - "Setting key demo:seed-complete, value {\"dataset\":\"aida-demo\",\"version\":1}, written last"
  - "tests: support/table-inventory.ts (countAllTables), support/demo-driver.ts, support/demo-guard-fixtures.ts, demo-boot.test.ts (20 cases), seed-guard.test.ts (3 cases)"
affects: [09-13 phase gate, Phase 8.1 replan (docker-compose.yml comment, docs/OPERATIONS.md Demo mode, docs/SECURITY.md)]

actuals:
  tokens: 17346
  tasks: 3
  commits: 3
plan_head_before: 14f554c7eb90b79b2eeb94434daaa4d33b19933f

tech-stack:
  added: []
  patterns:
    - "One transaction-level advisory lock held in one open interactive transaction as a cross-process mutex; the guarded write (marker) goes through that transaction, everything else commits on its own"
    - "Guarded paths tested in child processes (tsx driver) so each has its own pool, pg-boss and crash; exact per-table inventories from information_schema"
    - "Crash injection only through an afterStage hook argument; production code reads no env or argv for it"

key-files:
  created:
    - src/lib/tenant-seed-lock.ts
    - src/lib/demo/tenant-guard.ts
    - tests/integration/support/table-inventory.ts
    - tests/integration/support/demo-driver.ts
    - tests/integration/support/demo-guard-fixtures.ts
    - tests/integration/demo-boot.test.ts
    - tests/integration/seed-guard.test.ts
  modified:
    - src/lib/bootstrap.ts
    - src/lib/demo/bootstrap-demo.ts
    - src/lib/demo/identities.ts
    - src/lib/demo/seed-demo-data.ts
    - prisma/seed.ts
    - scripts/capture-demo-assets.ts
    - docs/SECURITY.md
    - docs/OPERATIONS.md
    - website/src/content/docs/getting-started/demo-mode.md
    - website/src/content/docs/configuration/environment.md
    - docker-compose.yml
    - .env.example

key-decisions:
  - "The classifier reads at most 2 organizations and at most (demo identities + 1) user emails, so it stays bounded on a large real database; one extra user is enough to prove a non-demo one"
  - "demo-complete needs only the marker key in the single organization plus every user a configured demo identity (the must_have definition); a skip writes nothing, so a spoofed marker cannot cause a write"
  - "bootstrapFromEnv swallows only createFirstOrgAndAdmin failures (as before) and logs one line on a lock timeout; any other error from the count or the transaction propagates, as the bare count did before"
  - "runGuardedDemoSeed takes an optional lockTimeoutMs so a test can prove the lock-timeout path in 500 ms (T-09-07b); production callers pass none (120 s default)"

patterns-established:
  - "Red-before-green for a behaviour change: put the pre-plan source files back temporarily (git show <base>:path > path), run the new tests, restore the new files from a scratch copy, never git stash"

requirements-completed: [AIDA-37, AIDA-38]

coverage:
  - id: D1
    description: "Seed CLI and DEMO_MODE boot classify before any write; an empty database (infrastructure rows only) is seeded with the marker written last; the complete marked demo is skipped"
    requirement: AIDA-37
    verification:
      - kind: integration
        ref: "tests/integration/demo-boot.test.ts#fresh database: the demo boot seeds one organization holding the marker"
        status: pass
      - kind: integration
        ref: "tests/integration/demo-boot.test.ts#infrastructure-only database"
        status: pass
      - kind: integration
        ref: "tests/integration/demo-boot.test.ts#repeated boot after the heartbeat wrote SystemSetting"
        status: pass
      - kind: integration
        ref: "tests/integration/seed-guard.test.ts#empty database: seeds (exit 0) ... a second run prints already seeded"
        status: pass
    human_judgment: false
  - id: D2
    description: "Refusal without deletion: foreign organization, foreign user, marked demo plus a foreign user or organization, and a crash after each of 7 stages are refused by both paths with every table count unchanged"
    requirement: AIDA-37
    verification:
      - kind: integration
        ref: "tests/integration/demo-boot.test.ts#refusal matrix: {foreign organization, foreign user} x {seed CLI, demo boot}"
        status: pass
      - kind: integration
        ref: "tests/integration/demo-boot.test.ts#crash per stage: no marker, demo-partial, and both paths refuse afterwards (U-04)"
        status: pass
      - kind: integration
        ref: "tests/integration/seed-guard.test.ts#a non-demo organization with zero tickets: exit 1"
        status: pass
      - kind: other
        ref: "grep -rn \"\\.delete(\\|deleteMany(\" src/lib/demo src/lib/bootstrap.ts src/lib/tenant-seed-lock.ts (no match)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One advisory lock shared by the seed CLI, the demo boot and bootstrapFromEnv: concurrent runs end with one workspace; bootstrapFromEnv first makes the demo refuse; a held lock times out with no write"
    requirement: AIDA-37
    verification:
      - kind: integration
        ref: "tests/integration/demo-boot.test.ts#concurrency and ordering (D-17)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No password printed by the seed CLI, the demo boot, bootstrapFromEnv or the capture script's echo of the seed output"
    requirement: AIDA-37
    verification:
      - kind: integration
        ref: "tests/integration/seed-guard.test.ts and tests/integration/demo-boot.test.ts (passwordLeaks on every run)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both guard test files run in the default pnpm test:integration suite (no skip, only or env gate)"
    requirement: AIDA-38
    verification:
      - kind: integration
        ref: "pnpm test:integration (106 files, 1419 tests, exit 0)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Operator docs (OPERATIONS Demo mode, website demo page and env rows, compose and .env.example comments) describe the refusal rule and the manual recovery on a new database, with no volume deletion and no hand-inserted marker"
    requirement: AIDA-37
    verification:
      - kind: other
        ref: "git grep -n \"down -v\" -- docs website/src/content prisma README.md .env.example (no match)"
        status: pass
    human_judgment: true
    rationale: "Whether the recovery steps read clearly to an operator is a human reading check; the greps only prove the forbidden advice is gone"

duration: 20min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 02: Seed and demo guards Summary

**`pnpm db:seed`, the `DEMO_MODE` boot and `bootstrapFromEnv` now share one Postgres advisory lock and one classifier. Demo data goes only into an empty database. A complete marked demo is skipped. Anything else is refused with one line and nothing written, and nothing is ever deleted. A `demo:seed-complete` marker written last tells a finished demo apart from a partial one, and no path prints a password.**

## Performance

- **Duration:** about 20 min (ledger start 2026-11-12T07:47:41Z, last code check 2026-11-12T08:05:21Z)
- **Tasks:** 3 of 3
- **Files:** 7 created, 12 modified

## Accomplishments

- `withTenantSeedLock` holds `pg_advisory_xact_lock(hashtextextended('aida:tenant-seed', 0))` in one open transaction, with `lock_timeout` 120 s and a 600 s transaction bound. A 55P03 error becomes `TenantSeedLockTimeout`. The code comments say it is a mutex, not atomicity.
- `classifyTenantData` returns `empty`, `demo-complete`, `demo-partial` or `foreign`. It reads only organization ids, user emails and the marker row, and never the slug (PATTERNS D9).
- `runGuardedDemoSeed` classifies under the lock. Only `empty` leads to `createDemoIdentities` and then `seedDemoData`. The marker is created through the lock's transaction after the `domain-data` stage.
- `createDemoIdentities` only creates: it throws if any organization exists. `ensureDemoIdentities` and its adopt-an-existing-org branch are gone.
- `bootstrapDemoMode` logs exactly one line per outcome and always returns normally. The seeded line names only the duration and the admin email. The ticket-count check is gone.
- `prisma/seed.ts` exits 0 for seeded or already-seeded, and 1 for partial, foreign or lock timeout. It no longer prints passwords or the `down -v` / `migrate reset` advice.
- Docs: SECURITY F-09 is marked fixed, a new F-10 guard bullet is added, and OPERATIONS "Demo mode" is rewritten. The website pages, the compose comment and `.env.example` are updated to match.

## Task Commits

1. **Task 1 (tracer): lock, classifier and marker wired into the demo boot** - `2dedd17` (feat)
2. **Task 2: seed CLI guard tests, refusal matrix, crash per stage, concurrency, ordering, no-password output** - `910d331` (test)
3. **Task 3: operator docs, compose comment, full integration suite** - `d0795a3` (docs)

## Verification (exit codes read without a pipe; Docker steps with `AIDA_TEST_RUN_ID=mwd8qr8d-03de8e80e88f7958`, `DOCKER_HOST` from the docker context, `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`)

| Command | Exit | Counts |
|---|---|---|
| `colima status` / `docker info` (before each Docker step) | 0 / 0 | n/a |
| `pnpm test:integration tests/integration/demo-boot.test.ts` (Task 1, first green) | 0 | 1 file, 5 passed |
| same, **red**: pre-plan `bootstrap-demo.ts` and `identities.ts` restored temporarily | 1 | 5 failed of 5 (the old boot seeded into the foreign workspace and wrote no marker) |
| Tracer gate: `pnpm test:integration` on demo-boot, auth-bootstrap, ticket-merge (after formatting) | 0 | 3 files, 65 passed |
| `pnpm test:integration tests/integration/seed-guard.test.ts tests/integration/demo-boot.test.ts` (Task 2 green) | 0 | 2 files, 23 passed |
| same, **red**: pre-plan `prisma/seed.ts`, `bootstrap-demo.ts`, `identities.ts` restored temporarily | 1 | 19 failed, 4 passed (the 4 exercise only the new lock and classifier modules, not reverted in this run) |
| `pnpm test:integration tests/integration/demo-boot.test.ts -t "concurrency and ordering"`, **red**: the lock statement disabled temporarily | 1 | 3 failed, 1 passed, 16 skipped (seed CLI plus boot: one process errored; bootstrap plus seed: real and demo users both written; lock timeout: seeded) |
| `pnpm typecheck` (after Tasks 1 and 2) | 0 | 0 `error TS` |
| `pnpm lint` | 0 | 635 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts`) |
| `pnpm test` (full unit suite) | 0 | 82 files, 1469 passed |
| `pnpm test:integration` (full suite, once) | 0 | 106 files, 1419 passed (104 files before this plan plus the 2 new ones) |

Every temporary red-run file was restored from a scratch copy; `git status` showed no change under `src/` or `prisma/` afterwards.

### Acceptance criteria

- Task 1: `grep -c pg_advisory_xact_lock src/lib/tenant-seed-lock.ts` prints 1. `ticket.count` is absent from `bootstrap-demo.ts`. `demo:seed-complete` is at `tenant-guard.ts:31`. No `from "@/` in `tenant-seed-lock.ts`. `ensureDemoIdentities` is absent from `src prisma scripts`; the comment in `tests/e2e/global-setup.ts:184` stays, as the plan allows. The file has 5 `it(` cases at Task 1. PASS.
- Task 2: no `down -v` in the seed, the capture script or `src/lib/demo`; no `.skip(` / `.only(`; no `.delete(` or `deleteMany(` in the demo, bootstrap and lock modules. demo-boot.test.ts has 7 crash cases (a loop over `CRASH_STAGES`, 7 seen in the run), the 4-cell matrix, both concurrency cases and the ordering case. PASS. The password grep matches one line:
  - `scripts/capture-demo-assets.ts:811` `console.log(seedOutput.split(DEMO_ADMIN_PASSWORD).join("[redacted]"))`: it prints the seed output with the password removed, so no password value. The seed's own sign-in lines name `DEMO_ADMIN_PASSWORD` as a variable name inside a multi-line call, interpolate no value, and so do not match the one-line grep.
- Task 3: `grep -n tenant-guard docs/SECURITY.md` matches line 29. `git grep "down -v"` over docs, website content, prisma, README and `.env.example` prints nothing. The `zero tickets|no tickets|no-op once tickets` grep prints nothing. OPERATIONS "Demo mode" names the manual recovery on a new, separate database and the bootstrapFromEnv ordering. SECURITY line 8 is byte-identical (checksum compared). PASS.

## Writes W1 to W6 and the crash per stage

| Write | What commits on its own | Stage hook | Classification after the crash | Rerun `prisma/seed.ts` | Rerun demo boot | Inventory on rerun |
|---|---|---|---|---|---|---|
| W1 | admin user (Better Auth `signUpEmail`: user and account) | `admin-user` | demo-partial | exit 1, partial line | partial line, normal return | unchanged |
| W2 | organization with its owner member (Better Auth `createOrganization`; the trigger adds TicketState and TicketStateConfig) | `organization` | demo-partial | exit 1, partial line | partial line, normal return | unchanged |
| W3 | `SystemSetting` setupComplete | `setup-complete` | demo-partial | exit 1, partial line | partial line, normal return | unchanged |
| W4 | agent user (`signUpEmail`) | `agent-user` | demo-partial | exit 1, partial line | partial line, normal return | unchanged |
| W5 | agent member (`member.create`) | `agent-member` | demo-partial | exit 1, partial line | partial line, normal return | unchanged |
| W6 | domain data (SLA policies, tags, custom fields, then each ticket through `createTicket`, KB, CSAT, Insight) | `first-ticket` (after the first ticket) | demo-partial | exit 1, partial line | partial line, normal return | unchanged |
| W6 | (all domain data written, marker not yet) | `domain-data` | demo-partial | exit 1, partial line | partial line, normal return | unchanged |

In every stage the marker was absent after the crash (`tests/integration/demo-boot.test.ts`, "crash per stage"). No path recovered, deleted or wrote anything (U-04).

## U-02 contract (files Phase 8.1 plans also touch)

- `docker-compose.yml`: only the comment above `DEMO_MODE` in the `app` service changed, now:
  ```
  # Demo mode (AIDA-22, AIDA-37): DEMO_MODE=true seeds the demo only into an empty database (no
  # organization, no user); any other database gets one refusal log line, no write, and a normal start.
  ```
  No service, volume, variable or user changed.
- `docs/OPERATIONS.md`: the env-table row `DEMO_MODE` and the section "Demo mode" ("It seeds only an empty database" with the outcome table, "`DEMO_MODE` together with `ADMIN_EMAIL` and `ADMIN_PASSWORD`", "The seed's writes are not one transaction", "Recovering from an incomplete or unwanted demo" in four steps, and the never-insert-a-marker line). The old "It only fires once" and "Resetting a demo instance" (`down -v`) paragraphs are removed.
- `docs/SECURITY.md`: the "Secrets & keys" F-09 bullet is rewritten as fixed, and one F-10 bullet is added under "AuthZ & tenancy", including the stated limit (`/setup` wizard and sign-up do not take the lock). Line 8 (build-time egress) is unchanged and the advisory list was not added (owner item 08-o4).
- `src/proxy.ts`: not touched.

## Files Created/Modified

- `src/lib/tenant-seed-lock.ts`: the lock (new).
- `src/lib/demo/tenant-guard.ts`: classifier, marker, guarded seed (new).
- `src/lib/demo/identities.ts`: `createDemoIdentities(hooks?)`, create-only.
- `src/lib/bootstrap.ts`: stage hooks; `bootstrapFromEnv` under the lock.
- `src/lib/demo/seed-demo-data.ts`: `onStage` after the first ticket (nothing else changed; ticket-merge.test.ts passes).
- `src/lib/demo/bootstrap-demo.ts`: one line per outcome.
- `prisma/seed.ts`: guard first, the new exit codes, no password or deletion advice.
- `scripts/capture-demo-assets.ts`: redacts the password from the echoed seed output.
- `tests/integration/support/{table-inventory,demo-driver,demo-guard-fixtures}.ts`, `tests/integration/{demo-boot,seed-guard}.test.ts`.
- Docs: `docs/SECURITY.md`, `docs/OPERATIONS.md`, the website `demo-mode.md` and `environment.md`, `docker-compose.yml`, `.env.example`.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `prisma/seed.ts` moved to the guard in the Task 1 commit**
- **Found during:** Task 1.
- **Issue:** Task 1 removes `ensureDemoIdentities` and must update every caller. A minimal swap to `createDemoIdentities` would have left one commit in which a database holding only a foreign user got demo writes.
- **Fix:** the full Task 2 seed rewrite (guard first, outcomes, no password) went into `2dedd17`. Task 2 added the tests and the capture-script change.
- **Commit:** `2dedd17`.

**2. [Rule 2 - Missing critical] lock-timeout proof for T-09-07b**
- **Found during:** Task 2.
- **Issue:** the threat register mitigates T-09-07b ("timeout logs one line and boot continues"), but no planned case proves the timeout path, and 120 s is too long for a test.
- **Fix:** an optional `lockTimeoutMs` on `runGuardedDemoSeed` (production passes none), driver `--lock-timeout-ms`, and a test that holds the lock from a pg client and expects `lock-timeout` with an unchanged inventory.
- **Commit:** `2dedd17` (option), `910d331` (test).

**3. [Rule 3 - Blocking] extra test support file and driver modes**
- `tests/integration/support/demo-guard-fixtures.ts` (not in `files_modified`) holds the child-process runner, the pg fixtures, the boolean password scan and the redaction shared by both test files.
- The driver gained `heartbeat` (the worker's handler called directly, as the plan asks), `pgboss-start` (a real pg-boss schema for the infrastructure-only case) and `classify`.
- One extra case beyond the plan: the marked demo plus one extra organization, which the must_have "one extra non-demo user or organization -> refuse" names.

**4. The matrix's seed-CLI cells and the crash reruns run `prisma/seed.ts` through tsx**
- This is the same command `pnpm db:seed` runs, without the pnpm wrapper. `seed-guard.test.ts` spawns the real `pnpm db:seed`.

**5. Capture script: redaction instead of a removed line**
- No line of `scripts/capture-demo-assets.ts` printed a password directly. The leak was the seed output it echoes, which is now quiet. The redaction is a second safeguard.

---

**Total deviations:** 5 (2 Rule 3, 1 Rule 2, 2 clarifications of how a planned step was done). **Impact on plan:** no scope reduction; each change makes a must_have or a threat mitigation provable.

## Issues Encountered

None. Every test run was green on the first try after the code was written; the only failures were the deliberate red runs.

## Known Stubs

None.

## Manual items (open, not claimed)

- Operator-readability of the new "Demo mode" recovery steps (OPERATIONS and the website page): a human reading check.
- The stack-level demo boot on a real `docker compose` stack was not run here (the integration tests run the same code paths on Testcontainers Postgres).

## User Setup Required

None.

## Next Phase Readiness

AIDA-37 and the AIDA-38 seed-guard and demo-boot parts have permanent tests in the default integration suite. Ready for the next 09 plan.

## Self-Check: PASSED

- Files exist: `src/lib/tenant-seed-lock.ts`, `src/lib/demo/tenant-guard.ts`, `tests/integration/support/table-inventory.ts`, `tests/integration/support/demo-driver.ts`, `tests/integration/support/demo-guard-fixtures.ts`, `tests/integration/demo-boot.test.ts`, `tests/integration/seed-guard.test.ts`.
- Commits exist: `2dedd17`, `910d331`, `d0795a3` (`git rev-list --count 14f554c..HEAD` = 3 at SUMMARY write).

---
*Phase: 09-operations*
*Completed: 2026-11-12*
