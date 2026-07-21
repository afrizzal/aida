---
phase: 05-rag-drafted-replies
plan: 04
subsystem: ai
tags: [rag, pgvector, prompt-injection, groundedness, audit, llm-port]

# Dependency graph
requires:
  - phase: 05-rag-drafted-replies (05-01, 05-02)
    provides: KbArticle/KbChunk schema + vector(768) column, scopedDb allowlist, the embed() embedding port
provides:
  - "retrieveRelevantChunks(orgId, queryEmbedding, embeddingModel, topK) — org+model-scoped raw-SQL pgvector KNN"
  - "generateDraftReply(orgId, ticketId) — the grounded-draft orchestrator with a code-level groundedness gate"
  - "generateDraftReply Server Action exposed for 05-07's ticket UI"
  - "optional maxOutputTokens threaded through CompleteParams<T> and all three lib/llm providers"
affects: [05-05-kb-authoring-ui, 05-06-worker-embed-job, 05-07-ticket-draft-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fenceContent(tagName, rawText) generalizes triage's fenceTicketContent for a SECOND untrusted surface (retrieved KB chunks), reused for both <ticket_content> and <kb_source id=\"N\">"
    - "code-level groundedness gate: zero-relevant-chunks skips complete() entirely rather than trusting only an LLM self-report of grounded:false"
    - "citationsResolved: filter the model's returned citations against the retrieved chunk set — a chunkId outside what was actually given is silently dropped, never trusted"

key-files:
  created:
    - src/lib/rag/retrieve.ts
    - src/lib/rag/draft-schema.ts
    - src/lib/rag/prompt-safety.ts
    - src/lib/rag/draft-prompt.ts
    - src/lib/rag/generate-draft.ts
    - tests/integration/draft-generation.test.ts
  modified:
    - src/lib/llm/types.ts
    - src/lib/llm/complete.ts
    - src/lib/llm/providers/anthropic.ts
    - src/lib/llm/providers/openai.ts
    - src/lib/llm/providers/ollama.ts
    - src/app/(app)/tickets/[id]/actions.ts

key-decisions:
  - "fenceContent's generic <tagName>/</tagName> wrapping doesn't natively support an attribute (id=\"N\") on the open tag while still escaping the BARE close-tag lookalike in untrusted content — solved by calling fenceContent(\"kb_source\", body) (so the close-tag regex matches bare </kb_source> regardless of attributes an attacker can't predict) then rewriting only the leading <kb_source> open tag to <kb_source id=\"N\">; the real closing tag stays the bare, already-escaped-against </kb_source>."
  - "Zero-result audit rows record provider/model as the literal string \"none\" (no LLM was resolved or called on that path) rather than resolving the configured chat provider just to label an event that never invoked it."
  - "v1 retrieval corpus is KB-only per Decision 1 (05-RESEARCH.md) — past-ticket embedding deferred to Phase 6 (AIDA Insight), which already needs ticket-content analysis."

requirements-completed: [AIDA-16]

# Metrics
duration: 40min
completed: 2026-07-22
---

# Phase 05 Plan 04: Retrieval + Grounded-Drafting Core Summary

**`generateDraftReply(orgId, ticketId)` — org-scoped pgvector KNN retrieval, a code-level zero-hallucination groundedness gate, and a generalized prompt-injection fence covering both the ticket message and every retrieved KB chunk, wired through the existing `complete()` port with a new `maxOutputTokens` cap to stop Anthropic truncating multi-paragraph drafts at 1024 tokens.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-22T05:15:00Z (approx)
- **Completed:** 2026-07-22T05:54:13+07:00
- **Tasks:** 3
- **Files modified:** 11 (5 created new `src/lib/rag/` modules, 1 new integration test, 5 modified `lib/llm` files, 1 modified Server Actions file)

## Accomplishments
- `CompleteParams<T>` gained an optional `maxOutputTokens`, threaded through `complete.ts`'s dispatch and all three provider adapters — Anthropic no longer hardcodes `max_tokens: 1024` (defaults to it only when omitted, so triage is byte-for-byte unaffected); OpenAI/Ollama apply their equivalents (`max_completion_tokens`/`num_predict`) only when a caller supplies one.
- `retrieveRelevantChunks()` — org-scoped, `embeddingModel`-filtered raw-SQL pgvector `<=>` KNN query, mirroring `searchTickets`'s explicit-`organizationId` raw-SQL discipline exactly (scopedDb does not intercept `$queryRaw`).
- `DraftResultSchema` (zod/v4) + `DRAFT_SYSTEM_PROMPT` + `NO_RELEVANT_CONTENT_MESSAGE` + `buildRetrievalQueryText`/`buildDraftUserPrompt` — the structured-output contract and prompt builders, mirroring `TriageResultSchema`'s exact convention.
- `fenceContent()` — a DRY generalization of triage's `fenceTicketContent`, now guarding TWO untrusted surfaces: the customer's `<ticket_content>` and every retrieved `<kb_source id="N">` block.
- `generateDraftReply()` — embeds the query, retrieves, applies the `MAX_COSINE_DISTANCE = 0.5` groundedness gate (skips `complete()` entirely and returns a deterministic no-source result when nothing is relevant — Success Criterion 4), resolves the model's returned citations against the actually-retrieved chunk set, and records exactly one `DRAFT_GENERATED` `AuditEvent` on every call (grounded or not) with the redacted prompt.
- `generateDraftReply` Server Action added to `tickets/[id]/actions.ts` (no `requireOrgAdmin` — advisory copilot output, gated by the human-approval send flow), exposed for 05-07's ticket UI.
- `tests/integration/draft-generation.test.ts` — Case A (grounded: fenced `<kb_source id="1">`/`<ticket_content>`, a KB-embedded `</kb_source>` breakout escaped to `[escaped-tag]`, secret redacted, resolved citations, exactly one audit row whose `input` equals the exact redacted prompt) and Case B (empty KB: `grounded:false`, `NO_RELEVANT_CONTENT_MESSAGE`, the completion adapter mock never called, exactly one audit row recording the zero-result output) — both green against a real Testcontainers Postgres+pgvector instance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread optional maxOutputTokens through the LLM port** - `3f3e63a` (feat)
2. **Task 2: Retrieval SQL, draft schema, generalized fence, and draft prompt** - `9503745` (feat)
3. **Task 3: generateDraftReply orchestrator + Server Action + groundedness/injection integration test** - `176b828` (feat)

_Note: this worktree's branch was found checked out one wave behind master (missing 05-01/05-02's schema migration, scopedDb changes, and the embed() port) — fast-forward merged to master (`3ab2fa6`) before any task work began, mirroring the exact 03-05-documented precedent for stale parallel-execution worktrees. Also required the standard fresh-worktree bootstrap (`pnpm install`, `.env` from `.env.example`, `pnpm prisma generate`) since `node_modules`/the generated Prisma client were absent — no tracked-file changes, environment setup only._

## Files Created/Modified
- `src/lib/llm/types.ts` - `CompleteParams<T>` gains optional `maxOutputTokens`
- `src/lib/llm/complete.ts` - forwards `maxOutputTokens` into the per-provider `base` dispatch object
- `src/lib/llm/providers/anthropic.ts` - `max_tokens: params.maxOutputTokens ?? 1024` (was hardcoded 1024)
- `src/lib/llm/providers/openai.ts` - `max_completion_tokens` applied conditionally
- `src/lib/llm/providers/ollama.ts` - `num_predict` applied conditionally
- `src/lib/rag/retrieve.ts` - `retrieveRelevantChunks`, org+embeddingModel-filtered pgvector KNN
- `src/lib/rag/draft-schema.ts` - `DraftResultSchema`/`DraftCitationSchema`/`DraftResult`
- `src/lib/rag/prompt-safety.ts` - `fenceContent(tagName, rawText)`
- `src/lib/rag/draft-prompt.ts` - `DRAFT_SYSTEM_PROMPT`, `NO_RELEVANT_CONTENT_MESSAGE`, `buildRetrievalQueryText`, `buildDraftUserPrompt`
- `src/lib/rag/generate-draft.ts` - `generateDraftReply`, `GenerateDraftResult`, `MAX_COSINE_DISTANCE`
- `src/app/(app)/tickets/[id]/actions.ts` - + `generateDraftReply` Server Action
- `tests/integration/draft-generation.test.ts` - Case A (grounded+injection) + Case B (zero-result) integration coverage

## Decisions Made
- `fenceContent("kb_source", body)` is called with the bare tag name (not `kb_source id="N"`) so the closing-tag escape regex catches a bare `</kb_source>` injection regardless of what numbered id an attacker can't predict; only the leading open tag string is rewritten afterward to carry the visible `id="N"` label the model cites against. This keeps the injection defense correct while still producing the exact `<kb_source id="N">` open-tag text the draft prompt needs.
- Zero-result audit rows use `provider: "none"`/`model: "none"` (no LLM was resolved or invoked on that path) rather than resolving the configured chat provider purely to label an event that never called it.
- Followed the plan's KB-only v1 retrieval scope (Decision 1, `05-RESEARCH.md`) — past-ticket embedding stays deferred to Phase 6.

## Deviations from Plan

None — plan executed exactly as written. (The stale-worktree fast-forward merge and the fresh-worktree bootstrap noted above are environment preconditions, not plan/code deviations — no auto-fix rule applies, no tracked-file changes resulted from either.)

## Issues Encountered
- The local integration-test toolchain requires Node 22 exactly (`volta run --node 22.23.1 -- pnpm test:integration ...`) — plain `pnpm test:integration` resolves pnpm's bundled Node 20 runtime and fails with an unrelated `undici`/`webidl` error inside `testcontainers`'s HTTP wait-strategy module. This matches the project's already-documented Node/PATH quirk; resolved by invoking via `volta run --node 22.23.1`, not a code issue.
- Docker Desktop was not running at session start (Testcontainers requires it) — started it and polled `docker info` until ready before running the integration test, mirroring 05-01's exact precedent.

## User Setup Required

None - no external service configuration required. (Embedding/LLM provider configuration UI already exists from Phase 4/05-02; no live credentials were used — the integration test mocks both the embedding and completion adapters at the SDK boundary.)

## Next Phase Readiness
- `generateDraftReply` and its Server Action are ready for 05-07's ticket UI to call directly (draft card + "Insert into reply" + citation list).
- `retrieveRelevantChunks`/`fenceContent`/`DraftResultSchema` are all in place for 05-05 (KB authoring UI) and 05-06 (worker embed job) to build against without touching this plan's files.
- The `maxOutputTokens` plumbing is available to any future `complete()` caller that needs a higher cap; triage's existing behavior is provably unchanged (verified: it is the only other `complete()` call site in the codebase, and it passes no `maxOutputTokens`).
- No blockers.

## Known Stubs

None — every code path in this plan (grounded draft, zero-result draft, Server Action) is wired to real data with no hardcoded/placeholder UI output. (The ticket-facing UI that will render `GenerateDraftResult` is 05-07's job, not this plan's.)

---
*Phase: 05-rag-drafted-replies*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: src/lib/rag/retrieve.ts
- FOUND: src/lib/rag/draft-schema.ts
- FOUND: src/lib/rag/prompt-safety.ts
- FOUND: src/lib/rag/draft-prompt.ts
- FOUND: src/lib/rag/generate-draft.ts
- FOUND: tests/integration/draft-generation.test.ts
- FOUND commit 3f3e63a (Task 1)
- FOUND commit 9503745 (Task 2)
- FOUND commit 176b828 (Task 3)
- `pnpm exec tsc --noEmit` clean; `pnpm exec biome check src/lib/rag src/lib/llm` clean; `pnpm test tests/unit` (61/61) green; `volta run --node 22.23.1 -- pnpm test:integration` full suite (9 files / 24 tests) green, including both draft-generation.test.ts cases confirmed individually via `-t "05-04"`.
