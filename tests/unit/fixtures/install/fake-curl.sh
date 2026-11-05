#!/bin/sh
# tests/unit/fixtures/install/fake-curl.sh: a fake `curl` for tests/unit/install-script.test.ts
# (plan 09-12, AIDA-40). It never touches the network. Every call appends its arguments, newlines
# folded to spaces, as one line to the file named by FAKE_CURL_LOG. Then it accepts exactly one
# shape of call, the installer's release download:
#
#   curl -fsSL --proto =https --proto-redir =https -o <file> <url>
#
# where <url> must equal FAKE_CURL_EXPECT_URL. On a match it copies FAKE_CURL_TARBALL to <file>.
# Any other flag, a second URL, or any other URL or host exits 97, so an unexpected network call
# fails the case that caused it.
: "${FAKE_CURL_LOG:?FAKE_CURL_LOG is not set}"
{
  printf '%s' "$*" | tr '\n' ' '
  printf '\n'
} >>"$FAKE_CURL_LOG"

unexpected() {
  printf 'fake curl: unexpected call (%s): %s\n' "$1" "$2" >&2
  exit 97
}

all="$*"
out=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -fsSL) ;;
    --proto | --proto-redir)
      [ "${2:-}" = '=https' ] || unexpected "protocol" "$all"
      shift
      ;;
    -o)
      [ -n "${2:-}" ] || unexpected "missing -o path" "$all"
      out="$2"
      shift
      ;;
    https://*)
      [ -z "$url" ] || unexpected "second URL" "$all"
      url="$1"
      ;;
    *) unexpected "argument $1" "$all" ;;
  esac
  shift
done

[ -n "$out" ] || unexpected "no -o" "$all"
[ -n "${FAKE_CURL_EXPECT_URL:-}" ] || unexpected "no URL expected" "$all"
[ "$url" = "$FAKE_CURL_EXPECT_URL" ] || unexpected "URL" "$all"
[ -f "${FAKE_CURL_TARBALL:-}" ] || unexpected "no fixture tarball" "$all"
cp "$FAKE_CURL_TARBALL" "$out"
