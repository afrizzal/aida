#!/bin/sh
# scripts/backup/aida-backup.sh: one AIDA backup run (Phase 9 plan 09-06, AIDA-33; D-01 to D-04,
# U-12 to U-14, U-16, U-18).
#
# Runs in the pgvector/pgvector:pg16 image as user 1000:1000. It reaches the database through
# the libpq variables PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE (never a URL), reads
# UPLOADS_DIR and writes only under BACKUP_DIR. One run produces one set:
#
#   BACKUP_DIR/<setId>/db.dump          pg_dump custom format
#   BACKUP_DIR/<setId>/uploads.tar.gz   <organizationId>/<storageKey> files
#   BACKUP_DIR/<setId>/uploads.sha256   sha256 of every archive member, from the archive itself
#   BACKUP_DIR/<setId>/manifest.json    set id, time, app version, counts, sha256 and size
#
# The set is written to BACKUP_DIR/.tmp-<setId> and renamed to BACKUP_DIR/<setId> only after
# every part validated, under the owned lease (fenced_action), never over an existing directory.
#
# Order of one run (review Q8): restore lock check (a `.restore-lock` in BACKUP_DIR: skip, exit 3,
# nothing touched); set id; skip when another run's lease is active; uploads volume identity
# (marker equals `uploads:volume-id`); exclusive file fence; lease; lease renewal in the
# background; dump; list of archivable files; archive; checksums from the archive; every file the
# dump references (Attachment, TaskAttachment, the `branding:logo` Setting) must be in the
# archive; manifest; validation; publish; retention (D-03: the BACKUP_RETENTION newest sets are
# kept, older sets and stale `.tmp-<setId>` directories are removed, under the owned lease);
# status `backup:lastRun`. On every exit path the trap stops the renewal, records a failed
# status when none was recorded, releases its own lease and the fence, and removes its own
# .tmp-<setId> unless it was published.
#
# Status ownership (D-04, P6): a run that never held the lease writes `backup:lastRun` directly;
# a run that holds it writes through fenced_action; a run that lost it writes no `backup:lastRun`
# and logs 'backup aborted: lease lost'. When the status write fails, or the run lost its lease
# (K143: every abort leaves a record), lib.sh status_unrecorded prints
# `AIDA_BACKUP_STATUS_UNRECORDED <json>` on stderr, writes BACKUP_DIR/status-unrecorded-<setId>.json
# when it can, and the run exits 5.
#
# Run deadline (K143): a run may take BACKUP_MAX_RUN_SECONDS. psql, pg_dump, pg_restore, find and
# tar run under lib.sh `bounded`, so a hung one ends at the deadline and the run fails with
# 'backup aborted: run deadline passed' and a recorded status. Every libpq connect gives up after
# PGCONNECT_TIMEOUT seconds (lib.sh, default 10). The lease renewal stops when the main script is
# gone, so a killed run's lease expires within one TTL; it also stops renewing
# BACKUP_RUN_GRACE_SECONDS after the deadline (the run makes no progress) and signals the run. A
# renewal error is retried every few seconds until a third of the TTL is left on the lease; only a
# confirmed lost lease or running out of that margin aborts the run.
#
# Restore lock (review Q3): fenced_action re-checks `.restore-lock` inside its locked session
# immediately before publish, retention and the status write; on a lock the run exits 3 with
# nothing more published, no retention, no status and no unrecorded-status file, and removes only
# its own temporary directory.
#
# Exit codes: 0 succeeded, 2 failed, 3 skipped (another run holds the lease, or a restore is in
# progress; nothing touched),
# 5 the status could not be recorded, or the run lost its lease (the outcome is in the stderr line
# and the per-set file).
#
# Settings (environment):
#   BACKUP_DIR (default /backups), UPLOADS_DIR (default /data/uploads),
#   BACKUP_RETENTION (7, the number of successful sets kept, 1 to 9999),
#   BACKUP_LEASE_TTL_SECONDS (900), BACKUP_FENCE_WAIT_SECONDS (300),
#   BACKUP_DUMP_LOCK_TIMEOUT (300s), BACKUP_MAX_RUN_SECONDS (21600, 1 to 999999),
#   PGCONNECT_TIMEOUT (10), BACKUP_APP_VERSION_FILE
#   (default /opt/aida-backup-meta/package.json; its top-level "version", else "unknown").
#   Tests only: BACKUP_TEST_PAUSE_DIR, BACKUP_TEST_PAUSE_MAX_SECONDS (lib.sh pause_point).
set -eu

LC_ALL=C
export LC_ALL
umask 077
trap '' PIPE

BACKUP_LIB_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=scripts/backup/lib.sh
. "$BACKUP_LIB_DIR/lib.sh"
AIDA_BACKUP_LIB=$BACKUP_LIB_DIR/lib.sh
export AIDA_BACKUP_LIB

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/data/uploads}
BACKUP_RETENTION=${BACKUP_RETENTION:-7}
BACKUP_LEASE_TTL_SECONDS=${BACKUP_LEASE_TTL_SECONDS:-900}
BACKUP_FENCE_WAIT_SECONDS=${BACKUP_FENCE_WAIT_SECONDS:-300}
BACKUP_DUMP_LOCK_TIMEOUT=${BACKUP_DUMP_LOCK_TIMEOUT:-300s}
BACKUP_APP_VERSION_FILE=${BACKUP_APP_VERSION_FILE:-/opt/aida-backup-meta/package.json}
BACKUP_MAX_RUN_SECONDS=${BACKUP_MAX_RUN_SECONDS:-21600}
# After the deadline: the time the exit trap gets for its own database calls, and the time after
# which the lease renewal stops (it must outlast that cleanup).
BACKUP_CLEANUP_SECONDS=60
BACKUP_RUN_GRACE_SECONDS=120
BACKUP_RUN_DEADLINE=''

RUN_TMP=''
SET_ID=''
SET_TMP=''
SET_FINAL=''
CATEGORY=unknown
OUTCOME=failed
SKIPPED=0
LEASE_HELD=0
PUBLISHED=0
STATUS_DONE=0
STATUS_UNRECORDED=0
LEASE_LOST=0
RENEW_PID=''
FENCE_FD_OPEN=0
FENCE_HELD=0
BACKUP_ERRLOG=/dev/null
MAIN_PID=$$

stop_renewal() {
  if [ -n "$RENEW_PID" ]; then
    kill "$RENEW_PID" 2>/dev/null || :
    wait "$RENEW_PID" 2>/dev/null || :
    RENEW_PID=''
  fi
}

on_exit() {
  _rc=$?
  trap '' USR1 INT TERM HUP
  set +e
  stop_renewal
  # The exit path's own database calls get a short bound of their own (K143).
  if is_uint "$BACKUP_RUN_DEADLINE"; then
    BACKUP_RUN_DEADLINE=$(($(date -u +%s) + BACKUP_CLEANUP_SECONDS))
  fi
  if [ "$SKIPPED" = 1 ]; then
    _rc=3
  elif [ "$OUTCOME" = succeeded ]; then
    _rc=0
  else
    _rc=2
    if [ "$STATUS_DONE" = 0 ] && [ "$LEASE_LOST" = 0 ]; then
      write_status failed - "$CATEGORY"
      case $? in
        3)
          _rc=3
          log 'backup skipped: restore in progress'
          ;;
        4)
          LEASE_LOST=1
          log 'backup aborted: lease lost'
          ;;
      esac
    fi
    # K143: a run that lost its lease writes no backup:lastRun (another holder may own the row
    # now), but it never ends silently: the unrecorded line and the per-set file record it.
    if [ "$_rc" = 2 ] && [ "$LEASE_LOST" = 1 ] && [ "$STATUS_UNRECORDED" = 0 ]; then
      STATUS_UNRECORDED=1
      status_unrecorded "${SET_ID:--}" failed - "$CATEGORY" || log 'backup status not recorded'
    fi
    if [ "$_rc" = 2 ]; then
      log "backup failed: $CATEGORY"
    fi
  fi
  if [ "$STATUS_UNRECORDED" = 1 ]; then
    _rc=5
  fi
  if [ "$LEASE_HELD" = 1 ]; then
    lease_release "$SET_ID" || :
  fi
  fence_close
  if [ "$PUBLISHED" = 0 ] && [ -n "$SET_TMP" ] && [ -d "$SET_TMP" ]; then
    rm -r -- "$SET_TMP" </dev/null 2>/dev/null
  fi
  if [ -n "$RUN_TMP" ] && [ -d "$RUN_TMP" ]; then
    rm -r -- "$RUN_TMP" </dev/null 2>/dev/null
  fi
  exit "$_rc"
}

fail() {
  CATEGORY=$1
  exit 2
}

# A failed step: a write probe in the set directory tells a storage failure from the step's own.
step_failed() {
  if deadline_passed; then
    log 'backup aborted: run deadline passed'
    fail unknown
  fi
  _sf_dir=${SET_TMP:-$BACKUP_DIR}
  if ! (printf 'probe\n' >"$_sf_dir/.write-probe") 2>/dev/null; then
    fail storage
  fi
  rm -f -- "$_sf_dir/.write-probe"
  fail "$1"
}

# A restore took its lock: stop with exit 3 and no status (the trap removes the own temp dir).
restore_skip() {
  SKIPPED=1
  log 'backup skipped: restore in progress'
  exit 3
}

on_lease_lost() {
  trap '' USR1
  LEASE_LOST=1
  if [ -n "$RUN_TMP" ] && [ -e "$RUN_TMP/deadline.passed" ]; then
    log 'backup aborted: run deadline passed'
  else
    log 'backup aborted: lease lost'
  fi
  # A restore replaces the database (and with it the lease row) only under its restore lock.
  if restore_lock_present; then restore_skip; fi
  fail unknown
}

# write_status <succeeded|failed> <setId|-> <category|->: the status write by its owner (D-04,
# P6). Without the lease (never held): directly. With the lease: through fenced_action, so a run
# that lost its lease writes nothing (returns 4) and nothing is written during a restore
# (returns 3). When the write fails, the unrecorded-status
# fallback runs and STATUS_UNRECORDED is set (returns 5). Returns 0 when recorded.
write_status() {
  STATUS_DONE=1
  if [ "$LEASE_HELD" = 1 ]; then
    AIDA_STATUS_RESULT=$1
    AIDA_STATUS_SET=$2
    AIDA_STATUS_CATEGORY=$3
    export AIDA_STATUS_RESULT AIDA_STATUS_SET AIDA_STATUS_CATEGORY
    _ws=1
    if [ -n "$RUN_TMP" ] && [ -f "$RUN_TMP/status.sh" ]; then
      fenced_action "$SET_ID" "$RUN_TMP/status.sh"
      _ws=$?
    fi
    case $_ws in
      0 | 3 | 4) return "$_ws" ;;
    esac
  elif record_status "$1" "$2" "$3"; then
    return 0
  fi
  STATUS_UNRECORDED=1
  status_unrecorded "${SET_ID:--}" "$1" "$2" "$3" || log 'backup status not recorded'
  return 5
}

# renew_loop: renews the lease every TTL/3 (K143, b-WR-1, b-WR-2).
# - The main script is gone (killed): it stops at once, so the lease expires within one TTL.
# - BACKUP_RUN_GRACE_SECONDS past the run deadline: it stops renewing and signals the run.
# - A renewal error (psql failed) is retried every _rl_retry seconds while more than TTL/3 would
#   be left on the lease, counted from the last confirmed renewal; each attempt is bounded by that
#   point. A confirmed 0 rows (another holder, or expired) or the end of that margin is lost.
renew_loop() {
  # The fence FIFO's write end belongs to the main shell alone: once main is gone the fence
  # session must see end of input (a redirection on the background call did not close it).
  exec 7>&-
  _rl_interval=$((BACKUP_LEASE_TTL_SECONDS / 3))
  [ "$_rl_interval" -ge 1 ] || _rl_interval=1
  _rl_retry=$((_rl_interval / 5))
  [ "$_rl_retry" -ge 1 ] || _rl_retry=1
  [ "$_rl_retry" -le 5 ] || _rl_retry=5
  _rl_stop=$((BACKUP_RUN_DEADLINE + BACKUP_RUN_GRACE_SECONDS))
  _rl_ok=$(date -u +%s)
  _rl_wait=$_rl_interval
  _rl_sleep=''
  trap 'kill "$_rl_sleep" 2>/dev/null; exit 0' TERM
  while :; do
    sleep "$_rl_wait" &
    _rl_sleep=$!
    wait "$_rl_sleep" || :
    kill -0 "$MAIN_PID" 2>/dev/null || exit 0
    _rl_now=$(date -u +%s)
    if [ "$_rl_now" -ge "$_rl_stop" ]; then
      : >"$RUN_TMP/deadline.passed"
      kill -s USR1 "$MAIN_PID" 2>/dev/null || :
      exit 0
    fi
    _rl_giveup=$((_rl_ok + BACKUP_LEASE_TTL_SECONDS - _rl_interval))
    _rl_count=$(
      BACKUP_RUN_DEADLINE=$_rl_giveup
      lease_renew "$SET_ID" "$BACKUP_LEASE_TTL_SECONDS"
    ) || _rl_count=error
    if [ "$_rl_count" = 1 ]; then
      _rl_ok=$_rl_now
      _rl_wait=$_rl_interval
      continue
    fi
    if [ "$_rl_count" = error ] && [ $(($(date -u +%s) + _rl_retry)) -lt "$_rl_giveup" ]; then
      log 'lease renewal failed; retrying'
      _rl_wait=$_rl_retry
      continue
    fi
    : >"$RUN_TMP/lease.lost"
    kill -s USR1 "$MAIN_PID" 2>/dev/null || :
    exit 0
  done
}

app_version() {
  _av=''
  if [ -f "$BACKUP_APP_VERSION_FILE" ]; then
    # The top-level "version" line of package.json (two-space indent, U-18).
    _av=$(sed -n 's/^  "version": *"\([^"]*\)".*$/\1/p' "$BACKUP_APP_VERSION_FILE" 2>/dev/null |
      head -n 1) || _av=''
  fi
  if printf '%s\n' "$_av" | grep -Eqx '[0-9A-Za-z.+-]{1,64}'; then
    printf '%s\n' "$_av"
  else
    printf 'unknown\n'
  fi
}

# Every <organizationId>/<storageKey> the dump references in table $1 (mode $2: "table" when a
# storageKey column holds the key, "setting" for the `branding:logo` row's JSON value), one per
# line as "<organizationId>/<storageKey><TAB><table> <row id>" (b-WR-3: the row is named when the
# file is missing).
referenced_from_dump() {
  bounded pg_restore --data-only --table="$1" --file=- "$SET_TMP/db.dump" \
    >"$RUN_TMP/copy-$1.txt" 2>>"$BACKUP_ERRLOG" || return 1
  awk -F '\t' -v mode="$2" -v tbl="$1" '
    BEGIN { inside = 0; seen = 0; org = 0; key = 0; skey = 0; val = 0; rid = 0 }
    !inside && /^COPY / {
      h = $0
      sub(/^[^(]*\(/, "", h)
      sub(/\) FROM stdin;$/, "", h)
      n = split(h, cols, ", ")
      for (i = 1; i <= n; i++) {
        c = cols[i]
        gsub(/"/, "", c)
        if (c == "organizationId") org = i
        if (c == "storageKey") skey = i
        if (c == "key") key = i
        if (c == "value") val = i
        if (c == "id") rid = i
      }
      inside = 1
      seen = 1
      next
    }
    inside && $0 == "\\." { inside = 0; next }
    inside {
      if (mode == "table") {
        print $org "/" $skey "\t" tbl " " $rid
      } else if ($key == "branding:logo") {
        v = $val
        if (match(v, /"storageKey"[ ]*:[ ]*"[^"\\]*"/)) {
          s = substr(v, RSTART, RLENGTH)
          sub(/^"storageKey"[ ]*:[ ]*"/, "", s)
          sub(/"$/, "", s)
          print $org "/" s "\t" tbl " " $rid
        } else {
          print "!unreadable-logo-value\t" tbl " " $rid
        }
      }
    }
    END {
      if (!seen || org == 0 || rid == 0) exit 3
      if (mode == "table" && skey == 0) exit 3
      if (mode == "setting" && (key == 0 || val == 0)) exit 3
    }
  ' "$RUN_TMP/copy-$1.txt"
}

file_sha256() {
  _fs=$(sha256sum "$1") || return 1
  printf '%s\n' "${_fs%% *}"
}

trap on_exit EXIT
trap 'fail unknown' INT TERM HUP
trap on_lease_lost USR1

# A restore in progress: back off before touching sets, status or locks (review Q3).
if restore_lock_present; then
  restore_skip
fi
pause_point after-lock-check || fail unknown

# The set id comes first: the unrecorded-status file of any later failure is named by it.
SET_ID=$(new_set_id) || SET_ID=''
valid_set_id "$SET_ID" || {
  SET_ID=''
  fail unknown
}

for _n in "$BACKUP_LEASE_TTL_SECONDS" "$BACKUP_FENCE_WAIT_SECONDS" "$BACKUP_RETENTION" \
  "$BACKUP_MAX_RUN_SECONDS"; do
  is_uint "$_n" && [ "$_n" -ge 1 ] || {
    log 'invalid setting'
    fail unknown
  }
done
[ "${#BACKUP_RETENTION}" -le 4 ] && [ "${#BACKUP_MAX_RUN_SECONDS}" -le 6 ] || {
  log 'invalid setting'
  fail unknown
}
BACKUP_RUN_DEADLINE=$(($(date -u +%s) + BACKUP_MAX_RUN_SECONDS))
export BACKUP_RUN_DEADLINE
printf '%s\n' "$BACKUP_DUMP_LOCK_TIMEOUT" | grep -Eqx '[0-9]{1,6}(ms|s|min)?' || {
  log 'invalid setting'
  fail unknown
}

RUN_TMP=$(mktemp -d) || fail unknown
BACKUP_ERRLOG="$RUN_TMP/errors.log"
: >"$BACKUP_ERRLOG"
export BACKUP_ERRLOG
cat >"$RUN_TMP/status.sh" <<'EOF' || fail unknown
set -eu
. "$AIDA_BACKUP_LIB"
record_status "$AIDA_STATUS_RESULT" "$AIDA_STATUS_SET" "$AIDA_STATUS_CATEGORY"
EOF

CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Another run holds an unexpired lease: skip without touching anything.
_active=$(lease_active) || {
  log 'database not reachable'
  fail unknown
}
if [ "$_active" = t ]; then
  SKIPPED=1
  log 'backup skipped: lease held'
  exit 3
fi

if ! uploads_identity_ok; then
  log 'uploads volume not verified'
  fail unknown
fi

if ! fence_open "$BACKUP_FENCE_WAIT_SECONDS"; then
  if [ "$FENCE_FAILURE" = busy ]; then
    log 'file fence busy'
  else
    log 'file fence unavailable'
  fi
  fail unknown
fi

_lease=$(lease_acquire "$SET_ID" "$BACKUP_LEASE_TTL_SECONDS") || fail unknown
if [ "$_lease" != acquired ]; then
  SKIPPED=1
  log 'backup skipped: lease held'
  exit 3
fi
LEASE_HELD=1
# Codex r3-5: a restore may have taken its lock after the check above (a one-off backup can wait
# there for a long time); on an empty target its pg_restore then created the table this lease is
# in. Check again now that the lease is held: under a restore lock the run stops here, and the
# exit path releases this run's own lease row only.
if restore_lock_present; then
  restore_skip
fi

# The renewal's log lines (fixed text) reach the run's output; its errors go nowhere.
renew_loop 2>/dev/null 7>&- &
RENEW_PID=$!

pause_point after-fence || fail unknown

SET_TMP="$BACKUP_DIR/.tmp-$SET_ID"
SET_FINAL="$BACKUP_DIR/$SET_ID"
if ! mkdir -- "$SET_TMP" 2>>"$BACKUP_ERRLOG"; then
  SET_TMP=''
  fail storage
fi
printf '%s\n' "$SET_ID" >"$SET_TMP/holder" 2>>"$BACKUP_ERRLOG" || fail storage

if ! bounded env PGAPPNAME="$BACKUP_APPLICATION_NAME" pg_dump -Fc \
  --lock-wait-timeout="$BACKUP_DUMP_LOCK_TIMEOUT" -f "$SET_TMP/db.dump" 2>>"$BACKUP_ERRLOG"; then
  step_failed dump
fi
[ -s "$SET_TMP/db.dump" ] || step_failed dump

pause_point after-dump || fail unknown

# Archivable files: regular files at <organizationId>/<storageKey>. Every other entry (the marker,
# other names, links, nested directories) is counted as skipped and never archived.
(cd -- "$UPLOADS_DIR" && bounded find . -mindepth 2 -maxdepth 2 -type f -regextype posix-extended \
  -regex "$MEMBER_FIND_RE" -printf '%P\n') >"$RUN_TMP/files.raw" 2>>"$BACKUP_ERRLOG" ||
  step_failed archive
sort -u "$RUN_TMP/files.raw" >"$RUN_TMP/files.list" || step_failed archive
(cd -- "$UPLOADS_DIR" && bounded find . -mindepth 1 -maxdepth 1 -regextype posix-extended \
  ! \( -type d -regex "$MEMBER_DIR_FIND_RE" \) -printf 'x\n') >"$RUN_TMP/skipped-top.raw" \
  2>>"$BACKUP_ERRLOG" || step_failed archive
(cd -- "$UPLOADS_DIR" && bounded find . -mindepth 2 -maxdepth 2 -regextype posix-extended \
  -regex "$MEMBER_DIR_FIND_RE/.*" ! \( -type f -regex "$MEMBER_FIND_RE" \) -printf 'x\n') \
  >"$RUN_TMP/skipped-inner.raw" 2>>"$BACKUP_ERRLOG" || step_failed archive
SKIPPED_ENTRIES=$(($(wc -l <"$RUN_TMP/skipped-top.raw") + $(wc -l <"$RUN_TMP/skipped-inner.raw")))

pause_point after-list || fail unknown

# A listed file that no committed row references may vanish meanwhile (U-13): tar exit 1 (a
# file changed or vanished) is accepted, 2 or more fails the set.
set +e
bounded tar -czf "$SET_TMP/uploads.tar.gz" --ignore-failed-read --no-recursion --verbatim-files-from \
  -C "$UPLOADS_DIR" -T "$RUN_TMP/files.list" 2>>"$BACKUP_ERRLOG"
_tar_rc=$?
set -e
[ "$_tar_rc" -le 1 ] || step_failed archive

# Checksums from the archive's own contents, then the member list must equal the checksum list.
cat >"$RUN_TMP/sum-member.sh" <<'EOF'
_h=$(sha256sum) || exit 1
printf '%s  %s\n' "${_h%% *}" "$TAR_FILENAME"
EOF
bounded tar -xzf "$SET_TMP/uploads.tar.gz" --to-command="sh $RUN_TMP/sum-member.sh" \
  >"$RUN_TMP/sums.raw" 2>>"$BACKUP_ERRLOG" || step_failed archive
sort -k 2 "$RUN_TMP/sums.raw" >"$SET_TMP/uploads.sha256" || step_failed archive
bounded tar -tzf "$SET_TMP/uploads.tar.gz" >"$RUN_TMP/members.raw" 2>>"$BACKUP_ERRLOG" ||
  step_failed archive
sort "$RUN_TMP/members.raw" >"$RUN_TMP/members.list" || step_failed archive
awk '{ print $2 }' "$SET_TMP/uploads.sha256" | sort >"$RUN_TMP/summed.list" ||
  step_failed archive
cmp -s "$RUN_TMP/members.list" "$RUN_TMP/summed.list" || step_failed archive
if grep -Evx "$MEMBER_PATH_RE" "$RUN_TMP/members.list" >/dev/null; then
  step_failed archive
fi
ARCHIVED_FILES=$(($(wc -l <"$RUN_TMP/members.list")))

pause_point after-archive || fail unknown

# b-WR-3: the missing members and the rows that reference them, at most MISSING_LOG_MAX lines and
# a count of the rest, logged before the exit trap removes RUN_TMP. Only storage keys, organization
# ids and row ids are printed, each checked against its expected shape first (no file content, no
# other column); an entry of another shape is printed as "an entry of unexpected shape".
MISSING_LOG_MAX=20
log_missing() {
  awk -F '\t' -v max="$MISSING_LOG_MAX" '
    function member_ok(m) {
      return m ~ /^[A-Za-z0-9_][A-Za-z0-9_-]*\/[a-z0-9]+\.[a-z0-9]+$/ && length(m) <= 138
    }
    function row_ok(r) {
      return r ~ /^(Attachment|TaskAttachment|Setting) [A-Za-z0-9_-]+$/ && length(r) <= 80
    }
    NR == FNR { if (!($1 in want)) { want[$1] = 1; order[++n] = $1 }; next }
    ($1 in want) {
      r = row_ok($2) ? $2 : "a row of unexpected shape"
      rows[$1] = (rows[$1] == "") ? r : rows[$1] ", " r
    }
    END {
      shown = (n < max) ? n : max
      for (i = 1; i <= shown; i++) {
        m = order[i]
        printf "[backup] missing: %s (%s)\n", (member_ok(m) ? m : "an entry of unexpected shape"), rows[m]
      }
      if (n > max) printf "[backup] missing: %d more not listed\n", n - max
    }
  ' "$RUN_TMP/missing.list" "$RUN_TMP/refs.rows"
}

# Every file the dump references must be in the archive with a checksum (D-02(4), U-14).
: >"$RUN_TMP/refs.rows"
referenced_from_dump Attachment table >>"$RUN_TMP/refs.rows" || step_failed verification
referenced_from_dump TaskAttachment table >>"$RUN_TMP/refs.rows" || step_failed verification
referenced_from_dump Setting setting >>"$RUN_TMP/refs.rows" || step_failed verification
cut -f 1 "$RUN_TMP/refs.rows" | sort -u >"$RUN_TMP/refs.list" || step_failed verification
REFERENCED_FILES=$(($(wc -l <"$RUN_TMP/refs.list")))
comm -23 "$RUN_TMP/refs.list" "$RUN_TMP/summed.list" >"$RUN_TMP/missing.list" ||
  step_failed verification
_missing=$(($(wc -l <"$RUN_TMP/missing.list")))
if [ "$_missing" -ne 0 ]; then
  log "verification: $_missing referenced files missing from the archive"
  log_missing || log 'verification: the missing files could not be listed'
  step_failed verification
fi

# Manifest, then validation of every part.
APP_VERSION=$(app_version)
_dump_sha=$(file_sha256 "$SET_TMP/db.dump") || step_failed storage
_tar_sha=$(file_sha256 "$SET_TMP/uploads.tar.gz") || step_failed storage
_sums_sha=$(file_sha256 "$SET_TMP/uploads.sha256") || step_failed storage
_dump_size=$(stat -c %s "$SET_TMP/db.dump") || step_failed storage
_tar_size=$(stat -c %s "$SET_TMP/uploads.tar.gz") || step_failed storage
_sums_size=$(stat -c %s "$SET_TMP/uploads.sha256") || step_failed storage
cat >"$SET_TMP/manifest.json" 2>>"$BACKUP_ERRLOG" <<EOF || step_failed storage
{
  "setId": "$SET_ID",
  "createdAt": "$CREATED_AT",
  "appVersion": "$APP_VERSION",
  "counts": {
    "referencedFiles": $REFERENCED_FILES,
    "archivedFiles": $ARCHIVED_FILES,
    "skippedEntries": $SKIPPED_ENTRIES
  },
  "files": {
    "db.dump": { "sha256": "$_dump_sha", "size": $_dump_size },
    "uploads.tar.gz": { "sha256": "$_tar_sha", "size": $_tar_size },
    "uploads.sha256": { "sha256": "$_sums_sha", "size": $_sums_size }
  }
}
EOF
bounded pg_restore --list "$SET_TMP/db.dump" >/dev/null 2>>"$BACKUP_ERRLOG" || step_failed dump
bounded tar -tzf "$SET_TMP/uploads.tar.gz" >/dev/null 2>>"$BACKUP_ERRLOG" || step_failed archive
[ "$(($(wc -l <"$SET_TMP/uploads.sha256")))" -eq "$ARCHIVED_FILES" ] || step_failed archive
[ -s "$SET_TMP/manifest.json" ] || step_failed storage

# Publish under the owned lease. A dropped fence session is logged: the lease still fenced
# deletions (U-12 G2), and the lease check below still decides.
if ! fence_alive; then
  log 'fence session lost; the lease still fenced deletions'
fi
AIDA_SET_TMP=$SET_TMP
AIDA_SET_FINAL=$SET_FINAL
AIDA_SET_ID=$SET_ID
export AIDA_SET_TMP AIDA_SET_FINAL AIDA_SET_ID
cat >"$RUN_TMP/publish.sh" <<'EOF'
set -eu
[ -d "$AIDA_SET_TMP" ] && [ ! -L "$AIDA_SET_TMP" ] || exit 1
[ ! -e "$AIDA_SET_FINAL" ] && [ ! -L "$AIDA_SET_FINAL" ] || exit 1
rm -f -- "$AIDA_SET_TMP/holder"
mv -n -T -- "$AIDA_SET_TMP" "$AIDA_SET_FINAL" 2>>"$BACKUP_ERRLOG"
[ -d "$AIDA_SET_FINAL" ] && [ ! -e "$AIDA_SET_TMP" ]
EOF
set +e
fenced_action "$SET_ID" "$RUN_TMP/publish.sh"
_pub=$?
set -e
if [ "$_pub" -eq 3 ]; then
  restore_skip
fi
if [ "$_pub" -eq 4 ]; then
  on_lease_lost
fi
if [ "$_pub" -ne 0 ]; then
  if [ -d "$SET_FINAL" ] && [ ! -e "$SET_TMP" ]; then
    # The rename happened but the commit did not report back: the set is complete, keep it.
    PUBLISHED=1
  fi
  step_failed storage
fi
PUBLISHED=1

# Retention under the owned lease, after publish and before the status write (D-03, P6, Q8). A
# failed removal is logged; the published set stands.
set +e
retention "$SET_ID" "$BACKUP_RETENTION"
_ret=$?
set -e
if [ "$_ret" -eq 3 ]; then
  restore_skip
fi
if [ "$_ret" -eq 4 ]; then
  on_lease_lost
fi
if [ "$_ret" -ne 0 ]; then
  log 'backup retention incomplete'
fi

set +e
write_status succeeded "$SET_ID" -
_st=$?
set -e
if [ "$_st" -eq 3 ]; then
  restore_skip
fi
if [ "$_st" -eq 4 ]; then
  on_lease_lost
fi
OUTCOME=succeeded
log "backup succeeded: $SET_ID"
if [ "$_st" -ne 0 ]; then
  exit 5
fi
exit 0
