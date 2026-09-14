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
