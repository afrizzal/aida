---
phase: 07-launch-readiness
plan: 07
subsystem: infra
tags: [docker-compose, demo-mode, better-auth, instrumentation, healthcheck, prisma]

# Dependency graph
requires:
  - phase: 07-launch-readiness (07-02)
    provides: "src/lib/demo/fixtures.ts + seedDemoData() orchestrator + pnpm db:seed CLI (the dataset this plan wires into boot)"
  - phase: 07-launch-readiness (07-04)
    provides: "docs/OPERATIONS.md env-variable reference table with the 07-07 marker this plan replaces"
provides:
  - "src/lib/demo/identities.ts: ensureDemoIdentities() — the one place demo org+admin+agent are resolved/created, shared by prisma/seed.ts and the boot path"
  - "src/lib/bootstrap.ts: createFirstOrgAndAdmin() extracted from bootstrapFromEnv, reused by ensureDemoIdentities without duplicating the Better Auth signUpEmail -> createOrganization sequence"
  - "src/lib/demo/bootstrap-demo.ts: bootstrapDemoMode() — strict DEMO_MODE==='true' gate, loud credentials warning, prisma.ticket.count() idempotency guard, try/catch so a failed seed never blocks startup"
  - "src/instrumentation.ts wired to await bootstrapDemoMode() after bootstrapFromEnv()"
  - "docker-compose.yml: DEMO_MODE/DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD/DEMO_AGENT_EMAIL on the app service only, plus a 90s healthcheck start_period"
  - ".env.example + docs/OPERATIONS.md: documented, blank-by-default DEMO_MODE block and a '### Demo mode' ops runbook subsection"
  - "Real cold-boot proof: DEMO_MODE=true docker compose up seeds 30 tickets/12 contacts/6 KB articles/8 CSAT/3 COMPLETED InsightRuns in 2223ms, survives a restart without duplicating, and is fully inert (zero [demo] log lines) once the flag is unset"
affects: [07-09-security-pass, 07-10-readme, 07-11-docs-demo-walkthrough]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared identity-creation module (src/lib/demo/identities.ts) imported by both a CLI script (prisma/seed.ts) and a boot-time hook (instrumentation.ts) so two independent entrypoints into the same Better Auth signUpEmail/createOrganization sequence cannot drift — createFirstOrgAndAdmin (src/lib/bootstrap.ts) is the single underlying primitive both call"
    - "Flag-gated boot behaviour with a strict equality check as the very first statement (`if (process.env.DEMO_MODE !== \"true\") return;`), and the loud/dangerous warning logged BEFORE any try/catch so it survives even a mid-seed failure"
    - "A background instrumentation.register() side effect that can never block startup: bootstrapDemoMode() wraps its own body in try/catch and only ever logs+returns on failure, mirroring bootstrapFromEnv's existing swallow-on-failure contract"

key-files:
  created:
    - src/lib/demo/identities.ts
    - src/lib/demo/bootstrap-demo.ts
  modified:
    - src/lib/bootstrap.ts
    - src/instrumentation.ts
    - prisma/seed.ts
    - docker-compose.yml
    - .env.example
    - docs/OPERATIONS.md

key-decisions:
  - "createFirstOrgAndAdmin(input: {name,email,password}) extracted from bootstrapFromEnv with identical org name/slug (hardcoded \"AIDA\"/\"aida\", unchanged) and identical error logging; it now throws a descriptive Error on failure instead of returning, and bootstrapFromEnv wraps the call in try/catch to preserve its exact original observable behaviour (no-op on missing env, idempotent on existing users, swallows failures)."
  - "ensureDemoIdentities() resolves an existing org's admin via the owner/admin-role member (falling back to the earliest member) rather than assuming a fresh org, so it is safe to call against a workspace that was set up interactively via /setup, not just a truly empty database."
  - "bootstrap-demo.ts derives the printed sign-in email from the SAME DEMO_ADMIN_EMAIL_DEFAULT constant identities.ts uses internally (imported, not re-declared) so the boot log can never claim a different email than what was actually created."
  - "healthcheck start_period set to 90s against a measured real seed time of ~2.2 seconds — a very large margin intentionally chosen because the plan's own concern (a slow seed marking the container unhealthy) is real for a slower host/disk, and the cost of an oversized start_period is just a slightly slower 'unhealthy vs starting' distinction, not a functional risk."
  - "The pre-existing /setup wizard (src/app/(auth)/setup/actions.ts) keeps its own auth.api.signUpEmail call site untouched — it lets a user choose org name+slug interactively, which createFirstOrgAndAdmin's hardcoded \"AIDA\"/\"aida\" cannot serve without changing its existing behaviour. This plan's files_modified list never included that file. See 'Deviations' below for the exact grep evidence and reasoning."

patterns-established:
  - "Demo mode's DEMO_* env vars are read with the same `env || DEFAULT_CONST` pattern in three places (identities.ts, bootstrap-demo.ts, prisma/seed.ts) by importing the *_DEFAULT constants from identities.ts rather than re-declaring the literal strings — any future default change only needs to happen in one file."

requirements-completed: [AIDA-22]

# Metrics
duration: 46min
completed: 2026-07-31
---

# Phase 7 Plan 7: Demo Mode Boot Wiring & Cold-Boot Verification Summary

**`DEMO_MODE=true docker compose up` now auto-creates a demo org/admin/agent and loads the full 07-02 demo dataset at boot — proven end-to-end on a real cold boot (2.2s seed, 30 tickets, idempotent restart, fully inert once unset) — completing AIDA-22.**

## Performance

- **Duration:** 46 min
- **Started:** 2026-07-31T14:07:13Z
- **Completed:** 2026-07-31T14:53:00Z
- **Tasks:** 3
- **Files modified:** 8 (2 created, 6 modified; Task 3 was verification-only, no additional repo files changed)

## Accomplishments

- `src/lib/demo/identities.ts` (`ensureDemoIdentities`) is now the single place demo org+admin+agent identities are resolved or created — `prisma/seed.ts` (the CLI) and the new boot-time path both call it, eliminating the risk of the two paths drifting.
- `src/lib/bootstrap.ts` gained `createFirstOrgAndAdmin`, extracted from `bootstrapFromEnv` without changing its observable no-op/idempotent/swallow-on-failure behaviour — confirmed by a live cold boot where `bootstrapFromEnv`'s own log line (`[bootstrap] Created admin: admin@demo.aida.test`) fired correctly from inside the demo path, proving the shared function truly is shared, not duplicated.
- `src/lib/demo/bootstrap-demo.ts` (`bootstrapDemoMode`) is a strict, flag-gated, idempotent, non-blocking demo bootstrap wired into `instrumentation.ts` — verified against a real container that it logs the loud credentials warning, seeds exactly once, and can never fail startup.
- `docker-compose.yml` + `.env.example` + `docs/OPERATIONS.md` plumb and document `DEMO_MODE`/`DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`/`DEMO_AGENT_EMAIL` (app service only) with a 90s healthcheck `start_period`.
- A real `docker compose build && docker compose up -d` cold boot (this worktree's `aida` compose project, own volumes) proved the entire AIDA-22 headline claim end to end: seed completed in 2223ms, all five documented dataset counts matched exactly, a restart did not duplicate data, unsetting the flag on the same volumes produced zero demo-related log lines, and the documented demo admin credentials (`admin@demo.aida.test` / `aida-demo-2026`) actually authenticate via the real sign-in API.

## Task Commits

1. **Task 1: Extract shared demo identities + flag-gated demo bootstrap** - `c0ef66f` (feat)
2. **Task 2: Compose + env plumbing and documentation of the demo credentials** - `7e2b243` (chore)
3. **Task 3: Cold-boot verification of `DEMO_MODE=true docker compose up`** - verification only, no additional repo file changes (see Evidence below); folded into this plan's metadata commit.

## Files Created/Modified

- `src/lib/demo/identities.ts` - `ensureDemoIdentities()` + `DEMO_ADMIN_EMAIL_DEFAULT`/`DEMO_AGENT_EMAIL_DEFAULT`/`DEMO_PASSWORD_DEFAULT`
- `src/lib/demo/bootstrap-demo.ts` - `bootstrapDemoMode()`, the flag-gated boot-time demo bootstrap
- `src/lib/bootstrap.ts` - extracted `createFirstOrgAndAdmin()`; `bootstrapFromEnv()` now delegates to it inside a try/catch
- `src/instrumentation.ts` - `register()` now also awaits `bootstrapDemoMode()`
- `prisma/seed.ts` - now calls `ensureDemoIdentities()` instead of its own inline org/admin/agent creation
- `docker-compose.yml` - `app` service gains the four `DEMO_*` env vars + `start_period: 90s` on its healthcheck
- `.env.example` - documented, blank-by-default `DEMO_MODE` block
- `docs/OPERATIONS.md` - four `DEMO_*` env-reference rows + a `### Demo mode` subsection

## Decisions Made

See `key-decisions` in the frontmatter above. The most notable: `createFirstOrgAndAdmin` now throws on failure (a behaviour change at the function boundary) while `bootstrapFromEnv` catches it to preserve its exact original external behaviour — this lets `ensureDemoIdentities` propagate a real, descriptive error (satisfying the plan's "throw a descriptive Error if any step fails" instruction) without weakening the headless-admin-bootstrap path's existing "never blocks server startup" guarantee.

## Deviations from Plan

### Auto-fixed Issues

None — Tasks 1 and 2 were implemented exactly as specified and all automated verification (`tsc --noEmit`, `biome check`, `pnpm build`, `docker compose config`) passed without needing any code fixes.

### Documented Finding (not fixed — pre-existing, out of this plan's scope)

**1. The critical-constraints "no third `signUpEmail` copy" check does not fully hold against the wider codebase**

- **What was checked:** `grep -rn "signUpEmail" src/ prisma/ | grep -v "src/lib/bootstrap.ts" | grep -v "src/lib/demo/identities.ts"`
- **Result:** one line — `src/app/(auth)/setup/actions.ts:45: const signUpResponse = await auth.api.signUpEmail({`
- **Why it's there:** `src/app/(auth)/setup/actions.ts` is the pre-existing, unrelated **interactive `/setup` wizard** (built in Phase 1). It lets a human choose the organization's display name and URL slug at setup time, then calls `signUpEmail` + `createOrganization` directly — a materially different contract from `createFirstOrgAndAdmin`, which hardcodes `name: "AIDA", slug: "aida"` (by explicit plan instruction: "Do not change the org name/slug"). Refactoring `/setup` to reuse `createFirstOrgAndAdmin` would either break its user-chosen-slug behaviour or require changing `createFirstOrgAndAdmin`'s signature — an architectural change to a file this plan's `files_modified` list never mentioned and its `read_first`/`action` sections never touched.
- **Scope decision:** left untouched (scope boundary — pre-existing code, unrelated write path, not part of this plan's declared files). What this task's own two identity-creation entrypoints (`prisma/seed.ts` CLI and the new `bootstrap-demo.ts` boot path) needed — a single shared module instead of two independently-drifting copies — is fully satisfied: both now call `ensureDemoIdentities()` exclusively, and neither has its own inline `signUpEmail` call.
- **Recommendation for 07-09 (security pass):** treat this as expected, not a finding — `/setup`'s call site is a legitimate, distinct, human-driven flow, not a duplicate of the demo/headless-bootstrap logic this plan consolidated.

## Issues Encountered

- **Local build environment: this machine's Avast Web Shield intercepts all outbound HTTPS from Docker containers.** `docker compose build` initially failed twice: (1) `corepack enable`'s pnpm download failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — confirmed via `docker info` (`HTTP(S) Proxy: http.docker.internal:3128`) and a host env var (`SSLKEYLOGFILE` pointing at Avast's proxy filter driver, `NODE_EXTRA_CA_CERTS` already pointing at Avast's own root cert for host-side Node processes) that this is TLS interception by local antivirus, not a real registry outage — even a bare `apk update` against Alpine's own CDN failed the same way from a fresh `node:22-alpine` container. (2) After trusting Avast's root CA for Node (`NODE_EXTRA_CA_CERTS`), `pnpm build`'s Turbopack step still failed fetching Google Fonts (`next/font/google`) — Turbopack's Rust-native HTTP client doesn't consult Node's CA list; adding `SSL_CERT_FILE` (which native-tls/OpenSSL-backed Rust clients do read) resolved it. **Both fixes were applied ONLY as a temporary, uncommitted `Dockerfile` edit** (`COPY`ing this machine's Avast cert + two `ENV` lines in the `base` stage) for the duration of this verification, then fully reverted (`git checkout -- Dockerfile`) before finishing the task — confirmed via `git diff Dockerfile` showing no changes. This is a local-machine-only workaround; the committed `Dockerfile` in this repo is unchanged and does not reference any of this.
- **My own test `.env` initially broke `docker compose up` for an unrelated, self-inflicted reason:** following this task's own guidance to generate `POSTGRES_PASSWORD` with `openssl rand -base64 32` produced a password containing a `/`, which broke the `migrate` service's constructed `DATABASE_URL` (`P1013: The provided database string is invalid. invalid port number...` — the `/` was parsed as a path separator, corrupting the host:port segment). Fixed by regenerating `POSTGRES_PASSWORD` with `openssl rand -hex 24` (alphanumeric, URL-safe) instead. This is **not a product bug** — `.env.example`'s own `POSTGRES_PASSWORD=aida` example never suggests base64, only `BETTER_AUTH_SECRET`/`RATE_LIMIT_PEPPER`/`APP_ENCRYPTION_KEY` do — but it is worth flagging as a **latent, real risk in `docker-compose.yml`**: `DATABASE_URL: postgresql://${POSTGRES_USER:-aida}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-aida}` never URL-encodes `POSTGRES_PASSWORD`, so any operator who does pick a password containing `/`, `@`, `:`, or `#` would hit the exact same failure. Logged here (not fixed — out of this plan's scope, `docker-compose.yml`'s `DATABASE_URL` construction predates this plan and isn't part of Task 1/2's declared changes) for 07-09's security/ops pass to consider (e.g., document "use only URL-safe generators" in `.env.example`/OPERATIONS.md, or percent-encode the interpolated value).
- The RTK shell-hook proxy garbled some `docker compose`/`curl` output mid-session (summarized/compacted output, or silently converting `curl -v` into a plain `curl -s`, and MSYS path-conversion mangling `-v` bind-mount paths under Git Bash) — worked around by re-running with `MSYS_NO_PATHCONV=1` for volume-mount commands and by using explicit `\curl`/`\docker` (backslash-escaped to bypass any shell function) plus `--no-log-prefix`/`-tAc` flags for clean, parseable output.

## User Setup Required

None — no external service configuration required. Demo mode is entirely self-contained (no new secrets beyond the existing `.env` template), off by default, and every credential it creates is already publicly documented in `.env.example` and `docs/OPERATIONS.md`.

## Cold-Boot Evidence (Task 3)

All commands below were run against this worktree's own `aida` Docker Compose project (`docker compose` scopes volumes/networks to the directory name, so no other environment's database was touched). `.env` was backed up before this task and restored byte-for-byte afterward; the temporary Dockerfile CA-trust patch was fully reverted (`git diff Dockerfile` empty).

**1. `docker compose build` then `docker compose up -d`** (fresh volumes, `DEMO_MODE=true`):

```
[demo] DEMO MODE IS ACTIVE. This instance auto-creates accounts with PUBLICLY DOCUMENTED credentials and loads fictional data. Never expose it to the internet or use it for real tickets.
[bootstrap] Created admin: admin@demo.aida.test
[demo] Seeded demo workspace in 2223ms: {
  contacts: 12, tags: 8, customFields: 3, kbArticles: 6, tickets: 30, messages: 80,
  internalNotes: 6, byStatus: {...}, byPriority: {...}, breached: 3, atRiskOnly: 4,
  unassigned: 8, csatResponses: 8, auditEvents: 37, insightRuns: 3
}
[demo] Sign in at / with admin@demo.aida.test (password from DEMO_ADMIN_PASSWORD, default: the documented demo password).
```

**Measured seed duration: 2223ms.** `start_period: 90s` covers this with an approximately 40x margin — no change needed (kept at 90s as planned, since real-world hosts/disks may be far slower than this dev machine).

**2. Health check:** `curl -sk https://localhost/api/health` → `{"status":"ok","db":"connected","worker":{"lastRunAt":"2026-07-31T14:44:28.124Z"}}`; `docker compose ps app` showed `Up ... (healthy)`.

**3. SQL counts** (`docker compose exec -T db psql -U aida -d aida -tAc "..."`):

| Table | Expected | Actual |
|---|---|---|
| `Ticket` | 30 | **30** |
| `Contact` | 12 | **12** |
| `KbArticle` | 6 | **6** |
| `CsatResponse` | 8 | **8** |
| `InsightRun` (`status='COMPLETED'`) | 3 | **3** |

**4. Idempotency:** `docker compose restart app`, waited for `healthy`, log showed:
```
[demo] Demo data already present (30 tickets) — skipping seed.
```
`Ticket` count re-queried immediately after: still **30**.

**5. Inertness:** `docker compose down` (volumes kept), set `DEMO_MODE=` (blank) in `.env`, `docker compose up -d` on the same volumes. Full `docker compose logs app` output after boot:
```
▲ Next.js 16.2.9
- Local:         http://localhost:3000
- Network:       http://0.0.0.0:3000
✓ Ready in 0ms
```
Zero `[demo]` lines (`grep -c "\[demo\]"` → `0`). `Ticket` count still 30 (untouched, as expected — the flag being unset means `bootstrapDemoMode` returns before even checking).

**6. Login:** `POST https://localhost/api/auth/sign-in/email` with `{"email":"admin@demo.aida.test","password":"aida-demo-2026"}` → **HTTP 200**, returned a valid session token and user object (`"email":"admin@demo.aida.test"`). The documented demo admin credentials authenticate for real.

**7. Teardown:** `docker compose down -v`. `docker ps -a` shows no `aida-*` containers (only an unrelated, pre-existing `aida-uat-greenmail` container stopped 3 weeks ago). `docker volume ls` shows zero volumes for this project. `.env` restored from its pre-task backup and the backup file deleted. `Dockerfile` reverted to its committed state. `git status --porcelain` clean except `.planning/STATE.md` (expected, from this session's init step).

## Next Phase Readiness

- AIDA-22 is now functionally complete end to end: `pnpm db:seed` (07-02) for an existing/manual install, and `DEMO_MODE=true docker compose up` (this plan) for a from-scratch instant-demo install, both go through the exact same `ensureDemoIdentities` + `seedDemoData` code paths.
- 07-08 (hero GIF) and 07-10 (README)/07-11 (docs demo walkthrough) can now record against a real `DEMO_MODE=true` boot instead of a manual `pnpm db:seed` run, if that's a smoother capture path — either produces an identical dataset.
- 07-09 (security pass) should treat demo mode as a **deliberate, documented, strictly opt-in known-credentials path** (never the default; requires an exact `"true"` string; every credential is published in `.env.example`/`docs/OPERATIONS.md`; the boot log is loud about it) — not a vulnerability to flag, but should double check: (a) the `/setup` wizard `signUpEmail` call site noted above is intentional and distinct, and (b) consider documenting the URL-unsafe-`POSTGRES_PASSWORD` latent risk noted in "Issues Encountered".
- No blockers.

---
*Phase: 07-launch-readiness*
*Completed: 2026-07-31*

## Self-Check: PASSED

All 9 created/modified files verified present on disk (`src/lib/demo/identities.ts`, `src/lib/demo/bootstrap-demo.ts`, `src/lib/bootstrap.ts`, `src/instrumentation.ts`, `prisma/seed.ts`, `docker-compose.yml`, `.env.example`, `docs/OPERATIONS.md`, this SUMMARY). Both task commit hashes (`c0ef66f`, `7e2b243`) verified present in git history.
