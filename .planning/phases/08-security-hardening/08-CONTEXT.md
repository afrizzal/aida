# Phase 8: Security Hardening - Context

**Gathered:** 2026-11-07, finished 2026-11-08, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for planning
**Sources:** facts checked against the code at `4d8efca` and re-checked at `94a5c18` (no code change in between, only planning documents); Codex brainstorm in `run-loop/codex/fase08-tanya.md` and `fase08-jawab.md`. Every Codex claim used below was re-checked in the code unless it is marked *unverified*.

<domain>
## Phase Boundary

Make the v1 code safe to release. Production dependencies carry no known critical or high advisory, or each residual is justified in writing. Every accepted v1 security finding assigned to this phase is fixed or justified: AIDA-25 to AIDA-32 in `.planning/REQUIREMENTS.md`. No new product features.

Not in this phase: F-09 and F-10 (demo password echo and seed ordering) belong to Phase 9 (AIDA-37). Phase 8 must not report all v1 findings as closed.

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex agreed" means the Codex brainstorm recommended the same thing.

### Dependencies (AIDA-25)

- **D-01:** Upgrade `next` to >=16.4.1 and `better-auth` to >=1.7.7 first, each in its own plan, then re-run `pnpm audit --prod` before touching anything else. Source: audit at `4d8efca` (7 critical, 52 high; `next` and `better-auth` carry the critical advisories); Codex agreed on the order.
- **D-02:** The Better Auth upgrade must prove, with tests: login, an existing session surviving the upgrade, organization membership, `/setup`, `bootstrap`, and `prisma migrate deploy` from the v1 schema on a populated copy. Do not write speculative auth migrations; only generate what the new version's schema diff requires. Review the existing `pnpm.overrides` entry `better-call: 1.3.7` and remove it if the upgrade makes it unnecessary. Source: Codex; override checked in `package.json`.
- **D-03:** Move `shadcn` from `dependencies` to `devDependencies`. It is only used by `@import "shadcn/tailwind.css"` in `src/app/globals.css`, at build time, and brings `proxy-addr` (critical), `@modelcontextprotocol/sdk`, `body-parser`, `undici`, `systeminformation` and others into the production audit. The move counts as a fix only with evidence: the build still passes, and neither `.next/standalone` nor the worker bundle `dist/` contains `shadcn` or those modules (grep the artifacts). A full audit that includes dev dependencies is recorded separately, and build-chain residuals are listed in `docs/SECURITY.md`. Source: my analysis; Codex agreed, adding the worker-bundle check and the separate build-chain audit.
- **D-04:** Then bump the direct dependencies that are vulnerable themselves: `nodemailer` to >=9.1.0, staying on major 9; `zod` to >=4.6.6; and newer `imapflow`, `prisma` and `html-to-text` releases where upstream fixes exist. Use narrow `pnpm.overrides` for transitive modules (`fast-uri`, `ip-address`) only with a compatibility test. For `deepmerge-ts@8` (major) and `sharp@0.35` (0.x minor), prefer an upstream fix. Otherwise record a residual with its advisory ID and the reason it is unreachable. Today `src/` has zero `next/image` uses, no `images.remotePatterns`, and SVG optimization is off. The gate then stays red with that list (ROADMAP → Gates). Source: Codex; reachability facts from `07-SECURITY-PASS.md` F-05, re-checked.
- **D-05:** Every edit to `package.json` and `pnpm-lock.yaml` happens in a sequential plan, never two in one wave. Package-rule: pinned versions, MIT, Apache-2.0, BSD or ISC, no AGPL or GPL, the reason recorded. Source: charter.

### Automation (AIDA-26)

- **D-06:** `.github/dependabot.yml` covers npm for `/` and `/website`, `github-actions`, and `docker`, weekly, with minor and patch updates grouped. Source: Codex agreed.
- **D-07:** Add a separate CI job `audit` that runs `pnpm audit --prod --audit-level=high` on push and pull request, plus a weekly schedule. Making it a required check is a repository setting, so it is a manual item for the owner. Files only: this run triggers no workflow. Source: Codex; charter forbids `gh workflow run`.

### Containers (AIDA-27)

- **D-08:** Use the image's built-in `node` user (UID 1000) in the `runner` stage. `migrate` builds from the `builder` stage (`docker-compose.yml`, `target: builder`), so it must also run as non-root: add a non-root user to that stage, or a dedicated stage for migrate. Create `/data/uploads` and any other write path in the image with explicit ownership. Source: Codex; `target: builder` checked in `docker-compose.yml`.
- **D-09:** Existing root-owned `uploads_data` volumes are handled by an idempotent manual procedure in `docs/OPERATIONS.md`: back up first, name the real compose volume, use UID and GID 1000, warn before a recursive `chown`. No root entrypoint, no new `su-exec` package, no extra init service. Tests: upload on a fresh volume; a root-owned volume before and after the procedure; `scripts/backup.sh` reading as non-root. Source: Codex agreed with option (c).
- **D-10:** Check whether the standalone server writes `.next/cache` at runtime, and provide only the write paths that are proven necessary. Source: Codex; *unverified* until the image runs.

### CSP and headers (AIDA-28)

- **D-11:** Nonce per response with `strict-dynamic`, set in `src/proxy.ts` on every HTML path, public pages included. Policy baseline: `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `'unsafe-eval'` only in development; `style-src 'self' 'unsafe-inline'` as the CSP2 fallback; `style-src-elem 'self' 'nonce-…'`; `style-src-attr 'unsafe-inline'`, because Radix positions popovers through `style` attributes and a nonce does not cover attributes; `img-src 'self' data: blob:`; `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. Tighten only from proven need. Source: Next.js 16.2.9 CSP guide via Context7; Codex on `style-src-elem` and `style-src-attr`.
- **D-12:** The proxy overwrites any incoming `x-nonce` and `Content-Security-Policy` request header; never trust one from the client. Pass the nonce to `next-themes`' `ThemeProvider`. Report-only may be used while diagnosing, but the phase ends enforced. Source: Codex.
- **D-13:** Every page becomes dynamically rendered, which nonces require. Check that no route depends on static rendering or ISR. Source: Next.js docs.
- **D-14 (Claude's discretion):** In the same plan, add `X-Content-Type-Options: nosniff` and a `Referrer-Policy`, with `no-referrer` on `/status/*`, because the status token sits in the URL path and must not leak through `Referer`. Source: Codex raised token leakage via referrer as *unverified*; the header is cheap defense in depth.
- **D-15:** The E2E acceptance test asserts the header and zero CSP violations on login, inbox, ticket, public request and public status pages, including a popover and a theme switch. It stays in the suite for every later UI phase. Source: AIDA-28; ROADMAP → Cross-phase risks.

### Client IP (AIDA-29)

- **D-16:** Supported topology: `app` is reachable only through the shipped Caddy, which sets the identity header from the TCP peer. Make that explicit in `Caddyfile` (`header_up X-Forwarded-For {remote_host}`) instead of relying on Caddy's default. One helper `getClientIp(request)` returns a validated canonical IP, IPv6 included. A missing or malformed header goes to a shared bucket with a bounded limit; it is never treated as loopback or exempt. Source: Codex rejected trusting a hop count alone; I agree.
- **D-17:** An optional `TRUSTED_PROXY_HOPS` for operators who put a CDN in front is an advanced setting. It reads from the right and fails closed on an invalid chain. Direct exposure of `app:3000` is documented as unsupported in `docs/OPERATIONS.md`. Source: my proposal, narrowed after Codex.
- **D-18:** Better Auth's own rate limiter is on in production and keys on `x-forwarded-for` (`07-SECURITY-PASS.md`, sweep 2 item 7, better-auth 1.6.22). After the D-01 upgrade, re-check its IP source and align it with the helper, for example through its IP-header option, with a spoofing test. Source: Codex; checked in the security pass.
- **D-19:** The spoofing test goes through real Caddy at the end-of-phase compose gate, plus unit tests for the helper.

### Public route abuse (AIDA-30)

- **D-20:** `/api/health`: an in-memory cache of 2 to 5 seconds with single-flight for the DB read, plus an in-memory throttle, not the DB-backed limiter, which would add DB load. No exemption for requests without `X-Forwarded-For`. The shared no-identity bucket is sized so the 10-second container healthcheck always passes. Tests: DB down and up, concurrency, a flood, and the healthcheck. Source: Codex; healthcheck interval checked in `docker-compose.yml`.
- **D-21:** `/api/public/status/[token]/attachments/[id]`: a per-IP limit before the token lookup, starting at 120 per minute (a hypothesis, documented as such), answering `429` with `Retry-After`. Source: Codex.
- **D-22:** `intake`, `csat` and `follow-up` check the rate limit before parsing the body and before the token lookup. Today all three parse first. Source: code (`intake/route.ts` parses at line 28 and limits at 41; `csat` and `follow-up` look up the token first); Codex added intake.
- **D-23:** Make `checkRateLimit` atomic. Today it runs `count` then `create` separately, so parallel requests can pass the quota. Keep table growth bounded by the existing cleanup job. Source: Codex; checked in `src/lib/rate-limit/check-rate-limit.ts`.
- **D-24:** Enforce the total byte limit on the bytes actually received, even when `Content-Length` is missing, false or chunked. The header check is only an early reject. Align the three layers: `Caddyfile` has `max_size 12MB`, while `MAX_TOTAL_REQUEST_BYTES` is 30 MiB and feeds `proxyClientMaxBodySize`. Legitimate 12–30 MB intake submissions are therefore cut by Caddy today, a v1 bug. `follow-up` gets the combined cap. Validate every file before storing any, and remove stored files when a later step fails. Source: Codex; limits checked in `Caddyfile` and `src/lib/attachments/constants.ts`.

### Connection-test errors (AIDA-31)

- **D-25:** All four test actions return one of `invalid_configuration`, `authentication_failed`, `connection_failed` or `unknown`. Timeout, DNS, refusal and TLS all map to `connection_failed`, so the response cannot map the network. By default the log gets the category and a correlation ID only; a raw detail, if ever logged, passes through redaction of URLs, credentials, headers and tokens, without claiming the regex catches everything. This reduces the oracle; it does not remove SSRF or timing channels, and the docs say so. Source: Codex; four call sites checked.

### Remaining findings (AIDA-32)

- **D-26:** Font: replace `next/font/google` Inter with a system font stack. `globals.css` already falls back to `system-ui, sans-serif` (line 137), but `--font-sans` and `--font-heading` (lines 8 and 9) also point at `--font-inter`, so all three must move to the system stack; keep the type scale from `DESIGN-SYSTEM.md`. The screenshots and hero GIF in `docs/assets` were made with Inter and become stale. Re-capturing them and approving the look is a manual item for a human; do not claim a visual pass. Source: AIDA-32's conservative default; Codex agreed.
- **D-27:** Set `NEXT_TELEMETRY_DISABLED=1` and `CHECKPOINT_DISABLE=1` in the Dockerfile `base` stage (inherited by `deps`, `builder` and migrate) and explicitly in `runner`, plus in CI for `pnpm` steps outside Docker. Keep the compose value for `migrate`. Prove the build path separately from runtime. Source: Codex.
- **D-28:** `addTag` (`src/app/(app)/tickets/[id]/actions.ts:215`) runs `name.trim()` and the empty-string return before `getScopedDb()`, so the auth gate is its third statement (F-11). Move `getScopedDb()` to the first statement, as AIDA-32 requires ("`addTag` gates before validating"), with a test that an unauthenticated call with an empty name is rejected by the gate. `src/lib/worker/jobs/sla-flag.ts` gets a comment explaining why its two `$executeRaw` statements have no org filter (F-13). Source: v1 findings; order checked in the code. The first draft of this decision had the current order backwards; corrected 2026-11-08.
- **D-29:** Reconcile `docs/SECURITY.md` with the code. Remove the stale "three third-party calls" gap at line 8, since the Prisma checkpoint is already fixed, and describe telemetry and fonts as fixed. Add sections for dependency residuals, the client-IP contract, CSP and non-root. Keep F-09 and F-10 listed as open for Phase 9. Source: Codex; line 8 checked.

### Plan shape

- **D-30:** Suggested waves; the planner may split further, never drop scope.
  - Wave 1: the `next` upgrade; then the `better-auth` upgrade; then the remaining dependencies with `shadcn`. These stay sequential because of D-05. Alongside them: font and telemetry; connection errors with `addTag` and the SLA comment.
  - Wave 2, after `next`: CSP and headers; non-root containers; the client-IP helper with Caddy.
  - Wave 3, after the IP helper: throttles, the atomic limiter and byte caps; Dependabot and CI audit.
  - Wave 4: `docs/SECURITY.md` reconciliation and the full gate run, including egress and compose health.
  Waves are dependency order, not permission to run tests in parallel: one test process at a time. Source: Codex, adjusted for D-05.

### Claude's Discretion

- Exact limits (health bucket size, attachment rate) within D-20 and D-21, documented as tunable.
- Whether the anonymous `/api/health` response keeps `worker.lastRunAt`. The security pass (sweep 2, LOW-1) suggests limiting worker detail to authenticated callers. The container healthcheck (`wget`) only needs the HTTP status; check for other consumers of the field before removing it.
- Helper and module names, test file layout.
- Whether `X-Frame-Options` is added next to `frame-ancestors`.

</decisions>

<specifics>
## Specific Ideas

- A residual advisory is never reported as passed. Record the exit codes of both `pnpm audit --prod` and `pnpm audit --prod --audit-level=high` (ROADMAP → Gates).
- The status token lives in the URL path: the logs and `Referer` are leak paths worth one test each.
- After the font change, do not regenerate `docs/assets` silently; list it as a manual item with the reason.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and rules
- `.planning/REQUIREMENTS.md`: AIDA-25 to AIDA-32, with their acceptance text
- `.planning/ROADMAP.md`: Phase 8, Gates, Cross-phase risks (Better Auth upgrade before Phase 10; CSP test kept; health throttle against the healthcheck)
- `.planning/run-loop/PIAGAM.md`: Aturan teknis AIDA, package rule, Larangan, Aturan eksekutor
- `.planning/run-loop/codex/fase08-jawab.md`: the Codex brainstorm behind these decisions

### v1 findings
- `.planning/milestones/v1.0.0-phases/07-launch-readiness/07-SECURITY-PASS.md`: Findings F-05 to F-15, Known issues, sweep 2 (route coverage and the Better Auth limiter), sweep 5 (egress)
- `.planning/milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md`: "From 07-09"

### Code
- `package.json` (dependencies, `pnpm.overrides`), `pnpm-lock.yaml`
- `Dockerfile` (`base`, `deps`, `builder`, `runner`), `docker-compose.yml` (`migrate` builds `target: builder`; app healthcheck), `Caddyfile`
- `src/proxy.ts`, `src/app/layout.tsx`, `src/app/globals.css`
- `src/lib/rate-limit/check-rate-limit.ts`, `src/app/api/health/route.ts`, `src/app/api/public/intake/route.ts`, `src/app/api/public/status/[token]/{csat,follow-up,attachments/[id]}/route.ts`, `src/lib/attachments/constants.ts`
- `src/app/(app)/settings/actions.ts`, `src/app/(app)/settings/email/actions.ts`, `src/lib/llm/redact.ts`
- `src/lib/worker/jobs/sla-flag.ts`, the `addTag` action under `src/app/(app)/tickets/[id]/`
- `.github/workflows/ci.yml`, `docs/SECURITY.md`, `docs/OPERATIONS.md`, `tests/integration/egress-isolation.test.ts`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/llm/redact.ts` `redactSecrets()`: explicit patterns only; reuse for any logged detail, but do not over-claim.
- `src/lib/rate-limit/`: Postgres-backed limiter plus the existing cleanup job; make it atomic rather than replacing it.
- `tests/integration/egress-isolation.test.ts`: the runtime egress proof; the build path needs its own check.

### Established Patterns
- `src/proxy.ts` holds `PUBLIC_PREFIXES` and `BLOCKED_PUBLIC_ROUTES`; the CSP lives there too.
- Worker-bundled modules use relative imports only.
- `AuditEvent` is append-only at the DB level.
- Brand colour and token rules are enforced by `tests/unit/design-tokens.test.ts` and `tests/e2e/a11y-contrast.spec.ts`; the font change must keep both green.

### Integration Points
- The Better Auth upgrade touches `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/bootstrap.ts`, `src/app/(auth)/setup/actions.ts` and `prisma/schema.prisma`.
- The CSP touches every page through the proxy and the root layout.

</code_context>

<deferred>
## Deferred Ideas

- F-09 and F-10 (demo password echo, seed ordering): Phase 9, AIDA-37.
- Making the CI audit job a required check: owner, repository settings.
- Re-capturing and approving `docs/assets` after the font change: human item.
- Hardening beyond the shipped topology (CDN setups): only the documented `TRUSTED_PROXY_HOPS` option in this phase.

</deferred>

## Human boundary (from the charter's phase table)

Stays open for a human: the real security contact, the `v1.0.0` tag, the release, and repository settings in `LAUNCH.md`. Added by this context: making the CI audit a required check, and approving re-captured screenshots.

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks. Write every human verification as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. Every executor dispatch includes the charter's "Aturan eksekutor" section.

## Owner rules of 2026-11-08 (binding, summary)

The charter section "Aturan owner 2026-11-08" binds like the Larangan; read it in full. The parts that reach planning and execution:

- **D:** all code is written by Claude (Opus 5.5). Codex gives opinions and reviews only. GSD agents inherit the session model through `"model_profile": "inherit"`; do not change the profile and do not pass a `model` parameter when dispatching an agent.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout and create no worktree. Temporary exports are deleted only by the round that made them, only under `${TMPDIR}`.
- **G:** no push. AIDA is public, so a push publishes code.
- **A and B:** the orchestrator checks disk space and Docker health at the start of every round; an executor that sees Docker fail stops and reports instead of restarting Colima or Docker.
- **E:** does not apply to this phase (no project-management reference code is used).

## Larangan dari piagam (verbatim, binding)

- Dilarang `git push`, `gh pr`, `gh release`, `gh workflow run`, dan apa pun yang memindahkan commit ke remote. Jangan melepas kunci `pushurl`.
- Dilarang commit ke `master`, `git merge`, `git rebase`, `git reset --hard`, `git clean`, `git stash`, `git tag`, dan `--no-verify`.
- Dilarang menyentuh `~/Public/aff/recruitment` dan project lain.
- Dilarang menghentikan, menghapus, atau mengubah container dan volume selain milik project `aida` dan `aida-dev-db`. Dilarang `docker system prune` dan `docker volume prune`.
- Dilarang memanggil API LLM berbayar sungguhan, mengirim email nyata, dan memakai kredensial asli. Test memakai fake dan server tiruan.
- Dilarang menaruh API key di `.env` dan mengubah aturan izin Claude Code.
- Dilarang `--auto` dan `--chain`, dan dilarang menyalakan `workflow.auto_advance`.
- Dilarang `/gsd-autonomous`, `/gsd-discuss-phase`, `/gsd-new-milestone`, `/gsd-verify-work`, `/gsd-audit-milestone`, `/gsd-complete-milestone`, `/gsd-cleanup`, `/gsd-ship`, dan `/gsd-update`.
- Dilarang `/gsd-review`, `/gsd-plan-review-convergence`, `--codex`, `--all`, `--converge`, dan `--cross-ai`. Jalur itu menjalankan reviewer di repo asli, bukan di ekspor.
- Dilarang mengisi hasil UAT, visual pass, atau penilaian manusia rekaan. Kosong tetap kosong.
- Dilarang menulis backslash ke `last_activity_desc` di `STATE.md`.

---

*Phase: 08-security-hardening*
*Context gathered: 2026-11-07*
