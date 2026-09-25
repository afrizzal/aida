---
phase: 12-ticket-lifecycle
reviewed: 2026-11-08T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - prisma/migrations/20261109100000_ticket_lifecycle/migration.sql
  - prisma/schema.prisma
  - src/lib/scoped-db.ts
  - src/lib/tickets/merge.ts
  - src/lib/tickets/relations.ts
  - src/lib/tickets/relation-pairs.ts
  - src/lib/tickets/snooze.ts
  - src/lib/tickets/reopen-on-reply.ts
  - src/lib/worker/jobs/snooze-wake.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: partial
---

# Phase 12: Code Review Report (PARTIAL)

**Reviewed:** 2026-11-08
**Depth:** standard
**Files Reviewed:** 9 of 47 in scope (`git diff 6d5d8e4..HEAD -- src prisma`)
**Status:** partial. The review stopped early because the reviewer's context ran out. It is NOT a clean bill for the phase.

## Coverage gap (read first)

Fully read: the migration, the schema diff, `scoped-db.ts`, and the services for merge, relations, snooze, reply resolution/reopen and the wake job. Also read: the three server actions (`merge-actions.ts`, `relation-actions.ts`, `snooze-actions.ts`), `membership.ts`, `session.ts` and the auto-close and worker diffs.

**NOT reviewed** (still open, highest priority first, matching focus areas 1 to 5 of the brief):
- `src/lib/tickets/status-visibility.ts`, `status-page-data.ts`, `src/app/(public)/status/[token]/page.tsx`, `src/app/api/public/status/[token]/attachments/[id]/route.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`: per-link provenance (`seq` > `mergeMessageSeq`) and attachment leakage. Not verified.
- `src/app/api/tickets/[id]/messages/route.ts`, `src/lib/channels/email/ingest-message.ts`, `src/lib/demo/seed-demo-data.ts`: whether every message insert holds the row lock, including the 12-03 demo-seed grep met only through a comment (orchestrator note). Not verified.
- `src/app/api/tickets/picker/route.ts`, `src/lib/tickets/ticket-picker.ts`, `activity-feed.ts`, `activity-copy.ts`, `ticket-detail-data.ts`, `list-filters.ts`, `list-query.ts`, `staged-files.ts`: membership and scoping. Not verified.
- All UI components (merge dialog, snooze control, feed, `local-date-time.tsx`, banner, picker): UI-SPEC copy, the UTC tooltip, token-only styling, no inline script. Not verified.
- E2E gaps for merge refusal and snooze error callouts: not checked.

## Narrative Findings (AI reviewer)

Verified against the code: the services I read have no Critical issue. Each one checks `findActiveMembership` as its first statement inside the transaction. Every raw SQL statement in them uses tagged templates with an explicit `organizationId` (except WR-01). Merge and reply resolution share `lockTicketsInIdOrder` (`merge.ts:116-130`, `reopen-on-reply.ts:138,156`). The wake job and auto-close re-check their condition in a conditional UPDATE (`snooze-wake.ts:46-53`, `auto-close.ts:82`).

## Warnings

### WR-01: Wake job locks and updates tickets without an organization predicate

**File:** `src/lib/worker/jobs/snooze-wake.ts:36-53`
**Issue:** `wakeDueTicket` runs `SELECT ... FOR UPDATE WHERE id = ${ticketId}` and `UPDATE "Ticket" ... WHERE id = ${ticketId}` with no `"organizationId"` term. It then writes the audit row under whatever `organizationId` the row returns. Because the id is a primary key, nothing leaks today. Still, this is the only new raw SQL on `Ticket` that ignores the AIDA rule of an explicit `organizationId` in raw SQL. The exported helper can also be called by other code with a ticket id it has not scoped.
**Fix:** Make the due query return `id, "organizationId"`, pass `orgId` into `wakeDueTicket`, and add `AND "organizationId" = ${orgId}` to both statements.

### WR-02: The relations service has its own lock statement, so the "one lock helper" contract is not enforced

**File:** `src/lib/tickets/relations.ts:114-129` (compare `src/lib/tickets/merge.ts:28-31,116-130`)
**Issue:** The comment in `merge.ts` says every writer that locks a ticket pair goes through `lockTicketsInIdOrder`. `addRelation` and `removeRelation` lock the same pair with a separate copy of the SQL (`lockPair`). `snooze.ts:84-98` does the same for a single row. The SQL is the same today (`ORDER BY id FOR UPDATE`), so there is no deadlock now. But the contract the merge/reply race proofs rely on can break silently if one copy changes, and a grep for the helper misses these writers.
**Fix:** Have `lockPair` call `lockTicketsInIdOrder(tx, orgId, [a, b])` and keep its `rows.length !== 2` refusal. Have `snooze.ts` `lockTicket` call the helper too, and select `status` and `snoozedUntil` from the returned row.

## Info

### IN-01: Links can be added to a merged source

**File:** `src/lib/tickets/relations.ts:218-228`
**Issue:** `addRelation` locks `mergedIntoTicketId` but never reads it, so new links can be attached to a closed, merged source. D-06 covers only removal, so this is not a decision violation. The merge-target UI may not expect it, though.
**Fix:** Decide and record the behaviour. If links should be refused, add `if (locked.get(id)?.mergedIntoTicketId) throw new RelationError("TICKET_UNAVAILABLE")` (or a new code).

### IN-02: Reopen takes a second row lock after resolveReplyTicket already holds it

**File:** `src/lib/tickets/reopen-on-reply.ts:194-198`
**Issue:** `reopenOnCustomerReply` runs its own `FOR UPDATE` on a row that `resolveReplyTicket` has already locked. This is harmless (re-entrant in one transaction), and it is the read the snooze deadline comes from. The comment at `:9` reads as if this is the first lock.
**Fix:** Update the comment, or take the deadline from the `LockedTicketRow` that `lockTicketsInIdOrder` already returns.

### IN-03: Unknown unique violations become ALREADY_LINKED

**File:** `src/lib/tickets/relations.ts:132-144,238-241`
**Issue:** `violatedIndex` returns `"unknown"` for any unique violation that names neither index, and the caller maps that to `ALREADY_LINKED`. That hides any future, unrelated unique error.
**Fix:** Map only `TicketRelation_pair_key` to `ALREADY_LINKED` and rethrow `"unknown"`.

---

_Reviewed: 2026-11-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (partial: 9 of 47 files)_

## Orchestrator dispositions (all three parts)

Parts: this file (a, 9 files), `12-REVIEW-b.md` (b, server, 14 files), `12-REVIEW-c.md` (c, UI, 17 files). Every warning below was checked against the code at `0e04fc6` and holds. Fixes run in three sequential fixer passes, each fix with a test seen failing before the fix where behaviour changes; assertions are never loosened. Each pass appends its section to `12-REVIEW-FIX.md`.

| ID | Part | Disposition | Pass |
|----|------|-------------|------|
| WR-01 | a | Fix: `organizationId` predicate in both wake statements | F1 |
| WR-02 | a | Fix: `lockPair` and snooze `lockTicket` call `lockTicketsInIdOrder` | F1 |
| IN-01 | a | Fix (run decision K34): adding a link is refused when either ticket is a merged source, with the existing `TICKET_UNAVAILABLE` refusal | F1 |
| IN-02 | a | Comment only: the reopen lock is a re-entrant second lock | F1 |
| IN-03 | a | Fix: only `TicketRelation_pair_key` maps to `ALREADY_LINKED`; other unique violations rethrow | F1 |
| WR-03 | b | Fix: messages route checks `findActiveMembership` inside the transaction; removed member gets 403 and staged files are discarded | F1 |
| WR-04 | b | Fix: `firstRespondedAt` written with a conditional update under the lock | F1 |
| WR-05 | b | Fix: `lockDemoTicket` calls `lockTicketsInIdOrder` | F1 |
| IN-04 | b | Fix: typed error for a matched ticket that can no longer take the reply | F1 |
| IN-05 | b | No change: status-page branding by first organization predates Phase 12 and follows the single-org v1 precedent; recorded in `deferred-items.md` | none |
| IN-06 | b | No change: whether reopen markers show on a merged source page is a copy decision for the visual pass; stays open | none |
| UI-WR-01 | c | Fix: hydration-safe snooze label | F2 |
| UI-WR-02 | c | Fix: feed tooltip in local time after mount | F2 |
| UI-WR-03 | c | Fix: Link and Merge dialogs return focus to the menu trigger | F2 |
| UI-WR-04 | c | Fix: focus after refusals, stable snooze trigger, focus after link removal | F2 |
| UI-IN-01, 03, 04, 05, 06 | c | Fix | F2 |
| UI-WR-05 | c | Fix: add the missing Copywriting rows to `12-UI-SPEC.md` (additive) and use them verbatim from one module | F3 |
| UI-WR-06 | c | Fix: picker returns the current link label; generic row when unknown | F3 |
| UI-WR-07 | c | Fix: Back keeps the visible choice; a rule refusal clears the target | F3 |
| UI-WR-08 | c | Fix: E2E for merge refusal and unknown, snooze refusal, unknown and validation, and link removal failure (F3); the `Asia/Jakarta` time-zone block is the seen-failing test of UI-WR-01 and UI-WR-02 (F2) | F2, F3 |
| UI-K34 | F1 report | Fix: follow-up of K34 in the UI. The link picker marks merged sources unavailable (reuse the row "Already merged into another ticket"), and "Link a ticket…" is disabled on a merged source with the reason "This ticket was already merged." (new UI-SPEC rows) | F3 |
| UI-IN-02 | c | Fix: exhaustive switch, dead branch removed | F3 |

## Codex critique of the phase diff (round 1)

Question `.planning/run-loop/codex/fase12-diff-tanya.md`, answer `fase12-diff-jawab.md` (export of `78c248b`; `model: gpt-6.1-terra`, `reasoning effort: xhigh`). Each claim was checked against the code before use.

| ID | Codex severity | Checked | Disposition | Pass |
|----|----------------|---------|-------------|------|
| D1 | HIGH | Holds: `runTicketMutation` (`src/lib/tickets/mutations.ts:228-275`) locks without reading `mergedIntoTicketId`, so a status change (single or bulk) can reopen a merged source; the header status control stays enabled | Fix: under the row lock, refuse a status change on a merged source (whole batch, nothing changed, new refusal code); disable the status control on a merged source with the reason "This ticket was already merged."; refusal copy as new additive UI-SPEC rows; tests for single, bulk, and a status change waiting on the lock while the merge commits | F4 |
| D2 | HIGH (run rates MEDIUM: an existence oracle on the former organization's ticket ids, no content) | Holds: the messages route reads the ticket (`:31-32`), email settings and staged files before the in-transaction membership check (`:104`) | Fix: check `findActiveMembership` right after the session, before any read or file handling; keep the in-transaction check; tests for an existing id, a missing id and an invalid body | F4 |
| D3 | MEDIUM | Holds in part: a QUEUED outbound reply moved by the merge is sent with the target's subject, number and thread headers (`email-outbound-send.ts:16-62`). The recipient is the same person, because merge refuses different contacts (`merge.ts:181`, K33) | No change (run decision K36): after a merge the conversation lives on the target, as inbound mail already does (D-09); the queued reply reaches the same contact, threaded as the target. Recorded in `deferred-items.md` for the visual and email pass | none |
| D4 | MEDIUM | Holds: the kept `target` object (`merge-ticket-dialog.tsx:127`) is not refreshed from new picker rows after Back, so `alreadyLinked`/`linkLabel` can be stale on the confirm step | Fix: refresh the kept choice from the latest picker row with the same id, and re-read that row when "Review merge" is pressed; the merge itself still replaces any link with an audited RELATION_REMOVED/RELATION_ADDED pair | F4 |
| D5 | MEDIUM | Holds: `loadStatusPageData` (`status-page-data.ts:45-80`) and the attachment route read the merge marker and the messages in separate statements; a merge committing between them gives an empty thread or a transient 404. No leak (the predicate only narrows) | Fix: read marker and rows in one REPEATABLE READ transaction in both paths; a test forces the merge commit between the two reads | F4 |
| D6 | LOW | Holds: `12-GATE.md` open item 11 still says the messages route relies on `getScopedDb` only | Fix: orchestrator corrects the item after F4 | orchestrator |

## Codex critique of the phase diff (round 2)

Question `fase12-diff-r2-tanya.md`, answer `fase12-diff-r2-jawab.md` (export of `2649830`; `model: gpt-6.1-terra`, `reasoning effort: xhigh`). No HIGH. Codex confirms D1, D2 and D5 closed in code and calls the phase fit for verification with two MEDIUM items visible. Each claim was checked against the code.

| ID | Codex severity | Checked | Disposition | Pass |
|----|----------------|---------|-------------|------|
| R2-1 | MEDIUM | Holds: `review()` in `merge-ticket-dialog.tsx:168-199` falls back to the old row when the re-read fails or the row is missing, and a link added after the re-read is still replaced by `merge.ts` without having been shown | Fix: the confirm step opens only after a successful re-read that still finds the row; otherwise a new callout asks to try again. The merge action sends the reviewed link (label from the source's side, or none) as a precondition, and `mergeTickets` refuses with a new `LINK_CHANGED` code under the row locks when the current link differs. New copy rows are additive | F5 |
| R2-2 | MEDIUM | Holds: the worker takes subject, number and thread history from the ticket it reads (`email-outbound-send.ts:16-62`); after a merge a reply written on the source goes out as a reply in the target's thread, and a send that read the message before the merge and the history after it gets the source subject with an empty history | Replaces K36 with run decision K37: an outbound reply keeps the email thread of the ticket it was written on. The worker derives its origin as `mergedFromTicketId ?? ticketId`, takes subject and number from that origin ticket, and reads the history as messages with `ticketId = origin OR mergedFromTicketId = origin`, which gives the same result before and after a merge. Tests with the fake transport for a merge between queue and send and for the in-flight order | F5 |
| R2-3 | LOW | Holds: a merged source can appear in assignee-based views as a plain CLOSED row (`list-query.ts:63`, `ticket-list-row.tsx:97`) | No change: views show closed tickets today and nothing reopens; a "merged" marker on list rows is a copy and layout decision for the visual pass. Recorded in `deferred-items.md` | none |
