---
gsd_state_version: "1.0"
milestone: v2.0
milestone_name: Helpdesk & Projects
current_phase: 14
current_phase_name: projects-foundation
status: Phases 8, 9 and 10 parked (owner decision); 13, 16 and 17 parked by dependency on 10; Phases 11, 12, 12.1 and 12.2 verified human_needed; Phase 14 (Projects foundation) executing, plan 14-01 complete
stopped_at: Completed 14-01-PLAN.md (frozen Phase 14 contract); 14-02 and 14-03 next (Wave 2)
last_updated: "2026-11-09T12:20:00.000Z"
last_activity: 2026-11-09
last_activity_desc: Plan 14-01 complete. Frozen Phase 14 contract in src/lib/projects/contract.ts (76 operations, 41 verbs, 20 refusal codes, validators; unit 24 passed, biome and typecheck exit 0) and 14-CONTRACT.md (sections 0 to 17, consistent with the module). Commits 842120a and 301684a
state_head: 75e5a731b94899099a85ae1ff6bdd0f623debc24
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 86
  completed_plans: 46
  percent: 0
---

# STATE — AIDA

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-07, v2.0 opened)

**Core value:** Ship a star-worthy, genuinely useful self-hostable AI-native helpdesk whose AI experience (triage → cited RAG drafted replies → AIDA Insight) and one-command self-host (`docker compose up`) are the wedge.
**Current focus:** v2.0 Helpdesk & Projects, Phases 8–17, on branch `v2/run-loop` under `run-loop/PIAGAM.md`. The live queue is `run-loop/ANTREAN.md`; the run report is `run-loop/LAPORAN.md`. The maintainer's `LAUNCH.md` steps for the public v1.0.0 release are still open.
**Model profile:** inherit (every GSD agent runs on the session model, Opus 5.5; charter owner rule D) · **Granularity:** coarse · **License:** Apache-2.0

## Current Position

Phase: 14 (Projects foundation) is executing; plan 14-01 (frozen contract) is complete. Phases 11, 12, 12.1 and 12.2 are verified human_needed (no code gap; visual, dark-mode and screen-reader checks wait for a human). Phases 08, 09 and 10 are PARKED (owner decision); Phases 13, 16 and 17 are parked by dependency on Phase 10.
Plan: 14-01 complete (frozen contract, 14-01-SUMMARY.md); next 14-02 and 14-03 (Wave 2).
Status: Milestone v2.0 opened by hand on 2026-11-07. `REQUIREMENTS.md` (91 requirements) and `ROADMAP.md` (Phases 8–17) are written and were revised over three Codex critique rounds (queue item 0b done). The public demo was walked under the clean-room rules and added AIDA-100 to AIDA-114 (item 0c done). Phase 8 context is committed (`08-CONTEXT.md`, `8abbc6c`) and the phase is planned: 23 plans in 14 waves; three Codex review cycles; parked after cycle 3 (owner decision, `run-loop/LAPORAN.md`). No Phase 8 code has been executed. Baseline 0a is done: build passes; integration passes except the egress file; E2E passes 63 with two honesty-invariants flakes that pass alone (fixed by plan 08-17). The egress baseline (0a2) was parked while `binaries.prisma.sh` sent no bytes on GET (07.45 to 09.09); the host recovered and the test waits for the Rekriva regression to finish.
Last activity: 2026-11-08 — Phase 10 parked after its third Codex plan review (K27); Phases 8 and 9 were parked the same way (K24, K25). v1.0.0 stays complete and archived; its archives are `milestones/v1.0.0-*`.

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
- **Testcontainers on this Mac (Colima):** `pnpm test:integration` and `pnpm test:e2e` need `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` on the command; the `docker` CLI works through its context, Testcontainers does not. Never restart or reconfigure Colima for this.
- **Repeated `pnpm test:e2e` runs** can leave `.next/dev/types/*.d.ts` truncated and break `tsc`/`pnpm build` — delete the gitignored `.next/` and rebuild.

### Deferred Items

Items deferred during v2.0 (run loop):

| Category | Item | Status |
|----------|------|--------|
| verification_gap | Phase 11 — `11-VERIFICATION.md` (2026-11-08) | `human_needed` — no code gap; AIDA-47 to 51 verified. Open for a human: visual approval and dark mode of the Phase 11 screens, the 360px and long-text backstops (11-04 to 11-08), the 11-06 backstop of a bulk status change moving tickets out of the filter, and the D-14 screen-reader check of single-letter keys. Also open: full `pnpm test:integration` and `pnpm test:egress` (blocked, O-1); owner item O-2 (auto-close customer notice) |
| verification_gap | Phase 12 — `12-VERIFICATION.md` (2026-11-09) | `human_needed` — no code gap; AIDA-52, 54 and 55 verified; AIDA-53 verified except the "full `AuditEvent`" clause (owner item 12-o1). Open for a human: visual pass and dark mode of the Phase 12 screens (UI-SPEC E1 to E11), layout widths, screen-reader check, the Asia/Jakarta time-zone check, the deferred copy decisions (IN-06, R2-3), and the two judgment-tier privacy rules in plans 12-01 and 12-04. Full integration and `test:egress` blocked (O-1). |
| verification_gap | Phase 12.1 — `12.1-VERIFICATION.md` (2026-11-09) | `human_needed` — no code gap; AIDA-56, 97, 57 verified (8/8). Open for a human: visual and dark-mode approval, contrast by eye, screen reader, 360px layout checks, UAT. K47 (stale flag after resume when a priority change extended deadlines during a pause) deferred. Full integration and `test:egress` blocked (O-1). |
| verification_gap | Phase 12.2 — `12.2-VERIFICATION.md` (2026-11-09) | `human_needed` — no code gap; AIDA-18 verified (11/11). Open for a human: visual and dark-mode approval of every 12.2 surface including the darker light `--destructive` token, screen reader, the UI-SPEC amendments A1 to A8 and the F3 copy and focus gaps no UI checker reviewed, the backstop rows E2 to E5, reading a real provider's article, the three server-side send-failure outcomes (A1, A3, A5) proven only statically and by server tests, UAT. Owner items 12.2-o1 to 12.2-o4. Full integration and `test:egress` blocked (O-1). |

Items acknowledged and deferred at milestone close on 2026-09-13 (override closeout; 23 items reported by `gsd-tools query audit-open`, plus AIDA-18):

| Category | Item | Status |
|----------|------|--------|
| verification_gap | Phase 05 — `05-VERIFICATION.md` | `human_needed` — only the aesthetic DESIGN-SYSTEM §9 visual pass (light/dark) remains; the mechanical half was closed by 07-09.1's contrast/token tests |
| uat_gap | Phase 05 — `05-HUMAN-UAT.md` item 3 | file `closed`, 1 pending scenario (same visual pass) |
| uat_gap | Phase 06 — `06-HUMAN-UAT.md` item 3 | `partial` — subjective real-LLM Insight quality (cluster labels / KB-gap matches); objective half closed by `honesty-invariants.spec.ts` |
| verification_gap (implicit) | Phase 01 — no `01-VERIFICATION.md` | phase closed via 01-08 human gate + `01-UAT.md` complete; artefact never written. Scheduled: AIDA-39, Phase 9 |
| requirement | AIDA-18 KB auto-generation | scheduled in v2.0, Phase 12 |
| deferred_item | Phase 02 — CRLF vs LF formatter mismatch (2 entries) | RESOLVED in 07-01 (`.gitattributes`) — tool cannot parse the annotation |
| deferred_item | Phase 02 — import order in `src/lib/worker/index.ts` | RESOLVED in 07-01 (was already correct) |
| deferred_item | Phase 02 — `gsd-tools requirements mark-complete` not_found (2 entries) | RESOLVED in 07-01 (REQUIREMENTS.md restructured) |
| deferred_item | Phase 02 — `gsd-tools state update-progress` / `add-decision` no-op | still true — documented under Key Decisions |
| deferred_item | Phase 02 — Turbopack "unexpected file in NFT list" build warning | pre-existing, cosmetic, open |
| deferred_item | Phase 05 — CRLF vs LF (same root cause) | RESOLVED in 07-01 |
| deferred_item | Phase 07 — enable GitHub Pages (Source = GitHub Actions) | human-only; in `LAUNCH.md` |
| deferred_item | Phase 07 — verify `afrizzal.github.io/aida` renders with CSS after first deploy | human-only; in `LAUNCH.md` |
| seeds | SEED-001 … SEED-010 (Plane-inspired v2 candidates) | all scheduled in v2.0; mapping in `REQUIREMENTS.md`. Seed files stay unchanged |

Also open (not audit items): `milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md` — no logo upload, no invite flow (→ SEED-007), no backup scheduler, `POSTGRES_PASSWORD` not URL-encoded in `docker-compose.yml`'s `DATABASE_URL`, duplicate `<h1>` per app page — and `07-SECURITY-PASS.md`'s accepted-for-v1 known issues (sharp CVEs, root containers, spoofable XFF, SSRF error oracle, two unthrottled public routes, build-time third-party egress, no CSP).

### Open Todos

- **LAUNCH.md (maintainer-only; blocks the public release):** replace the placeholder contact `security@aida-helpdesk.example` in `CODE_OF_CONDUCT.md` and `.github/SECURITY.md` (keep identical); re-run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` on a clean checkout; repository settings (public, About, topics, social preview, Discussions, Pages = GitHub Actions, private vulnerability reporting); `git tag -a v1.0.0` + push + `gh release create`; post-release checks; outreach. The tag was deliberately **not** created by the milestone close.
- Push local `master` to `origin` (ahead by the Plane-research commit and the milestone-close commits).
- Human passes still pending: Phase 5 aesthetic §9 visual pass (light/dark); Phase 6 real-LLM Insight quality check.
- Disk hygiene: ~34 stale `.claude/worktrees` directories (~11 GB), all merged/superseded (verified 2026-08-02 against `9b475b7`); deletion is the maintainer's call — `git worktree prune` + `branch -d` is the sanctioned automated part.

### Blockers

- Phases 8, 9 and 10 are parked: each third Codex plan review left HIGH findings (accepted, not incorporated; see each phase's REVIEWS.md). Unparking is the owner's decision (`run-loop/LAPORAN.md` section 3). Phases 13, 16 and 17 are parked by the charter's dependency chain.
- Owner item O-1 (container tests on the shared Docker VM) keeps `pnpm test:egress` and the egress file of `pnpm test:integration` blocked (K26).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260705-bau | middleware 401 JSON for unauthenticated /api/* + truly-anonymous e2e context | 2026-07-05 | e0fb9e5 | [260705-bau-middleware-401-json-for-unauthenticated-](./quick/260705-bau-middleware-401-json-for-unauthenticated-/) |
| 260705-kg0 | fix Phase 2 UI-review priority findings: error boundaries, request-form typography, chip-row wrap | 2026-07-05 | a887ce6 | [260705-kg0-fix-phase-2-ui-review-priority-findings-](./quick/260705-kg0-fix-phase-2-ui-review-priority-findings-/) |
| 260904-8h1 | Bump `@anthropic-ai/sdk` 0.110.0 → 0.123.0 + add `claude-opus-5` to `MODEL_CATALOG` (post-v1 follow-up; biome/tsc/unit 90/90/integration 30/30 green; lockfile changed only for the SDK) | 2026-09-04 | acbe670 | [260904-8h1-bump-anthropic-ai-sdk-0-110-0-0-123-0-an](./quick/260904-8h1-bump-anthropic-ai-sdk-0-110-0-0-123-0-an/) |

## Session Continuity

**Last session:** 2026-11-08T23:33:18.749Z
**Stopped at:** Completed 14-01-PLAN.md; Phase 14 executing, Wave 2 next (2026-11-09)
**Resume file:** .planning/run-loop/ANTREAN.md

**Last action (2026-11-08):** Phase 10 parked after the third Codex plan review (2 HIGH findings accepted, not yet incorporated). No tag, nothing pushed.

**Next action:** follow `run-loop/PIAGAM.md`; the first open row of `run-loop/ANTREAN.md` decides the next step.

## Operator Next Steps

- Read `run-loop/LAPORAN.md`. Branch `v2/run-loop` is a draft for the owner to review and apply.
