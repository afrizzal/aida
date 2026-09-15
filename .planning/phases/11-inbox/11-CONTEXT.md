# Phase 11: Inbox - Context

**Gathered:** 2026-11-08, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for UI design contract, then planning
**Sources:** facts checked against the code at `924dbe6`; Codex brainstorm in `run-loop/codex/fase11-tanya.md` and `fase11-jawab.md`. Every Codex claim used below was re-checked in the code unless marked *unverified*.

<domain>
## Phase Boundary

An agent can work the inbox fast: saved views, bulk actions, a command palette, a keyboard-driven inbox and ticket page, and automatic closing of resolved tickets after a quiet period. Requirements AIDA-47 to AIDA-51 in `.planning/REQUIREMENTS.md`. No feature beyond those requirements. AI stays out of this phase: nothing here calls `lib/llm/`.

Phases 8, 9 and 10 are **parked** (`08-REVIEWS.md`, `09-REVIEWS.md`, `10-REVIEWS.md` → Outcome). Their code does not exist: there is no CSP, no membership helper, no notification model, and `getScopedDb` (`src/lib/session.ts:38-43`) does not check membership. Phase 11 must not assume any of them, adds no inline script, and sends no notifications.

Later phases build on this one (ROADMAP → Cross-phase risks): AIDA-56 (Phase 12) turns the status enum into a table and must migrate saved-view filters; AIDA-54 and AIDA-56 (Phase 12) add snooze and state groups that auto-close must respect; AIDA-86 (Phase 16) reuses the palette registry; AIDA-80 (Phase 15) may reuse the saved-view model.

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex agreed" means the Codex brainstorm recommended the same thing.

### Inherited gaps and membership

- **D-01:** Phase 11 does not change `getScopedDb` for the whole app. That is parked Phase 10's D-08 work, which needs a page helper that redirects instead of throwing (Phase 10 review C6); a partial version here would recreate that defect. Instead, every **new** Phase 11 server path checks the actor's active membership by reading the `member` row: the ticket mutation service (D-07, inside its transaction), the saved-view actions, the palette search endpoint and the auto-close settings action. The check lives in a small helper `findActiveMembership(client, userId, orgId)` in `src/lib/membership.ts` (relative imports, no Next.js imports), with the same name and signature Phase 10 planned, so Phase 10 extends it when it returns. A test proves each new path refuses a session whose member row was deleted. The SUMMARY records that older pages and actions still lack the check and that AIDA-43 stays open. Source: Codex recommended checking every new path and suggested a central fix if all callers are compatible; Claude chose local checks because they are not compatible today (Phase 10 C6).
- **D-02:** The existing single-ticket actions in `src/app/(app)/tickets/[id]/actions.ts` (`assignTicket`, `changeStatus`, `changePriority`, `addTag`, `removeTag`) become thin wrappers around the shared service (D-07). `assignTicket` thereby gains the assignee membership check it lacks today (verified line 198). Source: Codex.

### Saved views (AIDA-47)

- **D-03:** Model `SavedView`: `id`, `organizationId`, `ownerUserId`, `name` (trimmed, 1 to 80 characters), `visibility` (`PRIVATE` or `SHARED`), `filters` (JSON with `version: 1`), `position` (integer), `createdAt`, `updatedAt`. One zod schema for the inbox filters (`src/lib/tickets/list-filters.ts`) is used by both the URL parser and the saved views: `view` (`unassigned`, `mine` or `all`), `statuses` (a unique subset of `TicketStatus`), `tagId`, `cf` (`definitionId`, `value` of at most 200 characters) and `q` (at most 200 characters). `limit` is page size and is never stored; the URL parser gains a safe upper bound for `limit` without breaking "Load more" (today any number is accepted, verified `list-query.ts:58`). `mine` always means the viewer. Source: Codex; verified that `parseTicketListFilters` uses no zod.
- **D-04:** Permissions, enforced on the server: any active member may create a private or a shared view. A private view is read, edited and deleted only by its owner. A shared view is read by every member; it is edited or deleted by its owner or by an `admin` or `owner`. Names are unique per owner among private views and per organization among shared views (partial unique indexes written in the migration). Order is `position`, then name, then id; a new view gets the next position, and there is no drag reordering in this phase. Source: Codex.
- **D-05:** A view whose `tagId` or `cf.definitionId` no longer exists in the organization still appears in the sidebar. Opening it shows a notice naming what is missing and does not silently drop that filter; the user can edit and save it. References are validated on save and on open. The save dialog for a shared view with search text says that the text is visible to the whole workspace. Source: Codex.
- **D-06:** The sidebar gets a "Views" section built with `sidebar-*` tokens (AIDA-47, `.planning/DESIGN-SYSTEM.md`). Source: AIDA-47.

### Ticket audit and mutation service (AIDA-48)

- **D-07:** A new append-only, org-scoped model `TicketAuditEvent`: `id`, `organizationId`, `ticketId`, `actorType` (`USER` or `SYSTEM`), `actorUserId` (null for `SYSTEM`), `action` (`ASSIGNEE_CHANGED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `TAG_ADDED`, `TAG_REMOVED`, `AUTO_CLOSED`), `before` and `after` (ids and enum values only, never ticket text), `batchId` (null for a single action), `createdAt`. A database trigger rejects `UPDATE` and `DELETE`, the same pattern as `aida_audit_event_immutable`. `AuditEvent` stays AI-only: its AI columns are never filled with placeholders. AIDA has no organization deletion today; the append-only trigger has the same consequence as on `AuditEvent`, and this is recorded, not solved here. Source: Codex option (b); verified `AuditEvent` requires `provider`, `model`, `input` and `output` (`prisma/schema.prisma:446-461`).
- **D-08:** One service, `src/lib/tickets/mutations.ts` (relative imports), offers assign, set status, set priority, add tag and remove tag. Each operation takes a transaction client, the organization id and the actor, applies the same side effects as today (status: `resolvedAt` and SLA-flag reset for terminal statuses; priority: SLA due dates recomputed from `createdAt` and flags reset), and writes one `TicketAuditEvent` per ticket. A single action calls it with one id. A bulk action calls it with at most 100 unique ids in one transaction: validate the whole payload first (every id belongs to the organization; the assignee is an active member or null; the tag belongs to the organization), lock the tickets in id order with `SELECT … FOR UPDATE`, apply, and audit. Any failure rolls back the whole batch. A no-op item (tag already present, same status) still gets one audit row with `before` equal to `after`, so "one audit entry per ticket" holds without exceptions. `revalidatePath` runs only after commit. Source: Codex; verified that the current actions each call `getScopedDb` and `revalidatePath` themselves.
- **D-09:** Rollback proof with Testcontainers: a test seam passed as an argument forces a failure after at least one ticket and its audit row were written inside the transaction; the test then asserts that no ticket, tag link or audit row changed. Also tested: a batch with a ticket of another organization is refused whole; duplicate ids are deduplicated; 101 ids are refused. Source: Codex, AIDA-48.
- **D-10:** Selection covers only the tickets the agent explicitly selected on screen, never "everything matching the filter". Selection clears when the filters or the view change. The bulk bar offers assign (a member or unassign), status, priority, add tag and remove tag. Source: AIDA-48, Codex.

### Command palette (AIDA-49)

- **D-11:** A client registry (`src/lib/commands/`): each command has a stable `id`, a label, a group (navigation, tickets, create, views, help), keywords, a `when(context)` predicate and a `run` function. Modules register commands on mount and remove them on unmount; a duplicate id is rejected. Context comes from the route and page state, never from inspecting the DOM. Phase 16 registers its commands in the same registry. `⌘K` and `Ctrl+K` open the palette, also from inside an input, but not while another modal dialog is open. Source: SEED-006, Codex.
- **D-12:** Command groups: navigation (only routes that exist), ticket search, create ticket (opens the existing new-ticket dialog) and views (the viewer's private views and the organization's shared views). Ticket search calls a server endpoint that checks membership (D-01) and runs the existing `searchTickets` (`src/lib/tickets/search.ts`) with a server-side limit; the client debounces and ignores stale responses. No other user's private view and no ticket list beyond the search results reach the client. Source: Codex.

### Keyboard (AIDA-50)

- **D-13:** One global dispatcher with a key map: chords starting with `g` for navigation, `j` and `k` to move through the loaded ticket list, `Enter` to open, `x` to toggle selection, on the ticket page single keys for assign, status, tag, reply and internal note, `?` for the help modal and `Escape` to close. A chord expires after 1 second and is cancelled on blur, navigation, `Escape` or another key. The dispatcher ignores events with modifiers (except `⌘K` and `Ctrl+K`), events already handled (`defaultPrevented`), key repeat, IME composition (`isComposing`), and targets inside `input`, `textarea`, `select`, `contenteditable`, or an open dialog, popover or menu. Existing local handlers (`filter-chip-row.tsx`, `tag-manager.tsx`, `ticket-meta-header.tsx`) keep working. No browser-reserved keys. `docs/KEYBOARD.md` lists the keys, and the help modal reads the same table. Exact letters are Claude's discretion. Source: SEED-006, Codex.
- **D-14:** How single-letter keys behave with screen readers is a manual human check, never claimed as passed. Source: Codex.

### Auto-close (AIDA-51)

- **D-15:** Two organization settings in `Setting`: `autoCloseResolvedAfterDays` (integer 0 to 365, default 0 = off) and `autoCloseEnabledAt` (set when the value changes from 0 to a positive number, cleared when it returns to 0). Admins and owners edit it on the SLA settings page, which explains that tickets resolved before enabling start their quiet period at the moment of enabling, so old tickets do not close all at once. Source: AIDA-51, Codex.
- **D-16:** The quiet period starts at the latest of `resolvedAt`, `autoCloseEnabledAt` and the newest `PUBLIC` message on the ticket; internal notes do not restart it. A real customer reply already reopens the ticket, so the remaining public messages are agent replies and automatic mail. A `RESOLVED` ticket without `resolvedAt` is skipped and counted in the job log. Closing sets `CLOSED` and leaves `resolvedAt` unchanged. Source: Codex; the public-message rule is Claude's.
- **D-17:** Race safety comes from conditional updates, not from a separate lock protocol. The job closes each candidate in a transaction with one conditional `UPDATE` that re-checks `RESOLVED` and the quiet condition in SQL and returns the row; the `AUTO_CLOSED` audit row (`actorType` `SYSTEM`) is written in the same transaction only when a row changed. Both customer-reply paths (`src/lib/channels/email/ingest-message.ts` and `src/app/api/public/status/[token]/follow-up/route.ts`) move the reopen decision into their transaction as a conditional update (`RESOLVED` or `CLOSED` → `OPEN`, `resolvedAt` null) whose row count sets `triggeredReopen`; automatic mail still never reopens. Testcontainers tests force each order with two connections, one holding the ticket row lock while the other runs: reply then close (the ticket ends `OPEN`), close then reply (`OPEN`, with `triggeredReopen`), and a reply read before an agent resolves the ticket. Source: Codex found that both paths compute `shouldReopen` from a status read before the transaction (verified `ingest-message.ts:187-188` and `follow-up/route.ts:88`). Codex proposed a shared lock protocol; Claude chose conditional updates, because the row lock that each `UPDATE` takes, plus PostgreSQL's re-check of the updated row, gives the same guarantee with less code.
  *Amended 2026-11-08 during planning (11-04):* a conditional `UPDATE` alone does not wait for a transaction that is still changing the ticket from `OPEN` to `RESOLVED`: the row fails the `WHERE` on the statement snapshot and is skipped without waiting, so a reply could land on a just-resolved ticket and not reopen it. Both reply paths therefore first take the ticket row lock (`SELECT … FOR UPDATE` on that one row) and then run the conditional reopen; the job keeps its single conditional `UPDATE`, which waits on a reply that holds the lock and re-checks the status afterwards. A third forced-order test covers a reply arriving while an agent's resolve is uncommitted. Source: the planner found the gap; Claude agreed (PostgreSQL READ COMMITTED semantics), which also matches Codex's original lock recommendation for the reply paths.
- **D-18:** The job runs daily through `boss.schedule`, the same pattern as `sla-flag` (`src/lib/worker/index.ts`), closes at most 100 tickets per organization per run, ordered by quiet-period start and then id, and is idempotent when run again. Source: Codex.
- **D-19:** No customer notice in this phase. Nothing is sent to the customer when a ticket auto-closes, and there is no toggle for it. AIDA-51 allows an optional notice; whether an automatic fixed-template notice may reach customers without human approval is owner item O-2. Source: Codex; charter (anything that reaches a customer passes a human), conservative reading.

### Security, egress and docs

- **D-20:** No new egress, no inline script, no AI call. Audit rows hold ids and enum values only. Docs: `docs/KEYBOARD.md`, and a short note on saved views and auto-close in the existing user-facing docs if one fits. Source: charter → Aturan teknis AIDA.

### Migrations and tests

- **D-21:** Schema changes only through migrations: `prisma migrate dev --create-only`, edited by hand when needed (trigger, partial unique indexes), applied on a fresh database inside the `aida-dev-db` container on `127.0.0.1:55432`, with `DATABASE_URL` passed in the command's environment. Never `prisma db push`, never edit `.env`, never create or remove any other container. Source: charter → Test dan bukti.
- **D-22:** `SavedView` and `TicketAuditEvent` are org-scoped through `scopedDb`, with unmocked Testcontainers isolation tests (organization A never reads or changes B's rows; a private view is invisible to other users; the audit trigger rejects `UPDATE` and `DELETE`). Source: charter → Aturan teknis AIDA.
- **D-23:** E2E tests state observed outcomes, not keystroke scripts: each palette group, keyboard navigation and the `?` modal, keys ignored inside inputs, saving and applying a view, shared-view visibility for a second user, a bulk action's result and its audit count, and auto-close by invoking the job against fixture tickets whose `resolvedAt` lies in the past. No test runs a compose stack. The full `pnpm test:integration` and `pnpm test:egress` stay recorded as "blocked (O-1)"; the rest of the integration suite runs with the egress file excluded by an explicit, recorded command. Source: lessons from Phases 8 to 10.

### Plan shape

- **D-24:** As few plans as fit three tasks each. Suggested waves: wave 1, the migration, the membership helper, the filter schema and the audit writer, with isolation tests; wave 2, the mutation service with bulk and rollback tests, saved views, and auto-close with the reply-path fix and race tests; wave 3, the bulk UI and the palette with the keyboard dispatcher and docs; wave 4, E2E, the phase gate and the §9 design checklist. The planner may split further and never drops scope. Source: Codex (three plans), adjusted to the three-task limit.

### Claude's Discretion

- Exact key letters and chords within D-13.
- The upper bound for `limit` (D-03) and the length limits on view names and query text.
- Where in the SLA settings page the auto-close control sits.

</decisions>

<specifics>
## Specific Ideas

- Bulk selection uses checkboxes in the inbox list and a bar that appears when at least one ticket is selected.
- The palette reuses `src/components/ui/command.tsx` (shadcn `cmdk`, already installed).

</specifics>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` AIDA-47 to AIDA-51 (and AIDA-54, AIDA-56, AIDA-80, AIDA-86 that build on them); `.planning/ROADMAP.md` Phase 11 and Cross-phase risks; `.planning/seeds/SEED-005-saved-views-bulk-actions.md`, `SEED-006-command-palette-keyboard-inbox.md`, `SEED-009-lifecycle-automations-auto-close.md`
- `.planning/run-loop/PIAGAM.md`; `.planning/run-loop/codex/fase11-tanya.md`, `fase11-jawab.md`; `08-REVIEWS.md`, `09-REVIEWS.md`, `10-REVIEWS.md` (why each is parked)
- `.planning/DESIGN-SYSTEM.md` (sidebar tokens, top bar, empty state, §9 checklist); `.planning/research/plane-inspiration.md` §4 rows 5, 6 and 9 (behaviour only)

</canonical_refs>

<code_context>
## Existing Code Insights

- Inbox: `src/app/(app)/tickets/` (`page.tsx`, `ticket-list-panel.tsx`, `ticket-list-row.tsx`, `filter-chip-row.tsx`, `ticket-search-input.tsx`, `new-ticket-dialog.tsx`); filters in `src/lib/tickets/list-query.ts` and `cf-param.ts`; FTS in `src/lib/tickets/search.ts` (default limit 25).
- Ticket mutations: `src/app/(app)/tickets/[id]/actions.ts`; none writes an audit row today.
- Audit: `src/lib/audit/record-audit-event.ts` (AI only); append-only trigger pattern in the `AuditEvent` migration.
- Settings: `Setting` key-value model (unique per organization and key); SLA page `src/app/(app)/settings/sla/`.
- Worker: `src/lib/worker/index.ts` (`boss.schedule`), `src/lib/worker/jobs/sla-flag.ts` (set-based SQL).
- Reply paths that reopen: `src/lib/channels/email/ingest-message.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`.
- Shell: `src/components/sidebar.tsx`, `src/components/top-bar.tsx`, `src/app/(app)/layout.tsx`.

</code_context>

<deferred>
## Deferred Ideas

- Drag reordering of saved views.
- "Select all tickets matching the filter" for bulk actions.
- Notifications on bulk assignment: Phase 10 (parked) owns notifications.
- Snooze and state groups in auto-close: Phase 12 (ROADMAP → Cross-phase risks).
- A customer notice on auto-close: owner item O-2.
- Other lifecycle automations from SEED-009 (archiving, CSAT requests).

</deferred>

## Owner items (not decided here)

- **O-1:** The pending decision on how container tests may run on the shared Docker VM (LAPORAN section 3). This phase writes no compose-stack test; the charter-mandated suites that need it are recorded as blocked, never as passed.
- **O-2:** Whether an automatic, fixed-template notice may be sent to customers when a ticket auto-closes, without a human approving each one. Until then nothing is sent (D-19).
- **O-3:** Unparking Phases 8, 9 and 10. Until then the membership check exists only on Phase 11's new paths (D-01), and AIDA-43 stays open.

## Human boundary

The charter's phase table lists no human item for Phase 11. Added here: approval of the look of the Views section, the bulk bar, the palette, the help modal and the auto-close setting (no visual pass is claimed); the screen-reader check of single-letter keys (D-14); and the owner items O-1 to O-3.

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks. Write every human verification as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. Every executor dispatch includes the charter's "Aturan eksekutor" section.

Lessons from the three parked phases, binding here:

- Few plans, few new mechanisms. Prefer what Testcontainers or unit tests can prove: row locks, conditional updates, unique constraints and one transaction. Testcontainers needs the Colima socket environment that the orchestrator supplies.
- No test may run a real compose stack (O-1).
- E2E tests assert observed outcomes; they do not script exact keystroke sequences whose effect depends on details fixed elsewhere, and every expectation must match the behaviour an earlier plan specifies.
- Acceptance criteria point at the file where the code actually lives, and never contradict the plan's own action.
- One test process at a time; long commands write to a log, and exit codes are read without a pipe.

## Owner rules of 2026-11-08 (binding, summary)

- **D:** all code is written by Claude (Opus 5.5); Codex reviews only. GSD agents inherit the session model (`model_profile: inherit`); no `model` parameter on dispatch.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout. Temporary exports are deleted only by the round that made them.
- **F:** owner-only decisions (scope, licences, anything that changes `PROJECT.md` or `REQUIREMENTS.md`) are not chosen here; they are O-1 to O-3.
- **G:** no push.
- **A and B:** disk and Docker health are checked every round; Docker is never stopped, restarted or deleted.
- **Container rule:** only projects `aida` and `aida-dev-db`, plus the Testcontainers suites; `pnpm test:egress` stays blocked while O-1 is open (run-loop decision K26).

## Larangan dari piagam (verbatim, binding)

- Dilarang `git push`, `gh pr`, `gh release`, `gh workflow run`, dan apa pun yang memindahkan commit ke remote. Jangan melepas kunci `pushurl`.
- Dilarang commit ke `master`, `git merge`, `git rebase`, `git reset --hard`, `git clean`, `git stash`, `git tag`, dan `--no-verify`.
- Dilarang menyentuh `~/Public/aff/recruitment` dan project lain.
- Dilarang menghentikan, menghapus, atau mengubah container dan volume selain milik project `aida` dan `aida-dev-db`. Dilarang `docker system prune` dan `docker volume prune`.
- Dilarang memanggil API LLM berbayar sungguhan, mengirim email nyata, dan memakai kredensial asli. Test memakai fake dan server tiruan.
- Dilarang menaruh API key di `.env` dan mengubah aturan izin Claude Code.
- Dilarang `--auto` dan `--chain`, dan dilarang menyalakan `workflow.auto_advance`.
- Dilarang `/gsd-autonomous`, `/gsd-discuss-phase`, `/gsd-new-milestone`, `/gsd-verify-work`, `/gsd-audit-milestone`, `/gsd-complete-milestone`, `/gsd-cleanup`, `/gsd-ship`, dan `/gsd-update`.
- Dilarang `/gsd-review`, `/gsd-plan-review-convergence`, `--codex`, `--all`, `--converge`, dan `--cross-ai`. Jalur itu menjalankan reviewer di repo asli, bukan di ekspor.
- Dilarang mengisi hasil UAT, visual pass, atau penilaian manusia rekaan. Kosong tetap kosong.
- Dilarang menulis backslash ke `last_activity_desc` di `STATE.md`.

---

*Phase: 11-inbox*
*Context gathered: 2026-11-08*
