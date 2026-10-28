# Executor brief (orchestrator rules for every plan executor in this run)

Every dispatch quotes the charter's "Aturan eksekutor" verbatim and points here. These rules come on top of the charter, `PIAGAM.md` (rules A to J, "Aturan teknis AIDA", "Test dan bukti", "Larangan", "Clean-room"). Where the two differ, the stricter one wins.

## Docker

- Any test run that uses Docker (Testcontainers through `pnpm test:integration` or `pnpm test:e2e`) needs:
  - `AIDA_TEST_RUN_ID=<the run id in the dispatch>`
  - `DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"`
- Run one test process at a time. Send the output of long commands to a log, and read the exit code without a pipe.
- Never touch project `aida`, `aida-dev-db`, `smartcv-*` or any other project.
- No prune, and nothing in `~/.colima`. Never stop or restart Colima or Docker.
- Never run `pnpm test:docker-cleanup --apply`. The orchestrator cleans up for the run id at the end of the round. Exception: a plan that defines its own teardown through that script, such as 08-02's dev database, follows its plan.
- An image build needs 20 GiB free on the host and in the VM (rule J). The VM currently has 13.9 GiB, so builds stop at preflight. Record such a step as `blocked (space)`, never as passed.

## Git and GitHub

- Never use `git push`, `gh pr`, `gh release`, `gh workflow run`, `--no-verify`, `git stash`, `git reset --hard`, `git clean`, `git merge` or `git rebase`.
- Workflow files must use only `runs-on: ubuntu-latest` and must not add a new `schedule:` (rule I).

## Files and state

- Do not read `.env`.
- Do not run `state.record-session`, `state.advance-plan` or `roadmap update-plan-progress`; they damage `STATE.md` in this project. The orchestrator updates STATE and ROADMAP. If a tool rewrites `STATE.md`, restore it with `git checkout -- .planning/STATE.md`.
- `.next/` is never removed with `rm`. If `tsc` or the build breaks after repeated E2E runs, run `mv .next ~/.Trash/aida-next-$(date +%s)` and report it. Report any generated file you move to the Trash as well.
- Delete every `mktemp -d` directory you create under `${TMPDIR}` before you finish, unless the plan needs it; in that case report its path.

## Honesty

- A step that cannot run is recorded in the SUMMARY as `blocked (...)` or `not run`, never as passed. Causes include no Docker, no network, rule J space, or a missing image.
- Visual, dark-mode, screen-reader and UAT checks stay manual items. Never record a human result.
- If a task fails after 2 fix attempts: stop, commit the last state with the subject prefix `wip(parkir):`, and report why.

## Report back briefly

- every commit (hash and subject);
- every test, build or audit command with its exit code and counts;
- deviations from the plan;
- anything blocked or not run;
- the SUMMARY path.
