#!/usr/bin/env bash
# scripts/restore.sh — restore a COMPLETE AIDA backup.
#
# THIS IS DESTRUCTIVE. It REPLACES the current database contents and the
# entire uploads volume with the contents of the given backup files. There
# is no undo other than restoring a different backup.
#
# Usage:
#   ./scripts/restore.sh DB_DUMP UPLOADS_TARBALL [--yes]
#
#   --yes  skip the interactive confirmation prompt (for scripted use)
set -euo pipefail

DB_DUMP="${1:-}"
UPLOADS_TARBALL="${2:-}"
CONFIRM="${3:-}"

if [ -z "$DB_DUMP" ] || [ -z "$UPLOADS_TARBALL" ]; then
  echo "Usage: ./scripts/restore.sh DB_DUMP UPLOADS_TARBALL [--yes]" >&2
  exit 1
fi
if [ ! -r "$DB_DUMP" ]; then
  echo "[restore] Cannot read DB_DUMP: $DB_DUMP" >&2
  exit 1
fi
if [ ! -r "$UPLOADS_TARBALL" ]; then
  echo "[restore] Cannot read UPLOADS_TARBALL: $UPLOADS_TARBALL" >&2
  exit 1
fi

if [ "$CONFIRM" != "--yes" ]; then
  read -r -p "Restore will REPLACE the current database and all attachments. Type 'restore' to continue: " ANSWER
  if [ "$ANSWER" != "restore" ]; then
    echo "[restore] Aborted."
    exit 1
  fi
fi

COMPOSE="${COMPOSE_CMD:-docker compose}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
DB_USER="${POSTGRES_USER:-aida}"
DB_NAME="${POSTGRES_DB:-aida}"

# Stop the writers first — prevents concurrent writes to the DB and pg-boss
# job pickup by the worker while the restore is in progress.
echo "[restore] Stopping app and worker..."
$COMPOSE stop app worker

echo "[restore] Restoring database from $DB_DUMP ..."
# --clean --if-exists drops existing objects (including the append-only
# AuditEvent trigger) before recreating them from the dump — this is why
# restore works even though the trigger blocks plain DELETE/UPDATE.
# pg_restore prints benign warnings when restoring into a non-empty database;
# only a non-zero exit code indicates real failure.
$COMPOSE exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-privileges < "$DB_DUMP"

echo "[restore] Restoring uploads from $UPLOADS_TARBALL ..."
$COMPOSE run --rm -T --no-deps --entrypoint sh app -c 'rm -rf /data/uploads/* /data/uploads/.[!.]* 2>/dev/null; tar xzf - -C /data/uploads' < "$UPLOADS_TARBALL"

echo "[restore] Starting app and worker..."
$COMPOSE start app worker

echo "[restore] Waiting for /api/health ..."
HEALTHY=""
for _ in $(seq 1 30); do
  if OUTPUT="$($COMPOSE exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null)"; then
    HEALTHY="$OUTPUT"
    break
  fi
  sleep 2
done

if [ -n "$HEALTHY" ]; then
  echo "[restore] Healthy:"
  echo "$HEALTHY"
else
  echo "[restore] WARNING: app did not report healthy within 60s. Check: docker compose logs app" >&2
fi

echo "[restore] Done."
