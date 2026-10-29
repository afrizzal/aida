---
phase: 08-security-hardening
plan: 09
subsystem: containers
status: complete
tags: [docker, non-root, telemetry, rule-j, image-check]
requires: ["08-04", "08-05"]
provides: [non-root runner and builder images, image telemetry opt-out, rule-J image check script, root-owned volume upgrade procedure]
affects: ["08-14", "08-15", "08-16", "08-19", "08-23", "08-24"]
tech-stack:
  added: []
  patterns: [J1 lock + tag check + 20 GiB preflight before any build, ID-checked removal by repo:tag, result/teardown/verify lines]
key-files:
  created:
    - tests/unit/container-config.test.ts
    - tests/unit/test-image-check.test.ts
    - scripts/test-image-check.ts
  modified:
    - Dockerfile
    - docker-compose.yml
    - docker-compose.egress-test.yml
    - docs/OPERATIONS.md
decisions:
  - "migrate calls the Prisma CLI as node node_modules/prisma/build/index.js (bin.prisma), not through pnpm/corepack"
  - "The image check's teardown line field created is true only when the build started under the lock (teardownRefs non-null)"
  - ".next/cache is not made writable; plan 08-14 proves at runtime whether it must be (D-10)"
metrics:
  duration: ~45 min
  completed: 2026-11-11
commits: 3
plan_head_before: 98b75227c6b079fa86771a556a5211e027aedcd6
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
---

# Phase 8 Plan 09: Non-root images, image telemetry off, rule-J image checks Summary

The images now run as the built-in `node` user (UID 1000) by construction: the runner (`app`, `worker`) and the builder (`migrate`, the egress-test `runner`) both end with `USER node`, only `/data/uploads` is writable, and Next.js telemetry and the Prisma checkpoint ping are off in base and runner. `migrate` calls the Prisma CLI through node instead of corepack. The new rule-J image check, `scripts/test-image-check.ts`, is built on the J1 modules and has 57 unit tests that need no Docker daemon. Both real image checks ended **blocked (space)** at J1's preflight with 13.9 GiB free in the Docker VM. Neither is passed, and the build-path half of AIDA-27 and AIDA-32 stays open.

## Image checks

| Target | Word (from IMAGE-CHECK-VERIFY) | Exit | Build ran |
|---|---|---|---|
| runner | **blocked (space)** | 3 | no |
| builder | **blocked (space)** | 3 | no |

J1's space message, measured: `Free space on the Docker VM is 13.9 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner.`

### runner (Task 1)

Docker health before the step: `colima status` exit 0 ("colima is running"), `docker info` exit 0 (Server Version 29.5.2).

```
IMAGE-CHECK-TEARDOWN {"created":false,"removed":[],"gone":[],"skipped":[],"notOurs":[],"leftAlone":[],"failed":[],"remaining":[],"runId":"mwc4vl4j-17c5a3b3291e2b44"}
IMAGE-CHECK-RESULT {"target":"runner","tag":"aida-test-nonroot-runner:mwc4vl4j-17c5a3b3291e2b44","runId":"mwc4vl4j-17c5a3b3291e2b44","state":"blocked","cause":"space","evidence":"Free space on the Docker VM is 13.9 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner.","imageId":null,"user":null,"env":[],"labels":{},"baseImageBefore":"sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202","baseImageAfter":null,"runDir":"/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-image-check-xwjcFy"}
IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=runner tag=aida-test-nonroot-runner:mwc4vl4j-17c5a3b3291e2b44
```

preflight.json:

```json
{
  "tag": "aida-test-nonroot-runner:mwc4vl4j-17c5a3b3291e2b44",
  "tagState": "free",
  "preflight": "stopped",
  "message": "Free space on the Docker VM is 13.9 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner.",
  "baseImageBefore": "sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202"
}
```

Cleanup dry run, `pnpm test:docker-cleanup --run mwc4vl4j-17c5a3b3291e2b44`, exit 0: `0 resource(s) of run mwc4vl4j-17c5a3b3291e2b44; dry run, nothing removed.`

### builder (Task 2)

Docker health before the step: `colima status` exit 0, `docker info` exit 0.

```
IMAGE-CHECK-TEARDOWN {"created":false,"removed":[],"gone":[],"skipped":[],"notOurs":[],"leftAlone":[],"failed":[],"remaining":[],"runId":"mwc4vl4j-17c5a3b3291e2b44"}
IMAGE-CHECK-RESULT {"target":"builder","tag":"aida-test-nonroot-builder:mwc4vl4j-17c5a3b3291e2b44","runId":"mwc4vl4j-17c5a3b3291e2b44","state":"blocked","cause":"space","evidence":"Free space on the Docker VM is 13.9 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner.","imageId":null,"user":null,"env":[],"labels":{},"baseImageBefore":"sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202","baseImageAfter":null,"runDir":"/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-image-check-QEBXLo"}
IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=builder tag=aida-test-nonroot-builder:mwc4vl4j-17c5a3b3291e2b44
```

preflight.json is the same as the runner's, except `"tag": "aida-test-nonroot-builder:mwc4vl4j-17c5a3b3291e2b44"`.

Cleanup dry run, exit 0: `0 resource(s) of run mwc4vl4j-17c5a3b3291e2b44; dry run, nothing removed.`

### Notes for both checks

- No build ran, so there is no build log tail. The run directories hold only `preflight.json`.
- Base image ID (K116): `baseImageBefore` is `sha256:0e1754758c2d...`. `baseImageAfter` is null because no build ran, so there is nothing to compare. No pull happened.
- After each check the lock `${TMPDIR}/aida-test-docker.lock` was gone.
- The plan started no container of its own. The only container either check created was J1's labelled `--rm` space probe inside `runBuildPreflight`. Nothing was removed. No project `aida`, `aida-dev-db` or other project was touched.
- Run directories (kept as evidence for the orchestrator, charter rule C):
  - `/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-image-check-xwjcFy`
  - `/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-image-check-QEBXLo`
- Log directories:
  - `/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-image-check-log-HH616P`
  - `/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-image-check-log-E7cqgf`
- The J1 ledger for the run is under `${TMPDIR}/aida-test-runs/`; the space probe is recorded there as `planned`.
- Runtime and offline proofs are elsewhere:
  - Plan 08-14's harness, on its own per-run `aida-test-` project, proves `id -u` in app, worker and migrate, the `/data/uploads` owner, `printenv`, and `.next/cache` writes.
  - The egress-isolation suite (`pnpm test:egress`, project `aida-test-egress`) proves the node-based migrate command offline. It is recorded by plan 08-16 under plan 08-19's Recording rule and is expected `blocked (space)` until the owner adds space.

## Facts for dependent plans

- `bin.prisma` in `node_modules/prisma/package.json` is `build/index.js`. Both compose files' migrate command is `["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]`.
- D-10 static findings, from the host `pnpm build` (exit 0) and `.next/standalone`:
  - The standalone server ships Next's `incremental-cache/index.js` and `incremental-cache/file-system-cache.js`, and the image optimizer.
  - The resolved config has `isrFlushToDisk: true` and `images.unoptimized: false`.
  - The app has no `next/image` import. The one `src/` match is `src/proxy.ts`, which only names the `/_next/image` path.
  - There is no `generateStaticParams`, `export const revalidate`, `unstable_cache` or `"use cache"`, and every route is dynamic (`ƒ`).
  - There are 64 `revalidatePath` calls in server actions. These are the one feature that could reach the incremental cache, and so `.next/cache`, at runtime.
  - Nothing in this plan makes `.next/cache` writable. Plan 08-14 proves at runtime whether it must be.
- Compose renders, run without the daemon under `-p aida-test-config-check`, both exit 0 (`compose-ok`):
  - `docker-compose.yml` with `--env-file /dev/null`, with 7 expected warnings about unset variables;
  - `docker-compose.egress-test.yml` with `AIDA_TEST_RUN_ID` and a `mktemp -d` `AIDA_TEST_DNS_LOG_DIR` (removed with `rmdir`).

## Tests and gates

| Command | Exit | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/container-config.test.ts` | 0 | 15 passed (8 after Task 1, 15 after Task 2; RED first, 6 then 3 failures) |
| `DOCKER_HOST=unix:///nonexistent/aida-no-daemon.sock pnpm exec vitest run tests/unit/test-image-check.test.ts` | 0 | 57 passed (RED first: module missing) |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | 581 files, no fixes |
| `DOCKER_HOST=<dead socket> pnpm test` | 0 | 64 files, 1049 tests |
| compose renders | 0 | compose-ok |
| ops doc check (Task 3 verify) | 0 | ops doc ok |
| `pnpm build` (host, D-10 evidence) | 0 | standalone built |
| runner image check, verify | 3, 0 | blocked (space) |
| builder image check, verify | 3, 0 | blocked (space) |

Acceptance greps on `scripts/test-image-check.ts`, counting non-comment lines:

- `prune|"rmi"|"system"` matches 0 lines, and so does `"--pull"|"--push"|"run"|"rm"`.
- Each of these appears in at least one line: `acquireLock`, `runBuildPreflight`, `recordResource`, `tagState(`, `teardownRefs(`, `planExact(`, `applyCleanup(`, `testRunId(`, `testLabels(`, `testResourceName(`, `dockerNotFound(`.
- `aida_ct_` appears 0 times in both files.
- Every test title starts with `R3-3:`, `J:`, `R2-8:`, `D-08:` or `D-27:`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `spawn` env typing**
- **Found during:** Task 1, typecheck.
- **Issue:** The project types `NodeJS.ProcessEnv` with a required `NODE_ENV`. A minimal env holding only PATH, HOME and the Docker client variables failed `tsc`.
- **Fix:** Cast the env with a comment. The env stays minimal, and `NODE_ENV` is not added.
- **Commit:** b196c58

**2. [Note] D-10 premise corrected**
- The plan's context said there are zero next/image uses. That holds for imports. The only match in `src/proxy.ts` is the `/_next/image` path name.
- The plan did not list the 64 `revalidatePath` calls. They are recorded above for plan 08-14.

### Extra coverage (within scope)

- Extra unit cases beyond the behaviour list:
  - build args carry no pull, push, output or cache flag;
  - result and teardown lines are printed exactly once;
  - verify refuses another target and refuses a `created: false` teardown that removed something;
  - the exit-code map;
  - summary words.
- An extra static guard: no Dockerfile stage switches back to root, and the runner code COPY lines carry no `--chown`.

## Review Dispositions Ledger

The plan's ledger is applied as written:

- Round 3, R3-3 and rule J: implemented in Tasks 1 and 2.
- Round 2, K22: superseded and not implemented. No `aida_ct_` tags, no `docker run`.
- Deferred R3-1, R3-2, R3-4 and R3-5: left to their named plans.

## Manual items (open)

- The owner frees Docker VM space to at least 20 GiB (13.9 GiB now). Then re-run Task 1's fourth verify command and Task 2's third. Until then the build-path half of AIDA-27 and AIDA-32 stays open.
- J1's limits K109, K115, K118 and K120 still apply unchanged.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the test-only image check, which threat-model rows T-08-135 to T-08-137 already cover.

## Commits

- b196c58 fix(08-09): run app and worker as non-root, telemetry off in the image, rule-J image check (D-08, D-27, R3-3)
- f91e7cd fix(08-09): run migrate as non-root without runtime corepack (D-08)
- 0163283 docs(08-09): document the non-root upgrade path for existing uploads volumes (D-09)

## Self-Check: PASSED

All 7 key files exist, and the 3 commits are present in `git log`.
