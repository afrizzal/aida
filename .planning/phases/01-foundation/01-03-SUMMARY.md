---
phase: 01-foundation
plan: "03"
subsystem: database
tags: [prisma, scoped-db, testcontainers, vitest, multi-tenant, organization, session, better-auth]

# Dependency graph
requires:
  - phase: 01-foundation/01-02
    provides: "prisma + Better Auth backbone; Setting domain model with organizationId; auth.ts with activeOrganizationId hook; src/lib/db.ts bare prisma export"

provides:
  - "scopedDb(orgId): Prisma $extends client that auto-injects organizationId into all DOMAIN_MODELS queries (findMany/findFirst/count/create/update/updateMany/upsert/delete/deleteMany)"
  - "DOMAIN_MODELS = [\"Setting\"] constant — append future org-scoped models here (Ticket, Contact, ...)"
  - "Session helpers: getCurrentSession / requireSession (redirect to /login) / getScopedDb (session -> orgId -> scopedDb)"
  - "Real-Postgres integration test harness (Testcontainers pgvector:pg16 + migrate deploy) proving AIDA-11 workspace isolation"
  - "vitest.integration.config.ts — separate integration test config with globalSetup + @ alias"

affects: [04-worker, 05-auth-ui, 06-app-shell, 07-docker, 08-e2e]

# Tech tracking
tech-stack:
  added:
    - "@testcontainers/postgresql@12.0.3 (Testcontainers Node.js driver for pgvector integration tests)"
    - "volta node pin 22.23.1 (testcontainers@12 / undici@8 require Node >=22; pinned in package.json)"
  patterns:
    - "Prisma $extends query.$allModels pattern: use model-name allowlist (DOMAIN_MODELS) to guard Better Auth model collision (Pitfall 1)"
    - "$allModels args cast: args typed as union in $allModels context — use (args as any).where/data for injection"
    - "Integration test pattern: Testcontainers globalSetup + pnpm prisma migrate deploy + pnpm prisma generate against fresh pgvector container"
    - "Run integration tests with Node 22: volta run --node 22 pnpm test:integration (testcontainers@12 incompatible with Node 20)"
    - "Better Auth organization seeding: id and createdAt have no @default — must be provided explicitly in tests (randomUUID() + new Date())"
    - "getScopedDb() usage: const { db, session, orgId } = await getScopedDb(); in Server Components/Actions"
    - "Session shape: auth.api.getSession returns { session: { activeOrganizationId: string | null }, user } | null"

key-files:
  created:
    - src/lib/scoped-db.ts
    - src/lib/session.ts
    - vitest.integration.config.ts
    - tests/integration/global-setup.ts
    - tests/integration/workspace-isolation.test.ts
  modified:
    - package.json (added volta node pin 22.23.1 for testcontainers Node 22 requirement)

key-decisions:
  - "DOMAIN_MODELS allowlist (not blocklist): DOMAIN_MODELS=[\"Setting\"] — only inject organizationId for explicitly listed models; Better Auth models excluded because they lack organizationId field"
  - "args as any in $allModels: Prisma 7 types the $allModels args as a union of all model arg types; the union doesn't narrow to domain model types so (args as any).where is the clean injection pattern"
  - "Session path: session.session.activeOrganizationId — auth.api.getSession returns { session: DbSession, user: DbUser }; the nested session.activeOrganizationId is the BA session record field set by databaseHooks"
  - "Node 22 required for integration tests: testcontainers@12 depends on undici@8 which requires Node >=22 for webidl.util.markAsUncloneable; pinned via volta in package.json"
  - "Better Auth org seeding in tests: organization.id and organization.createdAt have no Prisma @default (BA manages them), so tests must provide id: randomUUID() + createdAt: new Date()"

patterns-established:
  - "Domain data access: import scopedDb from @/lib/scoped-db; call scopedDb(orgId) for all DOMAIN_MODELS queries; never use bare prisma for domain data"
  - "Server Component auth: import getScopedDb from @/lib/session; const { db, orgId } = await getScopedDb(); for protected pages that need domain data"
  - "Integration test command: volta run --node 22 pnpm test:integration (Node 22 required)"
  - "DOMAIN_MODELS extension: when adding new org-scoped models (Ticket, Contact, ...) in future phases, append the Prisma model name (PascalCase) to DOMAIN_MODELS in src/lib/scoped-db.ts"

requirements-completed: [AIDA-11]

# Metrics
duration: ~40min
completed: "2026-06-29"
---

# Phase 01 Plan 03: Scoped-DB + Session Helpers Summary

**Prisma $extends client (scopedDb) with DOMAIN_MODELS=["Setting"] allowlist auto-injecting organizationId into all domain queries, verified by a never-mocked two-workspace Testcontainers integration test (AIDA-11), bridged to sessions via getScopedDb().**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3 (TDD: 1 RED + 1 GREEN + 1 session helpers)
- **Files modified:** 6

## Accomplishments

- `scopedDb(orgId)` Prisma `$extends` client: injects `organizationId: orgId` into 9 operation hooks (findMany/findFirst/count/create/update/updateMany/upsert/delete/deleteMany) for DOMAIN_MODELS only — Better Auth tables never touched
- AIDA-11 proven: real Postgres integration test seeds two organizations and asserts zero cross-tenant reads plus automatic organizationId injection on create — never mocked
- Session bridge: `getScopedDb()` reads `session.session.activeOrganizationId` and returns `{ db, session, orgId }` for Server Components and Server Actions; throws when no active org is set
- Testcontainers integration harness: pgvector:pg16 container starts fresh for each test run, `pnpm prisma migrate deploy` applies the committed migration, tests clean up with container teardown

## Task Commits

1. **Task 1: Integration test harness + failing AIDA-11 isolation test (RED)** - `5370e2d` (test)
2. **Task 2: Implement scopedDb(orgId) — AIDA-11 GREEN** - `e1f4396` (feat)
3. **Task 3: Session helpers — getCurrentSession / requireSession / getScopedDb** - `ef2ea5a` (feat)

## Model Name in $allModels Extension

The Prisma `$allModels` query handler receives `model` as the **PascalCase model name** matching the schema definition. For `model Setting`, the name is `"Setting"`. The DOMAIN_MODELS allowlist uses this exact casing: `["Setting"] as const`. Future models must also use PascalCase matching their `model ModelName {}` block in schema.prisma.

## Session Property Path

`auth.api.getSession({ headers: await headers() })` returns `{ session: DbSession, user: DbUser } | null`. The active org is at `session.session.activeOrganizationId` — the outer `.session` is the returned object; the inner `.session` is the database session record populated by `databaseHooks.session.create.before` in `src/lib/auth.ts`.

## Integration Test Runtime

| Phase | Timing |
|-------|--------|
| Testcontainers container start (pgvector:pg16) | ~20–25s |
| pnpm prisma migrate deploy | ~2–4s |
| pnpm prisma generate | ~0.5–1.5s |
| Test execution (2 tests) | ~0.3s |
| **Total** | **~25–35s** |

Container starts once per `pnpm test:integration` invocation (globalSetup lifecycle). Tests run against a fresh database with no cleanup overhead — each test uses unique org slugs to avoid @@unique constraint collisions.

## getScopedDb() Usage Pattern (for Plan 06 and future)

```ts
// In a Server Component or Server Action (protected route):
import { getScopedDb } from "@/lib/session";

export default async function MyPage() {
  const { db, session, orgId } = await getScopedDb();
  // db is already scoped to the session's active org
  const settings = await db.setting.findMany();
  // ...
}
```

`getScopedDb()` automatically:
1. Gets the session via `auth.api.getSession`
2. Redirects to `/login` if unauthenticated
3. Throws if `activeOrganizationId` is null (user must call `authClient.organization.setActive` first)
4. Returns a `scopedDb` bound to the org — all domain queries are automatically tenant-scoped

## Files Created/Modified

- `src/lib/scoped-db.ts` — `scopedDb(orgId)` Prisma `$extends` with DOMAIN_MODELS allowlist; exports `scopedDb` and `DOMAIN_MODELS`
- `src/lib/session.ts` — `getCurrentSession`, `requireSession`, `getScopedDb` session bridge helpers; server-only (uses next/headers)
- `vitest.integration.config.ts` — Integration vitest config: `include: tests/integration/**/*.test.ts`, `globalSetup`, `hookTimeout: 120_000`, `@` alias
- `tests/integration/global-setup.ts` — Testcontainers lifecycle: start pgvector:pg16, set DATABASE_URL, run migrate deploy + generate, teardown
- `tests/integration/workspace-isolation.test.ts` — 2-test AIDA-11 suite: read isolation (orgA never sees orgB rows) + create auto-inject (organizationId injected without being passed)
- `package.json` — Added `"volta": { "node": "22.23.1" }` (testcontainers@12 requires Node >=22)

## Decisions Made

- **DOMAIN_MODELS allowlist not blocklist:** Safer to explicitly list known domain models than to exclude BA models. New domain models (Ticket, Contact, etc.) get tenant safety by default when added to the list. Accidental omission produces a broken test, not a data leak.
- **`(args as any)` in $allModels:** Prisma 7 types `$allModels` args as a union of all model args. The union lacks domain-specific fields like `organizationId`, so narrowing via `as any` is unavoidable. The allowlist guard (`isDomain(model)`) ensures only domain-model queries are modified.
- **Volta Node 22 pin:** `testcontainers@12` uses `undici@8` which calls `webidl.util.markAsUncloneable` — only available in Node >=22. Pinned in `package.json volta.node`; integration tests must be run with `volta run --node 22 pnpm test:integration` until pnpm respects the pin in subprocess execution.
- **Better Auth org fields in integration tests:** BA's `organization` model has no `@default()` on `id` or `createdAt` — BA manages these at auth layer. Test helper `makeOrgData(name, slug)` provides `id: randomUUID(), createdAt: new Date()` for direct DB seeding.
- **Type cast for auto-inject test:** Setting.organizationId is required by schema type but intentionally omitted to verify runtime injection. Typed as `(db.setting.create as (a: { data: Record<string, unknown> }) => Promise<{ organizationId: string }>)` to allow omission while keeping tsc clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Better Auth organization model requires id + createdAt in tests**
- **Found during:** Task 2 (initial tsc --noEmit run)
- **Issue:** TypeScript errors TS2322: `{ name: string; slug: string; }` missing `id` and `createdAt` from `organizationCreateInput`. The BA organization model uses `id String @id` (no @default) because Better Auth generates these at the auth layer. The plan's test template seeded orgs with just name+slug.
- **Fix:** Added `makeOrgData(name, slug)` helper returning `{ id: randomUUID(), name, slug, createdAt: new Date() }`. Updated all organization.create calls in the test.
- **Files modified:** `tests/integration/workspace-isolation.test.ts`
- **Verification:** `pnpm exec tsc --noEmit` exits 0.
- **Committed in:** `e1f4396` (Task 2 commit)

**2. [Rule 1 - Bug] Typed create args for auto-inject test**
- **Found during:** Task 2 (tsc --noEmit after fixing org fields)
- **Issue:** TypeScript TS2322: `{ key: string; value: string; }` missing required `organizationId` and `organization` relation from `SettingCreateInput`. The test intentionally omits `organizationId` to prove the extension injects it — correct behavior but TypeScript can't see the runtime injection.
- **Fix:** Type-cast the `db.setting.create` call to accept `{ data: Record<string, unknown> }` while keeping the return type as `{ organizationId: string }`. Added explanatory comment documenting why organizationId is intentionally omitted.
- **Files modified:** `tests/integration/workspace-isolation.test.ts`
- **Verification:** `pnpm exec tsc --noEmit` exits 0; `pnpm test:integration` green (extension actually injects the orgId at runtime).
- **Committed in:** `e1f4396` (Task 2 commit)

**3. [Rule 3 - Blocking] Node.js 22 required for testcontainers — Volta pin + pnpm install**
- **Found during:** Task 1 (first pnpm test:integration run)
- **Issue 1:** `testcontainers@12` depends on `undici@8` which uses `webidl.util.markAsUncloneable` — only available in Node >=22 (`TypeError: webidl.util.markAsUncloneable is not a function`). Worktree ran on Node 20 (Volta default).
- **Issue 2:** `pnpm exec prisma` failed in worktree because the worktree had no `node_modules` (pnpm virtual store resolution doesn't traverse git worktree parent by default).
- **Fix:** Ran `pnpm install` to create local `node_modules` in the worktree. Ran `volta pin node@22` to pin Node 22.23.1 in `package.json`. Integration tests must be invoked as `volta run --node 22 pnpm test:integration` until pnpm subprocess inheritance is resolved.
- **Files modified:** `package.json` (volta field added), `node_modules/` created (gitignored)
- **Verification:** `volta run --node 22 pnpm test:integration` exits 0 with 2 tests passing.
- **Committed in:** `5370e2d` (Task 1 commit — volta pin in package.json)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocker)
**Impact on plan:** All fixes necessary for TypeScript correctness and unblocking integration tests. No scope creep. Core objectives (scopedDb + isolation test + session bridge) fully achieved.

## Issues Encountered

- **testcontainers + Node 20 incompatibility:** `testcontainers@12.0.3` / `undici@8.5.0` requires Node >=22 for `webidl.util.markAsUncloneable`. Must use `volta run --node 22 pnpm test:integration`. The volta pin in `package.json` should help once pnpm properly inherits it in subprocess execution.
- **pnpm exec in git worktree:** pnpm doesn't find `node_modules` when run from a git worktree subdirectory; `pnpm install` in the worktree resolved this. The installed `node_modules` is gitignored.

## Known Stubs

None. All files are fully implemented and wired.

- `src/lib/scoped-db.ts` — real Prisma `$extends` implementation, not a stub
- `src/lib/session.ts` — real Better Auth session integration, not a stub
- Integration tests — real assertions against Testcontainers Postgres, not mocked

## User Setup Required

None for this plan. However, to run integration tests:
```bash
# Requires Docker + Node 22
volta run --node 22 pnpm test:integration
```

## Next Phase Readiness

- **Plan 04 (pg-boss worker):** `prisma.systemSetting` is available via bare `prisma` from `@/lib/db`; heartbeat job can write `prisma.setting.upsert({ where: { organizationId_key: ... }, data: { value: ... } })` (but heartbeat uses `systemSetting` which is global, not scoped)
- **Plan 05 (Auth UI):** `getCurrentSession`, `requireSession` ready for login page and middleware; `getScopedDb` ready for settings page and setup wizard
- **Plan 06 (App shell):** `getScopedDb()` is the standard pattern for all protected Server Components; `DOMAIN_MODELS` is ready for extension (add "Ticket" etc. as new models are introduced)
- **Future phases:** Append new org-scoped model names to `DOMAIN_MODELS` in `src/lib/scoped-db.ts` — they automatically get full tenant isolation across all 9 operation hooks

---

## Self-Check: PASSED

- `vitest.integration.config.ts` — FOUND, contains globalSetup
- `tests/integration/global-setup.ts` — FOUND, contains PostgreSqlContainer and migrate deploy
- `tests/integration/workspace-isolation.test.ts` — FOUND, contains scopedDb, two organizations, cross-tenant assertions
- `src/lib/scoped-db.ts` — FOUND, exports scopedDb and DOMAIN_MODELS, contains organizationId injection and isDomain allowlist
- `src/lib/session.ts` — FOUND, exports getCurrentSession, requireSession, getScopedDb; contains activeOrganizationId and redirect("/login")
- `package.json` — FOUND, contains volta.node = 22.23.1
- Commits `5370e2d`, `e1f4396`, `ef2ea5a` — all confirmed in git log

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
