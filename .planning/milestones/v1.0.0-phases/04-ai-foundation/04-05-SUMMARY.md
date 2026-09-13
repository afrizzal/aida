---
phase: 04-ai-foundation
plan: 05
subsystem: ai-triage
tags: [pg-boss, worker, esbuild, prisma, ticket-lifecycle]

# Dependency graph
requires:
  - phase: 04-ai-foundation
    plan: 03
    provides: "runTriage(ticketId) — idempotent classify+write+audit, FAILED+rethrow on error"
  - phase: 04-ai-foundation
    plan: 04
    provides: "aiEnabled toggle (Phase 1) gated on providerConfigured; llm/settings.ts Setting keys"
provides:
  - "ai-triage on-demand pg-boss queue (worker + app-side createQueue, retryLimit 2)"
  - "aiTriageHandler — kill-switch check (D-20 defense-in-depth) + runTriage dispatch"
  - "createTicket() post-commit auto-enqueue gated on aiEnabled (single entrypoint, D-07)"
  - "rerunTriage Server Action — manual re-run affordance (D-06)"
affects: [04-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "On-demand pg-boss queue registration mirrors email-outbound-send EXACTLY: identical
      createQueue options (retryLimit 2, retryBackoff true, retryDelayMax 300) registered in
      BOTH src/lib/worker/index.ts and src/lib/queue/boss-client.ts's createBoss() — whichever
      side starts first wins, the other's createQueue call is a no-op. No schedule() for
      on-demand queues."
    - "Post-commit enqueue: db.$transaction(...) result is captured into a local `const result`
      (not returned directly) so a post-transaction aiEnabled check + boss.send() can run AFTER
      the Prisma transaction has fully committed — pg-boss sends must never live inside a
      $transaction callback."
    - "Two-layer kill-switch: create-ticket.ts/rerunTriage check aiEnabled before ever enqueuing
      (avoids queue noise when AI is off); aiTriageHandler re-checks aiEnabled before ever
      calling the LLM (defense-in-depth against a race where AI is toggled off between enqueue
      and job pickup, D-20)."

key-files:
  created:
    - src/lib/worker/jobs/ai-triage.ts
  modified:
    - src/lib/worker/index.ts
    - src/lib/queue/boss-client.ts
    - src/lib/tickets/create-ticket.ts
    - src/app/(app)/tickets/[id]/actions.ts

key-decisions:
  - "AIDA-14 intentionally left unmarked in REQUIREMENTS.md/PROJECT.md — its acceptance
    statement includes '...triage is advisory (an agent can override)', and 04-06 (triage UI:
    override dropdowns, AI Activity viewer, Triage failed badge) is the plan that ships the
    override affordance. Mirrors the established 02-08/03-01/04-01/04-02/04-03/04-04 precedent
    for requirements split across multiple plans in a phase."
  - "Worker bundle re-verified as the plan's hard stop: the Dockerfile's exact esbuild command
    now bundles the worker with runTriage -> lib/llm -> the three provider SDKs (openai,
    @anthropic-ai/sdk, ollama) transitively included. Bundle succeeded with no --external
    changes needed (6.2MB dist/worker-verify.mjs vs. 03-04's 4.6MB baseline before lib/llm was
    in the graph — size growth is exactly the added SDK weight, no bundling errors)."

requirements-completed: []  # AIDA-14 declared in this plan's frontmatter is a phase-level
  # requirement. This plan (Wave 4) wires the full runtime path — enqueue after createTicket()
  # commits, worker registration + kill-switch handler, manual re-run — but the "agent can
  # override" half of AIDA-14's acceptance statement is 04-06's job (override Server Actions +
  # UI). Not marked complete until 04-06 lands (established split-requirement precedent).

# Metrics
duration: ~30min
completed: 2026-07-07
---

# Phase 4 Plan 5: Wire Auto-Triage Into the Runtime Summary

**Registered the on-demand `ai-triage` pg-boss queue (mirroring `email-outbound-send`'s exact retry shape) and wired it into all three ticket-creation paths via the single `createTicket()` entrypoint — gated post-commit on the `aiEnabled` kill switch, with the worker handler re-checking that same switch before ever calling the LLM, plus a manual `rerunTriage` Server Action.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-07T06:47:00Z (approx, STATE.md last-updated timestamp at session start)
- **Completed:** 2026-07-07T07:17:00Z (approx)
- **Tasks:** 2/2 completed
- **Files modified:** 4 modified, 1 created

## Accomplishments

- `src/lib/worker/jobs/ai-triage.ts` — `aiTriageHandler(data)`: relative-imports-only (worker-bundleable), loads the ticket cross-org via bare `prisma`, scopes via `scopedDb`, checks the `aiEnabled` Setting and no-ops if it isn't `"true"` (D-20 defense in depth — the queue-side check in `create-ticket.ts`/`rerunTriage` is the first layer, this is the second, closing the race where AI is toggled off between enqueue and job pickup), then dispatches to `runTriage(ticketId)` (04-03), which sets `FAILED` + rethrows on error so pg-boss retries.
- `src/lib/worker/index.ts` — registers `ai-triage` via `createQueue` (`retryLimit: 2, retryBackoff: true, retryDelayMax: 300`) + `work`, placed after `email-outbound-send`'s registration; no `schedule()` (on-demand only).
- `src/lib/queue/boss-client.ts` — `createBoss()` adds the matching `createQueue("ai-triage", ...)` with byte-identical options, so the app-side `getBoss().send("ai-triage", ...)` path works regardless of which process (app or worker) starts first.
- `src/lib/tickets/create-ticket.ts` — the `$transaction(...)` result is now captured into `const result` (previously returned directly) so a post-commit block can run: reads the `aiEnabled` Setting, and only when `"true"` sets `triageStatus: "PENDING"` + `boss.send("ai-triage", { ticketId: result.id })`. Because this is the single entrypoint, all three ticket-creation call sites (agent "New Ticket" dialog, email ingest, public web intake) inherit auto-triage with zero duplication. The transaction body itself is byte-for-byte unchanged — the pg-boss call lives strictly after commit.
- `src/app/(app)/tickets/[id]/actions.ts` — new `rerunTriage(ticketId)` Server Action mirrors `retryOutboundSend`'s shape exactly: `getScopedDb()` + `findFirst` existence check, sets `triageStatus: "PENDING"`, sends the `ai-triage` job, `revalidatePath`, returns `{ ok: boolean }` (never throws to the caller).
- **Worker bundle hard stop (plan-mandated):** re-ran the Dockerfile's exact esbuild command (`--bundle --platform=node --format=esm --target=node22 --tsconfig=tsconfig.json --external:pg --external:@prisma/client`) against `src/lib/worker/index.ts`. It now transitively bundles `runTriage -> lib/llm -> {openai, @anthropic-ai/sdk, ollama}` for the first time. Bundle succeeded with zero `--external` changes needed: `dist/worker-verify.mjs` is 6.2MB (up from 03-04's 4.6MB baseline, before `lib/llm` was in the worker's module graph — the size delta is exactly the three provider SDKs, no bundling errors).
- Full verification pass: `pnpm exec tsc --noEmit` clean, `pnpm run build` clean (one pre-existing out-of-scope Turbopack NFT-trace warning, unrelated to this plan — already documented in `deferred-items.md` since 02-11), `pnpm test` 54/54, `pnpm test:integration` 22/22 (8 files, via `volta`-pinned Node 22 — Testcontainers/Docker), `pnpm exec biome check` clean on all 5 touched files.

## Task Commits

Each task was committed atomically:

1. **Task 1: ai-triage queue — handler + worker registration + boss-client createQueue** - `5c2dc14` (feat)
2. **Task 2: Enqueue triage from createTicket (post-commit, kill-switch-gated) + rerunTriage action** - `d5d6ef0` (feat)

**Plan metadata:** (this commit) `docs(04-05): complete ai-triage runtime wiring plan`

## Files Created/Modified

- `src/lib/worker/jobs/ai-triage.ts` - `aiTriageHandler` (kill-switch check + `runTriage` dispatch)
- `src/lib/worker/index.ts` - registers `ai-triage` queue (createQueue + work, no schedule)
- `src/lib/queue/boss-client.ts` - `createBoss()` adds matching `ai-triage` createQueue
- `src/lib/tickets/create-ticket.ts` - post-commit enqueue gated on `aiEnabled`
- `src/app/(app)/tickets/[id]/actions.ts` - `rerunTriage` Server Action

## Decisions Made

See `key-decisions` in frontmatter. In summary: AIDA-14 stays unmarked pending 04-06's override UI (the requirement's acceptance text explicitly calls for agent-override, which this plan doesn't ship); the worker-bundle hard stop was re-verified and passed cleanly with no `--external` deviation needed for any of the three LLM provider SDKs.

## Deviations from Plan

None - plan executed exactly as written. The only structural change from the plan's literal snippet was capturing the transaction's return value into `const result` instead of `return`-ing the `$transaction(...)` call directly — required so the post-commit enqueue logic has a value to reference before the function returns; this is the same shape the plan's own snippet implied ("After `const result = await db.$transaction(...)`") and does not change the transaction's behavior.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full auto-triage runtime path is now live end-to-end: `createTicket()` (any of its 3 call sites) -> `ai-triage` job enqueued post-commit when AI is on -> worker's `aiTriageHandler` re-checks the kill switch -> `runTriage()` classifies and writes ticket fields + a redacted `AuditEvent` -> visible via `ticket.triageCategory`/`triageSentiment`/`triageLanguage`/`triageStatus` (currently only queryable, not yet rendered in the UI).
- `rerunTriage(ticketId)` is ready for 04-06's `TriageStatusChip` "Re-run" button to call directly.
- No blockers for 04-06 (triage UI surfacing: ticket-page chips, override dropdowns, AI Activity viewer, Triage-failed badge) — this plan's `files_modified` (`worker/jobs/ai-triage.ts`, `worker/index.ts`, `boss-client.ts`, `create-ticket.ts`, `tickets/[id]/actions.ts`) do not overlap 04-06's declared file set except `tickets/[id]/actions.ts`, where 04-06 only adds new `setTriage*` exports alongside this plan's `rerunTriage` — no conflict expected.
- Turning AI off (aiEnabled=false) leaves ticket creation completely unchanged — confirmed by code inspection: the post-commit `if (aiSetting?.value === "true")` block is skipped entirely, so `getBoss()`/`boss.send()` are never even called, and the returned `CreateTicketResult` is identical to pre-plan behavior. No new job is enqueued and the ticket still appears in the inbox (D-10).

---
*Phase: 04-ai-foundation*
*Completed: 2026-07-07*

## Self-Check: PASSED

- FOUND: src/lib/worker/jobs/ai-triage.ts
- FOUND: src/lib/worker/index.ts
- FOUND: src/lib/queue/boss-client.ts
- FOUND: src/lib/tickets/create-ticket.ts
- FOUND: src/app/(app)/tickets/[id]/actions.ts
- FOUND commit: 5c2dc14
- FOUND commit: d5d6ef0
