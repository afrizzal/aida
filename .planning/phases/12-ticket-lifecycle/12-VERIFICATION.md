---
phase: 12-ticket-lifecycle
verified: 2026-11-08T18:27:21Z
verified_commit: 4f1a777
status: human_needed
score: 15/16 must-haves verified (1 open owner question, 12-o1; 14 backstop truths routed to a human and not counted)
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/12-ticket-lifecycle/12-01-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-01-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-02-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-02-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-03-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-03-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-04-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-04-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-05-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-05-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-06-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-06-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-07-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-07-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-08-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-08-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-09-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-09-SUMMARY.md"
  - ".planning/phases/12-ticket-lifecycle/12-10-PLAN.md"
  - ".planning/phases/12-ticket-lifecycle/12-10-SUMMARY.md"
  - "README.md"
  - "prisma/migrations/20261109100000_ticket_lifecycle/migration.sql"
  - "prisma/schema.prisma"
  - "src/app/(app)/tickets/[id]/merge-actions.ts"
  - "src/app/(app)/tickets/[id]/page.tsx"
  - "src/app/(app)/tickets/[id]/relation-actions.ts"
  - "src/app/(app)/tickets/[id]/snooze-actions.ts"
  - "src/app/(app)/tickets/bulk-action-bar.tsx"
  - "src/app/(app)/tickets/filter-chip-row.tsx"
  - "src/app/(app)/tickets/save-view-dialog.tsx"
  - "src/app/(app)/tickets/ticket-list-panel.tsx"
  - "src/app/(app)/tickets/ticket-list-row.tsx"
  - "src/app/(public)/status/[token]/page.tsx"
  - "src/app/api/public/status/[token]/attachments/[id]/route.ts"
  - "src/app/api/public/status/[token]/follow-up/route.ts"
  - "src/app/api/tickets/[id]/messages/route.ts"
  - "src/app/api/tickets/picker/route.ts"
  - "src/components/tickets/activity-event-row.tsx"
  - "src/components/tickets/activity-feed.tsx"
  - "src/components/tickets/link-ticket-dialog.tsx"
  - "src/components/tickets/linked-tickets-row.tsx"
  - "src/components/tickets/local-date-time.tsx"
  - "src/components/tickets/merge-ticket-dialog.tsx"
  - "src/components/tickets/merged-source-banner.tsx"
  - "src/components/tickets/snooze-control.tsx"
  - "src/components/tickets/thread-message.tsx"
  - "src/components/tickets/ticket-actions-menu.tsx"
  - "src/components/tickets/ticket-meta-header.tsx"
  - "src/components/tickets/ticket-picker.tsx"
  - "src/lib/attachments/staged-files.ts"
  - "src/lib/channels/email/ingest-message.ts"
  - "src/lib/demo/seed-demo-data.ts"
  - "src/lib/scoped-db.ts"
  - "src/lib/tickets/activity-copy.ts"
  - "src/lib/tickets/activity-feed.ts"
  - "src/lib/tickets/lifecycle-copy.ts"
  - "src/lib/tickets/list-filters.ts"
  - "src/lib/tickets/list-query.ts"
  - "src/lib/tickets/merge.ts"
  - "src/lib/tickets/mutations.ts"
  - "src/lib/tickets/relation-pairs.ts"
  - "src/lib/tickets/relations.ts"
  - "src/lib/tickets/reopen-on-reply.ts"
  - "src/lib/tickets/snooze.ts"
  - "src/lib/tickets/status-page-data.ts"
  - "src/lib/tickets/status-visibility.ts"
  - "src/lib/tickets/ticket-detail-data.ts"
  - "src/lib/tickets/ticket-picker.ts"
  - "src/lib/worker/index.ts"
  - "src/lib/worker/jobs/auto-close.ts"
  - "src/lib/worker/jobs/email-outbound-send.ts"
  - "src/lib/worker/jobs/snooze-wake.ts"
covered_digest: "v1:sha256:84d20e8f928ac252af3a91255d676092358c426598e7925e19cd3cea626d77bc"
behavior_unverified: 0
overrides_applied: 0
owner_open:
  - id: "12-o1"
    truth: "A merge leaves a full AuditEvent (AIDA-53 literal wording; ROADMAP criterion 2 'leaves a full audit event')"
    state: "open owner question; neither met nor a gap resolved here"
    evidence: "The merge writes MERGED_INTO on the source and MERGED_FROM on the target (plus STATUS_CHANGED, WOKEN and RELATION_REMOVED/ADDED when applicable) to TicketAuditEvent (src/lib/tickets/merge.ts:289-350). AuditEvent stays AI-only (11 D-07, 12 D-11). Changing the requirement text, or another resolution compatible with 11 D-07, is the owner's call."
blocked:
  - item: "pnpm test:integration as-is (with tests/integration/egress-isolation.test.ts)"
    reason: "blocked by owner item O-1 (container tests on the shared Docker VM); not run, not passed"
  - item: "pnpm test:egress"
    reason: "blocked by owner item O-1 (run decision K26); not run, not passed"
baseline_unchanged:
  - "pnpm audit --prod: exit 1, 7 critical and 52 high (baseline, unchanged)"
  - "Windows-only taskkill message in the E2E teardown (3 times, did not fail the run)"
  - "One skipped existing E2E case (uat-gaps.spec.ts:17)"
human_verification:
  - test: "Visual approval of every new surface (UI-SPEC E1 to E11): top-bar snooze trigger and actions menu, linked tickets row and chips, Link a ticket dialog and picker with its disabled reasons, two-step merge dialog and its callouts, merged-source banner and composer line, Moved from marker, snooze popover and snoozed chip, Snoozed toggle with its summary and empty line, feed event rows, public Combined label and merged notice"
    expected: "Each surface matches 12-UI-SPEC.md and DESIGN-SYSTEM.md"
    why_human: "Visual judgement; no visual pass has been done and none is claimed"
  - test: "Dark-mode review of the same surfaces (DESIGN-SYSTEM section 7)"
    expected: "Readable contrast and correct token use in dark mode on every new surface"
    why_human: "a11y-contrast.spec.ts covers none of the Phase 12 surfaces; dark mode is a human item (UI-SPEC open axis)"
  - test: "Screen-reader and accessibility backstop (UI-SPEC accessibility open axis, E1 to E11): the actions menu, the picker's disabled reasons, the merge confirmation, the snooze popover with the aria-disabled trigger's reason, and the feed list (ol aria-label Ticket activity)"
    expected: "Each is announced correctly with its name, state and reason"
    why_human: "Screen-reader behaviour cannot be proven by grep or the existing tests"
  - test: "Layout backstop truths (verification: backstop, insufficient_spec): E1 255-character subject at 1280px; E2 relation chip at 200px and 1024px; E3 picker row and cycle callout at 360px; E4 two 255-character subjects in the merge confirmation at 360px; E5 merged banner at 1024px; E7 long IANA zone name in the 320px popover at 360px; E8 inbox row chips at the 360px list panel; E9 four active filters at 360px; E10 500 events and 200 messages in the feed; E10 255-character member name at 1024px; E11 public notice at 360px"
    expected: "Each statement in 12-UI-SPEC.md (Edge-case backstop rows) holds as written"
    why_human: "Non-inferable layout truths; no test measures them and presence of code does not qualify"
  - test: "Time-zone backstop: in a browser set to Asia/Jakarta, Tomorrow 09:00 is stored as 02:00 UTC and shown as 09:00 in the chip, popover and feed, with the zone line naming Asia/Jakarta"
    expected: "Stored and displayed times as stated"
    why_human: "The E2E zone block in tests/e2e/snooze.spec.ts proves viewer-zone display for a zone different from the host, not this exact statement; the visible result needs a human look"
  - test: "Deferred copy decisions: (a) reopen markers on a merged source's public page sit under a CLOSED header (review IN-06); (b) a merged source shows in assignee-based list views as a plain CLOSED row without a merged marker (Codex R2-3)"
    expected: "A decision on the copy and layout during the visual pass"
    why_human: "Copy and layout decisions recorded in deferred-items.md for the visual pass"
  - test: "Judgment-tier prohibitions of 12-01 and 12-04 (AIDA-53 privacy): no status token returns or shows a PUBLIC message or attachment its holder could not see before the merge, other than messages created on the target after it; INTERNAL never"
    expected: "Human confirms the verifier's non-authoritative judgement (holds; backed by merge-provenance.test.ts, merge-race-coverage.test.ts and status-read-snapshot.test.ts, run green by this verifier)"
    why_human: "unverified-prohibition, human review recommended: judgment-tier prohibitions are never silently passed"
---

# Phase 12: Ticket Lifecycle (relations, merge, snooze, activity) Verification Report

**Phase Goal:** Tickets model duplicates and waiting: links between tickets, safe merges, snooze, and an activity feed.
**Scope:** AIDA-52, AIDA-53, AIDA-54, AIDA-55 and ROADMAP Phase 12 criteria 1 to 3. AIDA-56, AIDA-57, AIDA-97 (Phase 12.1) and AIDA-18 (Phase 12.2) are out of scope by run decision K32.
**Verified:** 2026-11-08T18:27:21Z, at commit `4f1a777` (branch `v2/run-loop`)
**Status:** human_needed
**Re-verification:** No, initial verification (no earlier 12-VERIFICATION.md)

The code under test at `4f1a777` is the code of the final gate: `git diff --name-only db55e8d 4f1a777` lists only `12-GATE.md` and `RUN-LOG.md`, and `eae5843..db55e8d` only `12-REVIEW-FIX.md`. The working tree is clean apart from the untracked `.planning/state.json`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence (code, then test) |
|---|-------|--------|----------------------------|
| 1 | Tickets link as `duplicate_of`, `related_to` or `child_of`, and each link shows from both sides (SC1, AIDA-52) | VERIFIED | `TicketRelationType` enum and table (migration `20261109100000_ticket_lifecycle`); `addRelation` (`src/lib/tickets/relations.ts:185-275`); per-side labels in `relation-pairs.ts`, `listRelationsForTicket` (`relations.ts:390-434`) read from each ticket's side; `LinkedTicketsRow` in `ticket-meta-header.tsx:566`. Tests: `ticket-relations.test.ts` > "links A as a duplicate of B, shows it from both sides and audits both tickets"; `lifecycle-helpers.test.ts` > "labels DUPLICATE_OF / CHILD_OF / RELATED_TO from each side"; E2E `ticket-relations.spec.ts` > "a stored link shows on both tickets and can be removed with an audited result" |
| 2 | Links are unique per pair and org-scoped (AIDA-52) | VERIFIED | `TicketRelation_pair_key` unique index on `(organizationId, LEAST, GREATEST)`, `TicketRelation_no_self_check`, `TicketRelation_one_parent_key` (migration, hand-written section); `TicketRelation` in `DOMAIN_MODELS` (`src/lib/scoped-db.ts`); both rows locked with the organization predicate (`lockTicketsInIdOrder`, `merge.ts:134-148`). CHILD_OF under `pg_advisory_xact_lock` plus bounded ancestor walk (`relations.ts:151-179, 212-234`). Tests: `lifecycle-schema.test.ts` > "refuses B->A after A->B, A->B twice and a second type on the same pair", "scopedDb(orgB) never reads, counts, updates or deletes A's TicketRelation rows"; `ticket-relations.test.ts` > "TICKET_UNAVAILABLE for another organization's ticket", "cycle race: A child of B against B child of A, exactly one succeeds and the other is CYCLE" |
| 3 | A merge moves messages and attachments to the target, closes the source as a duplicate, and hard-deletes nothing (SC2, AIDA-53) | VERIFIED | `mergeTickets` (`src/lib/tickets/merge.ts:161-359`): `message.updateMany` sets `ticketId` = target and `mergedFromTicketId` = source (`:255-258`); attachments belong to `messageId`, so they follow; source set `CLOSED` with `mergedIntoTicketId`, `mergedAt`, `mergeMessageSeq` (`:263-276`); `DUPLICATE_OF` source to target (`:278-287`). The only delete is a replaced, audited `TicketRelation` row (`:232-252`). Test: `ticket-merge.test.ts` > "moves the whole thread with provenance, closes the source as a duplicate and audits both" (asserts the attachment row unchanged except its message, source `CLOSED`, `DUPLICATE_OF`, row counts unchanged); > "rolls back everything when a sentinel is thrown after the messages moved" |
| 4 | Merge requires confirmation in the UI, and the server enforces every rule (AIDA-53) | VERIFIED | Two-step `merge-ticket-dialog.tsx` (step `pick` then `confirm`; `mergeTicketAction` only from the confirm step, `:246`); the server re-checks under both row locks, including `LINK_CHANGED` against the reviewed link (`merge.ts:201-217`). Tests: E2E `ticket-merge.spec.ts` > "merging after confirmation moves the thread and closes the source"; `ticket-merge.test.ts` > the seven "the reviewed link is a precondition" cases |
| 5 | Merging tickets of different contacts is refused, and nothing changes (AIDA-53, K33) | VERIFIED | `merge.ts:199` `DIFFERENT_CONTACTS` on the locked rows. Tests: `ticket-merge.test.ts` > "DIFFERENT_CONTACTS for tickets of two contacts (K33)"; `merge-provenance.test.ts` > "a refused two-contact merge (DIFFERENT_CONTACTS) leaves both pages, attachments and csat as before"; E2E `ticket-merge.spec.ts` > "tickets of two contacts cannot be picked and nothing changes" |
| 6 | Each status link keeps working and shows only what its holder could see before the merge plus later replies, across the status page, attachments, follow-up and CSAT; no link exposes one contact's messages to another (SC2, AIDA-53, D-09 amended) | VERIFIED | One predicate, `statusMessageWhere` / `isMessageVisibleForToken` (`src/lib/tickets/status-visibility.ts:56-84`), decided by `seq > mergeMessageSeq`, never by timestamps; used by `loadStatusPageData` and `loadStatusAttachment` in one REPEATABLE READ snapshot (`status-page-data.ts:69-167`); the attachment route answers 404 for anything outside the predicate (`attachments/[id]/route.ts:18-21`); follow-up resolves the effective ticket under the row lock (`follow-up/route.ts:96-118`, `resolveReplyTicket` `reopen-on-reply.ts:141-192`); CSAT stays on the token's own ticket (`csat/route.ts:18, 61-70`). Tests: `merge-provenance.test.ts` (6 cases, including "page, attachments and follow-up: each token sees exactly what D-09 allows" and "csat stays one per ticket"); `merge-race-coverage.test.ts` 1a, 1b, 1c, 2a; `status-read-snapshot.test.ts` (3 cases); E2E `ticket-merge.spec.ts` > "each status link shows only what D-09 allows after a merge" |
| 7 | A merge leaves a full `AuditEvent` (AIDA-53 literal; SC2 "leaves a full audit event") | UNCERTAIN: open owner question 12-o1 | Not claimed as met and not resolved here. The merge audit is written to `TicketAuditEvent` (`merge.ts:289-350`: `MERGED_INTO`, `MERGED_FROM`, plus `STATUS_CHANGED`, `WOKEN`, `RELATION_REMOVED`/`RELATION_ADDED` when they apply), ids and enum values only. `AuditEvent` stays AI-only (11 D-07, 12 D-11). Owner decision required |
| 8 | A snoozed ticket wakes at its date through a pg-boss job, under the row lock (SC3, AIDA-54) | VERIFIED | `snooze-wake` queue scheduled every minute (`src/lib/worker/index.ts:50-54`); `wakeDueTicket` takes `SELECT ... FOR UPDATE` with the organization predicate, then a conditional UPDATE re-checking `snoozedUntil <= now`, `WOKEN` only when a row changed (`src/lib/worker/jobs/snooze-wake.ts:36-73`). Tests: `snooze.test.ts` > "snoozes through the service and the job wakes it exactly once", "wakes a deadline equal to the job's now and not one a millisecond later"; `snooze-race.test.ts` > "Race B" and "Race B2" (re-snooze survives); E2E `snooze.spec.ts` > "the wake job brings a ticket whose deadline passed back to the inbox" |
| 9 | A customer reply on either inbound path wakes the ticket, automatic mail does not (SC3, AIDA-54) | VERIFIED | `reopenOnCustomerReply` clears `snoozedUntil` under the row lock and writes `WOKEN` (SYSTEM) only on a real change (`reopen-on-reply.ts:206-252`), called from `follow-up/route.ts:101` and `ingest-message.ts` after `resolveReplyTicket`. Tests: `snooze.test.ts` > "a follow-up and an inbound email wake with WOKEN before = the deadline; automatic mail does not", "a follow-up through a merged source's token wakes the snoozed target"; `snooze-race.test.ts` > "Race A" |
| 10 | Auto-close skips snoozed tickets, in both its candidate query and its final conditional UPDATE (SC3, AIDA-54) | VERIFIED | `"snoozedUntil" IS NULL` at `src/lib/worker/jobs/auto-close.ts:82` and `:226`. Tests: `snooze.test.ts` > "auto-close skips a snoozed RESOLVED ticket past its quiet period, and closes it after a wake"; `snooze-race.test.ts` > "Race C: a snooze of a quiet RESOLVED ticket holds the lock; auto-close waits and closes nothing" |
| 11 | The inbox has a snoozed filter; default views hide snoozed tickets; stored saved views stay version 1 (AIDA-54, D-16) | VERIFIED | `snoozed: z.literal(true).optional()` (`list-filters.ts`), `where.snoozedUntil` in `list-query.ts`; Snoozed toggle in `filter-chip-row.tsx:97-329`. Tests: `snooze-filters.test.ts` (5 cases); `snooze.test.ts` > "default views hide snoozed tickets; snoozed true shows only them, combined with other filters"; E2E `snooze.spec.ts` > "the toggle shows only snoozed tickets and saves as a view that reopens with it on", "a stored view without the snoozed field still opens unchanged" |
| 12 | The activity feed of merges, snoozes, relations, state changes and assignments renders in order (AIDA-55) | VERIFIED | `buildActivityFeed` orders by `(createdAt, kind, id)` with plain code-unit id comparison (`src/lib/tickets/activity-feed.ts:19-54`); every `TicketAuditAction` has a copy row (`activity-copy.ts`); rendered by `ActivityFeed` on the ticket page (`tickets/[id]/page.tsx:153`). Tests: unit `activity-feed.test.ts` > "orders by time, puts messages before events on a tie, then orders by id", "has a copy row for every TicketAuditAction value of the generated enum", "renders merges both ways, snooze with a time token and both wake rows"; E2E `activity-feed.spec.ts` (2 cases). Merge and assignment rows have no E2E case of their own; their copy is unit-tested |
| 13 | The feed is org-scoped and agent-only; nothing from the feed or the merge target reaches a public route | VERIFIED | Feed audit rows read through `scopedDb` after `findActiveMembership` (`ticket-detail-data.ts:114-159`); names only from the organization's roster (`:184-189`). A grep of `src/app/(public)`, `src/app/api/public` and `src/components/public` for the feed, relations, merge target or `TicketAuditEvent` finds nothing; the public page loads only `loadStatusPageData`, whose header fields are always the token's own ticket (`status-page-data.ts:109-119`). Tests: integration `activity-feed.test.ts` > "excludes another organization's audit row that carries the same ticketId"; `merge-provenance.test.ts` > "the loader for a merged source carries merged true and only the source's own header fields" |
| 14 | Every new or rewritten server path checks active membership first and refuses a removed member; organization A never reads, links, merges, snoozes or wakes B's tickets (D-01, D-20) | VERIFIED | `findActiveMembership` first in `addRelation`, `removeRelation`, `listRelationsForTicket`, `mergeTickets`, `snoozeTicket`, `wakeTicket`, `searchTicketsForPicker`, `loadTicketDetailData`, `runTicketMutation`, and in the messages route both before any read and inside the transaction (`messages/route.ts:36, 114`). Tests: `ticket-picker.test.ts` > "refuses MEMBERSHIP_ENDED without searching ..." and the route's 403 case; `ticket-relations.test.ts` > MEMBERSHIP_ENDED for add and remove; `ticket-merge.test.ts` > both MEMBERSHIP_ENDED cases and the D2 block ("an existing id", "a missing id", "an invalid body"); `snooze.test.ts` > "refuses another organization's ticket, an unknown id, an ended membership and NOT_SNOOZED"; `activity-feed.test.ts` > "refuses a removed member viewing the page"; `lifecycle-schema.test.ts` > "scopedDb(orgB) never changes or reads A's merge, snooze and provenance columns" |
| 15 | Every message insert on an existing ticket happens under that ticket's row lock | VERIFIED | All four insert sites on existing tickets take the lock through `lockTicketsInIdOrder` before writing: agent messages route (`lockTicketForAgentWrite`, `messages/route.ts:119-123`), status follow-up and email ingest (`resolveReplyTicket` before `message.create`), demo seed (`insertDemoReplies`, `seed-demo-data.ts:209-239`). The only other insert, `create-ticket.ts`, writes the first message of a new ticket in the same transaction. Tests: `ticket-merge.test.ts` > "forced order: a reply observed blocked by a held merge is refused after the merge commits", demo seed "(a)" and "(b)"; `merge-race-coverage.test.ts` > "1a" and "1b"; `merge-reply-race.test.ts` Races 1 to 4 |
| 16 | A merged source cannot be reopened, re-merged, snoozed or written to | VERIFIED | Re-merge: `SOURCE_MERGED`, `TARGET_MERGED`, `SOURCE_HAS_MERGES` (`merge.ts:192-198`). Reopen: `runTicketMutation` refuses any status change with `MERGED_SOURCE` from the locked rows (`mutations.ts` step 5); customer replies are redirected to the target (`resolveReplyTicket`); the demo seed refuses (`lockDemoTicket`). Snooze: `MERGED_SOURCE` (`snooze.ts:115`). Agent reply: 409 `MERGED_SOURCE`. New links: `TICKET_UNAVAILABLE` (K34, `relations.ts:223-225`). Tests: `ticket-mutations.test.ts` > the four "a merged source keeps its status" cases, including the forced order; `ticket-merge.test.ts` > "SOURCE_MERGED for a source that is already merged", "re-running the same merge returns SOURCE_MERGED and changes nothing", "refuses a public reply and an internal note with 409 MERGED_SOURCE"; `snooze.test.ts` > "refuses CLOSED, a CLOSED merged source (MERGED_SOURCE first) ..."; `ticket-relations.test.ts` > "TICKET_UNAVAILABLE when either ticket is a merged source (run decision K34)" |

**Score:** 15/16 truths verified (0 present but behavior-unverified; 1 open owner question, 12-o1).

The 14 backstop truths of UI-SPEC E1 to E11 and the plans 12-06, 12-07 and 12-08 (`verification: backstop`) are non-inferable. They are not counted above and are routed to human verification (`insufficient_spec`).

### Deferred Items

None. No gap of this phase is moved to a later phase. The open owner item 12-o1 is not a deferral.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/migrations/20261109100000_ticket_lifecycle/migration.sql` | Relation table, merge, snooze and `seq` columns, six audit actions, hand-written guards | VERIFIED | Pair key, self-link CHECK, one-parent index and `Ticket_merge_fields_check` present; no generated DROP of the search columns or GIN indexes; `lifecycle-schema.test.ts` > "Phase 12 keeps earlier hand-written objects" (4 cases) |
| `src/lib/tickets/relations.ts` | Add, remove, list relations | VERIFIED | Wired through `relation-actions.ts` and `ticket-detail-data.ts` |
| `src/lib/tickets/merge.ts` | Merge service and lock helper | VERIFIED | Wired through `merge-actions.ts`; `lockTicketsInIdOrder` used by relations, snooze, reply resolution, the messages route and the demo seed |
| `src/lib/tickets/status-visibility.ts`, `status-page-data.ts` | One provenance predicate for page and attachments | VERIFIED | Imported by the public page and the attachment route only |
| `src/lib/tickets/snooze.ts`, `src/lib/worker/jobs/snooze-wake.ts` | Snooze, manual wake, wake job | VERIFIED | Wired through `snooze-actions.ts` and `worker/index.ts` |
| `src/lib/tickets/activity-feed.ts`, `activity-copy.ts`, `ticket-detail-data.ts` | Ordered, org-scoped feed | VERIFIED | Rendered by `src/components/tickets/activity-feed.tsx` on the ticket page |
| `src/lib/tickets/ticket-picker.ts`, `src/app/api/tickets/picker/route.ts` | Membership-checked picker | VERIFIED | Used by `ticket-picker.tsx` in both dialogs |
| UI components (`linked-tickets-row.tsx`, `link-ticket-dialog.tsx`, `merge-ticket-dialog.tsx`, `merged-source-banner.tsx`, `snooze-control.tsx`, `ticket-actions-menu.tsx`, `activity-feed.tsx`, `activity-event-row.tsx`, `local-date-time.tsx`) | The Phase 12 surfaces | VERIFIED (code and E2E); visual pass open | Imported by `ticket-meta-header.tsx` and `tickets/[id]/page.tsx` |
| `README.md` Features row | User-facing note on links, merge, snooze and their limits (D-21) | VERIFIED | Names no merge chains, one parent per child, what stays on the source, the different-customer refusal |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Merge dialog | `mergeTickets` | `mergeTicketAction(source, target, reviewedLinkLabel)` | WIRED | Server re-checks every rule under the locks |
| Public status page and attachment route | `statusMessageWhere` / `isMessageVisibleForToken` | `loadStatusPageData`, `loadStatusAttachment` | WIRED | One snapshot per request |
| Follow-up route, email ingest | Merge target | `resolveReplyTicket` under the row lock, then `reopenOnCustomerReply` | WIRED | Redirect, reopen and wake on the effective ticket |
| Worker | `snoozeWakeHandler` | `boss.schedule("snooze-wake", "* * * * *")` | WIRED | `src/lib/worker/index.ts:50-54` |
| Inbox list | `snoozedUntil` filter | `parseUrlFilters` to `fetchTicketList` | WIRED | Default hides, `snoozed=1` shows only snoozed |
| Ticket page | Feed | `loadTicketDetailData` to `ActivityFeed` | WIRED | Agent-only |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Public status page | `ticket.messages` | `tx.message.findMany({ where: statusMessageWhere(ticket) })` | Yes | FLOWING |
| Activity feed | `feed`, `feedReferences` | `scopedDb` reads of messages, `ticketAuditEvent`, tickets, tags; organization member roster | Yes | FLOWING |
| Linked tickets row | `relations` | `listRelationsForTicket` via `scopedDb` | Yes | FLOWING |
| Inbox Snoozed toggle | list rows | `fetchTicketList` with `where.snoozedUntil` | Yes | FLOWING |

### Behavioral Spot-Checks

Run by this verifier at `4f1a777`, one test process at a time, `pgrep -f 'artisan test'` empty before each, Testcontainers with the Colima Docker environment. No compose stack, no container handled by hand (Testcontainers removed its own throwaway containers; `docker ps -a` afterwards showed none left). `pnpm test:egress` and `tests/integration/egress-isolation.test.ts` were not run.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Labels, provenance predicate, feed order, copy table, snoozed grammar | `pnpm vitest run tests/unit/lifecycle-helpers.test.ts tests/unit/activity-feed.test.ts tests/unit/snooze-filters.test.ts` | exit 0, 3 files, 40 tests passed | PASS |
| Per-link provenance, snooze races, feed scope, status mutations on a merged source | `pnpm vitest run --config vitest.integration.config.ts` with `merge-provenance`, `snooze-race`, `activity-feed`, `ticket-mutations` | exit 0, 4 files, 48 tests passed | PASS |
| Merge service, reply races, snooze, relations, schema and isolation, race coverage, picker, read snapshot | same config with `ticket-merge`, `merge-reply-race`, `snooze`, `ticket-relations`, `lifecycle-schema`, `merge-race-coverage`, `ticket-picker`, `status-read-snapshot` | exit 0, 8 files, 136 tests passed | PASS |

E2E, lint, typecheck, build and the full unit and integration runs were not repeated here. Their result of record is the final gate on `db55e8d` in `12-GATE.md` (same code as `4f1a777`): lint 0, typecheck 0, unit 276 passed, integration without the egress file 307 passed, E2E 165 passed, 1 skipped (existing), 0 failed, 0 flaky, build 0. One E2E flake (the snooze tooltip case, `snooze.spec.ts:106`) was observed once on `d427c56` and did not recur in the two later full runs; it stays listed as an observed flake.

### Probe Execution

No probe is declared by the plans or summaries, and no `scripts/*/tests/probe-*.sh` exists. Step skipped.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| AIDA-52 | Links `duplicate_of`, `related_to`, `child_of`; unique per pair, org-scoped, both sides | SATISFIED | Truths 1, 2 |
| AIDA-53 | Merge: messages and attachments move, source closes as duplicate, confirmation, full `AuditEvent`, no hard delete, per-link visibility across page, attachments, follow-up and CSAT, different contacts refused | SATISFIED except one clause | Truths 3 to 6 and 16 are verified. The clause "a full `AuditEvent` is written" is open owner item 12-o1 (truth 7). "Tested with two contacts" is met by the K33 path the requirement itself allows: a merge of two contacts is refused (tested), and two status links of the same contact are tested across all four surfaces |
| AIDA-54 | Snooze until a date or the next customer reply; pg-boss job and inbound replies wake; snoozed filter; auto-close skips | SATISFIED | Truths 8 to 11. "Until a date or the next customer reply" is read as every snooze has a date and a customer reply ends it earlier (D-12) |
| AIDA-55 | Unified feed of merges, snoozes, relations, state changes and assignments; in order; org-scoped | SATISFIED | Truths 12, 13 |

No orphaned requirement: `REQUIREMENTS.md` maps exactly AIDA-52 to AIDA-55 to Phase 12, and every plan's `requirements` field stays within them.

### Prohibitions (ADR-550)

| Plan | Statement | Tier | Disposition |
|------|-----------|------|-------------|
| 12-01 | MUST NOT let one status token's predicate return PUBLIC messages the holder could not see before the merge, other than messages created on the target after the merge; INTERNAL never | judgment | Non-authoritative verifier judgement: holds (`status-visibility.ts:56-84`; `merge-provenance.test.ts`, `lifecycle-schema.test.ts` > "statusMessageWhere returns exactly what isMessageVisibleForToken accepts, for S and T"). Flagged: unverified-prohibition, human review recommended |
| 12-04 | MUST NOT show on any status link a message or attachment its holder could not see before the merge, other than messages created on the target after it | judgment | Non-authoritative verifier judgement: holds (`status-page-data.ts`, attachment route; `merge-provenance.test.ts`, `merge-race-coverage.test.ts` 1a to 2a, `status-read-snapshot.test.ts`). Flagged: unverified-prohibition, human review recommended |

### Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` marker and no `TODO`, `HACK` or `PLACEHOLDER` in any `src` file changed by the phase (grep exit 1). No stub or hollow data path found.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/tickets/merge.ts` | 232-252 | Hard delete of a replaced `TicketRelation` row | Info | Within D-08 discretion; audited with `RELATION_REMOVED` on both tickets; no ticket, message or attachment is deleted |
| `src/app/(public)/status/[token]/page.tsx` | 29 | Branding read from the first organization | Info | Predates Phase 12 (review IN-05); recorded in `deferred-items.md` |
| `src/components/tickets/ticket-meta-header.tsx` | 315 | `border-border` where DESIGN-SYSTEM asks `border-border/70` | Info | Predates Phase 12 (v1); not changed by this phase; recorded in `12-GATE.md` open item 14 |
| Older pages and actions | n/a | No active-membership check outside the Phase 11 and 12 paths | Info | AIDA-43 stays open (D-01, owner item O-3); not in this phase's scope |

### Blocked and Baseline (recorded, not passed)

- Blocked by owner item O-1: `pnpm test:integration` as-is (with the egress file) and `pnpm test:egress`. Not run; not passed.
- Baseline, unchanged: `pnpm audit --prod` exit 1 with 7 critical and 52 high; the Windows-only `taskkill` teardown message in E2E; one skipped existing E2E case (`uat-gaps.spec.ts:17`).

### Human Verification Required

None of these has happened. No visual, accessibility, UAT or human result is recorded here.

### 1. Visual approval of the new surfaces

**Test:** Review each Phase 12 surface (UI-SPEC E1 to E11) in the running app.
**Expected:** Matches `12-UI-SPEC.md` and `DESIGN-SYSTEM.md`.
**Why human:** Visual judgement; no visual pass is claimed.

### 2. Dark-mode review

**Test:** Repeat item 1 in dark mode (DESIGN-SYSTEM section 7).
**Expected:** Correct tokens and readable contrast.
**Why human:** `a11y-contrast.spec.ts` covers none of the Phase 12 surfaces.

### 3. Screen-reader and accessibility backstop

**Test:** With a screen reader, use the actions menu, the picker's disabled reasons, the merge confirmation, the snooze popover (and the disabled trigger's reason) and the feed list.
**Expected:** Each is announced with its name, state and reason.
**Why human:** Not provable by grep or the existing tests.

### 4. Layout backstop truths

**Test:** Check the eleven long-text and overflow statements of UI-SPEC E1, E2, E3, E4, E5, E7, E8, E9, E10 (two) and E11 at the stated widths.
**Expected:** Each statement holds as written.
**Why human:** Non-inferable (`verification: backstop`); no test measures them.

### 5. Time-zone backstop

**Test:** In a browser set to Asia/Jakarta, snooze for Tomorrow 09:00.
**Expected:** Stored as 02:00 UTC; shown as 09:00 in chip, popover and feed; the zone line names Asia/Jakarta.
**Why human:** The E2E zone block proves viewer-zone display for another zone, not this exact statement.

### 6. Deferred copy decisions

**Test:** Decide (a) the reopen markers under a CLOSED header on a merged source's public page (IN-06) and (b) a merged marker on list rows (R2-3).
**Expected:** A recorded copy and layout decision.
**Why human:** Copy and layout decisions left for the visual pass.

### 7. Judgment-tier prohibitions of 12-01 and 12-04

**Test:** Confirm the verifier's non-authoritative judgement that no status link shows anything its holder could not see before the merge, other than later target messages.
**Expected:** Confirmed.
**Why human:** Judgment-tier prohibitions are never passed silently.

### Owner question (not a gap, not met)

- **12-o1:** AIDA-53 "a full `AuditEvent` is written" and ROADMAP criterion 2 "leaves a full audit event". The merge audit is in `TicketAuditEvent`. Changing the requirement text, or another resolution compatible with 11 D-07, is the owner's call.

### Gaps Summary

No gap found. Every success criterion and every AIDA-52 to AIDA-55 clause maps to code at `4f1a777` and to named tests, and this verifier ran the Phase 12 unit and integration files green (184 integration and 40 unit tests). The things that matter most in this phase hold in the code: per-link provenance by `seq`, attachments under the same predicate, follow-up and CSAT after a merge, membership checks on every new path, row locks on every message insert, no reopen or re-merge of a merged source, wake under lock, auto-close skipping snoozed tickets, and nothing from the feed or the target on a public route. The phase is not `passed` because of the human items above, the open owner question 12-o1, and the suites blocked by O-1.

---

_Verified: 2026-11-08T18:27:21Z_
_Verifier: Claude (gsd-verifier)_
