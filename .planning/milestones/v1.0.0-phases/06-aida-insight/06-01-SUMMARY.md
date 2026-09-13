---
phase: 06-aida-insight
plan: 01
subsystem: db-schema
tags: [prisma, pgvector, migration, scoped-db, audit, insight]

dependency_graph:
  requires: []
  provides:
    - "InsightRun/TicketEmbedding/CsatResponse Prisma models (org-scoped) with InsightRunStatus enum"
    - "TicketEmbedding.embedding vector(768) column (Unsupported field, raw-SQL I/O only)"
    - "AuditActionType INSIGHT_CLUSTER_LABELS/INSIGHT_SUMMARY enum values"
    - "scopedDb DOMAIN_MODELS allowlist including InsightRun/TicketEmbedding/CsatResponse"
    - "recordAuditEvent() actionType union widened for the insight flow"
    - "src/lib/insight/types.ts — the persisted-shape contract for InsightRun's Json? columns"
  affects:
    - "src/lib/scoped-db.ts (all future scopedDb consumers)"
    - "src/components/tickets/ai-activity-section.tsx (ACTION_LABELS Record now covers all AuditActionType values)"

tech_stack:
  added: []
  patterns:
    - "Import-free types.ts module (mirrors src/lib/rag/types.ts) as the single writer/reader contract for a Json? column family"

key_files:
  created:
    - prisma/migrations/20260724171144_insight_aida/migration.sql
    - src/lib/insight/types.ts
  modified:
    - prisma/schema.prisma
    - src/lib/scoped-db.ts
    - src/lib/audit/record-audit-event.ts
    - src/components/tickets/ai-activity-section.tsx

decisions:
  - "Widening AuditActionType broke ai-activity-section.tsx's ACTION_LABELS: Record<AuditActionType, string> (TS2739, missing keys) — added INSIGHT_CLUSTER_LABELS/INSIGHT_SUMMARY labels rather than loosening the Record's type, keeping the exhaustiveness guarantee that documents every action type's display label."
  - "scoped-db.ts's $allOperations signature was reformatted (destructured across multiple lines) because biome's line-width rule now wraps the previously-committed single-line signature; the two any-typed fields each got their own biome-ignore comment (a single ignore above a multi-any long line stopped covering the second occurrence once wrapped) — no behavior change."

metrics:
  duration_minutes: 75
  completed: 2026-07-25
---

# Phase 6 Plan 01: AIDA Insight Data Foundation Summary

Added three org-scoped Prisma models (`InsightRun`, `TicketEmbedding` with a `vector(768)` cache column, `CsatResponse`) plus the `InsightRunStatus` enum, widened `AuditActionType` with two insight action types, extended `scopedDb`'s allowlist and `recordAuditEvent`'s type union, and defined `src/lib/insight/types.ts` — the shared persisted-shape contract every downstream Phase 6 plan (clustering, aggregates, KB-gap, orchestrator, UI, CSAT capture) will import.

## What Was Built

**Task 1 — Schema + migration** (`prisma/schema.prisma`, `prisma/migrations/20260724171144_insight_aida/migration.sql`):
- `InsightRunStatus` enum (PENDING/RUNNING/COMPLETED/FAILED).
- `InsightRun` model: `periodDays`/`periodStart`/`periodEnd`, `params` (Json, required — the run's reproducibility contract) + `clusters`/`kbGaps`/`volumeDrivers`/`slaCsat`/`narrative` (all Json?), `ticketCount`/`embeddingModel`/`provider`/`model`/`error`, `createdAt`/`completedAt`.
- `TicketEmbedding` model: `ticketId`/`embeddingModel` + `embedding Unsupported("vector(768)")` (Prisma-invisible, raw-SQL I/O only, mirrors `KbChunk`), `@@unique([ticketId, embeddingModel])`.
- `CsatResponse` model: `ticketId` (`@unique` — one response per ticket), `score`/`comment`.
- `organization` gained `insightRuns`/`ticketEmbeddings`/`csatResponses` back-relations; `Ticket` gained `ticketEmbeddings`/`csatResponse` back-relations.
- `AuditActionType` widened to `TRIAGE | DRAFT_GENERATED | DRAFT_APPROVED | INSIGHT_CLUSTER_LABELS | INSIGHT_SUMMARY`.
- Migration generated via the established disposable `pgvector/pgvector:pg16` Docker container procedure (Docker Desktop was not running at session start — started it, verified `docker info`), `.env`'s `DATABASE_URL` temporarily pointed at `localhost:55432`, `prisma migrate dev --name insight_aida` run, hand-reviewed before commit:
  - **The spurious `DROP COLUMN "searchVector"` / `DROP INDEX ..._searchVector_idx` pair on `Message` and `Ticket` recurred (6th confirmed occurrence, after 02-01/03-01/04-01/05-01/03-04 — Pitfall 3) and was removed by hand.**
  - Added the standard `-- NOTE:` comments: one documenting that the tsvector columns/indexes are hand-managed and must survive, one documenting the deliberate absence of a pgvector index on `TicketEmbedding` (brute-force KNN only, mirrors `KbChunk`'s no-index Decision 4, avoids prisma/prisma#28414).
  - Container torn down and recreated fresh; `prisma migrate deploy` applied all 7 migrations cleanly from scratch.
  - Verified via `psql \d "TicketEmbedding"` that `embedding` is `vector(768)`, and via `psql \d "Message"` / `\d "Ticket"` that `searchVector` (column + GIN index) **survived** on both tables.
  - Container removed; `.env`'s `DATABASE_URL` reset to the repo-default `localhost:5432`.
- `prisma generate` regenerated the client at `src/generated/prisma`; `prisma validate` and `tsc --noEmit` both exit 0.

**Task 2 — scopedDb + audit widening** (`src/lib/scoped-db.ts`, `src/lib/audit/record-audit-event.ts`):
- `DOMAIN_MODELS` now: `Setting, Ticket, Contact, Message, Tag, SlaPolicy, CustomFieldDefinition, CustomFieldValue, Attachment, TicketCounter, EmailIngestFailure, AuditEvent, KbArticle, KbChunk, InsightRun, TicketEmbedding, CsatResponse` — the three new models auto-get `organizationId` injection on create/findMany/findFirst/count/update/upsert/delete. Per 06-RESEARCH.md Pitfall 1, `groupBy`/`aggregate` and all `vector(768)` raw-SQL I/O are NOT covered by this allowlist — those call sites (later plans) must carry an explicit `organizationId` filter themselves.
- `recordAuditEvent()`'s `RecordAuditEventParams.actionType` union widened to add `"INSIGHT_CLUSTER_LABELS" | "INSIGHT_SUMMARY"`; the stale `// INSIGHT_RUN added in Phase 6` comment (which anticipated one combined type) is gone.

**Task 3 — shared persisted-shape contract** (`src/lib/insight/types.ts`, new file):
- Pure interfaces only, zero imports (grep-verified: `0 matches for '^import'`): `InsightRunParams`, `TicketCitation`, `StoredCluster`, `NearestArticle`, `StoredKbGap`, `VolumeDriverRow`, `VolumeDrivers`, `SlaCsatSummary`, `StoredNarrative` — the exact shapes persisted into `InsightRun`'s five `Json?` columns, verbatim from the plan/CONTEXT. This is the ONE contract the future orchestrator (writer) and `/insights` UI (reader, casting raw `JsonValue` back to these types) both use, closing Pitfall 5's Json-column type-erasure gap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ai-activity-section.tsx`'s `ACTION_LABELS` Record no longer covered all `AuditActionType` values**
- **Found during:** Task 1 verification (`tsc --noEmit`)
- **Issue:** `ACTION_LABELS: Record<AuditActionType, string>` is an exhaustive map (TS2739 fired: missing `INSIGHT_CLUSTER_LABELS`/`INSIGHT_SUMMARY`) once `AuditActionType` was widened — a pre-existing component (04-06/05-07), not in this plan's declared `files_modified`, but broken by this plan's own schema change.
- **Fix:** Added `INSIGHT_CLUSTER_LABELS: "Insight cluster labels"` and `INSIGHT_SUMMARY: "Insight summary"` entries.
- **Files modified:** `src/components/tickets/ai-activity-section.tsx`
- **Commit:** `4df3fa6`

**2. [Rule 3 - Blocking] `scoped-db.ts`'s `$allOperations` signature failed biome's format check after a mechanical CRLF/format pass**
- **Found during:** Task 2 verification (`biome check`)
- **Issue:** `biome check --write` (needed to fix the repo's recurring CRLF-vs-LF drift, per 02-05/02-08/05-05 precedent) reformatted the previously single-line `$allOperations` destructuring signature into a multi-line block, which moved the single `// biome-ignore lint/suspicious/noExplicitAny` comment away from the two lines it needs to suppress (`args: any` / `query: (args: any) => Promise<any>`), producing 3 new `noExplicitAny` warnings plus an "unused suppression" warning.
- **Fix:** Kept the wrapped multi-line format (biome's own preference) and moved a `biome-ignore` comment directly above each of the two `any`-typed lines. No behavior change.
- **Files modified:** `src/lib/scoped-db.ts`
- **Commit:** `0703b34`

## Known Stubs

None — this plan is pure schema/type foundation with no UI or runtime data flow to stub.

## Self-Check: PASSED

- FOUND: prisma/migrations/20260724171144_insight_aida/migration.sql
- FOUND: prisma/schema.prisma (model InsightRun, model TicketEmbedding, model CsatResponse, enum InsightRunStatus, AuditActionType widened)
- FOUND: src/lib/scoped-db.ts (InsightRun/TicketEmbedding/CsatResponse in DOMAIN_MODELS)
- FOUND: src/lib/audit/record-audit-event.ts (INSIGHT_CLUSTER_LABELS/INSIGHT_SUMMARY)
- FOUND: src/lib/insight/types.ts (zero imports, 9 exported interfaces)
- FOUND commit 4df3fa6 (Task 1)
- FOUND commit 0703b34 (Task 2)
- FOUND commit ec6a496 (Task 3)
- `prisma validate` and `tsc --noEmit` both exit 0 (verified)
- `biome check` on all touched files clean (verified)
