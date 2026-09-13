---
phase: 03-email-channel
plan: 01
subsystem: database
tags: [prisma, postgresql, imapflow, mailparser, nodemailer, html-to-text, rehype-parse, scoped-db]

# Dependency graph
requires:
  - phase: 02-core-ticketing
    provides: Message model (direction/visibility/triggeredReopen), scopedDb DOMAIN_MODELS pattern, hand-written searchVector FTS migration
provides:
  - Email-channel npm dependencies (imapflow, mailparser, nodemailer, html-to-text, rehype-parse + types)
  - Message.emailMessageId / emailInReplyTo / emailReferences / deliveryStatus fields
  - MessageDeliveryStatus enum (QUEUED/SENT/FAILED)
  - EmailIngestFailure model (org-scoped poison-message guard) + organization back-relation
  - Additive migration 20260706025051_email_channel
  - scopedDb DOMAIN_MODELS now includes EmailIngestFailure
affects: [03-02, 03-03, 03-04, 03-05, 03-06]

# Tech tracking
tech-stack:
  added: [imapflow@1.4.6, mailparser@3.9.14, nodemailer@9.0.3, html-to-text@10.0.0, rehype-parse@9.0.1, "@types/nodemailer@8.0.1", "@types/mailparser@3.4.6"]
  patterns: ["Additive-only Prisma migration hand-edited to preserve a hand-written GENERATED column (searchVector) not represented in schema.prisma", "Disposable dev Postgres container (docker run, unique name/port) used to generate/verify a migration when the compose stack's db has no published port"]

key-files:
  created:
    - prisma/migrations/20260706025051_email_channel/migration.sql
  modified:
    - package.json
    - pnpm-lock.yaml
    - prisma/schema.prisma
    - src/lib/scoped-db.ts

key-decisions:
  - "Email identity fields named emailMessageId/emailInReplyTo/emailReferences (not messageId) to avoid collision with Attachment.messageId FK, per 03-CONTEXT.md discretion"
  - "EmailIngestFailure is a dedicated table (not a Message flag) because ingest failures happen before any Message row exists (poison-message guard, D-06)"
  - "prisma migrate dev's diff engine wanted to DROP the hand-written searchVector column/index on Message and Ticket (not present in schema.prisma) — hand-edited migration.sql to remove those DROP statements, then re-verified by recreating a fresh disposable Postgres and running migrate deploy end-to-end (all 4 migrations apply cleanly, searchVector column + GIN index survive)"

patterns-established:
  - "Additive migrations touching Message/Ticket must be manually reviewed for spurious searchVector DROP statements before commit (Pitfall 3 recurrence guard)"

requirements-completed: []  # AIDA-09 declared in this plan's frontmatter is a phase-level requirement; NOT fully satisfied by 03-01 alone (schema/deps only, no inbound/outbound flow yet) — mirrors the 02-08 precedent for split requirements. Do not mark AIDA-09 complete until the final Phase 3 plan validates end-to-end email intake + reply.

# Metrics
duration: 35min
completed: 2026-07-06
---

# Phase 3 Plan 1: Email Channel Data Foundation Summary

**Installed the verified email-channel library stack and extended the Message model with RFC email-identity fields, an outbound deliveryStatus, and a dedicated org-scoped EmailIngestFailure poison-message guard table — the shared schema/dependency surface every other Phase 3 plan builds on.**

## Performance

- **Duration:** ~35 min (including worktree sync + Docker/Postgres environment setup)
- **Started:** 2026-07-06T02:35:00Z (approx, after worktree fast-forward sync)
- **Completed:** 2026-07-06T02:59:01Z
- **Tasks:** 2/2 completed
- **Files modified:** 4 (+1 created)

## Accomplishments
- Installed imapflow, mailparser, nodemailer, html-to-text, rehype-parse (+ 2 @types packages) — lockfile verified consistent via `pnpm install --frozen-lockfile`
- Extended `Message` with `emailMessageId`/`emailInReplyTo`/`emailReferences`/`deliveryStatus` (all nullable/defaulted, purely additive) + a `MessageDeliveryStatus` enum + a threading index (`organizationId, emailMessageId`)
- Added `EmailIngestFailure` model (org-scoped, unique on `organizationId+emailMessageId`) + `organization.emailIngestFailures` back-relation
- Generated migration `20260706025051_email_channel`, hand-edited to remove the diff engine's spurious `DROP COLUMN/INDEX` of the hand-written `searchVector` columns, then proved the corrected migration applies cleanly end-to-end (fresh disposable Postgres + `migrate deploy`, all 4 migrations, `searchVector` column + GIN index intact)
- Appended `"EmailIngestFailure"` to `scopedDb`'s `DOMAIN_MODELS` allowlist
- `pnpm prisma generate` and `pnpm exec tsc --noEmit` both clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Install email-channel libraries** - `a226bd3` (feat)
2. **Task 2: Extend Message + add EmailIngestFailure + migration + scopedDb allowlist** - `dc2df1e` (feat)

**Plan metadata:** (this commit) `docs(03-01): complete email channel data foundation plan`

## Files Created/Modified
- `package.json` - added imapflow, mailparser, nodemailer, html-to-text, rehype-parse (deps) + @types/nodemailer, @types/mailparser (devDeps)
- `pnpm-lock.yaml` - lockfile updated for the above
- `prisma/schema.prisma` - `MessageDeliveryStatus` enum; `Message.emailMessageId/emailInReplyTo/emailReferences/deliveryStatus` + `@@index([organizationId, emailMessageId])`; `EmailIngestFailure` model; `organization.emailIngestFailures` back-relation
- `prisma/migrations/20260706025051_email_channel/migration.sql` - additive migration (new columns/enum/table only; hand-edited to drop the diff engine's spurious searchVector DROP statements)
- `src/lib/scoped-db.ts` - `DOMAIN_MODELS` now includes `"EmailIngestFailure"`

## Decisions Made
- Field naming avoids collision with the existing `Attachment.messageId` FK (used `emailMessageId` etc.), per the plan's explicit instruction and 03-CONTEXT.md discretion note.
- Since the project's `docker-compose.yml` `db` service publishes no host port (internal-network only, by design for the one-command self-host stack), migration generation used a disposable, uniquely-named `pgvector/pgvector:pg16` container on a random host port (mirroring the 02-01-established "disposable dev Postgres container" pattern), torn down after verification. `.env`'s `DATABASE_URL` was reset back to the repo default (`localhost:5432`) afterward so it doesn't point at a since-removed container.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed spurious searchVector DROP statements from the generated migration**
- **Found during:** Task 2, step 6 (the plan's own mandated "CRITICAL REVIEW" step)
- **Issue:** `prisma migrate dev --name email_channel`'s diff engine detected the hand-written `searchVector` tsvector columns/GIN indexes on `Message`/`Ticket` (intentionally absent from `schema.prisma` per a Phase 2 decision) as columns that should be dropped, and generated `DROP INDEX`/`DROP COLUMN` statements for both tables.
- **Fix:** Hand-edited `migration.sql` to remove all `searchVector`-related DROP statements, keeping only the intended `ADD COLUMN`/`CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX` statements. Re-verified by destroying and recreating the disposable Postgres container from scratch and running `prisma migrate deploy` (applies all 4 migrations in order) — confirmed via `\d "Message"` that `searchVector` (column + GIN index) survives and all new email fields/table are present.
- **Files modified:** `prisma/migrations/20260706025051_email_channel/migration.sql`
- **Verification:** `grep -rq searchVector prisma/migrations/*_email_channel/migration.sql` returns no match; fresh-container `migrate deploy` + `psql \d "Message"` confirms `searchVector` intact.
- **Committed in:** `dc2df1e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — this was an explicitly anticipated pitfall the plan itself instructed to check for)
**Impact on plan:** Necessary correctness fix per the plan's own "CRITICAL REVIEW (Pitfall 3)" instruction. No scope creep.

## Issues Encountered
- This worktree was created before Phase 3 was planned on `master` (no `.planning/phases/03-email-channel/` directory existed at session start, `gsd-tools init` reported `phase_found: false`). Confirmed the worktree's HEAD was a direct ancestor of `master`'s current HEAD and fast-forward merged (`git merge master --ff-only`) to bring in the Phase 3 planning docs (03-CONTEXT.md, 03-RESEARCH.md, the 6 plan files) plus unrelated already-merged Phase 2 UAT/UI-review/E2E work — no local work was at risk (worktree was clean).
- Docker Desktop's daemon was not yet running when this session started (`docker ps` initially failed to connect); started it and polled until ready. The project's existing `docker compose` stack (app/worker/db/caddy) was already present from a prior session and came back up automatically — it was not used for migration generation since its `db` service publishes no host port; used a separate disposable container instead (see Decisions Made).
- This was a fresh worktree with no bootstrapped `node_modules`/`.env` — ran `pnpm install` and `cp .env.example .env` before starting Task 1, matching the established 02-02 bootstrap decision.

## User Setup Required

None - no external service configuration required. (Real IMAP/SMTP mailbox configuration is Settings UI work for a later plan in this phase, per 03-CONTEXT.md D-24.)

## Next Phase Readiness

- `package.json`/`prisma/schema.prisma`/`src/lib/scoped-db.ts` are now the shared, stable surface for every downstream Phase 3 plan (parsing/threading, inbound poll job, outbound send job, Settings Email tab) — none of them need to touch these three files again, avoiding merge contention across parallel worktrees.
- `Message.emailMessageId`/`emailInReplyTo`/`emailReferences`/`deliveryStatus` and `EmailIngestFailure` are fully typed in the generated Prisma client (`pnpm exec tsc --noEmit` clean) and ready to be read/written by downstream plans.
- No blockers for 03-02 through 03-06.

---
*Phase: 03-email-channel*
*Completed: 2026-07-06*

## Self-Check: PASSED

- FOUND: package.json
- FOUND: prisma/schema.prisma
- FOUND: prisma/migrations/20260706025051_email_channel/migration.sql
- FOUND: src/lib/scoped-db.ts
- FOUND: .planning/phases/03-email-channel/03-01-SUMMARY.md
- FOUND commit: a226bd3
- FOUND commit: dc2df1e
