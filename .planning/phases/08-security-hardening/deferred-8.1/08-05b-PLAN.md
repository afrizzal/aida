---
phase: 08-security-hardening
plan: 05b
type: execute
wave: 2
depends_on: ["08-05"]
files_modified:
  - scripts/ci-egress-result.ts
  - tests/unit/ci-egress-result.test.ts
  - .github/workflows/egress.yml
  - tests/unit/build-egress-guards.test.ts
autonomous: true
requirements: [AIDA-26, AIDA-32]

estimate:
  tokens: 45000
  raw_tokens: 45000
  tasks: 1
  confidence: low

must_haves:
  truths:
    - "`.github/workflows/egress.yml` has one job `egress` that runs `pnpm test:egress`, triggered only by a pull_request that changes `Dockerfile`, a `docker-compose*.yml` file or `pnpm-lock.yaml` (a `paths:` filter), and by workflow_dispatch; it has no scheduled trigger (review C1, R3-2; owner decision 2026-11-11, rule I)"
    - "The egress job ends in exactly one state, `passed`, `failed`, `blocked (space)` or `not run`, shown as an annotation in the job output and as a section of the job summary; the job succeeds only when the state is `passed`, so a stop at the rule J 20 GiB space preflight fails the job, labelled `blocked (space)`, and is never reported as a pass (rule J, R3-2, owner decision 2026-11-11)"
    - "Every job in every workflow under `.github/workflows/` uses `runs-on: ubuntu-latest`, no workflow other than integration.yml has a scheduled trigger, and with egress.yml present the rule I check counts five workflows (rule I)"
    - "This plan triggers no workflow: no `gh workflow run`, no push, and no local `pnpm test:egress` or image build (charter Larangan and rule G, rule J)"
  artifacts:
    - path: ".github/workflows/egress.yml"
      provides: "CI egress job on PR paths and manual dispatch"
      contains: "pnpm test:egress"
    - path: "scripts/ci-egress-result.ts"
      provides: "classifies an egress CI run as passed, failed, blocked (space) or not run, writes the annotation and the job summary, exits 0 only for passed"
      contains: "blocked (space)"
    - path: "tests/unit/ci-egress-result.test.ts"
      provides: "classifier unit tests built on the real J1 space-stop message"
      min_lines: 60
  key_links:
    - from: ".github/workflows/egress.yml"
      to: "scripts/ci-egress-result.ts"
      via: "the last step runs the classifier under always(), reading the suite step's outcome and its log, so the job result comes from the classifier and not from a skipped or masked step"
      pattern: "ci-egress-result"
    - from: "tests/unit/ci-egress-result.test.ts"
      to: "tests/support/docker-test-preflight.ts"
      via: "the test builds its space-stop fixtures by calling the J1 function assertEnoughSpace, so a change to the J1 message breaks the test instead of silently turning blocked (space) into failed"
      pattern: "assertEnoughSpace"
  prohibitions:
    - statement: "MUST NOT trigger a workflow run or push from this run; the CI egress job is delivered as a file only"
      status: resolved
      verification: test
    - statement: "MUST NOT let the egress job end green, or skipped, when the suite stopped at the rule J space preflight or did not run"
      status: resolved
      verification: test
    - statement: "MUST NOT run `pnpm test:egress` or build an image locally in this plan; the local egress run is queue item 0a2 (rule J)"
      status: resolved
      verification: judgment
---

<!-- Deferred plan, Phase 8.1 (Part B of the Phase 8 split). Not run by `/gsd-execute-phase 8`. -->

**Deferred to Phase 8.1. Waits for the owner. Carries the open HIGH finding R4-2.**

- **Origin.** This plan holds plan 08-05's former Task 3 verbatim. It moved here in 08-05 Revision 5 (2026-11-11), following `../08-SPLIT.md`, section "Steps", item 2, and the owner decision of 2026-11-11, item 4.
- **Open HIGH finding R4-2** (`../08-REVIEWS.md`, Cycle 4). The classifier in the task below marks a failed run `blocked (space)` when the log holds a space-stop line and none of six later-stage markers. So a space stop in one suite file plus an assertion failure in another file would be labelled `blocked (space)`. That breaks 08-19's Recording rule: a blocker together with another error is `failed`. Before this plan runs, it must be replanned so that the classification comes from the structured result of the whole suite, per file and over every file. Its unit tests must include mixed cases across files: a space stop in one file plus a failure, a pass or another preflight stop in another. This matters more in Phase 8.1, where plans 08-14, 08-22 and 08-23 add container suite files to `pnpm test:egress`. Plan 08-24 (Part A gate) shows one way to do this: vitest JSON counts per file, plus a check of every error header line in the log.
- **Waits for the owner.** Queue row 08.1 waits for an owner decision on the review budget and on blockers 0a2 (Docker VM space) and 08-o2 (`caddy:2`). The run does not execute this plan on its own initiative. When the owner decides, this plan moves into the Phase 8.1 folder with the other deferred plans and is renumbered there.
- **Reading the task text.** "Tasks 1 and 2" in the task below are plan 08-05's Tasks 1 and 2. This plan's precondition is that plan 08-05 is complete: `.github/workflows/audit.yml`, `.github/dependabot.yml` and `tests/unit/build-egress-guards.test.ts` with Tests 1 to 9 exist. Test 9 already checks egress.yml's triggers whenever the file exists (08-05 Revision 5). The task keeps the label "Task 3" so that the review history and the 08-05 Revision 4 table still match it.

<objective>
Give the egress isolation suite its own CI job, delivered as a file only (review C1, R3-2). Like plan 08-05, it follows the owner decisions of 2026-11-11. Charter rule I: no GitHub cost, `runs-on: ubuntu-latest` only, no new scheduled workflow, and the owner's trigger list for `egress`. Rule J: the egress job reports a stop at the 20 GiB space preflight honestly, never as a pass.

Purpose: review C1 and R3-2 require that the egress suite's result stays visible on its own, as passed, failed or blocked, never hidden.
Output: a new egress workflow with a tested result classifier, and one more guard test.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-security-hardening/08-SPLIT.md
@.planning/phases/08-security-hardening/08-05-PLAN.md
@.planning/phases/08-security-hardening/08-19-PLAN.md
@.planning/run-loop/PIAGAM.md
@.planning/run-loop/J1-RENCANA.md
@.planning/phases/08-security-hardening/08-REVIEWS.md
@.github/workflows/ci.yml
@.github/workflows/integration.yml
@tests/integration/egress-isolation.test.ts
@tests/support/docker-test-preflight.ts

Binding for this plan: 08-REVIEWS.md sections "Owner decisions 2026-11-11 and replan brief (cycle 4)" and "Cycle 4" (R4-2), and PIAGAM.md "Aturan owner 2026-11-08" items I and J plus "Larangan".

Facts, copied from plan 08-05 (tree at 7e9e73f; re-check them when this plan is replanned):
- ci.yml triggers: push to master, pull_request, workflow_dispatch; `concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true`; job `build` runs pnpm install, `cp .env.example .env`, `pnpm db:generate`, lint, typecheck, test, build. integration.yml triggers on its existing nightly cron `"0 3 * * *"` and workflow_dispatch, and has one job `integration` running `pnpm test:integration`. docs.yml has jobs `build` and `deploy`, both `runs-on: ubuntu-latest`; this plan does not change docs.yml, but the rule I guard test reads it. Every current job uses `runs-on: ubuntu-latest`.
- Workflow step style to copy: `actions/checkout@v5`, `pnpm/action-setup@v4` (reads packageManager), `actions/setup-node@v5` with `node-version-file: .nvmrc` and `cache: pnpm`.
- `website/` is a separate pnpm project with its own package.json and pnpm-lock.yaml (tracked). The root has `Dockerfile`, `docker-compose.yml` and `docker-compose.egress-test.yml`; the two fixture Dockerfiles live under `tests/integration/egress-fixtures/`.
- The egress suite is already out of the integration include (J1, K113: `vitest.integration.config.ts` excludes `tests/integration/egress-isolation.test.ts`) and runs only through `pnpm test:egress` (`vitest.egress.config.ts`).
- The egress suite's `beforeAll` takes the lock, checks the compose config, then runs `runBuildPreflight` before any build. The preflight's last two checks are the space checks: host first, then the Docker VM through a one-off `node:22-alpine` container started with `--pull never`. Below 20 GiB, J1's `assertEnoughSpace` throws `Free space on <the host|the Docker VM> is <N> GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner.` Before the build starts, teardown removes nothing (K121).
- Images the suite runs without building, all with `--pull never`: `node:22-alpine` (space probe, `negative-control`), `pgvector/pgvector:pg16` (`db`), `greenmail/standalone:latest` (`stub-smtp`). A fresh GitHub runner has none of them; on the dev Mac they are present (J1 facts). K112 says the same rule J space check applies on ubuntu-latest, not yet proven in CI. GitHub's runner reference lists 14 GB of SSD for standard Linux runners; the free space on a real runner's `/` has not been measured for this repo.
- The egress suite's later-stage error texts (after the build started): `docker compose build failed`, `docker compose up failed`, `recording the project's resources failed`, `reported unhealthy`, `did not become healthy`, `cleanup of run`.
- GitHub facts used here (GitHub docs via Context7): a job skipped by an `if:` condition reports Success; a workflow skipped by a `paths:` filter leaves its required checks Pending, so path-filtered workflows should not be required checks; Dependabot `open-pull-requests-limit` applies per update entry to version updates, and security-update PRs have a separate fixed limit of 10.
- CLI pattern to copy: scripts/test-docker-cleanup.ts (header comment, `main(argv)` returning an exit code, `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(...)`). `tsx` is already a dependency (`pnpm test:docker-cleanup` uses it). Unit tests live in `tests/unit/**/*.test.ts` (vitest.config.ts); J1's own unit test tests/unit/docker-test-preflight.test.ts already imports tests/support/docker-test-preflight.ts.
- A YAML parser is available on this machine as `ruby -ryaml` (Ruby 2.6); no YAML package is a direct dependency of the repo. Ruby's YAML 1.1 parser reads the workflow key `on` as the boolean `true`, so structural checks read `d["on"] || d[true]`.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 3: Egress workflow on PR paths and manual dispatch, with a result classifier that never reports a space stop as a pass</name>
  <read_first>
    - tests/integration/egress-isolation.test.ts (beforeAll order, the later-stage error texts, the images started with --pull never)
    - tests/support/docker-test-preflight.ts (assertEnoughSpace and its message, runBuildPreflight order, dockerFreeBytes and SPACE_PROBE_IMAGE)
    - tests/unit/docker-test-preflight.test.ts (how J1's unit tests import the preflight module)
    - scripts/test-docker-cleanup.ts (header comment, and the main/argv/exit-code pattern to copy)
    - docker-compose.egress-test.yml (service images; this plan changes nothing in it)
    - .github/workflows/integration.yml (setup steps to copy)
    - .planning/run-loop/J1-RENCANA.md (K112, K118, K121)
    - .planning/phases/08-security-hardening/08-REVIEWS.md (cycle 4 brief: R3-2 row of the Mapping table, the "Known blocker" line)
    - tests/unit/build-egress-guards.test.ts (from Tasks 1 and 2)
  </read_first>
  <files>scripts/ci-egress-result.ts, tests/unit/ci-egress-result.test.ts, .github/workflows/egress.yml, tests/unit/build-egress-guards.test.ts</files>
  <behavior>
    Classifier tests in tests/unit/ci-egress-result.test.ts. Fixture logs are strings. The two space-stop lines are produced by calling J1's `assertEnoughSpace("the host", bytes)` and `assertEnoughSpace("the Docker VM", bytes)` with 13.9 GiB and taking the thrown message, never by retyping it.
    - C1: outcome `success`, log without a space-stop line: state `passed`; `main` returns 0 and prints a `::notice title=Egress suite passed::` line.
    - C2: outcome `failure`, log holding the host message as vitest prints it (prefixed by `DockerPreflightError: `): state `blocked (space)`; `main` returns 1, prints `::error title=Egress suite blocked (space)::` followed by the stop line, and appends a summary section whose heading contains `blocked (space)` and whose text says the suite did not run its tests and that this is not a pass.
    - C3: as C2 with the Docker VM message: state `blocked (space)`.
    - C4: outcome `failure`, a space-stop line plus one later-stage text (for example `docker compose build failed`): state `failed`.
    - C5: outcome `failure`, no space-stop line: state `failed`.
    - C6: outcome `success` but the log has a space-stop line: state `failed` (inconsistent evidence never becomes a pass).
    - C7: outcomes `skipped` and `cancelled`: state `not run`; `main` returns 1.
    - C8: a missing log file and a blank log, each with outcome `success` and with `failure`: state `failed`, never `passed`.
    - C9: ANSI colour codes around the stop line are stripped before matching: state `blocked (space)`.
    - C10: an unknown outcome text gives `failed`; a missing `--outcome` or `--log` makes `main` return 2 and print usage to stderr.
    - C11: annotation messages escape `%`, CR and LF as `%25`, `%0D`, `%0A`; the summary is appended (never overwritten) to the file named by `GITHUB_STEP_SUMMARY` when it is set, and printed to stdout when it is not.
    - C12: every later-stage text the classifier lists occurs in tests/integration/egress-isolation.test.ts (read as text), so renaming an error in the suite breaks this test.
    Guard test in tests/unit/build-egress-guards.test.ts:
    - Test 10 (rule I, R3-2, D-27): egress.yml has a column-0 `env:` block with both D-27 variables and `permissions:` with `contents: read`; `blockKeys(egress, "on")` is exactly `pull_request` and `workflow_dispatch`; the pull_request block has a `paths:` list of exactly `Dockerfile`, `docker-compose*.yml` and `pnpm-lock.yaml`; there is exactly one job, `egress`; a step runs `pnpm test:egress`; the last step runs `scripts/ci-egress-result.ts` and has `if: always()` (or the `${{ always() }}` form).
    - Tests 8 and 9 now also cover egress.yml through the directory scan, without a change.
  </behavior>
  <action>
    1. Write tests/unit/ci-egress-result.test.ts with C1 to C12 (one `it` each; titles name rule J or R3-2), importing `assertEnoughSpace` from tests/support/docker-test-preflight.ts and the classifier's exports from scripts/ci-egress-result.ts. Inject the IO into `main` (`readLog`, `appendSummary`, `stdout`, `stderr`, `env`) so no test spawns a process or writes a real summary file. Extend tests/unit/build-egress-guards.test.ts with Test 10. Run both files and confirm they fail (neither the script nor egress.yml exists yet).
    2. Create scripts/ci-egress-result.ts. Header comment in the style of scripts/test-docker-cleanup.ts: it classifies one CI run of `pnpm test:egress` (charter rule J, review R3-2, owner decision 2026-11-11); it lists the four states and the exit codes (0 only for `passed`; 1 for `failed`, `blocked (space)` and `not run`; 2 for a usage error); and it states that a stop at the rule J space preflight is reported, never passed. Exports:
       - `EgressState`, the union of `passed`, `failed`, `blocked (space)` and `not run`.
       - `SPACE_STOP_PATTERN`, a regex matching J1's message: `Free space on `, then `the host` or `the Docker VM`, then ` is `, a decimal number, ` GiB, below the `, a decimal number, ` GiB rule J requires before an image build`.
       - `LATER_STAGE_MARKERS`, the six later-stage texts listed in the context facts.
       - `classifyEgressRun({ outcome, log })`, with `log` a string or null (null means the file is missing or unreadable), returning `{ state, evidence }` where evidence is a list of lines. Decide in this order: outcome `skipped` or `cancelled` gives `not run`; a null or blank log gives `failed`; strip ANSI escape sequences and collect the unique lines that match `SPACE_STOP_PATTERN`; outcome `success` gives `passed` only when there is no space-stop line, else `failed`; outcome `failure` gives `blocked (space)` only when there is at least one space-stop line and no line contains a later-stage marker, else `failed`; any other outcome gives `failed`.
       - `renderResult(result, outcome)`, returning `{ annotation, summary, exitCode }`. The annotation is one workflow command line: `::notice title=Egress suite passed::` plus a short message for `passed`, otherwise `::error title=Egress suite <state>::` plus the first evidence line or a fixed sentence, with the message escaped as in C11. The summary is a markdown section: a level-3 heading `Egress isolation suite: <state>`, the evidence lines in a fenced block, and one fixed sentence per state. For `blocked (space)` the sentence says that the rule J preflight stopped before any image build because this runner has less than 20 GiB free, that the suite did not run its tests, that this is not a pass, and that the owner decides how CI treats it (plan 08-05, Manual items).
       - `main(argv, io)`, which parses `--outcome <value>` and `--log <path>`, reads the log through `io`, prints the annotation, appends the summary, and returns the exit code. The bottom-of-file guard copied from scripts/test-docker-cleanup.ts sets `process.exitCode` from `main(process.argv.slice(2))` with the real IO (stdout, stderr, `fs.readFileSync` returning null on error, `fs.appendFileSync` on `GITHUB_STEP_SUMMARY`).
       Run the classifier test until it is green.
    3. Create .github/workflows/egress.yml (review C1 and R3-2; triggers per the owner decision of 2026-11-11, rule I; space handling per rule J). Leading `#` comment of four to six lines: it runs the egress isolation suite (`pnpm test:egress`), which J1 keeps out of `pnpm test:integration` (review C1, K113); by the owner decision of 2026-11-11 (charter rule I) it runs only on a pull request that changes the Dockerfile, a compose file or the lockfile, and on manual dispatch; it is a separate file because GitHub triggers belong to a workflow, so a job inside integration.yml would also run on that file's nightly cron; the suite's rule J preflight stops below 20 GiB free, which a standard runner may not have, and that stop ends the job red and labelled `blocked (space)`, never green; it should not be made a required check, because a path-filtered workflow leaves its check Pending on every other pull request. Then:
       - `name: Egress isolation`; `on:` with `pull_request` whose `paths:` list is exactly `"Dockerfile"`, `"docker-compose*.yml"` and `"pnpm-lock.yaml"`, plus `workflow_dispatch`, and no other trigger.
       - `permissions: contents: read`; `concurrency:` with `group: egress-${{ github.ref }}` and `cancel-in-progress: true` (a newer commit on the same pull request supersedes the run, and the runner is discarded, so a cancelled run leaves nothing behind).
       - Workflow-level env with the two D-27 variables.
       - Job `egress` (name `Egress isolation suite (rule J preflight)`, `runs-on: ubuntu-latest`, `timeout-minutes: 60`) with these steps in order: checkout; pnpm/action-setup@v4; setup-node@v5 (`.nvmrc`, pnpm cache); `pnpm install --frozen-lockfile`; `cp .env.example .env`; `pnpm db:generate` (the integration job's proven setup); a step `Record free space (information only)` that runs `df -h` on `/` and on the directory printed by `docker info --format '{{.DockerRootDir}}'`, printing it to the log and appending it under a heading to `$GITHUB_STEP_SUMMARY`, with no threshold of its own (J1's preflight stays the only space gate); a step that runs `docker pull` for `node:22-alpine`, `pgvector/pgvector:pg16` and `greenmail/standalone:latest`, with a comment that the suite starts these with `--pull never`, that a fresh runner has none of them, and that without them the run would fail at the space probe instead of reaching the space check; the suite step with `id: suite`, `shell: bash` (so the pipe keeps the suite's exit code), env `NO_COLOR: "1"` and `EGRESS_LOG: ${{ runner.temp }}/egress.log`, running `pnpm test:egress 2>&1 | tee "$EGRESS_LOG"`; and last, a step `Report the egress result` with `if: always()`, `shell: bash`, env `EGRESS_OUTCOME: ${{ steps.suite.outcome }}` and the same `EGRESS_LOG`, running `pnpm exec tsx scripts/ci-egress-result.ts --outcome "$EGRESS_OUTCOME" --log "$EGRESS_LOG"`.
       - Pass these values only through `env:`; no `run:` script uses an event-controlled field (pull request title, body or branch name).
       Do not change integration.yml in this task: no egress job there and no new trigger (owner decision 2026-11-11).
    4. Run, in this order: the classifier and guard tests, the YAML parse of all five files, the egress structural check, the rule I check again (it now sees five workflows), the CLI smoke command, `pnpm typecheck`, and `pnpm lint`.
    5. Do not run `pnpm test:egress`, do not build or pull an image locally, do not run `gh workflow run`, and do not push. In the SUMMARY, record the egress CI job as `not run` (file only, nothing pushed) and list the four states it can report.
    6. Commit with message `ci(08-05): egress workflow on PR paths and manual dispatch with an honest space-stop result (R3-2, rule I, rule J)`.
  </action>
  <verify>
    <automated>pnpm exec vitest run tests/unit/ci-egress-result.test.ts tests/unit/build-egress-guards.test.ts</automated>
    <fails_when>non-zero exit, or "No test files found", or fewer than 2 test files reported, or fewer than 22 passed tests in total (12 classifier, 10 guard)</fails_when>
    <automated>ruby -ryaml -e 'ARGV.each { |f| YAML.load_file(f) }; puts "yaml ok"' .github/workflows/ci.yml .github/workflows/integration.yml .github/workflows/audit.yml .github/workflows/egress.yml .github/dependabot.yml</automated>
    <fails_when>non-zero exit, or output contains "Psych::SyntaxError", or the line "yaml ok" is absent</fails_when>
    <automated>ruby -ryaml -e 'bad = []; Dir[".github/workflows/*.yml"].sort.each { |f| d = YAML.load_file(f); t = d["on"] || d[true] || {}; t = {} unless t.is_a?(Hash); bad.push("#{f}: scheduled trigger") if t.key?("schedule") and File.basename(f) != "integration.yml"; (d["jobs"] || {}).each { |id, j| bad.push("#{f}: job #{id} runs-on #{j["runs-on"].inspect}") unless j["runs-on"] == "ubuntu-latest" } }; eg = YAML.load_file(".github/workflows/egress.yml"); egt = eg["on"] || eg[true]; bad.push("egress.yml triggers #{egt.keys.sort}") unless egt.keys.sort == ["pull_request", "workflow_dispatch"]; bad.push("egress.yml paths #{egt["pull_request"]["paths"].inspect}") unless egt["pull_request"]["paths"].sort == ["Dockerfile", "docker-compose*.yml", "pnpm-lock.yaml"]; bad.push("egress.yml jobs #{eg["jobs"].keys}") unless eg["jobs"].keys == ["egress"]; bad.push("egress.yml permissions #{eg["permissions"].inspect}") unless eg["permissions"].to_a == [["contents", "read"]]; st = eg["jobs"]["egress"]["steps"]; bad.push("egress.yml has no pnpm test:egress step") unless st.any? { |x| x["run"].to_s.include?("pnpm test:egress") }; bad.push("egress.yml last step is not the classifier under always()") unless st.last["run"].to_s.include?("scripts/ci-egress-result.ts") and st.last["if"].to_s.include?("always()"); ig = YAML.load_file(".github/workflows/integration.yml"); bad.push("integration.yml runs the egress suite") if ig["jobs"].values.flat_map { |j| j["steps"] }.any? { |x| x["run"].to_s.include?("pnpm test:egress") }; abort(bad.join("\n")) unless bad.empty?; puts "egress workflow ok"'</automated>
    <fails_when>non-zero exit, or the line "egress workflow ok" is absent, or any output line names a workflow file</fails_when>
    <automated>ruby -ryaml -e 'bad = []; files = Dir[".github/workflows/*.yml"].sort; files.each { |f| d = YAML.load_file(f); t = d["on"] || d[true] || {}; t = {} unless t.is_a?(Hash); bad.push("#{f}: scheduled trigger") if t.key?("schedule") and File.basename(f) != "integration.yml"; (d["jobs"] || {}).each { |id, j| bad.push("#{f}: job #{id} runs-on #{j["runs-on"].inspect}") unless j["runs-on"] == "ubuntu-latest" } }; ig = YAML.load_file(".github/workflows/integration.yml"); igt = ig["on"] || ig[true]; bad.push("integration.yml triggers #{igt.keys.sort}") unless igt.keys.sort == ["schedule", "workflow_dispatch"]; bad.push("integration.yml cron #{igt["schedule"].inspect}") unless igt["schedule"].map { |s| s["cron"] } == ["0 3 * * *"]; bad.push("integration.yml jobs #{ig["jobs"].keys}") unless ig["jobs"].keys == ["integration"]; au = YAML.load_file(".github/workflows/audit.yml"); aut = au["on"] || au[true]; bad.push("audit.yml triggers #{aut.keys.sort}") unless aut.keys.sort == ["pull_request", "push", "workflow_dispatch"]; bad.push("audit.yml push branches") unless aut["push"]["branches"] == ["master"]; dep = YAML.load_file(".github/dependabot.yml")["updates"]; bad.push("dependabot entries") unless dep.map { |e| [e["package-ecosystem"], e["directory"]] }.sort == [["docker", "/"], ["github-actions", "/"], ["npm", "/"], ["npm", "/website"]]; dep.each { |e| bad.push("dependabot #{e["package-ecosystem"]} #{e["directory"]}: limit #{e["open-pull-requests-limit"].inspect}, interval #{e["schedule"]["interval"]}") unless e["open-pull-requests-limit"] == 3 and e["schedule"]["interval"] == "weekly" }; abort(bad.join("\n")) unless bad.empty?; puts "rule I ok: #{files.size} workflows"'</automated>
    <fails_when>non-zero exit, or the output is not exactly one line "rule I ok: 5 workflows", or any output line names a workflow file, a job or a Dependabot entry</fails_when>
    <automated>pnpm exec tsx scripts/ci-egress-result.ts --outcome success --log package.json</automated>
    <fails_when>non-zero exit, or stdout has no line starting "::notice title=Egress suite passed::" (the bottom-of-file guard did not run main)</fails_when>
    <automated>pnpm typecheck</automated>
    <fails_when>non-zero exit, or any line containing "error TS"</fails_when>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/egress.yml`, `scripts/ci-egress-result.ts` and `tests/unit/ci-egress-result.test.ts` exist; the classifier test has at least 12 `it(` blocks and the guard test at least 10, all passing.
    - The egress structural check prints `egress workflow ok`, and the rule I check prints `rule I ok: 5 workflows`.
    - The classifier test proves that `blocked (space)`, `failed` and `not run` each make `main` return 1, and only `passed` returns 0; the CLI smoke run prints the passed notice and exits 0.
    - `git show --stat --format= HEAD` for this task's commit lists no change to `.github/workflows/integration.yml`.
    - `pnpm typecheck` and `pnpm lint` exit 0.
    - The SUMMARY states that `pnpm test:egress` was not run locally, that no image was built or pulled, that no workflow was triggered and nothing was pushed, and that the CI egress job is `not run` (file only).
  </acceptance_criteria>
  <done>The egress suite has its own CI job on the owner's triggers only, on ubuntu-latest, and a space stop on a runner can only end red and labelled `blocked (space)`, never green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub Actions -> repo | workflow files run with the repository token |
| pull request code -> CI runner | the egress job builds and runs images from the pull request's own Dockerfile, compose files and lockfile |
| CI result -> reviewer and owner | a check's colour and summary are what people read; a wrong green hides a missing proof |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-08-130 | Repudiation | egress CI result (egress.yml, scripts/ci-egress-result.ts) | high | mitigate | The job is green only for `passed`; a rule J space stop is `blocked (space)`, an error annotation, a summary section and exit 1; skipped or cancelled is `not run` and exit 1; the classifier is the last step under always(); unit tests C1 to C12 built on J1's real message; ruby structural check (Task 3) |
| T-08-131 | Tampering | script injection in workflow `run:` steps | medium | mitigate | The step outcome and the log path reach scripts only through `env:`; no `run:` script uses an event-controlled field such as a pull request title, body or branch name |
| T-08-132 | Elevation of privilege | PR-triggered egress job that builds pull request code | medium | mitigate | `pull_request` (never `pull_request_target`), so a fork's pull request gets a read-only token and no secrets; `permissions: contents: read`; an ephemeral runner |
| T-08-133 | Denial of service | GitHub cost (charter rule I) | medium | mitigate | Guard Test 9 and the ruby rule I check: every job on `ubuntu-latest`, no scheduled trigger outside the existing integration nightly; Dependabot limited to 3 open version-update pull requests per entry; the repository stays public and nothing here touches LFS, Codespaces or visibility |
| T-08-134 | Tampering | images pulled in CI by tag (`node:22-alpine`, `pgvector/pgvector:pg16`, `greenmail/standalone:latest`) | low | accept | The same images and tags the suite already uses on the dev machine; the runner is ephemeral and holds no secrets; the tags are set by docker-compose.egress-test.yml and the J1 preflight, which this plan does not change |

Open finding, not mitigated by the task as written: R4-2 (HIGH). The T-08-130 mitigation classifies from log markers, not from the structured per-file result of the whole suite. The replan this plan waits for must close it (see the note at the top).
</threat_model>

<verification>
- Classifier test (12 tests) and guard test (10 tests) pass; `pnpm typecheck` and `pnpm lint` pass.
- All five workflow and config YAML files parse; the rule I check prints `rule I ok: 5 workflows`; the egress structural check prints `egress workflow ok`.
- No workflow was triggered, nothing was pushed, and `pnpm test:egress` was not run locally.
</verification>

<success_criteria>
The egress suite has its own CI job, on the owner's triggers only and on ubuntu-latest. A space stop on a runner can only end red and labelled `blocked (space)`, never green. After the R4-2 replan, a space stop mixed with any other failure in any suite file also ends `failed`.
</success_criteria>

## Manual items (left open for a human)

- Owner decision (rule F): how CI should treat an egress run that stops at the rule J space check. This plan ships the strictest honest reading: the job fails, labelled `blocked (space)`. GitHub's runner reference lists 14 GB of SSD for standard Linux runners, so the stop may be the usual outcome. Every Dependabot npm pull request changes `pnpm-lock.yaml` and so runs this job. Options: keep it red as shipped; allow a step that frees runner disk before the suite (no GitHub cost, but it deletes files on the runner, and common recipes also prune Docker, which rule J forbids by its wording); or set a different threshold for ephemeral CI runners, which changes rule J and is the owner's alone.
- Owner decision: do not make the `egress` check required, or decide otherwise knowingly. GitHub leaves a path-filtered workflow's required check Pending on every pull request that does not touch those paths, which blocks the merge.
- First real CI run of `egress` happens only after the owner pushes; until then it is `not run` (file only).
- Owner decision: the review budget for this plan's R4-2 replan (no fifth Codex cycle was allowed for Phase 8; queue row 08.1).

## Origin and history

- Moved from plan 08-05 in its Revision 5 (2026-11-11). Plan 08-05's Revision 4 table, rows 2, 3, 7, 8, 9, 12 and 13, describes how this task was designed. Its Review Dispositions Ledger, Round 1, row C1 is the review finding behind it. Both stay in 08-05-PLAN.md as history.
- Cross-plan note: plan 08-19's Recording rule names "the report of plan 08-05's CI `egress` job". That job is this plan.

<output>
Create the SUMMARY next to this plan when it runs, after the R4-2 replan. Include the classifier and guard test results, the YAML validation output, the ruby rule I and egress structural check output, the CLI smoke output, and the egress CI job recorded as `not run` (file only) together with the four states it can report. List every manual item above as still open.
</output>
