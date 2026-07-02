---
phase: 02-core-ticketing
plan: 12
subsystem: api
tags: [nextjs, prisma, public-channel, attachments, rate-limiting, auto-reopen]

# Dependency graph
requires:
  - phase: 02-core-ticketing (02-02)
    provides: renderMarkdown() sanitized Markdown->HTML pipeline
  - phase: 02-core-ticketing (02-04)
    provides: FileStorage/localFileStorage, buildStorageKey, MAX_BYTES/ALLOWED_MIME
  - phase: 02-core-ticketing (02-05)
    provides: checkRateLimit(scope, ip) per-IP rate limiter
  - phase: 02-core-ticketing (02-06)
    provides: StatusChip component
  - phase: 02-core-ticketing (02-09)
    provides: ThreadMessage / ThreadSystemEvent components, Message.triggeredReopen schema field, agent-thread reopen-row rendering pattern
  - phase: 02-core-ticketing (02-11)
    provides: PublicPageShell, HoneypotField, (public) route group + middleware exemptions, public-intake route pattern (honeypot/rate-limit/attachment validation)
provides:
  - Tokenized, unauthenticated public status page (/status/[token]) showing ticket status + PUBLIC-only conversation thread
  - Follow-up composer (honeypot + rate-limited) that appends an inbound PUBLIC message and auto-reopens RESOLVED/CLOSED tickets (D-04)
  - Message.triggeredReopen writer (this plan is the only writer for the public-follow-up path) driving the ThreadSystemEvent reopen row on both this page and the agent thread (02-09)
  - Token-scoped public attachment serving route, structurally incapable of reaching internal-note attachments
  - ThreadMessage `attachmentHrefBase` prop (backward-compatible) so the same component serves both the authenticated and public attachment routes
affects: [phase-03-email-intake (status link is the v1 stand-in for email; auto-reopen logic here should be mirrored for inbound email replies)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unauthenticated bearer-token routes use bare `prisma` and look up by a @unique token column, never scopedDb (no session/org context exists)"
    - "Public attachment serving is authorized via a Prisma join (attachment.message.{ticketId, visibility: PUBLIC}), not by trusting the requested id alone"
    - "Auto-reopen + reopen-marker are written in the SAME transaction/branch as the reopening message create (mirrors the 02-09 SLA-flag same-write pattern)"
    - "Shared thread-rendering components (ThreadMessage) take an optional href-base prop so authenticated and public callers can point attachment links at different serving routes without forking the component"

key-files:
  created:
    - src/app/(public)/status/[token]/page.tsx
    - src/app/(public)/status/[token]/follow-up-form.tsx
    - src/app/api/public/status/[token]/follow-up/route.ts
    - src/app/api/public/status/[token]/attachments/[id]/route.ts
  modified:
    - src/components/tickets/thread-message.tsx

key-decisions:
  - "Extended ThreadMessage with an optional `attachmentHrefBase` prop (default '/api/attachments', matching prior hardcoded behavior) rather than forking a public-only copy of the component — keeps the agent thread (02-09) untouched while letting the public status page route attachment links to the token-scoped serving route (D-21/D-22 requirement, not achievable with the component as shipped)."

patterns-established:
  - "Reduced public composer (no mode toggle) built as a plain <form> (not react-hook-form) so the honeypot input is captured natively via FormData(event.currentTarget), same trust model as the intake form."

requirements-completed: [AIDA-08, AIDA-04]

# Metrics
duration: 24min
completed: 2026-07-02
---

# Phase 2 Plan 12: Public Status Page + Follow-up + Auto-Reopen Summary

**Tokenized `/status/[token]` public page renders a PUBLIC-only ticket thread (server-side `visibility: PUBLIC` filter) with a follow-up composer that auto-reopens resolved/closed tickets and serves attachments through a dedicated internal-note-blind route.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-02T03:00:00Z
- **Completed:** 2026-07-02T03:24:17Z
- **Tasks:** 2 completed
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- Unauthenticated visitors with a valid status token see ticket status + the public conversation thread only — internal notes are structurally excluded at the query level (`where: { visibility: "PUBLIC" }`), never filtered client-side
- A follow-up reply appends as an inbound PUBLIC message and auto-reopens a RESOLVED/CLOSED ticket in the same transaction, marking the reopening message `triggeredReopen: true` so both this public page and the agent thread (02-09) render the "Ticket reopened…" system-event row at the correct position
- Public attachment downloads are served through a token-scoped route (`/api/public/status/[token]/attachments/[id]`) that joins on `{ ticketId, visibility: PUBLIC }`, structurally incapable of ever serving an internal-note attachment
- Follow-up composer is honeypot + rate-limited (`checkRateLimit("status-follow-up", ip)`), mirroring the public intake form's spam protection (D-20)

## Task Commits

1. **Task 1: Public status page (with auto-reopen row) + follow-up form** - `f512115` (feat)
2. **Task 2: Follow-up route (auto-reopen + triggeredReopen marker) + token-scoped public attachment serve** - `8cb2d71` (feat)

## Files Created/Modified
- `src/app/(public)/status/[token]/page.tsx` - Server Component: bare-prisma lookup by `statusToken`, PUBLIC-only message fetch, invalid-token dead-end state, renders thread + reopen system-event rows + FollowUpForm
- `src/app/(public)/status/[token]/follow-up-form.tsx` - Client reduced composer (no mode toggle): Textarea + client-side attachment pre-check + HoneypotField + "Send Follow-up", posts multipart to the follow-up route, `router.refresh()` on success, 429 banner on rate limit
- `src/app/api/public/status/[token]/follow-up/route.ts` - POST: honeypot silent-success, `checkRateLimit("status-follow-up")`, zod-validated message, attachment validation (size/MIME via `file-type` sniffing), transaction creating an INBOUND/PUBLIC message (+ attachments) with `triggeredReopen` and ticket `status: OPEN, resolvedAt: null` gated on the same `shouldReopen` condition
- `src/app/api/public/status/[token]/attachments/[id]/route.ts` - GET: token lookup, then `attachment.findFirst({ where: { id, message: { ticketId, visibility: PUBLIC } } })` join, streams the file with `Content-Type`/`Content-Disposition`/`Cache-Control: private, no-store`
- `src/components/tickets/thread-message.tsx` - Added optional `attachmentHrefBase` prop (default `/api/attachments`, backward-compatible) so the public page can point attachment links at its own token-scoped route

## Decisions Made
- `ThreadMessage`'s attachment link was hardcoded to the authenticated `/api/attachments/[id]` route in 02-09. The plan explicitly required public attachment links to point at the new token-scoped route and explicitly forbade reusing the authenticated route "as-is" for this purpose. Rather than duplicating the component, added a backward-compatible `attachmentHrefBase` prop defaulting to the original hardcoded path — the 02-09 agent thread usage is unaffected (no prop passed), and this page passes `/api/public/status/${token}/attachments`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended ThreadMessage with attachmentHrefBase prop**
- **Found during:** Task 1 (Public status page)
- **Issue:** The plan's must_haves require "Public attachments must be served through a dedicated token-scoped route that can never reach internal-note attachments (never reuse the authenticated /api/attachments/[id] route from 02-09 as-is for this purpose)" and Task 1's action text explicitly says attachment links must point to `/api/public/status/${token}/attachments/${att.id}`. The reused `ThreadMessage` component (02-09) hardcoded the href to `/api/attachments/${attachment.id}`, which would have silently pointed public attachment links at the authenticated route — blocking completion of the task as specified and violating the internal-note-blind requirement.
- **Fix:** Added an optional `attachmentHrefBase` prop to `ThreadMessage` (default `/api/attachments`, preserving the exact prior behavior for the 02-09 agent thread with no call-site changes there); the public status page passes `attachmentHrefBase={\`/api/public/status/${token}/attachments\`}`.
- **Files modified:** src/components/tickets/thread-message.tsx, src/app/(public)/status/[token]/page.tsx
- **Verification:** `pnpm exec tsc --noEmit` clean; `pnpm run build` succeeds; agent ticket-detail page (02-09) usage unchanged (no prop passed, defaults preserved).
- **Committed in:** f512115 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the plan's explicit internal-note-blind attachment routing requirement without duplicating a shared component. No scope creep — change is additive and backward-compatible.

## Issues Encountered
- Worktree was 73 commits behind `master` (Phase 2 Waves 1-4, plans 02-01 through 02-11, had already merged). Fast-forwarded via `git merge --ff-only master` (clean ancestor fast-forward, no divergent commits), then re-ran `pnpm install` and `pnpm prisma generate` (with an explicit `DATABASE_URL` env var, since no local `.env` exists in this worktree and `prisma.config.ts` requires it even for `generate`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 (Core Ticketing) is now feature-complete: all 12 plans across 5 waves executed. The tokenized status page is the v1 stand-in for email (AIDA-08) and the D-04 auto-reopen / D-21 internal-note exclusion behaviors are implemented on both the agent thread (02-09) and this public thread.
- Phase 3 (email intake) should mirror the auto-reopen logic in this plan's follow-up route when handling inbound email replies to RESOLVED/CLOSED tickets.
- No blockers identified for Phase 2 completion; recommend running the Phase 2 design checklist (DESIGN-SYSTEM.md §9) and full verification pass before advancing to Phase 3.

## Self-Check: PASSED

All created files verified present on disk; both task commits (`f512115`, `8cb2d71`) verified present in git history.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*
