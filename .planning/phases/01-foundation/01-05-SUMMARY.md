---
phase: 01-foundation
plan: "05"
subsystem: auth
tags: [better-auth, next-js, middleware, edge-runtime, setup-wizard, bootstrap, credentials-login]

# Dependency graph
requires:
  - phase: 01-foundation/01-02
    provides: "auth (betterAuth with organization + admin plugins, signUpEmail, createOrganization, databaseHooks.session.create.before), prisma (bare client, SystemSetting model), authClient (signIn.email)"

provides:
  - Edge-safe middleware (src/middleware.ts) gates all (app) routes via getSessionCookie; no Prisma in edge bundle
  - Self-disabling first-run setup wizard (src/app/(auth)/setup/) that creates org + admin with "owner" role, then locks
  - Server Action completeSetup: signUpEmail + createOrganization (system action via userId) + SystemSetting setupComplete
  - Idempotent env-var headless bootstrap (src/lib/bootstrap.ts, ADMIN_EMAIL + ADMIN_PASSWORD + ADMIN_NAME)
  - Next.js instrumentation hook (src/instrumentation.ts) calling bootstrapFromEnv at server start
  - Credentials login page (src/app/(auth)/login/) redirecting fresh instances to /setup; "use client" form with inline errors
  - Pre-auth layout (src/app/(auth)/layout.tsx) centering children min-h-screen
  - AIDA-10 unit tests (tests/unit/middleware.test.ts) — 5 tests covering redirect + passthroughs

affects: [06-app-shell, 07-docker, 08-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Better Auth system action pattern: pass `userId` in createOrganization body without session; bypasses allowUserToCreateOrganization: false; creator gets 'owner' role automatically"
    - "Edge-safe middleware: uses getSessionCookie from better-auth/cookies ONLY; no Prisma import; authoritative checks (zero-users, session) deferred to Node Server Components"
    - "activeOrganizationId auto-set at login: databaseHooks.session.create.before in auth.ts populates from user's first membership — no explicit setActiveOrganization call needed in setup flow"
    - "Setup self-disable: Server Component counts users; if > 0 redirects to /login — DB is the authoritative gate"
    - "Login self-bootstrap detection: Server Component counts users; if === 0 redirects to /setup"
    - "Env bootstrap idempotency: checks user count > 0 before any writes; NEVER logs the password"

key-files:
  created:
    - src/middleware.ts
    - src/app/(auth)/layout.tsx
    - src/app/(auth)/setup/page.tsx
    - src/app/(auth)/setup/setup-form.tsx
    - src/app/(auth)/setup/actions.ts
    - src/lib/bootstrap.ts
    - src/instrumentation.ts
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/login/login-form.tsx
    - tests/unit/middleware.test.ts
  modified: []

key-decisions:
  - "setActiveOrganization NOT called in setup: user redirects to /login immediately after setup; databaseHooks.session.create.before auto-populates activeOrganizationId at login from first membership — calling it without a session would require additional API surface"
  - "createOrganization system action: pass userId in body (no session) to bypass allowUserToCreateOrganization: false; Better Auth source confirms !session && body.userId is treated as isSystemAction and allowed"
  - "Creator role: createOrganization assigns role = orgOptions.creatorRole || 'owner' — admin is org owner by default, no extra role assignment needed"
  - "Better Auth signUpEmail returns { user: { id, ... }, token } — user.id used immediately for org creation without needing a separate lookup"

patterns-established:
  - "Auth flow pattern: /setup creates first org+admin and redirects to /login; /login authenticates and redirects to /tickets"
  - "Auth gate pattern: middleware (edge, cookie-only) + Server Component DB count check (Node runtime, authoritative)"
  - "Bootstrap pattern: bootstrapFromEnv() is idempotent — safe to call at every server start"
  - "Server Action pattern for auth: use auth.api methods directly (no fetch); errors returned as { error: string } result"

requirements-completed: [AIDA-10]

# Metrics
duration: ~35min
completed: "2026-06-29"
---

# Phase 01 Plan 05: Auth UI + First-Run Setup Wizard Summary

**Edge middleware (getSessionCookie, no Prisma) gates all (app) routes; self-disabling /setup wizard creates first org+admin via Better Auth system action; /login credentials form with inline errors; idempotent env-var bootstrap at server start — no default creds, no public register.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Edge-safe `src/middleware.ts` enforces auth on all `(app)` routes via `getSessionCookie` (no Prisma import; AIDA-10); 5 unit tests covering redirect and passthroughs
- Self-disabling `/setup` wizard (Server Component + client form + Server Action) creates the first organization + admin with `"owner"` role using Better Auth's `createOrganization` system-action pattern (userId in body, no session); marks `SystemSetting.setupComplete = true`; redirects to `/login?setup=complete`
- Idempotent `bootstrapFromEnv()` in `src/lib/bootstrap.ts` reads `ADMIN_EMAIL` + `ADMIN_PASSWORD` + `ADMIN_NAME`; short-circuits if env vars absent or users already exist; called at server start via `src/instrumentation.ts`
- Credentials `/login` page redirects fresh instances to `/setup`; client form calls `authClient.signIn.email` with inline bad-creds error (not toast); shows success toast on `?setup=complete`; no "Forgot password", "Create account", or social login (D-23)

## Task Commits

1. **Task 1: Edge middleware + AIDA-10 unit tests (TDD)** - `24f7fa6` (feat)
2. **Task 2: Setup wizard + env-var bootstrap** - `5e4cc42` (feat)
3. **Task 3: Credentials login page + form** - `91b42b3` (feat)

## Files Created/Modified

- `src/middleware.ts` - Edge-safe auth gate: `getSessionCookie` → redirect /login for (app) routes; passthroughs for /login /setup /api/auth /api/health; no Prisma
- `src/app/(auth)/layout.tsx` - Pre-auth centered layout (min-h-screen flex items-center justify-center)
- `src/app/(auth)/setup/page.tsx` - Server Component: counts users, redirects to /login when > 0; renders SetupForm in Card
- `src/app/(auth)/setup/setup-form.tsx` - "use client" form: org name, URL slug (auto-derived with 300ms debounce, editable), admin name, email, password, confirm password; zod validation; calls `completeSetup`; toast on server error; "Create workspace" CTA with Loader2
- `src/app/(auth)/setup/actions.ts` - "use server": `completeSetup` validates with zod, race-guards on user count, calls `auth.api.signUpEmail` + `auth.api.createOrganization({ userId })` (system action), sets `SystemSetting.setupComplete`, redirects to `/login?setup=complete`
- `src/lib/bootstrap.ts` - Exports `bootstrapFromEnv()`: idempotent env-var bootstrap; same creation sequence as completeSetup; `console.info("[bootstrap] Created admin: <email>")`; NEVER logs password
- `src/instrumentation.ts` - Next.js startup hook: `register()` guarded on `NEXT_RUNTIME === "nodejs"` with dynamic import of `bootstrapFromEnv`
- `src/app/(auth)/login/page.tsx` - Server Component: counts users, redirects to /setup when === 0; passes `showSetupComplete` flag from searchParams; renders LoginForm in Card with heading "Sign in to AIDA"
- `src/app/(auth)/login/login-form.tsx` - "use client": `authClient.signIn.email` call; inline bad-creds error "Invalid email or password. Please check your credentials and try again."; sonner success toast on mount for setup-complete; redirects to /tickets on success; "Sign in" CTA with Loader2; NO Forgot password / Create account / social links
- `tests/unit/middleware.test.ts` - 5 tests: redirect to /login (no cookie), passthrough /login, passthrough /api/health, passthrough /setup, passthrough /api/auth/callback

## Better Auth API Reference (for Plan 06+)

| Method | Call Signature | Notes |
|--------|----------------|-------|
| `auth.api.signUpEmail` | `{ body: { name, email, password } }` | Returns `{ user: { id, email, name, ... }, token }` |
| `auth.api.createOrganization` | `{ body: { name, slug, userId } }` | `userId` = system action; bypasses `allowUserToCreateOrganization: false`; creator gets `"owner"` role |
| `authClient.signIn.email` | `({ email, password }, { throw: false })` | Returns `{ data, error }`; `error.status` 401/403 for bad creds |
| `getSessionCookie` | `(request: NextRequest)` | Edge-safe, no DB; from `better-auth/cookies` |

## activeOrganizationId Population

`activeOrganizationId` is NOT set during setup. It is set at login time via `databaseHooks.session.create.before` in `src/lib/auth.ts`:
```ts
const member = await prisma.member.findFirst({ where: { userId: session.userId } });
return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
```
This means Plan 06 (app shell) can rely on `activeOrganizationId` being populated in any session created after login.

## Redirect Target

`/login` → redirects to `/tickets` after successful sign in. Plan 06 must implement the `(app)/tickets` route.

## Decisions Made

- `setActiveOrganization` omitted from setup flow: user redirects to `/login` immediately; `databaseHooks.session.create.before` auto-sets it at sign-in. Calling it without a session would require a session token from the signup, complicating the flow with no end-user benefit.
- `createOrganization` called as a system action (userId in body, no session headers): confirmed against Better Auth 1.6.22 source — `!session && body.userId` is treated as `isSystemAction`, bypassing the `allowUserToCreateOrganization: false` restriction.
- Creator role is `"owner"` by default (`orgOptions.creatorRole || "owner"`) — confirmed in crud-org.mjs; no extra role assignment needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome format corrections**
- **Found during:** Post-task verification (biome check)
- **Issue 1:** `src/app/(auth)/layout.tsx` — JSX return with wrapping parens formatted to single-line per biome's line-width rules
- **Issue 2:** `src/app/(auth)/login/login-form.tsx` — long `if` condition formatted to multi-line; long string message inlined
- **Fix:** Applied biome-suggested formatting inline before commit
- **Files modified:** `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/login-form.tsx`
- **Verification:** `biome check` exits 0 after fix

**2. [Rule 3 - Blocking] Prisma client generation required in worktree**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `src/generated/prisma/` is gitignored; after merging master into the worktree branch, the generated client was absent. TypeScript reported `Cannot find module '@/generated/prisma/client'`.
- **Fix:** Ran `DATABASE_URL=postgresql://aida:aida@localhost:5432/aida prisma generate` in the worktree to regenerate the client (this only generates type definitions, no DB connection needed at runtime)
- **Verification:** `tsc --noEmit` exits 0
- **Note:** This is standard workflow for gitignored generated files; Docker builds must also run `pnpm prisma generate` before Next.js build step

**3. [Rule 3 - Blocking] pnpm exec not available in worktree (no local node_modules)**
- **Found during:** Task 1 (TDD RED phase)
- **Issue:** Worktree has `package.json` and `pnpm-lock.yaml` but no `node_modules/` (node_modules are in the main project at `/d/Aff/proj/aida/node_modules/`). `pnpm exec vitest` fails with "Command vitest not found".
- **Fix:** Used `node /d/Aff/proj/aida/node_modules/vitest/vitest.mjs run` and `node /d/Aff/proj/aida/node_modules/typescript/bin/tsc` directly
- **Verification:** Tests run and pass; TypeScript check runs cleanly

**4. [Rule 1 - Bug / Plan Adaptation] setActiveOrganization omitted from setup action**
- **Found during:** Task 2 (Server Action implementation)
- **Issue:** Plan specifies calling `auth.api.setActiveOrganization({ body: { organizationId }, headers })` in the setup action. However: (a) in the setup flow there is no existing session (user redirects to /login after setup); (b) `signUpEmail` creates a session but setup immediately redirects away; (c) calling `setActiveOrganization` would require threading the session token through the action
- **Fix:** Omitted the explicit call. `databaseHooks.session.create.before` in `auth.ts` already populates `activeOrganizationId` from the user's first membership at login time — same outcome, simpler implementation. Confirmed by reading Better Auth source.
- **Impact:** None. `activeOrganizationId` is correctly populated at the first login after setup.

---

**Total deviations:** 4 (2 Rule 1 bugs/adaptations, 2 Rule 3 blockers)
**Impact on plan:** All fixes necessary for correctness or environment constraints. Core objectives fully achieved.

## Issues Encountered

- pnpm exec not available in git worktree (no node_modules) — used direct node invocation of vitest.mjs and tsc
- Prisma generated client not in worktree (gitignored) — regenerated with dummy DATABASE_URL

## Known Stubs

None. All files implement real functionality:
- Middleware performs real auth gate (no hardcoded bypass)
- Setup form calls real Server Action that creates user + org in DB
- Login form calls real `authClient.signIn.email`
- Bootstrap reads real env vars

## User Setup Required

None for this plan. However, for the setup wizard to actually work end-to-end (Plan 07/08 validation):
- `DATABASE_URL` pointing to a running Postgres 16 + pgvector instance
- `BETTER_AUTH_SECRET` (random 32-byte string)
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` (app base URL)
See `.env.example` for the full list.

## Next Phase Readiness

- **Plan 06 (App shell):** `/tickets` is the post-login redirect target; `(auth)/layout.tsx` is ready; `authClient` for session checks is available
- **Plan 07 (Docker):** `src/instrumentation.ts` + `bootstrapFromEnv()` are ready for `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` env vars in `docker-compose.yml`
- **Plan 08 (E2E):** Fresh instance → `/setup` → create workspace → `/login` (toast) → sign in → `/tickets` flow is fully implemented

---

## Self-Check

- `src/middleware.ts` — FOUND, contains getSessionCookie, redirects to /login
- `src/app/(auth)/layout.tsx` — FOUND
- `src/app/(auth)/setup/page.tsx` — FOUND, contains `userCount > 0` redirect
- `src/app/(auth)/setup/setup-form.tsx` — FOUND, contains "use client", slug regex, "Create workspace"
- `src/app/(auth)/setup/actions.ts` — FOUND, contains "use server", signUpEmail, createOrganization, setupComplete
- `src/lib/bootstrap.ts` — FOUND, exports bootstrapFromEnv, checks user count, never logs password
- `src/instrumentation.ts` — FOUND, exports register, calls bootstrapFromEnv, guarded on nodejs runtime
- `src/app/(auth)/login/page.tsx` — FOUND, redirects to /setup when userCount === 0, heading "Sign in to AIDA"
- `src/app/(auth)/login/login-form.tsx` — FOUND, contains "use client", signIn.email, "Invalid email or password.", "Sign in"; no register/social links
- `tests/unit/middleware.test.ts` — FOUND, 5 tests covering redirect + passthroughs
- Commits 24f7fa6, 5e4cc42, 91b42b3 — all in git log

## Self-Check: PASSED

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
