---
phase: 02-core-ticketing
plan: 09
subsystem: ui
tags: [nextjs, prisma, server-actions, route-handlers, file-upload, markdown, sla]

# Dependency graph
requires:
  - phase: 02-core-ticketing (02-02)
    provides: renderMarkdown() sanitized Markdown->HTML pipeline
  - phase: 02-core-ticketing (02-03)
    provides: createTicket(), getSlaTargets()/computeDueTimestamps()
  - phase: 02-core-ticketing (02-04)
    provides: localFileStorage/buildStorageKey, MAX_BYTES/ALLOWED_MIME
  - phase: 02-core-ticketing (02-06)
    provides: StatusChip/PriorityChip/SlaDueChip/TagChip/AttachmentChip/AssigneeAvatar
  - phase: 02-core-ticketing (02-07)
    provides: CustomFieldInput
  - phase: 02-core-ticketing (02-08)
    provides: TicketListPanel (basePath prop), FilterChipRow, 2-pane tickets layout
provides:
  - Ticket reading pane (/tickets/[id]) with editable status/priority/assignee/tags/custom-fields
  - Chronological thread (ThreadMessage inbound/public/internal variants + ThreadSystemEvent reopen row)
  - Composer with Public Reply / Internal Note toggle + attachments
  - POST /api/tickets/[id]/messages (multipart Route Handler)
  - GET /api/attachments/[id] (authenticated, workspace-scoped download)
  - Ticket mutation Server Actions (changeStatus, changePriority, assignTicket, addTag, removeTag, setCustomFieldValue)
  - Agent "New Ticket" flow (dialog + Server Action), wired into the list-panel header
affects: [02-12-public-status-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server Actions colocated in a dynamic-segment route folder ([id]/actions.ts) imported directly into a sibling Client Component (ticket-meta-header.tsx) — parentheses/brackets in the path are literal for module resolution, not route-glob syntax."
    - "File-bearing mutations are nodejs Route Handlers (multipart formData + file-type byte-sniff), never Server Actions (1MB cap) — mirrors 02-11's public intake route shape."
    - "SLA flag clearing (isAtRisk/isBreached) is always done in the SAME write as the state transition that makes the old flag stale (resolve, first public reply, priority change) — the worker job is one-directional and never clears."

key-files:
  created:
    - src/app/(app)/tickets/[id]/page.tsx
    - src/app/(app)/tickets/[id]/actions.ts
    - src/components/tickets/ticket-meta-header.tsx
    - src/components/tickets/thread-message.tsx
    - src/components/tickets/thread-system-event.tsx
    - src/components/tickets/composer.tsx
    - src/components/tickets/composer-toggle.tsx
    - src/app/api/tickets/[id]/messages/route.ts
    - src/app/api/attachments/[id]/route.ts
    - src/app/(app)/tickets/new-ticket-dialog.tsx
    - src/app/(app)/tickets/new-ticket-action.ts
  modified:
    - src/app/(app)/tickets/filter-chip-row.tsx

key-decisions:
  - "New Ticket CTA placed in FilterChipRow's existing h-14 sticky top row (the list panel's header), next to the search input — not a new header bar, to preserve the design system's h-14 vertical-rhythm alignment between the list and reading-pane columns."
  - "Tag add/remove and custom-field value edits are optimistic-free: each mutation is a Server Action call inside startTransition with a toast on failure; Next.js's built-in Server-Action re-render handles the UI refresh, no manual router.refresh() needed for those."
  - "Composer explicitly calls router.refresh() after a successful post since it's a plain fetch() to a Route Handler, not a Server Action — Next.js has no automatic re-render hook for that path."

patterns-established:
  - "ThreadSystemEvent is a generic, reusable inline system-event row (text-only, no avatar/border) — plan 12's public status page reuses it verbatim for the same auto-reopen copy."
  - "getActiveDue() (which SLA timer is still live) is duplicated between ticket-list-row.tsx and ticket-meta-header.tsx — small, presentational, file-local; not worth extracting for two call sites."

requirements-completed: [AIDA-01, AIDA-04, AIDA-05, AIDA-06, AIDA-07]

# Metrics
duration: ~50min
completed: 2026-07-02
---

# Phase 2 Plan 09: Ticket Reading Pane, Composer, and Agent Mutations Summary

**Full agent ticket workflow: editable status/priority/assignee/tags/custom-fields, a chronological thread with amber-locked internal notes and an auto-reopen system-event row, a multipart composer with authenticated attachment serving, and SLA flag clearing on first response, resolve, and priority downgrade.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-07-02
- **Tasks:** 3/3 completed
- **Files modified:** 12 (11 created, 1 modified)

## Accomplishments

- `/tickets/[id]` reading pane: reuses `TicketListPanel` (via `basePath`) so the list stays visible while a ticket is open; renders the full thread with `ThreadMessage` inbound/public/internal variants and inline `ThreadSystemEvent` reopen rows wired to `Message.triggeredReopen`.
- `TicketMetaHeader`: Status/Priority/Assignee `DropdownMenu`s (calling Server Actions), `SlaDueChip`, tag editor (`Popover`+`Command`, find-or-create), and inline `CustomFieldInput` values — finishes AIDA-05's ticket-level editor (02-08 only shipped the filter half).
- `Composer` + `ComposerToggle`: bespoke Public Reply / Internal Note segmented control (internal mode never uses primary/indigo), attachment picker with client-side pre-check, posts multipart to the messages Route Handler.
- `POST /api/tickets/[id]/messages`: nodejs Route Handler — formData, per-file `file-type` byte-sniff against `ALLOWED_MIME`, `localFileStorage.save`, `renderMarkdown(body)` → `bodyHtml`; clears `isAtRisk`/`isBreached` and stamps `firstRespondedAt` in the same write on the first public reply.
- `GET /api/attachments/[id]`: workspace-scoped download via `getScopedDb()`, `Content-Disposition: attachment`.
- Ticket mutation Server Actions: `changeStatus` (clears SLA flags + stamps/clears `resolvedAt` on resolve/reopen), `changePriority` (recomputes due timestamps from `createdAt` AND clears stale `isAtRisk`/`isBreached` — Pitfall 5), `assignTicket`, `addTag`/`removeTag` (nested `TicketTag` write), `setCustomFieldValue` (typed-column upsert via findFirst+create/update).
- Agent "New Ticket" flow: `NewTicketDialog` + `createTicketAction` (delegates to the single `createTicket()` entrypoint), wired into the list-panel header so a zero-ticket workspace has a reachable creation path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Reading pane page + meta header + ThreadMessage variants + wired ThreadSystemEvent reopen row** - `2d65bbc` (feat)
2. **Task 2: Composer + message Route Handler (multipart, attachments) + authenticated serve route** - `3285fd9` (feat)
3. **Task 3: Ticket mutation Server Actions + New Ticket flow** - `fd28995` (feat)

## Files Created/Modified

- `src/app/(app)/tickets/[id]/page.tsx` - Reading-pane Server Component; fetches ticket+messages+tags+customFieldValues, renders `TicketListPanel` + `TicketMetaHeader` + thread + `Composer`
- `src/app/(app)/tickets/[id]/actions.ts` - `changeStatus`, `changePriority`, `assignTicket`, `addTag`, `removeTag`, `setCustomFieldValue`
- `src/components/tickets/ticket-meta-header.tsx` - Status/Priority/Assignee dropdowns, SlaDueChip, tag editor, inline custom-field values
- `src/components/tickets/thread-message.tsx` - Inbound/public-reply/internal-note variants; only `bodyHtml` ever reaches `dangerouslySetInnerHTML`
- `src/components/tickets/thread-system-event.tsx` - Reusable inline system-event row (auto-reopen copy)
- `src/components/tickets/composer.tsx` - Reply/note textarea + attachment picker + Send Reply / Save Internal Note
- `src/components/tickets/composer-toggle.tsx` - Public Reply / Internal Note segmented control
- `src/app/api/tickets/[id]/messages/route.ts` - Multipart Route Handler: file validation, storage, Markdown render, SLA flag clearing
- `src/app/api/attachments/[id]/route.ts` - Authenticated, workspace-scoped attachment download
- `src/app/(app)/tickets/new-ticket-dialog.tsx` - New Ticket Dialog form (subject/contact/priority/message)
- `src/app/(app)/tickets/new-ticket-action.ts` - `createTicketAction` Server Action wrapping `createTicket()`
- `src/app/(app)/tickets/filter-chip-row.tsx` - Wired `NewTicketDialog` into the list-panel header row (deviation, see below)

## Decisions Made

- Placed the "New Ticket" CTA inside `FilterChipRow`'s existing sticky `h-14` top row (next to the search input) rather than adding a new header bar, to preserve the two-column `h-14` vertical-rhythm alignment mandated by the design system.
- `db.attachment.findFirst`/`db.customFieldValue.findFirst` + conditional create/update (not `upsert`) reused verbatim from the established scopedDb compound-unique-key idiom (STATE.md pitfall) for `setCustomFieldValue`.
- Composer calls `router.refresh()` explicitly after a successful `fetch()` POST (Route Handler, not a Server Action) since Next.js's automatic re-render-on-Server-Action-call behavior doesn't apply to plain `fetch()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wired the "New Ticket" CTA into `filter-chip-row.tsx`**
- **Found during:** Task 3 (New Ticket flow)
- **Issue:** The plan's `files_modified` frontmatter did not list `filter-chip-row.tsx`, but STATE.md's Open Todos explicitly flagged this as required ("plan 09 must still add this CTA... the reading-pane-only option would break cold start") and the orchestrator's execution note made the list-panel-header placement binding.
- **Fix:** Added `<NewTicketDialog />` to `FilterChipRow`'s existing `h-14` header row, next to the search input.
- **Files modified:** `src/app/(app)/tickets/filter-chip-row.tsx`
- **Verification:** `pnpm exec tsc --noEmit` and `pnpm run build` both clean; button renders as the required list-panel-header secondary CTA (Copywriting Contract: "New Ticket").
- **Committed in:** `fd28995` (Task 3 commit)

**2. [Rule 2 - Missing Critical] Server-side guard against an empty message with no attachments**
- **Found during:** Task 2 (messages Route Handler)
- **Issue:** The plan didn't explicitly specify a server-side check for an empty post; the client already guards this, but a Route Handler must not trust client-side validation alone.
- **Fix:** `messages/route.ts` returns 400 `empty_message` when both `body` is blank and no files are attached.
- **Files modified:** `src/app/api/tickets/[id]/messages/route.ts`
- **Verification:** `pnpm exec tsc --noEmit` clean; logic reviewed inline.
- **Committed in:** `3285fd9` (Task 2 commit)

**3. [Rule 1 - Bug] `Buffer` is not directly assignable to the Web `Response` body type**
- **Found during:** Task 2 (attachments serve route)
- **Issue:** `new Response(buffer, ...)` failed `tsc --noEmit` (`Buffer<ArrayBufferLike>` not assignable to `BodyInit`) because the DOM `Response` type doesn't structurally accept Node's `Buffer` generic.
- **Fix:** Wrapped as `new Response(new Uint8Array(buffer), ...)`.
- **Files modified:** `src/app/api/attachments/[id]/route.ts`
- **Verification:** `pnpm exec tsc --noEmit` exits 0.
- **Committed in:** `3285fd9` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 missing-critical, 1 bug)
**Impact on plan:** All three necessary for correctness/completeness (cold-start ticket creation path, server-side input validation, and a type-correctness fix required for the build to pass). No scope creep beyond what STATE.md and the plan itself already flagged as required.

## Issues Encountered

- The worktree was 3 commits behind the repo's local `master` (still on Phase 1's checkpoint commit) at the start of execution — fast-forwarded (`git merge --ff-only master`), then ran `cp .env.example .env`, `pnpm install`, and `pnpm prisma generate` per the bootstrap idiom documented in STATE.md before any plan work began.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Core ticketing agent workflow (AIDA-01, AIDA-04, AIDA-05, AIDA-06, AIDA-07) is now fully wired end-to-end: create → assign → lifecycle → public reply/internal note → attachments → SLA flag clearing.
- Plan 12 (public status page) can reuse `ThreadMessage` (filtered to `visibility: PUBLIC` only, server-side) and `ThreadSystemEvent` unchanged, plus its own upload/serve Route Handlers on the same `localFileStorage`/`file-type` primitives (auth/scoping differ from this plan's agent-side routes, per STATE.md).
- No blockers.

## Self-Check: PASSED

All 11 created files verified present on disk; all 3 task commits (`2d65bbc`, `3285fd9`, `fd28995`) verified present in git history.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-02*
