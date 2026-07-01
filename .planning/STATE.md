---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: phase-2-planned
last_updated: "2026-07-02T00:00:00Z"
last_activity: 2026-07-02
progress:
  total_phases: 7
  completed_phases: 1
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

Phase: 02 (core-ticketing) — 🟢 PLANNED (ready to execute)
Plan: Phase 1 complete (8/8); Phase 2 planned — 12 plans across 5 waves.
Status: Phase 2 planning complete. gsd-planner (Opus) produced 12 plans (02-01..02-12, 5 waves); gsd-plan-checker (Sonnet) ran 3 verification passes (max iterations) — 0 blockers throughout, all 9 requirement IDs (AIDA-01..08, AIDA-12 partial) covered. Fixed during revision: `changePriority` now clears stale SLA flags on downgrade, `ticket-list-panel.tsx` added to 02-08 frontmatter, `Message.triggeredReopen` column + end-to-end `ThreadSystemEvent` wiring (plan 01 → 09 → 12), `searchTickets` limit threading in 02-08. User force-proceeded past 3 remaining low-risk warnings (organizationId omitted in some illustrative create() calls — self-correcting via each task's tsc verify gate; "New Ticket" CTA placement ambiguous between plans 08/09 — watch during execution for zero-ticket cold-start reachability; plans 07/09 are file-count-heavy but judged justified). Next: /gsd:execute-phase 2.
Last activity: 2026-07-02

Progress: [██████████] 100% (8/8 plans in phase 01 — verified via conversational UAT)

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

- Execute Phase 2: `/gsd:execute-phase 2`. 12 plans ready across 5 waves (02-01/02 → 02-03..07 → 02-08/10/11 → 02-09 → 02-12).
- Watch during execution: "New Ticket" CTA must land in the inbox top bar (plan 08 territory) so a zero-ticket workspace has an agent-reachable creation path — plan 09's task text left this ambiguous ("list panel header or reading-pane header"); the reading-pane-only option would break cold start.
- Watch during execution: a few illustrative `create()`/`upsert()` snippets in 02-01/02-03/02-09 omit explicit `organizationId` — each task's `tsc --noEmit` verify gate will force the fix, but the 02-01 tenant-in-tx smoke test specifically should use `workspace-isolation.test.ts`'s type-cast pattern rather than passing `organizationId` explicitly, or it stops proving auto-injection.

### Blockers

None.

## Session Continuity

**Last action:** Phase 2 `/gsd:plan-phase 2` complete. `gsd-planner` (Opus) produced 12 plans (02-01..02-12) in 5 waves, reusing existing `02-CONTEXT.md`/`02-RESEARCH.md`/`02-UI-SPEC.md` (research + UI gates both skipped since artifacts existed). `gsd-plan-checker` (Sonnet) ran 3 verification passes (max iterations reached): pass 1 found 0 blockers/3 warnings/1 info (real bug: `changePriority` didn't clear stale SLA flags on downgrade; missing `files_modified` entry); pass 2 after revision found 0 blockers/1 warning/2 info (new: `ThreadSystemEvent` component built but never wired to real data — UI-SPEC's mandated auto-reopen row; `searchTickets` limit not threaded through, silently capping FTS-filtered "Load more" at 25); pass 3 after a second revision (added `Message.triggeredReopen` column in plan 01, wired end-to-end through plans 09→12) found 0 blockers/3 warnings/3 info, all low-risk. User selected "Force proceed" at the max-iteration gate — checker itself recommended proceeding. Commits: `c7d94fb`/`b98423a` (initial 12 plans + roadmap), `abd3a71` (revision 1: SLA flag fix + frontmatter), `afb1082` (revision 2: ThreadSystemEvent wiring + searchTickets limit).

**Next action:** `/gsd:execute-phase 2`. 12 plans, 5 waves: W1 (02-01 schema/migrations, 02-02 deps/tokens/renderMarkdown) → W2 (02-03 ticket-core, 02-04 FTS+attachments, 02-05 SLA worker+rate-limit, 02-06 chips, 02-07 settings) → W3 (02-08 inbox, 02-10 contacts, 02-11 public intake) → W4 (02-09 reading pane) → W5 (02-12 public status page). `/clear` first for a fresh context window.

**Phase 2 research open questions (resolved during planning, researcher's recommended defaults all adopted):** (1) public status-page token = a dedicated unguessable random token, NOT the raw ticket cuid; (2) single-workspace v1 web-form org resolution = `findFirstOrThrow()`; (3) SLA "at-risk" threshold = proportional 20% of target duration remaining, not a flat cutoff.

**Phase 2 locked decisions (see 02-CONTEXT.md):** 2-pane shared inbox (list + reading pane), views as filter chips; flexible status + auto-reopen on requester reply; priority Low/Normal/High/Urgent; per-workspace sequential ticket # (+cuid); auto-link contacts by normalized email (merge deferred); Markdown→sanitized-HTML composer with Public-Reply/Internal-Note toggle (amber notes); 24/7 SLA clock, per-priority targets in Settings, pg-boss job stamps isAtRisk/isBreached + color chips; free-form tags w/ autocomplete + admin management; admin custom fields (text/select/number/checkbox/date); public web form (honeypot + rate-limit, no CAPTCHA); tokenized `/status/[token]` page (public thread + follow-up reopen); local `/data/uploads` volume behind FileStorage interface, 10MB + MIME allowlist. Discretion: Postgres FTS; individual assignment only; bulk actions deferred; fixed views. Reminder: extend `scopedDb` DOMAIN_MODELS allowlist for all new models; make ticket-number generator concurrency-safe.

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
*Last updated: 2026-07-02 — Phase 2 planned: 12 plans/5 waves (afb1082), checker 0 blockers after 3 iterations, user force-proceeded past remaining warnings; next: /gsd:execute-phase 2.*
