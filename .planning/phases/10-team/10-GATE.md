# Phase 10 gate

Tested commit: 2418e4c5d80de6a538a606c65fc742240c9e8740
Date: 2026-11-13, 01:30Z to 01:51Z
Run id: mweatnnb-9c8802fc3d28e482
Evidence dir: a `mktemp -d` directory under `${TMPDIR}` (`aida-gate-10-*`), removed after the SUMMARY quoted it
Tree state: clean, apart from the untracked `.planning/state.json`, which is not part of the gate

Every row of the Results table ran at the tested commit, in the plan's order, one process at a time. Nothing was committed between the first row and the last one. Each command wrote its own log, and each exit code was written to its own `.exit` file and read without a pipe. This file records only what this gate measured; the earlier runs on this branch (integration 127 files and 1781 tests after 10-06, E2E 292 passed after 10-13) are not evidence here.

## Results

States: passed (exit 0 only), failed (non-zero exit), blocked (reason, with evidence), not run. Times are UTC.

| Command | State | Exit code or reason | Log summary | Commit |
| --- | --- | --- | --- | --- |
| pnpm lint | passed | 0 | lint.log, 01:30Z. "Checked 760 files", 0 errors, 1 warning (`tests/unit/container-config.test.ts:160`, `noTemplateCurlyInString`, the old known one) | 2418e4c |
| pnpm typecheck | passed | 0 | typecheck.log, 01:30Z; no output from `tsc --noEmit` | 2418e4c |
| pnpm test | passed | 0 | test.log, 01:30:14Z to 01:30:40Z (25.4 s). Files 110 passed of 110; tests 1967 passed, 0 failed, 0 skipped | 2418e4c |
| pnpm test:integration | failed | 1 | integration.log, 01:30:57Z to 01:38:42Z (464.7 s). Files 130 passed, 1 failed (131); tests 1838 passed, 1 failed (1839). The failure: `tests/integration/backup-failures.test.ts` > "run deadline (K143): a dump waiting on a held ACCESS EXCLUSIVE lock is stopped at BACKUP_MAX_RUN_SECONDS 8 …", `backup-failures.test.ts:460`: expected stdout to contain "[backup] backup aborted: run deadline passed", received "[backup] backup failed: dump" after 7161 ms. `tests/integration/egress-isolation.test.ts` is not among the files run: the log names it 0 times, and the 131 files are exactly `tests/integration/*.test.ts` (132) minus that file (`vitest.integration.config.ts:8`). See the diagnostic rerun below. | 2418e4c |
| pnpm test:egress | blocked (space) | 1; the rule J preflight stopped it before any build | egress.log, 01:40:28Z. "DockerPreflightError: Free space on the Docker VM is 13.2 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." (`tests/support/docker-test-preflight.ts:90`, from `runBuildPreflight` at `:438`, called at `tests/integration/egress-isolation.test.ts:268`). The host check runs first in `runBuildPreflight` (`:436`) and passed; `df -h /System/Volumes/Data` read 23 GiB available just before the run. Counts: tests 1 passed (the stack-free installer egress inventory), 4 skipped; files 1 failed (the beforeAll stop). No image was built or pulled. | 2418e4c |
| pnpm test:e2e (run 1) | failed (global setup stalled on `/setup`) | 1 | e2e.log, 01:40:53Z to 01:41:33Z. `TimeoutError: page.waitForURL: Timeout 30000ms exceeded` at `tests/e2e/global-setup.ts:174`. No test ran. The 543 dev-server lines (prefix `[e2e-server]`) were copied to e2e-server-run1.log before the move: "Next.js 16.4.6 (Turbopack)", "Ready in 214ms", then 298 `GET /setup 200` lines alternating with "Compiled in 1ms", and no `POST /setup`. Owner item next-o1, not fixed here. | 2418e4c |
| `.next` move | done | mv exit 0 | 2026-11-13T01:41:41Z, after run 1: `mv .next ~/.Trash/aida-next-1794534101`. Never removed. Product code and config untouched. | - |
| pnpm test:e2e (run 2, the one rerun) | passed | 0 | e2e2.log, 01:41:51Z to 01:49:50Z (8.0 min). "Running 293 tests using 1 worker"; 292 passed, 0 failed, 0 flaky, 1 skipped. Phase 10 specs: team-invitations 14 passed, team-deactivation 4, notifications-bell 3, mentions-leak 7, csp 14, single-h1 9; none failed. | 2418e4c |
| pnpm build | passed | 0 | build.log, 01:50:03Z to 01:50:20Z. "Turbopack build encountered 5 warnings", each "Dynamic filesystem access causes tracing of the whole project" (the known Phase 02 deferred item). No Google Fonts host in the log (0 matches). | 2418e4c |
| pnpm audit --prod | failed | 1 | audit.log, 01:50:26Z. "48 vulnerabilities found", "Severity: 3 low \| 35 moderate \| 10 high" (AIDA-25, owner item 08-o3). The Phase 9 rerun gate had 42 (2 low, 30 moderate, 10 high). `git diff --stat 38ef41a 2418e4c -- package.json pnpm-lock.yaml` is empty, so no dependency changed in between; the difference comes from the advisory data the command reads (an inference: the old advisory list was not kept). | 2418e4c |

Further runs, recorded beside the charter rows and not replacing any of them:

| Command | State | Exit code | Log summary | Commit |
| --- | --- | --- | --- | --- |
| `pnpm test:integration tests/integration/backup-failures.test.ts` (diagnostic rerun of the one failing file, after the full run) | passed | 0 | backup-diag.log, 01:39:11Z to 01:40:17Z. 1 file, 20 tests passed, including the K143 run-deadline case. The failure in the full run is therefore timing-dependent, not deterministic. Phase 10 changed neither the backup code nor this test (`git diff --stat 5dc6890 2418e4c -- tests/integration/backup-failures.test.ts scripts src/lib/backup` is empty). The full-run row stays failed. | 2418e4c |
| `pnpm typecheck` (after E2E and build) | passed | 0 | typecheck-post.log, 01:50:28Z to 01:50:38Z. No second `.next` move was needed. | 2418e4c |

Docker: `colima status` and `docker info` both exited 0 before the first Docker step (01:30Z) and again before `pnpm test:egress` (01:40Z). Every Docker-using command ran with `AIDA_TEST_RUN_ID=mweatnnb-9c8802fc3d28e482`, `DOCKER_HOST` from the docker context and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. No `docker compose up`, `run`, `down`, `build` or `config` ran on any project, and no image was built or pulled. `pnpm test:docker-cleanup` was not run. After the last Docker-using run, `docker ps -a`, `docker images`, `docker volume ls` and `docker network ls`, each filtered on `label=aida.test.run=mweatnnb-9c8802fc3d28e482`, listed nothing, and no container name held the run id. Host disk stayed at 22 to 23 GiB available throughout (`df -h /System/Volumes/Data`).
