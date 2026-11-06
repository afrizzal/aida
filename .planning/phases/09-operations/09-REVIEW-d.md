---
phase: 09-operations
part: d (compose services, restore, installer, operator docs)
reviewed: 2026-11-12T13:00:00Z
depth: standard
diff_range: b511b3b..HEAD
files_reviewed: 13
files_reviewed_list:
  - docker-compose.yml
  - .gitignore
  - docs/OPERATIONS.md
  - docs/SECURITY.md
  - scripts/backup.sh
  - scripts/backup/aida-restore-set.sh
  - scripts/restore.sh
  - scripts/install.sh
  - website/src/content/docs/configuration/environment.md
  - website/src/content/docs/getting-started/demo-mode.md
  - website/src/content/docs/operations/backup-and-restore.md
  - website/src/content/docs/operations/upgrading-and-logs.md
  - tests/unit/restore-script.test.ts
coverage_note: "Static review only: no script, Docker, Testcontainers, E2E or build command was run. docker-compose.yml, scripts/backup.sh, scripts/backup/aida-restore-set.sh, scripts/restore.sh and scripts/install.sh were read in full and diffed against b511b3b. docs/OPERATIONS.md and the four website pages were checked through their added lines (every command an operator is told to run, plus the Restore, Restore to a new server and Upgrading sections), not paragraph by paragraph. lib.sh was read only where the restore scripts call it. Of the tests, restore-script.test.ts and its fake docker were read for the calls they pin; compose-backup.test.ts, install-script.test.ts, compose-backup-config.test.ts, backup-restore-roundtrip.test.ts and the installer egress inventory were checked for what they assert (from the plan SUMMARYs and targeted greps), not case by case. Known open items not re-reported: docs/SECURITY.md line 8 and the advisory list (08-o4), no checksum on the installer archive (stated residual), and the stack proofs SP-1 to SP-3 (U-15)."
findings:
  critical: 1
  warning: 4
  info: 5
  total: 10
status: issues_found
---

# Phase 9: Code Review Report (part d, compose services, restore, installer, operator docs)

**Reviewed:** 2026-11-12
**Depth:** standard (see coverage note)
**Files Reviewed:** 13
**Status:** issues_found

## Summary

The privilege model matches U-16:
- `backup-init` is the only root step. It runs with `CAP_CHOWN` only, no network, a read-only root filesystem and `no-new-privileges`, and it touches only the `/backups` mount point, never recursively.
- `backup` runs as `1000:1000` and mounts `uploads_data` read-only. Only the restore's one-off container gets `uploads_data` read-write, at `/restore/uploads`.
- Every new compose variable has a default, so an install that sets none of them renders as before.

The installer is sound on the points asked about:
- its only network call is HTTPS-only `curl --proto =https --proto-redir =https` of the tagged archive;
- every input is validated before use, and every expansion is quoted;
- `.env` is written to a 0600 temp file and renamed into place, and existing keys are never overwritten.

The restore set script validates the whole set before it writes anything, and it gates each target step on the restore lock. Member names, member types, the checksums and the target's ownership are all checked, so the archive cannot be extracted outside the target.

The main defect is in how the database is restored. `pg_restore --clean` drops only the objects in the dump, and the wrapper then restarts the services with `compose start`, which does not run `migrate`. When the target database is at a newer migration than the set, the restore either fails halfway, or succeeds with a schema older than the code (d-CR-1). The docs point operators straight at this case twice: the upgrade rollback, and "Restore to a new server" at "the release that made the set (or a later one)". No test restores into a database whose schema differs from the dump, so the suite cannot catch it (d-WR-4).

## Critical Issues

### d-CR-1: Restoring a set into a database at a newer schema leaves a half-dropped database or code running on an older schema, and the docs send operators there

**File:** `scripts/backup/aida-restore-set.sh:363-376`, `scripts/restore.sh:176-181`, `:312-315`; `docs/OPERATIONS.md:215` (step 2 of "Restore to a new server"), the `## Upgrading` rollback block (`./scripts/restore.sh <pre-upgrade-setId> --yes`); the same text in `website/src/content/docs/operations/backup-and-restore.md` and `upgrading-and-logs.md`
**Issue:** The database step runs `pg_restore --clean --if-exists` straight into the live target database. `--clean` drops only the objects that are in the dump, and the target schema is not reset first. On success, `restore.sh` calls `$COMPOSE start backup app worker`. `start` only restarts the existing containers: the one-shot `migrate` (`prisma migrate deploy`) does not run again. There is also no check of the manifest's app version against the running release. The docs invite the mismatch twice:
- "Restore to a new server" says to clone "at the release that made the set (or a later one)". The fresh `up -d --build` then migrates the empty database to the later release's head before the restore.
- The Upgrading rollback restores the pre-upgrade set into a database that the new release has already migrated.

**Failure scenarios:**
1. The newer release added a table with a foreign key to an existing table, for example a table that references `"Organization"` (most tenant tables do). `pg_restore --clean` issues `DROP TABLE IF EXISTS "Organization"`, which fails with "cannot drop table ... because other objects depend on it", because the referencing constraint is not in the dump. That error is not the benign pg-boss message, so the step exits 7. By then pg_restore has already dropped every other object it could, and the operator has a partly dropped production database with every service stopped. Running the restore again hits the same error, and the docs offer no other way out.
2. The newer release only added a column. `--clean` drops the table and recreates it from the old dump, and `_prisma_migrations` comes back as the old list. The restore prints "Done", and `start` brings the newer `app` and `worker` up on the older schema without running `migrate`. Every query that touches the new column fails at runtime.

**Fix:**
- Reset the target before the restore, after `target-touched=database` is recorded:
  ```sh
  psql_q -c 'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;' ||
    fail_database 'could not reset the target schema'
  pg_restore --no-owner --no-privileges --exit-on-error --dbname="$PGDATABASE" "$SET_DIR/db.dump"
  ```
  The alternative is to drop and recreate the database through the `postgres` maintenance database. Either way, the benign-message filter is then no longer needed.
- In `restore.sh`, replace the success-path `start backup app worker` with `$COMPOSE up -d`. That runs `migrate`, so an older set is brought up to the code's schema.
- In validation, refuse a set whose manifest app version is newer than `/opt/aida-backup-meta/package.json`, because migrations cannot go backwards.
- Correct the docs. A new server must run the set's release or a later one, and the restore then migrates forward. A rollback must check out the old tag before it restores. Say that a rollback database is restored onto a reset schema.
- Add an integration case that restores a set into a database with one extra migration applied: an extra table with a FK to `"Organization"`, and an extra column.

## Warnings

### d-WR-1: The wrapper's trap can start the services while the restore container is still running

**File:** `scripts/restore.sh:197-216`, `:299-305`; `scripts/backup/aida-restore-set.sh:357-364`
**Issue:** On INT, TERM or HUP, `on_exit` sends TERM to `SET_PID`, waits for it, reads `target-touched`, releases the lock, and starts `backup app worker` when nothing was recorded as touched. `SET_PID` is the local `docker compose run` client, not the container. The script's correctness rests on the client stopping the container before it exits. Nothing checks that the one-off container is gone: it has no `--name` and is not stopped by name. The set script checks `holder_ok` immediately before it writes `target-touched=database` and starts `pg_restore`.

**Failure scenario:** the operator's SSH session drops (HUP) while validation is finishing. The compose client exits, but the container keeps running, for example because the client was killed before it could forward the signal, or because the daemon connection was lost. The order of events is then:
1. the set script's `holder_ok` passes;
2. the wrapper reads an empty `target-touched`;
3. the set script writes `database` and starts `pg_restore --clean`;
4. the wrapper releases the lock and starts `app` and `worker`.

The database is then dropped and reloaded under a live app. The heartbeat notices the lost lock only after `pg_restore` ends (stated limit in 09-10). The case "TERM while the set script hangs after target-touched" covers only the order in which `target-touched` is already written.
**Fix:**
- Run the one-off container under a known name: `--name aida-restore-$HOLDER`, or a label.
- In `on_exit`, after the client exits, run `docker stop -t 30` and then `docker wait` on that container before reading `target-touched`.
- If the container cannot be confirmed gone, treat the state as touched and leave the services stopped.

### d-WR-2: Legacy `COMPOSE_CMD="docker-compose"` is still advertised, but the compose file now needs Compose v2

**File:** `scripts/backup.sh:19-20`, `:28`; `docs/OPERATIONS.md` (Backups, `COMPOSE_CMD="docker-compose" ./scripts/backup.sh`); `docker-compose.yml:42`, `:65`, `:123`
**Issue:** `DATABASE_URL: ${AIDA_DATABASE_URL:-postgresql://${POSTGRES_USER:-aida}:...}` nests an interpolation inside a default value, which Compose v1 (`docker-compose` 1.x) does not support. `restore.sh` also needs `config --format json`, which v1 lacks; its header says so, but the backup docs do not.
**Failure scenario:** an operator on a host with only the legacy binary follows the documented `COMPOSE_CMD="docker-compose" ./scripts/backup.sh`. The run fails at config parsing ("Invalid interpolation format"), or, depending on the version, renders a wrong `DATABASE_URL`. After the upgrade, `docker-compose up` breaks for the same reason.
**Fix:** state a minimum Docker Compose v2 version in OPERATIONS.md and the README, and remove the legacy `COMPOSE_CMD` lines from `backup.sh` and the docs. Otherwise, mark them as unsupported for this release.

### d-WR-3: The documented off-host copy writes tenant data with the host's default umask

**File:** `docs/OPERATIONS.md` ("Copying backups off the host": `docker compose run ... tar ... -cf - <setId> > aida-backup-<setId>.tar`); `website/src/content/docs/operations/backup-and-restore.md` (same line)
**Issue:** inside the volume, a set is protected by mode 0700 (U-16). The documented copy creates the tar on the host through a shell redirect, with the operator's umask, which is usually 022.
**Failure scenario:** on a shared VM, or a host with other local accounts or service users, the full database dump and every attachment sit in a 0644 file in the working directory, readable by every local user. The privacy-first rule in `CLAUDE.md` is broken by following the docs.
**Fix:**
```bash
(umask 077 && docker compose run --rm --no-deps -T --entrypoint tar backup -C /backups -cf - <setId> > aida-backup-<setId>.tar)
```
Add one sentence that the file holds tenant data and must be stored encrypted or on access-controlled storage.

### d-WR-4: No restore test can fail for a schema mismatch, and the real compose path of the wrapper is untested

**File:** `tests/integration/backup-restore-roundtrip.test.ts` (round trips "each get a fresh database"; the rejection cases share one target at the same schema); `tests/unit/restore-script.test.ts:111`; `tests/unit/fixtures/restore/docker`
**Issue:**
- Every database restore in the suite goes into a database built from the same migrations as the dump. d-CR-1 therefore passes every case.
- The wrapper's tests use a fake docker that matches exact argument strings (`SET_CALL`, the volume names from a canned `config --format json`). They prove which calls are made and in what order, but not what Compose does with them. Three behaviours are untested:
  - that `run -v aida_uploads_data:/restore/uploads` mounts the existing project volume (Compose may treat an undeclared volume name differently);
  - that `start` restarts the services correctly;
  - that killing the client stops the container (d-WR-1).

The 09-10 SUMMARY states the compose limit. The suite still counts D6 as covering "missing volume" and "TERM after target-touched", and neither can show the real-compose failure. The compose unit tests are text pins, and `backup-init`'s `stat`, `chmod` and `chown` are never executed (stated in 09-08).
**Fix:**
- Add the schema-mismatch integration case from d-CR-1.
- Add to SP-2 in `09-STACK-PROOFS.md`:
  - a restore into stack B after B has migrated one release ahead;
  - a check that `restore.sh` mounted B's own uploads volume (marker equals the restored identity);
  - a HUP during validation that leaves no container running and does not start the services early.

## Info

### d-IN-1: `backup` has none of `backup-init`'s hardening and keeps full outbound network

**File:** `docker-compose.yml:184-225`
**Issue:** `backup` drops no capabilities, sets no `no-new-privileges` and does not use a read-only root filesystem. It sits on the default network with the same outbound reach as `app`, although it only talks libpq to `db`. U-16 asks only for the numeric user, so this is not a violation.
**Fix:** add `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]` and `read_only: true`, with a tmpfs for `/tmp` because the scripts call `mktemp`. Record in SECURITY.md that `backup` makes no egress beyond `db`, or put it on an internal network with `db`.

### d-IN-2: `upgrade` overwrites local edits to shipped files with no notice, and does not take the backup it recommends

**File:** `scripts/install.sh:334-341`
**Issue:** `cp -R "$STAGE/." "$DIR/"` silently replaces an operator-edited `Caddyfile` or `docker-compose.yml`. The "Take a backup first" line is printed, and then the upgrade continues at once.
**Fix:** before the copy, list the tracked files that differ from the new release, or keep a copy under `.aida-previous/`. Either run `scripts/backup.sh` first or require `--no-backup` to skip it.

### d-IN-3: `backup-init` cannot repair a mode drift on a 1000-owned mount point

**File:** `docker-compose.yml:156-160`
**Issue:** without `CAP_FOWNER`, root cannot `chmod` a directory that 1000 owns, so `backup-init` exits 1, and `docker compose up` then fails on the `service_completed_successfully` dependency. OPERATIONS.md documents the fix by hand. A cleaner order exists: when the owner is already `1000:1000`, skip `chmod`, because the `backup` service can fix its own directory's mode.
**Fix:** when `stat` reports owner `1000:1000` with another mode, print the documented one-line fix. Or set the mode in `aida-backup.sh` and `scheduler.sh` at start, since they run as the owner.

### d-IN-4: The bind-mounted script directory depends on the host sharing the install path

**File:** `docker-compose.yml:213-215`
**Issue:** `backup` runs `./scripts/backup` and `./package.json` from bind mounts. On Docker Desktop or Colima with an install outside the shared paths, the mount is empty and `scheduler.sh` is not found. The `restart: unless-stopped` service then restarts in a loop, and the Backups tab shows no run. The `.gitignore` comment notes the Colima limit for tests only.
**Fix:** add one troubleshooting line to OPERATIONS.md, or have `backup.sh` fail early when `/opt/aida-backup/aida-backup.sh` is missing in the container.

### d-IN-5: `backup.sh` exit code 1 is ambiguous

**File:** `scripts/backup.sh:15-17`, `:65`
**Issue:** the header says that exit 1 means "the preflight failed and nothing ran". `docker compose run` also returns 1, or 125 to 127, for its own failures, and the script passes these through as the backup's exit code. The installer's `backup` wraps the script and inherits the same ambiguity.
**Fix:** map any exit code other than 0, 2, 3 or 5 from `docker compose run` to one fixed code (for example 1), with the message "the backup container could not run", and document it.

---

_Reviewed: 2026-11-12T13:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
