#!/bin/sh
# tests/unit/fixtures/install/fake-docker.sh: a fake `docker` for tests/unit/install-script.test.ts
# (plan 09-12, AIDA-40). It never reaches a Docker daemon. Every call appends its arguments,
# newlines folded to spaces, as one line to the file named by FAKE_DOCKER_LOG, and the directory
# it ran in as one line to "$FAKE_DOCKER_LOG.cwd".
#
# FAKE_DOCKER_ALLOW is a `|`-separated list of whole argument lines the test expects, for example
# `compose up -d --build|compose logs app`. Any call not on that list exits 97, so an unexpected
# command (a `down`, a volume removal, a pull) fails the case that caused it.
: "${FAKE_DOCKER_LOG:?FAKE_DOCKER_LOG is not set}"
line=$(printf '%s' "$*" | tr '\n' ' ')
printf '%s\n' "$line" >>"$FAKE_DOCKER_LOG"
pwd >>"$FAKE_DOCKER_LOG.cwd"

case "|${FAKE_DOCKER_ALLOW:-}|" in
  *"|$line|"*) exit 0 ;;
  *)
    printf 'fake docker: unexpected call: %s\n' "$line" >&2
    exit 97
    ;;
esac
