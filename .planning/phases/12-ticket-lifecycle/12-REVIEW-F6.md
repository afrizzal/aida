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

## Follow-up: F7 (a58b3ed, 38afb4a, 6d842ba)

**Reviewed:** 2026-11-09 · **Scope:** `src/lib/worker/jobs/email-outbound-send.ts`, `tests/integration/email-outbound-merge.test.ts`, F7 section of `12-REVIEW-FIX.md` · **Counts:** critical 0, warning 1, info 3 · **Status:** issues_found

**What holds:**

- **WR-02 (`seq: { lt: message.seq }`, `email-outbound-send.ts:105`) is correct.**
  - `message.seq` comes from the full-row `findUnique`.
  - Every insert draws `seq` under its ticket's row lock, and a merge keeps it. So the bound is stable across attempts and across a merge, for a source origin and a target origin alike.
  - The bound also excludes the message itself, so dropping `id: { not }` is safe. A reply delivered but then marked FAILED cannot pull in a customer answer to itself, because that answer has a higher `seq`.
  - Manual "Retry" (`actions.ts:76-91`) re-enqueues the same row, so it gets the same headers.
- **The parent is always inside the bounded history.** `lastInbound` is chosen from the bounded rows, so it can never fall outside the bound.
- **Organization scoping is unchanged.** All reads still go through `scopedDb`.
- **The tests can fail.** Tests (e) and (f) fail against the code before their fixes, and no earlier assertion was loosened. Test (f) would also catch a wrong `createdAt` bound: the parent's `createdAt` is the wall clock, while the reply's is the synthetic 2026-11-01.

**What is wrong:** the WR-01 union is correct when the parent's chain and the thread do not share ids, which is the merge case. It is wrong in the ordinary case where they do (WR-03 below).

### Warnings

#### WR-03: For any thread longer than 10 messages, the WR-01 union puts References out of order, and the cap then drops newer ids

**File:** `src/lib/worker/jobs/email-outbound-send.ts:112-119` (with `ingest-message.ts:99-105`, `compose-outbound.ts:54`)
**Issue:**

- **Where it happens:**
  - The parent's `emailReferences` normally share ids with the ticket's own ids: a customer's References name the agent replies and the earlier messages of the same ticket.
  - Ingest keeps only the **last 10** of them. So once a thread has more than 10 email-bearing messages, the parent's chain is a middle slice of `ownIds`, not a prefix of it. The same happens whenever a mail client trims References; Outlook, for example, sends the root plus the last few.
  - `[...new Set([...parentRefs, ...ownIds])]` keeps first-seen order. That puts the slice first and the oldest own ids after it.
- **Example:** a never-merged ticket with own ids x1..x14, where the parent is x13 and its stored refs are x3..x12.
  - The union is `[x3..x12, x1, x2, x13, x14]`.
  - `composeMail` keeps the last 10: `[x7..x12, x1, x2, x13, x14]`.
  - Before F7 it was `x5..x14` in time order.
- **Why it breaks threading:** clients that thread by References (the JWZ algorithm: Thunderbird, mutt, Apple Mail) link each entry as the child of the one before it. The order above therefore claims "x1 is a reply to x12", which corrupts or contradicts the thread tree.
- **The comment and the fix note are both wrong for this case:**
  - The comment at `:116-118` says the own ids "survive the cap first (the newest ten when there are more)". In the example x5 and x6 are dropped while x1 and x2 are kept.
  - The F7 note says the order changes only when the customer's References "skip an earlier id". The ingest cap makes that true of every thread longer than 10.
- **No test covers it:** test (f) only covers a parent chain with no ids in common with the thread.

**Fix:** take only the part of the parent's chain that is not already in the ticket's own ids, and keep the own ids in time order:
```ts
const own = new Set(ownIds);
const parentChain = (lastInbound?.emailReferences ?? []).filter((id) => !own.has(id));
const references = [...new Set([...parentChain, ...ownIds])];
```
This keeps (f) green: s1..s3, then t1, t2 and the parent. For a never-merged ticket it gives exactly the pre-F7 list.

Add a test with a never-merged ticket:
1. Seed 13 email-bearing messages.
2. Ingest a customer reply whose References are the last 10 of them, the way ingest stores them.
3. Queue and send a reply.
4. Assert `references` equals the chronological last 10 of the thread's ids.

### Info

#### IN-05: The history is ordered by `createdAt`, but the bound uses `seq`, the order messages were actually written

**File:** `src/lib/worker/jobs/email-outbound-send.ts:108`; `tests/integration/email-outbound-merge.test.ts:115-130`
**Issue:**

- **In production:** `createdAt` defaults to the transaction start time, which is fixed before the row lock is taken (`status-visibility.ts:12-14`). So two inbounds that wait on the same ticket lock can sort by `createdAt` in the opposite order from `seq`. `lastInbound`, and with it In-Reply-To and the parent chain, is then not the latest message written. The `seq` tiebreak only fixes exact ties.
- **In the fixtures:** they already mix two clocks. `queuedReply` uses a synthetic `createdAt` (2026-11-01), while ingested replies get the wall clock. In (f), the reply's `createdAt` is earlier than its parent's even though its `seq` is higher.

**Fix:** use `orderBy: { seq: "asc" }`. `seq` is the order messages were written, a merge keeps it, and it is the same key the bound uses.

#### IN-06: Test (g) only fails without the fix if Postgres happens to return the rows in the wrong order

**File:** `tests/integration/email-outbound-merge.test.ts:393-431`
**Issue:**

- As the F7 note admits, (g) failed before the fix only because of the access path and the heap layout. The first two versions passed against the unfixed code.
- After the fix it cannot fail by mistake, because the order is total.
- As a guard against removing the tiebreak, it depends on Postgres's access path: a VACUUM that frees space, a plan change or a different page fill can return the tied rows in `seq` order anyway, and the regression goes unseen.

**Fix:** keep (g), and either label it "best-effort" in its title or add a check that does not depend on the plan, for example a unit test that spies on `findMany` and asserts its `orderBy` includes `seq`. If IN-05 is adopted (`seq` as the only key), a fixture where `createdAt` order and `seq` order disagree makes a reliable test.

#### IN-07: The parent chain carries up to 10 sender-supplied ids into the reply to the contact, not checked against the organization's messages

**File:** `src/lib/worker/jobs/email-outbound-send.ts:119`; `src/lib/channels/email/ingest-message.ts:192, 217`
**Issue:**

- Ingest assigns a header-matched mail to the ticket's contact whatever its `From:` says.
- So anyone who knows one Message-ID of the thread can now put up to 10 arbitrary ids into the References of the agent's next reply to the real contact. Before F7 it was one id, their own Message-ID.
- **No header injection:** nodemailer splits and brackets References.
- **No cross-organization data:** AIDA does not look these values up; they come from the sender, so no data it holds for another organization is exposed. They can, however, steer how the contact's mail client threads the reply.

**Fix (optional, folds into WR-03's filter):** keep only parent refs that are the Message-ID of a message in this organization. Use one `scopedDb` `findMany({ where: { emailMessageId: { in: parentRefs } }, select: { emailMessageId: true } })` and filter on the result. That keeps the merge case (the S ids are rows on T) and drops foreign and invented ids.

---

_Follow-up reviewed: 2026-11-09 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_

## Follow-up 2: F8 (b133dbb, f8ea0e3)

**Reviewed:** 2026-11-09 · **Scope:** `src/lib/worker/jobs/email-outbound-send.ts`, `tests/integration/email-outbound-merge.test.ts`, F8 section of `12-REVIEW-FIX.md`, stop rule K39 in `12-REVIEW.md` · **Counts:** critical 0, **warning 0**, info 3 · **Status:** issues_found (info only)

**K39:** this follow-up finds **no warning**. Nothing below is a warning, so the stop rule is not triggered.

**What holds:**

- **WR-03 is fixed.**
  - `parentRefs` drops every id already in the bounded own history (`:133`). For a ticket that was never merged, the stored chain (the last 10 the customer named) is a subset of the own ids, so `parentChain` is empty.
  - `references` is then exactly the own ids in `seq` order. This is the pre-F7 list, now in `seq` order instead of `createdAt` order, which is the intended F7-IN-05 change.
  - In the merge case the S ids are not own ids of T, so they stay in the parent's order, ahead of T's ids. Test (f) keeps `s1 s2 s3 t1 t2 parent`.
- **IN-07 is fixed.**
  - The existence check is a `scopedDb` `findMany` (`:137-142`), so `organizationId` is added to the query.
  - Test (i) seeds the "foreign" id as a real message in a second organization, so an unscoped check would keep it and the test would fail. The invented id covers the "no such message" side.
- **IN-05 is fixed.** `orderBy: { seq: "asc" }` (`:111`) uses the same key as the bound. Demo-seed messages, which are back-dated, carry no `emailMessageId` and never enter the history.
- **IN-06 is fixed.** Test (j) writes the lower-`seq` row with the later `createdAt` and asserts `seqs[0] < seqs[1]`. Ordering by `createdAt` therefore fails it whatever the query plan, on both References and In-Reply-To.
- **The new tests can fail.**
  - (h) fails on the F7 union, giving `x8..x13 x1 x2 x3 reply`.
  - (h) would also fail with only the organization filter, because x4..x13 are all known.
  - (i) fails without the organization filter, and with an unscoped one.
  - (j) fails on ordering by `createdAt`.
- **Nothing was weakened.** Cases (a) to (f) are unchanged, and (g) changed only its title.

### Info

#### IN-08: The parent-chain lookup has no `seq` bound, so retries are not always identical and a later message can be named

**File:** `src/lib/worker/jobs/email-outbound-send.ts:93-99, 137-142`
**Issue:**

- The own history is bounded by `seq < message.seq`, but the lookup that decides which parent ids are kept checks the whole organization as it is at send time.
- **Example:** the customer sends M1 and then M2, which references M1, and the poller ingests M2 first.
  - M2 becomes the parent.
  - On the first attempt M1 is unknown and dropped.
  - On a retry after M1 has been ingested, M1 is known and enters References. M1 is also a message written after the reply.
- The comment at `:93-99` says the bound is "the same on every attempt" and that the reply "never names a message the agent had not seen". In this narrow case both claims are false.
- The effect is one extra, RFC-correct References entry, so this is not a warning.

**Fix:** add the same bound to the lookup:
```ts
where: { emailMessageId: { in: parentRefs }, seq: { lt: message.seq } }
```
The merge case is unaffected, since the S ids have a lower `seq` than any post-merge reply. Alternatively, soften the comment.

#### IN-09: The organization-wide existence filter tells a sender which Message-IDs exist in the organization

**File:** `src/lib/worker/jobs/email-outbound-send.ts:137-142`
**Issue:**

- Only ids that exist as messages in this organization survive into References. A sender's References can name any ticket, of any contact.
- Whoever receives the agent's reply, which is the ticket's contact, therefore learns which of up to 10 supplied Message-IDs exist in this organization's helpdesk.
- This is weak:
  - It needs a human agent to reply.
  - The ids must already be known.
  - Ingest's header match already lets a sender who knows one id append to that id's ticket (`thread-match.ts:53-57`, `ingest-message.ts:192`), which reveals much more and predates this change.
- The F8 note already records that ids of other tickets in the same organization can reach References.

**Fix (optional):** narrow the lookup to the parent's ticket. Add `ticketId` to the history `select` and use `where: { emailMessageId: { in: parentRefs }, ticketId: lastInbound.ticketId, seq: { lt: message.seq } }`. After a merge the S ids are rows on T, the parent's ticket, so (f) and (i) keep passing. This also closes IN-08.

#### IN-10: Test header line 6 is over 100 characters again

**File:** `tests/integration/email-outbound-merge.test.ts:6`
**Issue:** The F8 edit put an unwrapped line back into the header (155 characters). This partly undoes F6-IN-04.
**Fix:** re-wrap the line at 100 characters.

---

_Follow-up 2 reviewed: 2026-11-09 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_
