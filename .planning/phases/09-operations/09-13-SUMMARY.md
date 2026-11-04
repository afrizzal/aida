---
phase: 09-operations
plan: 13
subsystem: backup
tags: [backup, posix-sh, retention, restore-lock, status-fallback, lease, testcontainers, rule-j]

requires:
  - phase: 09-operations
    provides: "09-06: lib.sh (lease, fence, fenced_action, record_status, pause_point), aida-backup.sh, backup-runner.ts"
provides:
  - "scripts/backup/lib.sh: retention_prune, retention, status_args_ok, status_json, status_unrecorded, new_restore_holder, valid_restore_holder, valid_lease_holder, restore_lock_dir, restore_lock_write, restore_lock_present, restore_lock_acquire, restore_lock_holder, restore_lock_heartbeat, restore_lock_release; fenced_action returns 3 on a restore lock"
  - "scripts/backup/aida-backup.sh: BACKUP_RETENTION (default 7, 1..9999); exit 5 (status not recorded); exit 3 also for a restore in progress; status ownership rule"
  - "BACKUP_DIR files: status-unrecorded-<setId>.json, .restore-lock/{holder,heartbeat}"
  - "tests/integration/support/backup-runner.ts: backupsReadOnly, closedDatabasePort, CLOSED_DATABASE_PORT, exec(command, env)"
  - "tests/integration/backup-failures.test.ts (18 cases)"
affects: [09-08 backup status UI (categories and the four-key record), 09-10 restore (restore-lock helpers, lease_acquire and lease_release with a restore holder), 09-11 stack proof specification]

actuals:
  tokens: 17298
  tasks: 3
  commits: 3
plan_head_before: c2894a4809830706b8a16cf1341d3e0996443665

tech-stack:
  added: []
  patterns:
    - "Retention as a fenced_action script: only the owner of an unexpired lease prunes, inside the locked session"
    - "Restore-lock re-check inside fenced_action: a `\\!` shell test after the FOR UPDATE row lock, before the action, so a restore's lease_acquire serialises behind it"
    - "Status-unrecorded fallback: one stderr line, then a per-set file written temp-then-rename with mv -n -T, never removed"
    - "Real failure causes in tests: a held ACCESS EXCLUSIVE lock, a mode-000 directory, a read-only bind mount, a closed port"

key-files:
  created:
    - tests/integration/backup-failures.test.ts
  modified:
    - scripts/backup/lib.sh
    - scripts/backup/aida-backup.sh
    - tests/integration/support/backup-runner.ts
    - tests/integration/backup-consistency.test.ts

key-decisions:
  - "A failed retention removal logs 'backup retention incomplete' and the run still succeeds: the published set is complete and valid"
  - "fenced_action checks the restore lock before ownership, so a restore that took its lock and replaced the database (lease row gone) gives 'backup skipped: restore in progress' rather than 'lease lost'; on_lease_lost also checks the lock, for a loss seen by the renewal loop"
  - "lease_acquire and lease_release accept a restore holder (restore-<32 hex>), because plan 09-10 takes the lease with it; fenced_action and lease_renew stay set-id only for backup runs"
  - "The set id is generated before settings are validated, so even an invalid-setting failure can name its unrecorded-status file"
  - "The fallback record's finishedAt comes from the container clock (UTC, milliseconds), because the database clock is the thing that may be unreachable"

patterns-established:
  - "Each failure case in backup-failures.test.ts carries its own assertion set: exit code, backup:lastRun value or absence, status-unrecorded file, stderr line, published sets, leftover .tmp- directories"

requirements-completed: []
requirements-partial: [AIDA-33, AIDA-38]

coverage:
  - id: D1
    description: "Retention keeps the BACKUP_RETENTION newest successful sets ordered by set id, removes stale .tmp-<setId> directories, leaves keep-me, status-unrecorded-*.json and .restore-staging-* alone; failed runs do not count; an invalid BACKUP_RETENTION fails before the fence"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-failures.test.ts#retention (D-03) (2 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Failure categories with real causes: dump (ACCESS EXCLUSIVE past a 2 s lock timeout), archive (directory uid 1000 cannot read), storage (read-only backups mount, recorded in the database)"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-failures.test.ts#failure categories with real causes (P11) (dump, archive, storage)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Status ownership and the unrecorded fallback: database unreachable (exit 5, stderr line, per-set file), both unwritable (exit 5, stderr line, no file), earlier file kept by a later run, lease lost writes no status"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-failures.test.ts#failure categories with real causes (P11) (4 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Privacy: the record has exactly four keys; output holds no password, no path beyond the set id, no raw error text (success and dump)"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-failures.test.ts#privacy of the record and the output (2 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Overlapping and manual runs exit 3 without touching sets, the first run's temp directory, its lease or the status; restore lock before start, mid-run after-fence and after-archive (lease row deleted) exit 3 with nothing published, no retention, no status, no unrecorded file; restore-lock helpers refuse a second acquire and a foreign holder"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-failures.test.ts#overlapping and manual runs (2), restore lock (Q3, backup side) (5)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The real backup service in the compose stack (09-08 service, 09-11 specification)"
    requirement: AIDA-33
    verification: []
    human_judgment: true
    rationale: "Not run (waiting for the Phase 8.1 harness and the owner, U-15)"

duration: 24min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 13: Backup failures, retention, status fallback and the restore lock Summary

**The backup core now holds up under failure. Retention runs through `fenced_action` under the owned lease and keeps the `BACKUP_RETENTION` newest sets (default 7). It removes stale `.tmp-<setId>` directories and touches nothing else. The run's status is written by whoever owns it: directly when the run never held the lease, through `fenced_action` while it holds it, and not at all once it lost it. When the write fails, the run prints `AIDA_BACKUP_STATUS_UNRECORDED <json>` on stderr, writes `status-unrecorded-<setId>.json` when it can, and exits 5. A `.restore-lock` stops a run before it starts and again inside `fenced_action` before publish, retention and the status write. Eighteen integration cases prove this with real causes: a held lock, an unreadable directory, a read-only mount and a closed port.**

## Performance

- **Duration:** about 24 min (ledger 2026-11-12T09:18:00Z, end of the full run 09:41Z)
- **Tasks:** 3 of 3
- **Files:** 1 created, 4 modified (1364 insertions, 53 deletions)

## Accomplishments

- **Order (Q8).** One run goes: restore-lock check, set id, settings, lease pre-check, identity, fence, lease, temp directory and its holder file, dump, list, archive, checksums, verification, manifest, validation, publish, retention, status, then release of the lease and the fence.
- **Retention (D-03, P6).** `retention_prune` lists `BACKUP_DIR/*` with a shell glob. A set is any plain directory whose name passes `valid_set_id`. Sets are sorted by name, newest first: the set id starts with its UTC time, so name order is time order. Every set past the keep count is removed with `rm -r --`. Each `.tmp-<valid id>` directory whose `holder` file does not name the current run is removed as well. `retention` writes the action script into `RUN_TMP` and runs it through `fenced_action`. No `rm -rf` remains in either script.
- **Status ownership (D-04, P6).** `write_status` in `aida-backup.sh`:
  - without the lease (never held), it calls `record_status` directly;
  - with the lease, it runs the generic `status.sh` through `fenced_action`;
  - after a lost lease (`LEASE_LOST`, set by the renewal signal or a `fenced_action` 4), it writes nothing.
- **Fallback (D-04, P6, Q8).** `status_unrecorded` prints the four-key JSON on stderr. It then writes `.status-unrecorded-<setId>.json.part` and moves it with `mv -n -T`, never over an existing file. A failed write is logged as 'backup status record file not written', and the run exits 5. A failed status write after a successful publish also exits 5. That path is implemented, but no case exercises it (see Stated limits).
- **Restore lock (Q3).** The shared helpers are in `lib.sh`:
  - `new_restore_holder` makes `restore-<32 hex>`;
  - `restore_lock_acquire` creates the directory with an atomic `mkdir` and writes `holder` and `heartbeat` (epoch seconds), each temp-then-rename; if a write fails, it removes the directory it created;
  - `restore_lock_heartbeat` and `restore_lock_release` act only when the stored holder is theirs;
  - `restore_lock_present` reports whether a lock exists.

  The script checks for the lock first, before anything else. `fenced_action` takes the `FOR UPDATE` row lock and then runs `\! test ! -e "$AIDA_RESTORE_LOCK_PATH" && test ! -L ...` before it runs the action. On a lock it rolls back and returns 3, and the script exits 3 with no status.

## Task Commits

1. **Task 1 (tracer): retention through fenced_action** - `f190030` (feat)
2. **Task 2: status ownership, unrecorded-status fallback, real-cause failure cases** - `9f8c9e6` (feat)
3. **Task 3: restore lock helpers and checks, overlapping and manual runs, full integration run** - `e52496d` (feat)

Tracer gate (`end-of-phase`, automated verify only): the Task 1 verify command was re-run on the committed Task 1 code before Task 2 started (row "Task 1 tracer gate"), exit 0.

## Verification (exit codes read without a pipe)

All Docker runs used `AIDA_TEST_RUN_ID=mwdbxbtj-5e9d773498e8d525`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one process at a time. `colima status` and then `docker info` were run as two commands before the first Docker step (exit 0 and 0) and again before the full run (exit 0 and 0). The runner image `pgvector/pgvector:pg16` was already on the host. Disk: 37 GiB available on the host.

Every mutation was made on a file backed by a copy in the plan's `mktemp -d` directory, then restored with `cp` and confirmed by `cmp`. The "Task 1 code" rows used `git show HEAD:<path>` before the Task 2 commit. No `git stash` was used.

| Command | Code state | Exit | Counts |
|---|---|---|---|
| `pnpm test:integration tests/integration/backup-failures.test.ts` | 09-06 code, retention test only | 1 | 1 failed (9 sets left, no retention) |
| same | Task 1 | 0 | 2 passed |
| same, RED: `.tmp-` loop over every dot entry without the set-id check; BACKUP_RETENTION not validated | mutated | 1 | 2 failed (`.restore-staging-x` removed; retention 0 ran and exited 0 with 'retention incomplete') |
| same (Task 1 tracer gate) | Task 1 committed | 0 | 2 passed |
| same, RED: Task 2 tests on Task 1 scripts (first attempt) | Task 1 | 1 | 4 failed, 7 passed. Not valid as red: a test bug, `runIn` did not forward `closedDatabasePort`, so two cases failed for the wrong reason. Fixed and re-run below |
| same, RED: Task 2 tests on Task 1 scripts | Task 1 | 1 | 4 failed, 7 passed (unreachable and both-unwritable: exit 2 'backup status not recorded', no fallback; earlier-file case likewise; lease lost wrote a failed status) |
| same | Task 2 | 0 | 11 passed |
| same, RED: dump, archive (find) and storage (mkdir) categories forced to unknown; set path in the success line; PGPASSWORD in the failure line | mutated | 1 | 6 failed (retention's failed run, dump, archive, storage, privacy success '/backups', privacy dump password), 5 passed |
| `pnpm test:integration tests/integration/backup-consistency.test.ts` | Task 2 | 1 | 1 failed: crash case, the new run's retention removed the killed run's stale temp directory (intended D-03 behaviour; expectation updated) |
| same | Task 2 final | 0 | 17 passed |
| `pnpm exec vitest run tests/unit/backup-contract.test.ts` | Task 2 | 0 | 11 passed |
| `pnpm test:integration tests/integration/backup-failures.test.ts`, RED: Task 3 tests on Task 2 scripts | Task 2 | 1 | 5 failed (`new_restore_holder: not found`; restore in progress: the run ran), 13 passed |
| same | Task 3 | 0 | 18 passed |
| same, RED: no restore-lock test in fenced_action; no check at start or in on_lease_lost; `mkdir -p` in acquire; no holder check in heartbeat or release; the lease-held skip turned into a failure | mutated | 1 | 7 failed (overlapping, manual run: exit 2; restore in progress, after-fence: 'backup succeeded'; after-archive: 'lease lost' exit 2; acquire twice: second acquire 0; foreign heartbeat 0), 11 passed |
| `pnpm exec biome check .` | Task 3 | 0 | 648 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`) |
| `pnpm exec tsc --noEmit` | Task 3 | 0 | n/a |
| `pnpm exec vitest run tests/unit/backup-contract.test.ts` | Task 3 | 0 | 11 passed |
| `pnpm test:integration` (full, once) | final | 0 | 110 files, 1473 passed, 265.6 s |

### Acceptance criteria

- **Task 1: PASS.**
  - `grep -n "retention"` matches in both scripts.
  - `grep -n "rm -rf\|rm -fr"` over both scripts prints nothing (exit 1).
  - The verify command exits 0.
- **Task 2: PASS.**
  - `AIDA_BACKUP_STATUS_UNRECORDED` and `status-unrecorded-` match in `lib.sh` and `aida-backup.sh`.
  - Test names include "dump", "archive", "storage", "database unreachable", "both unwritable", "lease lost writes no status" and "privacy".
  - Each case has its own expect block. No shared expectation covers several cases.
  - The verify command exits 0.
- **Task 3: PASS.**
  - Each helper name matches in `lib.sh` as a function definition.
  - Test names include "overlapping", "manual run", "restore in progress", "restore lock mid-run after-fence" and "restore lock mid-run after-archive".
  - `grep -rnE "\.(skip|only)\("` prints nothing (exit 1).
  - The full-suite counts and exit code are recorded above.

## Containers (rule J)

- **Runner containers:** 30, all `aida-test-backup-mwdbxbtj-5e9d773498e8d525-<6 hex>`. All were created through `startBackupRunner`: named by `testResourceName`, labelled by `testLabels`, recorded in the run ledger, with no port, the network namespace of this run's integration database, uid 1000:1000 and no image build or pull.
  - Per `backup-failures.test.ts` invocation: one main runner. Task 2 runs add a read-only-backups runner, and Task 3 runs also add a manual-run runner.
  - Per `backup-consistency.test.ts` invocation: one main runner and one crash runner.
  - The suffixes, in ledger order: 3d43fe ebe64f cbebc3 726a51 329aa8 7d049d c1f614 65b7ea 1de01a 1171ec 0edcbf 4f79f7 66b33b 1c6792 b5c243 f99254 099e61 89b0cc fae2fc b8cdac b6ac4a f77765 47f63c c474e2 66489b 2c34de 143dea 712a2e 5dbc7b be518c.
- **Pause, unpause and kill.** `backup-failures.test.ts` pauses, unpauses and kills nothing. The 09-06 consistency suite ran three times in this plan (twice alone, once in the full run). In each run its G3 case paused and unpaused its own main runner once, and its crash case killed its own crash runner once. Those are 3 pauses, 3 unpauses and 3 kills, each on the id that Testcontainers returned for that container.
- **Integration database containers:** one per `pnpm test:integration` invocation (14), started and stopped by `global-setup.ts`.
- **Cleanup.** After the last run, `docker ps -a --filter label=aida.test.run=mwdbxbtj-5e9d773498e8d525` lists nothing. No other container, project, image or volume was touched. `pnpm test:docker-cleanup --apply` was not run.

## Files Created/Modified

- `scripts/backup/lib.sh`: retention, status JSON and fallback, restore-lock helpers, restore-holder validation, and the `fenced_action` restore-lock re-check.
- `scripts/backup/aida-backup.sh`:
  - the header documents the order, status ownership, the restore lock and exit codes 0, 2, 3 and 5;
  - adds `BACKUP_RETENTION`, `write_status`, `restore_skip` and the exit-5 path;
  - generates the set id first.
- `tests/integration/support/backup-runner.ts`: `backupsReadOnly`, `closedDatabasePort` and `CLOSED_DATABASE_PORT` (port 1), plus `exec(command, env)`.
- `tests/integration/backup-failures.test.ts`: 18 cases in four groups: retention (2), failure categories (7), privacy (2), overlap (2) and restore lock (5).
- `tests/integration/backup-consistency.test.ts`: the expectations 09-06 wrote for the old behaviour now follow the new rules (Deviation 1).

## Decisions Made

- **Failed retention removal.** It is logged as 'backup retention incomplete', and the run still records `succeeded`, because its set is complete and published. A storage problem that also blocks the next run shows up as that run's `storage` failure.
- **Lock check before ownership.** `fenced_action` checks the restore lock first. After a database replacement the lease row is gone, and the run still reports 'backup skipped: restore in progress'.
- **Restore holders.** `lease_acquire` and `lease_release` accept a restore holder for plan 09-10.
- **Category of an unreachable database.** It gives the fixed log line 'database not reachable' and category `unknown`. The UI-SPEC has no database category, and Surface 4 maps `unknown` to the generic sentence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 09-06 consistency expectations conflicted with the new ownership and retention rules**
- **Found during:** Task 2, the consistency suite run.
- **Issue:** the G3-paused and takeover cases expected a lease-lost run to record `failed/unknown`. D-04 and P6 now say such a run writes nothing. The crash case expected the killed run's `.tmp-<setId>` to survive the next run, but D-03 retention now removes it.
- **Fix:** `expectFailedRun` gained a `status: "recorded" | "none"` argument, and the two lease-lost cases pass `"none"`. The crash case now expects only the new set to remain.
- **Files modified:** `tests/integration/backup-consistency.test.ts` (not in the plan's `files_modified`).
- **Commit:** `9f8c9e6`

**2. [Rule 2 - Correctness] Lease helpers accept a restore holder**
- **Issue:** the plan's key links say 09-10 calls `lease_acquire` and `lease_release` with the holder from `new_restore_holder`. Both refused anything but a set id.
- **Fix:** they now check `valid_lease_holder`, which accepts a set id or a restore holder. `fenced_action`, `lease_renew` and `retention` stay set-id only. No case in this plan takes the lease with a restore holder. 09-10 tests that.
- **Commit:** `e52496d`

**3. [Scope addition] Invalid-setting case**
- One extra retention case: with `BACKUP_RETENTION` 0, the run fails with `unknown` before the fence and touches no set.

**4. [Precision] The "manual run" uses a second runner container**
- The plan says "a second runner exec". A second container (same database and directories) stands for an operator's one-off run, and it keeps the case distinct from "overlapping", which runs in the same container.

**5. [Test bug, fixed before the valid red] `runIn` did not forward `closedDatabasePort`**
- The first Task 2 red run was therefore not a valid red for the two unreachable-database cases. It is recorded in the table and was re-run after the fix.

---

**Total deviations:** 5 (1 Rule 1, 1 Rule 2, 1 scope addition, 1 precision note, 1 test bug). **Impact:** two 09-06 expectations now follow the plan's own rules, and the lease helpers are ready for 09-10. The fence contract with 09-04 is unchanged (11 contract cases pass).

## Issues Encountered

- **Overlap cases were green on the Task 2 code.** The `lease held` skip existed since 09-06 but had never been tested. The mutation row shows these cases fail when the skip becomes a failure.
- **The archive cause is real on this host.** A mode-000 directory created on the host is unreadable for uid 1000 over Colima virtiofs: `ls` inside the runner fails, and the case asserts that before it runs the backup.

## Stated limits

- **Unrecorded status after a successful publish:** implemented (exit 5, the record names the set) but not tested. A real cause would need the database to become unreachable between publish and the status write. That is not run (no real cause in this harness without an injection flag, P11).
- **Retention ties:** two sets created in the same UTC second are ordered by their random suffix. The retention test waits more than one second between runs, so its order is exact.
- **Release race:** `restore_lock_release` reads the holder and then removes the directory, so the two steps are not atomic. Only the holder releases, and no automatic takeover exists (09-10 deferral: `--break-stale-lock` is an explicit operator action), so nothing races it in normal use.
- **Restore lock after publish:** a restore lock that appears after publish but before retention or the status write leaves the set published, with no retention and no status, and the run exits 3. No case covers that window. The after-fence and after-archive cases cover the lock before publish.

## Threat Flags

None beyond the plan's register. T-09-20a, T-09-21c, T-09-21d and T-09-19a are mitigated as specified and covered by the cases above. The new `\!` statement in `fenced_action` is a fixed `test` command whose path arrives through an environment variable, not through the SQL text.

## Not run

- **Stack-level run of the backup service in compose:** not run (waiting for the Phase 8.1 harness and the owner, U-15). Specified by 09-11.
- **Other suites:** `pnpm test` (full unit), `pnpm test:egress`, `pnpm test:e2e`, `pnpm build` and `pnpm audit --prod` were not run. They are outside this plan's verify and belong to the phase gate. Only the backup contract unit file was run.

## User Setup Required

None.

## Next Phase Readiness

- **09-08:** the record has four keys, and `category` is one of dump, archive, verification, storage or unknown. Exit 5 means: look for `AIDA_BACKUP_STATUS_UNRECORDED` in the service log and `status-unrecorded-<setId>.json` on the backups volume. `BACKUP_RETENTION` is an operator setting.
- **09-10:** it can use these helpers: `new_restore_holder`, `restore_lock_acquire`, `restore_lock_heartbeat`, `restore_lock_release`, `restore_lock_present`, `restore_lock_holder`, and `lease_acquire` and `lease_release` with the restore holder. Retention never touches `.restore-lock` or `.restore-staging-*`.

---
*Phase: 09-operations*
*Completed: 2026-11-12*

## Self-Check: PASSED

The created file `tests/integration/backup-failures.test.ts` exists. Commits f190030, 9f8c9e6 and e52496d are in the log. `git rev-list --count c2894a4..HEAD` is 3 before this SUMMARY commit. No home path or personal name appears in the tracked files of this plan (`grep` exit 1).
