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
  *Amended 2026-11-08 after Codex plan review cycle 1, C3:* the quiet period starts at the later of `resolvedAt` and `autoCloseEnabledAt`; messages are not read. A real customer reply reopens the ticket under the D-17 lock, so it is no longer `RESOLVED` and is not a candidate; agent replies (public or internal) and automatic mail on a resolved ticket do not restart the period, and the auto-close card and the docs say so. The job's candidate query and its conditional `UPDATE` no longer read `Message`. The rest of D-16 stands (a `RESOLVED` ticket without `resolvedAt` is skipped and counted; closing sets `CLOSED` and leaves `resolvedAt` unchanged). Source: Codex found that the public-message rule could miss a reply being written, because an agent's public reply does not touch the ticket row and an uncommitted message is invisible to the job's snapshot, and automatic mail skips the lock; Claude chose to remove the rule rather than serialise every message write on the ticket row.
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

## Update 2026-11-13: owner item O-2 decided (auto-close customer notice)

Written by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`) as input for a follow-up plan of Phase 11. Facts checked against the code at `4def908` (branch `v2/run-loop`). Codex brainstorm: `run-loop/codex/fase11-o2-tanya.md` (answer pending). Candidate decisions below are labelled `W-NN`; none is final until the Codex answer is folded in and the planner applies them.

### The owner decision (verbatim, binding)

Source: `.planning/run-loop/ANTREAN.md`, row `11-o2`:

> "Owner 2026-11-11: butir 10: opsi a, "ya" tegas dari owner. Template tetap yang ditulis admin, mati secara default, dinyalakan admin per workspace. Kerjakan sesudah Fase 10 sebagai plan susulan Fase 11."

Reading: a fixed template written by an admin, off by default, switched on per workspace by an admin, may be sent automatically to the customer when a ticket auto-closes, without per-message human approval. This is an owner decision and is not reopened here. It satisfies the charter's "anything that reaches a customer passes a human" through the admin who writes and enables the fixed text, and it stays inside AIDA-51's acceptance (`.planning/REQUIREMENTS.md:47`: "any customer notice is a fixed template, off by default, with no AI text").

### What it supersedes

- **D-19** ("No customer notice in this phase. Nothing is sent to the customer when a ticket auto-closes, and there is no toggle for it") is superseded for the follow-up plan: a notice may be sent when the workspace switch is on. D-19's source reasoning (conservative reading of the charter) is replaced by the owner decision above.
- Owner item **O-2** is closed by that decision. The deferred idea "A customer notice on auto-close" is now in scope for the follow-up plan only.
- The job header ("Nothing is sent to anyone (D-19, owner item O-2)", `src/lib/worker/jobs/auto-close.ts:33-35`), the 11-04 threat T-11-21 ("there is no notice code path", `11-04-SUMMARY.md:116`), the UI-SPEC scope item (6) that cites D-19 (`11-UI-SPEC.md:17`) and the AIDA-51 traceability text (`REQUIREMENTS.md:173`) become stale and are updated by the follow-up plan, the last one only at step 10 on evidence.
- Not superseded: D-15 to D-18 (settings, quiet period, race safety, daily job, 100 per organization per run), D-20 (no AI call, no inline script, audit holds ids and enums only) and the Human boundary section.
- The Phase Boundary text above ("Phases 8, 9 and 10 are parked … there is no CSP, no membership helper, no notification model") is out of date: Phase 8 part A, Phase 9 and Phase 10 are executed (ANTREAN rows 08 and 10). The facts below replace it for the follow-up plan.

### Facts checked in the current code

Auto-close today:

- The job: `closeResolvedTicketIfQuiet` (`src/lib/worker/jobs/auto-close.ts:98-152`) runs inside one transaction per ticket (`:289-299`, options `maxWait` 10 s, `timeout` 30 s at `:63`). Lock order: `Setting` days row `FOR SHARE` (`lockAutoCloseSettings`, `src/lib/tickets/auto-close-settings.ts:100-125`), state config and target state `FOR SHARE` (`auto-close.ts:111-117`), then the ticket row (`:119`); one conditional raw `UPDATE … RETURNING` (`:125-140`); the `AUTO_CLOSED` audit row (`actorType` `SYSTEM`, state snapshot only) only when a row changed (`:141-150`).
- Per-run cap `MAX_AUTO_CLOSE_PER_ORG = 100` (`auto-close.ts:60`, query `:276-286`). An error in one organization is logged by code only and the run throws `AutoCloseRunError` at the end so pg-boss retries (`:189-197`, `:237-248`); the log never carries an error message (`:199-212`).
- Scheduling: `boss.schedule("auto-close", "15 2 * * *")`; the worker calls `autoCloseHandler(job.data)` with no pg-boss handle (`src/lib/worker/index.ts:72-76`). No worker job enqueues another job today: every `boss.send("email-outbound-send", …)` is in the app (`src/app/api/tickets/[id]/messages/route.ts:255-259`, `src/app/(app)/tickets/[id]/actions.ts:95`).
- Settings: keys `autoCloseResolvedAfterDays` and `autoCloseEnabledAt` (`auto-close-settings.ts:28-29`) in the key-value `Setting` model (`prisma/schema.prisma:208-219`, `value String`, unique per organization and key). The save holds `FOR UPDATE` on the days row for its whole transaction (`auto-close-settings.ts:177-228`).
- Save gate: `saveAutoCloseDays` uses `findActiveMembership` plus `isAdminRole` (`auto-close-settings.ts:168-170`), the single unordered row read, not the conservative read that Phase 12.2 and Phase 10 use for role decisions (`findConservativeMembership`, `src/lib/membership.ts:81`; `shareLockActiveMembership`, `:126`; `isAdminRole`, `:151`). The server action is `saveAutoCloseSetting` (`src/app/(app)/settings/sla/actions.ts:64-70`).
- Settings page: `src/app/(app)/settings/sla/page.tsx` awaits `requirePageAccess()` first (`:15`), reads the settings unlocked (`:31`) and decides `canEdit` from `getOrgRole()`, display only (`:32-33`). The card is `src/app/(app)/settings/sla/auto-close-form.tsx` (`Card className="border-border/70 p-4 shadow-sm"` at `:103`, `<h2>` 15px at `:106`).
- Thread copy of the close: `AUTO_CLOSED` → "Closed automatically by the auto-close setting." (`src/lib/tickets/activity-copy.ts:241-244`).

Outbound email:

- `emailOutboundSendHandler` (`src/lib/worker/jobs/email-outbound-send.ts:62-172`) sends only an `OUTBOUND` `PUBLIC` `Message` (`:70`) to the origin ticket's contact (`:75-79`); it returns silently when the email channel is off (`:81-82`), leaving a `QUEUED` row as is; on an SMTP error it sets `FAILED` and rethrows for the queue's retries (`:162-169`; queue `retryLimit` 2, `src/lib/worker/index.ts:103-110`). Subject `Re: {ticket subject} [#{number}]` (`:155`), from name = branding workspace name (`:148-153`).
- `composeMail` takes no extra headers (`src/lib/channels/email/compose-outbound.ts:28-55`), so a reply today carries no `Auto-Submitted` header, and the send has no total deadline (plain `createSmtpTransport`, `email-outbound-send.ts:150`).
- Phase 10 digest: `sendDigestMail` (`src/lib/notifications/digest-sender.ts:162`) owns its socket and enforces a total deadline (`:1-9`), classifies the outcome as `accepted`, `rejected` (with `configuration` and `permanent` kinds) or `ambiguous` (`:11-30`), and sends `Auto-Submitted: auto-generated` (`DIGEST_MAIL_HEADERS`, `:32-34`, `:48-50`).
- Inbound: any `Auto-Submitted` other than `no` marks mail automatic (`src/lib/channels/email/auto-generated.ts:9-10`, used at `ingest-message.ts:97`), and automatic mail never reopens. A real customer reply reopens a ticket in group `RESOLVED` or `CLOSED` (`src/lib/tickets/reopen-on-reply.ts:8`, `:273`). Threading falls back to the `[#number]` subject token (`src/lib/channels/email/thread-match.ts:3-7`) when header matching misses.
- A public reply writes a `Message` with `authorUserId` set, `deliveryStatus` `QUEUED` only when the channel is on and a contact is linked (`messages/route.ts:134`, `:185-196`), enqueued after commit (`:255-259`).
- `Message` has no kind or system marker (`prisma/schema.prisma:380-409`; `MessageDeliveryStatus` is `QUEUED`, `SENT`, `FAILED`, `:249-253`). An `OUTBOUND` message with no author renders as "Agent" (`src/components/tickets/thread-message.tsx:53-55`), and every `PUBLIC` message is shown on the public status page (`src/lib/tickets/status-visibility.ts:56-59`).
- No template or canned-response model exists (no match in `prisma/schema.prisma`; no `canned` or `macro` module under `src/lib`).
- `TicketAuditAction` has no notice value (`prisma/schema.prisma:663-673`).
- Public intake creates a ticket and a contact for any submitted email address, rate limited by IP (`src/app/api/public/intake/route.ts:21`, `:61-71`, `:103-108`). `Ticket.statusToken` is stored in plain text (`prisma/schema.prisma:306`) and is the bearer credential of the status page.
- `src/lib/rate-limit/*` is IP-keyed for public endpoints (`check-rate-limit.ts:45`); no settings action uses it.

Phase 10 and later changes this plan must respect:

- Rule B (`tests/unit/page-access-inventory.test.ts`): every `(app)` page awaits `requirePageAccess` as its first statement, outside any `try`, and never calls `getScopedDb`.
- Rules A, C2 and D (`tests/unit/membership-inventory.test.ts:7-37`): every new server action calls a membership gate, reads the session at most once, and the worker imports no `next/*`, writes `DOMAIN_MODELS` rows with `organizationId` in the literal, and each raw `INSERT`, `UPDATE` or `DELETE` needs a per-function allowlist entry with a reason (the auto-close one is at `:341-346`).
- A new model goes into `DOMAIN_MODELS` (`src/lib/scoped-db.ts:14`) with unmocked isolation tests.
- The last migration is `20261115100000_team_foundation`; every new migration is pinned in `UPGRADE_MIGRATIONS` (`tests/integration/auth-upgrade.test.ts:38-48`), or that test fails.
- Phase 10 adds `CUSTOMER_REPLY` notifications on customer replies, so a customer who answers the notice reopens the ticket and notifies as any reply does; no new notification type is needed.

### Candidate technical decisions

- **W-01 Template storage and validation.** (a) Recommended: no new table; `Setting` keys `autoCloseNotice:enabled` (`"true"` or absent) and `autoCloseNotice:body`, written in the auto-close save transaction under the same days-row `FOR UPDATE`. Body: trimmed plain text with Markdown rendered by the existing sanitizing renderer for the HTML part, 1 to 2000 characters, no raw HTML, no links other than plain text, refused when empty. (b) A dedicated org-scoped model. Open for Codex: the length limit and whether Markdown is allowed at all.
- **W-02 Per-workspace switch, default off.** An absent key is off. Enabling requires a valid body. The switch is stored independently of the days value; with days 0 it is inert and the card says so. The close transaction reads the switch and the body under the days-row `FOR SHARE` it already takes, so a save waits for a close and a close sees one consistent pair. The body is snapshotted into the notice record at close time, so a later edit never changes a notice already recorded.
- **W-03 Who may edit.** Owners and admins only, decided with `findConservativeMembership` plus `isAdminRole` inside the save, through the existing server action (one session read, Rule C2). Members see the card read-only. Open for Codex: whether this plan also moves `saveAutoCloseDays` (`auto-close-settings.ts:168-170`) to the conservative read, since the notice save shares its transaction.
- **W-04 Placeholders and untrusted data.** (a) Recommended: a closed whitelist of system values only, `{ticketNumber}` and `{workspaceName}`; any other `{…}` is refused at save. Never the contact name, the ticket subject, message text, tags or custom fields: they are customer-controlled and the intake path takes any address. (b) No placeholders at all. Subject: (a) `Re: {subject} [#{number}]` as replies, which threads in the customer's client but echoes untrusted subject text from an automatic sender; (b) a fixed system subject that still carries `[#{number}]`. Never a status-page link placeholder (the token is a bearer credential in plain text). Open for Codex.
- **W-05 When the notice is sent.** Never inside the close transaction: SMTP inside a 30 s transaction would hold the Setting, state and ticket locks on a network call. The close transaction writes a notice record (outbox) only when the conditional `UPDATE` changed a row and the switch read under the lock is on. After commit, options: (a) the auto-close job sends each recorded notice itself with a deadline-bounded sender in the `sendDigestMail` pattern; (b) a new on-demand queue enqueued after commit, which needs the pg-boss handle passed into the handler, plus a sweep of orphaned records; (c) reuse `email-outbound-send`, which lacks the deadline and the header. Recommended: (a). Open for Codex.
- **W-06 Idempotency.** At most one notice per auto-close event, enforced by a unique constraint on the notice record per close, not by application checks. Open for Codex: per event (a ticket closed, reopened by a reply, resolved and closed again gets a second notice) or per ticket ever. Delivery rule recommended: at most once; an `ambiguous` outcome is not retried, a permanent or configuration rejection is not retried, a transient 4xx is retried a bounded number of times.
- **W-07 Record in the ticket thread and audit.** (a) A `Message` row (`OUTBOUND`, `PUBLIC`, no author): today it would render as "Agent" and appear on the status page with no marker, and it would join merge and threading rules written for human replies; needs a marker column. (b) Recommended: a new org-scoped model (ticket id, the close's audit row id or close time, status `PENDING`, `SENT`, `FAILED`, `SKIPPED` with a reason enum, body snapshot, `emailMessageId`, timestamps) plus new `TicketAuditAction` values for sent, failed and skipped, carrying ids and enums only; the thread shows a system event row from `activity-copy.ts`. (c) Booleans in the `AUTO_CLOSED` `after` snapshot only, no schema change, but no delivery outcome. (a) and (b) are schema changes. Open for Codex, including whether a customer reply to the notice must thread by header (then the `emailMessageId` must be found by ingest) or by the `[#number]` subject token.
- **W-08 Channel.** Email only, to the ticket contact's address; tickets have no other outbound channel. A contact without an address gets a `SKIPPED` record. Open for Codex: whether the notice also appears on the public status page.
- **W-09 Headers.** `Auto-Submitted: auto-generated` (RFC 3834), the same constant as the digest, so auto-responders stay silent and AIDA's own ingest never treats an echo as a customer reply. `composeMail` gains an optional headers field or the notice uses its own composer. `In-Reply-To` and `References` follow the ticket's thread or are omitted, decided with W-07.
- **W-10 SMTP off or failing.** Channel off or SMTP not configured at close time: the ticket still closes and the notice is recorded `SKIPPED` (reason channel off), never sent later. A failed send is recorded `FAILED` with the error code only (no address, no body, no message text in logs) and never rolls back or blocks the close. Open for Codex: whether a notice failure makes the run throw `AutoCloseRunError` (pg-boss retries the whole run) or is only logged. The card warns when the switch is on and the email channel is off.
- **W-11 Privacy.** The notice body is the admin's template plus whitelisted system values only: no internal notes, no member or assignee names, no AI draft, no quoted history, no other messages. From name is the branding workspace name, as replies use. Logs carry ids, counts and codes.
- **W-12 Abuse bound.** The 100-per-organization run cap bounds volume. Because intake accepts any address, the notice could reach an address that never wrote in once an agent resolves a spam ticket. Open for Codex: send only when the ticket has at least one inbound email or one sent public reply (proof the address took part), or accept the risk because a human resolved the ticket.
- **W-13 Settings UI.** On the SLA page, inside the auto-close card or as a second card under it: a switch, a textarea with a character count, the allowed placeholders, a plain-text preview, and the copy that the notice is sent automatically without per-message approval. Tokens only, `text-[Npx]` sizes, Card `border-border/70 p-4 shadow-sm`, warnings in the `warning` token pattern, read-only for members, one `<h1>` per page. A UI-SPEC addendum to `11-UI-SPEC.md` (scope item 6) comes before planning, and the §9 checklist of `.planning/DESIGN-SYSTEM.md` runs after execution.
- **W-14 Tests.** Unit: the template parser and placeholder whitelist, rendering with hostile values. Integration (Testcontainers): close and notice record commit together or not at all; switch off under the lock writes no record; a save racing a close; two concurrent runs give one notice; channel off gives `SKIPPED`; a fake SMTP server on `node:net` with the digest's fault cases gives `FAILED` or `ambiguous` and no retry; org A never reads org B's records; new audit values stay append-only. Inventory: the membership and page-access inventories pass, with an allowlist entry and reason for any new raw SQL in the worker. E2E through the real UI: an admin enables the notice and writes the template on the SLA page; a member sees it read-only; the job runs against fixture tickets; the thread shows the notice event; the mail is captured by a fake transport. No compose stack, no real mail.
- **W-15 Docs and plan shape.** User docs gain a short note on the notice. `docs/SECURITY.md` is not edited (owner item 08-o4 blocks it); no new egress exists to record, the configured SMTP being the existing one. One or two plans of at most three tasks each, numbered after 11-09.

### Limits for the planner (charter)

- No `checkpoint:human-verify` tasks. Visual approval of the new card, dark mode, 360px and any real-mail check are manual items in the plan and the SUMMARY, left open.
- The full "Larangan" list of `.planning/run-loop/PIAGAM.md` (section "Larangan") applies, including its current line that rule J narrows the container item; the copy above in this file predates that line.
- No schema change unless W-06 or W-07 requires it. If it does: a rule J disposable dev database as plan 10-01 Task 1 did (procedure of `08-02-PLAN.md`; never `aida-dev-db`, never `prisma db push`, `.env` untouched), a folder that sorts after `20261115100000_team_foundation`, hand-reviewed SQL, the name added to `UPGRADE_MIGRATIONS` in `tests/integration/auth-upgrade.test.ts`, the model added to `DOMAIN_MODELS`, and isolation tests.
- No new egress beyond the workspace's configured SMTP; tests use fakes and a local fake server only. No AI call and nothing from `lib/llm/` in the notice path.
- `docs/SECURITY.md` stays blocked by owner item 08-o4.
- Every executor dispatch includes the charter's "Aturan eksekutor"; one test process at a time; long commands write to a log and exit codes are read without a pipe.

### Open questions for Codex

1. W-05: send in the job after each commit, a new queue, or the existing send job; how orphaned records are swept.
2. W-06: one notice per close event or per ticket; at-most-once on `ambiguous`.
3. W-07: a `Message` with a marker or a separate record; is a schema change justified; how a reply to the notice threads.
4. W-04: subject with the customer's subject or a fixed one; the placeholder set.
5. W-12: require proof that the address took part before sending.
6. W-02 and W-03: is the days-row lock enough for the template pair; move the existing save to the conservative read in this plan or leave it.
7. W-10: does a notice failure fail the run.
8. W-08: show the notice on the status page or not.

---

*Phase: 11-inbox*
*Context gathered: 2026-11-08*
