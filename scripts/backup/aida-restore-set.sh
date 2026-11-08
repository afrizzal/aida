#!/bin/sh
# scripts/backup/aida-restore-set.sh: validate one backup set, then restore it (Phase 9 plan
# 09-10, AIDA-33; D-05, U-14, U-16, reviews P5, Q3, Q4, Q7, R3).
#
# Usage: aida-restore-set.sh [--check-schema | --validate-only] <setDir>
#                                                    (<setDir> is BACKUP_DIR/<setId>)
#   --check-schema   only steps 1, 2 up to the dump and 2a below (read only), then exit;
#                    scripts/restore.sh runs it before it stops any service (K142, K150)
#   --validate-only  steps 1, 2, the release half of 2a and 2b (K149): the whole set is checked
#                    (manifest, dump, archive, checksums, extraction into staging) and its
#                    migrations against the release, without the target database comparison and
#                    without any write to the target database or the uploads target; then exit
#
# Runs in the pgvector/pgvector:pg16 image as user 1000:1000 (the app's node user, U-16), started
# by scripts/restore.sh in a one-off container of the `backup` service. Settings (environment):
#   RESTORE_HOLDER   the restore holder (restore-<32 hex>) that holds BACKUP_DIR/.restore-lock
#   BACKUP_DIR       the backups directory (default /backups)
#   UPLOADS_DIR      the uploads target, a mount point (default /restore/uploads)
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE: the target database (libpq, never a URL)
#   RESTORE_HEARTBEAT_SECONDS (default 60, 1 to 3600): the restore-lock heartbeat interval
#   RESTORE_RELEASE_MIGRATIONS (required, K150): the migration directory names of the running
#                    release's prisma/migrations, separated by spaces; scripts/restore.sh reads
#                    them from its checkout. Each is [A-Za-z0-9_.-]+. Missing or invalid: exit 2
#   Tests only: BACKUP_TEST_PAUSE_DIR, BACKUP_TEST_PAUSE_MAX_SECONDS (lib.sh pause_point
#   `validating`; without the variable it does nothing).
#
# Order. Nothing is written to the target database or the uploads target before the whole set has
# validated (P5):
#   1. the restore lock: the stored holder must be RESTORE_HOLDER (else exit 3); a background
#      heartbeat renews it every RESTORE_HEARTBEAT_SECONDS and stops this run (exit 3) when the
#      stored holder differs; the holder is checked again before each target write;
#   2. validation, writing only to the staging directory BACKUP_DIR/.restore-staging-<holder>:
#      the set directory holds exactly db.dump, uploads.tar.gz, uploads.sha256 and manifest.json
#      as regular files; the set id equals the directory name and the manifest's setId; the
#      sha256 and size of db.dump equal the manifest's; `pg_restore --list` reads the dump;
#   2a. migrations (K142, K150, read only), exit 9 and nothing written on a refusal:
#      - release: every migration of the dump's _prisma_migrations is in RESTORE_RELEASE_MIGRATIONS
#        (else 'the set has N migration(s) that this release does not contain (a newer set)'):
#        migrations only go forward, and the release's code would run on a schema it does not know;
#      - target: the target database is truly empty (no relation in any schema other than the
#        system ones) or its public._prisma_migrations (any state) holds exactly the dump's
#        migration names. A database with relations but no migration table, one with a
#        migration the set lacks (a newer schema) and one lacking a migration of the set (an
#        older schema) are refused: pg_restore --clean drops only the dump's own objects, so any
#        other object would survive the restore next to the restored schema;
#      - then one line says whether the set is equal to the release or older than it; for an
#        older set scripts/restore.sh runs the release's migrate deploy before app and worker
#        start;
#   2b. the sha256 and size of uploads.tar.gz and uploads.sha256 equal the manifest's (a forged
#      checksum list fails); every archive member is a regular file whose path is
#      <organizationId>/<storageKey> (lib.sh MEMBER_PATH_RE, no leading "-", no duplicate; this
#      rejects absolute paths, "..", ".", control characters, newlines and the volume marker);
#      extraction into staging with --no-same-owner and --no-same-permissions; the staged file
#      set equals the uploads.sha256 list exactly and every staged checksum matches; the dump
#      holds exactly one SystemSetting `uploads:volume-id`. Any failure: 'set failed validation',
#      exit 4;
#   3. target checks: running as 1000:1000; UPLOADS_DIR is a directory and a mount point, and
#      every entry in it (the mount point included) is owned by 1000:1000; PGDATABASE is set.
#      Else exit 6, nothing written;
#   4. database: writes `database` to BACKUP_DIR/.restore-lock/target-touched (temporary file,
#      then rename), then `pg_restore --clean --if-exists --no-owner --no-privileges`. Only the
#      known benign 'cannot drop inherited constraint' message (pg-boss partition, as in the v1
#      script) is non-fatal; any other error fails the step. Then deletes the `backup:lease` row
#      the dump carried in and checks the restored `uploads:volume-id`. Else exit 7;
#   5. uploads: writes `uploads` to target-touched, removes the target's existing entries one by
#      one with `rm -r --` (inside the mount point, never the mount point itself), copies the
#      staged tree in (directories 0755, files 0644, owned by 1000:1000), checks every copied file
#      against uploads.sha256, writes the marker `.aida-uploads-volume` holding the restored
#      `uploads:volume-id` (temporary file, then rename), checks that every entry is owned by
#      1000:1000 and that a probe file can be created, read and removed. Else exit 8.
#   Then exit 0. It never removes a Docker volume. It leaves the restore lock in place on every
#   exit (scripts/restore.sh owns its release) and always removes its own staging directory.
#
# Exit codes: 0 restored (or, with --check-schema or --validate-only, the checks passed), 2 usage
# or an invalid setting, 3 restore lock not held or lost, 4 validation, 6 target check, 7 database
# step, 8 uploads step, 9 refused by the migration checks (K142, K150).
#
# Log lines are fixed text, prefixed [restore]; tool error output goes to a file in the run's
# private temporary directory. The one exception: when pg_restore fails, its own `pg_restore:
# error:` lines (at most 20) are printed on stderr so the operator can see the cause.
set -eu

LC_ALL=C
export LC_ALL
umask 077
trap '' PIPE

RESTORE_LIB_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=scripts/backup/lib.sh
. "$RESTORE_LIB_DIR/lib.sh"

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/restore/uploads}
RESTORE_HOLDER=${RESTORE_HOLDER:-}
RESTORE_HEARTBEAT_SECONDS=${RESTORE_HEARTBEAT_SECONDS:-60}

STEP=validation
RUN_TMP=''
STAGING=''
STAGING_MADE=0
HEARTBEAT_PID=''
LOCK_LOST=0
MAIN_PID=$$
BACKUP_ERRLOG=/dev/null
export BACKUP_ERRLOG

rlog() {
  printf '[restore] %s\n' "$1"
}

step_code() {
  case $STEP in
    validation) printf '4\n' ;;
    target) printf '6\n' ;;
    database) printf '7\n' ;;
    uploads) printf '8\n' ;;
    *) printf '1\n' ;;
  esac
}

stop_heartbeat() {
  if [ -n "$HEARTBEAT_PID" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || :
    wait "$HEARTBEAT_PID" 2>/dev/null || :
    HEARTBEAT_PID=''
  fi
}

on_exit() {
  _rc=$?
  trap '' USR1 INT TERM HUP
  set +e
  stop_heartbeat
  # The staging directory is removed by its own path only, and only when this run created it.
  if [ "$STAGING_MADE" = 1 ] && [ -d "$STAGING" ] && [ ! -L "$STAGING" ]; then
    rm -r -- "$STAGING" </dev/null 2>/dev/null
  fi
  if [ -n "$RUN_TMP" ] && [ -d "$RUN_TMP" ]; then
    rm -r -- "$RUN_TMP" </dev/null 2>/dev/null
  fi
  if [ "$LOCK_LOST" = 1 ]; then
    _rc=3
  fi
  exit "$_rc"
}

on_lock_lost() {
  trap '' USR1
  LOCK_LOST=1
  rlog 'restore aborted: restore lock lost'
  exit 3
}

on_signal() {
  rlog "restore interrupted during the $STEP step"
  exit "$(step_code)"
}

fail_validation() {
  rlog "validation: $1"
  rlog 'set failed validation'
  exit 4
}

fail_target() {
  rlog "target check failed: $1"
  exit 6
}

fail_database() {
  rlog "database step failed: $1"
  exit 7
}

fail_uploads() {
  rlog "uploads step failed: $1"
  exit 8
}

fail_schema() {
  rlog "refused: $1"
  rlog 'restore into a database of the release the set came from, or into an empty database and then run the target release migrate deploy (docs/OPERATIONS.md, Restore)'
  exit 9
}

# True while BACKUP_DIR/.restore-lock still names this run's holder (a read only: the heartbeat
# loop is the only writer of the heartbeat file).
holder_ok() {
  _ho=$(restore_lock_holder) || return 1
  [ "$_ho" = "$RESTORE_HOLDER" ]
}

heartbeat_loop() {
  _hb_sleep=''
  trap 'kill "$_hb_sleep" 2>/dev/null; exit 0' TERM
  while :; do
    sleep "$RESTORE_HEARTBEAT_SECONDS" &
    _hb_sleep=$!
    wait "$_hb_sleep" || :
    if ! restore_lock_heartbeat "$RESTORE_HOLDER"; then
      kill -s USR1 "$MAIN_PID" 2>/dev/null || :
      exit 0
    fi
  done
}

file_sha256() {
  _fs=$(sha256sum -- "$1") || return 1
  printf '%s\n' "${_fs%% *}"
}

# manifest_part <name>: prints "<sha256> <size>" of one part from manifest.json, which must hold
# exactly one line for it in the format aida-backup.sh writes.
manifest_part() {
  _mp_count=$(grep -cF "\"$1\"" "$MANIFEST") || return 1
  [ "$_mp_count" = 1 ] || return 1
  _mp_re=$(printf '%s' "$1" | sed 's/\./\\./g')
  _mp_out=$(sed -n -E \
    "s/^    \"$_mp_re\": \\{ \"sha256\": \"([0-9a-f]{64})\", \"size\": ([0-9]{1,15}) \\},?\$/\\1 \\2/p" \
    "$MANIFEST") || return 1
  [ -n "$_mp_out" ] || return 1
  printf '%s\n' "$_mp_out"
}

# check_part <name>: the part is a regular file whose sha256 and size equal the manifest's.
check_part() {
  _cp_file="$SET_DIR/$1"
  _cp_want=$(manifest_part "$1") || fail_validation "manifest entry for $1"
  _cp_sha=$(file_sha256 "$_cp_file") || fail_validation "$1 unreadable"
  _cp_size=$(stat -c %s -- "$_cp_file") || fail_validation "$1 unreadable"
  [ "$_cp_want" = "$_cp_sha $_cp_size" ] || fail_validation "$1 checksum"
}

# The SystemSetting `uploads:volume-id` value in the dump: exactly one row, 32 hex characters.
dump_volume_id() {
  pg_restore --data-only --table=SystemSetting --file=- "$SET_DIR/db.dump" \
    >"$RUN_TMP/copy-SystemSetting.txt" 2>>"$BACKUP_ERRLOG" || return 1
  awk -F '\t' -v want="$UPLOADS_VOLUME_ID_KEY" '
    BEGIN { inside = 0; seen = 0; key = 0; val = 0; n = 0; v = "" }
    !inside && /^COPY / {
      h = $0
      sub(/^[^(]*\(/, "", h)
      sub(/\) FROM stdin;$/, "", h)
      c = split(h, cols, ", ")
      for (i = 1; i <= c; i++) {
        name = cols[i]
        gsub(/"/, "", name)
        if (name == "key") key = i
        if (name == "value") val = i
      }
      inside = 1
      seen = 1
      next
    }
    inside && $0 == "\\." { inside = 0; next }
    inside && key > 0 && $key == want { n++; v = $val }
    END {
      if (!seen || key == 0 || val == 0 || n != 1) exit 3
      print v
    }
  ' "$RUN_TMP/copy-SystemSetting.txt"
}

# K142 (d-CR-1): the migration names in the dump's _prisma_migrations, sorted and unique, in
# RUN_TMP/dump-migrations.txt. No such table in the dump: an empty list. A name that is not
# [A-Za-z0-9_.-]+, or a COPY block without a migration_name column: failure.
dump_migrations() {
  pg_restore --data-only --table=_prisma_migrations --file=- "$SET_DIR/db.dump" \
    >"$RUN_TMP/copy-migrations.txt" 2>>"$BACKUP_ERRLOG" || return 1
  awk -F '\t' '
    BEGIN { inside = 0; col = 0; bad = 0 }
    !inside && /^COPY / {
      h = $0
      sub(/^[^(]*\(/, "", h)
      sub(/\) FROM stdin;$/, "", h)
      c = split(h, cols, ", ")
      for (i = 1; i <= c; i++) {
        name = cols[i]
        gsub(/"/, "", name)
        if (name == "migration_name") col = i
      }
      if (col == 0) { bad = 1; exit }
      inside = 1
      next
    }
    inside && $0 == "\\." { inside = 0; next }
    inside {
      if ($col !~ /^[A-Za-z0-9_.-]+$/) { bad = 1; exit }
      print $col
    }
    END { if (bad) exit 3 }
  ' "$RUN_TMP/copy-migrations.txt" >"$RUN_TMP/dump-migrations.raw" || return 1
  sort -u "$RUN_TMP/dump-migrations.raw" >"$RUN_TMP/dump-migrations.txt"
}

# The migration names recorded in the target's public._prisma_migrations (any state: a failed or
# rolled-back migration may have left schema changes too), sorted and unique, in
# RUN_TMP/target-migrations.txt. No such table (an empty database): an empty list. Read only.
target_migrations() {
  _has_table=$(psql_q -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL") ||
    return 1
  case $_has_table in
    f) : >"$RUN_TMP/target-migrations.txt" ;;
    t)
      psql_q -c 'SELECT DISTINCT migration_name FROM public._prisma_migrations' \
        >"$RUN_TMP/target-migrations.raw" || return 1
      sort -u "$RUN_TMP/target-migrations.raw" >"$RUN_TMP/target-migrations.txt"
      ;;
    *) return 1 ;;
  esac
}

# K150: the number of relations (tables, partitioned tables, views, materialized views,
# sequences, foreign tables) in every schema except the system ones. Read only.
target_relation_count() {
  psql_q -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'"
}

# The lines of file $1 that are not in file $2 (both sorted) into $3; their count and the first
# one in _diff_n and _diff_first.
lines_not_in() {
  comm -23 "$1" "$2" >"$3" || return 1
  _diff_n=$(($(wc -l <"$3")))
  _diff_first=$(head -n 1 "$3")
}

# K150, release half: refuse a set whose migrations are not all in the running release's
# prisma/migrations (RESTORE_RELEASE_MIGRATIONS, in RUN_TMP/release-migrations.txt).
check_release() {
  dump_migrations || fail_validation 'migration list in the dump'
  lines_not_in "$RUN_TMP/dump-migrations.txt" "$RUN_TMP/release-migrations.txt" \
    "$RUN_TMP/newer-migrations.txt" || fail_target 'could not compare the migrations'
  if [ "$_diff_n" -gt 0 ]; then
    fail_schema "the set has $_diff_n migration(s) that this release does not contain (a newer set), first: $_diff_first"
  fi
  if cmp -s "$RUN_TMP/dump-migrations.txt" "$RUN_TMP/release-migrations.txt"; then
    rlog 'set migrations: equal to this release'
  else
    rlog 'set migrations: older than this release; migrate deploy runs before app and worker start'
  fi
}

# K142, K150, target half: proceed only into a truly empty database or one whose migration
# history equals the dump's exactly; else refuse (exit 9, nothing written). pg_restore --clean
# drops only the dump's own objects, so a newer target schema would be left half dropped (a table
# the dump does not have still references one it drops), and any object of an older or foreign
# schema would survive next to the restored one.
check_target() {
  [ -n "${PGDATABASE:-}" ] || fail_target 'no target database'
  _has_table=$(psql_q -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL") ||
    fail_target 'could not read the migrations of the target database'
  if [ "$_has_table" = f ]; then
    _rel_n=$(target_relation_count) || fail_target 'could not read the relations of the target database'
    is_uint "$_rel_n" || fail_target 'could not read the relations of the target database'
    if [ "$_rel_n" -gt 0 ]; then
      fail_schema "the target database is not empty ($_rel_n relation(s)) and has no migration history"
    fi
    rlog 'target database: empty'
    return 0
  fi
  target_migrations || fail_target 'could not read the migrations of the target database'
  lines_not_in "$RUN_TMP/target-migrations.txt" "$RUN_TMP/dump-migrations.txt" \
    "$RUN_TMP/extra-migrations.txt" || fail_target 'could not compare the migrations'
  if [ "$_diff_n" -gt 0 ]; then
    fail_schema "the target database has $_diff_n applied migration(s) that the set does not contain (a newer schema), first: $_diff_first"
  fi
  lines_not_in "$RUN_TMP/dump-migrations.txt" "$RUN_TMP/target-migrations.txt" \
    "$RUN_TMP/missing-migrations.txt" || fail_target 'could not compare the migrations'
  if [ "$_diff_n" -gt 0 ]; then
    fail_schema "the target database lacks $_diff_n migration(s) of the set (an older schema), first: $_diff_first"
  fi
  rlog 'target migrations: equal to the set'
}

CHECK_ONLY=0
VALIDATE_ONLY=0
if [ "$#" -eq 2 ] && [ "$1" = --check-schema ]; then
  CHECK_ONLY=1
  shift
elif [ "$#" -eq 2 ] && [ "$1" = --validate-only ]; then
  VALIDATE_ONLY=1
  shift
fi
if [ "$#" -ne 1 ]; then
  rlog 'usage: aida-restore-set.sh [--check-schema | --validate-only] <setDir>'
  exit 2
fi
# K150: the running release's migrations, one valid name per word, at least one.
RESTORE_RELEASE_MIGRATIONS=${RESTORE_RELEASE_MIGRATIONS:-}
_release_n=0
for _m in $RESTORE_RELEASE_MIGRATIONS; do
  case $_m in
    *[!A-Za-z0-9_.-]*)
      rlog 'invalid setting: RESTORE_RELEASE_MIGRATIONS'
      exit 2
      ;;
  esac
  _release_n=$((_release_n + 1))
done
if [ "$_release_n" -eq 0 ]; then
  rlog 'invalid setting: RESTORE_RELEASE_MIGRATIONS is not set'
  exit 2
fi
if ! is_uint "$RESTORE_HEARTBEAT_SECONDS" || [ "$RESTORE_HEARTBEAT_SECONDS" -lt 1 ] ||
  [ "$RESTORE_HEARTBEAT_SECONDS" -gt 3600 ]; then
  rlog 'invalid setting'
  exit 2
fi
SET_DIR=${1%/}
SET_ID=${SET_DIR##*/}

# 1. The restore lock (review Q3): this run's holder, or nothing happens at all.
if ! valid_restore_holder "$RESTORE_HOLDER" || ! holder_ok; then
  rlog 'restore lock not held by this restore'
  exit 3
fi

trap on_exit EXIT
trap on_signal INT TERM HUP
trap on_lock_lost USR1

heartbeat_loop >/dev/null 2>&1 &
HEARTBEAT_PID=$!

# 2. Validation (P5). Only RUN_TMP and the staging directory are written.
rlog "validating set $SET_ID"
valid_set_id "$SET_ID" || fail_validation 'set id'
[ "$SET_DIR" = "$BACKUP_DIR/$SET_ID" ] || fail_validation 'set directory'
[ -d "$SET_DIR" ] && [ ! -L "$SET_DIR" ] || fail_validation 'set directory'

RUN_TMP=$(mktemp -d) || fail_validation 'temporary directory'
BACKUP_ERRLOG="$RUN_TMP/errors.log"
: >"$BACKUP_ERRLOG"

(cd -- "$SET_DIR" && find . -mindepth 1 -maxdepth 1 -printf '%P\n') >"$RUN_TMP/parts.raw" \
  2>>"$BACKUP_ERRLOG" || fail_validation 'set directory'
sort "$RUN_TMP/parts.raw" >"$RUN_TMP/parts.list"
printf '%s\n' db.dump manifest.json uploads.sha256 uploads.tar.gz >"$RUN_TMP/parts.want"
cmp -s "$RUN_TMP/parts.list" "$RUN_TMP/parts.want" || fail_validation 'set contents'
for _part in db.dump manifest.json uploads.sha256 uploads.tar.gz; do
  [ -f "$SET_DIR/$_part" ] && [ ! -L "$SET_DIR/$_part" ] || fail_validation "$_part is not a file"
done

MANIFEST="$SET_DIR/manifest.json"
[ "$(stat -c %s -- "$MANIFEST")" -le 65536 ] || fail_validation 'manifest size'
_mid_count=$(grep -c '"setId"' "$MANIFEST") || fail_validation 'manifest set id'
[ "$_mid_count" = 1 ] || fail_validation 'manifest set id'
_mid=$(sed -n -E 's/^  "setId": "([0-9]{8}T[0-9]{6}Z-[0-9a-f]{6})",$/\1/p' "$MANIFEST")
[ "$_mid" = "$SET_ID" ] || fail_validation 'manifest set id'

check_part db.dump
pg_restore --list "$SET_DIR/db.dump" >/dev/null 2>>"$BACKUP_ERRLOG" || fail_validation 'dump'

# K142, K150: the dump's migrations against the release's and the target's (read only).
# --check-schema stops here; --validate-only skips the target comparison.
for _m in $RESTORE_RELEASE_MIGRATIONS; do printf '%s\n' "$_m"; done | sort -u \
  >"$RUN_TMP/release-migrations.txt" || fail_validation 'release migration list'
check_release
if [ "$VALIDATE_ONLY" = 0 ]; then
  check_target
fi
if [ "$CHECK_ONLY" = 1 ]; then
  exit 0
fi

check_part uploads.tar.gz
check_part uploads.sha256

ARCHIVE="$SET_DIR/uploads.tar.gz"
SUMS="$SET_DIR/uploads.sha256"
# Member names exactly as stored (-P: no stripping), escaped so a newline cannot hide a member.
tar -tzPf "$ARCHIVE" --quoting-style=escape >"$RUN_TMP/members.raw" 2>>"$BACKUP_ERRLOG" ||
  fail_validation 'archive'
tar -tvzPf "$ARCHIVE" --quoting-style=escape >"$RUN_TMP/members.long" 2>>"$BACKUP_ERRLOG" ||
  fail_validation 'archive'
[ "$(($(wc -l <"$RUN_TMP/members.raw")))" -eq "$(($(wc -l <"$RUN_TMP/members.long")))" ] ||
  fail_validation 'archive'
member_list_ok "$RUN_TMP/members.raw" || fail_validation 'member name'
# Every member is a regular file: the first character of the verbose listing is "-" (not d, l,
# h for a hard link, p for a FIFO, c or b for a device).
if cut -c 1 "$RUN_TMP/members.long" | grep -vx -- '-' >/dev/null; then
  fail_validation 'member type'
fi
MEMBER_COUNT=$(($(wc -l <"$RUN_TMP/members.raw")))

# The checksum list: one "<sha256>  <member>" line per member.
if grep -Evx "[0-9a-f]{64}  $MEMBER_PATH_RE" "$SUMS" >/dev/null; then
  fail_validation 'checksum list format'
fi
awk '{ print $2 }' "$SUMS" | sort >"$RUN_TMP/summed.list"
sort "$RUN_TMP/members.raw" >"$RUN_TMP/members.list"
cmp -s "$RUN_TMP/members.list" "$RUN_TMP/summed.list" ||
  fail_validation 'archive members differ from the checksum list'

STAGING="$BACKUP_DIR/.restore-staging-$RESTORE_HOLDER"
mkdir -- "$STAGING" 2>>"$BACKUP_ERRLOG" || fail_validation 'staging directory'
STAGING_MADE=1
tar -xzf "$ARCHIVE" -C "$STAGING" --no-same-owner --no-same-permissions --keep-old-files \
  2>>"$BACKUP_ERRLOG" || fail_validation 'archive extraction'

(cd -- "$STAGING" && find . -mindepth 1 ! -type d ! -type f -printf 'x\n') \
  >"$RUN_TMP/staged-odd.raw" 2>>"$BACKUP_ERRLOG" || fail_validation 'staged files'
[ ! -s "$RUN_TMP/staged-odd.raw" ] || fail_validation 'staged entry type'
(cd -- "$STAGING" && find . -mindepth 2 -type d -printf 'x\n') >"$RUN_TMP/staged-deep.raw" \
  2>>"$BACKUP_ERRLOG" || fail_validation 'staged files'
[ ! -s "$RUN_TMP/staged-deep.raw" ] || fail_validation 'staged directory depth'
(cd -- "$STAGING" && find . -mindepth 1 -maxdepth 1 -type d -printf '%P\n') |
  sort >"$RUN_TMP/staged-dirs.list"
(cd -- "$STAGING" && find . -mindepth 1 -type f -printf '%P\n') | sort >"$RUN_TMP/staged.list"
cmp -s "$RUN_TMP/staged.list" "$RUN_TMP/summed.list" ||
  fail_validation 'staged files differ from the checksum list'
if [ "$MEMBER_COUNT" -gt 0 ]; then
  (cd -- "$STAGING" && sha256sum -c --status --strict -- "$SUMS") 2>>"$BACKUP_ERRLOG" ||
    fail_validation 'staged checksum'
fi

pause_point validating || fail_validation 'pause'

RESTORED_ID=$(dump_volume_id) || fail_validation 'volume identity missing from the dump'
printf '%s\n' "$RESTORED_ID" | grep -Eqx '[0-9a-f]{32}' ||
  fail_validation 'volume identity missing from the dump'
rlog 'set validated'
if [ "$VALIDATE_ONLY" = 1 ]; then
  rlog 'validate only: nothing was written to the target database or the uploads target'
  exit 0
fi

# 3. Target checks (U-16): nothing is written when one fails.
STEP=target
[ "$(id -u):$(id -g)" = 1000:1000 ] || fail_target 'not running as 1000:1000'
[ -n "${PGDATABASE:-}" ] || fail_target 'no target database'
[ -d "$UPLOADS_DIR" ] && [ ! -L "$UPLOADS_DIR" ] || fail_target 'uploads target missing'
mountpoint -q -- "$UPLOADS_DIR" || fail_target 'uploads target is not a mount point'
find "$UPLOADS_DIR" \( ! -uid 1000 -o ! -gid 1000 \) -printf 'x\n' >"$RUN_TMP/foreign.raw" \
  2>>"$BACKUP_ERRLOG" || fail_target 'uploads target unreadable'
[ ! -s "$RUN_TMP/foreign.raw" ] || fail_target 'uploads target holds an entry not owned by 1000:1000'
[ -w "$UPLOADS_DIR" ] || fail_target 'uploads target not writable'

# 4. Database.
STEP=database
holder_ok || on_lock_lost
restore_lock_write "$(restore_lock_dir)" target-touched database ||
  fail_database 'could not record the step'
rlog 'restoring the database'
set +e
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$PGDATABASE" \
  "$SET_DIR/db.dump" >"$RUN_TMP/pg_restore.out" 2>&1
_prc=$?
set -e
if [ "$_prc" -ne 0 ]; then
  grep -E '^pg_restore: error:' "$RUN_TMP/pg_restore.out" >"$RUN_TMP/pg_restore.errors" || :
  grep -v 'cannot drop inherited constraint' "$RUN_TMP/pg_restore.errors" \
    >"$RUN_TMP/pg_restore.unexpected" || :
  if [ -s "$RUN_TMP/pg_restore.unexpected" ] || [ ! -s "$RUN_TMP/pg_restore.errors" ]; then
    head -n 20 "$RUN_TMP/pg_restore.unexpected" >&2 || :
    fail_database 'pg_restore reported errors'
  fi
  rlog 'pg_restore: only the known benign pg-boss partition message; continuing'
fi
pause_point restored-database || fail_database 'pause'
# Codex r3-5: the dump carries the lease row of the backup that made this set (its holder is the
# set id). Only that row, or one of this restore's own holder, is removed. A row of any other
# holder belongs to a backup that passed its restore-lock check before this restore took the lock
# and took its lease once pg_restore had created the table on an empty target; it is never
# removed here. That backup checks the restore lock again right after its lease and stops
# (aida-backup.sh), releasing its own row; and restore.sh cannot take the lease again for migrate
# while it is held, so nothing is started on its account.
psql_q -v setid="$SET_ID" -v holder="$RESTORE_HOLDER" >/dev/null <<SQL ||
DELETE FROM "SystemSetting"
WHERE key = '${BACKUP_LEASE_KEY}'
  AND CASE WHEN value IS JSON OBJECT
        THEN COALESCE((value::jsonb ->> 'holder') IN (:'setid', :'holder'), false)
        ELSE false END;
SQL
  fail_database 'could not remove the backup lease'
_db_id=$(psql_q -c "SELECT value FROM \"SystemSetting\" WHERE key = '${UPLOADS_VOLUME_ID_KEY}'") ||
  fail_database 'could not read the restored volume identity'
[ "$_db_id" = "$RESTORED_ID" ] || fail_database 'restored volume identity differs from the dump'
rlog 'database restored'

# 5. Uploads.
STEP=uploads
holder_ok || on_lock_lost
restore_lock_write "$(restore_lock_dir)" target-touched uploads ||
  fail_uploads 'could not record the step'
rlog 'restoring the uploads'
for _entry in "$UPLOADS_DIR"/* "$UPLOADS_DIR"/.[!.]* "$UPLOADS_DIR"/..?*; do
  [ -e "$_entry" ] || [ -L "$_entry" ] || continue
  rm -r -- "$_entry" </dev/null 2>>"$BACKUP_ERRLOG" || fail_uploads 'could not clear the target'
done
umask 022
# Validated names only: no space, glob character or newline reaches the word splitting below.
set -f
for _d in $(cat "$RUN_TMP/staged-dirs.list"); do
  mkdir -- "$UPLOADS_DIR/$_d" 2>>"$BACKUP_ERRLOG" || fail_uploads 'copy'
done
for _f in $(cat "$RUN_TMP/staged.list"); do
  cp -- "$STAGING/$_f" "$UPLOADS_DIR/$_f" 2>>"$BACKUP_ERRLOG" || fail_uploads 'copy'
  chmod 0644 -- "$UPLOADS_DIR/$_f" 2>>"$BACKUP_ERRLOG" || fail_uploads 'copy'
done
set +f
(cd -- "$UPLOADS_DIR" && find . -mindepth 1 -type f -printf '%P\n') | sort >"$RUN_TMP/copied.list"
cmp -s "$RUN_TMP/copied.list" "$RUN_TMP/summed.list" || fail_uploads 'copied files differ'
if [ "$MEMBER_COUNT" -gt 0 ]; then
  (cd -- "$UPLOADS_DIR" && sha256sum -c --status --strict -- "$SUMS") 2>>"$BACKUP_ERRLOG" ||
    fail_uploads 'copied checksum'
fi
# The marker is never part of a set (Q4): it is written from the restored identity (Q7, R3).
_marker="$UPLOADS_DIR/$UPLOADS_MARKER_NAME"
(printf '%s\n' "$RESTORED_ID" >"$_marker.restore-tmp") 2>>"$BACKUP_ERRLOG" &&
  mv -f -T -- "$_marker.restore-tmp" "$_marker" 2>>"$BACKUP_ERRLOG" ||
  fail_uploads 'could not write the volume marker'
find "$UPLOADS_DIR" \( ! -uid 1000 -o ! -gid 1000 \) -printf 'x\n' >"$RUN_TMP/owners.raw" \
  2>>"$BACKUP_ERRLOG" || fail_uploads 'ownership check'
[ ! -s "$RUN_TMP/owners.raw" ] || fail_uploads 'ownership check'
_probe="$UPLOADS_DIR/.aida-restore-probe"
(printf 'probe\n' >"$_probe") 2>>"$BACKUP_ERRLOG" || fail_uploads 'probe file'
[ "$(cat -- "$_probe" 2>>"$BACKUP_ERRLOG")" = probe ] || fail_uploads 'probe file'
rm -f -- "$_probe" 2>>"$BACKUP_ERRLOG" || fail_uploads 'probe file'
[ ! -e "$_probe" ] || fail_uploads 'probe file'

STEP=done
rlog "restore complete: $SET_ID"
exit 0
