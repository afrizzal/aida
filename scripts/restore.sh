#!/usr/bin/env bash
# scripts/restore.sh: restore one AIDA backup set (Phase 9 plan 09-10, AIDA-33; D-05, reviews P5
# and Q3). See docs/OPERATIONS.md, Restore.
#
# THIS IS DESTRUCTIVE. It replaces the whole current database and every stored file with the
# contents of one set from the backups_data volume. There is no undo other than restoring another
# set.
#
# Usage:
#   ./scripts/restore.sh <setId> [--yes]          restore the set BACKUP_DIR/<setId>
#   ./scripts/restore.sh <setId> --validate-only  check the whole set and its migrations against
#                                                 this release, write nothing and stop nothing
#                                                 (K149)
#   ./scripts/restore.sh --break-stale-lock <holder>
#                                                 remove a restore lock left by a restore that is
#                                                 no longer running (its heartbeat is older than
#                                                 900 s and the holder matches)
#
#   --yes  skip the interactive confirmation (type `restore` to continue)
#
# Order of a restore:
#   1. the set id is checked and, without --yes, the operator confirms;
#   2. the real names of the uploads_data and backups_data volumes come from
#      `docker compose config --format json` and each is checked with `docker volume inspect`
#      (missing: exit 6, nothing stopped);
#   3. a one-off container of the `backup` service takes the restore lock on the backups volume
#      (random holder restore-<32 hex> from lib.sh new_restore_holder; held: exit 3, with the
#      holder and the heartbeat age). The lock is a directory on the backups volume, not a write
#      to the database;
#   4. a one-off `backup` container runs `aida-restore-set.sh --check-schema` (read only, K142,
#      K150, K152) with this checkout's prisma/migrations names in RESTORE_RELEASE_MIGRATIONS: a
#      set with a migration this release lacks, a target database that is neither truly empty nor
#      at exactly the set's migrations: exit 9, nothing stopped or changed. Nothing has been
#      written to the target database before this check;
#   5. the backup lease with the same holder, only when the check found a target with a migration
#      history (a running backup: the lock is released, exit 3, nothing stopped). A truly empty
#      target has no SystemSetting table, so no backup can hold or take a lease on it, and the
#      restore lock alone keeps every backup out (aida-backup.sh skips while the lock exists, and
#      its fenced actions refuse under it); the restore writes nothing to it before step 7 (K152);
#   6. `docker compose stop backup app worker`;
#   7. scripts/backup/aida-restore-set.sh runs in a one-off `backup` container as 1000:1000 with
#      the uploads volume mounted read-write at /restore/uploads. It validates the whole set before
#      it writes anything, and writes `.restore-lock/target-touched` (`database`, then `uploads`)
#      immediately before its first write to each target;
#   8. on success, when the set is older than this release (step 4 said so): the database
#      replacement removed the lease row the dump carried (only that row, or this restore's own:
#      Codex r3-5), so the lease is taken again with the same holder on
#      the restored database, and the release's one-shot `migrate` service runs `prisma migrate
#      deploy` while the restore lock and the lease are held (K150, K154). On a failure (or a
#      signal, which bash handles once the foreground migrate call has returned) nothing is
#      started, exit 1, and the trap releases the lease and the lock only after that call;
#   9. then the lease (when held) and the lock are released, backup, app and worker are started,
#      and the app's probe is polled for up to 60 s (a warning only).
#
# With --validate-only (K149, K152) it takes the restore lock only, runs the set script with
# --validate-only (the whole set and the release check), releases the lock and exits with the set
# script's code. It writes nothing to the database (no lease: the restore lock alone keeps every
# backup out, as in step 5) and nothing to the uploads volume; on the backups volume it writes only
# the lock directory and the set script's staging directory, and removes both. Nothing is stopped
# or started, and no confirmation is asked.
#
# Run it from the checkout of the running release: the release's migrations are read from this
# checkout's prisma/migrations, and compose builds app, worker and migrate from it.
#
# One trap on EXIT, INT, TERM and HUP decides every other outcome. Once the set script was
# started, it first stops and removes its one-off container by its exact name (aida-<holder>) and
# waits until `docker ps -a` no longer lists it (RESTORE_CONTAINER_WAIT_SECONDS, default 60); if
# it is still listed, the lock is kept and nothing is started (d-WR-1). Otherwise it releases this
# restore's own lease and lock. After a failure before `target-touched` exists nothing was
# changed, so it starts backup, app and worker again. Once `target-touched` exists (a failure or a
# signal in the database or uploads step) it leaves them stopped and says which step failed and
# where to read on. It never removes a volume and never runs `down`.
#
# Exit codes: 0 restored; 1 aborted or another error; 2 usage; 3 a restore lock or a running
# backup refused the restore (or --break-stale-lock refused); 4 the set failed validation; 6 a
# volume or the restore target failed its check; 7 the database step failed; 8 the uploads step
# failed; 9 the target database has migrations the set does not contain (K142); 129, 130, 143
# interrupted by HUP, INT, TERM.
#
# Requires Docker Compose v2 (`docker compose`, which has `config --format json`); the legacy
# Compose v1 binary is not supported. This script never reads .env itself: compose passes the
# database settings to the backup service.
set -euo pipefail

COMPOSE="docker compose"
LEASE_TTL_SECONDS=900
STALE_LOCK_SECONDS=900
# d-WR-1: how long the trap waits for the restore container to be gone (1 to 600 s).
CONTAINER_WAIT_SECONDS="${RESTORE_CONTAINER_WAIT_SECONDS:-60}"
if ! [[ $CONTAINER_WAIT_SECONDS =~ ^[0-9]{1,3}$ ]] || [ "$CONTAINER_WAIT_SECONDS" -lt 1 ] ||
  [ "$CONTAINER_WAIT_SECONDS" -gt 600 ]; then
  printf '[restore] RESTORE_CONTAINER_WAIT_SECONDS must be 1 to 600.\n' >&2
  exit 2
fi
DOCS='docs/OPERATIONS.md, Restore'

usage() {
  echo "Usage: ./scripts/restore.sh <setId> [--yes]"
  echo "       ./scripts/restore.sh <setId> --validate-only"
  echo "       ./scripts/restore.sh --break-stale-lock <holder>"
  echo "List the sets with: docker compose run --rm --no-deps -T --entrypoint ls backup -1 /backups"
}

log() { printf '[restore] %s\n' "$*"; }
err() { printf '[restore] %s\n' "$*" >&2; }

# backup_step <name> <script> [args...]: <script> runs after `. /opt/aida-backup/lib.sh` in a
# one-off container of the backup service, with $0 = <name> and the args as $1, $2.
backup_step() {
  local name=$1 script=$2
  shift 2
  $COMPOSE run --rm --no-deps -T --entrypoint sh backup -c ". /opt/aida-backup/lib.sh; $script" \
    "$name" "$@" </dev/null
}

# Prints the `name` of top-level volume <key> from `docker compose config --format json` on stdin.
# A small JSON scanner (no jq on the host): it tracks the key path and prints the string at
# volumes.<key>.name.
volume_name_from_config() {
  awk -v target="$1" '
    { s = s $0 "\n" }
    END {
      n = length(s); i = 1; depth = 0; found = 0
      while (i <= n) {
        c = substr(s, i, 1)
        if (c == "\"") {
          j = i + 1; str = ""
          while (j <= n) {
            d = substr(s, j, 1)
            if (d == "\\") { str = str substr(s, j, 2); j += 2; continue }
            if (d == "\"") break
            str = str d; j++
          }
          if (j > n) exit 2
          i = j + 1
          if (type[depth] == "o" && wantkey[depth]) { key[depth] = str; wantkey[depth] = 0; continue }
          if (!found && depth == 3 && key[1] == "volumes" && key[2] == target && key[3] == "name") {
            print str; found = 1
          }
          continue
        }
        if (c == "{") { depth++; type[depth] = "o"; wantkey[depth] = 1; key[depth] = ""; i++; continue }
        if (c == "[") { depth++; type[depth] = "a"; wantkey[depth] = 0; key[depth] = ""; i++; continue }
        if (c == "}" || c == "]") { depth--; i++; continue }
        if (c == ",") { if (type[depth] == "o") wantkey[depth] = 1; i++; continue }
        i++
      }
      exit found ? 0 : 1
    }
  '
}

# --- arguments ---------------------------------------------------------------------------------

MODE=restore
SET_ID=''
YES=0
BREAK_HOLDER=''
VALIDATE_ONLY=0
case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  --break-stale-lock)
    if [ "$#" -ne 2 ]; then
      usage >&2
      exit 2
    fi
    MODE=break
    BREAK_HOLDER=$2
    ;;
  *)
    SET_ID=${1:-}
    [ "$#" -gt 0 ] && shift
    for arg in "$@"; do
      case $arg in
        --yes) YES=1 ;;
        --validate-only) VALIDATE_ONLY=1 ;;
        *)
          usage >&2
          exit 2
          ;;
      esac
    done
    ;;
esac

# --- --break-stale-lock ------------------------------------------------------------------------

if [ "$MODE" = break ]; then
  if ! [[ $BREAK_HOLDER =~ ^restore-[0-9a-f]{32}$ ]]; then
    err "Not a restore holder: expected restore-<32 hex>, as printed by the restore that holds the lock."
    exit 2
  fi
  set +e
  out=$(backup_step aida-restore-break \
    "restore_lock_break_stale \"\$1\" $STALE_LOCK_SECONDS; r=\$?; if [ \"\$r\" -ne 0 ]; then printf 'holder %s heartbeat %s\\n' \"\$(restore_lock_holder || echo none)\" \"\$(restore_lock_age || echo unknown)\"; fi; exit \$r" \
    "$BREAK_HOLDER")
  rc=$?
  set -e
  case $rc in
    0)
      log "Removed the stale restore lock of $BREAK_HOLDER. The services were not started; start them with: docker compose up -d"
      exit 0
      ;;
    1) err "Refused: there is no restore lock to break. ($out)" ;;
    2) err "Refused: the restore lock is held by another holder, not $BREAK_HOLDER. ($out)" ;;
    3) err "Refused: the heartbeat is not older than $STALE_LOCK_SECONDS s, so that restore may still be running. ($out)" ;;
    *) err "Refused: the restore lock could not be removed (exit $rc). ($out)" ;;
  esac
  exit 3
fi

# --- restore -----------------------------------------------------------------------------------

if ! [[ $SET_ID =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$ ]]; then
  err "Not a set id: expected <UTC time>Z-<6 hex>, for example 20261112T020001Z-a1b2c3."
  usage >&2
  exit 2
fi

# K150: the running release's migrations, from this checkout's prisma/migrations (directory
# names only, each [A-Za-z0-9_.-]+). None or an odd name: nothing happens.
REPO_DIR=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
RELEASE_MIGRATIONS=''
for dir in "$REPO_DIR"/prisma/migrations/*/; do
  [ -d "$dir" ] || continue
  name=${dir%/}
  name=${name##*/}
  if ! [[ $name =~ ^[A-Za-z0-9_.-]+$ ]]; then
    err "Unexpected migration directory name in prisma/migrations. Nothing was stopped."
    exit 1
  fi
  RELEASE_MIGRATIONS="${RELEASE_MIGRATIONS:+$RELEASE_MIGRATIONS }$name"
done
if [ -z "$RELEASE_MIGRATIONS" ]; then
  err "No migrations found in $REPO_DIR/prisma/migrations. Run this script from the checkout of the"
  err "running release. Nothing was stopped."
  exit 1
fi

if [ "$YES" != 1 ] && [ "$VALIDATE_ONLY" != 1 ]; then
  printf "Restore set %s? This REPLACES the current database and every stored file. Type 'restore' to continue: " "$SET_ID"
  ANSWER=''
  read -r ANSWER || ANSWER=''
  if [ "$ANSWER" != restore ]; then
    echo
    log 'Aborted. Nothing was changed.'
    exit 1
  fi
fi

# The real volume names (a project name or a `name:` in the compose file changes them).
if ! CONFIG_JSON=$($COMPOSE config --format json 2>/dev/null); then
  err "Could not read the compose configuration (docker compose config --format json)."
  exit 6
fi
volume_ok() { [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$ ]]; }
UPLOADS_VOLUME=$(printf '%s\n' "$CONFIG_JSON" | volume_name_from_config uploads_data) || UPLOADS_VOLUME=''
BACKUPS_VOLUME=$(printf '%s\n' "$CONFIG_JSON" | volume_name_from_config backups_data) || BACKUPS_VOLUME=''
unset CONFIG_JSON
if ! volume_ok "$UPLOADS_VOLUME" || ! volume_ok "$BACKUPS_VOLUME"; then
  err "The compose configuration names no uploads_data or backups_data volume. Nothing was stopped."
  exit 6
fi
for volume in "$UPLOADS_VOLUME" "$BACKUPS_VOLUME"; do
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    err "Volume $volume does not exist. Nothing was stopped. Check the project name and see $DOCS."
    exit 6
  fi
done

HOLDER=''
LOCK_HELD=0
LEASE_HELD=0
RELEASED=0
STOPPED=0
DONE=0
SET_PID=''
SET_RC=''
SET_STARTED=0
# K154: 1 once the set script succeeded; from then on a failure is in the step after it (the
# lease again, migrate deploy), and the trap releases the lease and the lock but starts nothing.
SET_OK=0
RESTORE_CONTAINER=''
EXITING=0
FINAL_RC=0

# Releases this restore's own lease (only when it holds one: an empty target has no SystemSetting
# table, K152) and its restore lock.
release() {
  [ "$LOCK_HELD" = 1 ] && [ "$RELEASED" = 0 ] || return 0
  RELEASED=1
  local script='r=0; restore_lock_release "$1" || r=1; exit "$r"'
  if [ "$LEASE_HELD" = 1 ]; then
    script='r=0; lease_release "$1" || r=1; restore_lock_release "$1" || r=1; exit "$r"'
  fi
  if ! backup_step aida-restore-release "$script" "$HOLDER" >/dev/null; then
    err "Could not release the restore lock or the lease of $HOLDER. Once nothing restores any more,"
    err "remove the lock with: ./scripts/restore.sh --break-stale-lock $HOLDER (after 900 s)."
    return 1
  fi
}

start_services() {
  if ! $COMPOSE start backup app worker; then
    err "Could not start backup, app and worker; start them with: docker compose up -d"
    return 1
  fi
}

# d-WR-1: true when no container named exactly $RESTORE_CONTAINER is listed (running or not).
# A failed `docker ps` counts as listed.
container_gone() {
  local names
  names=$(docker ps -a --filter "name=^/${RESTORE_CONTAINER}\$" --format '{{.Names}}' 2>/dev/null) ||
    return 1
  [ -z "$names" ]
}

# d-WR-1: the client (SET_PID) is not the container. Stop and remove the one-off restore container
# by its exact name, then wait until it is no longer listed. Fails when it is still listed after
# CONTAINER_WAIT_SECONDS.
remove_restore_container() {
  local waited=0
  docker stop -t 30 "$RESTORE_CONTAINER" >/dev/null 2>&1
  docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1
  while ! container_gone; do
    if [ "$waited" -ge "$CONTAINER_WAIT_SECONDS" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# The single trap: it decides every outcome that is not the success path.
on_exit() {
  local rc=$?
  local why=$1 touched
  if [ "$EXITING" = 1 ]; then
    exit "$FINAL_RC"
  fi
  EXITING=1
  trap '' INT TERM HUP
  set +e
  case $why in
    INT) rc=130 ;;
    TERM) rc=143 ;;
    HUP) rc=129 ;;
  esac
  if [ -n "$SET_PID" ]; then
    kill -TERM "$SET_PID" 2>/dev/null
    wait "$SET_PID" 2>/dev/null
    SET_PID=''
  fi
  if [ "$DONE" = 1 ]; then
    : # the success path released the locks and started the services
  elif [ "$SET_OK" = 1 ]; then
    # K154: the set is restored and its container is gone (its client returned 0); the lease
    # again or migrate deploy failed, or a signal came after the migrate call returned. Nothing
    # is started on a database behind this release.
    [ "$rc" != 0 ] || rc=1
    release
    err "The restore lock and the lease were released after the step that failed (exit $rc);"
    err "backup, app and worker were left stopped. See $DOCS."
  elif [ "$SET_STARTED" = 1 ] && ! remove_restore_container; then
    # The restore container may still write: keep the lock (its heartbeat stays fresh, so
    # --break-stale-lock refuses while it runs) and start nothing.
    [ "$rc" != 0 ] || rc=1
    err "The restore container $RESTORE_CONTAINER is still listed after ${CONTAINER_WAIT_SECONDS} s (exit ${SET_RC:-$rc})."
    err "backup, app and worker were left stopped and the restore lock $HOLDER was kept. Check:"
    err "docker ps -a --filter name=$RESTORE_CONTAINER; once it is gone, see --break-stale-lock in $DOCS."
  elif [ "$STOPPED" = 1 ]; then
    [ "$rc" != 0 ] || rc=1
    touched=$(backup_step aida-restore-touched \
      'd=$(restore_lock_dir); if [ -f "$d/target-touched" ]; then head -c 16 "$d/target-touched"; fi') ||
      touched='unreadable'
    touched=$(printf '%s' "$touched" | tr -d '[:space:]')
    release
    case $touched in
      '')
        err "The restore stopped before it changed anything (exit ${SET_RC:-$rc}): nothing was changed."
        if start_services; then
          err "backup, app and worker were started again."
        fi
        ;;
      database)
        err "The restore failed or was interrupted in the database step (exit ${SET_RC:-$rc})."
        err "The database may be partly restored; the uploads volume is untouched."
        err "backup, app and worker were left stopped. See $DOCS, before you start anything."
        ;;
      uploads)
        err "The restore failed or was interrupted in the uploads step (exit ${SET_RC:-$rc})."
        err "The database is restored; the uploads volume may be partly restored."
        err "backup, app and worker were left stopped. See $DOCS, before you start anything."
        ;;
      *)
        err "The restore failed (exit ${SET_RC:-$rc}) and its state could not be read."
        err "backup, app and worker were left stopped. See $DOCS, before you start anything."
        ;;
    esac
  else
    release
  fi
  FINAL_RC=$rc
  exit "$rc"
}
trap 'on_exit EXIT' EXIT
trap 'on_exit INT' INT
trap 'on_exit TERM' TERM
trap 'on_exit HUP' HUP

# The restore lock (on the backups volume, so it survives the database replacement), with a new
# random holder. The set must exist before anything else happens.
set +e
out=$(backup_step aida-restore-lock \
  'h=$(new_restore_holder) || exit 1; if [ ! -d "$BACKUP_DIR/$1" ] || [ -L "$BACKUP_DIR/$1" ]; then echo set-missing; exit 4; fi; if restore_lock_acquire "$h"; then echo "holder=$h"; exit 0; fi; echo "held-by=$(restore_lock_holder || echo unknown) age=$(restore_lock_age || echo unknown)"; exit 3' \
  "$SET_ID")
rc=$?
set -e
case $rc in
  0) ;;
  3)
    holder=$(printf '%s\n' "$out" | sed -n 's/^held-by=\([^ ]*\) age=\([^ ]*\)$/\1/p')
    age=$(printf '%s\n' "$out" | sed -n 's/^held-by=\([^ ]*\) age=\([^ ]*\)$/\2/p')
    err "Another restore holds the restore lock: holder ${holder:-unknown}, last heartbeat ${age:-unknown}s ago."
    err "If that restore is no longer running, see --break-stale-lock in $DOCS. Nothing was stopped."
    exit 3
    ;;
  4)
    err "Set $SET_ID was not found in the backups volume. Nothing was stopped."
    exit 4
    ;;
  *)
    err "Could not take the restore lock (exit $rc). Is the db service running? Nothing was stopped."
    exit 1
    ;;
esac
HOLDER=$(printf '%s\n' "$out" | sed -n 's/^holder=\(restore-[0-9a-f]\{32\}\)$/\1/p' | head -n 1)
if [ -z "$HOLDER" ]; then
  err "The restore lock step printed no holder. Nothing was stopped; see $DOCS."
  exit 1
fi
LOCK_HELD=1
RESTORE_CONTAINER="aida-$HOLDER"
log "Restore lock taken: $HOLDER"

# K149, K152: --validate-only checks the whole set and its migrations against this release under
# the restore lock alone. It takes no lease, so it writes nothing to the database: the restore
# lock keeps every backup out (a backup skips while it exists, and its fenced actions refuse under
# it), and nothing here writes anything a backup could race with. It stops nothing, and the trap
# releases the lock.
if [ "$VALIDATE_ONLY" = 1 ]; then
  log "Validating set $SET_ID (nothing is stopped or written)..."
  set +e
  $COMPOSE run --rm --no-deps -T --entrypoint sh -e "RESTORE_HOLDER=$HOLDER" \
    -e "RESTORE_RELEASE_MIGRATIONS=$RELEASE_MIGRATIONS" \
    backup /opt/aida-backup/aida-restore-set.sh --validate-only "/backups/$SET_ID" </dev/null
  rc=$?
  set -e
  case $rc in
    0) log "Set $SET_ID is valid and can be restored by this release. Nothing was stopped or changed." ;;
    9) err "Refused: set $SET_ID has migrations that this release does not contain. Nothing was changed." ;;
    *) err "Set $SET_ID failed validation (exit $rc). Nothing was stopped or changed. See $DOCS." ;;
  esac
  exit "$rc"
fi

# K142, K150, K152: refuse a set newer than this release, and a target database that is neither
# truly empty nor at exactly the set's migrations. Read only, in a one-off container, before
# anything is stopped and before anything is written to the target database (the lease below
# comes after it). Its `set migrations: older` line means migrate deploy runs after the restore;
# its `target database: empty` line means the target has no SystemSetting table for a lease.
log "Checking the migrations of the set, this release and the target database for set $SET_ID..."
set +e
CHECK_OUT=$($COMPOSE run --rm --no-deps -T --entrypoint sh -e "RESTORE_HOLDER=$HOLDER" \
  -e "RESTORE_RELEASE_MIGRATIONS=$RELEASE_MIGRATIONS" \
  backup /opt/aida-backup/aida-restore-set.sh --check-schema "/backups/$SET_ID" </dev/null)
rc=$?
set -e
[ -z "$CHECK_OUT" ] || printf '%s\n' "$CHECK_OUT"
MIGRATE_AFTER=0
case $'\n'"$CHECK_OUT" in
  *$'\n[restore] set migrations: older than this release'*) MIGRATE_AFTER=1 ;;
esac
TARGET_EMPTY=0
case $'\n'"$CHECK_OUT"$'\n' in
  *$'\n[restore] target database: empty\n'*) TARGET_EMPTY=1 ;;
esac
case $rc in
  0) ;;
  9)
    err "Refused by the migration checks for set $SET_ID (the [restore] refused line above says which)."
    err "Nothing was stopped or changed. Restore into a database at exactly the set's migrations, or"
    err "into an empty database, with a release at or after the set's. See $DOCS."
    exit 9
    ;;
  *)
    err "The migration check of set $SET_ID failed (exit $rc). Nothing was stopped or changed. See $DOCS."
    exit "$rc"
    ;;
esac

# The backup lease with the same holder: a running backup holds it. K152: only on a target with a
# migration history. A truly empty target has no SystemSetting table, so no backup can hold or
# take a lease on it (a backup's first database step reads that table and fails); the restore
# lock alone keeps every backup out, and the restore writes nothing to the target before the set
# script's database step.
if [ "$TARGET_EMPTY" = 1 ]; then
  log "The target database is empty: no backup can run against it, so the restore lock alone coordinates this restore (no lease is written)."
else
  set +e
  backup_step aida-restore-lease \
    "r=\$(lease_acquire \"\$1\" $LEASE_TTL_SECONDS) || exit 1; [ \"\$r\" = acquired ] || exit 3" \
    "$HOLDER" >/dev/null
  rc=$?
  set -e
  case $rc in
    0) LEASE_HELD=1 ;;
    3)
      err "a backup is running; retry after it finishes. Nothing was stopped."
      exit 3
      ;;
    *)
      err "Could not take the backup lease (exit $rc). Is the db service running? Nothing was stopped."
      exit 1
      ;;
  esac
fi

log "Stopping backup, app and worker..."
STOPPED=1
$COMPOSE stop backup app worker

log "Restoring set $SET_ID..."
SET_STARTED=1
$COMPOSE run --rm --no-deps -T --name "$RESTORE_CONTAINER" --entrypoint sh -e "RESTORE_HOLDER=$HOLDER" \
  -e "RESTORE_RELEASE_MIGRATIONS=$RELEASE_MIGRATIONS" \
  -e UPLOADS_DIR=/restore/uploads -v "$UPLOADS_VOLUME:/restore/uploads" \
  backup /opt/aida-backup/aida-restore-set.sh "/backups/$SET_ID" </dev/null &
SET_PID=$!
set +e
wait "$SET_PID"
SET_RC=$?
set -e
SET_PID=''
if [ "$SET_RC" -ne 0 ]; then
  exit "$SET_RC"
fi

SET_OK=1
# K150, K154: an older set leaves the database behind this release; its migrate deploy runs
# before app and worker start (compose start does not run the one-shot migrate service), while
# the restore lock and the lease are held, so no other restore and no backup can start before
# the migration has finished. pg_restore replaced SystemSetting, and the set script removed the
# lease row the dump carried in, so this restore's lease is taken again on the restored database.
# migrate runs in the foreground: a signal is handled by the trap once it has returned.
if [ "$MIGRATE_AFTER" = 1 ]; then
  set +e
  backup_step aida-restore-lease \
    "r=\$(lease_acquire \"\$1\" $LEASE_TTL_SECONDS) || exit 1; [ \"\$r\" = acquired ] || exit 3" \
    "$HOLDER" >/dev/null
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    err "Could not take the backup lease again on the restored database (exit $rc). The database"
    err "holds the set's data at the set's migrations; migrate deploy was NOT run. Run: docker"
    err "compose up -d (it runs migrate first) once no backup is running. See $DOCS."
    exit 1
  fi
  LEASE_HELD=1
  log "The set is older than this release: running this release's migrate deploy..."
  if ! $COMPOSE run --rm --no-deps -T migrate </dev/null; then
    err "migrate deploy failed after the restore of set $SET_ID. The database holds the set's data at"
    err "the set's migrations; backup, app and worker were NOT started. Read the migrate output above,"
    err "fix the cause, then run: docker compose up -d (it runs migrate first). See $DOCS."
    exit 1
  fi
fi
# Then release, so the backup service never starts into a held restore lock.
release || :
DONE=1
log "Starting backup, app and worker..."
start_services || :
log "Waiting for the app probe (up to 60 s)..."
healthy=0
for _ in $(seq 1 30); do
  if $COMPOSE exec -T app wget -qO- http://127.0.0.1:3000/api/health/probe </dev/null >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" = 1 ]; then
  log "The app answers its probe."
else
  err "WARNING: the app did not answer its probe within 60 s. Check: docker compose logs app"
fi
log "Done: set $SET_ID restored."
exit 0
