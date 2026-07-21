---
phase: 05-rag-drafted-replies
plan: 05
subsystem: ui
tags: [settings, embedding, rag, server-actions, react-hook-form, zod, shadcn]

# Dependency graph
requires:
  - phase: 05-rag-drafted-replies (05-02)
    provides: "src/lib/rag/settings.ts (saveEmbeddingSettings/getEmbeddingSettings/isEmbeddingConfigured), src/lib/rag/embed-test-connection.ts, EMBEDDING_MODEL_CATALOG"
  - phase: 05-rag-drafted-replies (05-03)
    provides: "src/lib/kb/create-article.ts's enqueueReembed(orgId, articleId)"
  - phase: 04-ai-foundation (04-04)
    provides: "llm-provider-form.tsx / llm-test-connection-button.tsx / actions.ts security-contract pattern to mirror"
provides:
  - "Settings -> AI Features 'Embedding Provider' card (openai/ollama, independent of chat provider)"
  - "saveEmbeddingSettings / testEmbeddingConnection / reembedAllKb admin-gated Server Actions"
  - "'Re-embed all KB articles' operator action wired to the kb-embed-article queue"
affects: [05-06, 05-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Embedding Settings card mirrors LlmProviderForm's react-hook-form + zod/v4 + shadcn Form/Select shape exactly, including the key={provider} 04-07 stale-options fix"
    - "Embedding provider Server Actions mirror the LLM-settings security contract exactly: requireOrgAdmin() first, stored-key fallback on blank submit, 200-char error slice, never echo the key"

key-files:
  created:
    - src/app/(app)/settings/embedding-provider-form.tsx
    - src/app/(app)/settings/embedding-test-connection-button.tsx
    - src/app/(app)/settings/reembed-all-button.tsx
    - .planning/phases/05-rag-drafted-replies/deferred-items.md
  modified:
    - src/app/(app)/settings/actions.ts
    - src/app/(app)/settings/page.tsx

key-decisions:
  - "Embedding provider config is a fully independent capability from the chat provider (no anthropic option, separate Setting keys, separate Test Connection) — an Anthropic-for-chat org must configure OpenAI/Ollama here for RAG to work at all."
  - "'Re-embed all KB articles' button is only rendered once isEmbeddingConfigured(db) is true (page.tsx conditional) — clicking it before a provider is configured would just enqueue jobs that immediately set every article to FAILED (kb-embed-article's config gate), so hiding it until configured avoids a confusing no-op action."
  - "reembedAllKb() re-enqueues EVERY article unconditionally (not just ones matching the old embeddingModel) — cross-model vectors are non-comparable (Pitfall 5), so a partial re-embed would leave the KB with a mixed, non-comparable vector space."

patterns-established:
  - "Second independent provider-config card on the same Settings page (embedding vs chat) — future provider-like capabilities should follow this same card + Server Action + Test Connection shape rather than inventing a new one."

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-07-22
---

# Phase 05 Plan 05: Settings Embedding Provider Summary

**Independent "Embedding Provider" Settings card (OpenAI/Ollama, no Anthropic) with Test Connection and a "Re-embed all KB articles" admin action, wired to the 05-03 embed queue.**

## Performance

- **Duration:** ~30 min (including worktree fast-forward merge + fresh `pnpm install`/`prisma generate` bootstrap)
- **Completed:** 2026-07-22
- **Tasks:** 2/2 completed
- **Files modified:** 6 (2 new components + 1 new button + 1 modified actions.ts + 1 modified page.tsx + 1 new deferred-items.md)

## Accomplishments
- An admin can configure a separate embedding provider (OpenAI or Ollama — no Anthropic, it has no embeddings API), model, and credential in Settings -> AI Features, fully independent of the chat provider.
- Test Connection does a real trivial embed() call against the configured provider/model, surfacing a clear error for a not-pulled Ollama model or a bad key.
- "Re-embed all KB articles" re-enqueues embedding for every article in the org (never a partial subset) — the correct recovery action after changing the embedding model, since cross-model vectors are non-comparable.

## Task Commits

Each task was committed atomically:

1. **Task 1: Embedding Server Actions (save/test/re-embed all), admin-gated** - `ea3f6e0` (feat)
2. **Task 2: Embedding provider form + Test Connection + Re-embed-all button, wired into the AI Features page** - `28f248d` (feat)

_Note: this worktree was found one wave behind master (missing 05-01…05-04) at execution start and required a fast-forward merge + full `pnpm install`/`prisma generate` bootstrap before any task work began — see Deviations below._

## Files Created/Modified
- `src/app/(app)/settings/actions.ts` - added `saveEmbeddingSettings`/`testEmbeddingConnection`/`reembedAllKb` admin-gated Server Actions
- `src/app/(app)/settings/embedding-provider-form.tsx` - "Embedding Provider" card (openai/ollama Select, model Select w/ Custom… fallback, conditional API-key/base-URL fields, Save)
- `src/app/(app)/settings/embedding-test-connection-button.tsx` - 4-state Test Connection button for the embedding provider
- `src/app/(app)/settings/reembed-all-button.tsx` - "Re-embed all KB articles" action button, disabled at zero articles
- `src/app/(app)/settings/page.tsx` - loads embedding settings/config/article count, renders the new card + button between `LlmProviderForm` and `AiToggle`

## Decisions Made
- Gated the "Re-embed all KB articles" button's visibility on `isEmbeddingConfigured(db)` (a page-level conditional, not a plan-mandated requirement) — prevents an admin from triggering a guaranteed no-op (kb-embed-article's own config gate sets every article to FAILED without a configured provider). The button's own component logic still independently disables at `articleCount === 0` per the plan's literal spec.
- Reused `EmbeddingProviderName`/`EMBEDDING_MODEL_CATALOG` from 05-02's `src/lib/rag/types.ts` rather than re-declaring a second literal union in the form component, keeping the catalog as the single source of truth for both the Select options and the "already-saved model not in catalog" custom-fallback check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree was one wave behind master; fast-forwarded before any task work**
- **Found during:** Session start (before Task 1)
- **Issue:** This plan's assigned worktree (`agent-a9447fb16deb43c1f`) was checked out at `5fcdfb5` — before the Wave 1 (05-01/05-02) and Wave 2 (05-03/05-04) merges to `master`. `src/lib/rag/`, `src/lib/kb/`, and the `KbArticle`/`KbChunk` schema this plan depends on did not exist in the worktree. No `node_modules`/`.env`/generated Prisma client existed either (fresh worktree, never bootstrapped).
- **Fix:** Verified `git merge-base --is-ancestor HEAD master` (safe fast-forward, no divergent commits), ran `git merge --ff-only master`, then `cp .env.example .env && pnpm install && pnpm prisma generate` to bootstrap the worktree. Mirrors the identical stale-worktree pattern already documented at 03-05 and 05-04.
- **Files modified:** None (merge only; no manual file edits)
- **Verification:** `git log --oneline` confirmed all of 05-01…05-04 present; `pnpm exec tsc --noEmit` clean afterward.
- **Committed in:** N/A (fast-forward merge, no new commit created; worktree HEAD moved to `master`'s existing tip `0ac9838`)

**2. [Rule 3 - Blocking] Pre-existing CRLF/LF formatter mismatch on every file in the tree**
- **Found during:** Task 1 and Task 2 (running `biome check` on this plan's own edited files)
- **Issue:** `core.autocrlf=true` (Windows) checks every file out with CRLF while the repo stores LF (no `.gitattributes`); `biome check` flags this as a format violation on every touched file, including ones this plan edited (`actions.ts`, `page.tsx`) — confirmed pre-existing and repo-wide (an untouched sibling file, `ai-toggle.tsx`, shows the identical diff).
- **Fix:** Ran `biome check --write` scoped ONLY to the files this plan directly created/edited (mechanical line-ending + import-order normalization, zero logic change) — mirrors the 04-07 precedent exactly. Did NOT run a blanket fix across the rest of the settings directory (out of scope, logged to `deferred-items.md` instead).
- **Files modified:** `src/app/(app)/settings/actions.ts`, `src/app/(app)/settings/page.tsx`
- **Verification:** `biome check` scoped to this plan's 6 files now exits 0; `pnpm exec tsc --noEmit` and `pnpm run build` both still clean afterward.
- **Committed in:** `ea3f6e0` (Task 1), `28f248d` (Task 2) — the fix is folded into each task's own commit since it only touched that task's files.

---

**Total deviations:** 2 auto-fixed (1 blocking/environment bootstrap, 1 blocking/formatter). No scope creep — both were prerequisites for this plan's own verify gates to run at all.

## Issues Encountered
- The plan's literal directory-wide verify command (`pnpm exec biome check src/app/(app)/settings`) fails due to the pre-existing CRLF issue on sibling files this plan never touches (`llm-provider-form.tsx`, `ai-toggle.tsx`, `email/*`, `sla/*`, `tags/*`, `custom-fields/*`, etc.). Confirmed out of scope per SCOPE BOUNDARY and logged to `.planning/phases/05-rag-drafted-replies/deferred-items.md`. This plan's own 6 files are individually biome-clean.

## User Setup Required

None - no external service configuration required. An operator still needs to actually enter a real OpenAI/Ollama credential in the new Embedding Provider card for RAG retrieval (05-04) to function — this plan ships the UI/action surface, not a credential.

## Next Phase Readiness
- AIDA-15's operator-facing embedding config gap is now closed: 05-01 (schema) + 05-02 (embedding port) + 05-03 (chunk/embed write path) + 05-04 (retrieval/draft) + 05-05 (this plan, config UI) together make the full KB embed pipeline operable end-to-end once an admin enters a real credential.
- 05-06 (KB authoring UI) and 05-07 (ticket draft UI + human gate) are unaffected by this plan's files (no shared components) and can proceed independently.
- Not yet done: a live smoke test with a real OpenAI/Ollama credential (this plan's Test Connection button was verified by code review + typecheck/build only, not against a live provider — no credential available in this sandboxed environment).

---
*Phase: 05-rag-drafted-replies*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: src/app/(app)/settings/embedding-provider-form.tsx
- FOUND: src/app/(app)/settings/embedding-test-connection-button.tsx
- FOUND: src/app/(app)/settings/reembed-all-button.tsx
- FOUND: .planning/phases/05-rag-drafted-replies/deferred-items.md
- FOUND: .planning/phases/05-rag-drafted-replies/05-05-SUMMARY.md
- FOUND commit: ea3f6e0 (Task 1)
- FOUND commit: 28f248d (Task 2)
