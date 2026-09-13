---
phase: 02-core-ticketing
plan: 03
subsystem: database
tags: [prisma, postgres, transactions, contacts, sla, ticketing]

# Dependency graph
requires:
  - phase: 02-core-ticketing (02-01)
    provides: Ticket/TicketCounter/Contact/Message/SlaPolicy Prisma models, scopedDb DOMAIN_MODELS allowlist, proof that scopedDb auto-injects organizationId inside interactive $transaction
  - phase: 02-core-ticketing (02-02)
    provides: renderMarkdown() sanitized Markdown->HTML pipeline
provides:
  - "createTicket(orgId, input) — the single ticket-creation entrypoint (race-safe numbering + contact dedup + SLA stamping + sanitized initial message)"
  - "findOrCreateContact(db, input) — normalized-email Contact dedup/backfill helper"
  - "getSlaTargets(db, priority) + DEFAULT_SLA_TARGETS + computeDueTimestamps() — SLA policy lookup with seeded fallback"
  - "generateStatusToken() — dedicated high-entropy public status-page bearer token"
affects: [02-04 (FTS+attachments), 02-05 (SLA worker+rate-limit), 02-08 (inbox New Ticket flow), 02-09 (reading pane), 02-11 (public web-form intake), 02-12 (public status page)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pick<ReturnType<typeof scopedDb>, 'modelName'> parameter typing lets a helper accept both a full scopedDb() client and an in-flight interactive-$transaction tx client (which structurally lacks $connect/$disconnect/$extends/$transaction) without a cast at every call site."
    - "Narrow function-type cast (`as (a: { data: Record<string, unknown> }) => Promise<...>`) at scopedDb create/upsert call sites whose generated *UncheckedCreateInput requires organizationId statically, even though scopedDb injects it at runtime — same pattern established in tests/integration/scoped-tx.test.ts (02-01)."

key-files:
  created:
    - src/lib/tickets/status-token.ts
    - src/lib/tickets/sla.ts
    - src/lib/contacts/find-or-create-contact.ts
    - src/lib/tickets/create-ticket.ts
    - tests/integration/create-ticket.test.ts
  modified: []

key-decisions:
  - "createTicket() is the ONE code path that creates tickets (agent New Ticket flow and public web form both funnel through it) — numbering/contact/SLA rules enforced in exactly one place."
  - "SLA seeded defaults finalized: URGENT 1h/8h, HIGH 4h/24h, NORMAL 8h/48h, LOW 24h/72h (first-response/resolution, minutes)."
  - "Public status-page token is a dedicated crypto.randomBytes(24) base64url secret stored in Ticket.statusToken — never the ticket cuid (per RESEARCH.md Open Question 1)."
  - "findOrCreateContact backfills only currently-null name/phone/company fields on an existing match; never overwrites a populated field."

patterns-established:
  - "Pattern: any helper called from inside createTicket's $transaction must accept a Pick<ReturnType<typeof scopedDb>, ...>-narrowed client type, not the full scopedDb() return type, so both top-level and tx-scoped callers typecheck without casts."

requirements-completed: [AIDA-01, AIDA-03, AIDA-06]

# Metrics
duration: 38min
completed: 2026-07-02
---

# Phase 02 Plan 03: Ticket-Creation Domain Core Summary

**Single `createTicket()` entrypoint wiring a concurrency-safe per-org TicketCounter upsert, normalized-email Contact dedup, SLA due-timestamp stamping, and a dedicated high-entropy status token — proven race-safe by a 20-way concurrent Testcontainers integration test.**

## Performance

- **Duration:** 38 min (task-commit span; additional ~25 min of pre-task worktree sync — fast-forward onto master to pick up Wave 1's schema/scopedDb/renderMarkdown, `pnpm install`, `pnpm prisma generate` — not counted above)
- **Started:** 2026-07-02T07:22:04+07:00
- **Completed:** 2026-07-02T08:00:27+07:00
- **Tasks:** 3 completed
- **Files modified:** 5 (5 created, 0 modified)

## Accomplishments
- `generateStatusToken()` (crypto.randomBytes(24) base64url) and `sla.ts` (`DEFAULT_SLA_TARGETS`, `getSlaTargets`, `computeDueTimestamps`) — the two small building blocks `createTicket` needs.
- `findOrCreateContact()` — normalized (trim+lowercase) email dedup with backfill-only-if-null semantics (D-07).
- `createTicket()` — one interactive `$transaction`: contact link/create -> `TicketCounter.upsert` (race-safe per-org sequential number) -> SLA target lookup + due-timestamp computation -> `Ticket.create` -> `Message.create` with `renderMarkdown()`-sanitized `bodyHtml`.
- Integration test proves: sequential numbering (1, 2), zero duplicate numbers across 20 concurrent `createTicket()` calls (`Promise.all`), and that `A@X.com`/`a@x.com` resolve to the same Contact.

## Task Commits

Each task was committed atomically:

1. **Task 1: status-token + SLA helpers** - `8f9959b` (feat)
2. **Task 2: findOrCreateContact + createTicket transaction** - `b4d88e7` (feat), follow-up type-narrowing fix `3cb499e` (fix)
3. **Task 3: Integration test — ticket-number race + creation wiring** - `f3f2b1e` (test)

**Plan metadata:** (this commit, following SUMMARY/STATE/ROADMAP update)

## Files Created/Modified
- `src/lib/tickets/status-token.ts` - `generateStatusToken()` via `crypto.randomBytes(24).toString("base64url")`
- `src/lib/tickets/sla.ts` - `DEFAULT_SLA_TARGETS`, `getSlaTargets(db, priority)`, `computeDueTimestamps(from, firstResponseMinutes, resolutionMinutes)`
- `src/lib/contacts/find-or-create-contact.ts` - `findOrCreateContact(db, input)` normalized-email dedup/backfill
- `src/lib/tickets/create-ticket.ts` - `createTicket(orgId, input)` single transaction: contact + counter + SLA + Ticket + initial Message
- `tests/integration/create-ticket.test.ts` - 3 Testcontainers-backed tests (sequential numbering, 20-way concurrency uniqueness, email dedup)

## Decisions Made
- Finalized SLA numbers from RESEARCH.md's illustrative matrix (URGENT 1h/8h, HIGH 4h/24h, NORMAL 8h/48h, LOW 24h/72h) as the actual `DEFAULT_SLA_TARGETS` — no further discretion needed downstream.
- Adopted the RESEARCH.md Open-Question-1 recommendation as final: `statusToken` is a dedicated `crypto.randomBytes(24)` secret, not derived from the ticket `id`.
- `findOrCreateContact`'s update-on-match only fills currently-null fields (never overwrites populated ones) — matches D-07 ("missing fields fill in over time").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tsc --noEmit` failed on scopedDb create/upsert calls due to Prisma's generated `*UncheckedCreateInput` requiring `organizationId` statically**
- **Found during:** Task 2 (first typecheck pass after writing `create-ticket.ts` and `find-or-create-contact.ts`)
- **Issue:** `Contact.create`, `Ticket.create`, and `Message.create` all failed to typecheck with "Property 'organizationId' is missing" — the exact class of type/runtime mismatch already documented in `02-01-SUMMARY.md` deviation #3 for `TicketCounter.upsert`. Additionally, passing the interactive-`$transaction` `tx` client into `findOrCreateContact`/`getSlaTargets` (typed as the full `ReturnType<typeof scopedDb>`) failed because `tx` structurally lacks `$connect`/`$disconnect`/`$extends`/`$transaction`.
- **Fix:** Applied the same narrow function-type cast pattern used in `tests/integration/scoped-tx.test.ts` (02-01) to the three create calls, and narrowed `findOrCreateContact`/`getSlaTargets`'s `db` parameter types to `Pick<ReturnType<typeof scopedDb>, "contact">` / `Pick<ReturnType<typeof scopedDb>, "slaPolicy">` respectively, so both the top-level `scopedDb()` client and the `tx` client satisfy the signature.
- **Files modified:** `src/lib/contacts/find-or-create-contact.ts`, `src/lib/tickets/create-ticket.ts`, `src/lib/tickets/sla.ts`
- **Verification:** `pnpm exec tsc --noEmit` clean; `pnpm exec biome check` clean (after `biome format --write` normalized two lines); all 3 integration tests green.
- **Committed in:** `b4d88e7` (Task 2 commit), `3cb499e` (follow-up fix for `sla.ts`'s `getSlaTargets` signature, discovered/fixed in the same pass but isolated into its own commit)

---

**Total deviations:** 1 auto-fixed (bug — TS type/runtime mismatch class already known from 02-01). No architectural changes, no scope creep.
**Impact on plan:** None of the plan's intended transaction shape, field names, or acceptance criteria changed — only the compile-time type annotations needed adjusting to match a known Prisma-generated-types limitation.

## Issues Encountered
- **Worktree behind master:** This execution's assigned worktree was 1 commit behind master (missing Wave 1's `02-01`/`02-02` merges — new Prisma models, scopedDb allowlist, `renderMarkdown()`). Fast-forwarded (`git merge --ff-only`) before starting — a strict-ancestor catch-up, zero divergent commits, lossless. Ran `pnpm install` + `DATABASE_URL=... pnpm prisma generate` afterward to regenerate the Prisma client with the new models.
- **Missing `.env`:** Fresh worktree had no `.env` (gitignored); copied `.env.example` -> `.env` per the STATE.md-documented bootstrap step, required before `tsc --noEmit`/`prisma generate` succeed.
- **Node version mismatch for Testcontainers:** the shell's default `pnpm`/`node` resolved to v20.20.2 (Testcontainers/undici@8 requires Node 22), matching the known STATE.md issue. Used `volta run --node 22 pnpm test:integration -- create-ticket` per the documented workaround; all 3 tests passed.

## Next Phase Readiness
- `createTicket()`, `findOrCreateContact()`, `getSlaTargets()`/`computeDueTimestamps()`, and `generateStatusToken()` are all available for 02-08 (inbox "New Ticket" flow), 02-09 (reading pane composer replies reuse the same `renderMarkdown()`/Message shape), 02-11 (public web-form intake — calls `createTicket()` directly after resolving `orgId` via `organization.findFirstOrThrow()`), and 02-12 (public status page reads `Ticket.statusToken`).
- 02-05 (SLA worker) can rely on `Ticket.firstResponseTargetMinutes`/`resolutionTargetMinutes`/`firstResponseDueAt`/`resolutionDueAt` being correctly stamped at creation time by `createTicket()`.
- No blockers for downstream Wave 2 plans (02-04, 02-05, 02-06, 02-07) — all can proceed in parallel per the phase's wave plan.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 5 created files found on disk; all 4 task commit hashes (`8f9959b`, `b4d88e7`, `3cb499e`, `f3f2b1e`) found in git history.
