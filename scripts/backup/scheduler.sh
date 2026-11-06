#!/bin/sh
# scripts/backup/scheduler.sh: the daily loop of the compose `backup` service (Phase 9 plan 09-08,
# AIDA-33, D-01, U-16).
#
# Runs in the pgvector/pgvector:pg16 image as user 1000:1000 (docker-compose.yml). Once a day, at
# BACKUP_SCHEDULE (HH:MM, 24-hour, UTC; default 02:00), it runs aida-backup.sh from its own
# directory and waits for it. A failed run is logged and never stops the loop: the next scheduled
# run tries again. aida-backup.sh owns everything else (lease, fence, retention, status).
#
#   BACKUP_ENABLED   `true` (the default in docker-compose.yml) runs the loop. Any other value
#                    logs one line and keeps the container up without running a backup.
#   BACKUP_SCHEDULE  HH:MM, 00:00 to 23:59, UTC. Anything else logs one line and exits 2.
#
# The delay to the next run is pure shell arithmetic on `date -u +%s`, with no GNU-only date
# option, so it behaves the same in the container and on a developer's machine. The moment a run
# is due is never counted twice: at exactly HH:MM:00 the next run is the following day.
#
#   BACKUP_MAX_RUN_SECONDS  the run's own deadline (aida-backup.sh, default 21600). The scheduler
#                    waits at most that plus 180 s (the run's cleanup grace) for a run. Then the
#                    run gets TERM, and KILL 30 s later if it is still there (K143). A run that ended
#                    on a signal recorded nothing itself, so the scheduler prints the
#                    `AIDA_BACKUP_STATUS_UNRECORDED` line for it (lib.sh status_unrecorded).
#
# Test modes:
#   scheduler.sh --next-delay HH:MM <nowEpoch>
# prints only the delay in seconds (1 to 86400) and exits 0; an invalid HH:MM or epoch exits 2
# (no environment, no side effect).
#   scheduler.sh --run-once <limitSeconds> <killGraceSeconds>
# runs aida-backup.sh from its own directory once, now, under that bound, and exits with the run's
# exit code.
set -eu

LC_ALL=C
export LC_ALL

log() {
  printf '[backup] %s\n' "$1"
}

# schedule_seconds HH:MM: prints the seconds since 00:00 UTC, or returns 2 on invalid input.
schedule_seconds() {
  case $1 in
    [0-2][0-9]:[0-5][0-9]) ;;
    *) return 2 ;;
  esac
  _hh=${1%%:*}
  _mm=${1#*:}
  # Strip one leading zero: `08` is not a valid octal number in shell arithmetic.
  _hh=${_hh#0}
  _mm=${_mm#0}
  [ "$_hh" -le 23 ] || return 2
  printf '%s\n' $((_hh * 3600 + _mm * 60))
}

# next_delay HH:MM nowEpoch: prints the seconds until the next HH:MM UTC strictly after now.
next_delay() {
  _target=$(schedule_seconds "$1") || return 2
  case $2 in
    '' | *[!0-9]*) return 2 ;;
  esac
  # Leading zeros would turn the epoch into an octal literal; a real epoch never has one.
  case $2 in
    0?*) return 2 ;;
  esac
  _now=$(($2 % 86400))
  _delay=$((_target - _now))
  if [ "$_delay" -le 0 ]; then
    _delay=$((_delay + 86400))
  fi
  printf '%s\n' "$_delay"
}

if [ "${1:-}" = "--next-delay" ]; then
  [ "$#" -eq 3 ] || exit 2
  next_delay "$2" "$3" || exit 2
  exit 0
fi
RUN_ONCE=0
if [ "${1:-}" = "--run-once" ]; then
  [ "$#" -eq 3 ] || exit 2
  for _a in "$2" "$3"; do
    case $_a in
      '' | *[!0-9]* | 0?*) exit 2 ;;
    esac
  done
  [ "$2" -ge 1 ] || exit 2
  RUN_ONCE=1
elif [ "$#" -ne 0 ]; then
  log 'scheduler: unexpected argument (usage: scheduler.sh, or scheduler.sh --next-delay HH:MM <nowEpoch>)'
  exit 2
fi

SCHEDULER_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
BACKUP_SCRIPT=$SCHEDULER_DIR/aida-backup.sh
# shellcheck source=scripts/backup/lib.sh
. "$SCHEDULER_DIR/lib.sh"
BACKUP_ENABLED=${BACKUP_ENABLED:-true}
BACKUP_SCHEDULE=${BACKUP_SCHEDULE:-02:00}
BACKUP_MAX_RUN_SECONDS=${BACKUP_MAX_RUN_SECONDS:-21600}

CHILD=''
WATCHDOG=''
on_stop() {
  trap '' TERM INT HUP
  if [ -n "$WATCHDOG" ]; then
    kill "$WATCHDOG" 2>/dev/null || :
  fi
  if [ -n "$CHILD" ]; then
    # A running backup gets TERM so its own trap releases the lease and the fence.
    kill -TERM "$CHILD" 2>/dev/null || :
    wait "$CHILD" 2>/dev/null || :
  fi
  log 'scheduler stopped'
  exit 0
}
trap on_stop TERM INT HUP

# Sleeps in the background so TERM from `docker compose stop` is handled at once.
pause_for() {
  sleep "$1" &
  CHILD=$!
  wait "$CHILD" || :
  CHILD=''
}

# run_backup <limitSeconds> <killGraceSeconds>: runs aida-backup.sh and waits for it, at most
# <limit> seconds (K143). Then the run gets TERM, so its trap records the outcome and releases the
# lease and the fence, and KILL <killGrace> seconds later. A run that ended on a signal recorded
# nothing itself: one unrecorded line is printed here. Returns the run's exit code.
run_backup() {
  sh "$BACKUP_SCRIPT" &
  CHILD=$!
  # The watchdog polls once a second and ends by itself within a second of the run, so it is
  # never killed mid-step and leaves no sleeping process behind.
  (
    _wd_i=0
    while [ "$_wd_i" -lt "$1" ]; do
      sleep 1 </dev/null >/dev/null 2>&1 || :
      kill -0 "$CHILD" 2>/dev/null || exit 0
      _wd_i=$((_wd_i + 1))
    done
    log "scheduled backup still running after ${1}s; stopping it"
    kill -TERM "$CHILD" 2>/dev/null || exit 0
    _wd_i=0
    while [ "$_wd_i" -lt "$2" ]; do
      sleep 1 </dev/null >/dev/null 2>&1 || :
      kill -0 "$CHILD" 2>/dev/null || exit 0
      _wd_i=$((_wd_i + 1))
    done
    log 'scheduled backup did not stop; killing it'
    kill -KILL "$CHILD" 2>/dev/null || :
  ) &
  WATCHDOG=$!
  _rb_rc=0
  wait "$CHILD" || _rb_rc=$?
  CHILD=''
  wait "$WATCHDOG" 2>/dev/null || :
  WATCHDOG=''
  if [ "$_rb_rc" -gt 128 ]; then
    log "scheduled backup ended by signal $((_rb_rc - 128))"
    status_unrecorded - failed - unknown || :
  fi
  return "$_rb_rc"
}

if [ "$RUN_ONCE" = 1 ]; then
  _rc=0
  run_backup "$2" "$3" || _rc=$?
  exit "$_rc"
fi

if [ "$BACKUP_ENABLED" != true ]; then
  if [ "$BACKUP_ENABLED" = false ]; then
    log 'backups disabled (BACKUP_ENABLED=false)'
  else
    log "backups disabled (BACKUP_ENABLED is not 'true')"
  fi
  while :; do
    pause_for 86400
  done
fi

if ! schedule_seconds "$BACKUP_SCHEDULE" >/dev/null; then
  log 'invalid BACKUP_SCHEDULE: use HH:MM, 24-hour UTC, for example 02:00'
  exit 2
fi
case $BACKUP_MAX_RUN_SECONDS in
  '' | *[!0-9]* | 0*) BACKUP_MAX_RUN_SECONDS=bad ;;
esac
if [ "$BACKUP_MAX_RUN_SECONDS" = bad ] || [ "${#BACKUP_MAX_RUN_SECONDS}" -gt 6 ]; then
  log 'invalid BACKUP_MAX_RUN_SECONDS: use whole seconds, 1 to 999999'
  exit 2
fi

log "scheduler: daily at $BACKUP_SCHEDULE UTC"
while :; do
  _now=$(date -u +%s)
  _delay=$(next_delay "$BACKUP_SCHEDULE" "$_now")
  log "next backup in ${_delay}s"
  pause_for "$_delay"
  _rc=0
  run_backup "$((BACKUP_MAX_RUN_SECONDS + 180))" 30 || _rc=$?
  case $_rc in
    0) ;;
    3) log 'scheduled backup skipped (exit 3)' ;;
    *) log "scheduled backup did not succeed (exit $_rc); the next scheduled run tries again" ;;
  esac
done
