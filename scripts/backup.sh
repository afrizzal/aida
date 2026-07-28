#!/usr/bin/env bash
# scripts/backup.sh — take a COMPLETE AIDA backup.
#
# A complete backup has TWO parts, both required to restore an instance:
#   1. A Postgres logical dump (all ticket/contact/KB/insight data)
#   2. A tarball of the `uploads_data` volume (every attachment — files live
#      on disk, NOT in Postgres, so a database-only dump silently loses them)
#
# Usage:
#   ./scripts/backup.sh [OUTPUT_DIR]
#
#   OUTPUT_DIR defaults to ./backups
#
# Legacy compose binary support:
#   COMPOSE_CMD="docker-compose" ./scripts/backup.sh
set -euo pipefail

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

COMPOSE="${COMPOSE_CMD:-docker compose}"

# Source .env if present so POSTGRES_USER/POSTGRES_DB match the running stack.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
DB_USER="${POSTGRES_USER:-aida}"
DB_NAME="${POSTGRES_DB:-aida}"

# Preflight: the db service must already be up (this script never starts it,
# so we never race a not-yet-ready Postgres).
if [ -z "$($COMPOSE ps --status running db 2>/dev/null)" ]; then
  echo "[backup] The 'db' service is not running. Start it with: docker compose up -d db" >&2
  exit 1
fi

DB_FILE="$OUT_DIR/aida-db-$STAMP.dump"
UPLOADS_FILE="$OUT_DIR/aida-uploads-$STAMP.tar.gz"

echo "[backup] Dumping database ($DB_NAME) -> $DB_FILE"
$COMPOSE exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "$DB_FILE"

# Uploads: stream a tar of /data/uploads out of a throwaway `app` container.
# Streaming to stdout means we never have to guess the compose-prefixed volume
# name or set up a bind mount; --no-deps stops compose from also starting
# db/migrate just to run this one-off container.
echo "[backup] Archiving uploads volume -> $UPLOADS_FILE"
$COMPOSE run --rm -T --no-deps --entrypoint sh app -c 'tar czf - -C /data/uploads .' > "$UPLOADS_FILE"

# Refuse to hand back a backup that silently failed.
if [ ! -s "$DB_FILE" ]; then
  echo "[backup] ERROR: $DB_FILE is empty — database dump failed." >&2
  exit 1
fi
if [ ! -s "$UPLOADS_FILE" ]; then
  echo "[backup] ERROR: $UPLOADS_FILE is empty — uploads archive failed." >&2
  exit 1
fi

echo
echo "[backup] Done."
echo "  Database: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"
echo "  Uploads:  $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"
echo
echo "To restore this backup:"
echo "  ./scripts/restore.sh $DB_FILE $UPLOADS_FILE"
