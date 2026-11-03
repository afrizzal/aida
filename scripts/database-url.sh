#!/bin/sh
# Prints the AIDA_DATABASE_URL line for docker-compose.yml (Phase 9, D-12, AIDA-35).
#
# docker-compose.yml builds the services' DATABASE_URL from POSTGRES_USER, POSTGRES_PASSWORD and
# POSTGRES_DB. A password with a URL-reserved character (/ @ : # ? and others) breaks that URL, so
# the services cannot connect. This script percent-encodes user, password and database name per
# UTF-8 byte (everything outside RFC 3986 unreserved A-Z a-z 0-9 - . _ ~ becomes %XX, uppercase
# hex) and prints exactly one line to paste into .env:
#
#   AIDA_DATABASE_URL=postgresql://<user>:<password>@db:5432/<db>
#
# Usage (values as in your .env):
#   POSTGRES_USER=aida POSTGRES_PASSWORD='...' POSTGRES_DB=aida sh scripts/database-url.sh
#
# POSIX sh with od and tr only (BSD and GNU). Never prints a value on an error path.
set -eu

user=${POSTGRES_USER:-aida}
password=${POSTGRES_PASSWORD:-}
database=${POSTGRES_DB:-aida}

if [ -z "$password" ]; then
  echo "POSTGRES_PASSWORD is empty" >&2
  exit 2
fi

# encode <value>: prints the percent-encoded value without a trailing newline.
encode() {
  out=""
  for hex in $(printf '%s' "$1" | od -An -tx1 -v | tr 'a-f' 'A-F'); do
    case "$hex" in
      3[0-9] | 4[1-9A-F] | 5[0-9A] | 6[1-9A-F] | 7[0-9A] | 2D | 2E | 5F | 7E)
        # Unreserved ASCII: print the byte itself through its octal escape.
        out="$out$(printf "\\$(printf '%03o' "0x$hex")")"
        ;;
      *)
        out="$out%$hex"
        ;;
    esac
  done
  printf '%s' "$out"
}

printf 'AIDA_DATABASE_URL=postgresql://%s:%s@db:5432/%s\n' \
  "$(encode "$user")" "$(encode "$password")" "$(encode "$database")"
