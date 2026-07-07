---
phase: 04-ai-foundation
plan: 01
subsystem: database
tags: [prisma, postgresql, openai, anthropic-ai-sdk, ollama, scoped-db, audit-log]

# Dependency graph
requires:
  - phase: 03-email-channel
    provides: scopedDb DOMAIN_MODELS pattern, hand-written searchVector FTS migration precedent, disposable-container migration procedure
provides:
  - openai@6.45.0 / @anthropic-ai/sdk@0.110.0 / ollama@0.6.3 installed and importable
  - Ticket.triageCategory / triageSentiment / triageLanguage / triageStatus columns
  - TriageCategory / TriageSentiment / TriageStatus / AuditActionType enums
  - Org-scoped, self-contained (no FK to Ticket/Message) AuditEvent model
  - DB-level append-only enforcement (BEFORE UPDATE OR DELETE trigger, role-independent)
  - scopedDb DOMAIN_MODELS now includes AuditEvent
  - tests/integration/audit-append-only.test.ts proving the DB rejects UPDATE/DELETE
affects: [04-02, 04-03, 04-04, 04-05, 04-06]

# Tech tracking
tech-stack:
  added: ["openai@6.45.0", "@anthropic-ai/sdk@0.110.0", "ollama@0.6.3"]
  patterns:
    - "Append-only DB enforcement via a role-independent BEFORE UPDATE OR DELETE trigger (RAISE EXCEPTION), not a role-scoped REVOKE — survives an operator renaming POSTGRES_USER"
    - "AuditEvent stores ticketId/messageId as plain nullable strings with NO foreign-key relation — a self-contained historical copy that survives deletion of the source ticket (D-17)"
    - "Hand-written trigger SQL appended to the same Prisma-generated migration as the table it protects (never split across two migrations) — mirrors the existing hand-written searchVector tsvector-column precedent"

key-files:
  created:
    - prisma/migrations/20260707053633_ai_foundation/migration.sql
    - tests/integration/audit-append-only.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - prisma/schema.prisma
    - src/lib/scoped-db.ts

key-decisions:
  - "All three provider SDKs installed at the exact versions verified in 04-RESEARCH.md (openai@6.45.0, @anthropic-ai/sdk@0.110.0, ollama@0.6.3) — all three were available at these exact versions, no fallback-to-latest needed"
  - "AuditEvent deliberately has no Prisma relation/FK to Ticket or Message — organizationId is the only relation, so workspace deletion cascades the audit trail but ticket/message deletion never orphans or blocks an audit row (D-17)"
  - "Append-only enforced via a hand-written Postgres trigger appended to the SAME migration.sql that creates the AuditEvent table (never a separate migration) — closes any window where the table would exist but be mutable"
  - "requirements AIDA-14 and AIDA-19 intentionally NOT marked complete in REQUIREMENTS.md yet — this plan only lays the data-layer foundation (columns/model/trigger); the actual triage engine, LLM port, and recordAuditEvent() write path land in 04-02/04-03/04-05. Mirrors the established 02-08/03-01 precedent for phase-level requirements split across multiple plans."

patterns-established:
  - "Any future migration touching Ticket/Message must be manually reviewed for the diff engine's spurious searchVector DROP statements before commit (Pitfall 3 recurred a third time in this plan, confirming the pattern is now a standing checklist item, not a one-off)"

requirements-completed: []  # AIDA-19/AIDA-14 declared in this plan's frontmatter are phase-level requirements; this plan (Wave 1) only ships the schema/DB foundation. Not marked complete until the full triage flow (04-02 through 04-05) lands and AI actions are actually recorded.

# Metrics
duration: 20min
completed: 2026-07-07
---

# Phase 4 Plan 1: AI Foundation Data Layer Summary

**Installed the openai/@anthropic-ai/sdk/ollama provider SDKs, added triage columns to Ticket, and created an org-scoped, DB-level append-only AuditEvent model enforced by a role-independent Postgres trigger — the foundation every other Phase 4 plan builds on.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-07T05:30:00Z (approx)
- **Completed:** 2026-07-07T05:44:16Z
- **Tasks:** 2/2 completed
- **Files modified:** 4 modified, 2 created

## Accomplishments
- Installed `openai@6.45.0`, `@anthropic-ai/sdk@0.110.0`, `ollama@0.6.3` at the exact versions verified in 04-RESEARCH.md
- Added `TriageCategory` (5-value, no "General"), `TriageSentiment` (3-value), `TriageStatus`, and `AuditActionType` enums to `schema.prisma`
- Added nullable `triageCategory`/`triageSentiment`/`triageLanguage`/`triageStatus` columns to `Ticket` (reusing the existing `TicketPriority` enum for priority, no new priority enum)
- Added the org-scoped `AuditEvent` model — `ticketId`/`messageId` are plain nullable strings with no FK relation to `Ticket`/`Message`, so an audit row survives deletion of its source ticket (D-17)
- Generated migration `20260707053633_ai_foundation` via a disposable `pgvector/pgvector:pg16` container (the compose `db` service publishes no host port); hand-stripped the diff engine's spurious `DROP COLUMN "searchVector"` statements on both `Ticket` and `Message` (Pitfall 3 recurred again)
- Appended a role-independent `BEFORE UPDATE OR DELETE` trigger (`aida_audit_event_immutable` / `aida_audit_event_no_update_delete`) to the SAME migration file — not a `REVOKE` (which would break if an operator renames `POSTGRES_USER`)
- Re-verified end-to-end twice: a fresh disposable container running `migrate deploy` applies all 5 migrations cleanly with `searchVector` intact, and the full integration suite (which spins its own fresh Testcontainer) proves the trigger fires
- Added `tests/integration/audit-append-only.test.ts`: INSERT succeeds, UPDATE and DELETE both reject (`.rejects.toThrow()`)
- Extended `scopedDb`'s `DOMAIN_MODELS` allowlist with `"AuditEvent"`
- `pnpm prisma generate`, `pnpm exec tsc --noEmit`, and `pnpm test:integration` (21/21 across all 7 integration test files) all clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Install provider SDKs + add triage columns, enums, and the AuditEvent model** - `d87f477` (feat)
2. **Task 2: Enforce append-only on AuditEvent via a Postgres trigger + integration test** - `6898166` (feat)

**Plan metadata:** (this commit) `docs(04-01): complete AI foundation data layer plan`

## Files Created/Modified
- `package.json` / `pnpm-lock.yaml` - added `openai`, `@anthropic-ai/sdk`, `ollama` dependencies
- `prisma/schema.prisma` - 4 new enums (`TriageCategory`/`TriageSentiment`/`TriageStatus`/`AuditActionType`), 4 new `Ticket` columns, new `AuditEvent` model, `organization.auditEvents` back-relation
- `prisma/migrations/20260707053633_ai_foundation/migration.sql` - additive migration (enums/columns/table) + hand-written append-only trigger; searchVector DROP statements stripped
- `src/lib/scoped-db.ts` - `DOMAIN_MODELS` now includes `"AuditEvent"`
- `tests/integration/audit-append-only.test.ts` - proves DB-level append-only enforcement

## Decisions Made
- All three SDKs installed at their exact researched versions (no fallback-to-latest needed — see key-decisions).
- `AuditEvent` has no FK relation to `Ticket`/`Message` by design (self-contained copy, D-17) — only the `organization` relation exists.
- Trigger appended to the same migration as the table (never split across two migrations, per D-18/Pitfall 3 in 04-RESEARCH.md).
- AIDA-14/AIDA-19 intentionally left unmarked in REQUIREMENTS.md (see key-decisions) — this is the data-layer foundation plan only.

## Deviations from Plan

None - plan executed exactly as written. The plan's own anticipated "Pitfall 3 recurrence" (searchVector DROP statements) occurred exactly as predicted and was handled per the plan's explicit Task 1 step 8 instruction, so this is not tracked as a deviation — it was already an accounted-for step in the plan itself.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. (Actual LLM provider API keys are Settings UI work for a later Phase 4 plan.)

## Next Phase Readiness
- `prisma/schema.prisma`, `src/lib/scoped-db.ts`, and the generated Prisma client are the stable, shared surface for every downstream Phase 4 plan (`lib/llm` port, triage engine, Settings AI Features page, worker wiring, triage UI) — none of them need to re-touch the migration.
- `AuditEvent` is fully typed in the generated client and DB-enforced append-only; `04-03` (triage engine) can call `recordAuditEvent()` against it with confidence no future code path can accidentally mutate history.
- The three provider SDKs are installed and ready for `04-02`'s `lib/llm` adapters.
- No blockers for `04-02` through `04-06`.

---
*Phase: 04-ai-foundation*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: prisma/migrations/20260707053633_ai_foundation/migration.sql
- FOUND: tests/integration/audit-append-only.test.ts
- FOUND: .planning/phases/04-ai-foundation/04-01-SUMMARY.md
- FOUND commit: d87f477
- FOUND commit: 6898166
