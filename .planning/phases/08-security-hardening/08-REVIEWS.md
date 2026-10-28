# Phase 8: Security Hardening — Plan Reviews

Reviews run under `run-loop/PIAGAM.md` step 5: Codex reads a `git archive` export of `HEAD` and gives opinions only. Every factual claim below was re-checked by the orchestrator (Claude) against the plans and the code before a disposition was set. The planner must carry every **accept** and **partial** item into the relevant PLAN.md, and record every **reject** in that plan's Review Dispositions Ledger with the reason given here.

## Codex

### Cycle 1

- Question: `run-loop/codex/fase08-plan-tanya.md` (commit `c86beb3`); answer: `run-loop/codex/fase08-plan-jawab.md`.
- Export: `c86beb3`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: plans not ready to execute (7 HIGH, 5 MEDIUM, 1 LOW).

| ID | Codex severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| C1 | HIGH | Full `pnpm test:integration` gates in 08-02 (Task 3) and 08-03 (Task 2) include `egress-isolation.test.ts`, which cannot pass while image builds stall | Verified: `vitest.integration.config.ts:6` includes `tests/integration/**/*.test.ts`; 08-02 Task 3 step 3 runs the full suite; baseline integration run failed only on that file | accept |
| C2 | HIGH (orchestrator: MEDIUM) | The container healthcheck can be starved through the shared 120/min bucket | Verified in 08-12 (context and Task 1): the probe sends no X-Forwarded-For and lands in loopback identity or `SHARED_CLIENT_BUCKET`. In the shipped topology Caddy always writes XFF, so public traffic is never in the shared bucket; starvation needs a fail-closed misconfiguration (for example a wrong `TRUSTED_PROXY_HOPS`) | accept (property below) |
| C3 | HIGH | 08-14 Task 2 uploads one ~20 MiB PNG and expects 200, but `MAX_BYTES` is 10 MiB per file | Verified: `src/lib/attachments/constants.ts:1` `MAX_BYTES = 10 * 1024 * 1024`; 08-13 keeps it; 08-14 behavior line "one PNG of about 20 MiB" | accept |
| C4 | HIGH | 08-14 creates and removes compose project `aida-hardening-test`; the charter only allows containers and volumes of projects `aida` and `aida-dev-db` | Verified the plan text. Disputed reading: the charter also mandates `pnpm test:integration` and E2E, which create Testcontainers containers outside both projects, and `pnpm test:egress`, which uses `aida-egress-test`; so containers created and removed by AIDA's own test suites are read as AIDA's (run-loop decision K14) | partial (see below) |
| C5 | HIGH | When the image build is blocked, 08-14 Tasks 2–3 are never written, and 08-16 Task 3 "stops" before its requirement map, open-items list and commit | Verified: 08-14 Tasks 2 and 3 carry `<precondition>Task 1's suite reached a healthy app (not blocked)`; 08-16 Task 3 steps 1–2 say "stop this task" before steps 6–7 | accept |
| C6 | HIGH | Production CSP is only checked with `curl -I` substrings; the browser E2E runs `next dev` with `'unsafe-eval'` | Verified: 08-08 runs on `next dev`; 08-16 Task 3 step 4 is a header spot-check. `pnpm build` passes on this Mac without Docker | accept |
| C7 | HIGH | 08-10 Task 3 only proves Better Auth stores `session.ipAddress` from the header, not that its limiter keys on it over real HTTP, nor that a client cannot inject the header | Verified: 08-10 Task 3 behavior is a stored-`ipAddress` assertion through the auth API | accept |
| C8 | MEDIUM | CDN setups: no sanitization/origin-restriction contract; chain validation only from the chosen index rightward | Verified 08-18 Task 2 and 08-10 Task 1 text | partial (see below) |
| C9 | MEDIUM | 08-15 would claim "only /data/uploads is writable" and "raw IPs are never stored" without proof; Better Auth stores `session.ipAddress`, and the health throttle keeps IP keys in memory | Verified: 08-15 Task 2 steps 3–4; 08-10 Task 3 expects a stored raw `ipAddress` | accept |
| C10 | MEDIUM | 08-04 greps the `shadcn`-only modules only in `dist/worker.mjs`, not in `.next/standalone`; audit JSON input between tasks not explicit | Verified: 08-04 Task 1 step 4 lists `ls .next/standalone/node_modules` for `shadcn` only and greps the module list in the worker bundle | accept |
| C11 | MEDIUM | No requirement-level evidence matrix separating host-proven, container-proven, blocked and not-run | Consequence of C5–C7 | accept (fold into C5–C7) |
| C12 | MEDIUM | 08-04 should explicitly depend on 08-03; 08-14 is large; chosen "newest" versions must be recorded with date and source | Verified wave layout; `use_worktrees: false` already serializes execution | accept |
| C13 | LOW | CSP on routes outside the happy path (404, error page, new routes) is untested; the proxy matcher excludes `_next/static`, `_next/image`, `favicon.ico` | Verified `src/proxy.ts:58` | accept |

### Required properties for the replan

**C1.** No plan's integration gate can go red solely because the external image-build path is stalled. `tests/integration/egress-isolation.test.ts` is excluded from `vitest.integration.config.ts` (its own header comment and `vitest.egress.config.ts` already say it is not part of the default integration path) and stays in `pnpm test:egress`. Do this in a wave-1 plan, before 08-02's gate. Acceptance: `pnpm test:integration` no longer lists the egress file and exits 0 on unchanged code; `pnpm test:egress` still lists it. The egress result is reported separately as blocked or passed, never hidden.

**C2.** The container healthcheck stays healthy under any request volume that reaches `app` through Caddy, both in the shipped topology and when identity resolution fails closed for all traffic (misconfigured `TRUSTED_PROXY_HOPS`). No exemption may rest on a client-controllable header. Database load stays bounded (the D-20 cache and single-flight already bound it). The planner chooses the mechanism, for example serving the cached snapshot instead of 429 on the no-identity path, or a probe path that public traffic cannot reach, and records why it satisfies both D-20 and AIDA-30 ("throttled without breaking the container healthcheck"). Test: flood exactly the bucket the probe uses for at least five healthcheck intervals while the probe keeps answering 200.

**C3.** The fresh-volume upload proof stays within the product limits: at least two files, each under `MAX_BYTES`, together large enough to cross the old 12 MB Caddy cut (for example two files of about 9.5 MiB), within `MAX_TOTAL_REQUEST_BYTES`; check every stored file's owner and size, and that the limiter quota allows the scenario.

**C4 (partial).** Keep a dedicated test project name, because sharing `aida` with the operator stack lets `up`/`down` replace a running deployment's containers. The harness must only ever remove resources it created itself in that run: a pre-flight check records any leftover resources of its project, teardown targets only that project, and nothing outside it is touched. The project-name question goes to the owner (run-loop `LAPORAN.md`) and back to Codex in cycle 2 with the Testcontainers argument; if the disagreement persists after cycle 2, the run switches to the most conservative option.

**C5.** Writing a test is separate from running it. 08-14 Tasks 2 and 3 always write their tests; only execution depends on a healthy stack. Every result is recorded as one of `passed`, `failed`, `blocked (with evidence)` or `not run`, never conflated. 08-16 Task 3 always completes its requirement map, the open human items and the evidence commit, including on the parked and blocked branches.

**C6.** Add a production-mode host E2E: `pnpm build`, then `next start` against a Testcontainers Postgres (one process at a time), and run the CSP spec in it. In production mode assert: the policy has no `'unsafe-eval'`; an injected inline script without the nonce does not execute; two responses carry different nonces; client-sent `x-nonce` and CSP request headers have no effect; HTML responses are not cacheable for reuse (assert the `Cache-Control` header); `connect-src` is `'self'`; zero violations on the five acceptance pages. Keep host evidence separate from container evidence in the gate summary.

**C7.** Prove over real HTTP against `next start` (production, so Better Auth's limiter is on): a client-sent `x-aida-client-ip` is overwritten by the proxy; exhausting the sign-in quota on one identity yields 429 and a different identity is unaffected; IPv6 addresses in one /64 share a key; a missing or malformed header lands in the shared bucket. Through real Caddy (container gate, or the official `caddy` image in front of the host server if that topology works on this machine; record `blocked` with evidence if it does not), a spoofed `X-Forwarded-For` does not change the identity. Document direct access to `app:3000` as the trust boundary, not as an impossible path.

**C8 (partial).** Accept: document the CDN contract (the CDN must overwrite or sanitize client-sent `X-Forwarded-For`, and direct access to Caddy must be restricted when `TRUSTED_PROXY_HOPS` is above the default), and test hop counts too low and too high and a malformed entry inside the trusted part of the chain. Reject: validating entries to the left of the trusted index. Those entries are client-controlled; failing closed on them would let any client move itself into the shared bucket on purpose and exhaust it.

**C9.** `docs/SECURITY.md` separates what the Dockerfile declares, what a runtime test proved, and what was blocked. The IP statement is precise: the rate-limit tables store peppered hashes; Better Auth stores the session's `ipAddress` (unchanged v1 behavior, now the trusted identity); the health throttle keeps identity keys only in a bounded in-memory map; raw IPs are not logged.

**C10.** 08-04 Task 1 saves `pnpm audit --prod --json` for Task 2, and checks every module that only `shadcn` brought into production against `.next/standalone` (including its traced files), not only the worker bundle. If reachability cannot be shown, the residual table says so and the gate stays red.

**C11.** 08-16 adds a per-requirement evidence matrix with the four states from C5, and host versus container columns.

**C12.** 08-04 depends on 08-03 explicitly. 08-01 and 08-02 record the chosen version, the date, and the registry source in their SUMMARY. Split 08-14 if C3–C5 and C7 make it too large for one executor.

**C13.** A test asserts the CSP header on a 404 page and on an error response, and a comment in `src/proxy.ts` states which paths the matcher excludes and why.

### Consensus summary

All HIGH items except C4 are accepted as stated or with the property above. C2 is accepted although the orchestrator rates it MEDIUM, because D-20 says "always passes" and the fix is cheap.

### Divergent views

- C4: Codex reads the container rule literally; the orchestrator reads containers created and removed by AIDA's own mandated tests as AIDA's. Kept for cycle 2 and reported to the owner.
- C8: whole-chain validation is rejected for the reason above.

### Cycle 2

- Question: `run-loop/codex/fase08-plan-r2-tanya.md` (commit `e686220`); answer: `run-loop/codex/fase08-plan-r2-jawab.md`.
- Export: `e686220`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready (3 HIGH, 5 MEDIUM, 1 LOW). Cycle 1 findings C1, C3, C6, C7, C8, C9, C10 and C12 confirmed as incorporated; C2, C4, C5, C11 and C13 incorporated with gaps (R2-1 to R2-9 below). C8 rejection accepted by Codex. C4 still disputed after two rounds (see K22).

| ID | Codex severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| R2-1 | HIGH | 08-16 Task 3 continues when ports are held by project `aida`, then runs `up -d --build` and `down` on that project: it can replace and stop a running operator stack | Verified: 08-16 Task 3 step 1 parks only when ports are taken "by something other than project `aida`" | accept |
| R2-2 | HIGH | Docker-unhealthy and dirty-tree branches contradict the charter and the plans' own acceptance | Verified in 08-14 Task 1, 08-16 Tasks 1–2: they continue on an unhealthy Docker; the dirty-tree branch still demands real exit codes and an empty diff | accept |
| R2-3 | HIGH | 08-16 evidence-matrix closing rule is self-contradictory; host evidence alone could close a container acceptance item | Verified: step 8 versus the acceptance bullet "No requirement is marked closed while any of its acceptance items is failed, blocked or not run" | accept |
| R2-4 | MEDIUM | 08-21 Task 3 readiness polling can spend the health quota before the 61-request test; all setup errors become `BLOCKED` | Verified behavior text of 08-21 Task 3 | accept |
| R2-5 | MEDIUM | 08-22 fail-closed flood only requires some 429, which the per-identity limit also produces; no minimum number of observed healthcheck entries | Accepted as described; not re-read line by line | accept |
| R2-6 | MEDIUM | Per-run project names: no collision check before `up`/`down -v`; 08-21 acceptance contradicts leftovers being left alone | Superseded by K22, but the collision rule applies to run-scoped volume names | accept (via K22) |
| R2-7 | MEDIUM | `/api/health/probe` refusal is only checked by 404 responses, not by proving the request never reached the upstream; the DB bound is proven with an in-process mock; module-level cache may not be shared across routes in a production build | Accepted as described | accept |
| R2-8 | MEDIUM | Verify commands accept a non-zero exit whenever any `BLOCKED:` line exists, so one blocked test can mask another failed test (08-21 Task 3, 08-14) | Verified: 08-21 Task 3 and 08-14 `<fails_when>` texts | accept |
| R2-9 | LOW | The C13 error-response fallback is defined too late; a pre-proxy error from Next.js carries no CSP | Accepted as described | accept |

### Required properties for the replan (cycle 2)

**K22 (C4 resolution, binding, replaces the C4 partial of cycle 1).** After two rounds the disagreement on the container rule persists, so the run takes the most conservative option that is still literally inside the charter (decision rule 4):
- Every container-level proof added in this phase (08-14, 08-21 Task 3, 08-22, 08-23) runs under compose project `aida`, which the charter names. No new compose project names, and no standalone containers outside project `aida`.
- Pre-flight guard, before any `up`: if any container of project `aida` exists (running or stopped), or port 80 or 443 is held by anything, record `not run (parked: existing aida stack or port in use)` and touch nothing.
- Test overlays give every volume an explicit run-scoped name (for example `aida_ct_<runid>_db_data`, with a run id of at least 12 hex characters) and check that each name does not exist before creating it. Pre-existing `aida_*` volumes are recorded, never mounted and never removed. Teardown runs `down` for project `aida` and then removes only the volumes this run created, and asserts that nothing of the run remains.
- The real-Caddy-in-front-of-host proof (08-21 Task 3) either runs as a service of project `aida` under the same guard, or moves to the compose-stack proof (08-22); record which.
- The charter-mandated suites stay as they are: `pnpm test:integration` and `pnpm test:e2e` (Testcontainers), and `pnpm test:egress` (project `aida-egress-test`). The owner question in `LAPORAN.md` stays open.

**R2-1.** The 08-16 compose gate applies the same pre-flight guard (parks if any project `aida` container exists or a port is held, including by project `aida`). Before `up` it records which `aida_*` volumes exist; if any exist that this run did not create, it parks instead of mounting them. After `down` it removes only the volumes the gate created, so the next gate starts clean.

**R2-2.** Before any Docker step, every plan runs `colima status` and `docker info`. If either fails it never restarts or stops Colima or Docker, records `blocked (docker unhealthy)` for the Docker rows, finishes only the non-Docker work, commits, and reports to the orchestrator, which applies charter rule B and "Berhenti total". The dirty-tree branch of 08-16 gets its own evidence and verify commands and never claims a clean tree.

**R2-3.** The 08-16 evidence matrix names, per acceptance item, the evidence that is required (host, container or both). An item is closed only when every required cell is `passed`. A verify command checks this rule on every row and sub-row.

**R2-4.** Readiness checks never consume the bucket under test (use a path outside the throttle, or reset the in-memory state in a controlled way before counting). Setup errors are classified: an image pull or Docker failure is `blocked`; a Caddyfile, harness or assertion error is `failed`.

**R2-5.** The fail-closed flood case proves the misconfiguration is active (read the environment inside the container), proves the shared 120-request bucket is the one in use (not the 60-request per-identity bucket), and requires at least five healthcheck entries that started inside the flood window, all healthy.

**R2-7.** Probe refusal is proven at the upstream: an instrumented upstream or app-side request count shows that none of the refused variants reached `app`. The raw-path corpus includes encoded slashes and combined normalizations. The DB bound is measured across `/api/health` and `/api/health/probe` together on a production build (not only with an in-process mock). The docs state that anyone who can reach `app:3000` directly can read the binary DB status from the probe.

**R2-8.** A structured reporter classifies every test as `passed`, `failed`, `blocked` or `not run`. A run counts as blocked only if every failure carries blocker evidence and no other failure exists; a verify command enforces this.

**R2-9.** 08-08 defines up front an error response that is guaranteed to pass through the proxy, and records pre-proxy errors from Next.js as a separate, documented boundary.

### Consensus summary (cycle 2)

All nine cycle 2 findings are accepted. C8 is closed: Codex accepted the rejection of whole-chain validation under the documented topology contract. C4 is resolved by K22. This is cycle 2 of at most 3.

### Cycle 3 (last)

- Question: `run-loop/codex/fase08-plan-r3-tanya.md` (commit `40d555d`); answer: `run-loop/codex/fase08-plan-r3-jawab.md`.
- Export: `40d555d`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready; 4 HIGH, 1 MEDIUM; "per the three-cycle rule the phase must be parked". R2-4, R2-5, R2-7 and R2-9 confirmed as incorporated.

| ID | Codex severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| R3-1 | HIGH | K22 cleanup is project-wide: one pre-flight, then `up` and `down --remove-orphans` on project `aida`; a stack started by someone else after the pre-flight could be replaced or removed (race) | Verified: 08-14 `preflight()` then `teardown()` runs `down --remove-orphans`; 08-16 Task 3 has the same window | accept: record the IDs the run created and remove only those after re-checking ownership; re-check immediately before `up`; never project-wide cleanup when a foreign resource is present |
| R3-2 | HIGH | The charter-mandated `pnpm test:egress` uses the fixed project `aida-egress-test` with `up -d --build` and `down -v --remove-orphans` and no guard | Verified: `tests/integration/egress-isolation.test.ts:126` and `:135` | accept: an external guard before the suite (containers, networks, volumes and images of `aida-egress-test`); if anything foreign exists, `not run` and do not call the suite. Applies to the orchestrator's own baseline 0a2 as well |
| R3-3 | HIGH | Image tags: `checkRenderedConfig` checks only the image prefix, `startStack` does not check that a tag is new before building, 08-09 builds and removes tags without that check, and the 08-16 gate's `up --build` builds compose-default image names (`build:` services in `docker-compose.yml` have no `image:`) | Verified: `docker-compose.yml` lines 21 and 41/93 have `build:` without `image:`; 08-16 Task 3 step 3; 08-14 `checkRenderedConfig` text | accept: unique tags for every build, checked before building; record created image IDs and remove a tag only while it still points to that ID; never prune shared build cache |
| R3-4 | HIGH | The 08-16 evidence matrix verifier checks only the matrix's internal consistency, not the source result lines; some evidence commands the table requires are not in Task 2's command list | Verified: the 08-16 Task 3 verify parses `08-GATE.md` sections only | accept: run and record every evidence command; derive each matrix state mechanically from its source line; the verifier matches every item, its required evidence kind and the source state |
| R3-5 | MEDIUM | The reporter classifies a test as blocked from its first message only | Verified: 08-14 `classifyTest` text | accept: one non-blocker error makes the entry `failed`; add mixed cases to the unit test and the R2-8 checker |

### Outcome

The third and last review cycle ended with four HIGH findings. Under `run-loop/PIAGAM.md` → Titik keputusan ("3 siklus review plan habis dengan temuan HIGH tersisa → Parkir fase"), **Phase 8 is parked** (run-loop decision K24). The findings above are accepted and must be incorporated by a `--reviews` replan before any execution, but that replan would not be reviewed by Codex. Whether to unpark is the owner's decision (`run-loop/LAPORAN.md` → Menunggu owner).

## Owner decisions 2026-11-11 and replan brief (cycle 4)

The owner unparked Phase 8 (`run-loop/ANTREAN.md`, section "Keputusan owner 2026-11-11", items 4 to 7). Binding for this replan:

- **One review cycle only (cycle 4), limited to R3-1 to R3-4.** If any HIGH remains after it, there is no cycle 5: Phase 8 is split. Dependency upgrades, CSP, non-root containers and rate limits go first; the Docker test tooling comes later. The owner gets a report.
- **Rule J** (`run-loop/PIAGAM.md`, Aturan owner, item J and the run's strict reading under it) replaces K22's "all container proofs run in project `aida`":
  - Test projects start with `aida-test-`, every test resource carries `aida.test=1`, and cleanup touches only what matches the label and the prefix.
  - Never touch project `aida`, `aida-dev-db`, `smartcv-*` or any other project. No `docker system prune`, `docker volume prune`, `colima delete`, or anything in `~/.colima`.
  - Image tags are unique and never overwrite an existing tag.
  - Check free space on the host and in the VM before any image build; below 20 GiB, stop and report.
  - The phase-end compose gate (former queue item J2) runs as an `aida-test-` project. If port 80 or 443 is taken, record that and park the gate; never stop another service.
- **Rule I** (no GitHub cost):
  - Only `runs-on: ubuntu-latest`, and no new scheduled workflow.
  - Plan 08-05 triggers: `audit` on `pull_request`, push to `master` and `workflow_dispatch`; `egress` on a `pull_request` that changes the Dockerfile, a compose file or the lockfile, and on `workflow_dispatch`.
  - Dependabot weekly with `open-pull-requests-limit: 3`.

### Reuse the J1 test infrastructure

Queue item J1 already built the rule-J tooling. Decisions K108 to K124, the observed Docker error messages and the stated limits are in `run-loop/J1-RENCANA.md`. Plans must reuse this tooling, not duplicate it:

| Module | Provides |
|---|---|
| `tests/support/docker-test-labels.ts` | run id, labels, names, ledger, `dockerNotFound` |
| `tests/support/docker-test-resources.ts` | `startLabeledPostgres` |
| `tests/support/docker-test-preflight.ts` | `runBuildPreflight`, `assertComposeFollowsRuleJ`, `composeResourceNames`, `acquireLock`, the space probe |
| `scripts/test-docker-cleanup.ts` | `planExact`, `applyCleanup`, `teardownRefs`; the `pnpm test:docker-cleanup` CLI |

### Mapping

| Finding | State after J1 | Plans to revise |
|---|---|---|
| R3-1 (project-wide cleanup race) | The pattern exists: exact-ref teardown after the lock, nothing removed before a build started (K121) | 08-14: the harness moves to `aida-test-` projects on top of J1. Also 08-16 Task 3 (compose gate) and the callers 08-21, 08-22, 08-23 |
| R3-2 (unguarded egress suite) | Closed in code by J1: project `aida-test-egress`, preflight, exact-ref teardown, out of the integration include. The 0a2 run stopped at the space check (VM 13.9 GiB) | 08-19 is reduced to what J1 did not do. 08-05's egress job must handle the space stop on runners honestly |
| R3-3 (image tags) | The pattern exists: run-tagged images, tag check, `build.tags` refused, removal by `repo:tag` | 08-09 (image build and removal), 08-14 (`checkRenderedConfig` becomes the J1 compose check), 08-16 (the compose gate needs a labelled overlay with an `image:` per built service) |
| R3-4 (evidence matrix verifier) | Not touched by J1 | 08-16: run and record every evidence command, derive each state from its source line, and make the verifier match item, evidence kind and source state |
| R3-5 (MEDIUM, reporter) | Not touched by J1 | 08-14 `classifyTest`: mixed cases |

**Known blocker:** the Docker VM has 13.9 GiB free, below the 20 GiB threshold (0a2, waiting for the owner). Every plan step that builds images stops at preflight until the owner adds space. Plans record this as `blocked (space)`, never as passed.

### Cycle 4 (the only one allowed, limited to R3-1 to R3-4)

- **Question and answer:** `run-loop/codex/fase08-plan-r4-tanya.md` (commit `439e263`); `run-loop/codex/fase08-plan-r4-jawab.md`. Model `gpt-6.1-terra`, effort `xhigh`.
- **Status of the four HIGH:**
  - R3-1: closed in plan.
  - R3-2: closed (the J1 guard is verified in code).
  - R3-3: closed in plan, within the K115 limit.
  - R3-4: partly closed.
- **New findings,** both checked against the plans by the orchestrator:

| ID | Codex severity | Finding | Orchestrator check | Disposition |
|---|---|---|---|---|
| R4-1 | HIGH | The end gate stalls on a file it requires. 08-23 adds `tests/container/volume-upgrade-render.test.ts` to the container include, but 08-16's evidence spec allows only five suite files, treats a sixth as `UNEXPECTED`, and may not change after its tested commit | Verified: `08-16-PLAN.md` never names `volume-upgrade-render` | Deferred to the Docker tooling part of the split (below). The spec must list the sixth file before the tested commit |
| R4-2 | HIGH | CI can hide a failure behind `blocked (space)`. The 08-05 Task 3 classifier marks a failed run `blocked (space)` when it sees a space message and none of six markers, so a space stop in one file plus an assertion failure in another is mislabelled. That contradicts 08-19's rule that a blocker together with another error is `failed` | Verified in the plan contract | Deferred to the Docker tooling part of the split. Classification must come from the structured result of the whole suite, with mixed cases across files |

### Outcome of cycle 4: Phase 8 is split (owner decision 2026-11-11, item 4)

HIGH findings remain, and the owner allowed no fifth cycle, so Phase 8 is split as the owner directed: "upgrade dependensi, CSP, non-root, rate limit dulu; alat test Docker belakangan. Lapor ke owner." Both remaining HIGH findings sit in the Docker test tooling (the full gate in 08-16 and the CI egress job in 08-05 Task 3). None sits in the dependency, CSP, non-root or rate-limit plans. The split design is in `08-SPLIT.md`.
