---
phase: 12-ticket-lifecycle
reviewed: 2026-11-09T00:00:00Z
depth: deep
files_reviewed: 2
files_reviewed_list:
  - src/lib/worker/jobs/email-outbound-send.ts
  - tests/integration/email-outbound-merge.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 12: Code Review Report (fix pass F6, commit 0c98bef, R3-1 / K38)

**Reviewed:** 2026-11-09
**Depth:** deep (call chain traced through `compose-outbound.ts`, `merge.ts`, `thread-match.ts`, `ingest-message.ts`, `scoped-db.ts`, `status-visibility.ts`)
**Files Reviewed:** 2
**Status:** issues_found

## Summary

The new history clause `(ticketId = origin AND mergedFromTicketId IS NULL) OR mergedFromTicketId = origin` (`email-outbound-send.ts:91-102`) returns the right rows for every case the merge rules allow:

- **Never-merged ticket X:** the first term gives X's own messages. The second term is empty, because only a merge source is ever named in `mergedFromTicketId` (`merge.ts:255-258`).
- **Source S, reply written on S:** before the merge the first term gives S's messages. After it, the first term is empty and the second gives the same rows. Whether the message is read before or after the merge, origin is S.
- **Target T:** the first term gives T's own messages, and anything moved in carries `mergedFromTicketId = S` and is excluded. The second term is empty, because T can never become a source (`SOURCE_HAS_MERGES`, `merge.ts:194-198`) and S can never become a target (`TARGET_MERGED`). A target with several sources stays correct for the same reason.
- **Organization scoping:** `scopedDb` adds `organizationId` at the top level of `where` (`scoped-db.ts:91-93`), next to the `OR` and combined with it by AND, so the OR cannot leak outside the organization.

The tests can fail against the K37 clause: (c), (d) and (e) would all go red. Test (c) is stricter than before, not looser. Timing is deterministic through `nextTime()`, and each test seeds its own organization. No BLOCKER was found.

The two warnings are about what happens after a merge once mail keeps arriving. Customer mail sent in the source's old thread lands on the target as a normal target message, so K38 now builds a References header that points at a parent while leaving out that parent's ancestors (WR-01). The history query also has no "prior to this reply" bound, so the retry invariant this commit claims only holds when nothing new arrives between attempts. A post-merge source-thread inbound breaks it (WR-02).

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: After a post-merge inbound in the source's old thread, a target reply's References drops the parent's ancestors (regression from K37), and the "known edge" is neither tested nor tracked

**File:** `src/lib/worker/jobs/email-outbound-send.ts:29-31, 91-105`; `src/lib/channels/email/ingest-message.ts:108, 200-226`
**Issue:**
1. After S is merged into T, the customer replies in S's old email thread, and the References of that reply hold S's ids.
2. Ingest matches on a header. `findTicketIdByEmailMessageIds` (`thread-match.ts:53-57`) finds a moved S message, now `ticketId = T`.
3. The message is created on T with `mergedFromTicketId = null` (`ingest-message.ts:212-226`).
4. Under K38 the next agent reply on T has three parts that do not fit together:
   - In-Reply-To is that customer message (the last INBOUND on T, `:104-105`).
   - References is T's own ids plus that one id. All of the parent's own ancestors (S1..Sn) are dropped, because they carry `mergedFromTicketId = S`.
   - Subject is `Re: {T subject} [#T]`.

RFC 5322 §3.6.4 builds References from the parent's References plus the parent's Message-ID. The header now names a parent while leaving out that parent's chain and mixing in a second thread. Clients that thread by References (Thunderbird, Apple Mail) and those that also need a matching subject (Gmail) will place this reply differently.

K37 included S's ids, so the chain was complete. This commit makes this case worse. The comment at `:24-25` ("a reply on the target threads on the target's own messages only") is also not true once such an inbound exists. The edge is documented only in a code comment (`:29-31`). No test pins it, and `deferred-items.md` does not list it.

**Fix:** When choosing In-Reply-To, also take the parent's stored chain. Ingest already saves `emailReferences` and `emailInReplyTo` (`ingest-message.ts:221-223`):
```ts
const priorMessages = await db.message.findMany({
  where: { /* K38 clause */ },
  orderBy: [{ createdAt: "asc" }, { seq: "asc" }],
  select: { emailMessageId: true, direction: true, emailReferences: true },
});
const lastInbound = [...priorMessages].reverse().find((m) => m.direction === "INBOUND");
const own = priorMessages.map((m) => m.emailMessageId).filter((id): id is string => !!id);
// Parent chain first (RFC 5322 §3.6.4), then the ticket's own ids, de-duplicated, order kept.
const references = [...new Set([...(lastInbound?.emailReferences ?? []), ...own])];
```
At minimum, add an integration test that pins the current behaviour:
1. Merge.
2. Ingest a customer reply whose References hold S ids.
3. Send a T reply and assert its In-Reply-To and References.

Record the edge in `deferred-items.md` with a decision ID so it is not lost.

### WR-02: The history has no "prior to this reply" bound, so the retry invariant claimed by K38 and test (e) breaks when any message lands between attempts, a post-merge source-thread inbound included

**File:** `src/lib/worker/jobs/email-outbound-send.ts:88-102`; `tests/integration/email-outbound-merge.test.ts:265-301`
**Issue:** The comments say "every prior email-bearing message" (`:88`) and claim "a send that read the history before a merge gets the same thread as a retry that reads it after" (`:26-28`). The commit message says "a retry after a merge gets the same headers as the failed send before it".

The query has no bound on `seq` or `createdAt` relative to the reply. Any email-bearing message that lands on the origin between the failed attempt and the retry enters the retry's References, and it becomes In-Reply-To if it is inbound. That covers the case in WR-01, a customer reply in S's old thread that lands on T after the merge. In that case the merge itself is what changes the retry's headers for a target reply.

The reply can also end up In-Reply-To a customer message the agent never saw when writing it, or reference a later outbound reply. Test (e) passes only because nothing arrives between the two attempts. The gap predates this commit, but K38 now presents the retry invariant as a property of the rule.

**Fix:** Bound the history by the reply's own sequence number. Every insert draws `seq` under the ticket row lock, and a merge keeps `seq` (`schema.prisma:348`, `merge.ts:254`):
```ts
where: {
  OR: [
    { ticketId: originTicketId, mergedFromTicketId: null },
    { mergedFromTicketId: originTicketId },
  ],
  seq: { lt: message.seq },
  emailMessageId: { not: null },
},
```
This also makes `id: { not: message.id }` redundant. Extend test (e): ingest or seed an email-bearing INBOUND on T between the failed attempt and the retry, then assert that the retry's References and In-Reply-To still equal the first attempt's.

## Info

### IN-01: Test gaps in the K38 suite: no Message-ID reuse check, no source-side retry across a merge, no target with two sources

**File:** `tests/integration/email-outbound-merge.test.ts:19-24, 265-301`
**Issue:**
- `SentMail` leaves out `messageId`, so test (e) cannot show that the retry reused the Message-ID saved on the first attempt (`email-outbound-send.ts:83-86`). The commit claims "the same headers".
- Retry across a merge is tested only for a reply written on T. A reply written on S whose first send fails before the merge is not tested. That path switches both the origin source (`ticketId` to `mergedFromTicketId`) and the history term (first to second).
- A target that received two merges (S1 and S2) is not covered.

**Fix:**
- Add `messageId?: string` to `SentMail` and assert `retry.messageId === first.messageId` and `!retry.references?.includes(retry.messageId)`.
- Add an "(f)" case: reply on S, failed send, merge, retry, with identical headers.
- Optionally add a two-source target case that asserts only T's own ids.

### IN-02: History order uses `createdAt` only, so ties are not deterministic

**File:** `src/lib/worker/jobs/email-outbound-send.ts:100`
**Issue:** A merge keeps `createdAt` (`merge.ts:254`), and `status-visibility.ts:12-14` itself notes that "timestamps can tie". With equal `createdAt`, both the References order and the last INBOUND chosen for In-Reply-To can differ between runs, and so between a failed attempt and its retry. The tests avoid this through `nextTime()`, so they cannot detect it. The issue predates this commit.
**Fix:** `orderBy: [{ createdAt: "asc" }, { seq: "asc" }]`.

### IN-03: Two definitions of a merged source's conversation

**File:** `src/lib/worker/jobs/email-outbound-send.ts:20-28`; `src/lib/tickets/status-visibility.ts:6-8, 61-68`
**Issue:** S's status token shows S's moved messages plus T's PUBLIC messages with `mergedFromTicketId = null` and `seq > mergeMessageSeq`. In other words, the conversation continues on T after the merge. The outbound thread for origin S stops at the merge.

Take a QUEUED reply written on S and sent after the customer's post-merge reply (which landed on T). It goes out In-Reply-To an older S inbound, not the customer's latest message, while the status page for S shows that latest message as part of the same conversation. The window is small, because no new replies can be written on S (`MERGED_SOURCE`), but it is a divergence between modules that the K38 text does not mention.
**Fix:** Document the difference next to K38. If the outbound rule should follow the status page for a source origin, add `{ ticketId: S.mergedIntoTicketId, mergedFromTicketId: null, seq: { gt: S.mergeMessageSeq, lt: message.seq } }` to the history when origin is a merged source.

### IN-04: Stale describe title and an unwrapped header comment line

**File:** `tests/integration/email-outbound-merge.test.ts:4, 150`
**Issue:** The `describe` title still says "(R2-2, K37)", but three of the five cases now assert K38. Header line 4 was not re-wrapped and runs to about 150 characters, while the rest of the block wraps at 100.
**Fix:** Retitle it to "(R2-2 K37, R3-1 K38)" and re-wrap line 4.

---

_Reviewed: 2026-11-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
