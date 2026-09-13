---
phase: 03-email-channel
plan: 05
subsystem: api
tags: [nodemailer, pg-boss, mailparser, mime, smtp, outbound-email]

# Dependency graph
requires:
  - phase: 03-email-channel
    provides: "03-01 Message.emailMessageId/emailInReplyTo/emailReferences/deliveryStatus schema + MessageDeliveryStatus enum; 03-02 getEmailSettings()/EmailSettings over the Setting table"
provides:
  - "createSmtpTransport (nodemailer, explicit 10s connection/greeting/socket timeouts)"
  - "buildOutboundMessageId / wrapEmailSafeHtml / composeMail (multipart/alternative MIME composer, bracket-consistent Message-IDs)"
  - "getBoss() — the codebase's first app-side pg-boss singleton, email-outbound-send queue (retryLimit 2 = ~3 attempts, exponential backoff capped at 5 min)"
  - "emailOutboundSendHandler — worker job that sends via SMTP and flips deliveryStatus SENT/FAILED"
  - "messages/route.ts enqueues email-outbound-send after commit when channel enabled + public reply + contact linked"
  - "DeliveryFailedChip + retryOutboundSend — thread-visible Retry affordance for FAILED sends"
affects: [03-04, 03-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App-side pg-boss singleton (src/lib/queue/boss-client.ts) — mirrors src/lib/db.ts's globalThis-caching, but caches a Promise<PgBoss> since start() is async. First-ever app-side (non-worker) pg-boss enqueue in this codebase."
    - "Bracket-consistent Message-ID generation (buildOutboundMessageId) so mailparser's inbound In-Reply-To/References string-match against stored emailMessageId without a format mismatch (RESEARCH.md Pitfall 1)."
    - "Narrow DB param types via Pick<ReturnType<typeof scopedDb>, ModelName> for cross-module helpers (settings.ts now follows the same SlaDb precedent from src/lib/tickets/sla.ts)."

key-files:
  created:
    - src/lib/channels/email/smtp-client.ts
    - src/lib/channels/email/compose-outbound.ts
    - src/lib/queue/boss-client.ts
    - src/lib/worker/jobs/email-outbound-send.ts
    - src/components/tickets/delivery-failed-chip.tsx
    - tests/unit/compose-outbound.test.ts
  modified:
    - src/app/api/tickets/[id]/messages/route.ts
    - src/app/(app)/tickets/[id]/actions.ts
    - src/app/(app)/tickets/[id]/page.tsx
    - src/components/tickets/thread-message.tsx
    - src/lib/channels/email/settings.ts

key-decisions:
  - "boss-client.ts's email-outbound-send queue uses retryLimit: 2, retryBackoff: true, retryDelayMax: 300 (1 initial + 2 retries = ~3 attempts, D-21)."
  - "worker/index.ts registration of emailOutboundSendHandler is deliberately owned by plan 04 — this plan only exports the handler, per the plan's objective note (the two plans must never both edit the worker entrypoint)."
  - "References/In-Reply-To derivation: query all prior email-bearing Messages on the ticket ordered by createdAt asc, EXCLUDING the message being sent (self-reference guard on retries — see deviations); references = all their emailMessageIds (capped to last 10 in composeMail); inReplyTo = the last one with direction INBOUND."
  - "deliveryStatus transition map: created QUEUED (messages route, gated on shouldQueue) -> SENT (handler success) | FAILED (handler catch, rethrown so pg-boss retries) -> QUEUED again (retryOutboundSend, re-enqueues)."

patterns-established:
  - "First app-side (Route Handler / Server Action) pg-boss .send() call in the codebase — src/lib/queue/boss-client.ts is the reusable entrypoint for any future on-demand job enqueue from the Next.js app."

requirements-completed: []  # AIDA-09 spans multiple Phase 3 plans (inbound half in 03-03/03-04); not marked complete until the full inbound+outbound flow lands (see STATE.md 03-01 note).

# Metrics
duration: 29min
completed: 2026-07-06
---

# Phase 3 Plan 05: Outbound SMTP Send + Delivery-Failed Retry Summary

**Agents' public replies are delivered via SMTP as multipart/alternative through a pg-boss job (the codebase's first app-side enqueue), with bracket-consistent Message-ID threading headers and a visible "Failed to send — Retry" thread affordance.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-07-06T10:14:49+07:00 (worktree fast-forwarded to master, see Issues Encountered)
- **Completed:** 2026-07-06T10:43:42+07:00
- **Tasks:** 3
- **Files modified:** 11 (6 created, 5 modified)

## Accomplishments
- `createSmtpTransport` (nodemailer, explicit 10s connection/greeting/socket timeouts) + `compose-outbound.ts` (`buildOutboundMessageId`, `wrapEmailSafeHtml`, `composeMail`) — TDD-verified Message-ID bracket round-trip through nodemailer's `MailComposer` → mailparser's `simpleParser`, and multipart/alternative (both text + html parts present).
- `src/lib/queue/boss-client.ts` — the app-side `PgBoss` singleton (globalThis-cached `Promise<PgBoss>`), creating the `email-outbound-send` queue with `retryLimit: 2` (~3 attempts).
- `emailOutboundSendHandler` — loads the message + ticket + contact + org, gates on OUTBOUND/PUBLIC/channel-enabled/contact-email, reuses or generates+persists a bracketed `emailMessageId`, derives `In-Reply-To`/`References` from prior email-bearing messages (excluding itself), sends via SMTP, and flips `deliveryStatus` to `SENT` or `FAILED` (rethrowing on failure so pg-boss retries).
- `messages/route.ts` now computes `shouldQueue` before the transaction, stamps `deliveryStatus: "QUEUED"` on the created outbound public message, and enqueues the send job AFTER the transaction commits — channel-off/internal-note replies are byte-for-byte unchanged (D-26).
- `DeliveryFailedChip` + `retryOutboundSend` Server Action — a FAILED public reply shows a destructive "Failed to send" badge + "Retry" link (reusing `SlaDueChip`'s exact class string); QUEUED/SENT render no chrome.

## Task Commits

Each task was committed atomically:

1. **Task 1: SMTP transport + MIME composer + app-side pg-boss singleton (TDD)** - `4e74652` (feat)
2. **Task 2: Outbound send handler + enqueue on public reply** - `caa0336` (feat)
3. **Task 3: "Failed to send — Retry" thread affordance + retry action** - `8926f47` (feat)

_Task 1 was declared `tdd="true"` in the plan; the test file was written and run green in the same commit (no plan-mandated RED-first commit split was required since compose-outbound.ts and its test were authored together and verified together before the first commit)._

## Files Created/Modified
- `src/lib/channels/email/smtp-client.ts` - `createSmtpTransport` factory with explicit timeouts
- `src/lib/channels/email/compose-outbound.ts` - `buildOutboundMessageId`, `wrapEmailSafeHtml`, `composeMail`
- `src/lib/queue/boss-client.ts` - app-side `getBoss()` singleton + `email-outbound-send` queue creation
- `tests/unit/compose-outbound.test.ts` - Message-ID round-trip + multipart/alternative assertions
- `src/lib/worker/jobs/email-outbound-send.ts` - `emailOutboundSendHandler`
- `src/app/api/tickets/[id]/messages/route.ts` - `shouldQueue` gate, `deliveryStatus: "QUEUED"`, post-commit enqueue
- `src/lib/channels/email/settings.ts` - `SettingDb` type fix (see Deviations)
- `src/components/tickets/delivery-failed-chip.tsx` - the Retry chip
- `src/components/tickets/thread-message.tsx` - optional `deliveryStatus` prop + conditional chip render
- `src/app/(app)/tickets/[id]/actions.ts` - `retryOutboundSend` Server Action
- `src/app/(app)/tickets/[id]/page.tsx` - passes `deliveryStatus` into the ThreadMessage mapping

## Decisions Made
- References/In-Reply-To query explicitly excludes the message being sent (`id: { not: message.id }`) — see Deviations, this is a correctness fix beyond the plan's literal text.
- `messages/route.ts`'s `$transaction` callback now returns the created message's id (previously returned nothing) so the post-commit enqueue can reference it without a second query.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree was stale — fast-forwarded to master before any code could be written**
- **Found during:** Task 0 (environment setup, before Task 1)
- **Issue:** This execution's git worktree was checked out at commit `c50c2b4` (Phase 2 completion), missing all of Phase 3's planning docs AND wave 1's code (03-01 schema/libraries, 03-02 crypto/email-settings) that this plan `depends_on`. `.planning/phases/03-email-channel/` didn't exist in the worktree at all.
- **Fix:** Verified `c50c2b4` was a clean ancestor of `master` (no divergent commits on the worktree branch), then `git merge --ff-only master` to bring the worktree to `486054d`. Re-ran `pnpm install` (picked up imapflow/mailparser/nodemailer/html-to-text/rehype-parse + their `@types` packages) and `pnpm prisma generate` (new Message fields + EmailIngestFailure model).
- **Files modified:** none (worktree/environment state only)
- **Verification:** `pnpm exec tsc --noEmit` clean and `pnpm test` (19/19 pre-existing) green immediately after the fast-forward, before any plan code was written.
- **Committed in:** n/a (no commit — the merge is a fast-forward with no new commit object; this repo's own history already contains all merged-in commits)

**2. [Rule 1 - Bug] Fixed `getEmailSettings`'s `SettingDb` type — didn't structurally accept a real scoped Prisma client**
- **Found during:** Task 2 (first real call site of `getEmailSettings`/`saveEmailSettings` against an actual `scopedDb()`/worker `scopedDb()` client — 03-02 shipped the function but nothing had called it yet)
- **Issue:** `settings.ts`'s ad hoc `SettingDb` type declared `findMany: (a: unknown) => Promise<...>`; the real generated Prisma client's `setting.findMany` requires a properly-typed args object, so TS rejected passing the real client where `SettingDb` was expected (`tsc --noEmit` failed in both `messages/route.ts` and `email-outbound-send.ts`).
- **Fix:** Replaced the ad hoc interface with `type SettingDb = Pick<ReturnType<typeof scopedDb>, "setting">;` — the exact pattern already established by `src/lib/tickets/sla.ts`'s `SlaDb`. Added a type-only relative import of `scopedDb` (erased at compile time, safe for the worker's esbuild bundle).
- **Files modified:** `src/lib/channels/email/settings.ts`
- **Verification:** `pnpm exec tsc --noEmit` clean; `pnpm test` still 23/23 green; `pnpm run build` succeeds.
- **Committed in:** `caa0336` (Task 2 commit)

**3. [Rule 1 - Bug] Excluded the message-being-sent from its own References/In-Reply-To derivation**
- **Found during:** Task 2 (writing the threading-header query)
- **Issue:** The plan's literal query (`db.message.findMany({ where: { ticketId, emailMessageId: { not: null } }, ... })`) doesn't exclude the message currently being sent. On a retry, that message already carries its own `emailMessageId` (persisted on the first failed attempt), so it would appear in its own `references` chain — a self-referential `References` header, which is invalid per RFC 2822/5322 threading conventions.
- **Fix:** Added `id: { not: message.id }` to the query's `where` clause.
- **Files modified:** `src/lib/worker/jobs/email-outbound-send.ts`
- **Verification:** Code review + `pnpm exec tsc --noEmit` clean (logic-only fix, not independently unit-tested — no live SMTP/DB integration test exists yet for this handler; flagged for Phase 3's eventual integration-test pass if one is added).
- **Committed in:** `caa0336` (Task 2 commit)

---

**Total deviations:** 3 (1 blocking environment fix, 2 auto-fixed bugs)
**Impact on plan:** The worktree fix was required just to have the dependency code (03-01/03-02) available at all — no scope creep, purely restorative. Both code fixes are narrowly-scoped correctness fixes (a type that didn't match its only real caller; a self-reference bug in a header derivation) with no architectural change and no deviation from the plan's intended behavior.

## Issues Encountered
- The assigned git worktree was stale (see Deviation 1) — resolved via a clean fast-forward merge since the worktree branch had zero divergent commits from `master`.
- `nodemailer`'s `MailComposer` class is not re-exported from the package root (only from the `@types/nodemailer` subpath declarations) — the test imports it directly from `nodemailer/lib/mail-composer/index.js`, matching the package's own documented internal usage pattern and its `@types` layout.

## User Setup Required

None - no external service configuration required. (SMTP host/port/credentials are configured by the operator in the future Settings "Email" tab, plan 06 — this plan only builds the send pipeline that consumes those settings.)

## Next Phase Readiness
- `emailOutboundSendHandler` is fully implemented and exported but **NOT YET registered** in `src/lib/worker/index.ts` — that registration is plan 04's job (owns the worker entrypoint) per this plan's objective note. Until plan 04 lands, queued `email-outbound-send` jobs will sit unprocessed in pg-boss (no worker handler subscribed) — expected and by design for this wave.
- `getBoss()` (`src/lib/queue/boss-client.ts`) is now available for any future on-demand job enqueue from the Next.js app.
- Plan 06 (Settings Email tab) can now surface `deliveryStatus`/health alongside the SMTP config UI; no blockers.
- No integration test exists yet for `emailOutboundSendHandler` against a real/fake SMTP server (GreenMail, per 03-RESEARCH.md) — flagged as a candidate for a later verification pass, not blocking this plan's completion.

---
*Phase: 03-email-channel*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 6 created files found on disk; all 3 task commits (`4e74652`, `caa0336`, `8926f47`) found in git history.
