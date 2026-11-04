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

# Archive members: <organizationId>/<storageKey>, the shape local-file-storage.ts writes. Find
# matches the whole path, so the patterns below carry the leading "./".
MEMBER_DIR_FIND_RE='\./[A-Za-z0-9_-]{1,64}'
MEMBER_FIND_RE='\./[A-Za-z0-9_-]{1,64}/[a-z0-9]+\.[a-z0-9]{1,8}'

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

psql_q() {
  PGAPPNAME="$BACKUP_APPLICATION_NAME" psql -X -q -t -A -v ON_ERROR_STOP=1 "$@" \
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
  valid_set_id "$1" || return 1
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
# unexpired. Prints the number of rows changed (1 or 0).
lease_renew() {
  valid_set_id "$1" || return 1
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
  valid_set_id "$1" || return 1
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
# that <holder> owns an unexpired lease and runs `sh <script>` before it commits. Returns 0 when
# the action ran and succeeded, 4 when the lease is not owned (nothing ran), 1 otherwise. The
# script path must not contain spaces (it lives in the run's mktemp directory).
fenced_action() {
  valid_set_id "$1" || return 1
  case $2 in
    '' | *[!A-Za-z0-9._/-]*) return 1 ;;
  esac
  _fa_out=$(psql_q -v holder="$1" <<SQL
BEGIN;
WITH locked AS MATERIALIZED (
  SELECT value FROM "SystemSetting" WHERE key = '${BACKUP_LEASE_KEY}' FOR UPDATE
)
SELECT COALESCE((
  SELECT ($(lease_holder_sql value)) AND ($(lease_active_sql value)) FROM locked
), false) AS owned \gset
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
SQL
) || return 1
  case $_fa_out in
    *fenced-done) return 0 ;;
    *fenced-not-owned) return 4 ;;
    *) return 1 ;;
  esac
}

# record_status <succeeded|failed> <setId|-> <category|->: upserts `backup:lastRun` with exactly
# the keys finishedAt, result, setId and category (D-04). Nothing else goes into the record.
record_status() {
  case $1 in
    succeeded | failed) ;;
    *) return 1 ;;
  esac
  case $3 in
    dump | archive | verification | storage | unknown | -) ;;
    *) return 1 ;;
  esac
  if [ "$2" != - ]; then valid_set_id "$2" || return 1; fi
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
  : >"$BACKUP_TEST_PAUSE_DIR/$1.reached" || return 1
  _pp_limit=$((_pp_max * 10))
  _pp_i=0
  while [ ! -e "$BACKUP_TEST_PAUSE_DIR/$1.go" ]; do
    _pp_i=$((_pp_i + 1))
    [ "$_pp_i" -le "$_pp_limit" ] || return 1
    sleep 0.1
  done
}
