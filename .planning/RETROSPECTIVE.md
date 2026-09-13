# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0.0 — Minimum Lovable Helpdesk

**Shipped:** 2026-09-13 (code-complete, verified, archived; public tag + GitHub release still owned by `LAUNCH.md`)
**Phases:** 7 | **Plans:** 60 (+3 quick tasks) | **Tasks:** 154 | **Commits:** 401 over 78 days (2026-06-28 → 2026-09-13) | **Sessions:** not tracked

### What Was Built
- Multi-tenant ticketing core: shared inbox with FTS, contacts, tags + custom fields, SLA timers with breach/at-risk flags, attachments, public intake form + tokenized status page, CSAT capture
- Email channel: IMAP ingest with thread matching / auto-reply detection / poison guard, SMTP replies with threading headers, encrypted settings + Test Connection
- Model-agnostic LLM port (OpenAI / Anthropic / Ollama) with secret redaction, prompt fencing, structured outputs, zero tool surface, and a DB-enforced append-only audit trail; advisory auto-triage
- RAG knowledge base: chunk → embed (pgvector, 768-dim) → org-scoped KNN → grounded, cited draft behind an Insert-then-Send human gate (`DRAFT_APPROVED` audit)
- AIDA Insight: deterministic clustering + SQL aggregates + KB-gap KNN + schema-forced narrative, with SQL numbers that a hostile model output provably cannot move
- Launch kit: demo dataset + `DEMO_MODE`, backup/restore scripts + ops runbook, CI + community files, Starlight docs site, star-ready README + hero GIF, written security pass with a runtime egress proof

### What Worked
- MVP-first sequencing — every phase shipped something usable before the riskiest AI work started; AI wiring in Phases 4–6 stayed thin because Phases 1–3 established single entrypoints (`createTicket`, `complete<T>`, `recordAuditEvent`, `scopedDb`)
- Testcontainers integration tests as the proof standard (tenant isolation, 20-way concurrency, deny-all-network egress) — they found real defects that static review had catalogued as "known, low priority"
- Gap-closure plans (04-07, 07-09.1) that turn carried-forward human verification items into automated tests instead of letting them ride phase to phase
- Design-system rules made mechanical (`tests/unit/design-tokens.test.ts`, axe contrast e2e) so "token-only" is a command, not a review opinion
- Balanced model profile (Opus plans/verifies, Sonnet executes): 60 plans executed with no recorded quality complaint; parallel waves of up to 5 plans worked whenever file ownership was disjoint

### What Was Inefficient
- CRLF drift recurred six times across Phases 2–6 before `.gitattributes` landed in 07-01 — repo hygiene should have been a Phase 1 deliverable
- gsd-tools STATE.md commands (`state update-progress`, `add-decision`) no-op on this hand-written STATE.md and `phase.complete` / `milestone.complete` degrade it — every close-out needed manual repair (documented from 02-05 onward, still true at milestone close)
- Human-verification items were carried 4 → 5 → 6 → 7 before 07-09.1 automated them; the aesthetic/subjective halves are still open
- Parallel worktree agents needed `--no-verify` to avoid hook contention and left ~34 stale worktree directories (~11 GB) behind
- STATE.md grew to 174 KB (a context tax on every session) — trimmed only at this close; `milestones/v1.0.0-STATE.md` keeps the full log

### Patterns Established
- Relative-import-only modules for anything both the Next.js app and the esbuild-bundled worker read (no `@/` alias in the worker)
- Ticket / KB / any external text is untrusted: fenced prompts, schema-forced outputs, no tool calling, redaction before the LLM and before logs
- Seeded AI artifacts are honestly stamped (`provider: "demo"`, `model: "demo-seed"`); demo mode is a strict `=== "true"` gate with a loud boot warning
- Every phase has a hard stop condition that is a command (`tsc --noEmit`, unit/integration/e2e, design checklist) — "the agent says it's done" is never the gate
- Deferred items get an owner and a disposition in one place; nothing stays open in two documents

### Key Lessons
1. A runtime proof beats a static sweep for a runtime claim — the Prisma CLI `checkpoint.prisma.io` egress was only caught by running the real image on an `internal: true` network with a logging DNS resolver and a negative control
2. Lint autofixes are not semantically safe by default — Biome's `noEmptyPattern` rename broke Playwright's fixture parser and every e2e test; verify against any framework that gives structural meaning to a parameter shape
3. Two independent time parameters in fixtures (`ageHours` vs `slaState`) will drift — derive one from the other and assert the invariant in a test
4. After any gsd-tools mutation of STATE/ROADMAP, `git diff` and repair before committing
5. Repo health is a real phase, not a wrap-up — README/GIF/docs/CI/security took 13 plans; budget it explicitly in the next milestone
6. Brand colors need two tiers (background vs text) to pass WCAG AA everywhere; decide this before screenshots are approved, because a color change re-opens the whole capture set

### Cost Observations
- Model mix: balanced profile (Opus for plan / discuss / verify, Sonnet for execute); percentages not measured
- Sessions: not tracked
- Notable: the biggest token sinks were STATE.md size and re-running e2e suites back-to-back (truncated `.next/dev/types` artifacts); the biggest saver was disjoint-file parallel waves

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0.0 | n/a | 7 | GSD from day one; loop architecture written down (`LOOP-ENGINEERING.md`); design system codified and mechanically enforced (`DESIGN-SYSTEM.md`); gap-closure plans replace carried-forward manual verification |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0.0 | unit 90 (18 files) · integration 30 (12 files, Testcontainers) · e2e suites for phases 4–6 + a11y (8) + honesty invariants (2) + uat-gaps (9); last full green gate run 2026-09-03 (07-12) | not measured | leader clustering, Postgres rate limiter, AES-GCM secret box, markdown sanitizer plugin, FileStorage abstraction — all in-repo instead of new dependencies |

### Top Lessons (Verified Across Milestones)

1. (one milestone so far) Runtime proofs over static sweeps for runtime claims — re-check after the next milestone
2. (one milestone so far) Hard stop conditions as commands — re-check after the next milestone
