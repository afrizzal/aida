# Milestones

## v1.0.0 Minimum Lovable Helpdesk (Shipped: 2026-09-13)

**Phases completed:** 7 phases, 60 plans (+3 quick tasks), 154 tasks
**Timeline:** 2026-06-28 → 2026-09-13 (78 days) · 401 commits · 564 files · ~17.4k LOC TypeScript in `src/` + ~6.2k LOC tests
**Git range:** `8379a00` (init) → `843c17a`; first feature commit `30b1ded` feat(01-01) → last `d50f405` feat(quick-260904-8h1)
**Closeout:** override_closeout — Known verification overrides: 23 (see `STATE.md` → Deferred Items). Git tag deliberately not created at close; `LAUNCH.md` owns the `v1.0.0` tag + GitHub release once its pre-tag checks pass.

**Delivered:** A self-hostable, AI-native helpdesk — shared inbox with email/web intake, model-agnostic auto-triage, citation-backed RAG drafts behind a human gate, and AIDA Insight analytics — that a stranger can `docker compose up` (optionally with `DEMO_MODE`) and evaluate, backed by a star-ready README, a docs site, CI, backup/restore scripts and a written security pass with a runtime egress proof.

**Key accomplishments:**

1. **Ticketing core (Phases 1–2):** Next.js 16 + Prisma 7 + Better Auth (org/admin) on PostgreSQL 16 + pgvector, `scopedDb` tenant scoping proven by never-mocked isolation tests, shared inbox with full-text search, contacts, tags + custom fields, SLA timers with breach/at-risk flags, attachments, public intake form + tokenized status page — all behind `docker compose up`.
2. **Email channel (Phase 3):** IMAP-polled inbound ingest with thread matching, auto-reply detection, sanitization and a poison-message guard; SMTP replies with correct threading headers; AES-256-GCM encrypted settings with real Test Connection probes.
3. **AI foundation (Phase 4):** one model-agnostic `complete<T>()` port (OpenAI / Anthropic / Ollama) with secret redaction, fenced prompts, structured outputs and zero tool surface; advisory auto-triage; a DB-trigger-enforced append-only `AuditEvent` log; AI fully toggleable off.
4. **RAG drafted replies (Phase 5):** KB authoring → heading-based chunking → 768-dim embeddings in pgvector → org-scoped KNN → grounded, cited draft that an agent must Insert-then-Send, recorded as `DRAFT_APPROVED`.
5. **AIDA Insight (Phase 6):** deterministic recurring-issue clustering, KB-gap detection, volume drivers and SLA/CSAT summary from org-scoped SQL, plus a schema-forced narrative that provably cannot alter the numbers; public CSAT capture.
6. **Launch readiness (Phase 7):** 30-ticket demo dataset + `DEMO_MODE` cold-boot seeding, backup/restore round trip, CI + community files, Astro Starlight docs site, star-ready README with a live-recorded hero GIF, security pass with an automated deny-all-network egress test, WCAG-AA contrast enforcement, `CHANGELOG.md` + `LAUNCH.md`.

### Known Gaps

- **AIDA-18** (Stretch) — KB auto-generation from resolved tickets: backlog, never scheduled in v1.
- Human checks still open: Phase 5 aesthetic DESIGN-SYSTEM §9 pass (light/dark); Phase 6 real-LLM Insight quality (the objective halves were automated in 07-09.1).
- Accepted v1 product gaps: no team invite flow, no logo upload, no backup scheduler, `POSTGRES_PASSWORD` not URL-encoded in `DATABASE_URL`, duplicate `<h1>` per app page — `milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md`.
- Accepted security known issues (sharp CVEs, root containers, spoofable XFF, SSRF error oracle, two unthrottled public routes, build-time third-party egress, no CSP): `milestones/v1.0.0-phases/07-launch-readiness/07-SECURITY-PASS.md`.

### Archives

- `milestones/v1.0.0-ROADMAP.md` — full phase details, plan lists, success criteria + milestone summary
- `milestones/v1.0.0-REQUIREMENTS.md` — 23/24 requirements complete (AIDA-18 pending)
- `milestones/v1.0.0-STATE.md` — full pre-close STATE.md (per-plan decision log)
- `milestones/v1.0.0-phases/` — every phase artifact (plans, summaries, research, UAT, verification, reviews, deferred items)
- `RETROSPECTIVE.md` — what worked, what was inefficient, lessons
