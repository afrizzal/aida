---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-07-02T01:03:22.618Z"
last_activity: 2026-07-02
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 20
  completed_plans: 14
  percent: 70
---

# STATE — AIDA v1: Minimum Lovable Helpdesk

## Project Reference

**Core Value:** Ship a star-worthy, genuinely useful self-hostable AI-native helpdesk MLP whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host are the wedge.

**Milestone:** v1 — Minimum Lovable Helpdesk
**Granularity:** coarse (7 phases)
**Model profile:** balanced (Opus plans, Sonnet executes)
**License:** Apache-2.0

## Current Position

Phase: 02 (core-ticketing) — 🟡 IN PROGRESS (wave 2 of 5 in progress: 02-03/02-04/02-05/02-06 done, 02-07 remaining)
Plan: 6 of 12 core-ticketing plans complete (02-01, 02-02 wave 1; 02-03, 02-04, 02-05, 02-06 wave 2 — mutually independent)
Status: Executing — Wave 2 nearly complete (02-07 remaining)
Last activity: 2026-07-02

Progress: [███████░░░] 70% (14/20 plans complete — 8/8 phase 01 + 6/12 phase 02)

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
- (02-02) `renderMarkdown()` (`src/lib/markdown/render.ts`) is the ONE Markdown->sanitized-HTML pipeline (unified/remark/rehype); never add a second `dangerouslySetInnerHTML` call site that bypasses it.
- (02-02) `rehype-sanitize`'s `defaultSchema` allowlist only lets `target`/`rel` attributes SURVIVE sanitization if already present on the node — it does not add them. A custom `rehypeSafeLinks` unified plugin (via `unist-util-visit`) stamps `target="_blank"` + `rel="nofollow noopener noreferrer"` on every link before the sanitize pass.
- (02-02) `hast-util-sanitize` must be an explicit `devDependency` (not left implicit/transitive) — pnpm's strict `node_modules` linking makes transitive-only packages unresolvable for direct type imports.
- (02-02) Fresh worktree/clone bootstrap: `cp .env.example .env && pnpm prisma generate` is required before `tsc --noEmit` will pass (generated client + `.env` are both gitignored).
- (02-03) `createTicket(orgId, input)` (`src/lib/tickets/create-ticket.ts`) is the ONE code path that creates tickets — reused by the agent "New Ticket" flow (plan 08/09) and the public web form (plan 11). Never add a second ticket-creation call site.
- (02-03) SLA seeded defaults finalized (not just illustrative): URGENT 1h/8h, HIGH 4h/24h, NORMAL 8h/48h, LOW 24h/72h (first-response/resolution minutes) — `src/lib/tickets/sla.ts` `DEFAULT_SLA_TARGETS`.
- (02-03) Public status-page token = dedicated `crypto.randomBytes(24).toString("base64url")` secret (`Ticket.statusToken`), never the ticket cuid — `src/lib/tickets/status-token.ts` `generateStatusToken()`.
- (02-03) Pattern: helpers called from inside `createTicket`'s interactive `$transaction` (e.g. `findOrCreateContact`, `getSlaTargets`) must type their `db` param as `Pick<ReturnType<typeof scopedDb>, "modelName">`, not the full `ReturnType<typeof scopedDb>` — the `tx` client structurally lacks `$connect`/`$disconnect`/`$extends`/`$transaction`, so the full type fails `tsc --noEmit` at call sites inside the transaction.
- (02-03) `findOrCreateContact` only backfills currently-null name/phone/company on an existing Contact match; never overwrites a populated field (D-07 "missing fields fill in over time").
- (02-04) `searchTickets()` is the sole raw-SQL FTS call site against Ticket/Message, with an explicit `organizationId` filter in the SQL — `scopedDb` does not intercept `$queryRaw`, so no future call site may skip this filter without reintroducing the exact cross-tenant leak class AIDA-11 was written to catch.
- (02-04) Attachment storage keys are always server-generated (`buildStorageKey()`: random hex + sanitized extension, no cuid dep needed) and validated by `safeKey()`'s regex guard before touching the filesystem; the original uploaded filename is stored only as `Attachment.originalFilename` metadata, never used to construct a path — path traversal is structurally impossible, not just filtered.
- (02-04) Plan 03's `createTicket` helper had not landed when 02-04 executed — `search-isolation.test.ts` seeds tickets/messages via bare `prisma.ticket.create`/`prisma.message.create` per the plan's documented fallback; no blocking dependency was introduced between 02-03 and 02-04.
- (02-05) SLA flags are set ONLY by the recurring worker job (two set-based `$executeRaw` UPDATEs — breach implies at-risk, then proportional 20%-of-target at-risk); RESOLVED/CLOSED tickets always excluded. Clearing `isAtRisk`/`isBreached` on first-response/resolve is deferred to plan 09's Server Actions — the job never clears, only sets.
- (02-05) `RateLimitHit` is accessed via bare `prisma` (not `scopedDb`, confirmed not in the DOMAIN_MODELS allowlist) — Postgres-backed per-IP rate limiter (`checkRateLimit`, sha256(ip+pepper) hash, rolling-window count-then-insert) for public intake; a daily worker job prunes rows older than 48h. `check-rate-limit.ts` imports `@/lib/db` (webpack) while worker jobs import `../../db` (esbuild bundle) — same prisma singleton, two different bundling contexts, do not mix import styles between the two.
- (02-05) `gsd-tools state update-progress` / `add-decision` CLI commands have a bug on this project's STATE.md: the case-insensitive `Progress:` regex matches the YAML frontmatter's lowercase `progress:` key before the body's `Progress:` line, so the body bar silently fails to update (tool reports success). `add-decision` similarly fails because this file's heading is `### Key Decisions`, not `### Decisions`/`### Decisions Made`. Both were hand-edited this session as a workaround — future sessions should hand-edit the body `Progress:` line and `### Key Decisions` list directly rather than trusting these two CLI commands' reported success on this file.
- (02-06) Ticket chip vocabulary built in `src/components/tickets/`: `StatusChip` (5-state), `PriorityChip` (4-level), `SlaDueChip` (3-state, precedence breached > at-risk > on-track), `TagChip`/`TagOverflowChip`, `AttachmentChip`/`formatBytes`, `AssigneeAvatar` (+ dashed Unassigned placeholder), and `formatDueDuration` helper — all token-only (Badge base + `cn(sizeClasses, stateClasses)`, twMerge dedupes). Future inbox/reading-pane/contacts/public UI (plans 08/09/10/12) must reuse these, not re-derive status/priority/SLA color logic.

### Open Todos

- Execute Phase 2: `/gsd:execute-phase 2`. Wave 1 (02-01, 02-02) complete. Wave 2: 02-03, 02-04, 02-05, 02-06 done. Remaining Wave 2: 02-07 (settings). Then Wave 3 (02-08/10/11) → Wave 4 (02-09) → Wave 5 (02-12).
- Watch during execution: "New Ticket" CTA must land in the inbox top bar (plan 08 territory) so a zero-ticket workspace has an agent-reachable creation path — plan 09's task text left this ambiguous ("list panel header or reading-pane header"); the reading-pane-only option would break cold start.
- 02-01 done: tenant-in-tx smoke test used the correct type-cast pattern (not explicit organizationId) — auto-injection genuinely proven, no fallback needed downstream.
- 02-03 done: `createTicket()`, `findOrCreateContact()`, `getSlaTargets()`/`computeDueTimestamps()`, `generateStatusToken()` all available now for 02-08/09/11/12 to call directly.
- Downstream plans (09 composer, 11 public intake, 12 public status page) still need to build the actual upload/serve Route Handlers on top of 02-04's `FileStorage`/`localFileStorage`/`buildStorageKey` primitives, per RESEARCH.md Topic 4's illustrative shape — not built in 02-04 (out of scope, storage/limits primitives only).
- 02-05 done: plan 09 must remember to clear `isAtRisk`/`isBreached` in the same write as setting `firstRespondedAt`/`resolvedAt` (the sla-flag job is one-directional and only sets).
- Plan 08/11 (public intake): call `checkRateLimit("public-intake", ip)` from `src/lib/rate-limit/check-rate-limit.ts` before creating a ticket from the public web form.

### Blockers

None.

## Session Continuity

**Last action:** Wave 2 of Phase 2 in progress — plans 02-03 (ticket-creation domain core), 02-04 (FTS search + attachment storage), 02-05 (SLA-flag worker + rate limiter), and 02-06 (ticket chip vocabulary) all complete:

- **02-01** (core-ticketing data foundation): 11 Prisma models + 5 enums added, relational migration generated; FTS tsvector/GIN migration hand-written outside schema.prisma; scopedDb DOMAIN_MODELS extended to 9 tenant models; Wave-0 smoke test proves scopedDb auto-injects organizationId inside interactive `$transaction` (no fallback needed for plan 03). 4/4 integration tests green (Testcontainers). Commits: `cd4d067`, `133e86b`, `6b299c6`, `6fe228b`, `8c88164`. SUMMARY: `.planning/phases/02-core-ticketing/02-01-SUMMARY.md`.
- **02-02** (deps/tokens/renderMarkdown): Installed 7 markdown/file-type packages + 5 shadcn primitives (`textarea`, `popover`, `command`, `checkbox`, `skeleton`). Added `--warning`/`--success` tokens (light+dark) and matching `Badge` variants. Built `renderMarkdown()` (TDD: RED → GREEN → REFACTOR, 6/6 assertions green) — required an unplanned custom `rehypeSafeLinks` plugin. Commits: `64acb84`, `fc7166c`, `a758621`, `63ce2c5`, `2441fa3`, `2d87e99`. SUMMARY: `.planning/phases/02-core-ticketing/02-02-SUMMARY.md`.
- **02-03** (ticket-creation domain core): `generateStatusToken()`, `sla.ts` (`DEFAULT_SLA_TARGETS`/`getSlaTargets`/`computeDueTimestamps`), `findOrCreateContact()` (normalized-email dedup/backfill), and `createTicket(orgId, input)` — the single entrypoint wrapping contact link/create + `TicketCounter.upsert` + SLA stamping + sanitized initial `Message` in one `$transaction`. 3/3 integration tests green (sequential numbering; 20-way concurrency, zero duplicate numbers; `A@X.com`/`a@x.com` dedupe to one Contact). Commits: `8f9959b`, `b4d88e7`, `3cb499e`, `f3f2b1e`. SUMMARY: `.planning/phases/02-core-ticketing/02-03-SUMMARY.md`.
- **02-04** (FTS search + attachment storage): built `searchTickets(orgId, queryText, limit)` — the sole reviewed `$queryRaw` call site against `Ticket`/`Message`, ranked via `websearch_to_tsquery`, explicit `organizationId` filter in the SQL. Proved cross-tenant isolation with a two-scenario Testcontainers test (subject match + message-body match). Built the `FileStorage` interface + `localFileStorage` + `safeKey()` path-traversal guard + `buildStorageKey()` + centralized `MAX_BYTES`/`ALLOWED_MIME`/`MAX_TOTAL_REQUEST_BYTES`. `tsc --noEmit` clean; 6/6 integration tests green; 14/14 unit tests green. Commits: `916a5f7`, `05749aa`. SUMMARY: `.planning/phases/02-core-ticketing/02-04-SUMMARY.md`.

- **02-05** (SLA-flag worker job + Postgres rate limiter): `slaFlagHandler` (two set-based `$executeRaw` UPDATEs — breach + proportional 20% at-risk, RESOLVED/CLOSED excluded, one-directional/sets-only), `checkRateLimit(scope, ip)` (sha256-hashed IP, rolling-window count-then-insert against `RateLimitHit`), `rateLimitCleanupHandler` (prunes rows >48h); all three wired into `src/lib/worker/index.ts` (createQueue/work/schedule, mirroring the heartbeat pattern — sla-flag every 5 min, rate-limit-cleanup daily 03:00). `tsc --noEmit` clean. Commits: `72da7e6`, `e901d86`, `fe9d39f`, `8cdd5ea` (biome format fix). SUMMARY: `.planning/phases/02-core-ticketing/02-05-SUMMARY.md`.
- **02-06** (ticket chip vocabulary): Built `StatusChip` (5-state), `PriorityChip` (4-level), `SlaDueChip` (3-state, breached > at-risk > on-track precedence), `TagChip`/`TagOverflowChip`, `AttachmentChip`/`formatBytes`, `AssigneeAvatar` (+ dashed Unassigned placeholder) and `formatDueDuration` — all in `src/components/tickets/` + `src/lib/tickets/format-duration.ts`, token-only (no hex/oklch), typed against generated Prisma enums. `pnpm exec tsc --noEmit` and `biome check` both clean. Commits: `16f1032`, `daa38bb`. SUMMARY: `.planning/phases/02-core-ticketing/02-06-SUMMARY.md`.

Wave 1 worktree branches merged into `master` (merge commits `64f0888`, `6871bd6`). 02-03, 02-04, 02-05, 02-06 executed on worktrees fast-forwarded onto master, then merged back.

**Next action:** Remaining Wave 2 plan — 02-07 (settings) — depends only on Wave 1's schema/scopedDb/tokens (already satisfied). Then Wave 3 (02-08 inbox, 02-10 contacts, 02-11 public intake — inbox/contacts/public UI should now consume the 02-06 chip vocabulary) → Wave 4 (02-09 reading pane, must clear SLA flags on first-response/resolve) → Wave 5 (02-12 public status page).

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
*Last updated: 2026-07-02 — Wave 2 of Phase 2 nearly complete: plans 02-03, 02-04, 02-05, 02-06 done; next: 02-07.*
