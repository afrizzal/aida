---
phase: 09-operations
plan: 08
subsystem: backup
tags: [backup, docker-compose, posix-sh, scheduler, non-root, settings-ui, playwright, axe]

requires:
  - phase: 09-operations
    provides: "09-01: compose-config test pattern (scrubbed CLI env, --env-file); 09-02: DEMO and seed rows in the env table; 09-06: scripts/backup/aida-backup.sh and lib.sh (1000:1000, libpq, set layout, backup:lastRun); 09-13: retention, exit 3 and 5, status-unrecorded-<setId>.json, the restore lock"
provides:
  - "docker-compose.yml: services backup (1000:1000) and backup-init (one root step on the backups_data mount point), volume backups_data, variables BACKUP_ENABLED, BACKUP_SCHEDULE, BACKUP_RETENTION, BACKUP_LEASE_TTL_SECONDS, BACKUP_FENCE_WAIT_SECONDS"
  - "scripts/backup/scheduler.sh: daily loop at BACKUP_SCHEDULE UTC, disabled mode, TERM forwarding, --next-delay HH:MM <nowEpoch>"
  - "scripts/backup.sh: one manual run in the backup service (backup-init first), exit code of the run"
  - "src/lib/backup/status.ts: BACKUP_STATUS_KEY, BACKUP_SET_ID, BACKUP_FAILURE_CATEGORIES, BACKUP_FAILURE_SENTENCES, parseBackupStatus, backupFailureSentence, formatBackupTime"
  - "src/app/(app)/settings/backups/page.tsx: read-only Backups tab, appended last to SettingsNav"
  - "docs/OPERATIONS.md Backups runbook; five BACKUP_* env rows in OPERATIONS and the website"
affects: [09-09 single h1 (the Backups page has its visible h1), 09-10 restore (sets in backups_data, restore.sh <setId>, the Upgrading rollback lines), 09-11 stack proof specification, 09-12 installer (backup calls scripts/backup.sh with no argument), Phase 8.1 replan (08-14 non-root proof, egress stack, 08-16 gate)]

actuals:
  tokens: 22092
  tasks: 3
  commits: 4
plan_head_before: 2500a37a393914506332353dddaafc206b6df454

tech-stack:
  added: []
  patterns:
    - "One-shot root init service limited to one mount point: stat check first, chmod before chown so only CAP_CHOWN is needed, no network, read-only root, no-new-privileges"
    - "tmpfs on an image's declared VOLUME so compose creates no anonymous volume"
    - "POSIX sh scheduler: sleep and the child run in the background with wait, so TERM is handled at once and forwarded to a running backup"
    - "Strict four-key parse of an instance-wide status record; unknown enum values collapse to a fixed fallback so no stored text reaches the page"

key-files:
  created:
    - scripts/backup/scheduler.sh
    - src/lib/backup/status.ts
    - src/app/(app)/settings/backups/page.tsx
    - tests/unit/backup-scheduler.test.ts
    - tests/unit/compose-backup.test.ts
    - tests/unit/backup-status.test.ts
    - tests/integration/compose-backup-config.test.ts
    - tests/e2e/backups-status.spec.ts
    - .planning/phases/09-operations/deferred-items.md
  modified:
    - docker-compose.yml
    - scripts/backup.sh
    - .env.example
    - src/app/(app)/settings/settings-nav.tsx
    - docs/OPERATIONS.md
    - website/src/content/docs/configuration/environment.md
    - website/src/content/docs/operations/backup-and-restore.md
    - website/src/content/docs/operations/upgrading-and-logs.md

key-decisions:
  - "scripts/backup.sh takes no output directory any more and exits 2 with the usage when given one, because sets live in backups_data; it runs backup-init before the one-off run so a volume the stack never prepared still works"
  - "The scheduler finds aida-backup.sh next to itself (dirname of $0, /opt/aida-backup in the container), so no path or test-hook variable is needed"
  - "The absolute run time on the Backups page is printed in UTC with a 'UTC' suffix (the schedule is UTC and the server cannot know the viewer's zone)"
  - "The Backups badges use the spec's /10 tint in both themes: the Badge destructive variant's dark /20 tint measured 3.96:1 on the card"
  - "A failed record with a null or non-string category is unreadable; any other string category the UI does not know is shown as unknown"

patterns-established:
  - "Compose static tests trim the comment block above the next service from a service block"

requirements-completed: []
requirements-partial: [AIDA-33]

coverage:
  - id: D1
    description: "Compose backup service: db image, no build, user 1000:1000, libpq variables with PGPASSWORD (raw), the five settings with defaults, uploads/scripts/package.json read-only, backups_data writable, tmpfs on the data VOLUME, depends_on db healthy, migrate and backup-init completed, 512m, no DATABASE_URL, no test hook"
    requirement: AIDA-33
    verification:
      - kind: unit
        ref: "tests/unit/compose-backup.test.ts (19 cases)"
        status: pass
      - kind: integration
        ref: "tests/integration/compose-backup-config.test.ts (6 cases, docker compose config only)"
        status: pass
    human_judgment: false
  - id: D2
    description: "backup-init: root only on the backups_data mount point, skip on 1000:1000:700, chmod 0700 then chown 1000:1000, no recursion, never uploads_data, network none, read-only root, CAP_CHOWN only, no-new-privileges, written reason in compose and OPERATIONS.md"
    requirement: AIDA-33
    verification:
      - kind: unit
        ref: "tests/unit/compose-backup.test.ts#backup-init (5 cases)"
        status: pass
      - kind: integration
        ref: "tests/integration/compose-backup-config.test.ts#backup-init mounts only backups_data ..."
        status: pass
    human_judgment: false
  - id: D3
    description: "Scheduler timing: --next-delay is 1 one second before, 86400 exactly at, correct across midnight, 1..86400 over a whole day; invalid input exits 2; invalid BACKUP_SCHEDULE exits 2; BACKUP_ENABLED=false stays up and stops on TERM"
    requirement: AIDA-33
    verification:
      - kind: unit
        ref: "tests/unit/backup-scheduler.test.ts (26 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Backups tab states: empty, succeeded card, failed (known and unknown category), failed without a set, malformed and non-JSON records, member view, no button or form, tab last and active; no raw value but the set id rendered"
    requirement: AIDA-33
    verification:
      - kind: unit
        ref: "tests/unit/backup-status.test.ts (36 cases)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/backups-status.spec.ts (13 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Contrast of the succeeded and failed cards in light and dark mode (axe WCAG AA, scoped to main)"
    requirement: AIDA-33
    verification:
      - kind: e2e
        ref: "tests/e2e/backups-status.spec.ts#Settings -> Backups colour contrast (4 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual approval, dark-mode review and screen-reader check of the Backups tab; overflow and long-text wrapping at 360px; loading state (UI E4 backstops)"
    requirement: AIDA-33
    verification: []
    human_judgment: true
    rationale: "Manual items by the charter; the 360px wrap and loading backstops are not asserted by any test"
  - id: D7
    description: "OPERATIONS.md Backups runbook and the env tables (27 rows equal to .env.example in both tables)"
    requirement: AIDA-33
    verification:
      - kind: other
        ref: "grep acceptance checks and the env-table comparison script (Task 3)"
        status: pass
    human_judgment: true
    rationale: "Whether an operator can run backups from the docs alone is a reading judgment"
  - id: D8
    description: "The backup and backup-init services running in a real compose stack"
    requirement: AIDA-33
    verification: []
    human_judgment: true
    rationale: "Not run (waiting for the Phase 8.1 harness and the owner, U-15); specified by plan 09-11"

duration: 21min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 08: Scheduled backup service, Backups tab and runbook Summary

**`docker-compose.yml` now runs backups on its own. The `backup` service uses the db image (`pgvector/pgvector:pg16`, no build) and runs as `user: "1000:1000"`. It reaches the database with libpq variables and `PGPASSWORD` only, mounts the uploads volume read-only, and writes sets into the new `backups_data` volume. `scripts/backup/scheduler.sh` runs `aida-backup.sh` every day at `BACKUP_SCHEDULE` UTC (default 02:00) and keeps `BACKUP_RETENTION` sets (default 7); `BACKUP_ENABLED=false` keeps the service idle. A one-shot `backup-init` is the only root step. It works on the `/backups` mount point only: it skips when that already reads `1000:1000:700`, otherwise it runs `chmod 0700` and then `chown 1000:1000`. It has no network, a read-only root filesystem and `CAP_CHOWN` as its only capability. Admins see the last run in the read-only Settings → Backups tab. `docs/OPERATIONS.md` documents the service, its failure evidence and the operator's off-host and key duties.**

## Performance

- **Duration:** about 21 min (2026-11-12T10:09:44Z to 10:30:17Z, before the SUMMARY)
- **Tasks:** 3 of 3
- **Files:** 9 created, 8 modified (1819 insertions, 97 deletions in the plan diff)

## Accomplishments

- **Compose (D-01, U-16).** `backup` and `backup-init` follow the plan's property list; the rendered configuration is shown in the U-02 contract below. The `uploads_data` comment now says `backup` mounts it read-only. `backups_data` is declared with a comment that cites D-01 and U-16. No `BACKUP_TEST_PAUSE_DIR` and no `DATABASE_URL` appear in either service.
- **Scheduler.** POSIX sh. It computes the delay with pure arithmetic on `date -u +%s`, so the result never depends on the shell's octal handling or on GNU-only date options. At exactly the scheduled minute the next run is 86400 s away, so a run is never repeated. `sleep` and the backup run in the background under `wait`, so the TERM from `docker compose stop` is handled at once and passed to a running backup, whose own trap then releases the lease and the fence. Exit 3 is logged as skipped; any other failure is logged and the loop goes on.
- **Manual run.** `scripts/backup.sh` checks that `db` is running, runs `backup-init` and then `docker compose run --rm -T --no-deps --entrypoint sh backup /opt/aida-backup/aida-backup.sh`. It returns the run's exit code and says where sets live. It keeps `COMPOSE_CMD` and the usage message, and it never reads `.env`.
- **Status parse (D-04).** `parseBackupStatus` accepts only the exact four-key record. `finishedAt` must be a real ISO instant in UTC. The set id must match `^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$`. A succeeded record needs a set and a null category. A failed record needs a string category; a category the UI does not know becomes `unknown`. The categories are checked against `lib.sh status_args_ok` by reading the script.
- **Backups tab (Surface 4).** The admin check runs before the read. The page renders the visible `<h1>`, the subtitle, and then one of: the EmptyState with `DatabaseBackup`; the "Last backup" card, whose `dl` rows are Result (badge), Finished (relative `<time>` plus 12px UTC time), Backup set (`font-mono break-all`, or the "None" copy) and, on failure only, Failure reason, followed by the `role="status"` next-step callout; the unreadable callout; or, for a member, only the admin-only line. It has no button and no form. The tab is appended last.
- **Docs (D-05, P6, Q8, U-16).** The OPERATIONS.md "Backups" section is rewritten, and "Automating backups (cron)" is gone. Five env rows were added to both tables. One `docker compose logs -f backup` line was added to Logs. Upgrading now uses `./scripts/backup.sh`. The "no automatic fix" sentence names `backup-init` as the one root init step.

## Task Commits

1. **Task 1 (tracer): compose backup and backup-init services and the scheduler** - `f651532` (feat)
   - follow-up `c6678d4` (fix): the scheduler test's spawn environment typed as `NodeJS.ProcessEnv`, found by `tsc --noEmit` during Task 2
2. **Task 2: Backups status tab** - `0309dbd` (feat)
3. **Task 3: OPERATIONS.md Backups section, env rows, website mirror** - `fbd44bb` (docs)

Tracer gate (`end-of-phase`, automated verify only): both Task 1 verify commands were re-run on the final Task 1 code before Task 2 started (rows "Task 1 verify (final)").

## Verification (exit codes read without a pipe)

The Docker runs used `AIDA_TEST_RUN_ID=mwddun0h-82cd356e6ea7c7f9`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one process at a time. Before the first Docker step, `colima status` and then `docker info` were run as two commands, exit 0 and 0. Both were checked again before the first E2E run, again exit 0 and 0. Disk: 36 GiB available on the host.

Every mutation was made on a file backed by a copy in the plan's `mktemp -d` directory, restored with `cp` and confirmed with `cmp`. No `git stash` was used.

| Command | Code state | Exit | Counts |
|---|---|---|---|
| `pnpm exec vitest run tests/unit/backup-scheduler.test.ts tests/unit/compose-backup.test.ts tests/unit/compose-uploads.test.ts` | Task 1, first draft of the test helpers | 1 | 3 failed, 46 passed. Test bug: the service block included the next service's comment, and wrapped comment lines were not joined. Fixed in the helpers |
| same | Task 1 | 0 | 49 passed |
| same, RED: uploads read-write in `backup`, `backup` as `0:0`, `chown -R`, no tmpfs in `backup-init`, delay `-lt 0`, no leading-zero strip | mutated | 1 | 9 failed, 40 passed |
| `pnpm test:integration tests/integration/compose-backup-config.test.ts` | Task 1 | 0 | 6 passed |
| same, RED: uploads read-write, retention default 14, uploads mounted in `backup-init` | mutated | 1 | 3 failed, 3 passed |
| `pnpm exec vitest run tests/unit/container-config.test.ts tests/unit/health-probe-wiring.test.ts tests/unit/backup-contract.test.ts` | Task 1 | 0 | 31 passed |
| `pnpm test:integration tests/integration/compose-database-url.test.ts` (backup has no DATABASE_URL) | Task 1 | 0 | 5 passed |
| Task 1 verify (final, after formatting): unit, then integration | Task 1 final | 0 / 0 | 49 passed / 6 passed |
| `pnpm exec vitest run tests/unit/backup-status.test.ts` | Task 2 | 0 | 36 passed |
| same, RED: missing-key check instead of exact keys, raw category kept, succeeded without set or with category accepted | mutated | 1 | 4 failed, 32 passed |
| `pnpm exec tsc --noEmit` | Task 2 draft | 2 | `TS2769` and follow-on errors in `tests/unit/backup-scheduler.test.ts`: the spawn env lacked `NODE_ENV`. Fixed in `c6678d4` |
| `pnpm exec tsc --noEmit` | after the fix | 0 | n/a |
| `pnpm exec vitest run tests/unit/backup-scheduler.test.ts` | after the fix | 0 | 26 passed |
| `pnpm test:e2e tests/e2e/backups-status.spec.ts` | Task 2, first page draft | 1 | 1 failed, 12 passed: axe colour-contrast, dark, Failed badge 3.96:1 (`#f14d4c` on `#422227`, 12px). Genuine red; fixed with the spec's `/10` tint |
| same | Task 2 | 1 | Global setup timeout on `/setup` (`page.waitForURL` at `global-setup.ts:171`); no test ran. `.next` moved, see below |
| same, rerun once after the move | Task 2 | 0 | 13 passed (16.8 s) |
| same, RED: the page also shows the record to role `member` | mutated | 1 | 1 failed (member view), 12 passed |
| `pnpm exec vitest run tests/unit/backup-status.test.ts`; `pnpm exec tsc --noEmit` | Task 2 final | 0 / 0 | 36 passed / n/a |
| `pnpm exec vitest run tests/unit/part-a-gate-check.test.ts` (reads OPERATIONS.md) | Task 3 | 0 | 85 passed |
| `pnpm lint` | Task 3 | 0 | 659 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`) |
| `pnpm typecheck` | Task 3 | 0 | 0 `error TS` lines |
| `pnpm test` (full unit) | final | 0 | 88 files, 1600 passed |

The final green E2E run used page content byte-identical to the restored file (`cmp`) after the red mutation run.

### `.next` move (U-10, owner item next-o1)

- **Time:** 2026-11-12T10:24:08Z.
- **Preceding command:** `pnpm test:e2e tests/e2e/backups-status.spec.ts` (the second run of this plan; the first had passed global setup about 90 s earlier).
- **Error text:** `TimeoutError: page.waitForURL: Timeout 30000ms exceeded.` with repeated `navigated to "http://localhost:3100/setup"`, at `global-setup.ts:171` (`await setupPage.waitForURL(/\/login/)`).
- **Dev-server log:** the run's `[e2e-server]` lines (669) were copied to the plan's `mktemp -d` directory before the move. They begin with `▲ Next.js 16.4.6 (Turbopack)`, `- Local: http://localhost:3100`, `✓ Ready in 202ms`, then the warm-up requests (`GET /api/health 200`, `GET /api/auth/get-session 200`, `GET /api/public/intake 405`, ...) and repeated `GET /setup 200`. No error or warning line.
- **Action:** `mv .next ~/.Trash/aida-next-1794479048`. The rerun once after the move passed. No E2E configuration and no `next.config.ts` change.

### Acceptance criteria

- **Task 1: PASS.**
  - `grep -c "image: pgvector/pgvector:pg16" docker-compose.yml` prints 3.
  - `grep -n 'user: "1000:1000"'` matches once, at line 188.
  - The `BACKUP_TEST_PAUSE_DIR` grep and the `chown -R\|chown --recursive` grep each print nothing (exit 1).
  - The `.env.example` grep shows three entries, at lines 81, 83 and 85.
  - Both verify commands exit 0.
- **Task 2: PASS.**
  - The `/settings/backups` grep matches `settings-nav.tsx:15`.
  - The `<button|<Button|<form` grep and the `text-(sm|lg|xl|base)\b|oklch` grep on the page each print nothing (exit 1).
  - Both verify commands exit 0.
- **Task 3: PASS.**
  - `AIDA_BACKUP_STATUS_UNRECORDED`, `status-unrecorded-`, `restore in progress` and `backup-init` each match in OPERATIONS.md (1, 3, 1 and 8 lines).
  - The `no built-in scheduler` grep prints nothing (exit 1).
  - The `APP_ENCRYPTION_KEY` and `BACKUP_RETENTION` greps exit 0.
  - `pnpm lint` and `pnpm typecheck` exit 0.
  - The env-table comparison script printed:
    - `docs/OPERATIONS.md: rows=27 env=27 missing=[] extra=[] duplicates=[] equal=true`
    - `website/src/content/docs/configuration/environment.md: rows=27 env=27 missing=[] extra=[] duplicates=[] equal=true`

    The OPERATIONS rows are read only from the "Environment variable reference" section, because the new Backups settings table also starts rows with `` `BACKUP_*` ``.

## U-02 contract (for the Phase 8.1 replan)

**`docker-compose.yml` services (new; no existing service changed):**

| | `backup-init` | `backup` |
|---|---|---|
| image | `pgvector/pgvector:pg16` (no build) | `pgvector/pgvector:pg16` (no build) |
| user | `"0:0"` (the only root service; written reason in the comment above it and in OPERATIONS.md) | `"1000:1000"` (node's UID and GID, Dockerfile:87) |
| entrypoint | `sh -c`: skip when `stat -c '%u:%g:%a' /backups` reads `1000:1000:700`; else `chmod 0700 /backups && chown 1000:1000 /backups`; on failure one line pointing to OPERATIONS.md, exit 1 | `["sh", "/opt/aida-backup/scheduler.sh"]` |
| environment | none | `PGHOST: db`, `PGPORT: "5432"`, `PGUSER: ${POSTGRES_USER:-aida}`, `PGPASSWORD: ${POSTGRES_PASSWORD}`, `PGDATABASE: ${POSTGRES_DB:-aida}`, `BACKUP_ENABLED: ${BACKUP_ENABLED:-true}`, `BACKUP_SCHEDULE: ${BACKUP_SCHEDULE:-02:00}`, `BACKUP_RETENTION: ${BACKUP_RETENTION:-7}`, `BACKUP_LEASE_TTL_SECONDS: ${BACKUP_LEASE_TTL_SECONDS:-900}`, `BACKUP_FENCE_WAIT_SECONDS: ${BACKUP_FENCE_WAIT_SECONDS:-300}`, `BACKUP_DIR: /backups`, `UPLOADS_DIR: /data/uploads` |
| mounts | `backups_data:/backups` only | `./scripts/backup:/opt/aida-backup:ro`, `./package.json:/opt/aida-backup-meta/package.json:ro`, `uploads_data:/data/uploads:ro`, `backups_data:/backups` |
| tmpfs | `/var/lib/postgresql/data` | `/var/lib/postgresql/data` |
| network | `network_mode: none` | default network (talks to `db` only) |
| hardening | `read_only: true`, `cap_drop: [ALL]`, `cap_add: [CHOWN]`, `security_opt: [no-new-privileges:true]` | none beyond the non-root user |
| restart, depends_on, limits | `restart: "no"` | `restart: unless-stopped`; `db` healthy, `migrate` and `backup-init` completed successfully; `memory: 512m` |

- **Top-level volume:** `backups_data`, with a comment citing D-01 and U-16. The `uploads_data` comment adds that `backup` mounts it read-only. `docker-compose.egress-test.yml` is unchanged.
- **`docs/OPERATIONS.md`:**
  - the `## Backups` section is rewritten (subsections listed under Accomplishments);
  - five `BACKUP_*` rows were added to the Environment variable reference, and the `POSTGRES_USER` row now names the `backup` service instead of `backup.sh`;
  - Logs gains `docker compose logs -f backup`;
  - Upgrading uses `./scripts/backup.sh` without an argument;
  - the end of "Upgrading an install whose containers ran as root" names `backup-init`.

  "Restore" and "Restore to a new server" are untouched, because plan 09-10 rewrites them. `docs/SECURITY.md` and `src/proxy.ts` are untouched.

**The Phase 8.1 replan must account for:**

1. **08-14 non-root proof.** It covers `backup` as `1000:1000`. It also covers the one root step, `backup-init`: root plus `CAP_CHOWN` only, network none, a read-only root filesystem, and the mount point only. It must not count `backup-init` as a regression of "no service runs as root".
2. **Egress stack.** `docker-compose.egress-test.yml` does not include `backup`. Its traffic is internal database traffic only (libpq to `db`); `backup-init` has no network at all. Adding `backup` to the egress suite is a Phase 8.1 decision (Review Feedback Deferred).
3. **08-16 compose gate.** `docker compose up` now brings up two more services: `backup-init`, which exits 0, and `backup`, which stays up. It also creates one more named volume, `backups_data`.

## Files Created/Modified

- `docker-compose.yml`: `backup-init`, `backup`, the `backups_data` volume and the `uploads_data` comment.
- `scripts/backup/scheduler.sh` (100755): the daily loop, disabled mode and `--next-delay`.
- `scripts/backup.sh`: one manual run in the service; the shebang is now `sh`.
- `.env.example`: the five `BACKUP_*` variables with comments; TTL and fence wait are marked advanced.
- `src/lib/backup/status.ts`: the pure parse, the sentences and the time format.
- `src/app/(app)/settings/backups/page.tsx`: the tab.
- `src/app/(app)/settings/settings-nav.tsx`: the Backups entry, last.
- `tests/unit/backup-scheduler.test.ts` (26), `tests/unit/compose-backup.test.ts` (19), `tests/unit/backup-status.test.ts` (36), `tests/integration/compose-backup-config.test.ts` (6), `tests/e2e/backups-status.spec.ts` (13).
- `docs/OPERATIONS.md`; the website `configuration/environment.md`, `operations/backup-and-restore.md` and `operations/upgrading-and-logs.md`.
- `.planning/phases/09-operations/deferred-items.md`: one out-of-scope finding (below).

## Decisions Made

See `key-decisions` in the frontmatter. In addition:

- The E2E suite adds an axe colour-contrast scan of the two cards in both themes. It is automated evidence only, and the dark-mode visual review stays a manual item.
- The badge icon renders at the Badge component's forced `size-3`, not the spec's `size-4`: the shared Badge sets `[&>svg]:size-3!`, and the page does not override a shared component.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Contrast of the Failed badge in dark mode**
- **Found during:** Task 2, the first E2E run.
- **Issue:** the Badge `destructive` variant adds `dark:bg-destructive/20`, which axe measured at 3.96:1 for 12px text.
- **Fix:** the page passes the spec's own classes, `bg-destructive/10 text-destructive dark:bg-destructive/10`, and the same for success.
- **Files:** the page.
- **Commit:** `0309dbd`.

**2. [Rule 3 - Blocking] tsc failed on the Task 1 scheduler test**
- **Issue:** the spawn env lacked `NODE_ENV`, which the project's `ProcessEnv` type requires.
- **Fix:** a typed `BASE_ENV`, in a separate commit, `c6678d4`.

**3. [Rule 2 - Correctness] `scripts/backup.sh` runs `backup-init` first**
- **Issue:** the plan's one-off command uses `--no-deps`. On a stack that never ran `up` with this release, `docker compose run` would create `backups_data` as root 0755, and the run would fail with `storage`.
- **Fix:** the script runs `$COMPOSE run --rm -T --no-deps backup-init` first. It is idempotent and exits at once on a prepared volume.
- **Commit:** `f651532`.

**4. [Rule 1 - Docs made wrong by this plan] Website backup pages**
- **Issue:** `website/src/content/docs/operations/backup-and-restore.md` (its backup half) and `upgrading-and-logs.md` ("Every upgrade") told operators to run `./scripts/backup.sh ./backups` and said there is no built-in scheduler. The new script refuses an argument. Neither file is in `files_modified`.
- **Fix:** both are updated to match OPERATIONS.md. Their restore parts are left for 09-10.
- **Commit:** `fbd44bb`.

**5. [Scope addition] Extra test coverage**
- Scheduler loop mode: the invalid schedule, an unexpected argument, and the disabled mode with TERM.
- Compose: the whole-file image list, no Redis, and only `backup` and `backup-init` mount `backups_data`.
- E2E: the tab's position and active style, a non-JSON record, and the contrast scans.

**6. [Precision] The `.env.example` entries are active lines (`BACKUP_ENABLED=true`, ...) with comments above them**
- This matches every other variable in the file. They hold the defaults, so behaviour is the same as leaving them unset.

---

**Total deviations:** 6 (2 Rule 1, 1 Rule 2, 1 Rule 3, 1 scope addition, 1 precision note). **Impact:** one contrast fix, one robustness step in the manual script, and docs kept consistent with the new script. The compose contract is exactly the plan's.

## Issues Encountered

- **The E2E global setup hung on `/setup` once** (next-o1). It was handled by the `.next` move above, and the single rerun passed.
- **Two test-helper bugs in the first draft of `compose-backup.test.ts`** (the block boundary and wrapped comments) were fixed before the first green run. They are recorded in the table.

## Known limits and items for later plans

- **Upgrading rollback.** The rollback example in OPERATIONS.md "Upgrading" still shows the v1 `restore.sh <db-dump> <uploads-tarball>` form, and "Restore" still describes the v1 files. Plan 09-10 rewrites both for `restore.sh <setId>`. Until then the docs pair a new backup script with the old restore text.
- **Badge `destructive` variant in dark mode.** Recorded in `deferred-items.md`. Other Badge uses of that variant were not scanned.
- **Behaviour the unit tests cannot reach.** The `backup-init` entrypoint's stat, chmod and chown cannot run on macOS (BSD `stat`, and no root). They are checked as text and through `docker compose config` only. The same holds for the scheduler's run of the backup at the scheduled minute.

## Not run

- **Stack-level run of `backup-init` and `backup` in compose:** not run (waiting for the Phase 8.1 harness and the owner, U-15). Specified by 09-11. No `docker compose up`, `run`, `create`, `start`, `stop`, `down` or `build`, and no image build or pull, was made by this plan.
- **Other suites:** the full `pnpm test:integration`, `pnpm test:egress`, the full `pnpm test:e2e`, `pnpm build` and `pnpm audit --prod` were not run. They are outside this plan's verify and belong to the phase gate.

## Manual items (open)

- Visual approval of the Backups tab, light and dark (DS §7, §9): open.
- Screen-reader check of the tab (the badge text, the `role="status"` callouts, `<time>`): open.
- UI E4 backstops: at a 360px viewport, the long set id and the Finished value wrap inside the `dd` column with no horizontal scroll and no overlap with the `dt` column; and the loading state shows no layout shift. Open; no test asserts them.
- Operator read-through of the new OPERATIONS.md Backups section: open.

## Containers (rule J)

- `docker compose config` ran only inside the two compose-config integration files and in one manual render of the file during Task 1. That render used a temporary env file with a placeholder password, its output went to the plan's temp directory, and only the two services were printed, with bind sources masked.
- Integration database containers: one per `pnpm test:integration` invocation (4), plus one database per E2E invocation (4). Each was started and stopped by its global setup.
- After the last run, `docker ps -a --filter label=aida.test.run=mwddun0h-82cd356e6ea7c7f9` lists nothing. No other container, project, image or volume was touched, and `pnpm test:docker-cleanup --apply` was not run.

## User Setup Required

None.

## Next Phase Readiness

- **09-09:** the Backups page already renders its visible `<h1>` "Backups" in every state.
- **09-10:** sets are in `backups_data` as `<setId>/{db.dump, uploads.tar.gz, uploads.sha256, manifest.json}`. `restore.sh` can run in the `backup` service as 1000:1000 with the same mounts, except that uploads would need a writable mount for the restore itself. It must also rewrite the OPERATIONS.md Restore section, the website restore half and the Upgrading rollback lines.
- **09-11:** the stack proof starts `backup-init` and `backup` as specified above.
- **09-12:** `backup` calls `sh scripts/backup.sh` with no argument.

---
*Phase: 09-operations*
*Completed: 2026-11-12*

## Self-Check: PASSED

All 9 created files exist on disk. Commits f651532, c6678d4, 0309dbd and fbd44bb are in the log. `git rev-list --count 2500a37..HEAD` is 4 before this SUMMARY commit. No home path or personal name appears in the tracked files of this plan (`grep` exit 1).
