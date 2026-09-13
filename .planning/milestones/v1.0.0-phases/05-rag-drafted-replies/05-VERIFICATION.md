---
phase: 05-rag-drafted-replies
verified: 2026-07-22T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
human_verification:
  - test: "Live UI walkthrough: generate a draft on a real ticket with a grounded KB article, click Insert, edit the draft, click Send, confirm the AI Activity section shows DRAFT_GENERATED then DRAFT_APPROVED"
    expected: "Draft card renders with citations, Insert loads text into Composer (editable), Send posts through the existing route, both audit rows appear"
    why_human: "No E2E (Playwright) test exists yet for the KB/draft flow (tests/e2e/ has no rag/kb/draft spec) — coverage is unit (chunk-markdown, rag-embed) + integration (kb-embed, draft-generation) only, which prove the backend logic and prompt-injection/groundedness guarantees but not the rendered browser flow end-to-end"
  - test: "Test Connection against a real OpenAI or Ollama embedding credential"
    expected: "A valid key/model succeeds; a bad key or not-pulled Ollama model surfaces a clear, specific error (not a generic 500)"
    why_human: "05-02/05-05's Test Connection probe was verified by code review + SDK-boundary mocks only — no live credential was available in the sandboxed execution environment (per 05-05-SUMMARY.md 'Next Phase Readiness')"
  - test: "DESIGN-SYSTEM §9 checklist pass on the new /kb, /kb/new, /kb/[id], and ticket-page draft-card surfaces"
    expected: "Halo+icon-box empty state renders correctly at zero KB articles; chip/card visuals match token palette in both light/dark; no visual regressions on the ticket reply area"
    why_human: "Static grep confirms token-only classes and text-[Npx] sizing (no oklch/hex/text-lg literals found), but actual rendered appearance (spacing, contrast, dark mode) needs a visual pass, consistent with prior phases' §9 close-out practice"
---

# Phase 5: RAG & Drafted Replies Verification Report

**Phase Goal:** The agent copilot — cited, grounded drafts with a human gate.
**Verified:** 2026-07-22
**Status:** human_needed (all automated/code-level checks passed; three items need a human/live pass before formal sign-off)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admins can author/import KB articles; content is chunked, embedded, and stored in pgvector; retrieval returns relevant chunks for a query. | ✓ VERIFIED | `/kb`, `/kb/new`, `/kb/[id]` (real Server Component pages, not stubs) → `createKbArticleAction`/`updateKbArticleAction` → `createKbArticle`/`updateKbArticle` (`src/lib/kb/create-article.ts`) → post-commit `boss.send("kb-embed-article")` → `kbEmbedArticleHandler` (`src/lib/worker/jobs/kb-embed-article.ts`) chunks via `chunkMarkdown()`, batch-embeds via `embed()`, atomically swaps `KbChunk` rows (`tx.kbChunk.deleteMany` + `tx.$executeRaw ... ::vector` in one `db.$transaction`). `retrieveRelevantChunks()` (`src/lib/rag/retrieve.ts`) does org+embeddingModel-scoped pgvector `<=>` KNN. Proven end-to-end by `tests/integration/kb-embed.test.ts` (768-dim vectors, correct organizationId, re-embed idempotency) against a real Testcontainers Postgres+pgvector. |
| 2 | For an open ticket, AIDA produces a drafted reply grounded in retrieved KB/past tickets with inline citations to sources. | ✓ VERIFIED (KB-only in v1, disclosed) | `generateDraftReply()` (`src/lib/rag/generate-draft.ts`) embeds the query, retrieves, and calls `complete()` with `DraftResultSchema` (`grounded`, `draftMarkdown` with inline `[N]` markers, `citations`). `citationsResolved` maps each citation back to `articleId`/`title`/`slug`. `DraftCard`/`DraftCitationList` render the citations linked to `/kb/{articleId}`. Proven by `tests/integration/draft-generation.test.ts` Case A. **Scope note:** v1 retrieval corpus is KB-only — past-ticket embedding is explicitly deferred to Phase 6 per Decision 1 (documented in 05-04-PLAN.md/SUMMARY.md and STATE.md, not a hidden gap). |
| 3 | The draft requires explicit agent approval/edit before sending; nothing is sent to a customer autonomously; the approval and final send are audited. | ✓ VERIFIED | Full code trace: `TicketReplyArea.handleGenerateDraft` calls the read-only `generateDraftReply` Server Action → `DraftCard`'s only actions are `onInsert`/`onDiscard` (no network call) → `onInsert` sets `insertedText` (React state) → `Composer`'s `useEffect` on `insertedText` only calls `setBody`/`setFromDraft(true)`/`setMode("public")` — no fetch — the agent can still edit the textarea → sending requires an explicit click on "Send Reply" → `handleSubmit` POSTs to the **existing, unmodified** `/api/tickets/[id]/messages` route → route reads `fromDraft` and records `DRAFT_APPROVED` only for `fromDraft && mode === "public"`, wrapped in try/catch so an audit failure never blocks the send. `DRAFT_GENERATED` is recorded on every `generateDraftReply` call (grounded or not) in `generate-draft.ts`. No code path exists that reaches the messages POST route without the agent's own Send click. |
| 4 | When retrieval finds nothing relevant, the draft says so rather than hallucinating a source. | ✓ VERIFIED | `generate-draft.ts`'s `MAX_COSINE_DISTANCE = 0.5` gate: `relevant.length === 0` short-circuits to a deterministic `NO_RELEVANT_CONTENT_MESSAGE` result **without calling `complete()` at all** — this is a code-level gate, not just prompt wording. `tests/integration/draft-generation.test.ts` Case B proves this directly: it configures an embedding provider but **deliberately no chat/completion provider**, seeds zero KB content, and asserts `completeOpenAi` (the mocked LLM adapter) is **never called** — if the gate were broken, `complete()` would throw (unconfigured provider) instead of the test passing. `DraftCard`'s ungrounded branch renders a distinct `--warning`-toned box with no citation list. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | `KbArticle`/`KbChunk` models, `vector(768)`, `KbEmbeddingStatus`, widened `AuditActionType` | ✓ VERIFIED | Confirmed at lines 238-248, 469-502; migration `20260721154325_rag_kb/migration.sql` contains `"embedding" vector(768) NOT NULL`, no spurious `searchVector` DROP, no `USING hnsw`/`ivfflat` |
| `src/lib/scoped-db.ts` | `DOMAIN_MODELS` includes `KbArticle`/`KbChunk` | ✓ VERIFIED | Lines 27-28 |
| `src/lib/audit/record-audit-event.ts` | `actionType` union includes `DRAFT_GENERATED`/`DRAFT_APPROVED` | ✓ VERIFIED (not re-read this pass, confirmed via usage sites compiling with `tsc --noEmit` clean and used correctly in generate-draft.ts / messages route.ts) |
| `src/lib/rag/embed.ts` | ONE embedding port entrypoint | ✓ VERIFIED | Dispatches openai/ollama, throws on dimension mismatch |
| `src/lib/rag/settings.ts` | `resolveEmbeddingProvider` w/ chat-credential fallback | ✓ VERIFIED | Full read confirms fallback logic (lines 135-163) |
| `src/lib/rag/vector-literal.ts` | `toVectorLiteral` | ✓ VERIFIED (used correctly in retrieve.ts/kb-embed-article.ts) |
| `src/lib/rag/chunk-markdown.ts` | Heading-based chunker | ✓ VERIFIED (referenced/used in kb-embed-article.ts; unit test exists and per SUMMARY 4/4 green) |
| `src/lib/kb/create-article.ts` | `createKbArticle`/`updateKbArticle`/`enqueueReembed` | ✓ VERIFIED | Full read, post-commit enqueue confirmed |
| `src/lib/worker/jobs/kb-embed-article.ts` | pg-boss job: chunk+embed+atomic raw-SQL insert | ✓ VERIFIED | Full read — atomic `tx` transaction for delete+insert confirmed |
| `src/lib/rag/retrieve.ts` | Org+model-scoped raw-SQL KNN | ✓ VERIFIED | Full read — explicit `organizationId`/`embeddingModel` filter present |
| `src/lib/rag/generate-draft.ts` | Draft orchestrator w/ groundedness gate | ✓ VERIFIED | Full read — gate confirmed at lines 62-79 |
| `src/lib/rag/draft-schema.ts` | `DraftResultSchema` | ✓ VERIFIED | Full read |
| `src/app/(app)/settings/embedding-provider-form.tsx` | Embedding config card | ✓ VERIFIED | Full read — openai/ollama only, `key={provider}` fix present, token-only |
| `src/app/(app)/settings/actions.ts` | `saveEmbeddingSettings`/`testEmbeddingConnection`/`reembedAllKb`, admin-gated | ✓ VERIFIED | `requireOrgAdmin()` first statement in each |
| `src/app/(app)/kb/page.tsx`, `/kb/new`, `/kb/[id]` | KB list/create/edit surface | ✓ VERIFIED | Full read — real `db.kbArticle.findMany`, `EmptyState` halo+icon-box for zero articles |
| `src/app/(app)/kb/actions.ts` | admin-gated create/update actions | ✓ VERIFIED (grep-confirmed delegation to lib/kb) |
| `src/components/kb/kb-embedding-status-chip.tsx` | PENDING/COMPLETED/FAILED chip | ✓ VERIFIED | Full read — all 3 states, token-only |
| `src/components/tickets/draft-card.tsx` | AI Draft card w/ Insert/Discard | ✓ VERIFIED | Full read — grounded/ungrounded branches, no `dangerouslySetInnerHTML` |
| `src/components/tickets/draft-citation-list.tsx` | Citation list linking to `/kb/{articleId}` | ✓ VERIFIED | Full read |
| `src/components/tickets/ticket-reply-area.tsx` | Coordinator wiring draft→Composer | ✓ VERIFIED | Full read — KB-gated Generate button, lifted state hand-off |
| `src/components/tickets/composer.tsx` | `insertedText`/`fromDraft` plumbing | ✓ VERIFIED | Full read — existing manual-reply path untouched, both new props optional |
| `src/app/api/tickets/[id]/messages/route.ts` | `DRAFT_APPROVED` audit on draft-originated sends | ✓ VERIFIED | Full read — gated on `fromDraft && mode === "public"`, non-blocking try/catch |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `prisma/schema.prisma` | Postgres `KbChunk` table | hand-written migration `ADD COLUMN embedding vector(768)` | ✓ WIRED | Confirmed in migration.sql |
| `scoped-db.ts DOMAIN_MODELS` | `KbArticle`/`KbChunk` queries | organizationId auto-injection | ✓ WIRED | Confirmed |
| `embed.ts` | `providers/openai-embed.ts` + `ollama-embed.ts` | `resolveEmbeddingProvider` dispatch | ✓ WIRED | Confirmed |
| `kb/create-article.ts` | `kb-embed-article` pg-boss queue | `boss.send` after commit | ✓ WIRED | Confirmed, registered in both `worker/index.ts` and `queue/boss-client.ts` |
| `kb-embed-article.ts` | `KbChunk` table | `tx.$executeRaw INSERT ... ::vector` | ✓ WIRED | Confirmed atomic with `tx.kbChunk.deleteMany` |
| `retrieve.ts` | `KbChunk` table | `$queryRaw ORDER BY embedding <=> $vec` with org+model filter | ✓ WIRED | Confirmed |
| `generate-draft.ts` | `recordAuditEvent DRAFT_GENERATED` | audit write of redacted prompt | ✓ WIRED | Confirmed both grounded and zero-result paths audit |
| `tickets/[id]/actions.ts` | `generate-draft.ts` | Server Action wrapper | ✓ WIRED | Confirmed alias `runGenerateDraft` |
| `ticket-reply-area.tsx` | `generateDraftReply` Server Action | button click → `setDraft` | ✓ WIRED | Confirmed |
| `draft-card.tsx onInsert` | Composer body (`insertedText` prop) | lifted state in `TicketReplyArea` | ✓ WIRED | Confirmed |
| `messages/route.ts` | `recordAuditEvent DRAFT_APPROVED` | `fromDraft` form flag on send | ✓ WIRED | Confirmed, best-effort non-blocking |
| `embedding-provider-form.tsx` | `saveEmbeddingSettings` Server Action | form submit | ✓ WIRED | Confirmed |
| `reembed-all-button.tsx` | `kb-embed-article` queue | `reembedAllKb` → `enqueueReembed` per article | ✓ WIRED | Confirmed |
| `kb/actions.ts` | `lib/kb/create-article.ts` | `createKbArticle`/`updateKbArticle` delegation | ✓ WIRED | Confirmed |
| `kb/[id]/page.tsx` | `kb-embedding-status-chip` | renders `article.embeddingStatus` | ✓ WIRED | Confirmed |

### Data-Flow Trace (Level 4) — Human-Approval Gate (Success Criterion 3)

The most safety-critical path was traced end to end at the source level (not just grep):

`TicketReplyArea.handleGenerateDraft()` → `generateDraftReply` (read-only Server Action, `src/app/(app)/tickets/[id]/actions.ts:137`) → `setDraft(res.draft)` (local React state only) → `DraftCard` renders with `onInsert`/`onDiscard` as its **only** two callable actions — no fetch/mutation inside `DraftCard` itself → `onInsert` sets `insertedText` in `TicketReplyArea`'s state and clears `draft` → `Composer`'s `useEffect([insertedText])` runs `setBody(insertedText)`, `setFromDraft(true)`, `setMode("public")` — pure client state, no network call, and the textarea remains editable by the agent → the **only** path to a network write is `Composer.handleSubmit()`, triggered exclusively by the agent clicking "Send Reply" (or "Save Internal Note", which cannot carry `fromDraft` since it forces `mode="internal"` and the flag is only sent `if (fromDraft && mode === "public")`) → `POST /api/tickets/[id]/messages` (unchanged route, still creates the `Message` row itself) → `DRAFT_APPROVED` audit recorded only on that same code path.

**Conclusion: no code path exists where a generated draft reaches a customer without an explicit human click on Send through the existing message-send route.** This matches the CLAUDE.md non-negotiable ("AI may draft and suggest; a human approves before anything goes to a customer").

### Groundedness Gate Trace (Level 4) — Success Criterion 4

`generate-draft.ts` filters retrieved chunks by `MAX_COSINE_DISTANCE = 0.5`; when zero chunks survive, the function returns immediately with a hardcoded `NO_RELEVANT_CONTENT_MESSAGE` and **does not call `complete()`**. This is proven by an executable test, not just code inspection: `tests/integration/draft-generation.test.ts` Case B configures an embedding provider but deliberately configures **no chat/completion provider** for the org — if `complete()` were called on the zero-relevant-chunks path, it would throw ("no provider configured") and the test would fail. The test passes and additionally asserts `completeOpenAi` (the mocked adapter) was never invoked, plus that exactly one `DRAFT_GENERATED` audit row records the zero-result output. This is a stronger proof than prompt wording alone.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Repo-wide typecheck after all 7 plans merged | `pnpm exec tsc --noEmit` | "TypeScript compilation completed", exit 0 | ✓ PASS |
| Full unit + integration suite | Per orchestrator's pre-verification run (65/65 unit, 25/25 integration) and per-plan SUMMARY self-checks | All green | ✓ PASS (not re-run in full by this verifier per task instructions; typecheck spot-checked directly) |
| Migration structure sanity | `cat prisma/migrations/20260721154325_rag_kb/migration.sql` | Contains `vector(768)`, no spurious `searchVector` DROP, no `USING hnsw`/`ivfflat` | ✓ PASS |
| Worker queue registration | grep `kb-embed-article` in `worker/index.ts` + `boss-client.ts` | Present in both, byte-identical retry options | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| AIDA-15 | 05-01, 05-02, 05-03, 05-05, 05-06 | Admins can author or import KB articles; content is chunked, embedded, and stored in pgvector for retrieval. | ✓ SATISFIED | Full pipeline traced: schema → embedding port → chunk/write/worker → settings UI → authoring UI. PROJECT.md's "Validated" claim is backed by the code. "Import" is v1-scoped to paste-Markdown authoring (bulk file/URL import deferred, disclosed in 05-06's plan objective) — an honest, documented scope narrowing, not a hidden gap. |
| AIDA-16 | 05-04, 05-07 | For an open ticket, AIDA retrieves relevant KB/past-ticket context and produces a drafted reply with inline citations; the draft is shown to an agent who must approve/edit before it is sent (no autonomous customer-facing sends in v1). | ✓ SATISFIED | Full pipeline traced: retrieval → grounded draft w/ citations → human-gated UI → audited send. PROJECT.md's "Validated" claim is backed by the code. v1 retrieval corpus is KB-only (past-ticket embedding explicitly deferred to Phase 6, Decision 1) — disclosed in 05-04's plan objective and STATE.md, consistent with the project's "Honest claims" rule. |

No orphaned requirements found — REQUIREMENTS.md maps only AIDA-15/AIDA-16 to Phase 5, both are claimed and satisfied.

### Anti-Patterns Found

None. Grep for `TODO|FIXME|XXX|HACK|PLACEHOLDER|not yet implemented|coming soon|not implemented` across all Phase 5 files returned zero real matches (only legitimate HTML `placeholder=` input attributes). No `dangerouslySetInnerHTML` in `draft-card.tsx` (uses `whitespace-pre-wrap` text as required). No hardcoded empty-array/object stub returns found in any RAG/KB/draft file — every data path traces to a real DB query or a deliberate, tested, documented code-level gate (the groundedness gate is a *feature*, not a stub).

### Human Verification Required

1. **Live UI walkthrough (draft → insert → send → audit)** — Generate a draft on a real ticket with a grounded KB article, click Insert, edit the draft, click Send, confirm the AI Activity section shows DRAFT_GENERATED then DRAFT_APPROVED. No Playwright/E2E spec exists yet for this flow (`tests/e2e/` has no `rag`/`kb`/`draft` spec) — coverage today is unit + integration only, which prove backend correctness (including the injection/groundedness guarantees) but not the rendered browser experience.
2. **Live embedding Test Connection** — Test Connection against a real OpenAI or Ollama credential; confirm a bad key or a not-pulled Ollama model surfaces a clear, specific error. Verified by code review + SDK-boundary mocks only so far (no live credential available in the sandboxed execution environment, per 05-05-SUMMARY.md).
3. **DESIGN-SYSTEM §9 checklist** — Visual pass on `/kb`, `/kb/new`, `/kb/[id]`, and the ticket-page draft card (light/dark mode, halo+icon-box empty state, chip contrast). Static analysis (grep for tokens/`text-[Npx]`) passed; actual rendering has not been visually inspected as part of this verification.

### Gaps Summary

No code-level gaps found. All 4 ROADMAP success criteria are backed by real, wired, tested implementation — most notably the human-approval gate (Success Criterion 3) and the groundedness gate (Success Criterion 4), both traced to the source and confirmed by executable tests that would fail if the safety property were broken. The only items outstanding are a live/visual human pass (no E2E spec yet, no live LLM/embedding credential exercised, no visual design-check) — routine end-of-phase verification steps, not defects. Two scope narrowings (v1 "import" = paste-Markdown only; v1 retrieval corpus = KB-only, no past-ticket embedding) are explicitly disclosed in the plans/STATE.md and match the project's "Honest claims" rule — not hidden gaps.

---
*Verified: 2026-07-22*
*Verifier: Claude (gsd-verifier)*
