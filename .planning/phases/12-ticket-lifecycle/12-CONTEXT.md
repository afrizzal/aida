# Phase 12: Ticket Lifecycle - Context

**Gathered:** 2026-11-08, by hand under `run-loop/PIAGAM.md` (not `/gsd-discuss-phase`)
**Status:** Ready for UI design contract, then planning
**Sources:** facts checked against the code at `b25797d`; Codex brainstorm in `run-loop/codex/fase12-tanya.md` and `fase12-jawab.md` (areas 2, 3, 4 and 8). Every Codex claim used below was re-checked in the code unless marked *unverified*.

<domain>
## Phase Boundary

Tickets model duplicates and waiting: typed links between tickets, safe merges, snooze, and one activity feed per ticket. Requirements AIDA-52 (relations), AIDA-53 (merge), AIDA-54 (snooze) and AIDA-55 (activity feed) in `.planning/REQUIREMENTS.md`; ROADMAP Phase 12 success criteria 1 to 3. No feature beyond those requirements. AI stays out of this phase: nothing here calls `lib/llm/`.

The original Phase 12 was split by run-loop decision K32 (`run-loop/RUN-LOG.md`, ROADMAP Phase 12 → Split), with no scope removed: custom states and SLA pause (AIDA-56, AIDA-97, AIDA-57) are Phase 12.1, and KB proposals (AIDA-18) are Phase 12.2. Neither is planned here.

Phases 8, 9 and 10 are **parked**. Their code does not exist: there is no CSP, no notification model, and `getScopedDb` (`src/lib/session.ts:38-43`) does not check membership. The only membership helper is Phase 11's `findActiveMembership` (`src/lib/membership.ts:28`). AIDA-43 stays open. Phase 12 adds no inline script and sends no notifications.

Both Cross-phase risk checks for this phase pass at `b25797d`: `SavedView` exists in `prisma/schema.prisma`, and the auto-close job is registered (`src/lib/worker/index.ts:42-45`). So the auto-close part of AIDA-54 is in scope here.

</domain>

<decisions>
## Implementation Decisions

Format: decision, then source. "Codex agreed" means the Codex brainstorm recommended the same thing. "Orchestrator" means the run-loop orchestrator fixed the decision before this file was written (`run-loop/RUN-LOG.md`, the entry after K33).

### Inherited gaps and status

- **D-01:** Every new Phase 12 server path checks the actor's active membership with `findActiveMembership(client, userId, orgId)` (`src/lib/membership.ts:28`) before it reads or writes ticket data: the relation actions, the merge action, the snooze and wake actions, the feed loader and any ticket picker endpoint the relations panel or merge dialog uses. A test proves each new path refuses a session whose member row was deleted. `getScopedDb` is not changed for the whole app (Phase 11 D-01, parked Phase 10 C6). The SUMMARY records that older pages and actions still lack the check and that AIDA-43 stays open. Source: 11 D-01; Codex area 8.
- **D-02:** Status stays the `TicketStatus` enum (`prisma/schema.prisma:181-187`) in this phase. Phase 12.1 migrates every reader of status to the state table, including the readers this phase adds: the merge service (closes the source), the auto-close snooze condition, the reply-path wake, the snooze filter in the inbox, and the public status page and CSAT route changes for merged tickets. The SUMMARY lists these new readers by file so Phase 12.1 can find them. Source: K32; ROADMAP Phase 12.1 (depends on Phase 12, "the state migration must cover snooze and merge").

### Relations (AIDA-52)

AIDA-52 accept: "links are unique per pair, org-scoped, and shown from both sides."

- **D-03:** Model `TicketRelation`: `id`, `organizationId`, `type` (`DUPLICATE_OF`, `RELATED_TO` or `CHILD_OF`), `fromTicketId`, `toTicketId`, `createdById`, `createdAt`. It is added to `DOMAIN_MODELS` in `src/lib/scoped-db.ts:14`. One relation per unordered pair: a unique index on `("organizationId", LEAST("fromTicketId", "toTicketId"), GREATEST("fromTicketId", "toTicketId"))`, written by hand in the migration because Prisma cannot express it. So `A related B` and `B related A` cannot both exist, and a pair cannot carry two types at once. A `CHECK` rejects a self-link (`fromTicketId <> toTicketId`). Source: orchestrator; Codex area 3.
- **D-04:** Adding and removing a relation run in one transaction each: both tickets are read inside the transaction and must belong to the actor's organization, or the action is refused. Each side shows the relation with its own label: `DUPLICATE_OF` shows as "duplicate of" on the `from` ticket and "has duplicate" on the `to` ticket, `CHILD_OF` as "child of" and "parent of", `RELATED_TO` as "related to" on both. Adding writes a `RELATION_ADDED` `TicketAuditEvent` row on both tickets; removing writes `RELATION_REMOVED` on both. Audit rows hold ids and enum values only. Source: orchestrator; AIDA-52; Codex area 3.
- **D-05:** `CHILD_OF` is directional (`from` is the child, `to` the parent). A child has at most one parent, and the hierarchy has no cycles. A plain pre-check can pass under parallel writes (Codex area 3), so every `CHILD_OF` insert is serialised per organization with a transaction-scoped advisory lock (`pg_advisory_xact_lock` keyed on the organization) taken first in the transaction; then, inside the same transaction, the service checks that the child has no parent yet and walks the ancestors of the proposed parent, refusing if the child is among them. A Testcontainers test runs two inserts that would form a cycle (A child of B, B child of A) on two connections and proves one is refused. "One parent per child" is a technical choice to keep the hierarchy explainable, recorded here; it is not a scope cut of AIDA-52, which does not mention multiple parents. Source: orchestrator; Codex area 3 (Codex flagged the one-parent limit as its own design choice).
- **D-06:** The `DUPLICATE_OF` relation that a merge creates (D-08) cannot be removed: the remove action refuses it when the `from` ticket's `mergedIntoTicketId` equals the `to` ticket. Other relations on a merged ticket stay removable. Source: orchestrator; Codex area 3.

### Merge (AIDA-53)

AIDA-53 accept: "messages and attachments move; the source closes as a duplicate; confirmation is required; a full `AuditEvent` is written; no hard delete. Each status link keeps working but shows only what its holder could see before the merge plus replies addressed to that holder, tested with two contacts across the status page, attachments, follow-up and CSAT. If that rule cannot be met, merging tickets of different contacts is refused."

- **D-07:** Run-loop decision K33 takes the conservative option: refuse merging tickets of different contacts **and** keep per-link provenance (D-09). The server refuses, after locking both ticket rows in id order (`SELECT … FOR UPDATE`), when the two tickets have different `contactId`. It also refuses a self-merge, a ticket of another organization, a source that is already merged, a target that is merged, and a source that has itself received merges. The last two rules mean no merge chains in this phase; this is a documented limitation (user-facing docs and SUMMARY), not a hidden one. The UI asks for confirmation in a dialog that names both tickets and says the merge cannot be undone; the dialog is a convenience, and the server enforces every rule. Source: K33; orchestrator; Codex area 2.
- **D-08:** One transaction: lock both tickets in id order and run the D-07 checks; move the source's messages to the target (`Message.ticketId` = target) and set the new `Message.mergedFromTicketId` to the source on each moved message; attachments move with their message because `Attachment` belongs to `messageId` only (`prisma/schema.prisma:419-433`); set the new `Ticket.mergedIntoTicketId` and `Ticket.mergedAt` on the source; close the source (`CLOSED`); create the `DUPLICATE_OF` relation from source to target; write `MERGED_INTO` on the source and `MERGED_FROM` on the target in `TicketAuditEvent`, ids only. Nothing is hard-deleted. The source's tags, assignee and custom field values stay on the source; this is documented in the user-facing docs and the SUMMARY. Any failure rolls back the whole merge, proved with a test seam as in 11 D-09. Source: orchestrator; Codex area 2; SEED-003 Notes (no hard delete).
- **D-09:** Per-link provenance on the public side. Today the status page loads every `PUBLIC` message of the token's ticket (`src/app/(public)/status/[token]/page.tsx:38-47`) and the attachment route checks only the ticket and `PUBLIC` (`src/app/api/public/status/[token]/attachments/[id]/route.ts:25-26`), so a blind redirect would widen access. After a merge:
  - The **source's** status token keeps working. It shows only the `PUBLIC` messages with `mergedFromTicketId` = source, plus `PUBLIC` messages created on the target after the source's `mergedAt`.
  - The **target's** status token shows only the target's `PUBLIC` messages with `mergedFromTicketId` null.
  - Attachments follow their message's visibility under the same rule for each token.
  - A follow-up through either token posts to the target. The redirect is decided inside the reply path's transaction after the ticket row lock, not from the read before it (the reasoning of 11 D-17), so a follow-up racing a merge still lands on the target with the right provenance. The reopen (11 D-17) and the wake (D-14) apply to the target.
  - CSAT stays one per ticket (`CsatResponse.ticketId` is unique, `prisma/schema.prisma:567-579`): the source's token reads and writes the source's CSAT (the source is `CLOSED`, so it is eligible under `src/app/api/public/status/[token]/csat/route.ts:24`), and the target's token the target's.
  - Inbound email matched to the source is routed to the target. Header matching follows the moved messages to the target by itself (`findTicketIdByEmailMessageIds`, `src/lib/channels/email/thread-match.ts:48`); the subject-number fallback (`findTicketByNumber`, `thread-match.ts:60`) finds the source, and `ingest-message.ts` then follows `mergedIntoTicketId`, under the row lock, to the target.
  - *Amended 2026-11-08 after Codex plan review cycle 1, C1:* "created on the target after the source's `mergedAt`" is decided by a message sequence, never by comparing `createdAt` with `mergedAt` (a transaction's default `createdAt` is fixed before it gets the row lock, and timestamps can tie). Every `Message` gets a monotonic `seq` that PostgreSQL draws when the row is inserted, and every insert on an existing ticket happens while the writer holds that ticket's row lock; the merge draws the source's `mergeMessageSeq` from the same sequence under both row locks. The source's token shows the target's `PUBLIC` messages with `mergedFromTicketId` null only when their `seq` is greater than the source's `mergeMessageSeq`. `mergedAt` stays as the displayed merge date. The one migration of D-19 also adds `Message.seq` and `Ticket.mergeMessageSeq`. What each token may see is unchanged.
  Source: K33; orchestrator; Codex area 2 ("do not redirect the source token blindly") and area 8.
- **D-10:** Tests (Testcontainers and E2E): two status tokens of the **same** contact with different histories, across the status page, attachments, follow-up and CSAT, each showing exactly what D-09 allows; the **refused** two-contact case, proving nothing changed; each other refusal in D-07; the rollback seam; and a forced-order test of a follow-up through the source token racing the merge. Source: AIDA-53; K33; Codex areas 2 and 8.
- **D-11:** The merge audit lives in `TicketAuditEvent`. `AuditEvent` stays AI-only and its AI columns are never filled with placeholders (11 D-07; `AuditEvent` requires `provider`, `model`, `input` and `output`). AIDA-53's literal wording "a full `AuditEvent` is written" is therefore **not claimed as met**; whether the requirement text changes or another resolution compatible with 11 D-07 is chosen is owner item 12-o1. The SUMMARY and VERIFICATION say so. Source: orchestrator; Codex area 2 (marked as an owner decision).

### Snooze (AIDA-54)

AIDA-54 accept: "a pg-boss job and the inbound reply paths both wake it; the inbox has a snoozed filter; auto-close skips snoozed tickets."

- **D-12:** A nullable `Ticket.snoozedUntil`, separate from status. It is stored in UTC and chosen in the viewer's local time; the control and its display say which time zone is meant. Null means not snoozed. AIDA-54's "until a date or the next customer reply" is read as: every snooze has a date, and the next customer reply ends it earlier (D-14), whichever comes first. A snooze action and a manual wake action each check membership (D-01) and write `SNOOZED` (with the deadline) or `WOKEN` (`actorType` `USER`). Source: orchestrator; Codex area 4.
- **D-13:** A pg-boss job runs every minute through `boss.schedule`, the same pattern as `heartbeat` (`src/lib/worker/index.ts:26-31`). It wakes due tickets with a conditional `UPDATE` that re-checks the deadline in the statement (`"snoozedUntil" IS NOT NULL AND "snoozedUntil" <= now`) and returns the row; the `WOKEN` audit row (`actorType` `SYSTEM`) is written in the same transaction only when a row changed. So a re-snooze to a later time that commits before the update is not undone, and a run after a worker restart picks up whatever is due. The job is idempotent. Source: orchestrator; Codex area 4.
- **D-14:** Both customer-reply paths (`src/lib/channels/email/ingest-message.ts` and `src/app/api/public/status/[token]/follow-up/route.ts`) wake the ticket inside the same locked transaction as the 11 D-17 reopen (`reopenOnCustomerReply`, `src/lib/tickets/reopen-on-reply.ts:47-67`, which takes the row lock at `:54-58`): a conditional update clears `snoozedUntil` and writes `WOKEN` (`SYSTEM`) only when it changed a row. Automatic mail does not wake, just as it does not reopen (`reopen-on-reply.ts:51`). Source: orchestrator; Codex area 4.
- **D-15:** Auto-close skips snoozed tickets: `"snoozedUntil" IS NULL` is added to both its candidate query (`src/lib/worker/jobs/auto-close.ts:218-226`) and its final conditional `UPDATE` (`auto-close.ts:73-82`), so a snooze that commits between the two is respected. Source: orchestrator; Codex area 4 ("on the final update, not only when picking candidates"); ROADMAP success criterion 3.
- **D-16:** The default inbox views (`all`, `unassigned`, `mine`) hide snoozed tickets. An optional `snoozed` field (true = show only snoozed tickets) joins the one filter grammar in `src/lib/tickets/list-filters.ts:28-42`, used by the URL parser, the list query (`src/lib/tickets/list-query.ts:55-98`) and saved views. Stored saved views keep `version: 1` (`list-filters.ts:48`): the field is optional, and absent means the default, so every stored view parses unchanged. Source: orchestrator; AIDA-54; 11 D-03.
- **D-17:** Forced-order Testcontainers tests, two connections, one holding the ticket row lock while the other runs: a customer reply against the wake job; a re-snooze against the wake job (the later deadline survives); a snooze against auto-close (the ticket stays `RESOLVED`). Source: orchestrator; Codex area 4.

### Activity feed (AIDA-55)

AIDA-55 accept: "the feed renders in order and is org-scoped."

- **D-18:** On the ticket page, agents see one feed that merges `TicketAuditEvent` rows and messages (including internal notes), ordered by `(createdAt, kind, id)` so the order is stable when timestamps tie. It covers merges, snoozes and wakes, relations, status changes and assignments, because every one of them writes a `TicketAuditEvent` row. It is read through `scopedDb` after the membership check, in `loadTicketDetailData` (`src/lib/tickets/ticket-detail-data.ts:60-76`). Actor names are resolved only among users of the same organization. The feed is never shown on the public status page. Source: orchestrator; Codex area 3; SEED-003.

### Migration, security and tests

- **D-19:** One migration. It adds `TicketRelation`, `Ticket.snoozedUntil`, `Ticket.mergedIntoTicketId`, `Ticket.mergedAt` and `Message.mergedFromTicketId`, and adds the new actions `RELATION_ADDED`, `RELATION_REMOVED`, `MERGED_INTO`, `MERGED_FROM`, `SNOOZED` and `WOKEN` to `TicketAuditAction` (`prisma/schema.prisma:595-602`). It is made with `prisma migrate dev --create-only`, edited by hand (the D-03 pair index and self-link `CHECK`), and applied as in 11 D-21. It keeps every hand-written object of earlier migrations: the generated `searchVector` columns and their GIN indexes (`20260701234808_ticket_search`), the `aida_audit_event_immutable` trigger (`20260707053633_ai_foundation`, lines 48-57), and the `SavedView` partial unique name indexes, `SavedView_name_length_check`, `TicketAuditEvent_actor_check` and the `aida_ticket_audit_event_immutable` trigger (`20261108140000_inbox`, lines 77-106). Any `DROP` Prisma generates for them is deleted by hand. Source: orchestrator; 11 D-21; charter → Test dan bukti.
- **D-20:** Unmocked Testcontainers isolation tests: organization A never reads, links, merges, snoozes or wakes B's tickets; `TicketRelation` rows of A are invisible to B through `scopedDb`; the new columns are never read or changed across organizations; the audit trigger still rejects `UPDATE` and `DELETE` on the new actions. Source: orchestrator; charter → Aturan teknis AIDA; 11 D-22.
- **D-21:** No new egress, no inline script, no AI call. Audit rows hold ids, enum values and timestamps only, never ticket text. Docs: a short user-facing note on relations, merge (its refusals, no chains, what stays on the source) and snooze, in an existing doc if one fits. Source: charter → Aturan teknis AIDA; 11 D-20.
- **D-22:** E2E tests state observed outcomes: links shown from both sides; a merge after confirmation, with the source closed, the thread on the target, and each status link showing only what D-09 allows; a refused merge of two contacts; snooze hiding a ticket from the default view and the `snoozed` filter showing it; a wake by invoking the job against a fixture whose deadline lies in the past; the feed's order. No test runs a compose stack. The full `pnpm test:integration` and `pnpm test:egress` are recorded as "blocked (O-1)"; the rest of the integration suite runs with the egress file (`tests/integration/egress-isolation.test.ts`) excluded by an explicit, recorded command. Source: lessons from Phases 8 to 11; 11 D-23.

### Plan shape

- **D-23:** Few plans, at most three tasks each. Waves: wave 1, the migration and helpers (relation pair and label helper, provenance predicate, audit actions) with isolation tests; wave 2, the relations service, the merge service with provenance (status page, attachments, follow-up, CSAT, inbound email), and the snooze service with the wake job and the reply-path and auto-close changes, each with its race tests; wave 3, the UI (relations panel, merge dialog, snooze control and filter, feed); wave 4, E2E, the phase gate (D-22) and the §9 design checklist. The planner may split further and never drops scope. Source: orchestrator.

### Claude's Discretion

- Exact wording of the relation labels in D-04 and of the merge dialog.
- What a merge does when the pair already has a relation (replace it with `DUPLICATE_OF` inside the merge transaction, with audit rows, or refuse the merge); the choice is recorded in the plan and tested.
- Whether the source's close is also written as a `STATUS_CHANGED` row and whether the merge's `DUPLICATE_OF` also writes `RELATION_ADDED` rows, in addition to `MERGED_INTO` and `MERGED_FROM`.
- Whether `CHILD_OF` also gets a partial unique index on the child as a second guard beside D-05.
- Which tickets may be snoozed (for example a merged source or a closed ticket), the snooze presets, and the upper bound on a deadline; recorded and tested.
- Whether snooze and wake are new operations of `runTicketMutation` (`src/lib/tickets/mutations.ts:228`) or a separate service.
- The wake job's batch size per run, and an index for it.
- The status chip and a short "merged" notice on the source's public page, provided they reveal nothing D-09 does not allow.
- The feed's visual layout and paging, and how a former member's name is shown.

</decisions>

<specifics>
## Specific Ideas

- Relation chips sit in or next to `ticket-meta-header.tsx`, as SEED-003 suggests; adding a relation picks a ticket by number or search through an endpoint that checks membership (D-01).
- One helper builds the visible-message predicate for a token (D-09) and is used by the status page, the attachment route and their tests, so the two cannot drift.
- Moved messages on the target show a small "from #N" marker in the agent feed.
- The merge dialog reuses `src/components/ui/dialog.tsx`; the snooze control reuses `popover.tsx` and `input.tsx` (there is no calendar component in `src/components/ui/` today).

</specifics>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` AIDA-52 to AIDA-55 (and AIDA-56, AIDA-97, AIDA-57 in Phase 12.1, which build on them); `.planning/ROADMAP.md` Phase 12, 12.1 and 12.2, and Cross-phase risks; `.planning/seeds/SEED-003-ticket-relations-merge-snooze.md`
- `.planning/run-loop/PIAGAM.md`; `.planning/run-loop/RUN-LOG.md` (K32, K33); `.planning/run-loop/codex/fase12-tanya.md`, `fase12-jawab.md`
- `.planning/phases/11-inbox/11-CONTEXT.md` (D-01, D-03, D-07, D-17, D-21, D-22, D-23 bind here)
- `.planning/DESIGN-SYSTEM.md` (tokens, empty state, §9 checklist); `.planning/research/plane-inspiration.md` §4 row 3 (behaviour only)

</canonical_refs>

<code_context>
## Existing Code Insights

- Schema: `Ticket` (`prisma/schema.prisma:258-295`), `Message` (`:321-346`), `Attachment` (`:419-433`), `CsatResponse` (`:567-579`), `TicketAuditAction` (`:595-602`), `TicketAuditEvent` (`:633`). No relation, merge or snooze field exists, and nothing in `src` uses an advisory lock today.
- Org scoping: `DOMAIN_MODELS` in `src/lib/scoped-db.ts:14`; ticket page loader `src/lib/tickets/ticket-detail-data.ts:60-76` (membership, then `scopedDb`); messages ordered by `createdAt` at `:26-28`; the AI `AuditEvent` rows for `AiActivitySection` at `:49`. The feed's sources are `TicketAuditEvent` and `Message`; `AuditEvent` stays in `AiActivitySection`.
- Ticket page: `src/app/(app)/tickets/[id]/page.tsx` (`ThreadMessage` at `:125`, `ThreadSystemEvent` at `:145`); `src/components/tickets/ticket-meta-header.tsx`.
- Mutations and audit: `runTicketMutation` in `src/lib/tickets/mutations.ts:228` (row lock in id order at `:251`); `recordTicketAudit` in `src/lib/tickets/ticket-audit.ts:62`.
- Reply paths: `reopenOnCustomerReply` (`src/lib/tickets/reopen-on-reply.ts:47-67`); email thread match and transaction in `src/lib/channels/email/ingest-message.ts:103-116` and `:186-200`; follow-up route `src/app/api/public/status/[token]/follow-up/route.ts` (token lookup `:23`, transaction `:88`, message written to `ticket.id` as `ticket.contactId` at `:99-102`).
- Public side: status page `src/app/(public)/status/[token]/page.tsx:38-47` (CSAT form shown at `:116`); attachments route `src/app/api/public/status/[token]/attachments/[id]/route.ts:16,25-26`; CSAT route `src/app/api/public/status/[token]/csat/route.ts:18,24,61-62`; token generation `src/lib/tickets/status-token.ts:7`.
- Inbox filters: `src/lib/tickets/list-filters.ts` (`filterShape` `:28-42`, `z.strictObject` at `:45`, stored `version: 1` at `:48`); `src/lib/tickets/list-query.ts:55-98`.
- Worker: `src/lib/worker/index.ts` (`heartbeat` every minute `:26-31`, `auto-close` daily `:42-45`); auto-close candidate query `src/lib/worker/jobs/auto-close.ts:218-226` and conditional `UPDATE` `:73-82`.
- PostgreSQL 16 allows `ALTER TYPE … ADD VALUE` inside the migration's transaction, but a new value cannot be used until that transaction commits, so the migration must not use the new audit actions.

</code_context>

<deferred>
## Deferred Ideas

- Merge chains and merging a ticket that has received merges (D-07).
- Merging tickets of different contacts (D-07; K33).
- Moving tags, assignee or custom field values from the source to the target (D-08).
- More than one parent per child (D-05).
- Bulk link, merge or snooze from the inbox bulk bar.
- Duplicate suggestions from Insight clusters (SEED-003 Why This Matters).
- Custom states and SLA pause: Phase 12.1. KB proposals: Phase 12.2.
- Notifications when a snoozed ticket wakes: Phase 10 (parked) owns notifications.

</deferred>

## Owner items (not decided here)

- **O-1:** The pending decision on how container tests may run on the shared Docker VM (LAPORAN section 3). This phase writes no compose-stack test; the charter-mandated suites that need it are recorded as blocked, never as passed.
- **12-o1:** AIDA-53 says "a full `AuditEvent` is written", but `AuditEvent` is AI-only (11 D-07). This phase writes the merge audit to `TicketAuditEvent` and does not claim the literal acceptance as met. Changing the requirement text, or another resolution compatible with 11 D-07, is the owner's call.
- **O-3:** Unparking Phases 8, 9 and 10. Until then the membership check exists only on Phase 11 and Phase 12 new paths (D-01), and AIDA-43 stays open.

## Human boundary

The charter's phase table lists no human item for Phase 12. Added here: visual and dark-mode approval of the relations panel, the merge dialog, the snooze control and filter, and the activity feed (no visual pass is claimed); and the owner items O-1, 12-o1 and O-3.

## Instruction for the planner

Do not create `checkpoint:human-verify` tasks. Write every human verification as a manual item in the plan and in the SUMMARY, and leave it open. Do not reduce scope: if a plan is too big, split it. Every executor dispatch includes the charter's "Aturan eksekutor" section.

Lessons from Phases 8 to 11, binding here:

- Few plans, few new mechanisms. Prefer what Testcontainers or unit tests can prove: row locks, conditional updates, unique constraints, one advisory lock and one transaction. Testcontainers needs the Colima socket environment that the orchestrator supplies.
- Race tests are bound to backend PIDs: the test proves the second connection is waiting on the lock (for example through `pg_locks` or `pg_stat_activity` for that PID) before it releases the first, never by a sleep.
- No test may run a real compose stack (O-1).
- E2E tests assert observed outcomes; every expectation matches the behaviour an earlier plan specifies.
- Acceptance criteria point at the file where the code actually lives, and never contradict the plan's own action.
- No edit after a review without a new review of that edit.
- One test process at a time; long commands write to a log, and exit codes are read without a pipe.

## Owner rules of 2026-11-08 (binding, summary)

- **D:** all code is written by Claude (Opus 5.5); Codex reviews only. GSD agents inherit the session model (`model_profile: inherit`); no `model` parameter on dispatch.
- **C:** `workflow.use_worktrees` is `false`; plans run in the main checkout. Temporary exports are deleted only by the round that made them.
- **F:** owner-only decisions (scope, licences, anything that changes `PROJECT.md` or `REQUIREMENTS.md`) are not chosen here; they are O-1, 12-o1 and O-3.
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

*Phase: 12-ticket-lifecycle*
*Context gathered: 2026-11-08*
