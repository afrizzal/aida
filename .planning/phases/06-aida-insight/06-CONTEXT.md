# Phase 6: AIDA Insight - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Source:** User directive (plan-phase 6 session) + orchestrator codebase grounding — user delegated decisions ("lakukan yang terbaik, saya percayakan pada anda")

<domain>
## Phase Boundary

AIDA Insight (AIDA-17): an AI-driven analytics surface — **analysis, not just dashboards**. Deliverables:

1. **Recurring-issue clustering** — tickets in a period are embedded and clustered; each cluster gets an AI-generated name plus a cited example set of member tickets.
2. **KB gap detection** — clusters of frequent questions whose best-matching KB article scores below a similarity threshold are flagged as gaps, citing member tickets and the nearest existing article.
3. **Volume drivers** — top ticket-volume drivers over the period (category, tags, contact/company) with delta vs. the previous equal-length period. Pure SQL numbers.
4. **SLA/CSAT insight summary** — SLA stats (breach rate, at-risk, avg first-response/resolution times) from existing Ticket SLA fields + CSAT aggregates. Because v1 has **no CSAT data source yet**, this phase also adds a **minimal CSAT capture**: a 1–5 rating (+ optional comment) on the existing public ticket-status page (statusToken) once a ticket is RESOLVED/CLOSED.
5. All compute runs as a **pg-boss job** (`insight-run`) — never blocking the UI. Results persist in an `InsightRun` row; the `/insights` page renders stored results instantly.
6. Outputs **cite underlying tickets** (links) and are **reproducible**: run stores period, params/thresholds, embedding model, LLM provider+model, and full cluster membership.

Out of scope: AIDA-18 (AI-drafted KB article from gaps — stretch/backlog), scheduled/cron insight runs, CSAT email campaigns, per-agent performance leaderboards.

</domain>

<decisions>
## Implementation Decisions

### Plan style (user directive — LOCKED)
- Plans MUST contain the actual formulas, algorithms, SQL statements, Zod schemas, and function signatures — the high-level thinking is done at plan time (Opus). The executor (Sonnet) implements from plan text alone without re-deriving math or design. Verbose plans are the point; do not summarize an algorithm when you can state it.

### Data model
- New model `InsightRun`: org-scoped; fields ≈ `id, organizationId, status (InsightRunStatus enum: PENDING/RUNNING/COMPLETED/FAILED), periodDays Int, periodStart DateTime, periodEnd DateTime, params Json, clusters Json?, kbGaps Json?, volumeDrivers Json?, slaCsat Json?, narrative Json?, ticketCount Int?, embeddingModel String?, provider String?, model String?, error String?, createdAt, completedAt?`. One row per run; UI reads latest COMPLETED per (org, periodDays).
- New model `TicketEmbedding`: embedding cache; `ticketId + embeddingModel` unique; `embedding Unsupported("vector(768)")`; org-scoped. Computed **lazily inside the insight run** (only tickets in period missing a cached vector are embedded, batched) — NOT at ticket creation (keeps AI-off installs zero-cost).
- New model `CsatResponse`: `ticketId` unique (one per ticket, upsert = latest wins), `score Int` (1–5), `comment String?`, org-scoped.
- All three models are appended to `DOMAIN_MODELS` in `src/lib/scoped-db.ts`. All vector I/O uses raw SQL with explicit `organizationId` filter (mirror `KbChunk`/`retrieve.ts` discipline — scopedDb does not intercept `$queryRaw`).
- Widen `AuditActionType` with `INSIGHT_CLUSTER_LABELS` and `INSIGHT_SUMMARY`.

### Clustering (deterministic, no ML deps — LOCKED)
- Embed `subject + "\n" + first ~500 chars of first PUBLIC inbound message` (redacted) via the existing `embed()` port (768-dim, same provider settings as RAG).
- Cluster in TypeScript with **deterministic greedy leader clustering**: iterate tickets ordered by `createdAt ASC, id ASC`; assign to the first cluster whose leader-centroid cosine similarity ≥ threshold, else start a new cluster; centroid = normalized mean, updated incrementally. No random seeds, no k-means, no new dependencies. Same data + same params ⇒ identical membership.
- A cluster is "recurring" (reported) only when size ≥ 3. Exact similarity thresholds are Claude's discretion (research recommends defaults; stored in `params` for reproducibility).
- **LLM never chooses membership and never outputs ticket IDs.** It receives representative redacted examples per cluster and returns only `{ label, description }` via the existing `complete()` port (Zod schema-forced, no tools — D-16 structural guarantee). Citations are attached programmatically from clustering output.

### KB gap formula (LOCKED)
- For each reported cluster: KNN the cluster centroid against `KbChunk` (org + embeddingModel filtered, cosine `<=>`). `coverage = 1 - bestDistance`. If `coverage < GAP_THRESHOLD` → KB gap: cite member tickets, nearest article (title/slug/score) or "no article", and the cluster label. Threshold value = Claude's discretion, recorded in `params`.
- If the org has zero embedded KB articles, every reported cluster is a gap (explicitly stated in UI, not an error).

### Volume drivers + SLA/CSAT (SQL-only — LOCKED)
- Aggregations are **pure SQL/Prisma** (groupBy on `triageCategory`, tags, contact company; counts, deltas vs previous equal-length period; SLA: breach rate, at-risk count, avg(firstRespondedAt - createdAt), avg(resolvedAt - createdAt); CSAT: avg score, response count, distribution). No LLM involvement in any number.
- The LLM writes ONE short narrative summary from the computed aggregates only (schema-forced; aggregates passed as data; advisory text clearly presented as AI-generated). Numbers rendered in the UI always come from the stored SQL aggregates, never parsed from the narrative.

### AI-off behavior (AIDA-13 — LOCKED)
- With AI toggled off, `/insights` still works: volume drivers + SLA/CSAT sections compute and render (SQL-only). Clustering/KB-gap/narrative sections show the design-system empty state ("AI is off / configure a provider"). The insight-run job runs the SQL sections regardless and skips AI sections cleanly.

### Job & trigger (LOCKED)
- Queue name `insight-run`, payload `{ insightRunId }`, created in BOTH `src/lib/queue/boss-client.ts` and `src/lib/worker/index.ts` with the exact `kb-embed-article` retry shape (`retryLimit: 2, retryBackoff: true, retryDelayMax: 300`). Handler in `src/lib/worker/jobs/insight-run.ts`; insight lib modules (`src/lib/insight/`) are worker-bundleable ⇒ **relative imports only** (no `@/`), mirroring `src/lib/rag/`.
- Trigger: on-demand "Generate insights" button on `/insights` (agents and admins). App-side guard: an existing PENDING/RUNNING run for the same org+periodDays is returned instead of enqueuing a duplicate. **No cron schedule in v1** (BYO-key cost control).
- Job must be idempotent per run row (re-entrant on pg-boss retry: recompute and overwrite its own sections).

### Trust & governance (AIDA-19/20 — LOCKED)
- Ticket text is untrusted: excerpts pass through existing `redact.ts` before any LLM call; prompts treat ticket content as data; schema-forced output; zero tool-calling.
- Every insight LLM call writes an `AuditEvent` (redacted input, full output, provider, model) with the new action types.

### CSAT capture (LOCKED)
- On the existing public status page: when ticket is RESOLVED/CLOSED show "How did we do?" — 1–5 rating + optional comment, submitted with the statusToken as auth, rate-limited like other public endpoints, upsert per ticket. No new email sends.

### UI (LOCKED)
- Route `(app)/insights`; sidebar item added per DESIGN-SYSTEM sidebar rules. Period presets: 7 / 30 / 90 days. Sections as cards: Recurring Issues, KB Gaps, Volume Drivers, SLA & CSAT — each with cited ticket links (`/tickets/{id}` pattern used by the app). Run status indicator + "Last generated {relative time}" (reuse `format-relative-time.ts`). **No new chart library** — distributions rendered as CSS/Tailwind bar rows. All UI conforms to `.planning/DESIGN-SYSTEM.md` (token-only colors, empty-state halo pattern, `text-[Npx]` typography); design checklist §9 runs before phase completion.

### Claude's Discretion
- Exact threshold defaults (cluster similarity, gap coverage), excerpt length, embed batch size, max clusters rendered, centroid update math details, SQL vs Prisma groupBy per aggregate, copy text, card micro-layout, Zod schema field names, test framework usage per existing repo conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product & phase scope
- `.planning/ROADMAP.md` — Phase 6 success criteria (4 items) + requirement mapping (AIDA-17)
- `.planning/REQUIREMENTS.md` — AIDA-17 wording; AIDA-13/19/20 constraints that bind this phase
- `CLAUDE.md` — non-negotiables: model-agnostic LLM, privacy-first, human-in-the-loop, honest claims

### Existing patterns to mirror (source of truth)
- `src/lib/rag/embed.ts` + `src/lib/rag/types.ts` — the ONE embedding port (768-dim) insight must reuse
- `src/lib/rag/retrieve.ts` + `src/lib/rag/vector-literal.ts` — org-scoped raw-SQL KNN discipline to replicate for TicketEmbedding/KbChunk queries
- `src/lib/llm/complete.ts` + `src/lib/llm/types.ts` — schema-forced completion port (no tools); `src/lib/llm/redact.ts` — redaction before LLM/audit
- `src/lib/worker/index.ts` + `src/lib/queue/boss-client.ts` — pg-boss v12 queue creation/work/enqueue pattern (`kb-embed-article` is the template)
- `src/lib/scoped-db.ts` — DOMAIN_MODELS allowlist to extend
- `prisma/schema.prisma` — KbChunk shows the `Unsupported("vector(768)")` + raw-SQL pattern; Ticket has all SLA/triage fields the aggregates need
- `.planning/DESIGN-SYSTEM.md` — binding UI contract (no UI-SPEC.md for this phase; this file is the contract)

</canonical_refs>

<specifics>
## Specific Ideas

- User's explicit intent: "plan anda yang berisi rumus perhitungan atau function tingkat tinggi itu di implementasi [oleh executor] agar hemat token" — plans carry the math (similarity formulas, centroid update, gap threshold logic, SQL aggregates, Zod schemas) verbatim so execution is mechanical.
- Reproducibility phrasing from roadmap: "Outputs cite the underlying tickets/data and are reproducible (not free-floating prose)" — every AI sentence in the UI sits next to the deterministic data it derives from.
- Quality gates: `tsc --noEmit` clean; unit tests for clustering math, gap formula, and aggregates (pure functions ⇒ easily testable); E2E via existing Playwright setup (`volta run --node 22.23.1` quirk noted in project memory).

</specifics>

<deferred>
## Deferred Ideas

- AIDA-18: propose a drafted KB article from a detected gap (stretch — backlog; the KB-gap card may later grow a "Draft article" action)
- Cron-scheduled/weekly automatic insight runs (v1 is on-demand only)
- CSAT request emails / campaigns (v1 captures on the status page only)
- Trend history across many runs (v1 compares current vs previous period only)
- Per-agent performance analytics (privacy-sensitive; needs its own discussion)

</deferred>

---

*Phase: 06-aida-insight*
*Context gathered: 2026-07-24 via user delegation + orchestrator grounding*
