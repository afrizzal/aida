---
phase: 09-operations
plan: 06
subsystem: backup
tags: [backup, posix-sh, pg_dump, advisory-lock, backup-fence, lease, testcontainers, rule-j]

requires:
  - phase: 09-operations
    provides: "09-04: FILE_FENCE_KEY_SQL, BACKUP_LEASE_KEY, leaseValueActiveSql, the fenced sweep, uploads volume identity, file-fence fixtures"
provides:
  - "scripts/backup/lib.sh: log, new_set_id, valid_set_id, psql_q, lease_active_sql, lease_holder_sql, lease_value_sql, lease_active, lease_acquire, lease_renew, lease_release, uploads_identity_ok, fence_open, fence_alive, fence_close, fenced_action, record_status, pause_point"
  - "scripts/backup/aida-backup.sh: one run (exit 0 succeeded, 2 failed, 3 skipped); set layout <setId>/{db.dump, uploads.tar.gz, uploads.sha256, manifest.json}; SystemSetting backup:lastRun"
  - "tests/integration/support/backup-runner.ts: startBackupRunner, BackupRunner (runBackup, exec, pause, unpause, kill, stop), BackupRun (waitReached, hasReached, go, releaseAll), directoryStorage, parseCopy, sha256Hex, makeTestDir, integrationDatabaseContainerId"
  - ".gitignore: .test-tmp/"
affects: [09-08 backup service and scheduler (runs this script as 1000:1000), 09-10 restore (reads this set layout), 09-11 stack proof specification, 09-13 failure categories, retention, overlapping runs, status fallback]

actuals:
  tokens: 22836
  tasks: 3
  commits: 3
plan_head_before: 20c88e8f9b74bb90faeb45ae681def114c399177

tech-stack:
  added: []
  patterns:
    - "Backup side of the two-signal fence in POSIX sh: a dedicated psql session fed through a FIFO holds the exclusive advisory lock; the lease is written, renewed and released by the database clock"
    - "fenced_action: one psql transaction locks the lease row FOR UPDATE, checks holder and expiry, runs the shell action with \\! and commits only when the action exit code is 0"
    - "Checksums from the archive's own contents (GNU tar --to-command), member list compared with the checksum list"
    - "Referenced keys read from the dump itself (pg_restore --data-only --table, column positions from the COPY header)"
    - "Rule-J tool container sharing the network namespace of this run's integration database (container:<id>), with test pause points coordinated through a bind-mounted directory"

key-files:
  created:
    - scripts/backup/lib.sh
    - scripts/backup/aida-backup.sh
    - tests/integration/support/backup-runner.ts
    - tests/integration/backup-consistency.test.ts
    - tests/unit/backup-contract.test.ts
  modified:
    - .gitignore

key-decisions:
  - "The consistency suite owns an isolated database on the shared test server: the script dumps its whole database, and a dump of the shared database references other files' attachments (Rule 3)"
  - "fence_alive sends a probe through the fence session and checks pg_locks for its own exclusive lock; kill -0 alone cannot see a terminated backend while psql idles on its FIFO (Rule 1)"
  - "A failed run records backup:lastRun with setId null; the failed status is written by the exit trap directly, not through fenced_action, because the lease may be lost"
  - "Failure log: a fixed reason line (when there is one) plus a final 'backup failed: <category>' line"
  - "tar reads the file list with --verbatim-files-from, because an organization id may start with '-'"

patterns-established:
  - "Integration cases that run the backup register each run; afterEach releases every pause point and awaits the run before its leftover checks"

requirements-completed: []
requirements-partial: [AIDA-33, AIDA-38]

coverage:
  - id: D1
    description: "One run publishes one validated set (dump, archive, checksums, manifest with app version, counts, sha256 and size) covering ticket attachments, task attachments and the logo, and records succeeded with exactly four keys"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-consistency.test.ts#backup tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "Add, replace and delete at each pause point (after-fence, after-dump, after-list, after-archive): the fenced sweep deletes nothing, every dumped Attachment, TaskAttachment and logo record has its file and original sha256 in the set, and the sweep deletes after the run"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-consistency.test.ts#mid-backup add, replace and delete (4 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Verification covers all three stored-file kinds (U-14): one negative control per kind fails with category verification and publishes nothing"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-consistency.test.ts#verification covers every stored-file kind (3 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "U-13 vanishing unreferenced file tolerated; only member-pattern regular files archived, other entries counted as skipped; empty edge gives counts 0"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-consistency.test.ts#archive tolerance and odd entries (3 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "U-12 with the real script: G2 dropped session, G3 paused container, G4 io timeout, fence busy, crash (D-02(5)) and takeover (P2)"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-consistency.test.ts#U-12 fence with the real script (6 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "lib.sh and file-fence.ts use the same fence key, lease key, lease fields, lease predicate (byte for byte) and identity key; no connection URL; set id format and uniqueness; status record keys"
    requirement: AIDA-38
    verification:
      - kind: unit
        ref: "tests/unit/backup-contract.test.ts (11 cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The real backup service in the compose stack (09-08 service, 09-11 specification)"
    requirement: AIDA-33
    verification: []
    human_judgment: true
    rationale: "Not run (waiting for the Phase 8.1 harness and the owner, U-15)"

duration: 26min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 06: Backup core with the backup side of the fence Summary

**`scripts/backup/aida-backup.sh` is a POSIX sh backup run for the `pgvector/pgvector:pg16` image, running as `1000:1000` with libpq variables only. It takes the 09-04 file fence: an exclusive advisory lock held for the whole run on a dedicated `aida-backup-fence` psql session, plus a `backup:lease` row that the database clock judges and that is renewed every TTL/3. It then dumps the database, archives only `<organizationId>/<storageKey>` regular files, and takes the checksums from the archive itself. Every key the dump references in `Attachment`, `TaskAttachment` and the `branding:logo` Setting must be in the archive. The set is published by an atomic rename under the owned lease (`fenced_action`), and the run records `backup:lastRun`. Seventeen integration cases run the real script in a rule-J container against real Postgres. They pause the script at four points, terminate its fence session, freeze it with `docker pause` and kill it with `docker kill`.**

## Performance

- **Duration:** about 26 min (reading from about 08:15Z; ledger 2026-11-12T08:19:35Z; end 08:41Z, before the SUMMARY)
- **Tasks:** 3 of 3
- **Files:** 5 created, 1 modified (2407 lines in the plan diff)

## Accomplishments

- `lib.sh`, the fence: `fence_open` starts psql in a subshell. It reads statements from a FIFO in the run's `mktemp -d` directory and writes its exit status to a file. It issues `SET lock_timeout = '<wait>s'`, `SELECT pg_advisory_lock(hashtextextended('aida:file-fence', 0))` and then a marker select. A 55P03 error, or no marker within the wait plus 15 s, means `file fence busy`. `fence_alive` sends a probe through the same session and confirms in `pg_locks` that the session still holds its own `ExclusiveLock`. `fence_close` unlocks, quits and waits.
- `lib.sh`, the lease: `lease_acquire`, `lease_renew` and `lease_release` write `{"holder": <setId>, "expiresAt": to_char(now() + ttl, ISO UTC)}`. Acquire works only when the deleter's own predicate (`lease_active_sql`, byte for byte the same as `leaseValueActiveSql`) is false. Renew works only while the holder matches and the lease is active, and prints the row count. Release deletes only its own row. `id` and `"updatedAt"` are supplied in every insert.
- `lib.sh`, `fenced_action`: in one psql session, `BEGIN`, a `FOR UPDATE` CTE on the lease row, holder and expiry checked into `:owned` with `\gset`, then `\! sh <script>`. It commits only when `:SHELL_EXIT_CODE` is 0. Not owned means `ROLLBACK` and return 4.
- `aida-backup.sh`: the run in the plan's order, with these steps.
  - Skip with exit 3 when another run's lease is active.
  - Check the identity. A missing or different marker gives 'uploads volume not verified', category unknown, before any dump.
  - Take the fence, then the lease. Start the renewal loop: a zero count or an error writes a lost flag and sends USR1, and the main shell aborts with 'backup aborted: lease lost'.
  - Dump with `pg_dump -Fc --lock-wait-timeout`.
  - List the archivable files with GNU find: member pattern, regular files, no links. Count every other entry in `skippedEntries`.
  - Archive with `tar --ignore-failed-read --no-recursion --verbatim-files-from -T` (exit 0 or 1 accepted).
  - Build `uploads.sha256` from `tar --to-command`, and require the member list to equal the checksum list.
  - Read the referenced keys from the dump.
  - Write `manifest.json` and validate the parts (`pg_restore --list`, `tar -tzf`).
  - Publish: `mv -n -T` under `fenced_action`, only when the target is absent, with checks before and after the move. Then write the status under `fenced_action`.
  - On a step failure, a write probe decides `storage` versus the step's own category.
  - On every exit path the trap stops the renewal loop, records a failed status when none was recorded, releases its own lease and the fence, and removes its own `.tmp-<setId>` unless published.
- The runner (`backup-runner.ts`) follows rule J:
  - name `testResourceName("backup", runId)`, labels `testLabels(runId)`, ledger entries `planned` and `created`, Ryuk off;
  - tmpfs on the image's declared `VOLUME`, no port, `--network container:<id>` of this run's integration database (found by run label, name prefix and the published port of `DATABASE_URL`), user `1000:1000`;
  - no build and no pull: `docker image inspect` first, else `blocked (image)`;
  - `docker pause`, `unpause` and `kill` only on the id Testcontainers returned.

## Task Commits

1. **Task 1 (tracer): backup core script, fence and lease side, tracer set** - `8fc353b` (feat)
2. **Task 2: add, replace and delete at four pause points, U-14 controls, U-13 vanishing file** - `e3e6c6f` (test)
3. **Task 3: U-12 with the real script, full integration run** - `112bc62` (test)

Tracer gate (`end-of-phase`, automated verify only): both Task 1 verify commands were re-run green on the final Task 1 code before Task 2 started. These are rows "Task 1 verify (final)" below.

## Verification (exit codes read without a pipe)

All Docker runs used `AIDA_TEST_RUN_ID=mwd9pg6x-5d6fbf0dbb29c5c4`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one process at a time. Before the first Docker step: `colima status` exit 0, then `docker info` exit 0, run as two commands; both were checked again before the full run, again exit 0 and 0. Disk: 37 GiB available on the host.

| Command | Code state | Exit | Counts |
|---|---|---|---|
| `pnpm exec vitest run tests/unit/backup-contract.test.ts` | Task 1 | 0 | 11 passed |
| same, RED: fence key `..., 1)` and the lease regex operator `~*` in lib.sh | mutated | 1 | 2 failed (key text, predicate byte for byte), 9 passed |
| same, after restore | Task 1 | 0 | 11 passed |
| `pnpm test:integration tests/integration/backup-consistency.test.ts` | Task 1 | 0 | 1 passed |
| same, RED: the file list takes every file at depth 1 to 2 without the member pattern (the marker included) | mutated | 1 | 1 failed (`backup failed: archive`) |
| Task 1 verify (final, after formatting): unit and integration | Task 1 final | 0 / 0 | 11 passed / 1 passed |
| `pnpm exec tsc --noEmit` (Task 1) | Task 1 | 0 | n/a |
| `pnpm test:integration tests/integration/backup-consistency.test.ts` | Task 2 | 0 | 11 passed |
| same, RED (combined): verification of Attachment only, fence and lease dropped after the dump, tar without `--ignore-failed-read` | mutated | 1 | 10 failed, 1 passed (too broad: dropping the lease also breaks publish; split below) |
| same, RED A+C: verification of Attachment only, tar without `--ignore-failed-read` | mutated | 1 | 9 failed, 2 passed; both narrowed negative controls published ("backup succeeded"), U-13 failed with `backup failed: archive`, the rest on counts |
| same, RED B: fence session closed right after the dump | mutated | 1 | 3 failed (after-dump, after-list, after-archive: the sweep refused with `backup-lease` instead of `backup-archiving`), 8 passed |
| same, after the afterEach run release (Task 2 verify) | Task 2 final | 0 | 11 passed |
| `pnpm test:integration tests/integration/backup-consistency.test.ts` | Task 3 | 0 | 17 passed |
| same, RED (one mutation per guarantee): `fenced_action` always owned; renewal never signals; `pg_try_advisory_lock` in `fence_open`; acquire never takes an expired lease; `fence_alive` always true | mutated | 1 | 6 failed (G2: no fence-lost line; G3: `backup succeeded`; G4: `waitForBlockedBy` timeout; fence busy: run ended after 351 ms; crash: `backup skipped: lease held`; takeover: `backup succeeded`), 11 passed |
| same, after restore (Task 3 verify) | final | 0 | 17 passed (run before the red run, on the identical restored file content; `cmp` confirmed the restore) |
| `pnpm test:integration` (full, once) | final | 0 | 107 files, 1436 passed, 231 s |
| `pnpm lint` | final | 0 | 638 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`) |
| `pnpm test` (full unit) | final | 0 | 83 files, 1480 passed |
| `pnpm exec tsc --noEmit` | final | 0 | n/a |

Every mutation was made on a file backed by a copy in the plan's `mktemp -d` directory and restored with `cp`, confirmed by `cmp`. No `git stash` was used.

### Acceptance criteria

- Task 1: `git ls-files -s scripts/backup/aida-backup.sh` shows `100755`; `grep -n "postgresql://"` over both scripts prints nothing (exit 1); `grep -n "^\.test-tmp/$" .gitignore` matches line 51; `withUser` and `1000:1000` match in the runner; both verify commands exit 0. PASS.
- Task 2: one case per pause point (4), three negative controls, the vanishing-file case, the empty case, plus an odd-entries case. Each case asserts its own exit code, published set count and `backup:lastRun`. Verify exit 0. PASS.
- Task 3: test names include "G2 dropped session", "G3 paused", "G4 io timeout", "fence busy", "crash" and "takeover". `grep -rnE "\.(skip|only)\("` prints nothing. This SUMMARY records the full-suite counts, the exit code and limit L1. PASS.

## Containers (rule J)

- Probe, one time, before Task 1: `aida-test-probe-mwd9pg6x-5d6fbf0dbb29c5c4-b651d5`. It used `docker run --rm --pull never`, labels `aida.test=1` and `aida.test.run=mwd9pg6x-5d6fbf0dbb29c5c4`, `--network none`, a tmpfs on the data volume and user 1000:1000. It checked the image's tools (dash, GNU tar 1.34, GNU find 4.9.0, coreutils 9.1 mv, psql 16.15, awk) and virtiofs bind-mount ownership. Not written to the ledger (started outside Testcontainers). Removed by `--rm`.
- Runner containers started by this plan: 14, all `aida-test-backup-mwd9pg6x-5d6fbf0dbb29c5c4-<6 hex>`, all in the run ledger, all stopped and removed by the suite:
  - 5c5401, 1ad12f, aa64cf, 068d84, 72bb5f, 7f5107, 5daece, 3dd07c: main runners of the Task 1 and Task 2 runs.
  - Task 3, three runs each: 489114, b4a83d and 6dce3a were the main runners, paused and unpaused once each by G3 (green, red and full run). 82f508, 9d49ed and 6924f2 were the crash runners, each killed once by the crash case.
- Integration database containers: 11, one per `pnpm test:integration` invocation, started and stopped by `global-setup.ts`.
- After the last run, `docker ps -a --filter label=aida.test.run=mwd9pg6x-5d6fbf0dbb29c5c4` lists nothing. No other container, project, image or volume was touched. No image was built or pulled. `pnpm test:docker-cleanup --apply` was not run.

## Files Created/Modified

- `scripts/backup/lib.sh`: functions above; header documents the contract with `file-fence.ts`.
- `scripts/backup/aida-backup.sh`: one run; header documents settings, order, layout and exit codes.
- `tests/integration/support/backup-runner.ts`: rule-J runner, pause control, test `FileStorage` over a directory, COPY parser.
- `tests/integration/backup-consistency.test.ts`: 17 cases (1 tracer, 4 pause points, 3 negative controls, U-13, odd entries, empty, 6 U-12 cases).
- `tests/unit/backup-contract.test.ts`: 11 cases.
- `.gitignore`: `.test-tmp/`.

## Decisions Made

- A failed run records `{finishedAt, result: "failed", setId: null, category}`. The exit trap writes it directly, not through `fenced_action`, because the lease may already be lost.
- The test pause hook (`BACKUP_TEST_PAUSE_DIR`) lives in the production script, as the plan specifies. Without the variable it does nothing. Plan 09-08 must not set it.
- `manifest.json` `createdAt` is the run's start time (UTC, seconds). `counts.skippedEntries` includes the marker, so an empty uploads directory gives `{0, 0, 1}`.
- The app version is read from the two-space-indented `"version"` line of `BACKUP_APP_VERSION_FILE`. It must match `[0-9A-Za-z.+-]{1,64}`, otherwise it is `unknown`. In the tests it equals `package.json` (`1.0.0`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The suite owns an isolated database**
- **Found during:** Task 1 design
- **Issue:** the script dumps its whole database. In the shared integration database, the dump references other files' `Attachment` and `TaskAttachment` rows, whose files are in other directories, so every run would fail verification.
- **Fix:** `backup-consistency.test.ts` creates a database on the same server with `createIsolatedDatabase()` (migrated to head). It points `DATABASE_URL` and the Prisma singleton at it before any database import (the `sla-pause` and `auth-setup` pattern), checks `current_database()`, and drops it in `afterAll`. The runner's `PGDATABASE` is that database. The hygiene rule ("no lease, no fence lock, no `.restore-lock` left") is applied in `afterEach` to that database.
- **Consequence:** the markers come from `testVolumeIdentity()` of the isolated database and are written into per-case directories under `.test-tmp/`, not through `testUploadsDir()`. That helper creates directories under `os.tmpdir()`, which Colima does not share with its VM.
- **Commit:** `8fc353b`

**2. [Rule 3 - Blocking] Per-case directories and a test FileStorage**
- **Issue:** `localFileStorage` fixes its root when the module loads, but each case needs its own uploads directory (the empty case needs a directory holding only the marker, and cases must not see each other's files).
- **Fix:** each run sets `UPLOADS_DIR`, `BACKUP_DIR` and `BACKUP_TEST_PAUSE_DIR` to subdirectories of the mounted roots. Host-side writes go through `directoryStorage(root)`, a test `FileStorage` with the same semantics (`mkdir -p`, `wx`, `unlink`, key check). The sweep and `deleteTaskAttachment` are the real production functions.
- **Commit:** `8fc353b`, `e3e6c6f`

**3. [Rule 1 - Bug] `fence_alive` could not see a dropped session with `kill -0`**
- **Issue:** a psql idle on its FIFO does not notice a terminated backend until it sends a statement. A finished background job can also remain a zombie that `kill -0` reports as alive. The plan's `kill -0` would therefore never log the G2 line.
- **Fix:** the fence psql runs in a subshell that records its exit status in a file. `fence_alive` sends a probe through the session that also checks `pg_locks` for the session's own exclusive lock. A terminated backend makes the non-interactive psql exit.
- **Verification:** G2 asserts the line. The red run with `fence_alive` forced true fails G2.
- **Commit:** `8fc353b`

**4. [Rule 2 - Correctness] Test harness: a failed case could leave a paused run behind**
- **Found during:** Task 2, red run B. The failed case's run stayed paused, and the next `afterEach` found its lease.
- **Fix:** `runIn` registers every run. `afterEach` calls `releaseAll()` and awaits `done` before its leftover checks, so no run writes into a later case.
- **Commit:** `e3e6c6f`

**5. [Precision] Log lines and option details**
- A failed run logs its fixed reason line (when there is one) plus `backup failed: <category>`, so up to two lines. A succeeded run logs one line, plus the fence-lost line in the G2 case.
- `--verbatim-files-from` was added because an organization id may start with `-`.
- The publish script checks before and after `mv -n -T` that the target is absent and the source moved.

**6. [Scope addition] Odd-entries case (T-09-21)**
- A link, a nested directory, an upper-case name, a name with a space, a stray top-level file and a badly named top-level directory are counted as skipped (7 with the marker) and never archived.

---

**Total deviations:** 6 (2 Rule 3, 1 Rule 1, 1 Rule 2, 1 precision note, 1 scope addition). **Impact:** test isolation and one detection fix. The script's contract with 09-04 is unchanged.

## Issues Encountered

- The first combined Task 2 red run was too broad: dropping the lease also breaks publish, so 10 cases failed. It was split into runs A+C and B, which isolate each guarantee (both rows are in the table).
- The Task 1 and Task 2 code passed on their first runs. Each red row above shows that the corresponding test can fail for the reason it names.

## Stated limits

- **L1 (from 09-04, not tested by design):** a run that is paused, has lost its fence session and whose lease expired, all at the same time, no longer fences deletions. That run aborts on lease loss when it resumes, and verification refuses a set missing a referenced file.
- **Skip path (`backup skipped: lease held`, exit 3):** implemented. No case in this plan exercises it, because overlapping runs are plan 09-13's.
- **Publish over an existing directory:** refused by the publish script's checks and `mv -n -T`. Not exercised by an integration case, because set ids are random (the format and uniqueness are covered by the unit test).
- **Failure categories with real causes** (dump lock timeout, non-root archive failure, read-only storage, unreachable database), retention, the restore lock and `status-unrecorded-<setId>.json` are plan 09-13's. Here, the categories `dump`, `archive`, `storage` and `unknown` come from code paths, and only `verification`, `unknown` (busy fence, lease lost) and `archive` (red rows) were observed in tests.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-db-session | `scripts/backup/lib.sh` | Two database sessions per run from the backup container (`application_name` `aida-backup` and `aida-backup-fence`), with session-level advisory locks and `\!` shell execution inside `fenced_action`. The executed script is generated by the run in its own `mktemp -d` directory, and its path is checked against `[A-Za-z0-9._/-]`. In the threat register (T-09-21a/b). |
| threat_flag: test-hook-in-production | `scripts/backup/aida-backup.sh` | `BACKUP_TEST_PAUSE_DIR` makes the run wait at four points (at most `BACKUP_TEST_PAUSE_MAX_SECONDS`, then failed unknown). Plan 09-08 must not pass it to the service. |

## Not run

- Stack-level run of the real backup service in compose: not run (waiting for the Phase 8.1 harness and the owner, U-15). Specified by 09-11.
- `pnpm test:egress`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --prod`: not run (outside this plan's verify; phase gate).

## User Setup Required

None.

## Next Phase Readiness

- 09-08 runs `scripts/backup/aida-backup.sh` as `1000:1000` with the libpq variables, `BACKUP_DIR`, `UPLOADS_DIR` (read-only mount) and `BACKUP_APP_VERSION_FILE`, and never `BACKUP_TEST_PAUSE_DIR`.
- 09-10 reads `<setId>/manifest.json`, `uploads.sha256` and the archive members `<organizationId>/<storageKey>`.
- 09-13 adds the failure-cause tests, retention, overlapping runs, the restore lock and the status fallback on top of `lib.sh`.

---
*Phase: 09-operations*
*Completed: 2026-11-12*

## Self-Check: PASSED

All 5 created files exist. Commits 8fc353b, e3e6c6f and 112bc62 are in the log; `git rev-list --count 20c88e8..HEAD` is 3 before this SUMMARY commit. No home path or personal name in the tracked files of this plan (`grep` exit 1).
