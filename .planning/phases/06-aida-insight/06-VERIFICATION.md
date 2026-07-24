---
phase: 06-aida-insight
verified: 2026-07-25T02:10:00Z
status: passed
score: 4/4 must-haves verified
human_verification:
  - test: "Visually review the /insights page (light + dark mode) at 7/30/90-day tabs with a real generated run"
    expected: "Four cards render cleanly per DESIGN-SYSTEM.md (token-only colors, halo empty-state, CSS bar rows), 'Generate insights' shows 'Generating…' while PENDING/RUNNING, and 'Last generated {relative time}' updates after completion"
    why_human: "Visual layout/spacing/dark-mode fidelity and real-time button-state feel cannot be verified by grep/tsc"
  - test: "Submit a CSAT rating on a real RESOLVED/CLOSED ticket's public status page, then re-visit the page"
    expected: "The 1-5 Star control is clickable, submits without a page reload glitch, shows 'Thanks for your feedback!', and re-visiting shows the prefilled existing rating"
    why_human: "End-user visual/interaction flow on the public page cannot be verified by grep/tsc"
  - test: "Run a real 'Generate insights' against an org with real ticket history and a real configured LLM/embedding provider (not the mocked integration-test boundary)"
    expected: "Cluster labels are semantically sensible for the actual ticket content, KB-gap nearest-article matches look reasonable, and the AI narrative reads naturally next to the SQL numbers it describes"
    why_human: "LLM output quality/semantic relevance for real production ticket data cannot be judged by automated checks — the integration test only proves the pipeline wiring with a canned mock response"
---

# Phase 6: AIDA Insight Verification Report

**Phase Goal:** AIDA Insight — AI-driven analytics (recurring issues, KB gaps, volume drivers, SLA/CSAT)
**Verified:** 2026-07-25T02:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Insight clusters recurring issues across tickets and names each cluster with an example set | ✓ VERIFIED | `src/lib/insight/cluster.ts` (`leaderCluster`, deterministic, unit-tested 7/7) composed in `run-insight.ts` with `cluster-label-prompt.ts`'s schema-forced LLM labeling; integration test (`tests/integration/insight-run.test.ts`) asserts real clusters with labels `"Login issues"`/`"Billing questions"` and non-empty `citations` (ticketId/number/subject) — passed live against Testcontainers Postgres |
| 2 | It flags knowledge-base gaps (frequent question themes with no good KB article) | ✓ VERIFIED | `src/lib/insight/kb-gap.ts` (`nearestKbChunk` pgvector KNN + `scoreGap`, 4/4 unit-tested boundary cases) wired in `run-insight.ts`; integration test seeds zero KB chunks and asserts `kbGaps.length > 0` with `coverage: null` for every gap (zero-KB shortcut) — passed live; `KbGapsCard` renders the explicit "No KB articles exist yet" copy |
| 3 | It surfaces top ticket-volume drivers over a period and an SLA/CSAT insight summary | ✓ VERIFIED | `src/lib/insight/volume-drivers.ts` (`computeVolumeDrivers`, raw-SQL category/tag/company + previous-period delta) and `sla-csat.ts` (`computeSlaCsat`, breach/at-risk/avg-duration/CSAT); integration test asserts real `byCategory`/`byTag`/`byCompany` presence and CSAT `responseCount: 2`, `averageScore: 4.5`, `distribution.length: 5` — passed live; `VolumeDriversCard`/`SlaCsatCard` render both with real SQL numbers |
| 4 | Outputs cite the underlying tickets/data and are reproducible (not free-floating prose); compute runs as a pg-boss job, not blocking the UI | ✓ VERIFIED | Citations built exclusively from `leaderCluster`'s `memberIds` (grep-confirmed, never from LLM output — Pitfall 8); integration test's Run-2 asserts byte-identical cluster membership vs Run-1 (reproducibility); `insight-run` queue registered in both `boss-client.ts` and `worker/index.ts` with `insightRunHandler` (load→RUNNING→compute→COMPLETED/FAILED); `generateInsightRun` Server Action only enqueues (`boss.send`) and returns immediately — no blocking compute in the request path |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `prisma/schema.prisma` | InsightRun/TicketEmbedding/CsatResponse models + InsightRunStatus + widened AuditActionType | ✓ VERIFIED | All present (lines 241, 516, 523, 549, 564); `vector(768)` Unsupported field on TicketEmbedding confirmed |
| `prisma/migrations/20260724171144_insight_aida/migration.sql` | CREATE TABLE x3, no spurious searchVector DROP | ✓ VERIFIED | 3 CREATE TABLEs present; grep confirms no `DROP COLUMN "searchVector"` |
| `src/lib/insight/types.ts` | Persisted-shape contract, zero imports | ✓ VERIFIED | 83 lines, all 9 interfaces exported, zero imports |
| `src/lib/scoped-db.ts` | DOMAIN_MODELS extended | ✓ VERIFIED | InsightRun/TicketEmbedding/CsatResponse present (lines 29-31) |
| `src/lib/audit/record-audit-event.ts` | Widened actionType union | ✓ VERIFIED | INSIGHT_CLUSTER_LABELS/INSIGHT_SUMMARY present |
| `src/lib/insight/cluster.ts` | l2Normalize + leaderCluster | ✓ VERIFIED | 65 lines, zero imports, 7/7 unit tests pass |
| `src/lib/insight/excerpt.ts` | buildTicketExcerpt, redact-then-slice | ✓ VERIFIED | 14 lines, redactSecrets called before slice |
| `src/lib/insight/ticket-embeddings.ts` | readPeriodTickets/readCachedEmbeddings/writeNewEmbeddings | ✓ VERIFIED | 102 lines, org-scoped, ORDER BY createdAt ASC, id ASC confirmed |
| `src/lib/insight/volume-drivers.ts` | periodMath + computeVolumeDrivers | ✓ VERIFIED | 98 lines, explicit organizationId filters, unit-tested |
| `src/lib/insight/sla-csat.ts` | computeSlaCsat | ✓ VERIFIED | 105 lines, Pitfall-4 at-risk/breach split confirmed |
| `src/lib/insight/kb-gap.ts` | nearestKbChunk + scoreGap | ✓ VERIFIED | 42 lines, `<=>` KNN with org+model filter, LIMIT 1 |
| `src/lib/insight/cluster-label-prompt.ts` | Schema-forced label/description, no ID field, fenced | ✓ VERIFIED | 35 lines, no ticketId/citations field in schema, fenceContent used |
| `src/lib/insight/narrative-prompt.ts` | Single-summary schema | ✓ VERIFIED | 27 lines, one `summary` field only |
| `src/lib/insight/run-insight.ts` | Orchestrator | ✓ VERIFIED | 240 lines, composes all Wave-2 modules, two recordAuditEvent calls, defense-in-depth AI gate |
| `src/lib/worker/jobs/insight-run.ts` | insightRunHandler | ✓ VERIFIED | 29 lines, load→RUNNING→compute→COMPLETED/FAILED+rethrow |
| `src/lib/queue/boss-client.ts` / `src/lib/worker/index.ts` | insight-run queue registration | ✓ VERIFIED | Both files register `createQueue("insight-run", {retryLimit:2,...})`; worker also `boss.work` |
| `src/app/api/public/status/[token]/csat/route.ts` | CSAT POST endpoint | ✓ VERIFIED | 73 lines, RESOLVED/CLOSED gate, honeypot, rate-limit, upsert |
| `src/app/(public)/status/[token]/csat-form.tsx` + `page.tsx` | Public CSAT capture UI | ✓ VERIFIED | Form + gated render confirmed |
| `src/app/(app)/insights/page.tsx` | Server Component, force-dynamic, 4 cards | ✓ VERIFIED | 91 lines, `force-dynamic` present, Json casts, halo empty-state |
| `src/app/(app)/insights/actions.ts` | generateInsightRun | ✓ VERIFIED | PENDING/RUNNING guard + `boss.send("insight-run", ...)` |
| Four insight cards | Token-only, cited, CSS bars | ✓ VERIFIED | No hex/oklch/named sizes/chart-lib imports found |
| `src/components/sidebar.tsx` | Insight nav item | ✓ VERIFIED | `/insights` + Lightbulb icon present |
| Unit tests (cluster/aggregates/prompts) | Coverage of pure logic | ✓ VERIFIED | 16/16 tests pass (`node vitest run`) |
| `tests/integration/insight-run.test.ts` | End-to-end + reproducibility + AI-off | ✓ VERIFIED | 1/1 passed against real Testcontainers Postgres |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `record-audit-event.ts` | `AuditActionType` | widened union | WIRED | INSIGHT_CLUSTER_LABELS/INSIGHT_SUMMARY both present |
| `excerpt.ts` | `../llm/redact.ts` | `redactSecrets()` before slice | WIRED | Confirmed in source; integration test proves the seeded `FAKE_SECRET` never appears in the audited input, and `input` contains `[redacted]` |
| `ticket-embeddings.ts` | `../rag/embed.ts` | batched `embed()` + `ON CONFLICT DO NOTHING` | WIRED | Confirmed in source (idempotent cache write) |
| `volume-drivers.ts`/`sla-csat.ts` | Ticket/TicketTag/Contact/CsatResponse | raw `$queryRaw` + explicit organizationId | WIRED | Grep-confirmed on every raw query |
| `kb-gap.ts` | `KbChunk` | `<=>` pgvector KNN, org+model filter | WIRED | Confirmed; integration test exercises the zero-KB-chunk shortcut branch |
| `cluster-label-prompt.ts` | `../rag/prompt-safety.ts` | `fenceContent("ticket_excerpt", ex)` | WIRED | Confirmed; unit test proves injected `</ticket_excerpt>` neutralized |
| `run-insight.ts` | `complete()` + `recordAuditEvent()` | 2 audited LLM calls | WIRED | Integration test confirms exactly 2 `AuditEvent` rows with the two correct actionTypes, live |
| `worker/index.ts` | `insight-run` queue | `boss.work` handler registration | WIRED | Confirmed in source; esbuild worker-bundle builds clean (0 errors) |
| `insights/actions.ts` | `insight-run` queue | `getBoss().send("insight-run", {insightRunId})` | WIRED | Confirmed in source |
| `insights/page.tsx` | `InsightRun` JSON columns | `as unknown as StoredCluster[]` etc. | WIRED | Confirmed for all 5 columns (clusters/kbGaps/volumeDrivers/slaCsat/narrative) |
| `status/[token]/csat/route.ts` | `CsatResponse` | `prisma.csatResponse.upsert` keyed on ticketId | WIRED | Confirmed; RESOLVED/CLOSED 409-gate present |
| `status/[token]/page.tsx` | `csat-form.tsx` | conditional render on RESOLVED/CLOSED | WIRED | Confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `/insights` page (4 cards) | `completed.clusters/kbGaps/volumeDrivers/slaCsat/narrative` | `InsightRun` row written by `runInsight()` via a real pg-boss job | Yes — proven end-to-end by `tests/integration/insight-run.test.ts` against real Postgres (real clustering math, real SQL aggregates, real audit rows), not mocked at the DB layer | ✓ FLOWING |
| `RecurringIssuesCard`/`KbGapsCard` | `clusters`/`gaps` props | Cast from `InsightRun.clusters`/`.kbGaps` | Yes — non-null/non-empty in the integration test's Run 1; correctly `null` in the AI-off Run 3 | ✓ FLOWING |
| `VolumeDriversCard`/`SlaCsatCard` | `data` prop | Cast from `InsightRun.volumeDrivers`/`.slaCsat` | Yes — populated in all three integration-test runs including AI-off (SQL-only, AIDA-13 behavior) | ✓ FLOWING |
| CSAT aggregate (`sla-csat.ts`) | `CsatResponse` rows | Public `/api/public/status/[token]/csat` route's upsert | Yes — integration test seeds real `CsatResponse` rows and `computeSlaCsat` reads them back correctly (avg 4.5, count 2) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full repo typecheck | `tsc --noEmit` | exit 0, zero errors | ✓ PASS |
| Full unit suite | `vitest run` | 81/81 tests, 16/16 files | ✓ PASS |
| Insight-specific unit suite | `vitest run tests/unit/insight-*.test.ts` | 16/16 tests | ✓ PASS |
| End-to-end integration (real Postgres via Testcontainers) | `vitest run --config vitest.integration.config.ts tests/integration/insight-run.test.ts` | 1/1 passed (all 6 plan-required assertions embedded in one `it` block: labeled+cited clusters, volume drivers, SLA/CSAT numbers, KB gaps with `coverage:null`, 2 audit events with redaction proof, reproducibility, AI-off degradation) | ✓ PASS |
| Next.js production build | `next build` | Compiled successfully; `/insights` and `/api/public/status/[token]/csat` both registered as routes | ✓ PASS |
| Worker esbuild bundle (hard-stop check from Plan 06) | `esbuild src/lib/worker/index.ts --bundle ...` | `dist/worker-verify.mjs` built, 0 errors | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| AIDA-17 | 06-01 through 06-07 (all 7 plans) | AIDA Insight: clustering, KB-gap detection, volume drivers, SLA/CSAT — beyond static counts | ✓ SATISFIED | End-to-end chain verified: schema → clustering math → SQL aggregates → KB-gap KNN + prompts → CSAT capture → orchestrator/pg-boss job → `/insights` UI. All confirmed present, wired, and exercised by a passing real-Postgres integration test |

No orphaned requirements: ROADMAP.md maps only AIDA-17 to Phase 6, and all 7 plans declare `requirements: [AIDA-17]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `src/lib/insight/run-insight.ts` | 12 | Import-organize order + CRLF/LF formatter drift (biome `assist/source/organizeImports` + `format`) | ℹ️ Info | Cosmetic only — auto-fixable in one `biome check --write`; does not affect `tsc`/tests/build. This is the same recurring Windows-checkout CRLF quirk documented repeatedly across Phase 6's own SUMMARYs (with dedicated "style" fix commits for Waves 2 and 4); these two Wave-3 files appear to have been missed by that cleanup pass |
| `src/lib/worker/jobs/insight-run.ts` | (whole file) | CRLF/LF formatter drift | ℹ️ Info | Same as above — cosmetic, auto-fixable, non-blocking |

No TODO/FIXME/placeholder comments, no hardcoded hex/oklch colors, no Tailwind named text sizes (`text-lg`/`text-xl`), no chart-library imports, and no `@/` imports in worker-bundleable `src/lib/insight/*` files were found anywhere in the phase's file set.

### Human Verification Required

### 1. Visual review of the /insights page

**Test:** Generate a real insight run and view `/insights` across the 7/30/90-day tabs, in both light and dark mode.
**Expected:** Four cards render per DESIGN-SYSTEM.md (token-only colors, halo empty-state when no run exists, CSS bar rows for distributions), the "Generate insights" button shows "Generating…" while a run is in flight, and "Last generated {relative time}" updates correctly.
**Why human:** Visual layout, spacing, and dark-mode fidelity cannot be verified by static analysis.

### 2. CSAT capture end-user flow

**Test:** On a real RESOLVED/CLOSED ticket's public status page, click through the 1-5 star rating and submit a comment, then reload the page.
**Expected:** The rating control is clickable and responsive, submission shows "Thanks for your feedback!", and reloading shows the prefilled existing score/comment.
**Why human:** Interactive/visual UX on a public page cannot be verified by grep/tsc.

### 3. Real LLM output quality

**Test:** With a real, configured LLM + embedding provider (not the integration test's canned mock), run "Generate insights" against an organization with genuine ticket history.
**Expected:** Cluster labels are semantically meaningful for the actual tickets, KB-gap nearest-article matches look sensible, and the AI narrative reads naturally alongside the SQL numbers it describes (and never contradicts them).
**Why human:** The integration test proves the pipeline's wiring and reproducibility with a mocked LLM response — it cannot judge real-world semantic quality of AI-generated labels/narrative.

### Gaps Summary

No gaps found. All four ROADMAP success criteria are verified against live-executing code: a genuine Testcontainers-backed integration test exercises the full pipeline (deterministic clustering with AI-provided labels, KB-gap detection including the zero-KB shortcut, SQL-only volume-driver and SLA/CSAT aggregates, exactly two audited LLM calls with proven secret redaction, byte-identical reproducibility across two runs, and correct AI-off degradation where SQL sections still populate). The pg-boss job is registered end-to-end (app-side enqueue + worker-side processing) and the worker bundle builds cleanly. The `/insights` UI and the public CSAT capture route both exist, are wired to real data, and are free of stub/placeholder patterns. Only cosmetic (non-blocking) formatting drift was found, plus the expected set of human-verification items for visual/UX/LLM-quality review that no automated phase-verifier can substitute for.

---

*Verified: 2026-07-25T02:10:00Z*
*Verifier: Claude (gsd-verifier)*
