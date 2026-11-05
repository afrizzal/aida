---
phase: 09-operations
plan: 10
subsystem: backup
tags: [restore, posix-sh, bash, restore-lock, lease, pg_restore, testcontainers, rule-j, fake-docker]

requires:
  - phase: 09-operations
    provides: "09-06: lib.sh, aida-backup.sh, backup-runner.ts; 09-13: restore-lock helpers (new_restore_holder, restore_lock_acquire, restore_lock_heartbeat, restore_lock_release, restore_lock_holder), lease_acquire and lease_release with a restore holder; 09-08: the compose backup service, backups_data and backup-init"
provides:
  - "scripts/backup/aida-restore-set.sh <setDir>: whole-set validation into BACKUP_DIR/.restore-staging-<holder>, then the database step and the uploads step as 1000:1000; exit codes 0, 2 usage, 3 lock, 4 validation, 6 target check, 7 database, 8 uploads"
  - "scripts/restore.sh <setId> [--yes] and --break-stale-lock <holder>: volume names from compose config, restore lock then lease, stop, set script, one trap, start, probe wait"
  - "lib.sh: MEMBER_PATH_RE, valid_member_path, member_list_ok, restore_lock_age, restore_lock_break_stale"
  - "BACKUP_DIR/.restore-lock/target-touched (database, then uploads)"
  - "tests/integration/support/backup-runner.ts: startRestoreRunner (one labelled named volume per runner), removeTestVolume, RESTORE_UPLOADS, RESTORE_PAUSE_POINTS"
  - "tests/integration/backup-restore-roundtrip.test.ts (21 cases), tests/unit/restore-script.test.ts (18 cases), tests/unit/fixtures/restore/docker"
affects: [09-11 stack proof specification (isolated-stack restore), 09-12 installer (wraps restore.sh), Phase 8.1 replan (docs/OPERATIONS.md Restore sections)]

actuals:
  tokens: 29500
  tasks: 3
  commits: 5
plan_head_before: 3cfedd5381cc0bdeb8d967816b9732d352e711c8

tech-stack:
  added: []
  patterns:
    - "Validate-then-write restore: every check writes only to a staging directory on the backups volume; target-touched is recorded immediately before the first write to each target"
    - "Outcome by record, not by exit code: the wrapper's single trap reads target-touched before it releases the lock, and starts services only when nothing was touched"
    - "Fake executable on PATH: a POSIX sh docker that logs argv and exits 97 on any call it does not know"
    - "Per-case labelled named volume as a real mount point, removed by exact name through planExact and applyCleanup"

key-files:
  created:
    - scripts/backup/aida-restore-set.sh
    - tests/integration/backup-restore-roundtrip.test.ts
    - tests/unit/restore-script.test.ts
    - tests/unit/fixtures/restore/docker
  modified:
    - scripts/backup/lib.sh
    - scripts/restore.sh
    - tests/integration/support/backup-runner.ts
    - docs/OPERATIONS.md
    - website/src/content/docs/operations/backup-and-restore.md
    - website/src/content/docs/operations/upgrading-and-logs.md

key-decisions:
  - "The set script exits 3 on a holder mismatch at start, on a heartbeat that finds another holder (USR1 from the background loop), and on a synchronous holder re-check before each target step"
  - "Only 'cannot drop inherited constraint' is benign, and a non-zero pg_restore exit with no error line at all also fails the database step"
  - "The ownership check covers uid and gid 1000 for every entry, the mount point included, before and after the copy"
  - "On success the wrapper releases its lease and lock before it starts backup, app and worker, so the backup service never starts into a held restore lock; every other exit goes through the one trap"
  - "The lock step generates the holder with lib.sh new_restore_holder inside the container and also checks that the set exists (exit 4, nothing stopped)"
  - "--break-stale-lock calls lib.sh restore_lock_break_stale (holder must match, heartbeat older than 900 s); the in-container logic is tested in the integration file, the wrapper's mapping on the fake"
  - "The wrapper reads volume names with a small awk JSON scanner (no jq on an operator host); tested against the real `docker compose config --format json` shape, pretty and compact"

patterns-established:
  - "Each refusal case asserts: exit code, the [restore] reason line, the target's full table inventory, the target volume's entry list, no target-touched, no staging directory, the lock still held by the case's holder"

requirements-completed: []
requirements-partial: [AIDA-33, AIDA-38]

coverage:
  - id: D1
    description: "Round trip: two ticket attachments, a task attachment and a logo replaced at after-dump are restored into a fresh database and a labelled named volume; every Attachment, TaskAttachment and logo record's file matches the original sha256; marker equals the restored uploads:volume-id; every entry 1000:1000; no backup:lease row"
    requirement: AIDA-38
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-roundtrip.test.ts#round trip: ticket attachments, a task attachment and a logo replaced mid-backup come back byte for byte"
        status: pass
    human_judgment: false
  - id: D2
    description: "Rejection matrix before any write (exit 4): tampered, forged checksum, forged pair, staged mismatch, traversal, absolute, symlink, hard link, fifo, special name, newline, marker member, missing identity"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-roundtrip.test.ts#rejection matrix (13 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Unsafe targets refused before any write (exit 6): foreign owner, not a mount point"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-roundtrip.test.ts#unsafe targets (2 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Empty round trip (R3): identity and marker only; the restored marker equals the restored identity"
    requirement: AIDA-38
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-roundtrip.test.ts#empty round trip"
        status: pass
    human_judgment: false
  - id: D5
    description: "Restore lock (Q3): double acquire, foreign holder, heartbeat swap during validation, break stale lock"
    requirement: AIDA-33
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-roundtrip.test.ts#restore lock and holder (4 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Wrapper outcome rules on a fake docker: success, validation failure, database and uploads failures, TERM after target-touched, held lock, running backup, missing volume, confirmation, set id check, --break-stale-lock"
    requirement: AIDA-33
    verification:
      - kind: unit
        ref: "tests/unit/restore-script.test.ts (18 cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The wrapper against a real compose project (the `docker compose run -v <real volume name>` mount, stop and start of real services) and the isolated-stack restore of AIDA-33"
    verification: []
    human_judgment: true
    rationale: "not run (waiting for the Phase 8.1 harness and the owner, U-15); specified by 09-11. Running restore against a real compose project is forbidden in this run."

duration: 30min
completed: 2026-11-12
status: complete
---

# Phase 9 Plan 10: Restore Summary

**`aida-restore-set.sh` validates a whole backup set (manifest checksums, member names and types, staged checksums, the dump's volume identity) in a staging directory before it writes anything. It then restores the database and the uploads mount point as 1000:1000 and writes the volume marker from the restored identity. `restore.sh` wraps it with the restore lock, the backup lease and one trap that starts the services again only when nothing was touched.**

## Performance

- **Duration:** about 30 min
- **Started:** 2026-11-12T11:08:42Z
- **Completed:** 2026-11-12T11:38Z
- **Tasks:** 3 of 3
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments

- `scripts/backup/aida-restore-set.sh` runs in this order:
  - it checks the holder;
  - it starts the background heartbeat;
  - it validates the set: exactly four regular files, the set id equal to the directory name and to the manifest's `setId`, sha256 and size of each part equal to the manifest's, `pg_restore --list`, member names from `tar -tzPf --quoting-style=escape` against `MEMBER_PATH_RE` with no leading `-` and no duplicates, member types from the verbose listing (`-` only), the checksum list format, members equal to the checksum list, extraction with `--no-same-owner --no-same-permissions --keep-old-files`, staged files and directories equal to the list, `sha256sum -c --strict`, and exactly one `uploads:volume-id` in the dump;
  - it runs the target checks: running as 1000:1000, PGDATABASE set, the target is a mount point, and every entry is owned by 1000:1000 and writable;
  - database step: `target-touched=database`, `pg_restore --clean --if-exists --no-owner --no-privileges` with the v1 benign filter, the `backup:lease` row deleted, the restored identity checked;
  - uploads step: `target-touched=uploads`, the old entries removed one by one, the staged files copied in (0755 directories, 0644 files), copied checksums checked, the marker written to a temporary file and renamed, then the ownership check and the probe file.
- `scripts/restore.sh` runs in this order: set id check, confirmation, volume names and `docker volume inspect`, the lock step (holder from `new_restore_holder`, set existence), the lease step, `stop backup app worker`, the set script in a background job with `wait` (so a signal reaches the trap at once), then release, start and the probe wait on success. One trap handler covers EXIT, INT, TERM and HUP, and `--break-stale-lock` covers stale locks.
- The `docs/OPERATIONS.md` Restore runbook is rewritten. It has a refusal table and a failure-outcome table, and covers ownership, integrity versus authenticity, a lock left behind, and the `pg_restore` notes.

## Task Commits

1. **Task 1 (tracer): restore set script and backup-then-restore round trip tracer**: `9a6d50d` (feat)
2. **Task 2: rejection matrix, empty round trip, lock and holder cases**: `1ce25ea` (test)
3. **Task 3 (TDD): operator wrapper, fake-docker tests, Restore docs**: `0b8ac97` (test, RED), `2094d3e` (feat, GREEN), `fb6af52` (fix: tsc on the new test)

Tracer gate (`end-of-phase`, automated verify only): the Task 1 verify was re-run green on the final Task 1 code (row "Task 1 final" below) before Task 2 started.

## Verification (exit codes read without a pipe)

Every Docker run used `AIDA_TEST_RUN_ID=mwdfpj5t-c5620c865f6739e4`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one process at a time. `colima status` and `docker info` were run as two commands before each task's first Docker step and before the full run. Every result was exit 0. Disk: 34 GiB available.

| Command | Code state | Exit | Counts |
|---|---|---|---|
| `pnpm test:integration tests/integration/backup-restore-roundtrip.test.ts` | Task 1, first draft | 1 | 1 failed: `validation: archive extraction` (tar refuses `--no-overwrite-dir` with `--keep-old-files`; a bug, not a valid red) |
| same | Task 1 | 0 | 1 passed |
| same, RED: marker written as `0000` | mutated | 1 | 1 failed (marker `0000` vs the identity) |
| same, RED: files copied truncated to 8 bytes, copied-checksum check off | mutated | 1 | 1 failed (sha256 differs for a ticket attachment) |
| same, RED: `backup:lease` row not deleted | mutated | 1 | 1 failed (lease rows 1, expected 0) |
| same (Task 1 final, after restore of the script, `cmp` OK) | Task 1 final | 0 | 1 passed |
| `pnpm exec vitest run tests/unit/backup-contract.test.ts` | Task 1 | 0 | 11 passed |
| `pnpm test:integration tests/integration/backup-restore-roundtrip.test.ts` | Task 2 | 0 | 21 passed, 18 s |
| same, RED, one mutation per guarantee (uploads.sha256 manifest check off, member type check off, mount-point check off, ownership pre-check off, heartbeat never signals, holder check off, identity check off, member name check off, staged checksum off) | mutated | 1 | 16 failed, 5 passed. 15 failures are the mutated guarantees. The 16th (break stale lock) failed only in afterEach on a leftover lock from the failed heartbeat-swap case, a cleanup bug fixed before the green run. The 5 that passed are unaffected by these mutations: tracer, tampered and forged pair (the archive checksum stayed on), empty round trip, double acquire (lib only) |
| same, after restore (`cmp` OK) and the cleanup fix | Task 2 final | 0 | 21 passed |
| `pnpm exec vitest run tests/unit/restore-script.test.ts`, RED against the v1 `restore.sh` | Task 3 RED | 1 | 17 failed, 1 passed (the fixture self-check) |
| same | Task 3 GREEN | 0 | 18 passed |
| same, mutation: the trap starts the services after `target-touched=database` | mutated | 1 | 2 failed (database step, TERM after target-touched) |
| same (after the tsc fix) | final | 0 | 18 passed |
| `bash -n scripts/restore.sh && sh -n scripts/backup/aida-restore-set.sh` | final | 0 | n/a |
| `pnpm lint` | final | 0 | 664 files, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`) |
| `pnpm exec tsc --noEmit -p .` | Task 3 GREEN | 2 | 1 error: `NODE_ENV` missing in the test's `ProcessEnv` (fixed in `fb6af52`) |
| same | final | 0 | n/a |
| `pnpm test` (full unit) | final | 0 | 90 files, 1628 passed |
| `pnpm test:integration` (full, once) | final | 0 | 112 files, 1500 passed, 281 s |

Every mutation was made on a file backed up in this plan's `mktemp -d` directory, then restored with `cp` and confirmed with `cmp`. No `git stash` was used.

### Acceptance criteria

- **Task 1:** PASS.
  - `git ls-files -s scripts/backup/aida-restore-set.sh` shows `100755`.
  - `RESTORE_HOLDER`, `restore_lock_heartbeat`, `uploads:volume-id`, `target-touched` and `no-same-owner` each match (7, 1, 4, 4, 2 lines).
  - `grep -n exit-on-error` prints nothing (exit 1).
  - The verify command exits 0.
- **Task 2:** PASS.
  - All 19 required test names are present.
  - `grep -rnE "\.(skip|only)\("` prints nothing (exit 1).
  - The verify command exits 0.
- **Task 3:** PASS.
  - `restore_lock_acquire`, `restore_lock_release`, `break-stale-lock`, `trap` and `target-touched` each match in `scripts/restore.sh`.
  - `grep -n "down -v\|volume rm" scripts/restore.sh docs/OPERATIONS.md` prints nothing (exit 1).
  - `/api/health/probe` matches.
  - The Restore section names the three failure states with their service outcome, `APP_ENCRYPTION_KEY` and the unsigned manifest.
  - `git ls-files -s tests/unit/fixtures/restore/docker` shows `100755`.
  - Both verify commands exit 0.
- **Plan verification:** PASS. The round-trip integration test and the wrapper unit test pass, and both scripts pass the syntax check.

## Containers and volumes (rule J)

- **Probe containers:** 3, run one at a time before Task 1 to check the image's tar and tools. They used `docker run --rm --pull never`, labels `aida.test=1` and `aida.test.run=mwdfpj5t-c5620c865f6739e4`, `--network none`, a tmpfs on the data volume and user 1000:1000. The names were `aida-test-probe-mwdfpj5t-c5620c865f6739e4-205ef9`, `-8ed78b` and `-4cd4cb`. They were not written to the ledger (started outside Testcontainers) and were removed by `--rm`. They showed:
  - GNU tar 1.34 with its verbose type characters `h`, `l` and `p`;
  - escaped newlines in member names;
  - `-P` keeping `/` and `../` names;
  - `mountpoint`, `stat`, `find` and `sha256sum` present.
- **Restore runner containers:** 90, all `aida-test-restore-mwdfpj5t-c5620c865f6739e4-<6 hex>`. They come from 10 invocations of the round-trip file (6 in Task 1, 3 in Task 2, 1 inside the full run), one per case. All were recorded in the ledger, and all were stopped and removed by `started.stop()`.
- **Named volumes:** 90, all `aida-test-uploads-mwdfpj5t-c5620c865f6739e4-<6 hex>`, one per restore runner. Each one was created with `docker volume create --label aida.test=1 --label aida.test.run=<run id>` and recorded as planned and created. Its labels were checked with `planExact` before mounting, and it was removed by its exact name through `planExact` and `applyCleanup` after its container was gone.
- **Backup runner containers:** 9 (`aida-test-backup-<run id>-*`) from the targeted runs of this file. The full integration run started the backup runners of every backup file (the ledger lists 15 backup runners for the run id in total).
- **Integration database containers:** 10, one per `pnpm test:integration` invocation, started and stopped by `global-setup.ts`.
- After the last run, `docker ps -a` and `docker volume ls` filtered on `label=aida.test.run=mwdfpj5t-c5620c865f6739e4` list nothing.
- No compose project, image build, pull, port or network was used. Project `aida`, `aida-dev-db` and every other project were not touched. `pnpm test:docker-cleanup --apply` was not run.
- The only `docker compose` command run was `docker compose -p aida-test-shape -f <scratch file> config --format json` and `docker compose run --help` / `config --help`. The first rendered the JSON shape of a scratch compose file outside the repository with no `.env`. All three are read-only and created nothing.

## Files Created/Modified

- `scripts/backup/aida-restore-set.sh`: validation, target checks, database step, uploads step. The header documents the order, settings and exit codes.
- `scripts/backup/lib.sh`: `MEMBER_PATH_RE`, `valid_member_path`, `member_list_ok`, `restore_lock_age`, `restore_lock_break_stale`.
- `scripts/restore.sh`: rewritten wrapper (bash 3.2 compatible; the unit test runs it with `/bin/bash` on macOS).
- `tests/integration/support/backup-runner.ts`: `startRestoreRunner`, `removeTestVolume`, `RESTORE_UPLOADS`, `RESTORE_PAUSE_POINTS`.
- `tests/integration/backup-restore-roundtrip.test.ts`: 21 cases.
- `tests/unit/restore-script.test.ts` (18 cases) and `tests/unit/fixtures/restore/docker` (fake, 100755).
- `docs/OPERATIONS.md`, and the two website operations pages (see U-02 below).

## U-02 contract: files Phase 8.1 plans also touch

- **`docs/OPERATIONS.md`, sections changed:**
  - `## Restore`, rewritten. It covers usage and listing sets, before-you-restore (`APP_ENCRYPTION_KEY`, tenant data, a running backup), the order, and the refusal table. It has these new subsections:
    - `### What a failure leaves behind`: validation 4 and target check 6, database unchanged, uploads unchanged, services started again; database step 7 or a signal, database may be partly restored, uploads untouched, left stopped; uploads step 8 or a signal, database restored, uploads may be partial, left stopped;
    - `### Ownership of the restored files` (U-16; it points to "Upgrading an install whose containers ran as root");
    - `### What the checks prove, and what they do not` (unsigned manifest: integrity, not authenticity);
    - `### A restore lock left behind` (`--break-stale-lock`);
    - `### Notes on pg_restore` (the AuditEvent trigger and the benign pg-boss message, kept).
  - `## Restore to a new server`: steps 2 and 4 to 6 rewritten (a fresh instance with `up -d --build`, the set copied into the backups volume with a tar stream, `restore.sh <setId> --yes`).
  - `## Upgrading`: the rollback example now uses a set id, with a note for releases before set-based backups.
  - `## Troubleshooting`: the "Attachments are missing after a restore" entry is rewritten.
- **Unchanged:** `docker-compose.yml`, `docs/SECURITY.md` and `src/proxy.ts`.
- **Interface for Phase 8.1:** the restore runs in one-off containers of the `backup` service (`user: "1000:1000"`) with `-v <real uploads_data name>:/restore/uploads` and `-e RESTORE_HOLDER`, `-e UPLOADS_DIR`. A Phase 8.1 change to the `backup` service's user, mounts or environment must keep that interface.

## Decisions Made

See `key-decisions` in the frontmatter. In addition:

- The restore's lease TTL is 900 s and is not renewed. Its only job is the P5 handshake with a running backup before anything is stopped. While the restore runs, app and worker are stopped (no deletion), and the backup service is stopped and also blocked by the restore lock.
- Without `--yes`, the confirmation prompt comes before any docker call ("nothing called after the confirmation" holds trivially: nothing is called before it either).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Conflicting tar flags in the extraction**
- **Found during:** Task 1, first run.
- **Issue:** GNU tar 1.34 refuses `--no-overwrite-dir` together with `--keep-old-files` (exit 2), so every restore failed at `archive extraction`.
- **Fix:** dropped `--no-overwrite-dir`. Duplicate members are already refused, and the archive holds no directory members.
- **Commit:** `9a6d50d`.

**2. [Rule 2 - Correctness] Docs outside the plan's file list**
- **Issue:** the website pages `operations/backup-and-restore.md` and `operations/upgrading-and-logs.md`, and the `## Upgrading` rollback example in OPERATIONS.md, documented the removed two-file restore syntax. An operator following them would get a usage error.
- **Fix:** rewritten to the set-based form, as 09-08 mirrored its Backups runbook into the website.
- **Files:** two website pages, not in `files_modified`.
- **Commit:** `2094d3e`.

**3. [Rule 1 - Test bug] Heartbeat-swap cleanup on failure**
- **Found during:** the Task 2 red run.
- **Issue:** after the swap, the lock belongs to the intruder holder, so afterEach could not release it when the case failed.
- **Fix:** the held-lock entry is renamed to the intruder right after the swap.
- **Commit:** `1ce25ea` (fixed before the green run).

**4. [Rule 3 - Blocking] tsc on the new unit test**
- **Issue:** `ProcessEnv` requires `NODE_ENV`.
- **Fix:** added `NODE_ENV: "test"`, as `backup-scheduler.test.ts` does.
- **Commit:** `fb6af52`.

### Additions and precision notes

**5. [Scope addition] Small additions in the scripts**
- lib.sh also gains `member_list_ok`, `restore_lock_age` and `restore_lock_break_stale`, beyond `valid_member_path`.
- The set script has exit 2 for a usage error or an invalid `RESTORE_HEARTBEAT_SECONDS` (the plan lists 0, 3, 4, 6, 7 and 8).
- The lock step also refuses a missing set (exit 4, nothing stopped).
- The integration file has a fifth lock case, "break stale lock", for the in-container logic.

**6. [Precision] Test-only settings in the production script**
- `RESTORE_HEARTBEAT_SECONDS` (default 60) and the pause point `validating` (lib.sh `pause_point`, inert without `BACKUP_TEST_PAUSE_DIR`) live in the production script, like 09-06's backup pause hook. Plan 09-08's compose file sets neither.

**7. [Precision] Root in the test harness**
- Root is used for fixture preparation only: the restore runner's volume root is given to 1000:1000, as a production `uploads_data` takes that ownership from the app image, and `execAsRoot` plants the foreign-owned entry.
- The script under test always runs as 1000:1000.

**8. [Precision] Shared target database**
- The rejection and lock cases share one isolated target database. Each case takes its own before and after inventory.
- The round trips each get a fresh database.

**9. [Precision] Trap placement and release order**
- The trap is installed before the lock step, which is stricter than "then install".
- On success the lease and lock are released before the start, instead of by the trap after it.

---

**Total deviations:** 9 (1 Rule 1 bug, 1 Rule 2 docs, 1 Rule 1 test bug, 1 Rule 3 blocking, 1 scope addition, 4 precision notes). **Impact:** no scope cut. The two website pages are the only files outside `files_modified`.

## Issues Encountered

- The Task 2 behaviour was implemented with Task 1's script, so the Task 2 cases were green on their first run. The red row therefore comes from one mutation per guarantee on a backed-up copy of the script, restored afterwards and checked with `cmp`.

## Stated limits

- **Heartbeat timing:** the background heartbeat signals the main process with USR1, and `sh` runs the trap only after the current foreground command ends (a long `pg_restore` or `cp`). The holder is also re-checked synchronously before each target step. A lock swap during `pg_restore` is therefore noticed after it, with `target-touched=database` recorded, and the wrapper leaves the services stopped.
- **Real compose behaviour:** the wrapper passes the real volume name to `docker compose run -v <name>:/restore/uploads`. The flags were checked with `docker compose run --help` (Compose 5.5.0: `--rm`, `--no-deps`, `-T`, `--entrypoint`, `-e`, `-v`). How Compose resolves a named volume source there was not exercised against a real project (forbidden here).
- **The JSON scanner** in `restore.sh` assumes valid JSON from `docker compose config`. A legacy `docker-compose` without `config --format json` makes the restore refuse with exit 6, and the header says so.
- **A SIGKILLed wrapper** cannot run its trap: the lock stays (use `--break-stale-lock` after 900 s), and the services may stay stopped.
- **`restore_lock_release` is not atomic** (09-13 limit). Only the holder releases it, and no automatic takeover exists.

## Not run

- **Isolated-stack restore (AIDA-33 stack clause):** not run (waiting for the Phase 8.1 harness and the owner, U-15). It is specified by 09-11. This plan claims the component round trip only.
- **`scripts/restore.sh` against a real compose project:** not run. The run rules forbid it, so the wrapper was tested only on the fake docker.
- **`shellcheck`:** not run (not installed on this host).
- **Phase gate suites:** `pnpm test:egress`, `pnpm test:e2e`, `pnpm build` and `pnpm audit --prod` were not run. They are outside this plan's verify and belong to the phase gate.

## Threat Flags

None beyond the plan's register.
- T-09-31r, T-09-32, T-09-35a, T-09-35c and T-09-35d are mitigated as specified and covered by the cases above.
- T-09-32a is accepted and documented in "What the checks prove, and what they do not".
- One new output: on a database-step failure, the set script prints at most 20 `pg_restore: error:` lines on stderr (object names and SQL statements of the schema, no row data). The v1 script printed all of its output.

## User Setup Required

None.

## Next Phase Readiness

- **09-11:** the isolated-stack restore proof can drive `scripts/restore.sh <setId> --yes` on the Phase 8.1 harness. Exit codes and outcome rules are in the script header and in OPERATIONS.md, Restore.
- **09-12:** the installer can wrap `restore.sh <setId> [--yes]` and `--break-stale-lock <holder>` unchanged.

---
*Phase: 09-operations*
*Completed: 2026-11-12*

## Self-Check: PASSED

- All four created files exist.
- Commits `9a6d50d`, `1ce25ea`, `0b8ac97`, `2094d3e` and `fb6af52` are in the log, and `git rev-list --count 3cfedd5..HEAD` is 5 before this SUMMARY commit.
- No home path or personal name appears in the changed tracked files (`grep` exit 1).
- `STATE.md` and `ROADMAP.md` are untouched.
