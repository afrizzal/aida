---
phase: 10-team
part: c (notifications and digest)
reviewed: 2026-11-13T00:00:00Z
depth: standard
diff_range: bd02a39..HEAD
files_reviewed: 27
files_reviewed_list:
  - src/lib/notifications/types.ts
  - src/lib/notifications/emit.ts
  - src/lib/notifications/store.ts
  - src/lib/notifications/preferences.ts
  - src/lib/notifications/recipients.ts
  - src/lib/notifications/format.ts
  - src/lib/notifications/digest.ts
  - src/lib/notifications/digest-config.ts
  - src/lib/notifications/digest-sender.ts
  - src/lib/worker/index.ts
  - src/lib/worker/jobs/notification-digest.ts
  - src/lib/worker/jobs/sla-flag.ts
  - src/lib/tickets/mutations.ts
  - src/lib/tickets/status-page-data.ts
  - src/lib/channels/email/ingest-message.ts
  - src/lib/channels/email/smtp-client.ts
  - src/app/api/public/status/[token]/csat/route.ts
  - src/app/api/public/status/[token]/follow-up/route.ts
  - src/app/api/notifications/route.ts
  - src/app/(app)/notification-actions.ts
  - src/app/(app)/settings/notifications/page.tsx
  - src/app/(app)/settings/notifications/actions.ts
  - src/app/(app)/settings/notifications/notification-preferences-form.tsx
  - src/components/notification-bell.tsx
  - src/components/top-bar.tsx
  - src/components/empty-state.tsx
  - docs/OPERATIONS.md
coverage_note: "The nine files under src/lib/notifications, the digest job, the bell route and actions, the settings page, actions and form, and the bell were read in full. The other files were read as their diff against bd02a39, plus the surrounding code where a change needed context: the reply branch of ingest-message.ts, the transaction of the follow-up route, the full sla-flag.ts, and the header and the assign path of mutations.ts. The helpers the new code calls were read at the call site: getScopedDb and requireSession (session.ts), findConservativeMembership, shareLockActiveMembership and decidingRow (membership.ts), readMemberRights and countOwners (member-rights.ts), lockOrganization (org-lock.ts), getAppBaseUrl (app-url.ts), scopedDb and its injected operations, the pool size in db.ts, and the Notification, NotificationPreference, NotificationSetting and NotificationDigest models with their foreign keys. In node_modules, these were read for the job path and the owned socket: pg-boss 12.23.0 (QUEUE_DEFAULTS, the singleton index, #processJobs with resolveWithinSeconds) and nodemailer (the getSocket handoff in smtp-transport, options.connection and _upgradeConnection in smtp-connection). Tests were read for their case lists only: notifications-core, notification-emitters, notification-digest, sla-flag-handler, digest-config and notifications-bell.spec. A search covered tests/ for any import of the bell route, the bell actions or notificationDigestHandler. The binding context was 10-CONTEXT D-14 to D-25, Update 2026-11-13 V-09, V-10, V-15, V-25, V-28, V-29, V-30 and O-7, R10-1, the 10-04, 10-09 and 10-11 SUMMARYs, and the AIDA-44 and AIDA-46 rows of 10-GATE. Nothing was run: no tests, build, Docker or pnpm script."
findings:
  critical: 0
  warning: 5
  info: 8
  total: 13
status: issues_found
---

# Phase 10: Code Review Report (part c: notifications, the digest and their producers)

**Reviewed:** 2026-11-13
**Depth:** standard (see coverage note)
**Files Reviewed:** 27
**Status:** issues_found

## Summary

I found no critical issue. These properties hold in the code as read:

**Tenant isolation and recipient privacy.**
- Every notification read and write outside a transaction goes through `store.ts`. It uses `scopedDb(orgId)` and also filters `recipientUserId`.
- Every function that runs inside a transaction writes the organization and the recipient explicitly, including the one raw claim, whose values are all bound parameters.
- `insertNotifications` takes `organizationId` from its parameter only, never from the item.
- `listDigestPairs` is the only cross-organization read, and it returns only the two ids.
- The bell route (`src/app/api/notifications/route.ts:46-57`) and the three actions (`src/app/(app)/notification-actions.ts:49-77`) take no id of a recipient or organization from the request. Both come from one `getScopedDb()` call: a fresh session read, then the conservative member read of exactly that `activeOrganizationId`.
- An id that belongs to another member or another organization goes into an `updateMany` filtered by the caller's recipient and organization, so it changes nothing. By reading the code, a member cannot see or change another member's notifications. What is missing is a test at the route and action level (c-WR-03).

**Privacy of the digest.** The subject is the constant `DIGEST_EMAIL_SUBJECT`. The body reads only the ticket id and number (`digest.ts:261-274`), plus fixed labels and links built from `BETTER_AUTH_URL`. Notifications store ids only, never customer text.

**SLA transitions notify exactly the flipped rows.** Both UPDATEs now `RETURNING` the rows they changed. The emitter runs only over that returned set, in id order, each row under its own `organizationId`, inside the pass transaction (`sla-flag.ts:189-203`). A locked row that fails the re-check in the UPDATE is not returned and notifies nobody. A direct breach sets both flags, so the at-risk pass skips it. The flag is the identity of the transition, as V-30 says.

**Ticket-mutation lock order.** The step order of the Phase 12.1 header is unchanged:
1. the actor, as a plain read;
2. the references, before any ticket lock;
3. the ticket rows `FOR UPDATE` in id order;
4. apply and audit.

The only change is the strength of the assignee read in step 3. It was a plain `findActiveMembership` and is now `shareLockActiveMembership`, still before the ticket lock (V-25).

The new statements inside `applyOp` take no lock: a plain member read, a preference read, and a `createMany` whose foreign keys take `FOR KEY SHARE` on the `organization` and `user` rows. Deactivation, role change and accept hold the organization row `FOR NO KEY UPDATE`, which does not conflict with `FOR KEY SHARE`, and none of them locks a ticket or a user row. I found no new cycle.

The reply writers (email ingest, follow-up) and the SLA worker emit after their existing ticket lock, with plain reads only.

**Idempotency, lease and fence.**
- The unique key plus `skipDuplicates` makes a re-emitted event a no-op that does not abort the caller's transaction.
- The digest's claim is serialised per pair by an advisory transaction lock. Rows are claimed with `FOR UPDATE SKIP LOCKED`.
- Every status change is conditional on the digest's own id and `CLAIMED`.
- The lease check before connecting and the owned-socket deadline match V-29. The `getSocket` handoff keeps nodemailer's implicit TLS and STARTTLS: `options.connection` together with `secureConnection` goes to `_upgradeConnection`, and SNI still comes from `host`.

**Weak points:**
- The unassigned fallback follows one rule in the bell and another in the digest (c-WR-01).
- The SLA pass now does O(N) round trips inside one all-tenant transaction that has a 30-second timeout (c-WR-02).
- No test covers the bell route and actions with another member's ids (c-WR-03).
- The digest has never run through pg-boss, and its no-overlap claim is false for a run longer than the 15-minute job expiry (c-WR-04).
- The digest's failures are invisible to an operator, and a permanent SMTP rejection repeats on every run forever (c-WR-05).

## Warnings

### c-WR-01: Unassigned-fallback rows follow only the "Unassigned tickets" switch in the bell, but the digest also applies the per-type switches

**File:** `src/lib/notifications/emit.ts:130-149`; `src/lib/notifications/digest.ts:114-120`, `:171-174`, `:205-213`; `src/app/(app)/settings/notifications/notification-preferences-form.tsx:48-50`
**Issue:** `emitForTicket` writes fallback rows without consulting the per-type in-app switch. This is the flagged assumption of 10-04, pinned by the case "fallback rows follow only the unassigned switch, not the per-type in-app switch".

The digest then filters the same rows by type. `enabledDigestTypes` keeps a type only when `digest && inApp`. The claim passes only those types to `claimDigestCandidates`, and `recheck` drops a row whose type is not in the set, fallback or not.

Failure scenario:
1. An owner turns off "Customer replies on my tickets: in app", meaning their own tickets, and keeps "Unassigned tickets" on.
2. Customer replies on unassigned tickets keep appearing in the owner's bell.
3. They never reach the digest. Because they stay unread and undigested, they are skipped on every run.

The copy promises "Owners and admins get these, in the app and in the digest". V-28 says the fallback switch "governs in-app and digest alike". The integration tests cover each half, but not the two together.
**Fix:** Choose one rule and apply it on both sides. With the 10-04 reading (only the fallback switch), claim and re-check fallback rows independently of the type set:
```ts
// claimDigestCandidates: (type = ANY(types) AND NOT unassignedFallback) OR (unassignedFallback AND includeFallback)
const rows = rows.filter((row) =>
  row.unassignedFallback ? fallbackAllowed : enabled.has(row.type));
```
The alternative is to apply the per-type in-app switch in `emitForTicket` as well (the "one condition" that 10-04 names). Either way, add a case where the in-app switch of a type is off and the unassigned switch is on, and assert the bell and the digest together. If the right reading is unclear, put it to the owner next to O-7.

### c-WR-02: The SLA pass now does its notification fan-out inside one all-tenant transaction with a 30-second timeout and no batch limit

**File:** `src/lib/worker/jobs/sla-flag.ts:60`, `:89-105`, `:132-151`, `:180-206`
**Issue:** Before this phase, each pass was two statements: lock all candidates, update them. Now, for every flipped row, the pass calls `emitForTicket` sequentially, inside the same transaction.

For an assigned ticket that is 3 round trips: member read, preference read, insert. For an unassigned ticket it is also 3, but the member read covers every member of the organization, and the insert writes one row per owner and admin.

The lock SELECTs have no `LIMIT`, and the transaction spans all organizations under `timeout: 30_000`.

Failure scenario: one tenant causes several thousand tickets to cross a threshold in the same minute, for example after an import of open tickets with past due times, or after a long worker outage. The pass then exceeds 30 s and Prisma rolls it back. No flag and no notification is written for any organization, and the next run, a minute later, retries the same set and fails the same way. SLA flagging stops for every tenant until the backlog shrinks by other means.

A transient error in one emission does the same, once, to all tenants: for example a foreign-key violation on `recipientUserId` because a user was deleted between the member read and the insert.

The 10-04 timing (61 rows in 9.0 ms) measured one ticket, not many tickets. The threshold above is my estimate from the round-trip count, *unverified* by measurement.
**Fix:** Bound each pass and loop: add `LIMIT 500` to both lock SELECTs, and run the pass again while it locked a full batch. Each batch then commits its flags and notifications together. Alternatively, keep one transaction but emit in bulk: read the members, preferences and settings once per organization in the flipped set, and write one `createMany` per chunk. Add a case with many unassigned tickets flipping in one pass that asserts the pass commits within the timeout.

### c-WR-03: The bell route and the bell actions have no privacy test of their own

**File:** `src/app/api/notifications/route.ts:34-93`; `src/app/(app)/notification-actions.ts:47-82`
**Issue:** The AIDA-44 prohibition ("MUST NOT return or change another member's notifications") is proven at the store level only (`notifications-core.test.ts` "member Y cannot see, mark or archive member X's notification…", and the org-A/org-B cases).

The 10-11 SUMMARY records that the route- and action-level proof was "still `unverified` at test level" and "belongs to 10-13". No such test exists: nothing under `tests/` imports the route module or the three actions. The only matches are the membership inventory (a static check) and `team-deactivation.spec.ts`. `notifications-bell.spec.ts` drives each member's own bell only.

The code is correct as read (see Summary). But nothing pins the property where it can break: a later edit that reads a `recipientUserId` or `view=list&user=` from the request, or that reuses the route for an admin view, would keep every current test green.
**Fix:** Add one integration or unit test file that calls `GET` and the three actions with a mocked fresh session for member Y, holding:
- the id of member X's notification in the same organization;
- the id of a notification in another organization where Y is also a member.

Assert all of the following:
- `view=list` and `view=count` exclude X's row;
- `markNotificationReadAction`, `archiveNotificationAction` and `markAllNotificationsReadAction` leave X's `readAt` and `archivedAt` null;
- a caller with no member row gets 403 `membership_ended` from the route and `membership_ended` from the actions.

### c-WR-04: The digest has never run as a pg-boss job, and the "singleton, never overlaps" claim fails for a run longer than the job expiry

**File:** `src/lib/worker/index.ts:162-170`; `src/lib/worker/jobs/notification-digest.ts:1-22`
**Issue:** Every digest test calls `runDigests` directly. Nothing creates the queue, registers the worker, fires the schedule or calls `notificationDigestHandler`. So the AIDA-46 row "a pg-boss job batches unread notifications" is proven for the function, not for the job.

Reading pg-boss 12.23.0 shows one concrete gap. The queue takes the defaults `expire_seconds: 900` and `retry_limit: 2` (`node_modules/pg-boss/dist/plans.js:27-31`). `#processJobs` races the handler against `resolveWithinSeconds(…, maxExpiration, …)`, fails the job when the time runs out, and aborts `job.signal`. The handler ignores the signal and keeps running.

The singleton index (`job_i2`) covers only `state = 'active'`. The failed job's retry can therefore become active and start a second `runDigests` while the first is still sending.

A run can pass 15 minutes: sends are sequential, and each may take up to the 45 s deadline against a slow or trickling server, so about 20 slow recipients are enough. The per-pair advisory lock and the lease keep the overlap safe (second-run pairs report `held`). But the comments at `index.ts:162-165` and `notification-digest.ts:5-6` ("a slow run never overlaps the next one") are wrong, and a slow run is restarted up to twice.
**Fix:**
- Create the queue with explicit options: `{ policy: "singleton", retryLimit: 0, expireInSeconds: 3 * 60 * 60 }`, or an expiry derived from the interval.
- Make `runDigests` accept an `AbortSignal` and stop before the next claim once it is aborted.
- Correct the two comments.
- Add one integration case that starts a real `PgBoss` on the test database, registers the queue the way `index.ts` does, sends one job (not the cron), and asserts the fake SMTP received one digest and the job ended `completed`.

### c-WR-05: The digest's failures are invisible to an operator, and a permanent SMTP rejection repeats on every run forever

**File:** `src/lib/notifications/digest.ts:336-340`, `:385-406`; `src/lib/worker/jobs/notification-digest.ts:16-20`; `src/lib/notifications/digest-sender.ts:83-84`
**Issue:**
- `runDigests` swallows every per-pair exception with a bare `catch {}`.
- The handler logs only the count of `failed`. It never logs `rejected`, `ambiguous` or `lease-short`.
- A thrown run, for example a missing or invalid `BETTER_AUTH_URL` in the worker's environment, fails the pg-boss job with no worker log line. The worker logs only `boss.on("error")`.

`classifySendResult` maps any 4xx or 5xx reply to `rejected`. That includes `535` (authentication failed) and `550` (no such mailbox). A rejection moves the claim to RELEASED, nothing is stamped, and the next run tries again (by design, R2-5).

Failure scenario: an SMTP password rotates, or a member's mailbox is deleted.
- Every run tries every pair again, gets 535 or 550, and writes a new RELEASED `NotificationDigest` row per pair.
- The log shows nothing, and the settings page still reads "Email digests are sent every 4 hours".
- Nothing deletes `NotificationDigest` rows (no `delete` or `deleteMany` exists for the model under `src`), so the table grows by one row per pair per run for as long as the fault lasts.
**Fix:**
- Log per-run counts by outcome, still with no address, id or ticket: `[notification-digest] pairs=… sent=… rejected=… ambiguous=… failed=… leaseShort=…`.
- Log the error class (never the message, which can echo addresses) in the per-pair `catch`, and in the handler when `runDigests` throws.
- For a `5xx` on RCPT, consider stopping the retries for that pair until a new notification arrives, or recording the last outcome so Settings can show it.
- Add a retention job, or a delete of non-CLAIMED digests older than N days, to the existing cleanup.

## Info

### c-IN-01: Auto-generated mail on an existing ticket notifies as a customer reply

**File:** `src/lib/channels/email/ingest-message.ts:97`, `:209-242`
**Issue:** Auto mail (out-of-office, auto-acknowledgements) threads onto a ticket but never reopens it (D-13, `isAutoGenerated: isAuto`). The new `emitForTicket` call runs regardless. Each auto-reply therefore notifies the assignee, or on an unassigned ticket every owner and admin, as a "New customer reply".

A loop between an auto-responder and the outbound reply path produces one notification per message for every admin.
**Fix:** Skip the emission when `isAuto`, or emit it only when the owner wants auto mail to count. Pin either choice with a case.

### c-IN-02: The bell route answers 401 for every error that is not a membership refusal

**File:** `src/app/api/notifications/route.ts:38-45`
**Issue:** The `catch` turns any throw from `getScopedDb()` into 401 "unauthorized" with no log line. That covers the redirect it expects, but also a database error in the session or member read. The bell keeps its last count without a sign of trouble, and the operator finds nothing in the log. This is the pattern of 09 c-IN-01.
**Fix:** Treat only `isRedirectError(err)` as 401. For anything else, log the error class and answer 500.

### c-IN-03: The digest claim reads preferences on a second pool connection while it holds the claim transaction

**File:** `src/lib/notifications/digest.ts:150-192` (calls at `:171` and `:173`); `src/lib/notifications/preferences.ts:30-44`, `:78-85`
**Issue:** `claimPair` runs inside `prisma.$transaction` with the default 5-second timeout. Inside it, `enabledDigestTypes` and `getUnassignedSetting` call `scopedDb(orgId)`, which uses the global client rather than `tx`, so each takes a second connection from the worker's pool (`DB_POOL_MAX=5`).

This is correct under READ COMMITTED. But under pool pressure from the other worker jobs, the claim waits for a connection while holding one. With a pool of 1 it would hang until the transaction times out.
**Fix:** Read the two values through `tx` (they are plain reads), for example a `getPreferences(orgId, userId, client = scopedDb(orgId))` overload. Or read them before opening the transaction and pass them in.

### c-IN-04: A SENT digest records the ids it claimed, not the ids it sent

**File:** `src/lib/notifications/digest.ts:177-187`, `:347-357`
**Issue:** `notificationIds` is frozen at the claim. When the re-check drops rows (a type turned off, a row read since, fallback rights lost), the digest still moves to SENT with the full claimed list. `stampDigested` stamps only `sentIds`, so the stamps are right. But the `NotificationDigest` row overstates what the member received, which misleads anyone who reads the row to answer "did this member get notified of X?".
**Fix:** In the record transaction, also set `notificationIds: sentIds`, or add a `sentNotificationIds` column.

### c-IN-05: Digest links point into the active workspace only

**File:** `src/lib/notifications/digest.ts:216-231`; `src/app/(app)/tickets/[id]/page.tsx:25`
**Issue:** A user who is a member of two workspaces gets two digests. They are identical in subject and intro, and neither names its workspace. A link from workspace B opens `/tickets/<id>`, which resolves the ticket in the session's active organization. If that is A, the link leads to a not-found state.

That the ticket page shows not-found rather than switching organization is my reading of `requirePageAccess` and the scoped ticket read. *Unverified* in a browser.
**Fix:** Include the workspace name in the intro line (it is the operator's own data, not customer PII). Either let the ticket route switch the active organization when the user is a member of the ticket's organization, or document the limitation.

### c-IN-06: The digest carries no auto-submitted marker, so a member's reply to it becomes a customer ticket

**File:** `src/lib/notifications/digest.ts:329-333`; `src/lib/notifications/digest-sender.ts:143-148`; `src/lib/channels/email/ingest-message.ts:108-121`, `:260-275`
**Issue:** The digest is sent from the workspace's support `fromAddress` with no `Reply-To` and no `Auto-Submitted: auto-generated` header. Its subject has no ticket number, and its Message-ID is not stored. So when a member answers it, the poll of the support inbox matches nothing and opens a new ticket with that member as the contact. This assumes the polled inbox is the from address, which is the usual setup but *unverified* for every deployment.

Without `Auto-Submitted` (RFC 3834), a member's out-of-office also answers each digest. Ingest drops auto mail with no match (`:263`), so this second case only adds noise.
**Fix:** Add `headers: { "Auto-Submitted": "auto-generated" }`. Either set a `Reply-To` that the poll ignores, or put one line in the body saying that replies are not read. Then add the header to the fake-SMTP privacy case.

### c-IN-07: OPERATIONS.md says an ambiguous digest is resent "after that" (the five-minute lease); in fact it waits for the next scheduled run

**File:** `docs/OPERATIONS.md:583-590`; `src/lib/notifications/digest.ts:52`
**Issue:** An ambiguous attempt stays CLAIMED. It is released and resent only by the first run that starts after the lease has expired, which by default comes up to 4 hours later. The text reads as if the resend follows the lease.

The body's "Here is what happened since your last digest" is also inaccurate in two cases:
- The first digest after email is turned on, or after a type's digest switch is turned back on, includes every unread row ever kept undigested, possibly months old.
- No cap applies to its size.

**Fix:** Write "sends it again on the first scheduled run after that lease". Either limit the first digest to a window (for example rows newer than the interval times N), or reword the intro ("Here are your unread notifications.").

### c-IN-08: `smtp-client.ts` has an orphaned duplicate doc comment

**File:** `src/lib/channels/email/smtp-client.ts:17-21`
**Issue:** The old comment for `createSmtpTransport` stayed above the new `SmtpGetSocket` comment, and the function now has a second, extended copy at `:31-36`. Editors therefore attach the wrong comment to `SmtpGetSocket`.
**Fix:** Delete lines 17-21.

---

_Reviewed: 2026-11-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
