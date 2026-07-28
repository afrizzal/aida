# Phase 7: Launch Readiness - Context

**Gathered:** 2026-07-28 (auto mode — recommended defaults selected by Claude, logged in 07-DISCUSSION-LOG.md)
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the public repo star-worthy and operable: seed/demo dataset + demo mode (AIDA-22), star-ready README with hero GIF + a docs site covering install/config/AI setup (AIDA-23), backup/restore + basic ops docs + a security pass (AIDA-24), plus the **branding remainder of AIDA-12** (the only unshipped slice — ROADMAP coverage maps AIDA-12 to phases 2,4,7 and no branding UI exists in the codebase) and launch-readiness repo hygiene (CI, community files, long-deferred hygiene items).

**Not in scope:** new helpdesk/AI product features beyond the branding settings slice; hosted public demo instance; the actual outreach/posting act (maintainer's manual job); KB auto-generation (AIDA-18, backlog).

</domain>

<decisions>
## Implementation Decisions

### Demo data & demo mode (AIDA-22)
- **D-01:** Demo dataset is a TypeScript seed script invoked via `pnpm db:seed`. Reuse the single write paths where practical (`createTicket`, `createKbArticle`); direct Prisma writes are allowed where historical timestamps / pre-computed AI artifacts require it. Seed is idempotent or self-guarding (refuses/reset-safe on a non-empty DB — exact mechanism planner's call).
- **D-02:** Demo mode = env-flag driven (name planner's call, e.g. `DEMO_SEED=true`): on boot against an empty database it auto-creates the demo org + demo admin/agent credentials + dataset, so `docker compose up` with the flag gives an instantly explorable helpdesk. Demo credentials are documented in README/docs. Never active by default; NEVER ship default creds outside demo mode (existing `.env.example` rule stands).
- **D-03:** Dataset content: realistic fictional SMB support workspace — roughly 25–40 tickets spread across statuses/priorities/SLA states (including at-risk + breached), 10–15 contacts with companies, tags, custom fields, internal notes + public replies, 5–8 KB articles, CSAT responses, and **pre-computed AI artifacts stored as data** (triage fields set on tickets, at least one draft-with-citations evidenced via `AuditEvent` rows, a COMPLETED `InsightRun` with clusters/KB-gaps/narrative JSON) so every AI surface renders populated **without any LLM configured**. Live AI actions (Generate draft, Generate insights, live triage) still honestly require a configured provider — the demo shows stored results, it does not fake live calls.
- **D-04:** No hosted public demo in v1. "Demo" = local `docker compose` demo mode. (Deferred idea: hosted demo instance post-v1.)

### README & docs site (AIDA-23)
- **D-05:** README final shape: hero GIF at top → one-line pitch → badges (CI, license, release) → features table (exists) → quick start (fix the current port inconsistency: Caddy serves `http://localhost`, README says `:3000`) → demo-mode one-liner → **honest comparison table** (AIDA vs Zendesk/Intercom/Chatwoot-class alternatives on AI-native / self-host / BYO-local-LLM / data residency / per-resolution fees axes — relative claims only, zero fabricated stats, per CLAUDE.md honest-claims rules) → screenshots → tech stack → docs links → contributing → license.
- **D-06:** Docs site = **Astro Starlight** in `website/` (separate workspace dir, product app stack untouched), deployed to **GitHub Pages via GitHub Actions**. Content: quick-start/install, configuration (env reference sourced from `.env.example`), email channel setup, AI setup per provider (OpenAI/Anthropic/Ollama local), KB & RAG usage, AIDA Insight, ops (backup/restore/upgrade/logs), security model. Deep engineering docs (`docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/BRIEF.md`) stay in-repo; site links to them.
- **D-07:** Hero GIF: scripted golden-path walkthrough recorded on the seeded demo instance — shared inbox → ticket with triage chips → cited RAG draft → human approve/send → /insights. Stored in-repo (small, optimized; `docs/assets/` or `.github/assets/` — Claude's discretion), plus 3–5 static screenshots (light + dark). Capture tooling is Claude's discretion (Playwright video → GIF is acceptable); **final visual capture/approval is a human-verification item**.

### Backups & ops (AIDA-24)
- **D-08:** Ship `scripts/backup.sh` + `scripts/restore.sh` wrapping `pg_dump`/`pg_restore` via `docker compose exec db`, **plus the uploads volume** (attachments) archive — a DB-only backup is an incomplete backup. Docs show a cron example; no built-in scheduler service in v1. (Deferred idea: automated backup sidecar.)
- **D-09:** Ops docs cover: upgrade procedure (pull + `prisma migrate deploy`), logs (`docker compose logs`), the `/api/health` healthcheck, full env var reference, and restore-to-new-server walkthrough.

### Security pass (AIDA-24 / phase criterion 3)
- **D-10:** Checklist-driven audit producing a **written report artifact** in the phase dir, covering: provider keys encrypted at rest (secret-box usage sweep — no plaintext secret paths), server-side authz sweep of every mutating Server Action + route handler (`requireOrgAdmin`/session gates), AIDA-20 safeguards re-verified (injection-fence + redaction tests green, no-egress confirmation), public-surface abuse controls (rate limits, honeypots, token-scoped routes), and `pnpm audit` dependency pass. Small findings fixed in-phase; large findings logged as explicit known-issues with severity. This pass also absorbs the outstanding non-blocking human-verification items from 04/05/06 (network-egress capture, live-provider smoke, visual passes) — closing or explicitly re-logging each.
- **D-11:** Add a GitHub-standard `SECURITY.md` vulnerability-disclosure policy (root or `.github/`), distinct from the existing `docs/SECURITY.md` engineering doc.

### Repo hygiene & launch mechanics (criterion 4)
- **D-12:** GitHub Actions CI: `prisma generate` → typecheck → unit tests → build. Integration tests (Testcontainers) in CI are best-effort/Claude's discretion (GH runners have Docker). CI badge added to README.
- **D-13:** Community files: `CONTRIBUTING.md` (the README already links to it as "coming soon"), issue templates (bug/feature), PR template. `CODE_OF_CONDUCT.md` (Contributor Covenant) is Claude's discretion.
- **D-14:** Phase 7 IS the long-promised repo-hygiene pass. Fold in the standing deferred items: `.gitattributes` with `* text=auto eol=lf` + one-time line-ending normalization (fixes the 6×-recurring CRLF drift documented since 02-05); REQUIREMENTS.md restructure/manual check-off so `gsd-tools requirements mark-complete` works; `src/middleware.ts` → `proxy.ts` rename (Next 16 deprecation); SlaDueChip `toLocaleString` locale hydration fix; the 02-07 inline SLA/chip literal dedup against `DEFAULT_SLA_TARGETS`/`PriorityChip`/`TagChip`; worker `index.ts` import-order lint fix. Bundle as one hygiene plan.
- **D-15:** "Launch" in this phase = repo state, not the outreach act: tag `v1.0.0` + release notes, repo description/topics/social-preview checklist, and (Claude's discretion) a `LAUNCH.md` outreach checklist. Actual posting is the maintainer's manual act, out of phase scope.

### Branding settings (AIDA-12 remainder)
- **D-16:** New Settings → Branding tab following the established settings precedent exactly (admin-gated Server Actions via `requireOrgAdmin()`, org-scoped `Setting` keys, form patterns from email/AI tabs): **workspace display name** (defaults to organization name) + **optional logo upload** (reuse `local-file-storage`), applied to the public pages (request form, status page, CSAT), the app sidebar brand block, and the outbound email from-name default. If logo upload proves disproportionately heavy during planning, name-only ships in 7 and logo becomes a deferred item — planner's call. This closes AIDA-12.

### Claude's Discretion
- GIF capture tooling and asset location; exact seed volumes/fixture prose; CI matrix details and whether integration tests run in CI; docs-site IA details and theming; comparison-table rows (within honest-claims rules); CODE_OF_CONDUCT inclusion; LAUNCH.md; demo-mode env var naming; seed idempotency mechanism.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition & requirements
- `.planning/ROADMAP.md` — Phase 7 goal + 4 success criteria (lines ~129–137)
- `.planning/REQUIREMENTS.md` — AIDA-12, AIDA-22, AIDA-23, AIDA-24 acceptance statements
- `.planning/PROJECT.md` — Active requirements note: "branding/channels/AI config land in Phases 4/7"

### Non-negotiable constraints
- `CLAUDE.md` — honest-claims rules (comparison table: relative metrics only, "orchestrated not trained", no fabricated resolution-rate stats); stack rules (no new moving parts in the product)
- `.planning/DESIGN-SYSTEM.md` — any UI (Branding tab, public-page brand display) must conform; §9 design checklist gates phase completion
- `.planning/LOOP-ENGINEERING.md` — phase loop + hard stop conditions

### Security pass inputs
- `docs/SECURITY.md` — existing security model whose claims the pass must verify
- `.planning/phases/04-ai-foundation/04-VERIFICATION.md` — open human-verification items (network-egress capture, live-provider smoke)
- `.planning/phases/05-rag-drafted-replies/05-HUMAN-UAT.md` — open items (live walkthrough, embedding Test Connection, §9 visual pass)
- `.planning/phases/06-aida-insight/06-HUMAN-UAT.md` — open items (insights visual pass, CSAT click-through, real-LLM output quality)

### Hygiene items being folded in (D-14)
- `.planning/phases/02-core-ticketing/deferred-items.md` — CRLF/.gitattributes, REQUIREMENTS.md format mismatch, import-order, Turbopack NFT warning
- `.planning/phases/05-rag-drafted-replies/deferred-items.md` — CRLF recurrence detail
- `.planning/STATE.md` §Open Todos — middleware→proxy rename, SlaDueChip locale fix, 02-07 chip dedup

### Content sources for README/docs
- `README.md` — existing skeleton (hero-GIF TODO, features table, quick-start with the `:3000` vs Caddy-`:80` inconsistency to fix)
- `docs/BRIEF.md`, `docs/ARCHITECTURE.md` — positioning + architecture source material
- `.env.example` — canonical env reference the docs must mirror
- `docker-compose.yml`, `Caddyfile`, `Dockerfile` — self-host reality the quick-start/ops docs must match

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/tickets/create-ticket.ts` (`createTicket`) — the ONE ticket write path; seed should go through it where practical (auto-triage enqueue is skipped when AI off — fine for demo)
- `src/lib/kb/create-article.ts` (`createKbArticle`/`updateKbArticle`) — the ONE KB write path (chunks stay PENDING without an embedding provider — acceptable for demo)
- `src/lib/insight/types.ts` — the persisted-shape contract for seeding a COMPLETED `InsightRun`'s five Json columns (never redefine ad hoc)
- `src/lib/audit/record-audit-event.ts` — insert path for seeded DRAFT_GENERATED/DRAFT_APPROVED/triage audit rows
- Settings tab precedent — `settings/email/*` + `settings/actions.ts` (`requireOrgAdmin()` first, form patterns) for the Branding tab; `settings-nav.tsx` gets the new entry
- `src/lib/attachments/local-file-storage.ts` — reusable for logo upload (server-generated keys, traversal-safe)
- `src/components/public/PublicPageShell` + `(public)` layout — where brand name/logo surfaces on request/status pages
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` headless bootstrap (already in `.env.example`) — precedent for demo-mode auto-setup flow
- `src/lib/crypto/secret-box.ts` — the one encrypt-at-rest primitive the security pass sweeps for

### Established Patterns
- Org-scoped `Setting` keys via `scopedDb` (email/llm settings modules) — branding settings follow the same `getX/saveX` module shape
- `findFirst`+create/update (not upsert) for domain models with compound uniques under scopedDb
- Worker files use relative imports only (esbuild); app files may use `@/`
- Any future migration touching Ticket/Message must hand-review for the spurious `searchVector` DROP (6× recurrence) — branding likely needs NO migration (Setting keys only)
- RTK shell hook intercepts `pnpm exec`/`pnpm lint` in some sessions — invoke tools via `node node_modules/<pkg>/<bin>` when that happens (04-04/06-02 precedent)
- E2E needs `volta run --node 22` (project memory)

### Integration Points
- `README.md` (rewrite in place), `docs/` (extend), NEW `website/` (Starlight), NEW `.github/` (CI workflow, templates, SECURITY.md), NEW `scripts/` (backup/restore), `prisma/` + `package.json` (`db:seed`)
- `docker-compose.yml` — demo-mode env plumbing (no new services)
- `src/app/(app)/settings/` — Branding tab; `src/components/sidebar.tsx` + `(public)` pages — brand display
- No `.github/` dir exists today; no seed infra exists today; `scripts/` dir is empty

</code_context>

<specifics>
## Specific Ideas

- The hero GIF is explicitly called out in README as "single highest-leverage asset for stars" — treat the demo-seed → GIF pipeline as the phase's spine: seed quality directly determines GIF quality.
- Comparison table must survive an honesty audit: relative claims only ("AI included vs paid add-on", "your server vs vendor cloud"), never invented numbers.
- Demo shows **stored** AI results honestly; it must never fake a live LLM call.

</specifics>

<deferred>
## Deferred Ideas

- Hosted public demo instance (post-v1; conflicts with single-server/self-host focus for now)
- Automated scheduled backup sidecar/service (v1 documents a cron example instead)
- Logo upload IF planning finds it disproportionately heavy (name-only ships, logo deferred)
- KB auto-generation from resolved tickets (AIDA-18) — already backlog
- i18n/multi-language docs — later

</deferred>

---

*Phase: 07-launch-readiness*
*Context gathered: 2026-07-28*
