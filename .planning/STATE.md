---
gsd_state_version: 1.0
milestone: v1.0.0
milestone_name: Minimum Lovable Helpdesk
current_phase: 07
current_phase_name: launch-readiness
status: Awaiting next milestone
last_updated: "2026-09-13T22:36:18.958Z"
last_activity: 2026-09-13
last_activity_desc: Milestone v1.0.0 completed and archived (override closeout — 23 acknowledged items, see Deferred Items); no git tag (LAUNCH.md owns it)
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 60
  completed_plans: 60
  percent: 100
---

# STATE — AIDA

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-13 after v1.0.0)

**Core value:** Ship a star-worthy, genuinely useful self-hostable AI-native helpdesk whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host (`docker compose up`) are the wedge.
**Current focus:** Planning next milestone — run `/gsd-new-milestone` (ten dormant seeds in `seeds/` + AIDA-18 will surface). In parallel, the maintainer's `LAUNCH.md` steps for the public v1.0.0 release are still open.
**Model profile:** balanced (Opus plans/verifies, Sonnet executes) · **Granularity:** coarse · **License:** Apache-2.0

## Current Position

Phase: Milestone v1.0.0 (Minimum Lovable Helpdesk) — COMPLETE and ARCHIVED 2026-09-13
Plan: —
Status: Awaiting next milestone. Closeout type: **override_closeout** — all 7 phases executed (60/60 plans, 154 tasks) and 23/23 MVP requirements validated, but `init.manager` could not mark every phase "verified": Phase 1 never had a VERIFICATION.md (closed via the 01-08 human gate + `01-UAT.md`), and Phase 5's `05-VERIFICATION.md` stays `human_needed` for an aesthetic visual pass. Everything acknowledged is listed under Deferred Items; nothing was re-labelled "passed". Archives: `milestones/v1.0.0-ROADMAP.md`, `milestones/v1.0.0-REQUIREMENTS.md`, `milestones/v1.0.0-STATE.md` (full pre-close STATE, per-plan decision log), `milestones/v1.0.0-phases/` (all phase artifacts); summary in `MILESTONES.md`; lessons in `RETROSPECTIVE.md`.
Last activity: 2026-09-13 — Milestone v1.0.0 completed and archived. Same session: makeplane/plane researched (`research/plane-inspiration.md`) and SEED-001…010 planted.

## Accumulated Context

### Key Decisions

The full v1 decision log (~160 dated, per-plan entries) lives in `milestones/v1.0.0-STATE.md`; the curated table with outcomes is in `PROJECT.md` → Key Decisions. Cross-cutting rules every future session must keep:

- **Worker-bundleable modules use relative imports only** — the esbuild worker bundle has no `@/` alias (e.g. `src/lib/branding/settings.ts`, the email-channel Setting module). Any Setting-backed module read by both the Next.js app and the pg-boss worker follows this.
- **`src/proxy.ts`** (not `middleware.ts`) exports `proxy()`; `PUBLIC_PREFIXES` and `BLOCKED_PUBLIC_ROUTES` both live there.
- **`.gitattributes` is `* text=auto eol=lf`** — check files created outside a Unix-aware editor before committing (CRLF drift recurred six times before 07-01).
- **`AuditEvent` is append-only at the DB level** (a trigger blocks `DELETE`) — no destructive reset exists; seed/demo paths guard on `prisma.ticket.count()` instead.
- **Seeded/demo AI artifacts are stamped `provider: "demo"` / `model: "demo-seed"`**, never a real provider name; **`DEMO_MODE` is a strict `=== "true"` gate** and never for an internet-facing instance.
- **`website/` is a separate pnpm project** (excluded from the product's tsconfig/biome/Docker); it and Testcontainers/E2E need Node 22 (`volta run --node 22.23.1 …`; machine default is Node 20).
- **Brand colour rule:** `--primary` only as a background paired with `--primary-foreground`; `--primary-emphasis` (and `--sidebar-primary-emphasis`) whenever the brand colour is text — enforced by `tests/e2e/a11y-contrast.spec.ts` (8/8) and `tests/unit/design-tokens.test.ts`. Changing either value re-opens the `docs/assets/` screenshot approval.
- **Demo fixtures:** `ageHours` and `slaState` are not independent parameters — keep them consistent (07-08).
- **Lint autofix caution:** Biome's `noEmptyPattern` rename broke Playwright's fixture parser (07-12) — verify against any framework that gives a parameter's destructuring shape meaning.
- **gsd-tools caveats on this project:** `state update-progress` / `add-decision` no-op on this hand-written STATE.md; `phase.complete` and `milestone.complete` rewrite Current Position and drop `progress.percent` — always `git diff .planning/STATE.md .planning/ROADMAP.md` afterwards and repair by hand. `query audit-open` cannot read "RESOLVED" annotations in `deferred-items.md`.
- **Health checks through Caddy use HTTPS** (`curl -sk https://localhost/api/health`); `docker compose exec -T` inside a `while read` loop needs `</dev/null`.
- **Repeated `pnpm test:e2e` runs** can leave `.next/dev/types/*.d.ts` truncated and break `tsc`/`pnpm build` — delete the gitignored `.next/` and rebuild.

### Deferred Items

Items acknowledged and deferred at milestone close on 2026-09-13 (override closeout; 23 items reported by `gsd-tools query audit-open`, plus AIDA-18):

| Category | Item | Status |
|----------|------|--------|
| verification_gap | Phase 05 — `05-VERIFICATION.md` | `human_needed` — only the aesthetic DESIGN-SYSTEM §9 visual pass (light/dark) remains; the mechanical half was closed by 07-09.1's contrast/token tests |
| uat_gap | Phase 05 — `05-HUMAN-UAT.md` item 3 | file `closed`, 1 pending scenario (same visual pass) |
| uat_gap | Phase 06 — `06-HUMAN-UAT.md` item 3 | `partial` — subjective real-LLM Insight quality (cluster labels / KB-gap matches); objective half closed by `honesty-invariants.spec.ts` |
| verification_gap (implicit) | Phase 01 — no `01-VERIFICATION.md` | phase closed via 01-08 human gate + `01-UAT.md` complete; artefact never written |
| requirement | AIDA-18 KB auto-generation (Stretch) | backlog — recorded as Known Gap in `MILESTONES.md` |
| deferred_item | Phase 02 — CRLF vs LF formatter mismatch (2 entries) | RESOLVED in 07-01 (`.gitattributes`) — tool cannot parse the annotation |
| deferred_item | Phase 02 — import order in `src/lib/worker/index.ts` | RESOLVED in 07-01 (was already correct) |
| deferred_item | Phase 02 — `gsd-tools requirements mark-complete` not_found (2 entries) | RESOLVED in 07-01 (REQUIREMENTS.md restructured) |
| deferred_item | Phase 02 — `gsd-tools state update-progress` / `add-decision` no-op | still true — documented under Key Decisions |
| deferred_item | Phase 02 — Turbopack "unexpected file in NFT list" build warning | pre-existing, cosmetic, open |
| deferred_item | Phase 05 — CRLF vs LF (same root cause) | RESOLVED in 07-01 |
| deferred_item | Phase 07 — enable GitHub Pages (Source = GitHub Actions) | human-only; in `LAUNCH.md` |
| deferred_item | Phase 07 — verify `afrizzal.github.io/aida` renders with CSS after first deploy | human-only; in `LAUNCH.md` |
| seeds | SEED-001 … SEED-010 (Plane-inspired v2 candidates) | dormant by design — surface at `/gsd-new-milestone` |

Also open (not audit items): `milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md` — no logo upload, no invite flow (→ SEED-007), no backup scheduler, `POSTGRES_PASSWORD` not URL-encoded in `docker-compose.yml`'s `DATABASE_URL`, duplicate `<h1>` per app page — and `07-SECURITY-PASS.md`'s accepted-for-v1 known issues (sharp CVEs, root containers, spoofable XFF, SSRF error oracle, two unthrottled public routes, build-time third-party egress, no CSP).

### Open Todos

- **LAUNCH.md (maintainer-only; blocks the public release):** replace the placeholder contact `security@aida-helpdesk.example` in `CODE_OF_CONDUCT.md` and `.github/SECURITY.md` (keep identical); re-run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` on a clean checkout; repository settings (public, About, topics, social preview, Discussions, Pages = GitHub Actions, private vulnerability reporting); `git tag -a v1.0.0` + push + `gh release create`; post-release checks; outreach. The tag was deliberately **not** created by the milestone close.
- Push local `master` to `origin` (ahead by the Plane-research commit and the milestone-close commits).
- Human passes still pending: Phase 5 aesthetic §9 visual pass (light/dark); Phase 6 real-LLM Insight quality check.
- Disk hygiene: ~34 stale `.claude/worktrees` directories (~11 GB), all merged/superseded (verified 2026-08-02 against `9b475b7`); deletion is the maintainer's call — `git worktree prune` + `branch -d` is the sanctioned automated part.

### Blockers

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260705-bau | middleware 401 JSON for unauthenticated /api/* + truly-anonymous e2e context | 2026-07-05 | e0fb9e5 | [260705-bau-middleware-401-json-for-unauthenticated-](./quick/260705-bau-middleware-401-json-for-unauthenticated-/) |
| 260705-kg0 | fix Phase 2 UI-review priority findings: error boundaries, request-form typography, chip-row wrap | 2026-07-05 | a887ce6 | [260705-kg0-fix-phase-2-ui-review-priority-findings-](./quick/260705-kg0-fix-phase-2-ui-review-priority-findings-/) |
| 260904-8h1 | Bump `@anthropic-ai/sdk` 0.110.0 → 0.123.0 + add `claude-opus-5` to `MODEL_CATALOG` (post-v1 follow-up; biome/tsc/unit 90/90/integration 30/30 green; lockfile changed only for the SDK) | 2026-09-04 | acbe670 | [260904-8h1-bump-anthropic-ai-sdk-0-110-0-0-123-0-an](./quick/260904-8h1-bump-anthropic-ai-sdk-0-110-0-0-123-0-an/) |

## Session Continuity

**Last action (2026-09-13):** v1.0.0 closed via `/gsd-complete-milestone` — pre-close audit acknowledged (override closeout), archives written, `MILESTONES.md`/`RETROSPECTIVE.md` created, `PROJECT.md` evolved (Current State, Next Milestone Goals, decision outcomes), `ROADMAP.md` collapsed to milestone grouping + Backlog, `REQUIREMENTS.md` removed (archived), this file reset to a lean baseline. No tag, nothing pushed.

**Next action:** maintainer works through `LAUNCH.md`; then `/gsd-new-milestone` (seeds auto-surface; phase numbering continues at 08).

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
