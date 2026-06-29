---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: awaiting-human-verification
last_updated: "2026-06-29T04:59:00Z"
last_activity: 2026-06-29
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# STATE — AIDA v1: Minimum Lovable Helpdesk

## Project Reference

**Core Value:** Ship a star-worthy, genuinely useful self-hostable AI-native helpdesk MLP whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host are the wedge.

**Milestone:** v1 — Minimum Lovable Helpdesk
**Granularity:** coarse (7 phases)
**Model profile:** balanced (Opus plans, Sonnet executes)
**License:** Apache-2.0

## Current Position

Phase: 01 (foundation) — AWAITING HUMAN VERIFICATION
Plan: 8 of 8 (01-08 checkpoint prepared — gate open)
Status: Checkpoint gate: human must run 8-step walkthrough and reply "approved" (or defect list)
Last activity: 2026-06-29

Progress: [██████████] 100% (8/8 plans in phase 01 — checkpoint pending sign-off)

## Accumulated Context

### Key Decisions

- AI-native open-source helpdesk, self-host, bring-your-own / local LLM (OpenAI/Anthropic/Ollama).
- Customer-support beachhead; generic multi-tenant core (also serves IT/ITSM).
- Apache-2.0 license.
- Single server: Next.js + Prisma + Postgres + pgvector + pg-boss + Caddy, one `docker compose up`.
- AI sequenced AFTER core helpdesk works; human-in-the-loop for customer-facing sends; citations required.
- Repo health (README/GIF/docs) is a milestone deliverable.
- Prisma 7: `url` must live in `prisma.config.ts` only (not in schema.prisma); `driverAdapters` is now stable — no previewFeatures needed.
- Better Auth `Organization` IS the workspace; all domain tables carry `organizationId`. `Setting` = org-scoped, `SystemSetting` = global.
- Generated client import path: `@/generated/prisma/client` (never `@prisma/client`). `prisma generate` must run in CI before build.
- `auth.ts` must always use bare `prisma` (never `scopedDb`) — BA models lack `organizationId`.
- `scopedDb(orgId)` via Prisma `$extends` with DOMAIN_MODELS=["Setting"] allowlist — injects organizationId into 9 operation hooks; Better Auth models never touched.
- Session property path: `session.session.activeOrganizationId` — outer `.session` is getSession return; inner `.session` is the DB record.
- Node 22 required for Testcontainers (undici@8 / testcontainers@12); use `volta run --node 22 pnpm test:integration`.
- `getScopedDb()` is the standard pattern for all protected Server Components: `const { db, orgId } = await getScopedDb();`.
- pg-boss 12.x: named export `{ PgBoss }` (no default); work handler receives `Job[]` array — use `([job]: Job[]) =>` destructuring; `schedule()` is idempotent.
- pg-boss v12 explicit queue creation: `boss.createQueue(name)` BEFORE `boss.work()` / `boss.schedule()` — v12 removed implicit queue creation; idempotent on restart.
- Worker uses relative imports only (no `@/`) for esbuild bundling. Health route uses `@/lib/db` (Next.js webpack handles it).
- `SystemSetting['heartbeat:lastRunAt']` = ISO-8601 string written by worker, read by `GET /api/health` to report liveness.
- Middleware uses `getSessionCookie` (edge-safe, no Prisma); redirects unauthenticated (app) routes to `/login`; allows `/login`, `/setup`, `/api/auth/*`, `/api/health`.
- Better Auth system action: pass `userId` to `createOrganization` body (no session headers) to bypass `allowUserToCreateOrganization: false`; creator auto-gets `"owner"` role.
- `activeOrganizationId` set at login via `databaseHooks.session.create.before` — no explicit `setActiveOrganization` call needed in setup flow.
- Setup wizard: Server Action calls `auth.api.signUpEmail` then `auth.api.createOrganization({ userId })`; marks `SystemSetting.setupComplete`; self-disables on any existing user.
- Login: no public register or Forgot Password; bad-creds shown inline; success redirects to `/tickets`.
- scopedDb findFirst+create/update pattern for domain models with compound unique keys: scopedDb's upsert hook injects `organizationId` into the top-level `where` which Prisma rejects for upsert (not a unique identifier); use `findFirst` (auto-scoped) + conditional `update`-by-id / `create` (orgId auto-injected).
- App shell: `(app)/layout.tsx` calls `requireSession()` (AIDA-10 server-side); `activeOrganizationId` null-guard shows fallback message; Sidebar + TopBar are Client Components using `usePathname()`.
- `resolvedTheme` (not `theme`) from next-themes: correctly handles `"system"` theme value; always resolves to `"light"` or `"dark"`.
- Docker one-command self-host: one runner image for app+worker (compose CMD override); esbuild `--format=esm` for worker (Prisma 7 generated client uses import.meta.url — CJS makes it undefined); `@prisma/client` external from esbuild + copied from pnpm virtual store (`cp -rL .pnpm/@prisma+client@.../node_modules/@prisma /tmp/`) to get `client-runtime-utils` alongside; Alpine healthcheck uses `127.0.0.1` not `localhost` (IPv6 resolution mismatch).
- `better-call@1.3.7` lockfile override required: `better-auth@1.6.22` needs `kAPIErrorHeaderSymbol` export (added in 1.3.7); Turbopack catches missing export at `next build` time even though `next dev` works.
- Pages that read DB at request time (`/setup`, `/login`) must have `export const dynamic = "force-dynamic"` to prevent static prerender during `next build`.
- DATABASE_URL build arg with placeholder for `prisma generate` in Docker: `prisma.config.ts` calls `env("DATABASE_URL")` at module load → even generate (no DB connection) fails without it.

### Open Todos

- Human acceptance gate (01-08): run 8-step walkthrough (http://localhost) and reply "approved" or defect list.

### Blockers

None.

## Session Continuity

**Last action:** Plan 01-08 checkpoint prepared — human acceptance gate checklist (steps 1-8) presented. Stack is up via Plan 07's `docker compose up`. Awaiting human walkthrough sign-off.

**Next action:** Human runs 8-step walkthrough at http://localhost and replies "approved" or lists failing steps. If approved → `/gsd:verify-work` then `/gsd:plan-phase 2`. If defects → `/gsd:plan-phase 1 --gaps`.

**Critical context for next session:**

- **Auth:** Better Auth (Prisma adapter + database sessions + organization plugin + admin plugin). Better Auth's `Organization` IS the workspace — no separate Workspace model. All domain tables carry `organizationId`.
- **Bootstrap:** Setup wizard (/setup, first-run, self-disables) + env-var escape hatch.
- **Docker:** Two services (app + worker) from one shared image. Caddy in Phase 1. `pgvector/pgvector:pg16`. Node 22 LTS, pnpm, Next.js standalone output.
- **Testing:** Vitest + Biome. Workspace isolation = real Postgres integration test (Testcontainers).
- **pgvector:** Extension only in Phase 1 — no vector columns. Embedding dimension deferred to Phase 5 (model-agnostic).
- **UI:** Full app shell + stub pages ("full shell, empty rooms"). No public register page.
- **AI:** Zero LLM code in Phase 1. Only `aiEnabled` toggle in workspace settings. `lib/llm/` is Phase 4.
- Single-server only; pg-boss (no Redis); pgvector in the same Postgres.

---
*Last updated: 2026-06-29 — Plan 01-08 checkpoint gate open: human acceptance walkthrough (steps 1-8) prepared; stack running via docker compose up; awaiting sign-off.*
