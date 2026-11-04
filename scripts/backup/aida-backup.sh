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
# Order of one run: set id; skip when another run's lease is active; uploads volume identity
# (marker equals `uploads:volume-id`); exclusive file fence; lease; lease renewal in the
# background; dump; list of archivable files; archive; checksums from the archive; every file the
# dump references (Attachment, TaskAttachment, the `branding:logo` Setting) must be in the
# archive; manifest; validation; publish; status `backup:lastRun`. On every exit path the trap
# stops the renewal, records a failed status when none was recorded, releases its own lease and
# the fence, and removes its own .tmp-<setId> unless it was published.
#
# Exit codes: 0 succeeded, 2 failed, 3 skipped (another run holds the lease; nothing touched).
#
# Settings (environment):
#   BACKUP_DIR (default /backups), UPLOADS_DIR (default /data/uploads),
#   BACKUP_LEASE_TTL_SECONDS (900), BACKUP_FENCE_WAIT_SECONDS (300),
#   BACKUP_DUMP_LOCK_TIMEOUT (300s), BACKUP_APP_VERSION_FILE
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

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/data/uploads}
BACKUP_LEASE_TTL_SECONDS=${BACKUP_LEASE_TTL_SECONDS:-900}
BACKUP_FENCE_WAIT_SECONDS=${BACKUP_FENCE_WAIT_SECONDS:-300}
BACKUP_DUMP_LOCK_TIMEOUT=${BACKUP_DUMP_LOCK_TIMEOUT:-300s}
BACKUP_APP_VERSION_FILE=${BACKUP_APP_VERSION_FILE:-/opt/aida-backup-meta/package.json}

RUN_TMP=''
SET_ID=''
SET_TMP=''
SET_FINAL=''
CATEGORY=unknown
OUTCOME=failed
SKIPPED=0
LEASE_HELD=0
PUBLISHED=0
STATUS_RECORDED=0
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
  if [ "$OUTCOME" = succeeded ]; then
    _rc=0
  elif [ "$SKIPPED" = 1 ]; then
    _rc=3
  else
    _rc=2
    if [ "$STATUS_RECORDED" = 0 ]; then
      record_status failed - "$CATEGORY" || log 'backup status not recorded'
    fi
    log "backup failed: $CATEGORY"
  fi
  if [ "$LEASE_HELD" = 1 ]; then
    lease_release "$SET_ID" || :
  fi
  fence_close
  if [ "$PUBLISHED" = 0 ] && [ -n "$SET_TMP" ] && [ -d "$SET_TMP" ]; then
    rm -rf -- "$SET_TMP"
  fi
  if [ -n "$RUN_TMP" ] && [ -d "$RUN_TMP" ]; then
    rm -rf -- "$RUN_TMP"
  fi
  exit "$_rc"
}

fail() {
  CATEGORY=$1
  exit 2
}

# A failed step: a write probe in the set directory tells a storage failure from the step's own.
step_failed() {
  _sf_dir=${SET_TMP:-$BACKUP_DIR}
  if ! (printf 'probe\n' >"$_sf_dir/.write-probe") 2>/dev/null; then
    fail storage
  fi
  rm -f -- "$_sf_dir/.write-probe"
  fail "$1"
}

on_lease_lost() {
  trap '' USR1
  log 'backup aborted: lease lost'
  fail unknown
}

renew_loop() {
  _rl_interval=$((BACKUP_LEASE_TTL_SECONDS / 3))
  [ "$_rl_interval" -ge 1 ] || _rl_interval=1
  _rl_sleep=''
  trap 'kill "$_rl_sleep" 2>/dev/null; exit 0' TERM
  while :; do
    sleep "$_rl_interval" &
    _rl_sleep=$!
    wait "$_rl_sleep" || :
    _rl_count=$(lease_renew "$SET_ID" "$BACKUP_LEASE_TTL_SECONDS") || _rl_count=error
    if [ "$_rl_count" != 1 ]; then
      : >"$RUN_TMP/lease.lost"
      kill -s USR1 "$MAIN_PID" 2>/dev/null || :
      exit 0
    fi
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

# Every <organizationId>/<storageKey> the dump references in table $1 (column $2 holds the key,
# or for Setting the `branding:logo` row's JSON value), one per line.
referenced_from_dump() {
  pg_restore --data-only --table="$1" --file=- "$SET_TMP/db.dump" \
    >"$RUN_TMP/copy-$1.txt" 2>>"$BACKUP_ERRLOG" || return 1
  awk -F '\t' -v mode="$2" '
    BEGIN { inside = 0; seen = 0; org = 0; key = 0; skey = 0; val = 0 }
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
      }
      inside = 1
      seen = 1
      next
    }
    inside && $0 == "\\." { inside = 0; next }
    inside {
      if (mode == "table") {
        print $org "/" $skey
      } else if ($key == "branding:logo") {
        v = $val
        if (match(v, /"storageKey"[ ]*:[ ]*"[^"\\]*"/)) {
          s = substr(v, RSTART, RLENGTH)
          sub(/^"storageKey"[ ]*:[ ]*"/, "", s)
          sub(/"$/, "", s)
          print $org "/" s
        } else {
          print "!unreadable-logo-value"
        }
      }
    }
    END {
      if (!seen || org == 0) exit 3
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

for _n in "$BACKUP_LEASE_TTL_SECONDS" "$BACKUP_FENCE_WAIT_SECONDS"; do
  is_uint "$_n" && [ "$_n" -ge 1 ] || {
    log 'invalid setting'
    fail unknown
  }
done
printf '%s\n' "$BACKUP_DUMP_LOCK_TIMEOUT" | grep -Eqx '[0-9]{1,6}(ms|s|min)?' || {
  log 'invalid setting'
  fail unknown
}

RUN_TMP=$(mktemp -d) || fail unknown
BACKUP_ERRLOG="$RUN_TMP/errors.log"
: >"$BACKUP_ERRLOG"
export BACKUP_ERRLOG

SET_ID=$(new_set_id) || fail unknown
valid_set_id "$SET_ID" || fail unknown
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Another run holds an unexpired lease: skip without touching anything.
_active=$(lease_active) || fail unknown
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

renew_loop >/dev/null 2>&1 7>&- &
RENEW_PID=$!

pause_point after-fence || fail unknown

SET_TMP="$BACKUP_DIR/.tmp-$SET_ID"
SET_FINAL="$BACKUP_DIR/$SET_ID"
if ! mkdir -- "$SET_TMP" 2>>"$BACKUP_ERRLOG"; then
  SET_TMP=''
  fail storage
fi
printf '%s\n' "$SET_ID" >"$SET_TMP/holder" 2>>"$BACKUP_ERRLOG" || fail storage

if ! PGAPPNAME="$BACKUP_APPLICATION_NAME" pg_dump -Fc \
  --lock-wait-timeout="$BACKUP_DUMP_LOCK_TIMEOUT" -f "$SET_TMP/db.dump" 2>>"$BACKUP_ERRLOG"; then
  step_failed dump
fi
[ -s "$SET_TMP/db.dump" ] || step_failed dump

pause_point after-dump || fail unknown

# Archivable files: regular files at <organizationId>/<storageKey>. Every other entry (the marker,
# other names, links, nested directories) is counted as skipped and never archived.
(cd -- "$UPLOADS_DIR" && find . -mindepth 2 -maxdepth 2 -type f -regextype posix-extended \
  -regex "$MEMBER_FIND_RE" -printf '%P\n') >"$RUN_TMP/files.raw" 2>>"$BACKUP_ERRLOG" ||
  step_failed archive
sort -u "$RUN_TMP/files.raw" >"$RUN_TMP/files.list" || step_failed archive
(cd -- "$UPLOADS_DIR" && find . -mindepth 1 -maxdepth 1 -regextype posix-extended \
  ! \( -type d -regex "$MEMBER_DIR_FIND_RE" \) -printf 'x\n') >"$RUN_TMP/skipped-top.raw" \
  2>>"$BACKUP_ERRLOG" || step_failed archive
(cd -- "$UPLOADS_DIR" && find . -mindepth 2 -maxdepth 2 -regextype posix-extended \
  -regex "$MEMBER_DIR_FIND_RE/.*" ! \( -type f -regex "$MEMBER_FIND_RE" \) -printf 'x\n') \
  >"$RUN_TMP/skipped-inner.raw" 2>>"$BACKUP_ERRLOG" || step_failed archive
SKIPPED_ENTRIES=$(($(wc -l <"$RUN_TMP/skipped-top.raw") + $(wc -l <"$RUN_TMP/skipped-inner.raw")))

pause_point after-list || fail unknown

# A listed file that no committed row references may vanish meanwhile (U-13): tar exit 1 (a
# file changed or vanished) is accepted, 2 or more fails the set.
set +e
tar -czf "$SET_TMP/uploads.tar.gz" --ignore-failed-read --no-recursion --verbatim-files-from \
  -C "$UPLOADS_DIR" -T "$RUN_TMP/files.list" 2>>"$BACKUP_ERRLOG"
_tar_rc=$?
set -e
[ "$_tar_rc" -le 1 ] || step_failed archive

# Checksums from the archive's own contents, then the member list must equal the checksum list.
cat >"$RUN_TMP/sum-member.sh" <<'EOF'
_h=$(sha256sum) || exit 1
printf '%s  %s\n' "${_h%% *}" "$TAR_FILENAME"
EOF
tar -xzf "$SET_TMP/uploads.tar.gz" --to-command="sh $RUN_TMP/sum-member.sh" \
  >"$RUN_TMP/sums.raw" 2>>"$BACKUP_ERRLOG" || step_failed archive
sort -k 2 "$RUN_TMP/sums.raw" >"$SET_TMP/uploads.sha256" || step_failed archive
tar -tzf "$SET_TMP/uploads.tar.gz" >"$RUN_TMP/members.raw" 2>>"$BACKUP_ERRLOG" ||
  step_failed archive
sort "$RUN_TMP/members.raw" >"$RUN_TMP/members.list" || step_failed archive
awk '{ print $2 }' "$SET_TMP/uploads.sha256" | sort >"$RUN_TMP/summed.list" ||
  step_failed archive
cmp -s "$RUN_TMP/members.list" "$RUN_TMP/summed.list" || step_failed archive
if grep -Evx '[A-Za-z0-9_-]{1,64}/[a-z0-9]+\.[a-z0-9]{1,8}' "$RUN_TMP/members.list" >/dev/null; then
  step_failed archive
fi
ARCHIVED_FILES=$(($(wc -l <"$RUN_TMP/members.list")))

pause_point after-archive || fail unknown

# Every file the dump references must be in the archive with a checksum (D-02(4), U-14).
: >"$RUN_TMP/refs.raw"
referenced_from_dump Attachment table >>"$RUN_TMP/refs.raw" || step_failed verification
referenced_from_dump TaskAttachment table >>"$RUN_TMP/refs.raw" || step_failed verification
referenced_from_dump Setting setting >>"$RUN_TMP/refs.raw" || step_failed verification
sort -u "$RUN_TMP/refs.raw" >"$RUN_TMP/refs.list" || step_failed verification
REFERENCED_FILES=$(($(wc -l <"$RUN_TMP/refs.list")))
comm -23 "$RUN_TMP/refs.list" "$RUN_TMP/summed.list" >"$RUN_TMP/missing.list" ||
  step_failed verification
_missing=$(($(wc -l <"$RUN_TMP/missing.list")))
if [ "$_missing" -ne 0 ]; then
  log "verification: $_missing referenced files missing from the archive"
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
pg_restore --list "$SET_TMP/db.dump" >/dev/null 2>>"$BACKUP_ERRLOG" || step_failed dump
tar -tzf "$SET_TMP/uploads.tar.gz" >/dev/null 2>>"$BACKUP_ERRLOG" || step_failed archive
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
AIDA_BACKUP_LIB=$BACKUP_LIB_DIR/lib.sh
export AIDA_SET_TMP AIDA_SET_FINAL AIDA_SET_ID AIDA_BACKUP_LIB
cat >"$RUN_TMP/publish.sh" <<'EOF'
set -eu
[ -d "$AIDA_SET_TMP" ] && [ ! -L "$AIDA_SET_TMP" ] || exit 1
[ ! -e "$AIDA_SET_FINAL" ] && [ ! -L "$AIDA_SET_FINAL" ] || exit 1
rm -f -- "$AIDA_SET_TMP/holder"
mv -n -T -- "$AIDA_SET_TMP" "$AIDA_SET_FINAL" 2>>"$BACKUP_ERRLOG"
[ -d "$AIDA_SET_FINAL" ] && [ ! -e "$AIDA_SET_TMP" ]
EOF
cat >"$RUN_TMP/status.sh" <<'EOF'
set -eu
. "$AIDA_BACKUP_LIB"
record_status succeeded "$AIDA_SET_ID" -
EOF

set +e
fenced_action "$SET_ID" "$RUN_TMP/publish.sh"
_pub=$?
set -e
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

set +e
fenced_action "$SET_ID" "$RUN_TMP/status.sh"
_st=$?
set -e
if [ "$_st" -ne 0 ]; then
  log 'backup status not recorded'
  if [ "$_st" -eq 4 ]; then log 'backup aborted: lease lost'; fi
  fail unknown
fi
STATUS_RECORDED=1
OUTCOME=succeeded
log "backup succeeded: $SET_ID"
exit 0
