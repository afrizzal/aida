---
phase: 05-rag-drafted-replies
plan: 02
subsystem: ai
tags: [embeddings, pgvector, openai, ollama, byo-llm, rag]

# Dependency graph
requires:
  - phase: 04-ai-foundation
    provides: lib/llm provider port, secret-box encryption, resolveActiveProvider pattern to mirror
provides:
  - "src/lib/rag/ embedding port: embed(db, texts) -> 768-dim vectors, provider-agnostic (OpenAI/Ollama)"
  - "Independent embedding provider settings with chat-credential fallback (Setting keys llm:embedding*)"
  - "toVectorLiteral for pgvector INSERT literal strings"
  - "testEmbeddingConnection Test Connection probe"
affects: [05-03-embed-job, 05-04-retrieval-query-embedding, 05-05-05-07 (settings UI for embeddings)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Embedding port module family (src/lib/rag/) mirrors lib/llm/ structurally: types.ts, settings.ts, providers/*, one port entrypoint (embed.ts), test-connection probe"
    - "Anthropic excluded from EmbeddingProviderName — no embeddings API"
    - "Independent-but-fallback credential resolution: embedding provider config is separate Setting keys from chat provider, but borrows the chat credential when providers match and the embedding-specific credential is blank"

key-files:
  created:
    - src/lib/rag/types.ts
    - src/lib/rag/settings.ts
    - src/lib/rag/vector-literal.ts
    - src/lib/rag/embed.ts
    - src/lib/rag/providers/openai-embed.ts
    - src/lib/rag/providers/ollama-embed.ts
    - src/lib/rag/embed-test-connection.ts
    - tests/unit/rag-embed.test.ts
  modified: []

key-decisions:
  - "EmbeddingProviderName = openai | ollama only (no anthropic) — confirmed no embeddings API in the installed SDK"
  - "All providers normalized to a fixed 768-dim output (OpenAI via dimensions:768 param; Ollama nomic-embed-text natively 768) so one vector(768) column serves every provider"
  - "embed() throws loudly on any dimension mismatch rather than allowing a silent bad insert downstream"
  - "resolveEmbeddingProvider borrows the chat provider's credential only when the embedding provider equals the chat provider AND the embedding-specific credential is blank (Decision 5)"

patterns-established:
  - "src/lib/rag/ is a full structural mirror of src/lib/llm/ but for embeddings — future embedding-related modules (chunking, retrieval) should follow this same relative-import, worker-bundleable convention"

requirements-completed: [AIDA-15]

# Metrics
duration: ~35min
completed: 2026-07-21
---

# Phase 05 Plan 02: Embedding Port (types, settings, adapters, Test Connection) Summary

**Model-agnostic embedding port (`src/lib/rag/embed()`) normalizing OpenAI and Ollama to a fixed 768-dim vector, with independent-but-chat-fallback credential settings and a real-call Test Connection probe.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-21T15:39:00Z (approx, per STATE.md session start)
- **Completed:** 2026-07-21T15:46:28Z
- **Tasks:** 2
- **Files modified:** 8 created

## Accomplishments
- Independent embedding provider settings (`llm:embeddingProvider`/`Model`/`ApiKeyEnc`/`OllamaBaseUrl`) with chat-credential fallback when the embedding provider equals the chat provider
- `embed(db, texts)` — the ONE embedding port entrypoint, dispatches to OpenAI/Ollama adapters, throws on any non-768-length vector
- `testEmbeddingConnection()` — validates a real trivial embed call so a wrong key or a not-pulled Ollama model surfaces a clear Test Connection failure
- Full unit-test coverage against a hand-built fake `SettingDb` and SDK-boundary mocks (`vi.mock("openai")`/`vi.mock("ollama")`) — no live credential or running Ollama needed

## Task Commits

Each task was committed atomically:

1. **Task 1: Embedding types, settings module (with chat-credential fallback), and vector-literal** - `b0b8ca7` (feat, TDD)
2. **Task 2: embed() port entrypoint, OpenAI + Ollama adapters, and Test Connection probe** - `b8e6666` (feat)

_Note: this worktree had no `node_modules`/generated Prisma client on session start — bootstrapped via `pnpm install` + `.env` from `.env.example` + `pnpm prisma generate` before any test/typecheck could run (mirrors the 02-02-documented fresh-clone bootstrap precedent); no commit needed for this (gitignored artifacts)._

## Files Created/Modified
- `src/lib/rag/types.ts` - `EmbeddingProviderName`, `EMBEDDING_DIMENSIONS=768`, model catalog
- `src/lib/rag/settings.ts` - `resolveEmbeddingProvider`/`isEmbeddingConfigured`/`getEmbeddingSettings`/`saveEmbeddingSettings`/`embeddingModelId`
- `src/lib/rag/vector-literal.ts` - `toVectorLiteral(number[]) -> "[0.1,0.2,...]"`
- `src/lib/rag/embed.ts` - `embed(db, texts)` port entrypoint
- `src/lib/rag/providers/openai-embed.ts` - `embedOpenAi` (dimensions:768)
- `src/lib/rag/providers/ollama-embed.ts` - `embedOllama` (native `client.embed()`)
- `src/lib/rag/embed-test-connection.ts` - `testEmbeddingConnection`
- `tests/unit/rag-embed.test.ts` - unit coverage for both tasks

## Decisions Made
- Followed the plan's structural mirror of `lib/llm/` exactly; no architectural deviations.
- Re-exported `SettingDb` from `../llm/settings` (rather than redeclaring) for DRY, per the plan's explicit preference.

## Deviations from Plan

None - plan executed exactly as written. (One non-deviation note: this worktree required a one-time environment bootstrap — `pnpm install`, `.env` copy, `pnpm prisma generate` — since it started with no `node_modules`; this is environment setup, not a plan/code deviation, and produced no tracked-file changes.)

## Issues Encountered
- Initial `vi.mock("openai")`/`vi.mock("ollama")` factory implementations used arrow-function mock constructors, which vitest's `new`-invocation rejected ("is not a constructor"). Fixed by using named `function` mock implementations for the SDK class mocks. Fixed before any commit — not a deviation from plan, just an implementation detail while writing the test file.
- Biome's `organizeImports`/formatter required one auto-fix pass (`biome check --write`) on `embed.ts`, `embed-test-connection.ts`, `settings.ts` for import order and a multi-line throw wrap — applied before commit, all files clean per the plan's `pnpm exec biome check src/lib/rag` acceptance criterion.

## User Setup Required

None - no external service configuration required. (Embedding provider configuration UI lands in a later plan; no live credentials were used — all tests mock the SDK boundary.)

## Next Phase Readiness
- `embed()` is ready for 05-03 (embed job) and 05-04 (retrieval query embedding) to call through.
- Embedding provider settings UI (Settings page) is not yet built — a later plan (per phase plan sequence 05-05/06/07) is expected to add the form; `saveEmbeddingSettings`/`getEmbeddingSettings`/`testEmbeddingConnection` are ready to be wired to it.
- No blockers.

---
*Phase: 05-rag-drafted-replies*
*Completed: 2026-07-21*

## Self-Check: PASSED

All 8 created files confirmed tracked via `git ls-files`; both task commits (`b0b8ca7`, `b8e6666`) confirmed present via `git log --oneline`.
