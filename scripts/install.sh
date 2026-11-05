#!/bin/sh
# scripts/install.sh: one-command install of AIDA on one Docker host (Phase 9 plan 09-12,
# AIDA-40, D-22). Written for POSIX sh; read it before you run it.
#
# Usage:
#   sh install.sh install [tag]    download release <tag> (default: AIDA_DEFAULT_TAG below) into
#                                  AIDA_DIR, write .env with generated secrets, start the stack.
#                                  On an existing install it downloads nothing: it adds the keys
#                                  .env lacks (keeping every existing value) and starts the stack.
#   sh install.sh upgrade <tag>    download release <tag>, replace every file of the install except
#                                  .env, then rebuild and start the stack. Take a backup first.
#   sh install.sh backup           run scripts/backup.sh (one backup set now)
#   sh install.sh restore <setId> [--yes]
#                                  run scripts/restore.sh <setId> (destructive; see its header)
#   sh install.sh logs [service]   docker compose logs [service]
#
# Variables:
#   AIDA_DIR   the install directory. Default: the current directory when it already is an AIDA
#              install (so `sh scripts/install.sh ...` works from inside one), otherwise ./aida
#   AIDA_REPO  the GitHub repository to download from, owner/name. Default: the canonical one.
#
# Network: the only network call this script makes is one HTTPS download per install or upgrade
# (backup, restore and logs make none), of the
# tagged source archive https://github.com/<AIDA_REPO>/archive/refs/tags/<tag>.tar.gz (GitHub
# redirects it to codeload.github.com). No telemetry, no version check, no other host.
# docs/SECURITY.md, "Installer network use".
#
# Secrets: POSTGRES_PASSWORD (64 hex characters, URL-safe, so AIDA_DATABASE_URL is not needed),
# BETTER_AUTH_SECRET, APP_ENCRYPTION_KEY and RATE_LIMIT_PEPPER are generated locally with
# openssl, the commands .env.example documents. A value already in .env is never replaced: a
# rerun keeps every existing line byte-identical and only appends keys .env lacks. .env is written
# to a temporary file in the same directory (mode 600) and renamed into place, so an interrupted
# run leaves the previous .env or none, never half of one. Secret values are never printed.
#
# Exit codes: 0 done; 1 a check or a step failed; 2 usage or an invalid input (nothing ran);
# 129, 130, 143 interrupted by HUP, INT, TERM.
set -eu

AIDA_DEFAULT_TAG=v1.0.0
DEFAULT_REPO=afrizzal/aida

NL='
'
ARCHIVE=''
STAGE=''
ENV_TMP=''

say() { printf '[install] %s\n' "$*"; }

die() {
  code=$1
  shift
  printf '[install] error: %s\n' "$*" >&2
  exit "$code"
}

cleanup() {
  if [ -n "$ENV_TMP" ]; then rm -f "$ENV_TMP"; fi
  if [ -n "$ARCHIVE" ]; then rm -f "$ARCHIVE"; fi
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  cat <<'EOF'
Usage: sh install.sh install [tag]
       sh install.sh upgrade <tag>
       sh install.sh backup
       sh install.sh restore <setId> [--yes]
       sh install.sh logs [service]
Variables: AIDA_DIR (install directory), AIDA_REPO (owner/name). See the header of this script.
EOF
}

usage_die() {
  usage >&2
  exit 2
}

# --- input checks (all run before any network or Docker call) ---------------------------------

one_line() {
  case $1 in
    *"$NL"*) return 1 ;;
  esac
  return 0
}

valid_repo() {
  one_line "$1" || return 1
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$' || return 1
  case $1 in
    *..* | */.) return 1 ;;
  esac
  return 0
}

valid_tag() {
  one_line "$1" || return 1
  printf '%s\n' "$1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$'
}

need() {
  command -v "$1" >/dev/null 2>&1 || die 1 "$1 is required but was not found on PATH"
}

is_checkout() {
  [ -f "$1/docker-compose.yml" ] && [ -f "$1/.env.example" ] &&
    [ -f "$1/scripts/backup.sh" ] && [ -f "$1/scripts/restore.sh" ]
}

# absent | empty | checkout | other
dir_state() {
  if [ ! -e "$DIR" ]; then
    echo absent
  elif [ ! -d "$DIR" ]; then
    echo other
  elif is_checkout "$DIR"; then
    echo checkout
  elif [ -z "$(ls -A "$DIR")" ]; then
    echo empty
  else
    echo other
  fi
}

valid_name() {
  one_line "$1" || return 1
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$' || return 1
  case $1 in
    *..*) return 1 ;;
  esac
  return 0
}

require_install() {
  [ "$(dir_state)" = checkout ] ||
    die 1 "no AIDA install in $DIR; run install first, or set AIDA_DIR to the install directory"
}

resolve_repo() {
  REPO=${AIDA_REPO:-$DEFAULT_REPO}
  valid_repo "$REPO" || die 2 "AIDA_REPO must be owner/name (letters, digits, . _ -), got an invalid value"
}

# --- release download and extraction ----------------------------------------------------------

# The only network call in this script.
download() {
  tmpd=${TMPDIR:-/tmp}
  ARCHIVE=$(mktemp "${tmpd%/}/aida-release.XXXXXX")
  url="https://github.com/$REPO/archive/refs/tags/$1.tar.gz"
  say "Downloading $url"
  curl -fsSL --proto '=https' --proto-redir '=https' -o "$ARCHIVE" "$url" ||
    die 1 "the download failed: $url"
}

# Extracts the downloaded archive into a new directory inside $1 and checks it is an AIDA release.
extract() {
  STAGE=$(mktemp -d "$1/.aida-release.XXXXXX")
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$STAGE" ||
    die 1 "the downloaded archive could not be extracted"
  rm -f "$ARCHIVE"
  ARCHIVE=''
  is_checkout "$STAGE" || die 1 "the downloaded archive is not an AIDA release"
}

# --- .env --------------------------------------------------------------------------------------

is_generated() {
  case $1 in
    POSTGRES_PASSWORD | BETTER_AUTH_SECRET | APP_ENCRYPTION_KEY | RATE_LIMIT_PEPPER) return 0 ;;
  esac
  return 1
}

# A new random value for a generated key, with the command .env.example documents for it.
new_secret() {
  if [ "$1" = POSTGRES_PASSWORD ]; then
    value=$(openssl rand -hex 32)
    [ "${#value}" -eq 64 ] || die 1 "openssl did not produce a password"
  else
    value=$(openssl rand -base64 32)
    [ "${#value}" -eq 44 ] || die 1 "openssl did not produce a secret"
  fi
  printf '%s' "$value"
}

# Prints KEY for a `KEY=value` line; fails for comments, blanks and anything else.
line_key() {
  case $1 in
    [A-Za-z_]*=*) ;;
    *) return 1 ;;
  esac
  key=${1%%=*}
  case $key in
    *[!A-Za-z0-9_]*) return 1 ;;
  esac
  printf '%s' "$key"
}

has_key() {
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$2"
}

# Writes $1/.env from $1/.env.example. An existing .env is copied unchanged and only the keys it
# lacks are appended; without one, the example is copied line by line with each generated key
# given a new value. The lines go to a temporary file in the same directory, which is renamed
# into place at the end.
write_env() {
  example="$1/.env.example"
  target="$1/.env"
  missing=''
  while IFS= read -r line || [ -n "$line" ]; do
    key=$(line_key "$line") || continue
    if [ ! -f "$target" ] || ! has_key "$key" "$target"; then missing="$missing $key"; fi
  done <"$example"
  if [ -f "$target" ] && [ -z "$missing" ]; then
    say ".env already has every key; nothing changed"
    return 0
  fi

  ENV_TMP=$(umask 077 && mktemp "$1/.env.tmp.XXXXXX")
  if [ -f "$target" ]; then
    cat "$target" >"$ENV_TMP"
    last=$(
      tail -c 1 "$target"
      echo x
    )
    if [ -s "$target" ] && [ "$last" != "${NL}x" ]; then printf '\n' >>"$ENV_TMP"; fi
    printf '# Added by scripts/install.sh from .env.example\n' >>"$ENV_TMP"
    for key in $missing; do
      if is_generated "$key"; then
        value=$(new_secret "$key")
        printf '%s=%s\n' "$key" "$value" >>"$ENV_TMP"
      else
        grep -E "^$key=" "$example" | head -n 1 >>"$ENV_TMP"
      fi
    done
    say "Added to .env:$missing (every existing value kept)"
  else
    while IFS= read -r line || [ -n "$line" ]; do
      if key=$(line_key "$line") && is_generated "$key"; then
        value=$(new_secret "$key")
        printf '%s=%s\n' "$key" "$value" >>"$ENV_TMP"
      else
        printf '%s\n' "$line" >>"$ENV_TMP"
      fi
    done <"$example"
    say "Wrote .env with generated secrets (mode 600)"
  fi
  chmod 600 "$ENV_TMP"
  mv -f "$ENV_TMP" "$target"
  ENV_TMP=''

  grep -E '^[A-Za-z_][A-Za-z0-9_]*=replace-me' "$target" | while IFS='=' read -r key _; do
    say "warning: $key in .env still holds the .env.example placeholder; set a real value"
  done
}

# Names of the keys $1/.env.example has and $1/.env lacks.
missing_keys() {
  while IFS= read -r line || [ -n "$line" ]; do
    key=$(line_key "$line") || continue
    if ! has_key "$key" "$1/.env"; then printf ' %s' "$key"; fi
  done <"$1/.env.example"
}

app_url() {
  url=$(grep -E '^NEXT_PUBLIC_APP_URL=' "$1/.env" | tail -n 1 | cut -d= -f2-)
  printf '%s' "${url:-http://localhost}"
}

compose_up() {
  (cd "$DIR" && docker compose up -d --build) ||
    die 1 "docker compose up failed in $DIR"
}

# --- subcommands -------------------------------------------------------------------------------

cmd_install() {
  [ "$#" -le 1 ] || usage_die
  tag=${1-$AIDA_DEFAULT_TAG}
  valid_tag "$tag" || die 2 "invalid tag (expected vMAJOR.MINOR.PATCH, for example $AIDA_DEFAULT_TAG)"
  resolve_repo
  state=$(dir_state)
  case $state in
    other) die 1 "$DIR exists and is not an empty directory or an AIDA install; set AIDA_DIR to another path" ;;
    checkout)
      # A rerun downloads nothing: it completes .env and starts the stack.
      need openssl
      need docker
      say "AIDA is already installed in $DIR; nothing is downloaded."
      say "To move to another release run: sh scripts/install.sh upgrade <tag>"
      write_env "$DIR"
      compose_up
      say "AIDA is starting. Open $(app_url "$DIR") once the containers are healthy."
      return 0
      ;;
  esac

  need tar
  need openssl
  need docker
  need curl
  parent=$(dirname "$DIR")
  mkdir -p "$parent"
  download "$tag"
  extract "$parent"
  chmod 755 "$STAGE"
  if [ "$state" = empty ]; then rmdir "$DIR"; fi
  mv "$STAGE" "$DIR"
  STAGE=''
  say "Extracted AIDA $tag into $DIR"

  write_env "$DIR"
  compose_up
  say "AIDA $tag is starting. Open $(app_url "$DIR") once the containers are healthy."
}

cmd_upgrade() {
  [ "$#" -eq 1 ] || usage_die
  tag=$1
  valid_tag "$tag" || die 2 "invalid tag (expected vMAJOR.MINOR.PATCH, for example $AIDA_DEFAULT_TAG)"
  resolve_repo
  require_install
  [ -f "$DIR/.env" ] || die 1 "$DIR has no .env; run install first"
  need tar
  need docker
  need curl
  say "Upgrading $DIR to $tag. Take a backup first if you have not: sh scripts/install.sh backup"
  download "$tag"
  extract "$(dirname "$DIR")"
  # .env belongs to the operator: never taken from an archive, never touched here.
  rm -rf "$STAGE/.env"
  cp -R "$STAGE/." "$DIR/"
  rm -rf "$STAGE"
  STAGE=''
  say "Replaced the files of $DIR with AIDA $tag; .env unchanged"
  lacking=$(missing_keys "$DIR")
  if [ -n "$lacking" ]; then
    say "The new .env.example has keys .env lacks:$lacking"
    say "Add them with: sh scripts/install.sh install (existing values are kept)"
  fi
  compose_up
  say "AIDA $tag is starting. Open $(app_url "$DIR") once the containers are healthy."
}

cmd_backup() {
  [ "$#" -eq 0 ] || usage_die
  require_install
  need docker
  (cd "$DIR" && sh scripts/backup.sh)
}

cmd_restore() {
  if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then usage_die; fi
  set_id=$1
  valid_name "$set_id" || die 2 "invalid set id; list the sets as docs/OPERATIONS.md, Restore shows"
  if [ "$#" -eq 2 ] && [ "$2" != --yes ]; then usage_die; fi
  require_install
  need docker
  need bash
  # scripts/restore.sh is a bash script.
  if [ "$#" -eq 2 ]; then
    (cd "$DIR" && bash scripts/restore.sh "$set_id" --yes)
  else
    (cd "$DIR" && bash scripts/restore.sh "$set_id")
  fi
}

cmd_logs() {
  [ "$#" -le 1 ] || usage_die
  if [ "$#" -eq 1 ]; then valid_name "$1" || die 2 "invalid service name"; fi
  require_install
  need docker
  if [ "$#" -eq 1 ]; then
    (cd "$DIR" && docker compose logs "$1")
  else
    (cd "$DIR" && docker compose logs)
  fi
}

# --- main --------------------------------------------------------------------------------------

main() {
  [ "$#" -ge 1 ] || usage_die
  if [ -n "${AIDA_DIR:-}" ]; then
    DIR=$AIDA_DIR
  elif is_checkout .; then
    DIR=.
  else
    DIR=./aida
  fi
  one_line "$DIR" || die 2 "AIDA_DIR must be a single line"

  command=$1
  shift
  case $command in
    install) cmd_install "$@" ;;
    upgrade) cmd_upgrade "$@" ;;
    backup) cmd_backup "$@" ;;
    restore) cmd_restore "$@" ;;
    logs) cmd_logs "$@" ;;
    -h | --help | help) usage ;;
    *) usage_die ;;
  esac
}

# upgrade replaces this very file when it runs from inside an install. The shell has parsed every
# function above and this whole line before main starts, and `exit` keeps it from reading on.
main "$@"; exit "$?"
