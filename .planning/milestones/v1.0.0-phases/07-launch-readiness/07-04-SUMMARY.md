---
phase: 07-launch-readiness
plan: 04
subsystem: infra
tags: [docker-compose, postgres, pg_dump, pg_restore, pg-boss, ops, backup, bash]

# Dependency graph
requires:
  - phase: 07-01
    provides: ".gitattributes LF normalization (*.sh text eol=lf) — scripts/backup.sh and scripts/restore.sh rely on this to stay LF on any Windows checkout"
provides:
  - "scripts/backup.sh — one-command complete backup (pg_dump -Fc database + uploads_data volume tarball, timestamped)"
  - "scripts/restore.sh — one-command complete restore (pg_restore --clean --if-exists + uploads tarball extraction, writers stopped, health-checked afterwards)"
  - "docs/OPERATIONS.md — day-two runbook: backups, restore, restore-to-new-server, upgrading, logs, health checks, full .env.example reference, troubleshooting"
  - "A proven (not just asserted) backup/restore round trip against a live docker compose stack, recovering both a database row and an uploaded file"
affects: ["07-07 (demo mode env var extends the OPERATIONS.md env table at the left marker)", "07-08 or equivalent security-pass plan (AIDA-24 ops docs now exist to audit)", "07-11 docs site (links to docs/OPERATIONS.md by anchor)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ops shell scripts: #!/usr/bin/env bash, set -euo pipefail, COMPOSE_CMD env override for the legacy docker-compose binary, source .env for POSTGRES_* defaults"
    - "Streaming volume backup/restore via `docker compose run --rm -T --no-deps --entrypoint sh app -c '<busybox tar command>'` — no bind mounts, no guessing the compose-prefixed volume name"

key-files:
  created:
    - scripts/backup.sh
    - scripts/restore.sh
    - docs/OPERATIONS.md
  modified: []

key-decisions:
  - "restore.sh treats pg_restore's exit-code-1 'cannot drop inherited constraint (pgboss.job_common)' warning as non-fatal (verified benign via a real round trip) but still aborts on any other pg_restore error — a real bug found and fixed during Task 2, not a plan deviation"
  - "Task 2's app-image step used the pre-existing cached aida-app:latest image instead of `docker compose build app`, which failed in this sandbox on a TLS/corepack network restriction fetching pnpm — this is the plan's explicitly pre-approved test-only substitution, and it produced a functionally identical result (docker compose run resolved to the same image compose would use); scripts/backup.sh and scripts/restore.sh themselves were not changed for this"

patterns-established:
  - "Ops runbook doc structure (Backups/Restore/Restore-to-new-server/Upgrading/Logs/Health checks/Env reference/Troubleshooting) for docs/OPERATIONS.md, extended by future plans (07-07 adds DEMO_MODE at a left comment marker)"

requirements-completed: [AIDA-24]

# Metrics
duration: 55min
completed: 2026-07-28
---

# Phase 7 Plan 04: Backup/Restore Scripts + Ops Runbook Summary

**`scripts/backup.sh`/`scripts/restore.sh` wrap `pg_dump -Fc`/`pg_restore --clean` plus a streamed `uploads_data` volume tarball for a complete self-host backup, proven end-to-end against a live `docker compose` stack, backed by `docs/OPERATIONS.md`'s day-two runbook.**

## Performance

- **Duration:** ~55 min (includes Docker Desktop cold start and a full round-trip test against real containers)
- **Completed:** 2026-07-28
- **Tasks:** 3/3
- **Files modified:** 3 (all new: `scripts/backup.sh`, `scripts/restore.sh`, `docs/OPERATIONS.md`)

## Accomplishments

- One command (`./scripts/backup.sh [OUTPUT_DIR]`) produces a timestamped, complete backup: a `pg_dump --format=custom` database dump AND a tarball of every attachment in the `uploads_data` volume — closing the "DB-only backup silently loses every attachment" gap called out in the plan objective.
- One command (`./scripts/restore.sh DB_DUMP UPLOADS_TARBALL [--yes]`) restores both, stopping `app`/`worker` first, prompting for explicit confirmation unless `--yes`, and polling `/api/health` afterwards.
- The round trip was **proven, not asserted**: seeded a real `backup_smoke` DB row and a real `/data/uploads/smoke/marker.txt` file, backed them up, destroyed them, restored from the backup, and confirmed both came back with the literal value `before-backup`.
- `docs/OPERATIONS.md` ships all 8 required sections (Backups, Restore, Restore to a new server, Upgrading, Logs, Health checks, Environment variable reference, Troubleshooting), documents all 16 `.env.example` variables with zero invented ones, and leaves the `<!-- 07-07 adds DEMO_MODE here -->` marker for the next plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: scripts/backup.sh + scripts/restore.sh** - `f430aa8` (feat)
2. **Task 2: Real backup/restore round-trip against a running stack** - `f79b073` (fix — bug found and fixed during the round trip, see Deviations)
3. **Task 3: docs/OPERATIONS.md runbook** - `f45f82c` (docs)

_Note: Task 2 produced no new files (it exercises Task 1's scripts) but did produce one script fix, committed as a `fix` commit per the deviation rules._

## Files Created/Modified

- `scripts/backup.sh` - pg_dump -Fc + uploads_data tar, timestamped, to a chosen directory; preflights `db` is running; exits non-zero on an empty output file
- `scripts/restore.sh` - pg_restore --clean --if-exists + uploads tar restore; stops/starts `app`/`worker`; requires explicit `restore` confirmation unless `--yes`; polls `/api/health`
- `docs/OPERATIONS.md` - the day-two runbook: backups, restore, restore-to-new-server, upgrading, logs, health checks, full env reference (16/16 `.env.example` vars), troubleshooting

## Decisions Made

- **restore.sh tolerates one specific benign `pg_restore` error class.** `pg_dump`/`pg_restore --clean` against this project's real database always includes pg-boss's `pgboss.job` table, which is declaratively partitioned. Postgres rejects `ALTER TABLE ONLY pgboss.job_common DROP CONSTRAINT job_common_pkey` ("cannot drop inherited constraint") — a known `pg_dump`/`pg_restore` limitation with declarative partitioning, not an application bug. `pg_restore` itself continues past it and the actual restore succeeds (verified: the `backup_smoke` row came back correctly even on the run where this warning fired), but its process exit code is 1, which would make `set -euo pipefail` treat a fully successful restore as a hard failure. `restore.sh` now inspects `pg_restore`'s combined output, allows through only that exact message, and still aborts on any other `pg_restore: error:` line. This was found and fixed live during Task 2's real round trip.
- **Task 2's "app image" step used the existing cached image instead of building.** `docker compose build app` failed in this sandboxed environment with a TLS certificate verification error (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) while `corepack` tried to fetch `pnpm` over HTTPS — a network/proxy restriction of the sandbox, unrelated to the scripts or Dockerfile. A pre-existing `aida-app:latest` image (built in an earlier session) was already cached locally; `docker compose run --rm --no-deps --entrypoint sh app -c '...'` used it directly without rebuilding, which is exactly the code path `backup.sh`/`restore.sh` themselves use — so the test exercised the real, unmodified scripts. This matches the plan's explicit "if the build is prohibitively slow ... you may substitute ... FOR THE TEST ONLY" allowance, applied to a build failure rather than slowness, since the outcome (proving the scripts against a real image) is the same and no script logic was touched for the substitution.
- **Full stack (`docker compose up -d`) was brought up before the round trip**, not just `db` as the plan's step 1 literally says. `docker compose start app worker` (used by `restore.sh`) re-validates the `migrate` one-shot service's `depends_on: service_completed_successfully` condition against the compose project's tracked container state; since this session had never run `migrate` inside this specific project instance, `start` failed with "app is missing dependency migrate" on the first attempt. Running `docker compose up -d` once beforehand (so `migrate` completes and is tracked) reproduces the real production precondition — an operator's `app`/`worker` are already running, with `migrate` already having completed, before they ever run `restore.sh`'s stop/start cycle. No script change was needed for this; it was a test-harness correction.

## Round-Trip Evidence (Task 2)

Full sequence run against a live `docker compose` stack in this worktree (project name `aida`):

```
$ docker compose up -d db                          # then docker compose up -d (full stack, see decision above)
$ docker compose exec -T db psql -U aida -d aida -c \
    "CREATE TABLE backup_smoke(id int primary key, note text); INSERT INTO backup_smoke VALUES (1,'before-backup');"
CREATE TABLE
INSERT 0 1

$ docker compose run --rm -T --no-deps --entrypoint sh app -c \
    'mkdir -p /data/uploads/smoke && echo before-backup > /data/uploads/smoke/marker.txt'

$ ./scripts/backup.sh ./backups
[backup] Dumping database (aida) -> ./backups/aida-db-20260728T225848Z.dump
[backup] Archiving uploads volume -> ./backups/aida-uploads-20260728T225848Z.tar.gz
[backup] Done.
  Database: ./backups/aida-db-20260728T225848Z.dump (86.1K)
  Uploads:  ./backups/aida-uploads-20260728T225848Z.tar.gz (170B)

$ docker compose exec -T db psql -U aida -d aida -c "DROP TABLE backup_smoke;"
DROP TABLE
$ docker compose run --rm -T --no-deps --entrypoint sh app -c 'rm -rf /data/uploads/smoke'

$ ./scripts/restore.sh ./backups/aida-db-20260728T225848Z.dump ./backups/aida-uploads-20260728T225848Z.tar.gz --yes
[restore] Stopping app and worker...
[restore] Restoring database from ./backups/aida-db-20260728T225848Z.dump ...
pg_restore: error: could not execute query: ERROR:  cannot drop inherited constraint "job_common_pkey" of relation "job_common"
pg_restore: warning: errors ignored on restore: 1
[restore] Note: pg_restore exited non-zero on the known-benign pgboss.job_common partition warning; continuing.
[restore] Restoring uploads from ./backups/aida-uploads-20260728T225848Z.tar.gz ...
[restore] Starting app and worker...
[restore] Waiting for /api/health ...
[restore] Healthy:
{"status":"ok","db":"connected","worker":{"lastRunAt":"2026-07-28T22:58:14.680Z"}}
[restore] Done.

$ docker compose exec -T db psql -U aida -d aida -tAc "SELECT note FROM backup_smoke WHERE id=1;"
before-backup

$ docker compose run --rm -T --no-deps --entrypoint sh app -c 'cat /data/uploads/smoke/marker.txt'
before-backup

$ docker compose down -v      # tear down, then rm -f both artifact files + rmdir ./backups
```

**Artifact sizes:** `aida-db-20260728T225848Z.dump` = 86.1K, `aida-uploads-20260728T225848Z.tar.gz` = 170B.

**Both post-restore assertions printed `before-backup`** — the DB row and the uploaded file both survived the destroy → backup → restore cycle intact.

**Teardown confirmed:** `docker compose down -v` removed all 5 project containers and 4 named volumes; `docker volume ls | grep aida` returned nothing afterward. `docker ps -a` shows no leftover containers from this test (an unrelated, 3-week-old `aida-uat-greenmail` container from an earlier phase's email UAT remains — out of scope for this plan, not created by this test). `git status --porcelain` is clean of any `backups/`, `*.dump`, or `*.tar.gz` paths; `.gitignore` already had `/backups/` from an earlier phase, so no `.gitignore` change was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] restore.sh hard-failed on a benign pg_restore partition-constraint warning**
- **Found during:** Task 2 (real round-trip test)
- **Issue:** `pg_restore --clean --if-exists` against a dump that includes pg-boss's declaratively-partitioned `pgboss.job` table always emits `ERROR: cannot drop inherited constraint "job_common_pkey" of relation "job_common"` and exits 1, even though the rest of the restore (including all application data) completes correctly. `set -euo pipefail` made the script abort immediately after this line, before restoring uploads or restarting `app`/`worker` — a real functional bug, not a test artifact (this table exists in every real AIDA database, since pg-boss is a required dependency, not optional).
- **Fix:** `restore.sh` now runs `pg_restore` with `set +e`, captures combined stdout/stderr and the exit code, and only treats the run as fatal if the output contains a `pg_restore: error:` line other than the known `cannot drop inherited constraint` message. Confirmed the fix by re-running the full round trip: the same warning still appears, is now logged as an explicit non-fatal note, and the restore completes through the uploads restore, app/worker restart, and a passing `/api/health` check.
- **Files modified:** `scripts/restore.sh`
- **Verification:** Full round trip (seed → backup → destroy → restore → assert) passed on the second run, with both post-restore assertions printing `before-backup`.
- **Committed in:** `f79b073`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — without this fix, `restore.sh` would abort on every real restore against this project's actual database schema, making the shipped script non-functional. No scope creep; the fix is scoped entirely to the one known-benign error class.

## Issues Encountered

- **Docker Desktop was not running** at the start of Task 2 in this sandboxed session; started it and polled until `docker info` succeeded (~5s) before proceeding. Not a deviation — standard environment setup, not a code change.
- **`docker compose build app` failed** on a TLS certificate verification error inside the build container (`corepack` fetching `pnpm` over HTTPS hit `UNABLE_TO_VERIFY_LEAF_SIGNATURE`), consistent with this sandbox sitting behind a TLS-inspecting proxy. Used the plan's pre-approved test-only substitution (existing cached `aida-app:latest` image) instead — see Decisions Made above. `scripts/backup.sh`/`scripts/restore.sh` were not modified for this; the substitution only affected how the test image was obtained, not how the scripts invoke it.
- **`docker compose start app worker` initially failed** with "app is missing dependency migrate" because this session had never run the `migrate` one-shot service inside this specific compose project. Resolved by running `docker compose up -d` (full stack) once before the round trip, matching the real-world precondition that `app`/`worker` are already running (with `migrate` already completed) before an operator ever invokes `restore.sh`. No script change.

## User Setup Required

None - no external service configuration required. (Docker Desktop must be running on the operator's own machine to use these scripts, which is already a documented prerequisite of the project's self-host model.)

## Next Phase Readiness

- AIDA-24's backup/restore + ops-docs half is done and proven end-to-end; `docs/OPERATIONS.md` is ready for 07-11's docs site to link to by anchor.
- `docs/OPERATIONS.md`'s environment variable reference table has an explicit `<!-- 07-07 adds DEMO_MODE here -->` marker at the end of the table (after `APP_ENCRYPTION_KEY`, before `## Troubleshooting`) for 07-07 to extend with demo-mode variables.
- No blockers for sibling/dependent plans. The `pgboss.job_common` restore quirk is now documented in `docs/OPERATIONS.md`'s Restore section ("On benign restore warnings") so a future security-pass or troubleshooting plan won't need to rediscover it.

---
*Phase: 07-launch-readiness*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: scripts/backup.sh
- FOUND: scripts/restore.sh
- FOUND: docs/OPERATIONS.md
- FOUND: .planning/phases/07-launch-readiness/07-04-SUMMARY.md
- FOUND commit: f430aa8
- FOUND commit: f79b073
- FOUND commit: f45f82c
