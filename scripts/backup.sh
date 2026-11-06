#!/usr/bin/env sh
# scripts/backup.sh: take one AIDA backup now, outside the daily schedule (AIDA-33, plan 09-08).
#
# The `backup` service in docker-compose.yml already runs a backup every day (BACKUP_SCHEDULE,
# BACKUP_RETENTION, BACKUP_ENABLED; docs/OPERATIONS.md "Backups"). This script runs the same
# backup once, in a one-off container of that service, as user 1000:1000. A complete set has two
# parts, both required to restore an instance: the Postgres dump and the archive of every stored
# file (attachments and the logo live on disk, not in Postgres). One run writes one set:
#
#   backups_data volume / <setId>/{db.dump, uploads.tar.gz, uploads.sha256, manifest.json}
#
# Usage:
#   ./scripts/backup.sh
#
# Exit codes are the backup run's: 0 succeeded, 2 failed, 3 skipped (another backup or a restore
# is running; nothing was touched), 5 the outcome could not be recorded in the database (see
# docs/OPERATIONS.md). 1 means the preflight failed and nothing ran.
#
# Requires Docker Compose v2 (`docker compose`). The legacy Compose v1 binary (`docker-compose`)
# cannot read docker-compose.yml (nested interpolation in a default value) and is not supported.
#
# This script never reads .env itself: compose passes the database settings to the service.
set -eu

usage() {
  echo "Usage: ./scripts/backup.sh"
  echo "Takes one backup now. Sets are written to the backups_data volume, one directory per set."
  echo "Requires Docker Compose v2 (docker compose)."
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  '') ;;
  *)
    # Releases before 09-08 took an output directory. Sets now live in the backups_data volume;
    # docs/OPERATIONS.md "Backups" shows how to copy one off the host.
    echo "[backup] This script takes no output directory: sets are written to the backups_data volume." >&2
    usage >&2
    exit 2
    ;;
esac

COMPOSE="docker compose"

# Preflight: the db service must already be up (this script never starts it, so it never races a
# not-yet-ready Postgres).
if [ -z "$($COMPOSE ps --status running db 2>/dev/null)" ]; then
  echo "[backup] The 'db' service is not running. Start it with: docker compose up -d db" >&2
  exit 1
fi

# The one-time preparation of the backups volume (idempotent: it exits at once when the volume is
# already prepared). `docker compose up` runs it too; it is repeated here for a stack that never
# started the backup service.
if ! $COMPOSE run --rm -T --no-deps backup-init; then
  echo "[backup] The backups volume could not be prepared; see docs/OPERATIONS.md, Backups." >&2
  exit 1
fi

echo "[backup] Running one backup in the backup service..."
rc=0
$COMPOSE run --rm -T --no-deps --entrypoint sh backup /opt/aida-backup/aida-backup.sh || rc=$?

echo
case $rc in
  0)
    echo "[backup] Done. The new set is in the backups_data volume, one directory per set,"
    echo "named by the set id on the 'backup succeeded' line above."
    ;;
  3) echo "[backup] Skipped: another backup or a restore is running. Nothing was touched." ;;
  5) echo "[backup] The outcome could not be recorded; see docs/OPERATIONS.md, Backups." >&2 ;;
  *) echo "[backup] The backup failed (exit $rc); see the lines above and docs/OPERATIONS.md, Backups." >&2 ;;
esac
echo "List the sets with: $COMPOSE run --rm -T --no-deps --entrypoint ls backup -1 /backups"
exit "$rc"
