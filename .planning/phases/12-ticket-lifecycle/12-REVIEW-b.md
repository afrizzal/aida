---
phase: 12-ticket-lifecycle
reviewed: 2026-11-08T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/lib/tickets/status-visibility.ts
  - src/lib/tickets/status-page-data.ts
  - src/app/(public)/status/[token]/page.tsx
  - src/app/api/public/status/[token]/attachments/[id]/route.ts
  - src/app/api/public/status/[token]/follow-up/route.ts
  - src/app/api/tickets/[id]/messages/route.ts
  - src/app/api/tickets/picker/route.ts
  - src/lib/tickets/ticket-picker.ts
  - src/lib/channels/email/ingest-message.ts
  - src/lib/demo/seed-demo-data.ts
  - src/lib/tickets/activity-feed.ts
  - src/lib/tickets/ticket-detail-data.ts
  - src/lib/tickets/list-filters.ts
  - src/lib/tickets/list-query.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 12: Code Review Report (part b, server side)

**Reviewed:** 2026-11-08
**Depth:** standard
**Files Reviewed:** 14 (server side of `git diff 6d5d8e4..HEAD -- src prisma`, after the 9 in `12-REVIEW.md`)
**Status:** issues_found

## Summary

This part continues `12-REVIEW.md`. UI components are covered by another reviewer. IDs continue from WR-02 / IN-03.

Coverage note: the status, attachment, follow-up, messages and picker routes, `status-visibility.ts`, `status-page-data.ts` and `ticket-picker.ts` were read in full or in their relevant ranges. Only the diff hunks and lock/insert sites of `ingest-message.ts` and `seed-demo-data.ts` were read. `activity-feed.ts`, `ticket-detail-data.ts`, `list-filters.ts` and `list-query.ts` were checked for scoping and raw SQL only. `activity-copy.ts` and `staged-files.ts` were NOT reviewed (a grep found no raw SQL or prisma calls in `staged-files.ts`).

Verified with no finding:
- **Per-link provenance.** `statusMessageWhere` and `isMessageVisibleForToken` (`status-visibility.ts:56-84`) apply the same rule. A merged source sees PUBLIC rows on its target only when `mergedFromTicketId = self`, or when `mergedFromTicketId IS NULL AND seq > mergeMessageSeq`. Another source's moved messages and the target's pre-merge messages stay hidden. No timestamp is compared. The page loader (`status-page-data.ts:63-80`) and the attachment route (`route.ts:28-41`) both use this module. `Attachment.messageId` is non-null (schema:436), so the route cannot dereference a null message. Merge chains are refused (`merge.ts:174-180`), so one marker is enough.
- **Row lock on every existing-ticket insert.** Messages route: `lockTicketForAgentWrite` before `message.create` (`route.ts:102-106`). Follow-up: `resolveReplyTicket` then `reopenOnCustomerReply` before the insert (`follow-up/route.ts:97-118`). Email ingest: `resolveReplyTicket` inside the transaction before the insert (`ingest-message.ts:191-207`). Demo seed: `lockDemoTicket` before every reply insert (`seed-demo-data.ts:217-223`). The seed's lock is its own SQL, not the shared helper (WR-05).
- **Picker.** `findActiveMembership` comes first (`ticket-picker.ts:77-78`). The current ticket and its candidates are read with `organizationId`. A ticket number above INT4 is short-circuited (`:96`). Responses are `no-store`.
- **Raw SQL scoping.** No new raw SQL in these files lacks an `organizationId` term. The feed's audit rows go through `scopedDb`, and `TicketAuditEvent` is in the scoped model list (`scoped-db.ts:33`).

## Warnings

### WR-03: The agent messages route never checks the member row

**File:** `src/app/api/tickets/[id]/messages/route.ts:21-27,100-104`
**Issue:** Every other Phase 12 write path (merge, relations, snooze, picker, detail loader) calls `findActiveMembership` first. The messages route trusts `getScopedDb()`, and `session.ts` says that helper does not check membership. A user removed from the organization whose session still carries `activeOrganizationId` can therefore post replies and internal notes. A PUBLIC reply is queued for email to the customer (`shouldQueue`). Phase 12 rewrote this transaction (AIDA-53) without adding the check.
**Fix:** Inside the transaction, before `lockTicketForAgentWrite`:
```ts
if (!(await findActiveMembership(tx, session.user.id, orgId))) {
  return { ok: false as const, error: "MEMBERSHIP_ENDED" as const };
}
```
Then map `MEMBERSHIP_ENDED` to a 403 after the transaction, next to the `MERGED_SOURCE` branch, and discard the staged files there as well.

### WR-04: `firstRespondedAt` is decided from a read taken before the row lock

**File:** `src/app/api/tickets/[id]/messages/route.ts:31,134-139`
**Issue:** `ticket.firstRespondedAt` comes from `db.ticket.findFirst` at :31, outside the transaction. Now that the insert runs under the row lock, two concurrent first public replies serialize on the lock. Both still saw `firstRespondedAt = null`, though, so the second overwrites the first stamp with a later time and re-clears `isAtRisk`/`isBreached`. That corrupts the first-response SLA metric.
**Fix:** Make the write conditional under the lock:
```ts
await tx.ticket.updateMany({
  where: { id: ticketId, organizationId: orgId, firstRespondedAt: null },
  data: { firstRespondedAt: new Date(), isAtRisk: false, isBreached: false },
});
```
Alternatively, have `lockTicketsInIdOrder` return `firstRespondedAt` and use that value.

### WR-05: The demo seed's lock is a third private copy of the ticket `FOR UPDATE`

**File:** `src/lib/demo/seed-demo-data.ts:192-205` (comment claim at `src/lib/tickets/status-visibility.ts:16-20`)
**Issue:** The provenance invariant ("every Message insert on an existing ticket holds that ticket's row lock") is enforced in four places with three different statements: `lockTicketsInIdOrder` (merge, reply, agent write), `lockPair`/`lockTicket` (WR-02), and `lockDemoTicket`. A grep for the shared helper reaches the seed only through the `status-visibility.ts` comment, which is why the orchestrator's 12-03 grep matched a comment. The seed's lock is correct today (single row, same `organizationId` predicate, refuses merged). But a future change to the shared helper, such as a lock-order or extra-column change, will not reach it, and no grep can prove the invariant.
**Fix:** Replace the body of `lockDemoTicket` with:
```ts
const [row] = await lockTicketsInIdOrder(tx, orgId, [ticketId]);
if (!row || row.mergedIntoTicketId !== null) throw new DemoSeedTicketMergedError(ticketId);
```
Alternatively, call `lockTicketForAgentWrite` and throw on `!ok`. The invariant is then greppable through one symbol.

## Info

### IN-04: Email ingest throws a bare `Error` when the matched ticket can no longer take the reply

**File:** `src/lib/channels/email/ingest-message.ts:194-195`
**Issue:** If `resolveReplyTicket` returns not-ok, ingest throws `new Error("matched ticket is no longer available")`. The inbound mail is then handled like any unknown failure (retried or dropped by the poller). It does not fall back to creating a ticket, and no typed error lets the caller tell this case apart.
**Fix:** Throw a typed error, as `ReplyTicketChangedError` already is, or retry the whole ingest so it falls through to the `createTicket` branch.

### IN-05: The status page brands with the first organization, not the token's organization

**File:** `src/app/(public)/status/[token]/page.tsx:29-34`
**Issue:** This existed before Phase 12, but the page now has the token's ticket in hand. `prisma.organization.findFirst()` picks an arbitrary organization, so on a multi-org install a customer sees another tenant's workspace name. `loadStatusPageData` does not return `organizationId`.
**Fix:** Return `organizationId` from `loadStatusPageData` and look up the branding setting with it.

### IN-06: A merged source's page can show "reopened" events under a CLOSED header

**File:** `src/lib/tickets/status-page-data.ts:72,86`
**Issue:** The header status is the source's own status (closed by the merge). The thread includes the target's post-merge messages with their `triggeredReopen` markers, so the page can show "ticket reopened" rows while the header says closed. The provenance is correct, but the page may confuse a customer.
**Fix:** Have the UI owner decide whether to keep `triggeredReopen` for rows where `ticket.merged`, or to label them as events on the combined ticket. Record the decision in UI-SPEC Surface 7.

---

_Reviewed: 2026-11-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (part b; activity-copy.ts and staged-files.ts not reviewed)_
