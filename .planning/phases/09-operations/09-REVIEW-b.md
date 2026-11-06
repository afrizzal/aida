---
phase: 09-operations
part: b (single deletion queue, backup fence, backup core)
reviewed: 2026-11-12T12:00:00Z
depth: standard
diff_range: b511b3b..HEAD
files_reviewed: 10
files_reviewed_list:
  - src/lib/attachments/local-file-storage.ts
  - src/lib/attachments/staged-files.ts
  - src/lib/projects/file-cleanup.ts
  - src/lib/storage/file-fence.ts
  - src/lib/storage/uploads-volume.ts
  - src/lib/worker/jobs/project-file-cleanup.ts
  - src/lib/backup/status.ts
  - scripts/backup/aida-backup.sh
  - scripts/backup/lib.sh
  - scripts/backup/scheduler.sh
coverage_note: "All 10 files were read in full, and the diffs of the six TypeScript files that existed at b511b3b were checked against it. The four new files (file-fence.ts, uploads-volume.ts, status.ts, the scripts) are new in the range. For context only, these were also read: the 09-CONTEXT update section (U-01 to U-18), the 09-04, 09-06 and 09-13 SUMMARYs, PIAGAM 'Aturan teknis AIDA', the storageKey columns and the Setting model in prisma/schema.prisma, the logo store's enqueue calls, deleteTaskAttachment in src/lib/projects/attachments.ts, buildStorageKey, the backup service block of docker-compose.yml, member_list_ok in aida-restore-set.sh, and the detection logic of tests/unit/file-delete-callers.test.ts. The other listed tests were judged from the SUMMARYs' mutation (red) tables and from what their harness can and cannot simulate. They were not read line by line, because the context budget was tight. No test, build or container was run. Postgres lock-manager behaviour (a waiting exclusive request makes pg_try_advisory_lock_shared return false) and psql 16 SHELL_EXIT_CODE come from the server and client source and docs, not from a live run."
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 9: Code Review Report (part b, single deletion queue, backup fence, backup core)

**Reviewed:** 2026-11-12
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

I found no blocker. I traced every interleaving I could build in which a file that a committed row references is deleted while a backup archives, or in which a set publishes with a referenced file missing. Each one is stopped by one of three things: the fence (the shared lock is held until every tracked delete settles, and a waiting exclusive request starves new shared requests), the lease, or the dump-to-archive verification. Verification alone already ensures that a published set never lacks a key that its dump references. That holds because the archive is taken after the dump and keys are immutable. The fence and the lease only keep backups from failing. Limit L1 is real, but verification covers it.

I found no shell injection. Organization ids and keys only reach `find`, `tar -T --verbatim-files-from` and `comm` after a strict pattern. psql values go through `-v` with `:'var'` quoting. The `\!` path of `fenced_action` is restricted to `[A-Za-z0-9._/-]`. Retention removes only names that pass `valid_set_id`, never the current run's set and never `.restore-*`. The status record has exactly four keys, and no raw error text reaches stdout.

The five warnings are about liveness and diagnosability, not consistency:

- the lease renewal proves only that the renewal loop is alive, not that the run is making progress (b-WR-1);
- a single transient renewal error aborts the run and leaves no record anywhere (b-WR-2);
- a permanent verification failure cannot be diagnosed (b-WR-3);
- a hung delete leaks one fence connection per minute (b-WR-4);
- nothing in the backup has a connect or run timeout (b-WR-5).

**Can the tests fail for what they claim?** Mostly yes. The SUMMARYs record a red run for each guarantee, and the mutations target the right lines: the lease predicate, the lock result, `track()`, the marker comparison, `wx`, `fenced_action` ownership and the restore-lock checks. There are three gaps:

- (a) The crash case kills the whole container (`docker kill`). That also kills the renewal loop, so no test can detect b-WR-1's orphaned renewal.
- (b) `tests/unit/file-delete-callers.test.ts` recognises a FileStorage receiver only by the names `storage` and `localFileStorage` or by a `: FileStorage` annotation. A delete through an alias passes it (b-IN-4).
- (c) No case drops the fence session in the window between `fence_open` and `lease_acquire`. That window is harmless only because verification catches it (b-IN-6).

## Warnings

### b-WR-1: The lease renewal outlives a dead or hung run, so deletion and backups stay blocked indefinitely

**File:** `scripts/backup/aida-backup.sh:200-216` (started at `:361`)
**Issue:** `renew_loop` renews the lease every TTL/3 for as long as `lease_renew` returns 1. It never checks whether the main shell is alive or making progress. The main PID is used only to send USR1 on failure (`:212`). D-02(5) and U-12 require that an expired lease never blocks deletion forever. But this lease never expires while the loop runs.
**Failure scenarios:**
1. The kernel OOM killer, or an operator's `kill -9`, ends only the backup `sh`, not the container. The background loop is reparented to the scheduler, which is PID 1, and it keeps renewing `backup:lease` every 300 s with no end. Every sweep then logs `sweep skipped: backup-lease`, so no stored file is ever deleted. Every later scheduled run exits 3 with `backup skipped: lease held`, and the scheduler logs that as a skip, not as a failure. The admin page keeps showing the last success.
2. `pg_dump` or `tar` hangs, for example on a stalled backups volume or a paused `db` container (see b-WR-5). The main shell waits forever while the loop keeps the lease alive. The result is the same: no deletions and no backups, until someone restarts the container.

The crash test (`backup-consistency.test.ts`, "crash") kills the whole container, so it cannot catch either scenario.
**Fix:** make each renewal depend on the run being alive, and cap the run's total time:
```sh
renew_loop() {
  _rl_deadline=$(( $(date -u +%s) + BACKUP_MAX_RUN_SECONDS ))   # e.g. default 6 h, validated
  ...
  while :; do
    sleep "$_rl_interval" & _rl_sleep=$!; wait "$_rl_sleep" || :
    kill -0 "$MAIN_PID" 2>/dev/null || exit 0               # main shell gone: let the lease expire
    [ "$(date -u +%s)" -lt "$_rl_deadline" ] || { : >"$RUN_TMP/lease.lost"; kill -s USR1 "$MAIN_PID"; exit 0; }
    ...
  done
}
```
Add a test that kills only the script's PID inside the runner container (`exec kill -9 <pid>`). It should assert that the lease expires within one TTL and that the next sweep deletes.

### b-WR-2: One transient renewal error aborts the run as "lease lost" and leaves no record

**File:** `scripts/backup/aida-backup.sh:209-213`, `:108`, `:163-170`
**Issue:** `_rl_count=$(lease_renew ...) || _rl_count=error` treats any psql failure the same as "0 rows renewed". A connection refused for one second during a database restart, or a `max_connections` spike, therefore aborts the whole run. `on_lease_lost` sets `LEASE_LOST=1`. `on_exit` (`:108`) then skips both the status write and `status_unrecorded`, so the run leaves no `backup:lastRun` change, no `AIDA_BACKUP_STATUS_UNRECORDED` line and no per-set file. The only trace is `backup failed: unknown` in the container log. The lease row is in fact still owned, and the trap releases it.
**Failure scenario:** The operator upgrades `db`, or Postgres restarts on its own, during the nightly backup. The renewal attempt in that window fails, and the run aborts after the dump. Settings keeps showing the previous night's success as the "last run", and the operator is never told that a night was missed. If it happens every night (for example, a nightly maintenance restart at the same time), backups silently stop.
**Fix:** retry a renewal error at short intervals until about TTL/3 before expiry. Treat only a confirmed `0` (or running out of time) as lost:
```sh
_rl_count=$(lease_renew "$SET_ID" "$BACKUP_LEASE_TTL_SECONDS") || _rl_count=error
if [ "$_rl_count" = error ] && [ "$_rl_retries" -lt 5 ]; then _rl_retries=$((_rl_retries+1)); sleep 5; continue; fi
```
Also let a run that lost its lease write the per-set `status-unrecorded-<setId>.json` file. That needs no database and cannot conflict with another holder's `backup:lastRun`.

### b-WR-3: A permanent verification failure cannot be diagnosed

**File:** `scripts/backup/aida-backup.sh:436-441`; `scripts/backup/lib.sh:79-82`
**Issue:** When a referenced key is missing, the run logs only the count (`verification: N referenced files missing from the archive`). `missing.list` and `errors.log` are deleted with `RUN_TMP` by the exit trap. Several causes outside the backup can leave a committed row without its file:
- `discard()` after a transaction whose COMMIT succeeded on the server, while the client saw an error such as a connection drop or a timeout race (`staged-files.ts` callers);
- a disk error;
- an operator's manual clean-up;
- a pre-Phase-9 bug.

From then on, every backup fails with category `verification`, and the page shows the fixed sentence "A file referenced by the database was missing from the archive." The operator cannot find out which file or which row is affected.
**Failure scenario:** One attachment's file disappears. From that night on, no backup ever publishes again. The operator sees the same sentence every day and has no supported way to find the row. The only remedy left is to restore an older set, which is itself ageing out under retention.
**Fix:** log the missing members, which are storage keys and organization ids. The sweep already logs keys (`file-cleanup.ts:128`), so this is consistent with existing practice. Cap the output, for example `head -n 20 "$RUN_TMP/missing.list" | sed 's/^/[backup] missing: /'`. Document in `docs/OPERATIONS.md` how to find and resolve the row. Optionally, write `missing-<setId>.txt` to the backups volume.

### b-WR-4: A hung delete leaks one fence connection and its shared lock per sweep run

**File:** `src/lib/storage/file-fence.ts:190-219`, `:244`; `src/lib/projects/file-cleanup.ts:190-195`
**Issue:** `close()` keeps the fence's `pg.Client` open until every tracked delete settles. The job returns at once, and pg-boss starts the next run a minute later. That run opens a new client (`new pg.Client` per `open()`), outside `DB_POOL_MAX`. If unlinks on the uploads volume hang, each run's first delete hangs too, and its client never ends. Examples of a hang: a stalled FUSE or network mount, or a failing disk in uninterruptible sleep. The 09-04 SUMMARY says such a hang "blocks only the backup's fence wait". It does not account for the accumulation.
**Failure scenario:** The uploads volume stalls for two hours. About 120 `aida-delete-fence` sessions build up, each idle with a shared advisory lock. Postgres reaches `max_connections` (100 by default), and the app, the worker pool and Better Auth start failing with "too many clients". The outage now extends well beyond file deletion.
**Fix:** allow at most one fence handle per process. Keep a module-level `inFlight` handle, and while its `closed` has not resolved, have `open()` return `{ refused: "fence-unavailable" }` (or a new reason, `"delete-pending"`) without connecting. Also set `connectionTimeoutMillis` and a `statement_timeout` on the fence client, so that `connect()` or the lease select cannot hang either.

### b-WR-5: No connect timeout and no run deadline in the backup: one hung psql call stops all future backups

**File:** `scripts/backup/lib.sh:79-82` (`psql_q`), `:193-198` (fence session); `scripts/backup/aida-backup.sh:374-376` (`pg_dump`); `scripts/backup/scheduler.sh` (main loop, `wait "$CHILD"`)
**Issue:** No `PGCONNECT_TIMEOUT` is set, either in the scripts or in the compose block of the `backup` service, so libpq waits on a TCP connect with no limit. `pg_dump --lock-wait-timeout` only bounds lock acquisition. The scheduler waits on its child with no limit, and only then computes the next run. Neither the script nor the scheduler limits how long one run may take.
**Failure scenario:** At 02:00 the `db` container is paused (`docker pause`, or a VM freeze on a shared host), or packets to it are dropped. The first call, `lease_active` (`aida-backup.sh:329`), blocks forever. Nothing is logged after `next backup in …s`. No status is recorded, because the run never reaches its exit trap. The scheduler never schedules another run, even after the database is back. The same applies to a `pg_dump` that hangs mid-stream. In that case the renewal loop also keeps the lease alive (b-WR-1), so deletions stop as well.
**Fix:** export `PGCONNECT_TIMEOUT=10` in `aida-backup.sh`, next to the other defaults. In the scheduler, run the child under a deadline. A watchdog subshell can send TERM to `$CHILD` after `BACKUP_MAX_RUN_SECONDS` and KILL a grace period later. b-WR-1's check `kill -0 "$MAIN_PID"` then also lets the lease expire. Optionally, set `statement_timeout` in the `psql_q` sessions, though not in the fence session.

## Info

### b-IN-1: The backup accepts an organization directory that starts with `-`, and the restore rejects it

**File:** `scripts/backup/lib.sh:36-37` (find pattern), `scripts/backup/aida-backup.sh:421` (member check); `scripts/backup/lib.sh:431` (`member_list_ok`, used by `aida-restore-set.sh:299`)
**Issue:** `MEMBER_FIND_RE` and the post-archive check allow `[A-Za-z0-9_-]{1,64}` as the first path segment, so `-abc/<key>` is archived and the set publishes. The 09-06 SUMMARY even adds `--verbatim-files-from` for that case. But `member_list_ok` refuses any member starting with `-`, and so does the comment at `lib.sh:411` ("The organization part never starts with '-'"). Better Auth's default ids are alphanumeric, so this is latent today. If an id format with a leading dash ever appears (custom `generateId`, an import, the seed), every set published from then on is valid by the backup's own checks and unrestorable.
**Fix:** use one pattern for both sides. Reject (or count as skipped) a leading `-` in `MEMBER_FIND_RE` and `MEMBER_DIR_FIND_RE`, for example `\./[A-Za-z0-9_][A-Za-z0-9_-]{0,63}`, and use the same pattern at `aida-backup.sh:421`. Then the backup fails verification instead of publishing a set that restore will refuse.

### b-IN-2: Failed retention or a lost lease after publish reports a failed run although a valid set was published

**File:** `scripts/backup/aida-backup.sh:490-519`
**Issue:** USR1 (lease lost) can arrive while `fenced_action` publishes. The trap is deferred until psql returns, which means after the `mv` has committed. Then `on_lease_lost` exits with `PUBLISHED=0` and `OUTCOME=failed`, and the run logs `backup failed: unknown` although `<setId>` is complete in `BACKUP_DIR`. Retention and the status write are skipped. This is harmless for consistency, but the log contradicts what is on the volume.
**Fix:** in `on_lease_lost`, set `PUBLISHED=1` when `[ -d "$SET_FINAL" ] && [ ! -e "$SET_TMP" ]`, and log `backup published: <setId>; lease lost before status`.

### b-IN-3: Retention orders by name only, so a set dated by a fast clock is never pruned

**File:** `scripts/backup/lib.sh:442-482`
**Issue:** The order "newest by name" equals time order only while the container clock never runs ahead. A set made while the clock was days ahead stays among the `keep` newest forever. The current run is always kept, so the newest good set is never lost, but the effective retention shrinks by one for every such set. Any directory with a valid name also counts as a set, even one without a `manifest.json`, for example an operator's partial copy back from off-host storage.
**Fix:** count only directories that contain a readable `manifest.json` whose `setId` equals the directory name. Optionally, ignore (and log) set ids more than a day ahead of `date -u`.

### b-IN-4: The static inventory test misses deletes through an alias

**File:** `tests/unit/file-delete-callers.test.ts:55-67`, `:89-90`
**Issue:** A `.delete(` call counts only when its receiver is named `storage` or `localFileStorage`, or is a parameter annotated `: FileStorage`. Each of these patterns would pass the test while adding an unfenced delete of a possibly referenced file:
- `const files = localFileStorage; files.delete(...)`;
- a `FileStorage` passed through an inferred object field (`deps.fileStore.delete`);
- `import { unlink as remove } from "node:fs/promises"`.

The test does fail for the mutation it records: a direct `localFileStorage.delete` in `ingest-message.ts`.
**Fix:** also flag any import of `localFileStorage` outside an allow-list, and any import of `unlink`, `rm` or `rmdir` from `node:fs` or `node:fs/promises` (aliased or not) outside `local-file-storage.ts`.

### b-IN-5: The deleter does not check the restore lock, and the backup does not check the mount point

**File:** `src/lib/storage/file-fence.ts:221-276`; `scripts/backup/lib.sh:165-174`
**Issue:** Each side checks a different subset of the identity. The deleter requires a mount point plus the marker. The backup requires only the marker. Neither is a data-loss path: the backup only reads, and during a restore the lease fences the sweep. But a backup started against a bind of the wrong directory that has a copied marker would archive the wrong tree, and only verification would catch it.
**Fix:** optionally check `mountpoint -q "$UPLOADS_DIR"` (util-linux) or compare `stat -c %d` of the directory and its parent in `uploads_identity_ok`, matching `isMountPoint`.

### b-IN-6: The window between `fence_open` and `lease_acquire` is covered only by verification

**File:** `scripts/backup/aida-backup.sh:341-357`
**Issue:** If the fence session drops after the exclusive lock is granted, but before `lease_acquire` commits, a sweep can open in between. It finds no exclusive holder and no lease, and its select can then pick up a key that is dereferenced after the dump snapshot. That file is deleted before the archive is taken. Verification fails the set, so nothing wrong is published. The night's backup is lost, and the next check, `fence_alive` at publish, comes too late to explain why. No test covers this window.
**Fix:** call `fence_alive` immediately after `lease_acquire`. On false, abort with `file fence unavailable` before the dump, so the run fails early and with a clear line rather than later as a `verification` failure.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
