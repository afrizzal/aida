---
phase: 14-projects-foundation
plan: 05
subsystem: projects-file-cleanup
status: complete
tags: [outbox, k66, k68, c11, c12, pg-boss, skip-locked, compose, uploads-volume]
requires: ["14-02"]
provides:
  - "src/lib/projects/file-cleanup.ts: enqueueFileCleanupInTx, sweepProjectFileCleanup (optional onLocked test hook), fileCleanupBackoffMinutes, FileCleanupSweepResult"
  - "src/lib/worker/jobs/project-file-cleanup.ts: projectFileCleanupHandler"
  - "Worker queue project-file-cleanup (policy singleton, scheduled * * * * *)"
  - "Worker mounts uploads_data with UPLOADS_DIR in docker-compose.yml and docker-compose.egress-test.yml"
affects: ["14-07", "14-10"]
tech-stack:
  added: []
  patterns:
    - "transactional outbox row (ON CONFLICT DO NOTHING) plus a scheduled idempotent sweep with FOR UPDATE SKIP LOCKED"
    - "sweep reads the database clock when no now is injected"
    - "SKIP LOCKED proven by parking one run inside its transaction and recording both backend PIDs"
key-files:
  created:
    - src/lib/projects/file-cleanup.ts
    - src/lib/worker/jobs/project-file-cleanup.ts
    - tests/integration/project-file-cleanup.test.ts
    - tests/unit/compose-uploads.test.ts
  modified:
    - src/lib/worker/index.ts
    - docker-compose.yml
    - docker-compose.egress-test.yml
    - docs/OPERATIONS.md
    - README.md
decisions:
  - "Without an injected now, sweepProjectFileCleanup reads SELECT now() inside its transaction (the clock that wrote nextAttemptAt's default), so a worker clock behind the database's never skips a due row"
  - "Backoff uses the attempts recorded before the failure: delay = min(2^attempts, 60) minutes (first failure 1, third 4, seventh and later 60)"
  - "enqueueFileCleanupInTx returns the number of rows inserted and de-duplicates its input keys"
metrics:
  duration: "about 5 minutes"
  completed: 2026-11-09
  tasks: 3
  files: 9
estimate:
  tokens: 70000
  tasks: 3
actuals:
  tokens: 8900
  tasks: 3
  commits: 3
plan_head_before: fb7557c2a67fa33287f56567daac3ba95f2a4084
---

# Phase 14 Plan 05: Attachment-file cleanup outbox, scheduled sweep and the worker uploads volume Summary

A ProjectFileCleanup outbox row written inside the delete transaction, an every-minute pg-boss sweep in the worker that deletes due files with FOR UPDATE SKIP LOCKED, ENOENT counted as done and capped exponential backoff, and the worker now mounts the uploads volume in both compose files (K68). The compose changes were parsed statically only. The stack was not run (O-1).

## What was built

- `enqueueFileCleanupInTx(tx, orgId, storageKeys)`: one `INSERT ... SELECT unnest(...) ON CONFLICT ("organizationId", "storageKey") DO NOTHING` with the organization term, inside the caller's transaction (lock class 6).
- `sweepProjectFileCleanup({ client, storage, now?, limit = 100, onLocked? })`: one transaction; selects due rows ordered by createdAt then id, `FOR UPDATE SKIP LOCKED`; deletes each file through FileStorage with the row's own organization; removes the row (by id and organizationId) on success or ENOENT; otherwise sets attempts + 1, lastErrorCode and nextAttemptAt = now + min(2^attempts, 60) minutes; logs `key=... code=...` only; returns `{ deleted, missing, failed }`. The header states it is the one cross-organization reader of ProjectFileCleanup, writes no activity and is idempotent. `onLocked` is a test hook only, documented as such; the worker handler does not pass it.
- `projectFileCleanupHandler(jobs)` calls the sweep with the base prisma client and localFileStorage. `src/lib/worker/index.ts` creates `PROJECT_FILE_CLEANUP_QUEUE` with policy singleton, works it and schedules it with `PROJECT_FILE_CLEANUP_CRON` and an empty payload, after the existing queues.
- Compose: the worker in `docker-compose.yml` sets `UPLOADS_DIR: /data/uploads` and mounts `uploads_data:/data/uploads`. The uploads_data comment now says app and worker both mount it. In `docker-compose.egress-test.yml` the worker gets the same entries, the app gets the volume, and a top-level volumes section declares uploads_data. Nothing else changed in either file.
- Docs: `docs/OPERATIONS.md` says the uploads volume holds ticket and task attachments and that app and worker share it. `README.md` has a new "Upgrade notes: Projects foundation" section. It says the worker now mounts the volume, that this fixes the defect where inbound email attachments were written inside the worker container, and that the fix applies to email received after the upgrade (old files are not recovered). It also says deleted task attachments' files are queued in the delete transaction and that a scheduled job runs every minute, with retries and backoff. No removal time is promised.

## Verification (commands run, exit codes)

| Command | Exit | Result |
|---|---|---|
| `DOCKER_HOST=... TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=... pnpm test:integration tests/integration/project-file-cleanup.test.ts` (Task 1) | 0 | 2 passed (after one red run, see Deviations) |
| same (Task 2) | 0 | 9 passed (1 file) |
| `pnpm exec biome check src/lib/projects/file-cleanup.ts src/lib/worker tests/integration/project-file-cleanup.test.ts` | 0 | 15 files, no errors |
| `pnpm exec vitest run tests/unit/compose-uploads.test.ts` | 0 | 5 passed |
| `docker compose -f docker-compose.yml config --quiet --no-interpolate` | 0 | parses |
| `docker compose -f docker-compose.egress-test.yml config --quiet --no-interpolate` | 0 | parses |
| `pnpm exec biome check tests/unit/compose-uploads.test.ts` | 0 | clean |
| `grep -c 'Upgrade notes: Projects foundation' README.md` | 0 | 1 |
| `pnpm exec next typegen` | 0 | |
| `pnpm typecheck` (whole repository) | 0 | |

Acceptance greps: PROJECT_FILE_CLEANUP_QUEUE appears 4 times in `src/lib/worker/index.ts` (import, createQueue, work, schedule) and projectFileCleanupHandler is imported. There are 0 `@/` imports in the two new src modules. The test file contains ENOENT, EACCES, SKIP LOCKED, nextAttemptAt, onLocked, backendPid, pg_blocking_pids and deferred, and has 0 setTimeout or sleep calls. The worker handler has 0 uncommented onLocked lines. README has "every minute"; the compose-claim grep and the "within minutes" grep each print 0. `git grep -i gr8r` over src, docs, website, README.md, public, prisma and tests is empty.

`.env`: the literal `git diff --stat -- .env` was refused by the session's secret-read guard hook and did not run. `git status --short` shows no `.env` change, and no step of this plan touched `.env`.

## Docker commands executed (O-1)

- `docker compose -f docker-compose.yml config --quiet --no-interpolate` (parse only)
- `docker compose -f docker-compose.egress-test.yml config --quiet --no-interpolate` (parse only)
- Testcontainers started and removed its own Postgres container for each integration run (as in every earlier plan).
- One `docker run --rm --entrypoint date <local postgres image> -u` to compare the VM clock with the host clock while diagnosing the Task 1 red run. It was a throwaway container that started, printed the date and removed itself. It is not part of the plan, and it touched no aida container or volume.
- No `docker compose up`, `down`, `run` or `exec` was executed. **The compose stack was not run (O-1).** The inbound-email fix is a file change proven statically only: the compose files parse and the unit test reads both files. No attachment was observed on the shared volume.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The sweep skipped a row due "now" when the worker clock trailed the database clock**
- **Found during:** Task 1 (first tracer run returned `{ deleted: 0 }`)
- **Issue:** `nextAttemptAt` defaults to the database's `now()`, but the sweep compared it with the Node `new Date()`. The Colima VM clock runs slightly ahead of the host, so a row inserted just before the handler ran was not yet due. A worker container behind the database would also delay rows by the same skew.
- **Fix:** without an injected `now`, the sweep reads `SELECT now()` inside its own transaction and uses that for both the due check and the backoff. Tests that inject `now` are unchanged.
- **Files modified:** src/lib/projects/file-cleanup.ts
- **Commit:** 52ede56

**2. [Test design] The integration file owns the ProjectFileCleanup table**
- The sweep is cross-organization, so rows left by other test files (projects-schema seeds) would change its counts in a full-suite run. Every case in `project-file-cleanup.test.ts` starts with `DELETE FROM "ProjectFileCleanup"`, and the header says so.

Task 2 is `tdd="true"`, but the sweep was already complete from Task 1 except the `onLocked` hook. The edge cases passed on first run, so there was no failing RED stage. The plan type is `execute`, so no plan-level TDD gate applies.

## Known Stubs

None.

## Threat Flags

None. The new surface is the one in the plan's threat model: the worker gets read and write access to the uploads volume (T-14-27, accepted).

## Manual items (human, open; not claimed)

- With owner item O-1 resolved, run `docker compose -p aida up -d --build`, delete a task attachment and confirm its file leaves the uploads volume, then receive an email with an attachment and confirm the app serves it. Not done here.

## Commits

- 52ede56 feat(14-05): file cleanup outbox writer, sweep and scheduled worker job tracer
- 5b5d02d test(14-05): sweep edge cases, backoff and PID-bound SKIP LOCKED proof
- 57d7432 feat(14-05): worker mounts the uploads volume in both compose files (K68)

## Self-Check: PASSED

All 9 listed files exist, and commits 52ede56, 5b5d02d and 57d7432 are in `git log`.
