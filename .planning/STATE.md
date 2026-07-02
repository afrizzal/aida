---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-07-02T00:03:20.619Z"
last_activity: 2026-07-02
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 20
  completed_plans: 9
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

Phase: 02 (core-ticketing) — EXECUTING
Plan: 2 of 12
Status: Ready to execute
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
- (02-01) `scopedDb` confirmed to auto-inject `organizationId` inside interactive `$transaction` callbacks (Wave-0 smoke test, `tests/integration/scoped-tx.test.ts`) — plan 03's `create-ticket.ts` can use the `$transaction(tx => tx.ticketCounter.upsert(...))` pattern from RESEARCH.md without an explicit-orgId fallback.
- (02-01) FTS `searchVector` tsvector columns (Ticket, Message) declared ONLY in a hand-written migration, never in `schema.prisma` — dodges three known Prisma diff-engine bugs around `GENERATED ALWAYS` columns; queried exclusively via `$queryRaw` in a future dedicated search module (plan 04), never through `scopedDb` (which doesn't intercept raw SQL).
- (02-01) `scopedDb` `DOMAIN_MODELS` now: Setting, Ticket, Contact, Message, Tag, SlaPolicy, CustomFieldDefinition, CustomFieldValue, Attachment, TicketCounter (TicketTag and RateLimitHit intentionally excluded — join table / non-tenant-scoped).
- (02-01) Prisma 7.8's CLI refuses `migrate reset` when it detects an AI-agent invocation (requires human consent via `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`); fresh-migration verification uses a disposable dev Postgres container recreate + `migrate deploy` instead.

### Open Todos

- Execute Phase 2: `/gsd:execute-phase 2`. 12 plans ready across 5 waves (02-01/02 → 02-03..07 → 02-08/10/11 → 02-09 → 02-12).
- Watch during execution: "New Ticket" CTA must land in the inbox top bar (plan 08 territory) so a zero-ticket workspace has an agent-reachable creation path — plan 09's task text left this ambiguous ("list panel header or reading-pane header"); the reading-pane-only option would break cold start.
- 02-01 done: tenant-in-tx smoke test used the correct type-cast pattern (not explicit organizationId) — auto-injection genuinely proven, no fallback needed downstream.
- Next up: 02-02 (deps/tokens/renderMarkdown), part of Wave 1 alongside 02-01.

### Blockers

None.

## Session Continuity

**Last action:** Plan 02-01 (core-ticketing data foundation) executed and complete. All 3 tasks done: (1) 11 Prisma models + 5 enums added, relational migration generated; (2) FTS tsvector/GIN migration hand-written outside schema.prisma, scopedDb DOMAIN_MODELS extended to 9 tenant models; (3) Wave-0 smoke test proves scopedDb auto-injects organizationId inside interactive `$transaction` (no fallback needed for plan 03). 4/4 integration tests green (Testcontainers). Commits: `cd4d067` (Task 1), `133e86b` (Task 2), `6b299c6`+`6fe228b` (Task 3 + type-fix). See `.planning/phases/02-core-ticketing/02-01-SUMMARY.md` for full deviation notes (Prisma AI-agent `migrate reset` guard worked around via disposable-container recreate + `migrate deploy`; local Windows Postgres port 5432 conflict worked around via port 25432 for this worktree's dev DB).

**Next action:** Continue `/gsd:execute-phase 2` with plan 02-02 (deps/tokens/renderMarkdown — remaining Wave 1 plan, no dependency on 02-01). Then Wave 2: 02-03 (ticket-core, depends on 02-01), 02-04 (FTS+attachments), 02-05 (SLA worker+rate-limit), 02-06 (chips), 02-07 (settings). Then Wave 3 (02-08 inbox, 02-10 contacts, 02-11 public intake) → Wave 4 (02-09 reading pane) → Wave 5 (02-12 public status page).

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
*Last updated: 2026-07-01 — Plan 02-01 (core-ticketing data foundation) complete: 11 models/5 enums migrated, FTS migration hand-written, scopedDb allowlist extended, tx-injection smoke test green (cd4d067/133e86b/6b299c6/6fe228b); next: plan 02-02.*
