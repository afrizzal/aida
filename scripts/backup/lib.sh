# shellcheck shell=sh
# scripts/backup/lib.sh: the functions of one AIDA backup run (Phase 9 plan 09-06, AIDA-33).
#
# Sourced by scripts/backup/aida-backup.sh. POSIX sh (dash in the pgvector/pgvector:pg16 image
# the db service uses), safe under `set -eu`: every function returns a status and never exits.
#
# Database access uses the libpq variables only (PGHOST, PGPORT, PGUSER, PGPASSWORD,
# PGDATABASE), never a connection URL. Tool error output goes to BACKUP_ERRLOG, a file in the
# run's private temporary directory that is never printed. Log lines are fixed text: no value
# from the environment, no path, hostname, secret, raw error text or tenant data.
#
# Backup side of the file fence (contract of plan 09-04, deleter side in
# src/lib/storage/file-fence.ts; tests/unit/backup-contract.test.ts asserts that both sides use
# the same key, lease key, lease fields, predicate and identity key):
# - the exclusive session-level advisory lock on FILE_FENCE_KEY_SQL, held by a dedicated psql
#   session with application_name aida-backup-fence for the whole run (fence_open, fence_close);
# - the committed lease SystemSetting `backup:lease` = {"holder": "<setId>", "expiresAt": "<ISO
#   UTC>"}, expiry computed and judged by the database clock (now()), acquired only when no
#   unexpired lease exists, renewed while the run lasts and deleted only by its own holder;
# - fenced_action: one psql session locks the lease row FOR UPDATE, checks holder and expiry and
#   runs the action before it commits, so no takeover lands between the check and the action.

FILE_FENCE_KEY_SQL="hashtextextended('aida:file-fence', 0)"
BACKUP_LEASE_KEY='backup:lease'
BACKUP_STATUS_KEY='backup:lastRun'
UPLOADS_VOLUME_ID_KEY='uploads:volume-id'
UPLOADS_MARKER_NAME='.aida-uploads-volume'
BACKUP_FENCE_APPLICATION_NAME='aida-backup-fence'
BACKUP_APPLICATION_NAME='aida-backup'

# The ISO 8601 pattern of the deleter's lease check (file-fence.ts ISO_TIMESTAMP_SOURCE).
LEASE_ISO_RE='^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(\.[0-9]{1,6})?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$'

# Archive members: <organizationId>/<storageKey>, the shape local-file-storage.ts writes. One rule
# for backup and restore (b-IN-1): the organization part is 1 to 64 of [A-Za-z0-9_-] and never
# starts with "-", so a folder the restore would refuse is skipped by the backup (and a row that
# references a file in it fails verification) instead of being published. Find matches the whole
# path, so the find patterns carry the leading "./".
MEMBER_ORG_RE='[A-Za-z0-9_][A-Za-z0-9_-]{0,63}'
MEMBER_KEY_RE='[a-z0-9]+\.[a-z0-9]{1,8}'
MEMBER_PATH_RE="$MEMBER_ORG_RE/$MEMBER_KEY_RE"
MEMBER_DIR_FIND_RE="\\./$MEMBER_ORG_RE"
MEMBER_FIND_RE="\\./$MEMBER_PATH_RE"

log() {
  printf '[backup] %s\n' "$1"
}

is_uint() {
  case $1 in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# A set id: UTC time to the second, a dash and 6 random hex characters.
new_set_id() {
  _nsi_hex=$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n') || return 1
  _nsi_time=$(date -u +%Y%m%dT%H%M%SZ) || return 1
  printf '%s-%s\n' "$_nsi_time" "$_nsi_hex"
}

valid_set_id() {
  [ "${#1}" -eq 23 ] || return 1
  printf '%s\n' "$1" | grep -Eqx '[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}'
}

# A restore holder (plan 09-10 takes the restore lock and the lease with it): "restore-" and 32
# random hex characters.
new_restore_holder() {
  _nrh_hex=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || return 1
  printf 'restore-%s\n' "$_nrh_hex"
}

valid_restore_holder() {
  [ "${#1}" -eq 40 ] || return 1
  printf '%s\n' "$1" | grep -Eqx 'restore-[0-9a-f]{32}'
}

# A lease holder: a backup run's set id or a restore holder.
valid_lease_holder() {
  valid_set_id "$1" || valid_restore_holder "$1"
}

# K143: every libpq connection (psql, pg_dump, pg_restore, the fence session) gives up on a
# connect that gets no answer, for example a paused or unreachable `db`, after this many seconds.
PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-10}
export PGCONNECT_TIMEOUT

# True once BACKUP_RUN_DEADLINE (UTC epoch seconds, set by aida-backup.sh) has passed, or once
# `bounded` recorded that timeout(1) ended a command at it (BACKUP_DEADLINE_MARK exists, K177).
# The mark comes first: timeout(1) counts on the monotonic clock, while the wall clock read here
# can be stepped back by the host's or a VM's time sync. A command ended a few milliseconds past
# the deadline then read as ended before it, and the run reported the step's own failure.
deadline_passed() {
  if [ -n "${BACKUP_DEADLINE_MARK:-}" ] && [ -e "$BACKUP_DEADLINE_MARK" ]; then
    return 0
  fi
  is_uint "${BACKUP_RUN_DEADLINE:-}" || return 1
  [ "$(date -u +%s)" -ge "$BACKUP_RUN_DEADLINE" ]
}

# bounded <command...>: runs the command. While BACKUP_RUN_DEADLINE is set and timeout(1)
# exists, the command gets TERM at the deadline (at least 1 s from now) and KILL 10 s later,
# so a hung psql, pg_dump, pg_restore, find or tar cannot hold a run past its deadline (K143).
# Exit 124 is timeout(1)'s own status for a command it ended with TERM (none of these tools
# exits 124 itself); bounded then creates BACKUP_DEADLINE_MARK when it is set (K177). Returns
# the command's status (124 when timed out), as before.
bounded() {
  if is_uint "${BACKUP_RUN_DEADLINE:-}" && command -v timeout >/dev/null 2>&1; then
    _bd_left=$((BACKUP_RUN_DEADLINE - $(date -u +%s)))
    [ "$_bd_left" -ge 1 ] || _bd_left=1
    _bd_rc=0
    timeout -k 10 "$_bd_left" "$@" || _bd_rc=$?
    if [ "$_bd_rc" = 124 ] && [ -n "${BACKUP_DEADLINE_MARK:-}" ]; then
      (: >"$BACKUP_DEADLINE_MARK") 2>/dev/null || :
    fi
    return "$_bd_rc"
  else
    "$@"
  fi
}

psql_q() {
  bounded env PGAPPNAME="$BACKUP_APPLICATION_NAME" psql -X -q -t -A -v ON_ERROR_STOP=1 "$@" \
    2>>"${BACKUP_ERRLOG:-/dev/null}"
}

# The deleter's lease predicate (file-fence.ts leaseValueActiveSql), byte for byte: true only
# for a JSON object whose expiresAt is an ISO timestamp later than the database's now().
lease_active_sql() {
  printf '%s\n' "CASE WHEN $1 IS JSON OBJECT THEN
    CASE WHEN jsonb_typeof(($1)::jsonb -> 'expiresAt') = 'string'
           AND (($1)::jsonb ->> 'expiresAt') ~ '${LEASE_ISO_RE}'
           AND pg_input_is_valid(($1)::jsonb ->> 'expiresAt', 'timestamptz')
      THEN (($1)::jsonb ->> 'expiresAt')::timestamptz > now()
      ELSE false END
  ELSE false END"
}

# True when the lease value names the psql variable :holder as its holder.
lease_holder_sql() {
  printf '%s\n' "CASE WHEN $1 IS JSON OBJECT THEN COALESCE((($1)::jsonb ->> 'holder') = :'holder', false) ELSE false END"
}

# The lease value for the psql variables :holder and :ttl, expiry from the database clock.
lease_value_sql() {
  printf '%s\n' "json_build_object('holder', :'holder'::text, 'expiresAt', to_char((now() + make_interval(secs => :'ttl'::double precision)) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))::text"
}

# Prints t when an unexpired lease exists (any holder), f otherwise.
lease_active() {
  psql_q <<SQL
SELECT COALESCE((
  SELECT $(lease_active_sql 's.value')
  FROM "SystemSetting" s
  WHERE s.key = '${BACKUP_LEASE_KEY}'
), false) AS active;
SQL
}

# lease_acquire <holder> <ttl>: writes the lease only when no unexpired lease exists. Prints
# "acquired" or "held".
lease_acquire() {
  valid_lease_holder "$1" || return 1
  is_uint "$2" || return 1
  _la_out=$(psql_q -v holder="$1" -v ttl="$2" <<SQL
INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
VALUES (gen_random_uuid()::text, '${BACKUP_LEASE_KEY}', $(lease_value_sql), now())
ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()
WHERE NOT ($(lease_active_sql '"SystemSetting".value'))
RETURNING 'acquired';
SQL
) || return 1
  if [ "$_la_out" = acquired ]; then
    printf 'acquired\n'
  else
    printf 'held\n'
  fi
}

# lease_renew <holder> <ttl>: extends the lease only while the holder matches and the lease is
# unexpired. Prints the number of rows changed (1 or 0). The holder is a backup run's set id or,
# during the migrate deploy after a restore (K157), a restore holder.
lease_renew() {
  valid_lease_holder "$1" || return 1
  is_uint "$2" || return 1
  psql_q -v holder="$1" -v ttl="$2" <<SQL
WITH renewed AS (
  UPDATE "SystemSetting" SET value = $(lease_value_sql), "updatedAt" = now()
  WHERE key = '${BACKUP_LEASE_KEY}'
    AND ($(lease_holder_sql value))
    AND ($(lease_active_sql value))
  RETURNING 1
)
SELECT count(*) FROM renewed;
SQL
}

# lease_release <holder>: deletes the lease only when it is the caller's own.
lease_release() {
  valid_lease_holder "$1" || return 1
  psql_q -v holder="$1" >/dev/null <<SQL
DELETE FROM "SystemSetting"
WHERE key = '${BACKUP_LEASE_KEY}' AND ($(lease_holder_sql value));
SQL
}

# True when the marker in UPLOADS_DIR is a regular file holding exactly the database's
# `uploads:volume-id` (plan 09-04 identity).
uploads_identity_ok() {
  _ui_marker="$UPLOADS_DIR/$UPLOADS_MARKER_NAME"
  [ -f "$_ui_marker" ] && [ ! -L "$_ui_marker" ] || return 1
  _ui_mark=$(cat "$_ui_marker" 2>/dev/null) || return 1
  _ui_id=$(psql_q -c "SELECT value FROM \"SystemSetting\" WHERE key = '${UPLOADS_VOLUME_ID_KEY}'") ||
    return 1
  printf '%s\n' "$_ui_id" | grep -Eqx '[0-9a-f]{32}' || return 1
  [ "$_ui_mark" = "$_ui_id" ]
}

# fence_open <wait seconds>: starts the dedicated fence session (application_name
# aida-backup-fence) reading statements from a FIFO in RUN_TMP, takes the exclusive advisory lock
# with lock_timeout = the wait, and waits for the marker line that follows the lock. Returns 0
# with the lock held. Otherwise returns 1 and sets FENCE_FAILURE to "busy" (the lock was not
# granted within the wait) or "error" (the session ended for another reason).
fence_open() {
  FENCE_FAILURE=error
  is_uint "$1" && [ "$1" -ge 1 ] || return 1
  FENCE_FIFO="$RUN_TMP/fence.in"
  FENCE_OUT="$RUN_TMP/fence.out"
  FENCE_ERR="$RUN_TMP/fence.err"
  FENCE_EXIT="$RUN_TMP/fence.exit"
  FENCE_PROBE=0
  mkfifo "$FENCE_FIFO" || return 1
  : >"$FENCE_OUT"
  # The subshell records psql's exit status in a file: a finished background job can stay a
  # zombie that kill -0 still reports as alive.
  (
    PGAPPNAME="$BACKUP_FENCE_APPLICATION_NAME" psql -X -q -t -A -v ON_ERROR_STOP=1 \
      <"$FENCE_FIFO" >"$FENCE_OUT" 2>"$FENCE_ERR"
    printf '%s\n' "$?" >"$FENCE_EXIT"
  ) &
  FENCE_PID=$!
  exec 7>"$FENCE_FIFO"
  FENCE_FD_OPEN=1
  printf '%s\n' \
    '\set VERBOSITY sqlstate' \
    "SET lock_timeout = '${1}s';" \
    "SELECT pg_advisory_lock(${FILE_FENCE_KEY_SQL});" \
    'SET lock_timeout = 0;' \
    "SELECT 'fence-held';" >&7 2>/dev/null || return 1
  _fo_limit=$((($1 + 15) * 10))
  _fo_i=0
  while :; do
    if grep -qx 'fence-held' "$FENCE_OUT" 2>/dev/null; then
      FENCE_HELD=1
      return 0
    fi
    if [ -e "$FENCE_EXIT" ]; then
      # 55P03 lock_not_available: lock_timeout expired while the deleter held the shared side.
      if grep -q '55P03' "$FENCE_ERR" 2>/dev/null; then FENCE_FAILURE=busy; fi
      return 1
    fi
    _fo_i=$((_fo_i + 1))
    if [ "$_fo_i" -ge "$_fo_limit" ]; then
      FENCE_FAILURE=busy
      return 1
    fi
    sleep 0.1
  done
}

# True when the fence session is still connected and still holds the exclusive lock: a probe
# statement through the session itself (a terminated backend makes psql exit).
fence_alive() {
  [ "${FENCE_HELD:-0}" = 1 ] && [ "${FENCE_FD_OPEN:-0}" = 1 ] || return 1
  [ ! -e "$FENCE_EXIT" ] || return 1
  FENCE_PROBE=$((FENCE_PROBE + 1))
  printf '%s\n' "WITH k AS (SELECT ${FILE_FENCE_KEY_SQL} AS key)
SELECT 'fence-alive-${FENCE_PROBE}' FROM pg_locks l CROSS JOIN k
WHERE l.pid = pg_backend_pid() AND l.locktype = 'advisory' AND l.objsubid = 1
  AND l.classid = ((k.key >> 32) & 4294967295)::oid AND l.objid = (k.key & 4294967295)::oid
  AND l.mode = 'ExclusiveLock' AND l.granted;
SELECT 'fence-probe-${FENCE_PROBE}';" >&7 2>/dev/null || return 1
  _fa_i=0
  while [ "$_fa_i" -lt 100 ]; do
    if grep -qx "fence-probe-${FENCE_PROBE}" "$FENCE_OUT" 2>/dev/null; then
      grep -qx "fence-alive-${FENCE_PROBE}" "$FENCE_OUT"
      return
    fi
    [ ! -e "$FENCE_EXIT" ] || return 1
    _fa_i=$((_fa_i + 1))
    sleep 0.1
  done
  return 1
}

# Releases the lock and ends the fence session. Safe to call more than once and after a drop.
fence_close() {
  [ "${FENCE_FD_OPEN:-0}" = 1 ] || return 0
  if [ "${FENCE_HELD:-0}" = 1 ] && [ ! -e "$FENCE_EXIT" ]; then
    printf '%s\n' "SELECT pg_advisory_unlock(${FILE_FENCE_KEY_SQL});" '\q' >&7 2>/dev/null || :
  fi
  exec 7>&-
  FENCE_FD_OPEN=0
  FENCE_HELD=0
  # A lock request still waiting ends at its lock_timeout; the session then exits.
  wait "$FENCE_PID" 2>/dev/null || :
}

# fenced_action <holder> <script>: in one psql session, locks the lease row FOR UPDATE, checks
# that no restore lock exists in BACKUP_DIR (review Q3: a shell test run with \! inside the
# locked session, immediately before the action) and that <holder> owns an unexpired lease, and
# runs `sh <script>` before it commits. Returns 0 when the action ran and succeeded, 3 when a
# restore lock exists (nothing ran), 4 when the lease is not owned (nothing ran), 1 otherwise.
# The script path must not contain spaces (it lives in the run's mktemp directory).
fenced_action() {
  valid_set_id "$1" || return 1
  case $2 in
    '' | *[!A-Za-z0-9._/-]*) return 1 ;;
  esac
  AIDA_RESTORE_LOCK_PATH=$(restore_lock_dir) || return 1
  export AIDA_RESTORE_LOCK_PATH
  _fa_out=$(psql_q -v holder="$1" <<SQL
BEGIN;
WITH locked AS MATERIALIZED (
  SELECT value FROM "SystemSetting" WHERE key = '${BACKUP_LEASE_KEY}' FOR UPDATE
)
SELECT COALESCE((
  SELECT ($(lease_holder_sql value)) AND ($(lease_active_sql value)) FROM locked
), false) AS owned \gset
\! test ! -e "\$AIDA_RESTORE_LOCK_PATH" && test ! -L "\$AIDA_RESTORE_LOCK_PATH"
SELECT :SHELL_EXIT_CODE = 0 AS no_restore_lock \gset
\if :no_restore_lock
\if :owned
\! sh $2
SELECT :SHELL_EXIT_CODE = 0 AS action_ok \gset
\if :action_ok
COMMIT;
\echo fenced-done
\else
ROLLBACK;
\echo fenced-action-failed
\endif
\else
ROLLBACK;
\echo fenced-not-owned
\endif
\else
ROLLBACK;
\echo fenced-restore-lock
\endif
SQL
) || return 1
  case $_fa_out in
    *fenced-done) return 0 ;;
    *fenced-restore-lock) return 3 ;;
    *fenced-not-owned) return 4 ;;
    *) return 1 ;;
  esac
}

# Restore lock (review Q3, shared with plan 09-10): the directory BACKUP_DIR/.restore-lock with
# the files `holder` (the restore holder) and `heartbeat` (UTC epoch seconds), each written to a
# temporary file in the directory and renamed. It lives on the backups volume, so it survives a
# database replacement. It is never taken over automatically.
restore_lock_dir() {
  printf '%s/.restore-lock\n' "${BACKUP_DIR:-/backups}"
}

# restore_lock_write <dir> <name> <value>: <dir>/<name> = <value>, temporary file then rename.
restore_lock_write() {
  (printf '%s\n' "$3" >"$1/.$2.tmp") 2>/dev/null || return 1
  mv -f -T -- "$1/.$2.tmp" "$1/$2" 2>/dev/null
}

# True while a restore lock (or anything at its path) exists.
restore_lock_present() {
  _rlp_dir=$(restore_lock_dir) || return 1
  [ -e "$_rlp_dir" ] || [ -L "$_rlp_dir" ]
}

# restore_lock_acquire <holder>: creates the lock with an atomic mkdir; fails when the directory
# exists. Writes holder and heartbeat; on a write failure removes the directory it created.
restore_lock_acquire() {
  valid_restore_holder "$1" || return 1
  _rla_dir=$(restore_lock_dir) || return 1
  mkdir -- "$_rla_dir" 2>/dev/null || return 1
  _rla_now=$(date -u +%s) || _rla_now=''
  if is_uint "$_rla_now" && restore_lock_write "$_rla_dir" holder "$1" &&
    restore_lock_write "$_rla_dir" heartbeat "$_rla_now"; then
    return 0
  fi
  rm -r -- "$_rla_dir" </dev/null 2>/dev/null || :
  return 1
}

# Prints the holder stored in the lock; fails when there is no readable lock.
restore_lock_holder() {
  _rlh_dir=$(restore_lock_dir) || return 1
  [ -d "$_rlh_dir" ] && [ ! -L "$_rlh_dir" ] || return 1
  [ -f "$_rlh_dir/holder" ] && [ ! -L "$_rlh_dir/holder" ] || return 1
  head -c 64 "$_rlh_dir/holder" 2>/dev/null
}

# restore_lock_heartbeat <holder>: renews the heartbeat only when the stored holder is <holder>;
# returns 1 otherwise (the restore that called it must stop).
restore_lock_heartbeat() {
  valid_restore_holder "$1" || return 1
  _rlb_holder=$(restore_lock_holder) || return 1
  [ "$_rlb_holder" = "$1" ] || return 1
  _rlb_now=$(date -u +%s) || return 1
  is_uint "$_rlb_now" || return 1
  restore_lock_write "$(restore_lock_dir)" heartbeat "$_rlb_now"
}

# restore_lock_release <holder>: removes the lock directory only when the stored holder is
# <holder>; returns 1 otherwise and changes nothing.
restore_lock_release() {
  valid_restore_holder "$1" || return 1
  _rlr_holder=$(restore_lock_holder) || return 1
  [ "$_rlr_holder" = "$1" ] || return 1
  rm -r -- "$(restore_lock_dir)" </dev/null 2>/dev/null
}

# restore_lock_age: prints the age of the stored heartbeat in whole seconds (now minus heartbeat,
# never negative); fails when there is no readable lock or heartbeat.
restore_lock_age() {
  _rlg_dir=$(restore_lock_dir) || return 1
  [ -f "$_rlg_dir/heartbeat" ] && [ ! -L "$_rlg_dir/heartbeat" ] || return 1
  _rlg_beat=$(head -c 20 "$_rlg_dir/heartbeat" 2>/dev/null) || return 1
  is_uint "$_rlg_beat" || return 1
  _rlg_now=$(date -u +%s) || return 1
  is_uint "$_rlg_now" || return 1
  if [ "$_rlg_now" -le "$_rlg_beat" ]; then
    printf '0\n'
  else
    printf '%s\n' "$((_rlg_now - _rlg_beat))"
  fi
}

# restore_lock_break_stale <holder> <min age seconds>: the explicit operator action behind
# `scripts/restore.sh --break-stale-lock` (review Q3; never automatic). Removes the lock only when
# the stored holder is <holder> and the heartbeat is older than <min age>. Returns 0 when removed,
# 1 when there is no readable lock, 2 when the holder differs, 3 when the heartbeat is too recent
# (or unreadable), 4 when the removal failed.
restore_lock_break_stale() {
  valid_restore_holder "$1" || return 1
  is_uint "$2" || return 1
  _rbs_holder=$(restore_lock_holder) || return 1
  [ "$_rbs_holder" = "$1" ] || return 2
  _rbs_age=$(restore_lock_age) || return 3
  [ "$_rbs_age" -gt "$2" ] || return 3
  restore_lock_release "$1" || return 4
}

# Archive members of a set (plan 09-10): MEMBER_PATH_RE above, the shape aida-backup.sh archives.

# valid_member_path <path>: true for one member path of the shape above (no absolute path, no
# "..", no ".", no leading "-", no control character or newline, never the volume marker).
valid_member_path() {
  case $1 in
    -* | *'
'*) return 1 ;;
  esac
  printf '%s\n' "$1" | grep -Eqx "$MEMBER_PATH_RE"
}

# member_list_ok <file>: true when every line of <file> is a valid member path and no path
# appears twice. Lines come from `tar --quoting-style=escape`, so a name holding a newline or a
# control character shows a backslash and fails the pattern.
member_list_ok() {
  [ -f "$1" ] || return 1
  if grep -Evx "$MEMBER_PATH_RE" "$1" >/dev/null; then return 1; fi
  if grep -E '^-' "$1" >/dev/null; then return 1; fi
  [ -z "$(sort "$1" | uniq -d)" ]
}

# retention_prune <dir> <keep> <current setId>: the body of one retention pass (D-03), run only
# inside fenced_action (see retention). Keeps the <keep> newest set directories, newest by name
# (the set id starts with its UTC time, so name order is time order), and removes every older one
# whole. Removes every `.tmp-<setId>` directory whose holder file does not name the current run.
# Only names that pass valid_set_id, as plain directories (no link), are ever removed, with
# `rm -r --`; every other entry (`.restore-lock`, `.restore-staging-*`, `status-unrecorded-*`,
# anything else) is left alone. Returns 1 when a removal failed.
retention_prune() {
  _rp_dir=$1
  _rp_keep=$2
  _rp_self=$3
  is_uint "$_rp_keep" && [ "$_rp_keep" -ge 1 ] || return 1
  valid_set_id "$_rp_self" || return 1
  [ -d "$_rp_dir" ] && [ ! -L "$_rp_dir" ] || return 1
  _rp_sets=''
  for _rp_path in "$_rp_dir"/*; do
    _rp_name=${_rp_path##*/}
    if valid_set_id "$_rp_name" && [ -d "$_rp_path" ] && [ ! -L "$_rp_path" ]; then
      _rp_sets="$_rp_sets$_rp_name
"
    fi
  done
  _rp_failed=0
  _rp_i=0
  # Validated names only: no space, glob or newline can reach the word splitting below.
  for _rp_name in $(printf '%s' "$_rp_sets" | sort -r); do
    _rp_i=$((_rp_i + 1))
    if [ "$_rp_i" -gt "$_rp_keep" ] && [ "$_rp_name" != "$_rp_self" ]; then
      rm -r -- "$_rp_dir/$_rp_name" </dev/null 2>>"${BACKUP_ERRLOG:-/dev/null}" || _rp_failed=1
    fi
  done
  for _rp_path in "$_rp_dir"/.tmp-*; do
    _rp_name=${_rp_path##*/}
    _rp_id=${_rp_name#.tmp-}
    valid_set_id "$_rp_id" || continue
    [ -d "$_rp_path" ] && [ ! -L "$_rp_path" ] || continue
    _rp_holder=''
    if [ -f "$_rp_path/holder" ] && [ ! -L "$_rp_path/holder" ]; then
      _rp_holder=$(head -c 64 "$_rp_path/holder" 2>/dev/null) || _rp_holder=''
    fi
    [ "$_rp_holder" != "$_rp_self" ] || continue
    rm -r -- "$_rp_path" </dev/null 2>>"${BACKUP_ERRLOG:-/dev/null}" || _rp_failed=1
  done
  [ "$_rp_failed" = 0 ]
}

# retention <holder> <keep>: one retention pass over BACKUP_DIR through fenced_action, so only the
# owner of an unexpired lease prunes (no live run's temporary directory is removed). Needs
# RUN_TMP (the action script lives there) and AIDA_BACKUP_LIB (this file). Returns what
# fenced_action returns.
retention() {
  valid_set_id "$1" || return 1
  is_uint "$2" && [ "$2" -ge 1 ] || return 1
  [ -n "${RUN_TMP:-}" ] && [ -d "$RUN_TMP" ] && [ -n "${AIDA_BACKUP_LIB:-}" ] || return 1
  AIDA_RETENTION_DIR=${BACKUP_DIR:-/backups}
  AIDA_RETENTION_KEEP=$2
  AIDA_RETENTION_SELF=$1
  export AIDA_RETENTION_DIR AIDA_RETENTION_KEEP AIDA_RETENTION_SELF AIDA_BACKUP_LIB
  cat >"$RUN_TMP/retention.sh" <<'EOF' || return 1
set -eu
. "$AIDA_BACKUP_LIB"
retention_prune "$AIDA_RETENTION_DIR" "$AIDA_RETENTION_KEEP" "$AIDA_RETENTION_SELF"
EOF
  fenced_action "$1" "$RUN_TMP/retention.sh"
}

# record_status <succeeded|failed> <setId|-> <category|->: upserts `backup:lastRun` with exactly
# the keys finishedAt, result, setId and category (D-04). Nothing else goes into the record.
record_status() {
  status_args_ok "$1" "$2" "$3" || return 1
  psql_q -v result="$1" -v setid="$2" -v category="$3" >/dev/null <<SQL
INSERT INTO "SystemSetting" (id, key, value, "updatedAt")
VALUES (
  gen_random_uuid()::text,
  '${BACKUP_STATUS_KEY}',
  json_build_object(
    'finishedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', :'result'::text,
    'setId', NULLIF(:'setid'::text, '-'),
    'category', NULLIF(:'category'::text, '-')
  )::text,
  now()
)
ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now();
SQL
}

status_args_ok() {
  case $1 in
    succeeded | failed) ;;
    *) return 1 ;;
  esac
  case $3 in
    dump | archive | verification | storage | unknown | -) ;;
    *) return 1 ;;
  esac
  if [ "$2" != - ]; then valid_set_id "$2" || return 1; fi
}

# status_json <finishedAt> <succeeded|failed> <setId|-> <category|->: the `backup:lastRun`
# record as one JSON line with exactly the keys finishedAt, result, setId and category (D-04).
status_json() {
  printf '%s\n' "$1" | grep -Eqx '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z' ||
    return 1
  status_args_ok "$2" "$3" "$4" || return 1
  _sj_set=null
  [ "$3" = - ] || _sj_set="\"$3\""
  _sj_cat=null
  [ "$4" = - ] || _sj_cat="\"$4\""
  printf '{"finishedAt":"%s","result":"%s","setId":%s,"category":%s}\n' "$1" "$2" "$_sj_set" \
    "$_sj_cat"
}

# status_unrecorded <run setId|-> <succeeded|failed> <setId|-> <category|->: the defined "status
# could not be recorded" condition (D-04, P6, Q8). Prints one stderr line
# `AIDA_BACKUP_STATUS_UNRECORDED <json>` with the record's four keys, then writes the same JSON
# to `$BACKUP_DIR/status-unrecorded-<run setId>.json` (temporary file, then a rename that never
# replaces an existing file; a failure is logged). Nothing ever removes such a file: set ids are
# unique per run and retention leaves every name but sets and `.tmp-<setId>` alone.
status_unrecorded() {
  _su_time=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null) || _su_time=''
  _su_json=$(status_json "$_su_time" "$2" "$3" "$4") ||
    _su_json=$(status_json "$(date -u +%Y-%m-%dT%H:%M:%S).000Z" "$2" "$3" "$4") || return 1
  printf 'AIDA_BACKUP_STATUS_UNRECORDED %s\n' "$_su_json" >&2 || :
  log 'backup status not recorded'
  if ! valid_set_id "$1"; then
    log 'backup status record file not written'
    return 0
  fi
  _su_dir=${BACKUP_DIR:-/backups}
  _su_final="$_su_dir/status-unrecorded-$1.json"
  _su_part="$_su_dir/.status-unrecorded-$1.json.part"
  if (printf '%s\n' "$_su_json" >"$_su_part") 2>/dev/null &&
    mv -n -T -- "$_su_part" "$_su_final" 2>/dev/null &&
    [ -f "$_su_final" ] && [ ! -e "$_su_part" ]; then
    return 0
  fi
  rm -f -- "$_su_part" 2>/dev/null || :
  log 'backup status record file not written'
  return 0
}

# pause_point <name>: test synchronisation only. With BACKUP_TEST_PAUSE_DIR set, writes
# <name>.reached there and waits for <name>.go, at most BACKUP_TEST_PAUSE_MAX_SECONDS (default
# 120); returns 1 on timeout. Without the variable it does nothing.
pause_point() {
  [ -n "${BACKUP_TEST_PAUSE_DIR:-}" ] || return 0
  case $1 in
    '' | *[!a-z-]*) return 1 ;;
  esac
  _pp_max=${BACKUP_TEST_PAUSE_MAX_SECONDS:-120}
  is_uint "$_pp_max" || return 1
  # The file holds the main script's process id (dash keeps $$ in subshells), so a test can kill
  # that process alone (K143).
  printf '%s\n' "$$" >"$BACKUP_TEST_PAUSE_DIR/$1.reached" || return 1
  _pp_limit=$((_pp_max * 10))
  _pp_i=0
  while [ ! -e "$BACKUP_TEST_PAUSE_DIR/$1.go" ]; do
    _pp_i=$((_pp_i + 1))
    [ "$_pp_i" -le "$_pp_limit" ] || return 1
    sleep 0.1
  done
}
