---
phase: 08-security-hardening
scope: "Part A only (08-SPLIT.md): plans 08-01 to 08-13, 08-17, 08-18, 08-19, 08-20, 08-24 and 08-gap1. Part B (deferred-8.1/) is not verified here."
verified: 2026-11-12T05:04:30Z
status: human_needed
score: 16/17 Part A must-haves verified
tested_commit: fc8078f04292c7718b31cae09050ff5cd56bfe3c
verified_head: b123d0e
covered_files:
  - ".env.example"
  - ".github/dependabot.yml"
  - ".github/workflows/audit.yml"
  - ".github/workflows/ci.yml"
  - ".github/workflows/integration.yml"
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/08-security-hardening/08-01-PLAN.md"
  - ".planning/phases/08-security-hardening/08-01-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-02-PLAN.md"
  - ".planning/phases/08-security-hardening/08-02-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-03-PLAN.md"
  - ".planning/phases/08-security-hardening/08-03-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-04-PLAN.md"
  - ".planning/phases/08-security-hardening/08-04-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-05-PLAN.md"
  - ".planning/phases/08-security-hardening/08-05-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-06-PLAN.md"
  - ".planning/phases/08-security-hardening/08-06-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-07-PLAN.md"
  - ".planning/phases/08-security-hardening/08-07-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-08-PLAN.md"
  - ".planning/phases/08-security-hardening/08-08-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-09-PLAN.md"
  - ".planning/phases/08-security-hardening/08-09-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-10-PLAN.md"
  - ".planning/phases/08-security-hardening/08-10-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-11-PLAN.md"
  - ".planning/phases/08-security-hardening/08-11-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-12-PLAN.md"
  - ".planning/phases/08-security-hardening/08-12-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-13-PLAN.md"
  - ".planning/phases/08-security-hardening/08-13-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-17-PLAN.md"
  - ".planning/phases/08-security-hardening/08-17-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-18-PLAN.md"
  - ".planning/phases/08-security-hardening/08-18-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-19-PLAN.md"
  - ".planning/phases/08-security-hardening/08-19-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-20-PLAN.md"
  - ".planning/phases/08-security-hardening/08-20-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-24-PLAN.md"
  - ".planning/phases/08-security-hardening/08-24-SUMMARY.md"
  - ".planning/phases/08-security-hardening/08-gap1-SUMMARY.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-05b-PLAN.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-14-PLAN.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-15-PLAN.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-16-PLAN.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-21-PLAN.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-22-PLAN.md"
  - ".planning/phases/08-security-hardening/deferred-8.1/08-23-PLAN.md"
  - "Caddyfile"
  - "Dockerfile"
  - "docker-compose.egress-test.yml"
  - "docker-compose.yml"
  - "docs/OPERATIONS.md"
  - "docs/SECURITY.md"
  - "next.config.ts"
  - "package.json"
  - "scripts/image-check-verify.ts"
  - "scripts/part-a-gate-check.ts"
  - "scripts/test-image-check.ts"
  - "src/app/(app)/settings/actions.ts"
  - "src/app/(app)/settings/email/actions.ts"
  - "src/app/(app)/settings/email/test-connection-button.tsx"
  - "src/app/(app)/settings/embedding-test-connection-button.tsx"
  - "src/app/(app)/settings/llm-test-connection-button.tsx"
  - "src/app/(app)/tickets/[id]/actions.ts"
  - "src/app/(public)/request/request-form.tsx"
  - "src/app/(public)/status/[token]/follow-up-form.tsx"
  - "src/app/api/health/probe/route.ts"
  - "src/app/api/health/route.ts"
  - "src/app/api/public/intake/route.ts"
  - "src/app/api/public/status/[token]/attachments/[id]/route.ts"
  - "src/app/api/public/status/[token]/csat/route.ts"
  - "src/app/api/public/status/[token]/follow-up/route.ts"
  - "src/app/globals.css"
  - "src/app/layout.tsx"
  - "src/components/theme-provider.tsx"
  - "src/instrumentation.ts"
  - "src/lib/attachments/constants.ts"
  - "src/lib/attachments/validate-uploads.ts"
  - "src/lib/auth-client.ts"
  - "src/lib/auth.ts"
  - "src/lib/channels/email/imap-client.ts"
  - "src/lib/channels/email/test-connection.ts"
  - "src/lib/connection-test/deadline-fetch.ts"
  - "src/lib/connection-test/errors.ts"
  - "src/lib/db.ts"
  - "src/lib/health/health-check.ts"
  - "src/lib/http/read-bounded-form-data.ts"
  - "src/lib/llm/test-connection.ts"
  - "src/lib/public-forms/limits.ts"
  - "src/lib/rag/embed-test-connection.ts"
  - "src/lib/rate-limit/check-rate-limit.ts"
  - "src/lib/rate-limit/client-ip.ts"
  - "src/lib/rate-limit/denial-memory.ts"
  - "src/lib/rate-limit/memory-throttle.ts"
  - "src/lib/rate-limit/pepper-check.ts"
  - "src/lib/rate-limit/public-limits.ts"
  - "src/lib/security/csp.ts"
  - "src/lib/worker/jobs/sla-flag.ts"
  - "src/proxy.ts"
  - "website/src/content/docs/configuration/environment.md"
  - "website/src/content/docs/operations/upgrading-and-logs.md"
covered_digest: "v1:sha256:9a833c8ee1ce16ed0110f9d61a44a01ca7dcd6939113196d799703c5518afc0b"
behavior_unverified: 1
overrides_applied: 0
deferred:
  - truth: "SC1 / AIDA-25: with the audit red, every remaining critical and high production advisory is listed in docs/SECURITY.md with its ID, why it cannot be fixed, and why it is acceptable"
    addressed_in: "Phase 8.1 (plan 08-15, deferred-8.1/)"
    evidence: "08-04-PLAN.md objective: 'the residual table in the SUMMARY (plan 08-15 copies it into docs/SECURITY.md)'; deferred-8.1/08-15-PLAN.md truth: 'docs/SECURITY.md has a ## Dependency audit section recording ... every remaining critical or high production advisory with its ID ...'. Checked in docs/SECURITY.md: no such section today."
  - truth: "SC5 second half / AIDA-32: docs/SECURITY.md matches the code"
    addressed_in: "Phase 8.1 (plan 08-15)"
    evidence: "08-GATE-A.md matrix row 31 moved to 08-15. Checked in code: docs/SECURITY.md line 8 still says next/font/google fetches a font at build time, Next telemetry is on by default and the Prisma checkpoint ping fires on every compose up; the code no longer does any of these (no next/font import in src, Dockerfile lines 8 and 67 set NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1)."
  - truth: "SC2 / AIDA-27 runtime: compose stack serves /api/health over https; app and worker non-root while up; migrate non-root with exit 0; upload on a fresh volume; root-owned volume procedure on a real volume"
    addressed_in: "Phase 8.1 (plans 08-14, 08-16, 08-23)"
    evidence: "08-SPLIT.md Part B; 08-GATE-A.md matrix rows 5, 6, 8, 10. Split to Phase 8.1, not proven."
  - truth: "AIDA-28 production-mode CSP (next start, production policy; inline script without nonce blocked, connect-src 'self' at runtime)"
    addressed_in: "Phase 8.1 (plan 08-21)"
    evidence: "08-GATE-A.md matrix rows 12, 13. Split to Phase 8.1, not proven."
  - truth: "AIDA-29 / SC4 through real Caddy and real HTTP against next start (spoofed X-Forwarded-For; x-aida-client-ip overwrite)"
    addressed_in: "Phase 8.1 (plans 08-21, 08-22)"
    evidence: "08-GATE-A.md matrix rows 17, 18. Split to Phase 8.1, not proven."
  - truth: "AIDA-30 / SC4: the throttle does not break the container healthcheck; >12 MB bodies pass Caddy; probe never reaches upstream through Caddy; one DB read per 3 s window on the production build"
    addressed_in: "Phase 8.1 (plans 08-14, 08-21, 08-22)"
    evidence: "08-GATE-A.md matrix rows 20, 24, 25. Split to Phase 8.1, not proven."
  - truth: "AIDA-32: NEXT_TELEMETRY_DISABLED=1 effective in the built image at runtime"
    addressed_in: "Phase 8.1 (plan 08-14)"
    evidence: "08-GATE-A.md matrix row 27 (both). Static half verified here; runtime half split to Phase 8.1, not proven."
  - truth: "AIDA-26 egress CI job (08-05 Task 3)"
    addressed_in: "Phase 8.1 (plan 08-05b)"
    evidence: "08-SPLIT.md; deferred-8.1/README.md"
behavior_unverified_items:
  - truth: "AIDA-27 build path: the runner and builder images are built and inspected as running as a non-root user"
    test: "Once the host and the Docker VM each have >= 20 GiB free (rule J, queue item 0a2), run the two 08-09 image checks (`--target runner`, `--target builder`) and their --verify mode"
    expected: "IMAGE-CHECK-RESULT state=passed for both; Config.User is node / UID 1000; telemetry env values are exactly 1"
    why_human: "Both checks stopped at the space preflight (exit 3, blocked (space)). The Dockerfile lines are present (USER node at Dockerfile:60 and :94) and the static unit test passes, but no image was built or inspected"
human_verification:
  - test: "Owner decision on the two reachable production advisories GHSA-prgh-xp8r-p3m5 and GHSA-v53p-9fqp-m79j (nodemailer 9.1.1, bundled in dist/worker.mjs, reached through mailparser simpleParser on inbound mail headers)"
    expected: "Either allow nodemailer >= 10.0.6 (and mailparser >= 3.9.25) and re-run the audit, or accept them in writing as residuals in docs/SECURITY.md"
    why_human: "AIDA-25 allows a red audit only if each residual is explained as not reachable; these two are reachable by the executor's own analysis (08-04-SUMMARY), so no document can close the requirement without an owner decision (D-04 keeps nodemailer on major 9)"
  - test: "Owner: decide whether commit fc8078f is enough as the v1.0.0 safe point (08-SPLIT 'Release safe point')"
    expected: "Recorded owner decision; the gate offers it only as a candidate"
    why_human: "Release decision"
  - test: "Owner: Docker VM space (0a2), then re-run `pnpm test:egress` and both 08-09 image checks"
    expected: "Results other than blocked (space)"
    why_human: "Environment blocker; the verifier may not run Docker"
  - test: "DESIGN-SYSTEM §9 item 2: empty state uses halo and icon box"
    expected: "Pass on the changed UI files (settings test-connection buttons, layout, theme provider, globals.css)"
    why_human: "Manual checklist item; recorded not run (manual) by the gate"
  - test: "DESIGN-SYSTEM §9 item 3: sidebar uses sidebar-* tokens"
    expected: "Pass"
    why_human: "Manual checklist item"
  - test: "DESIGN-SYSTEM §9 item 4: top bar is sticky with backdrop blur"
    expected: "Pass"
    why_human: "Manual checklist item"
  - test: "DESIGN-SYSTEM §9 item 5: auth page does not wrap itself"
    expected: "Pass"
    why_human: "Manual checklist item"
  - test: "DESIGN-SYSTEM §9 item 7: dark mode tested"
    expected: "System font stack and settings test-connection failure panels read correctly in light and dark mode"
    why_human: "Visual check"
  - test: "Visual approval of the system font stack (08-05, D-26) and re-capture of the screenshots and hero GIF in docs/assets"
    expected: "Owner approves the look; assets re-captured"
    why_human: "Visual judgment; never claimed by the run"
  - test: "Real security contact (LAUNCH.md 'Before you tag' item 5)"
    expected: "Placeholder maintainer/security contact replaced"
    why_human: "Owner-only information"
  - test: "The v1.0.0 tag and the GitHub release"
    expected: "Created by the owner"
    why_human: "Forbidden to the run (no git tag, no gh release)"
  - test: "Repository settings in LAUNCH.md 'Repository settings' (visibility, social preview, Discussions, Pages source, private vulnerability reporting; making the audit job a required check)"
    expected: "Set by the owner in GitHub Settings"
    why_human: "Cannot be done from a workflow file"
  - test: "Judgment-tier prohibitions (non-authoritative LLM verdict below): 08-01 audit never reported as passed; 08-02 aida-dev-db untouched, --pull never, no dev DB password written; 08-04 no third-party Prisma mirror, gate not reported passed; 08-05 no visual pass claimed, no egress/image run in that plan; 08-18 no documented config that trusts a client-supplied header; 08-24 no leftover removal by the gate, no visual or dark-mode pass claimed, .env not read"
    expected: "Human confirms"
    why_human: "unverified-prohibition — human review recommended"
---

# Phase 8: Security Hardening, Part A Verification Report

**Phase Goal:** The v1 code is safe to release: no known critical or high production advisory, and every accepted v1 security finding is fixed or justified in writing.
**Scope:** Part A only (08-SPLIT.md, owner decision 2026-11-11). Part B plans in `deferred-8.1/` are not verified and their absence is not counted as a Part A gap.
**Verified:** 2026-11-12T05:04:30Z, HEAD `b123d0e`. `git diff fc8078f HEAD -- . ':!.planning'` is empty (orchestrator fact; also `git diff --stat` printed nothing here), so the code read is the code the final gate tested.
**Status:** human_needed
**Re-verification:** No, initial verification (no earlier 08-VERIFICATION.md).

Evidence marks: **[code]** = read or grepped in the source by this verifier; **[gate-log]** = read by this verifier in the gate's raw evidence directory (audit log, JSON test reports, checker output) for run `mwcgrr52-67111e2a3044e0ec`; **[run]** = command run by this verifier; **[summary]** = taken from a SUMMARY or review file, not re-checked.

## Phase goal, plainly

The phase goal is **not achieved at the phase level**. `pnpm audit --prod` still reports 10 high advisories (0 critical). Two of them are reachable (nodemailer in the worker). Their written explanation is not yet in `docs/SECURITY.md`, which also still describes build-time egress that the code no longer has. Both docs items belong to plan 08-15, which is in Part B. Part A's own deliverables (upgrades, CSP, non-root Dockerfile, client IP and rate limits, categorized connection tests, Dependabot and the audit workflow) are present in the code and tested on the host. What remains is owner decisions, human checks and Phase 8.1.

## Goal Achievement

### Roadmap Success Criteria (contract)

| SC | Criterion | Part A status | Evidence |
|---|---|---|---|
| 1 | Audit exits 0, or reported red with every residual explained in docs/SECURITY.md | **Not met. The docs part is deferred to 8.1 (08-15); owner decision needed** | Audit exit 1 for both forms, 0 critical / 10 high [gate-log `audit.log`, `audit.exit`, `audit-high.exit`]. Gate reports it red, not passed [gate-log, 08-GATE-A.md]. `docs/SECURITY.md` has no advisory list [code: grep for GHSA/advisory/residual finds none]. The 10 IDs in the gate log equal the 10 rows of the 08-04-SUMMARY "Production residuals" table one to one [gate-log vs summary]. Two of them are marked **Reachable** there |
| 2 | Compose stack, non-root at runtime, migrate exit 0, uploads | **Split to Phase 8.1, not proven** | No compose command ran (08-GATE-A "compose stack gate: moved to Phase 8.1") |
| 3 | Every HTML response carries a CSP; core pages zero violations | Verified for Part A (dev server); production mode split to 8.1 | `src/proxy.ts:47-56` sets a per-request nonce policy; matcher `src/proxy.ts:153` excludes only `_next/static/` and `_next/image` [code]. `buildCsp` prod policy: `'nonce-…' 'strict-dynamic'`, `connect-src 'self'`, no `'unsafe-eval'` (`src/lib/security/csp.ts:48-60`, `tests/unit/csp.test.ts`) [code]. E2E `tests/e2e/csp.spec.ts`: login, request, status, inbox (`/tickets`), ticket, 404s, K126 refresh case all `ok: true` [gate-log `e2e.json`] |
| 4 | Spoofed XFF cannot change the identity; two public routes throttled; healthcheck green | Host side verified; healthcheck-green and real-Caddy proofs split to 8.1 | `getClientIp` takes the entry `TRUSTED_PROXY_HOPS` from the right and fails closed to a shared bucket (`src/lib/rate-limit/client-ip.ts:74-110`) [code]. Caddy overwrites XFF and strips `X-Aida-Client-Ip` (`Caddyfile` reverse_proxy block) [code]. The only raw forwarded-header read in `src` is the helper; Better Auth reads only `x-aida-client-ip` (`src/lib/auth.ts:12`), which the proxy sets from the helper (`src/proxy.ts:53`) [code]. `/api/health` throttled before DB work (`src/app/api/health/route.ts:10-11`); attachments route limits first (`.../attachments/[id]/route.ts:19-21`) [code]. `client-ip.test.ts` 41 passed, `health.test.ts` 12, `public-route-limits` 5 [gate-log] |
| 5 | All four connection tests return categorized errors, and docs/SECURITY.md matches the code | First half verified; second half not met, deferred to 8.1 (08-15) | See AIDA-31 below. `docs/SECURITY.md:8` is stale (see deferred list) [code] |
| 6 | Dependabot and a CI audit job exist as files | Verified | `.github/dependabot.yml` (npm root, npm website, github-actions, docker; weekly, limit 3). `.github/workflows/audit.yml` runs `pnpm audit --prod --audit-level=high` on `ubuntu-latest`, no `schedule:` [code]. The only `schedule:` (integration.yml) dates from 07-06 [code: `git log -S`]. No workflow was triggered |

### Observable Truths (Part A must-haves, derived from the requirement acceptance items and plan must_haves)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | AIDA-25 (Part A): every critical/high production advisory still present has a residual row (ID, package, path, severity, why not fixed, why not reachable) | ✓ VERIFIED | 10 high in the gate's audit log = 10 rows in 08-04-SUMMARY (GHSA-2v37, -3f6p, -587h, -68fv, -73wf, -c83g, -ggr8, -gpj5, -prgh, -v53p); 0 critical [gate-log vs summary] |
| 2 | AIDA-25: plain `pnpm audit --prod` exit is recorded as it is | ✓ VERIFIED | exit 1 recorded in 08-GATE-A.md and in `audit.exit` [gate-log] |
| 3 | AIDA-26: Dependabot file and CI audit job exist (files only) | ✓ VERIFIED | see SC6 [code]; `build-egress-guards.test.ts` 10 passed [gate-log] |
| 4 | AIDA-27 build path: runner and builder images run as non-root | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `USER node` at `Dockerfile:60` (builder, used by migrate via `target: builder`, `docker-compose.yml:23`) and `Dockerfile:94` (runner); `/data/uploads` chowned before it (`Dockerfile:93`); migrate calls the Prisma CLI through node (`docker-compose.yml:27`) [code]. `container-config.test.ts` 15 passed [gate-log]. Both image checks exit 3 `blocked (space)` [gate-log]: no image built or inspected |
| 5 | AIDA-27: upgrade path for an existing root-owned `uploads_data` volume documented | ✓ VERIFIED | `docs/OPERATIONS.md:105` "Upgrading an install whose containers ran as root" [code]; gate evidence check `ops-volume` passed [gate-log] |
| 6 | AIDA-28: E2E asserts the CSP header and zero violations on login, inbox, ticket, public request, public status | ✓ VERIFIED (dev server) | see SC3 [code + gate-log] |
| 7 | AIDA-29: unit tests cover the shipped Caddy topology and a spoofed header | ✓ VERIFIED | `tests/unit/client-ip.test.ts` 41 passed [gate-log]; my unit run passed [run] |
| 8 | AIDA-29: all public routes use the helper | ✓ VERIFIED | intake, follow-up, csat, attachments, health all call `getRateLimitIdentity(request)`; auth via proxy-written header [code]; `auth-ip-source` 3 passed [gate-log] |
| 9 | AIDA-29: deployment constraint documented | ✓ VERIFIED | `docs/OPERATIONS.md:204` "Client IP and reverse proxies" [code] |
| 10 | AIDA-30: `/api/health` and the attachments route throttled | ✓ VERIFIED | see SC4 [code + gate-log] |
| 11 | AIDA-30: follow-up enforces a combined request-size cap | ✓ VERIFIED | `follow-up/route.ts:52-59` `readBoundedFormData(request, MAX_REQUEST_BODY_BYTES …)` → 413 [code]; `public-upload-caps` 28 passed [gate-log] |
| 12 | AIDA-30: both status POST routes check the rate limit before the token lookup | ✓ VERIFIED | follow-up: limit line 34, `findUnique({statusToken})` line 41; csat: limit line 24, lookup line 31 [code] |
| 13 | AIDA-31: all four call sites return a fixed category | ✓ VERIFIED | see AIDA-31 below [code] |
| 14 | AIDA-32: `NEXT_TELEMETRY_DISABLED=1` in image build and runtime (static half) | ✓ VERIFIED (static) | `Dockerfile:8` (base) and `:67` (runner) `ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1`; CI and audit workflows set it [code]. Runtime half split to 8.1 |
| 15 | AIDA-32: `next build` makes no Google Fonts request | ✓ VERIFIED | no `next/font` import in `src` [code]; gate build log has no Google Fonts host [gate-log] |
| 16 | AIDA-32: `addTag` gates before validating | ✓ VERIFIED | `src/app/(app)/tickets/[id]/actions.ts:215-216` `getSessionActor()` before the mutation [code]; `add-tag-gate.test.ts` 3 passed [gate-log] |
| 17 | AIDA-32: `sla-flag` documents why its raw SQL has no org filter | ✓ VERIFIED | `src/lib/worker/jobs/sla-flag.ts:52-60` comment [code] |

**Score:** 16/17 truths verified (1 present, behavior-unverified). Plan-level must_haves across the 18 Part A plans (184 truths) were checked by artifact and key-link tools plus spot reads. `verify.artifacts`: all artifacts pass on every plan. `verify.key-links`: every link passes or was confirmed by hand (08-11 48-hour retention: `rate-limit-cleanup.ts:5`, `check-rate-limit.ts:42`; 08-17 `process-tree` wired through `tests/e2e/support/global-teardown.ts:14` and the four specs; the 08-19 and 08-24 links are tool-format misses, not wiring gaps).

### AIDA-31 decision (CR-01 / K127 / K131)

Checked in the code. All four call sites now return a fixed category. `testLlmConnection` (`src/app/(app)/settings/actions.ts:88-115`), `testEmbeddingConnection` (`:159-188`), `testImapConnection` (`src/app/(app)/settings/email/actions.ts:110-140`) and `testSmtpConnection` (`:147-177`) each catch, call `classifyConnectionError(e)` and return `{ ok: false, error: category, correlationId }`. Their log line carries only `connectionErrorLogShape(e)`, an allowlisted name, code and status. `classifyConnectionError` (`src/lib/connection-test/errors.ts:290-296`) can return only the four members of `CONNECTION_TEST_ERROR_CATEGORIES`. The Ollama probes wrap failures in `UncredentialedProbeError` and check the response shape (`src/lib/llm/test-connection.ts:53,72`, `src/lib/rag/embed-test-connection.ts:49,78`), so a 401 or 403 from an admin-typed URL is `connection_failed` (K131). The three buttons render only `CONNECTION_TEST_ERROR_MESSAGES[result.error]` plus the correlation ID. Tests: `connection-test-errors` 30, `connection-test-probes` 69, `settings-connection-actions` 28, all passed [gate-log]. CR-01 is closed in the code.

Info: the stored-secret fallback lookup sits outside each `try` (`settings/actions.ts:92`, `:165`; `email/actions.ts:114`, `:151`). If that DB or decrypt read throws, the action rejects with Next's generic server-action error, and the button shows its fixed "Unexpected error" text. No raw text reaches the client, so this does not break AIDA-31.

### Required Artifacts

`gsd verify.artifacts` over all 18 Part A plans: every listed artifact exists and passes its content check (08-01 2/2, 08-02 3/3, 08-03 4/4, 08-04 2/2, 08-05 4/4, 08-06 4/4, 08-07 3/3, 08-08 2/2, 08-09 5/5, 08-10 4/4, 08-11 4/4, 08-12 3/3, 08-13 5/5, 08-17 3/3, 08-18 4/4, 08-19 1/1, 08-20 4/4, 08-24 3/3) [run].

### Key Link Verification

| Plan | Result | Note |
|---|---|---|
| all except below | all verified by tool | [run] |
| 08-11 | 1/2 by tool; the second confirmed by hand | 48-hour cap: `RATE_LIMIT_MAX_WINDOW_MS = 48h` equals the cleanup job's `48 * 3600 * 1000` [code] |
| 08-17 | 1/2 by tool; the second confirmed by hand | `global-setup.ts` reaches `process-tree.ts` through `support/global-teardown.ts:14`; four specs import it directly [code] |
| 08-19 | 2/4 by tool | one RE2-incompatible pattern, one prose `from:`; the guard test `test-suite-config.test.ts` exists and runs in the unit suite [code + run] |
| 08-24 | 3/4 by tool | the `blocked (space)` pattern link points at 08-19's recording rule; 08-GATE-A.md does use the word `blocked (space)` for egress and both image rows [code] |

### Data-Flow Trace (Level 4)

Not applicable in the UI sense. The one user-visible value changed here is the connection-test failure text. It flows from `classifyConnectionError` → action result → `CONNECTION_TEST_ERROR_MESSAGES[result.error]` in the button: real data, fixed text. ✓ FLOWING.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Types clean | `pnpm typecheck` | exit 0, 0 `error TS` | ✓ PASS [run] |
| Lint clean | `pnpm lint` | exit 0, 616 files, 1 warning (existing `noTemplateCurlyInString` in a test) | ✓ PASS [run] |
| Unit suite | `pnpm test` | exit 0, 78 files, 1395 passed (matches gate) | ✓ PASS [run] |
| Integration, E2E, build, egress, images | not run by rule | taken from the gate on the same code: integration 1360 passed, E2E 225 expected / 0 unexpected / 1 skipped, build 0; egress and both images `blocked (space)` | [gate-log] |
| Gate checker | `part-a-gate-check` output | `PART-A-GATE-CHECK ok sections=all results=13 evidence=7 design=8 matrix=31 requirements=8`, exit 0 | [gate-log `check-full.out`] |

### Probe Execution

No phase-declared `scripts/*/tests/probe-*.sh`. Step 7c: SKIPPED (no probes declared).

### Requirements Coverage

| Req | Part A proves | Stays open | Verdict |
|---|---|---|---|
| AIDA-25 | Production audit 1 critical / 43 high → 0 / 10 [summary]; residual table complete against the gate's 10 IDs [gate-log]; exit codes recorded; gate reported red [gate-log] | Residual list in `docs/SECURITY.md` (08-15, Phase 8.1); 2 reachable nodemailer advisories need an owner decision | **Open.** It cannot close in Part A. 08-SPLIT says it can, but 08-04 assigns the docs copy to 08-15 |
| AIDA-26 | dependabot.yml and audit.yml exist, files only [code] | egress CI job is 08-05b (not part of AIDA-26's acceptance) | **Closable** |
| AIDA-27 | Dockerfile non-root lines and static test; OPERATIONS volume procedure [code] | runtime UIDs, migrate exit 0, fresh-volume upload, real-volume procedure (8.1); image build checks blocked (space) | **Split**, open |
| AIDA-28 | nonce CSP in proxy; prod policy unit test; zero-violation E2E on the 5 pages on the dev server [code + gate-log] | production `next start` proof (08-21) | **Split**, open |
| AIDA-29 | helper, unit topology and spoof tests, all routes use it, OPERATIONS section [code + gate-log] | real Caddy and real HTTP proofs (08-21, 08-22) | **Split**, open |
| AIDA-30 | health and attachments throttled, follow-up cap, limit before token lookup [code + gate-log] | healthcheck green under throttle, Caddy body pass-through, probe refusal at upstream (8.1) | **Split**, open |
| AIDA-31 | all four call sites return a fixed category [code + gate-log] | none | **Closable** |
| AIDA-32 | telemetry ENV static, no Google Fonts, addTag gate, sla-flag comment [code + gate-log] | telemetry at image runtime (08-14); `docs/SECURITY.md` matches code (08-15) | **Split**, open |

No orphaned requirement: every ID of Phase 8 appears in a Part A plan's `requirements`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| (all Phase 8 changed files) | - | TBD / FIXME / XXX | none found | - |
| `docs/SECURITY.md` | 8 | stale claim: build path calls Google Fonts, Next telemetry on by default, Prisma checkpoint ping on compose up | ⚠️ Warning | A public doc now contradicts the code. Owned by 08-15 (Phase 8.1); should be fixed before any release built on the candidate commit |
| `.planning/phases/08-security-hardening/deferred-items.md` | 13 | "Ollama probe accepts any 200 JSON" | ℹ️ Info | Stale: fixed by K131 (shape checks at `llm/test-connection.ts:72`, `rag/embed-test-connection.ts:78`) |
| `.github/workflows/audit.yml` | 41 | job fails while 10 highs remain | ℹ️ Info | Expected and honest. Every PR and push to master will be red until AIDA-25 is resolved |

### Prohibitions (ADR-550)

- Test-tier, with enforcement found: no workflow schedule or non-ubuntu runner (`build-egress-guards.test.ts`); no raw connection text or host (`settings-connection-actions`, `connection-test-errors`); no raw IP logged or persisted (`rate-limit-atomic`, `public-route-limits`); J1 egress suite kept off the integration path (`test-suite-config.test.ts`); no row recorded passed when blocked (`part-a-gate-check.test.ts`, checker ok); /api/health never exempted, probe reads only the shared snapshot (`health-probe*.test.ts`, and code read).
- Test-tier, **flagged** (no automated test found): "no AGPL/GPL dependency, no unpinned range". I checked it by hand: every package Phase 8 added or bumped is an exact pin (diff of `package.json` since `7e9e73f~1`), and their licenses are MIT, or MIT-0 for nodemailer. No test enforces it. Status: unverified-prohibition, flagged.
- Test-tier, **flagged**: 08-11 "never write the status token to a log". By hand, there is no `console.*` in `src/app/api/public/**`, and the only log lines in `src/lib/rate-limit` are fixed strings. No dedicated test.
- Judgment-tier: non-authoritative verdict "no violation seen". Listed under human verification.

### Review and Codex critique closure [summary + code spot checks]

- 08-REVIEW (a to d): K126 to K130 fixed in F1 to F5. Spot checks: the K126 refresh E2E passed [gate-log]; K127 [code, above]. The deferred info rows (a-IN-a3, a5, a6, a7, b-IN-b5, b6, b8, c-IN-07) are recorded with reasons in `deferred-items.md`. They are accepted findings justified in writing.
- Codex round 1: 4 HIGH (K131 to K134) and 1 MEDIUM (K135), fixed in F6; the LOW (Caddy-made responses without headers) is deferred to 08-22. Round 2: no HIGH; K136 to K138 fixed in F7. Round 3 (the last allowed): no HIGH; 2 MEDIUM (K139, K140) and 1 LOW docs sentence, fixed in F8. Spot check of K140: the scanner recognises delimiters only at line start, and `read-bounded-form-data.test.ts` 29 passed [gate-log]. F8 itself got no further Codex review (charter cap). This verifier read the code but did no adversarial review of F8.
- Unresolved HIGH findings R4-1 and R4-2 are in Part B plans (08-16, 08-05b), outside this scope.

### Human Verification Required

1. **Owner decision on the reachable nodemailer advisories.** GHSA-prgh-xp8r-p3m5 and GHSA-v53p-9fqp-m79j: allow nodemailer 10 (and mailparser >= 3.9.25), or accept them in writing. Without this AIDA-25 cannot close.
2. **Owner: is `fc8078f` the v1.0.0 safe point?** It is a candidate only.
3. **Owner: Docker VM space (0a2).** Then re-run `pnpm test:egress` and both image checks; this upgrades truth 4.
4. **DESIGN-SYSTEM §9 item 2**, empty state halo and icon box: manual, not run.
5. **§9 item 3**, sidebar tokens: manual, not run.
6. **§9 item 4**, sticky top bar with blur: manual, not run.
7. **§9 item 5**, auth page does not self-wrap: manual, not run.
8. **§9 item 7**, dark mode: visual, not run.
9. **System font stack visual approval** and re-capture of the screenshots and hero GIF (08-05, D-26).
10. **Real security contact** (LAUNCH.md, "Before you tag", item 5).
11. **The `v1.0.0` tag and the release.**
12. **Repository settings in LAUNCH.md**, including whether the audit job becomes a required check.
13. **Judgment-tier prohibitions** (listed in frontmatter): human review recommended.

No human result is recorded here. All of these stay open.

### Gaps Summary

No Part A must-have is missing or stubbed in the code. Every Part A deliverable is present and wired, and it is tested on the host at the gate's commit. The unit suite is reproduced here (1395 passed). The phase goal itself is not reached, for three reasons:

1. **The audit is still red** with 10 high advisories, two of them reachable. AIDA-25's red-path acceptance needs a written, not-reachable justification in `docs/SECURITY.md`. That listing belongs to 08-15 (Phase 8.1), and the two reachable advisories need an owner decision before any justification can be honest. Warning: 08-SPLIT.md says AIDA-25 can close in Part A, but the plans place its docs listing in Part B, so it cannot.
2. **`docs/SECURITY.md` does not match the code** (line 8 is stale). This is owned by 08-15 (Phase 8.1).
3. **Every container runtime proof**, SC2 included, is split to Phase 8.1 and not proven. The image build checks are `blocked (space)`.

Requirements: AIDA-26 and AIDA-31 can close. AIDA-27, 28, 29, 30 and 32 are split (host side proven, runtime part open in 8.1). AIDA-25 is open.

---

_Verified: 2026-11-12T05:04:30Z_
_Verifier: Claude (gsd-verifier)_
