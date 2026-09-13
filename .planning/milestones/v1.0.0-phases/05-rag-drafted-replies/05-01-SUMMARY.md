---
phase: 05-rag-drafted-replies
plan: 01
subsystem: db-schema
tags: [prisma, pgvector, migration, scoped-db, audit]

dependency_graph:
  requires: []
  provides:
    - "KbArticle/KbChunk Prisma models (org-scoped) with KbEmbeddingStatus enum"
    - "KbChunk.embedding vector(768) column (Unsupported field, raw-SQL I/O only)"
    - "AuditActionType DRAFT_GENERATED/DRAFT_APPROVED enum values"
    - "scopedDb DOMAIN_MODELS allowlist including KbArticle/KbChunk"
    - "recordAuditEvent() actionType union widened for draft flow"
  affects:
    - "src/lib/scoped-db.ts (all future scopedDb consumers)"

tech_stack:
  added: []
  patterns:
    - "$allOperations single-hook Prisma $extends pattern (replaces per-operation $allModels hooks) for models with Unsupported fields"

key_files:
  created:
    - prisma/migrations/20260721154325_rag_kb/migration.sql
  modified:
    - prisma/schema.prisma
    - src/lib/scoped-db.ts
    - src/lib/audit/record-audit-event.ts

decisions:
  - "scopedDb's $allModels hooks refactored from one handler per operation name to a single $allOperations handler — KbChunk's Unsupported(\"vector(768)\") field makes Prisma drop create/upsert from the per-model operation union, which broke the object-literal typecheck for the old per-operation-key shape. Behavior is unchanged (same organizationId injection into where/data/create per operation type)."
  - "No pgvector index (hnsw/ivfflat) added in this migration — v1 uses brute-force KNN per 05-RESEARCH.md Pitfall 2 / Decision 4; a NOTE comment documents the future re-index procedure and the standing hand-review requirement."

metrics:
  duration_minutes: 45
  completed: 2026-07-21
---

# Phase 5 Plan 01: RAG/KB Schema Foundation Summary

Added org-scoped `KbArticle`/`KbChunk` Prisma models (with a `KbEmbeddingStatus` enum and a fixed `vector(768)` embedding column on `KbChunk`), widened `AuditActionType` with `DRAFT_GENERATED`/`DRAFT_APPROVED`, and extended `scopedDb`/`recordAuditEvent` to recognize the new models/action types — the foundation every later Phase 5 plan (embed pipeline, retrieval, draft generation) builds on.

## What Was Built

**Task 1 — Schema + migration** (`prisma/schema.prisma`, `prisma/migrations/20260721154325_rag_kb/migration.sql`):
- `KbArticle` model: title/slug/bodyMarkdown/bodyHtml + `embeddingStatus` (`KbEmbeddingStatus`: PENDING/COMPLETED/FAILED) + `embeddingModel`, unique on `[organizationId, slug]`.
- `KbChunk` model: position/headingPath/content/embeddingModel + `embedding Unsupported("vector(768)")` — a Prisma-invisible column; all vector reads/writes are raw SQL in later plans.
- `AuditActionType` widened to `TRIAGE | DRAFT_GENERATED | DRAFT_APPROVED`.
- `organization` model gained `kbArticles`/`kbChunks` back-relations.
- Migration generated via a disposable `pgvector/pgvector:pg16` Docker container (Docker Desktop was not running at session start — started it, verified `docker info` before proceeding), applied against a clean database (all 6 migrations via `migrate deploy`), and hand-reviewed before commit:
  - Removed a spurious `DROP COLUMN "searchVector"` / `DROP INDEX ..._searchVector_idx` pair on both `Message` and `Ticket` (Pitfall 3 recurrence — 4th occurrence across Phases 2-4-5) — confirmed via `psql \d` that both tsvector columns/GIN indexes survived on the disposable container after applying.
  - Confirmed `\d "KbChunk"` shows `embedding | vector(768)`.
  - No `CREATE INDEX ... USING hnsw/ivfflat` added (v1 = brute-force KNN); added a `-- NOTE:` comment documenting the future re-index procedure.
  - Container torn down and `.env` removed afterward (repo has no committed `.env`; a temporary one was created from `.env.example` only for the disposable-container session and deleted at the end).
- `pnpm prisma generate` regenerated the client; `pnpm exec tsc --noEmit` clean.

**Task 2 — scopedDb + audit widening** (`src/lib/scoped-db.ts`, `src/lib/audit/record-audit-event.ts`):
- `DOMAIN_MODELS` now includes `"KbArticle"` and `"KbChunk"`, with a doc comment explaining `KbChunk.embedding`'s `Unsupported` status and that all vector I/O uses raw SQL with an explicit `organizationId` filter (mirrors `searchTickets`).
- `recordAuditEvent()`'s `actionType` field type widened to `"TRIAGE" | "DRAFT_GENERATED" | "DRAFT_APPROVED"`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Refactored scopedDb's `$allModels` hooks to a single `$allOperations` hook**
- **Found during:** Task 2 verification (`pnpm exec tsc --noEmit`)
- **Issue:** Adding `KbChunk` (which has an `Unsupported("vector(768)")` field) to `DOMAIN_MODELS` — and more precisely, to the Prisma schema at all — changed the generated `$allModels` query-extension type: Prisma drops `create`/`upsert` from the per-model operation union it exposes for `$allModels` hooks when a domain model has an `Unsupported` field only writable via raw SQL. The original code (one `async create({...})`, one `async upsert({...})`, etc. as object literal keys) started failing `tsc --noEmit` with `TS2353: Object literal may only specify known properties, and 'create' does not exist`. Explicit parameter type annotations on the individual handlers were tried first and didn't resolve it — the object literal's own keys were the problem, not the handler signatures.
- **Fix:** Replaced the eight per-operation handlers (`findMany`, `findFirst`, `count`, `create`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`) with a single `$allOperations` hook that switches on `operation` (a plain string, not a typed key) to decide whether to inject `organizationId` into `data`, `where`, or both (`upsert`). Runtime behavior is identical — same organizationId injection logic, same set of operations covered — this is a type-level fix only.
- **Files modified:** `src/lib/scoped-db.ts`
- **Commit:** `9557136`

None - plan executed exactly as written otherwise. The disposable-container migration-generation procedure required starting Docker Desktop manually (it was not running at session start) — not a deviation from the plan's instructions, just an extra precondition step.

## Known Stubs

None — this plan is pure schema/type foundation with no UI or runtime data flow to stub.

## Self-Check: PASSED

- FOUND: prisma/migrations/20260721154325_rag_kb/migration.sql
- FOUND: prisma/schema.prisma (model KbArticle, model KbChunk, embedding Unsupported("vector(768)"), enum KbEmbeddingStatus, AuditActionType widened)
- FOUND: src/lib/scoped-db.ts (KbArticle/KbChunk in DOMAIN_MODELS)
- FOUND: src/lib/audit/record-audit-event.ts (DRAFT_GENERATED/DRAFT_APPROVED)
- FOUND commit b713c76 (Task 1)
- FOUND commit 9557136 (Task 2)
- `pnpm prisma generate` and `pnpm exec tsc --noEmit` both exit 0 (verified)
- `pnpm exec biome check src/lib/scoped-db.ts src/lib/audit/record-audit-event.ts` clean (verified)
