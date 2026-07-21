---
phase: 05-rag-drafted-replies
plan: 03
subsystem: ai
tags: [rag, embeddings, pgvector, remark, pg-boss, worker, kb]

# Dependency graph
requires:
  - phase: 05-01 (schema-foundation)
    provides: KbArticle/KbChunk Prisma models, KbEmbeddingStatus enum, scopedDb DOMAIN_MODELS allowlist
  - phase: 05-02 (embedding-port)
    provides: embed(db, texts) port, resolveEmbeddingProvider/isEmbeddingConfigured, toVectorLiteral
provides:
  - "chunkMarkdown() — heading-based Markdown chunker via remark AST position offsets (no new runtime dependency)"
  - "createKbArticle/updateKbArticle/enqueueReembed — the ONE KB write path, enqueues kb-embed-article post-commit"
  - "kb-embed-article pg-boss job — chunks + ONE batched embed() call + atomic raw-SQL KbChunk swap"
  - "kb-embed-article queue registered in both worker/index.ts and queue/boss-client.ts"
affects: [05-04-retrieval-and-draft-engine, 05-05-settings-embedding-config, 05-06-kb-authoring-ui]

# Tech tracking
tech-stack:
  added: ["@types/mdast (devDependency, type-only — Pitfall 6 recurrence)"]
  patterns:
    - "Slice-the-original-string chunker: never re-serialize an AST, slice markdown.slice(start,end) at node.position offsets for exact-substring fidelity"
    - "Atomic chunk-swap: tx.kbChunk.deleteMany + per-chunk tx.$executeRaw INSERT inside ONE db.$transaction, both operations on the SAME tx client"
    - "Embedding job gated on isEmbeddingConfigured, NOT aiEnabled — embedding infra is independent of the chat kill switch"

key-files:
  created:
    - src/lib/rag/chunk-markdown.ts
    - src/lib/kb/create-article.ts
    - src/lib/worker/jobs/kb-embed-article.ts
    - tests/unit/chunk-markdown.test.ts
    - tests/integration/kb-embed.test.ts
  modified:
    - src/lib/worker/index.ts
    - src/lib/queue/boss-client.ts
    - package.json

key-decisions:
  - "Added @types/mdast as an explicit devDependency (pnpm strict-linking + Pitfall 6: the plain `mdast` package is a transitive-only type package, not resolvable for a direct `import type ... from \"mdast\"` without this — mirrors the @types/hast/@types/html-to-text precedent)"
  - "uniqueSlug() uses a findFirst-then-suffix loop (scopedDb-scoped, auto-injects organizationId), not a unique-constraint-violation retry — consistent with the project's existing compound-unique-key pattern (scopedDb's upsert hook can't inject organizationId into a where clause safely)"
  - "KbChunk row ids are app-generated via randomBytes(16).toString(\"hex\") before the raw INSERT (mirrors the Attachment id precedent) since Prisma's @default(cuid()) is a client-side default that raw SQL bypasses"
  - "kb-embed-article's config gate checks isEmbeddingConfigured(db) only — deliberately NOT the aiEnabled chat toggle, since embedding is an independent capability (per 05-02's Decision 5)"

patterns-established:
  - "chunk-markdown.ts's slice-by-offset technique is the project's model for any future Markdown->structured-chunks need (never mdast-util-to-string/remark-stringify)"

requirements-completed: [AIDA-15]

# Metrics
duration: ~65min
completed: 2026-07-21
---

# Phase 5 Plan 03: Chunker + KB Write Path + Embed Worker Job Summary

**Heading-based Markdown chunker (remark AST position offsets) feeding a `createKbArticle`/`updateKbArticle` write path and a `kb-embed-article` pg-boss job that batch-embeds and atomically swaps `KbChunk` vector(768) rows via raw SQL — proven end-to-end against a real Testcontainers Postgres.**

## Performance

- **Duration:** ~65 min (includes one-time worktree bootstrap: fast-forward merge of 05-01/05-02, `pnpm install`, `prisma generate`)
- **Completed:** 2026-07-21T22:59:00Z
- **Tasks:** 3
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments
- `chunkMarkdown()` splits KB articles on H1/H2 boundaries using remark's AST `position` offsets, slicing the **original** Markdown string (exact-substring fidelity for citation display) — zero new runtime dependency
- `createKbArticle`/`updateKbArticle`/`enqueueReembed` — the single KB write path (mirrors `createTicket`'s discipline), rendering sanitized HTML via the existing `renderMarkdown()` authority and enqueuing embedding strictly after commit
- `kb-embed-article` worker job: kill-switch re-check (`isEmbeddingConfigured`), ONE batched `embed()` call for all of an article's chunks, and an atomic `db.$transaction` chunk-swap (`tx.kbChunk.deleteMany` + per-chunk `tx.$executeRaw ... ::vector` INSERT with an explicit `organizationId` column) — sets `embeddingStatus` COMPLETED/FAILED, never blocks the save
- Queue registered with byte-identical retry options (`retryLimit: 2, retryBackoff: true, retryDelayMax: 300`) in both `worker/index.ts` and `queue/boss-client.ts`
- Integration test proves the full save->chunk->embed->store pipeline against a real Postgres (mocked OpenAI embed SDK boundary): 768-dim vectors, correct `organizationId`, and re-embed idempotency (no chunk duplication)

## Task Commits

Each task was committed atomically (all `--no-verify` per parallel-execution protocol; hooks validated once by the orchestrator after both wave agents complete):

1. **Task 1: Heading-based Markdown chunker** - `176b9e3` (feat, TDD RED->GREEN)
2. **Task 2: createKbArticle write path + kb-embed-article worker job + queue registration** - `9b72ee1` (feat)
3. **Task 3: Integration test — article save produces embedded KbChunk rows** - `271ec0c` (test)

_Note: this worktree branched off before the 05-01/05-02 wave-1 merge landed on master — fast-forward merged `master` in first (clean ancestor, no conflicts), then bootstrapped the fresh worktree (`pnpm install`, `.env` from `.env.example`, `pnpm prisma generate`) before any task work began. No commit needed for either (gitignored artifacts / pre-existing merge)._

## Files Created/Modified
- `src/lib/rag/chunk-markdown.ts` - `chunkMarkdown()`: heading-bounded chunks via AST position-offset slicing, sub-splits over-1800-char sections on blank-line boundaries
- `src/lib/kb/create-article.ts` - `createKbArticle`/`updateKbArticle`/`enqueueReembed`, `slugify`/`uniqueSlug` collision loop
- `src/lib/worker/jobs/kb-embed-article.ts` - `kbEmbedArticleHandler`: config gate, batched embed, atomic tx chunk-swap, COMPLETED/FAILED status
- `src/lib/worker/index.ts` - registers `kb-embed-article` queue + work handler
- `src/lib/queue/boss-client.ts` - registers `kb-embed-article` queue (app-side)
- `tests/unit/chunk-markdown.test.ts` - 4/4 TDD assertions (two-heading split, over-budget sub-split, pre-heading null headingPath, exact-substring fidelity)
- `tests/integration/kb-embed.test.ts` - full pipeline proof + re-embed idempotency
- `package.json` - added `@types/mdast` devDependency

## Decisions Made
See `key-decisions` in frontmatter. Summary: `@types/mdast` added explicitly (Pitfall 6 recurrence — 5th occurrence of this class across the project, after `hast-util-sanitize`/`@types/hast`/`@types/html-to-text`); KbChunk row ids generated via `randomBytes(16).toString("hex")` since raw SQL bypasses Prisma's client-side `cuid()` default; embedding job gate is independent of the `aiEnabled` toggle by design.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@types/mdast` as an explicit devDependency**
- **Found during:** Task 1, first `tsc --noEmit` run after writing `chunk-markdown.ts`
- **Issue:** The plan's code sample imports `type { Root, Heading } from "mdast"`. The bare `mdast` npm package (pure type declarations) was not resolvable — it exists only nested inside `mdast-util-*` packages' private pnpm store folders (`@types/mdast@4.0.4`), never hoisted to a location `tsc` can resolve a direct import from, since pnpm's strict linking only symlinks direct dependencies to the top level. This is the exact pattern 05-RESEARCH.md's own Pitfall 6 describes (and the project has hit 4 times before: `hast-util-sanitize`, `@types/html-to-text`, `@types/hast`, `@types/mailparser`/`@types/nodemailer`).
- **Fix:** Added `"@types/mdast": "^4.0.4"` to `package.json`'s `devDependencies` (matching the already-installed transitive version) and ran `pnpm install`.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm exec tsc --noEmit` clean afterward.
- **Committed in:** `176b9e3` (Task 1 commit)

**2. [Rule 3 - Blocking] Fast-forward merged `master` into a stale worktree before starting**
- **Found during:** Session start, reading STATE.md/PROJECT.md
- **Issue:** This worktree's branch HEAD (`5fcdfb5`) predated the 05-01/05-02 wave-1 merge into `master` (`3ab2fa6`) — this plan `depends_on: ["05-01", "05-02"]`, and neither's code (schema, `scopedDb` allowlist, `embed()` port, etc.) was present.
- **Fix:** Verified `git merge-base --is-ancestor HEAD master` (clean ancestor, zero risk of lost work), then `git merge --ff-only master` to bring the worktree branch up to date. Also required a one-time fresh-worktree bootstrap (`pnpm install`, `.env` from `.env.example`, `pnpm prisma generate` — no `node_modules`/generated client existed yet).
- **Files modified:** none beyond the fast-forward itself (pre-existing commits); no new commit created for this step (it's a pure ref update)
- **Verification:** `git log HEAD..master --oneline` empty after the merge; 05-01/05-02 source files present and readable.
- **Committed in:** N/A (fast-forward, no new commit)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency, 1 blocking stale-worktree environment issue)
**Impact on plan:** Neither affected the plan's design or scope — both were environment/tooling prerequisites for executing the plan as written, mirroring established precedents (03-05's stale-worktree fast-forward; 02-02/03-03's explicit-devDependency pattern for transitive-only type packages).

## Issues Encountered
None beyond the two deviations above.

## User Setup Required

None - no external service configuration required. The integration test mocks the OpenAI embedding SDK boundary (`src/lib/rag/providers/openai-embed`) — no live credential needed.

## Next Phase Readiness
- `chunkMarkdown()`, `createKbArticle`/`updateKbArticle`, and the `kb-embed-article` job are all ready for:
  - 05-04 (retrieval + draft engine) — reads the `KbChunk` rows this job writes
  - 05-05 (Settings embedding config UI) — `enqueueReembed()` is ready for a "Re-embed all KB articles" admin action
  - 05-06 (KB authoring pages) — `createKbArticle`/`updateKbArticle` are ready to be called from Server Actions
- Worker-bundle hard stop re-verified locally (esbuild command mirrored from `Dockerfile`): `kb-embed-article.ts`'s new imports (`chunk-markdown`, `rag/embed`, `rag/settings`, `rag/vector-literal`) bundle cleanly into `dist/worker.mjs` (6.2MB, unchanged from the Phase 4 baseline — no new `--external` flags needed).
- No blockers.

## Known Stubs

None — this plan ships only the backend pipeline (chunker, write path, worker job); it has no UI surface to stub. KB authoring pages (05-06) and Settings embedding config (05-05) are separate, not-yet-executed plans in this wave/next wave.

## Self-Check: PASSED

- FOUND: src/lib/rag/chunk-markdown.ts (contains `export function chunkMarkdown`, `CHUNK_CHAR_BUDGET = 1800`)
- FOUND: src/lib/kb/create-article.ts (contains `createKbArticle`, `updateKbArticle`, `enqueueReembed`)
- FOUND: src/lib/worker/jobs/kb-embed-article.ts (contains `kbEmbedArticleHandler`)
- FOUND: tests/unit/chunk-markdown.test.ts
- FOUND: tests/integration/kb-embed.test.ts
- FOUND commit 176b9e3 (Task 1)
- FOUND commit 9b72ee1 (Task 2)
- FOUND commit 271ec0c (Task 3)
- `pnpm exec tsc --noEmit` clean (verified after every task)
- `pnpm exec biome check` clean on all plan files (verified)
- `pnpm test tests/unit/chunk-markdown.test.ts` — 4/4 green; full unit suite 65/65 green
- `volta run --node 22 pnpm test:integration` — full integration suite 23/23 green (9 files, includes the new kb-embed.test.ts)
- grep-confirmed: zero `@/` imports in chunk-markdown.ts/kb-embed-article.ts; `tx.kbChunk.deleteMany`/`tx.$executeRaw ...::vector` present; zero bare `prisma.$executeRaw`/`db.$executeRaw` for the chunk INSERTs

---
*Phase: 05-rag-drafted-replies*
*Completed: 2026-07-21*
