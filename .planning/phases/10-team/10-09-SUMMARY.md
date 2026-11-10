---
phase: 10-team
plan: 09
subsystem: notifications
status: complete
tags: [digest, smtp, nodemailer, getSocket, lease, skip-locked, advisory-lock, pg-boss, fake-smtp, aida-46]
requires:
  - "10-04: store.ts (claimDigestCandidates FOR UPDATE SKIP LOCKED, readDigestRows, stampDigested, listDigestPairs), preferences.ts"
  - "10-05: app-url.ts (getAppBaseUrl), tests/support/fake-smtp.ts (node:net), invite-email.ts pattern"
  - "10-01: NotificationDigest model and NotificationDigestStatus (migration unchanged)"
provides:
  - "src/lib/notifications/digest-config.ts: NOTIFICATION_DIGEST_QUEUE, digestIntervalHours, digestCron, digestIntervalText, SEND_DEADLINE_MS, COMMIT_MARGIN_MS, LEASE_MS, SMTP_TIMEOUT_MS, DIGEST_TIMING, assertDigestTiming"
  - "src/lib/notifications/digest-sender.ts: sendDigestMail(settings, mail, { deadlineMs, timeoutMs }), classifySendResult"
  - "src/lib/notifications/digest.ts: runDigests(deps), buildDigestBody, DIGEST_EMAIL_SUBJECT and copy constants"
  - "src/lib/worker/jobs/notification-digest.ts: notificationDigestHandler"
  - "src/lib/channels/email/smtp-client.ts: createSmtpTransport(settings, { timeoutMs, getSocket })"
  - "tests/support/fake-smtp.ts: modes trickle and starttls, connections and startTlsCommands counters"
affects: [10-10, 10-11, 10-14]
tech-stack:
  added: []
  patterns:
    - "Per-pair pg_advisory_xact_lock(hashtextextended(prefix || org || ':' || user, 0)) around lease release, held check and claim"
    - "Owned TCP socket handed to nodemailer through getSocket and destroyed at a wall-clock deadline"
    - "Every NotificationDigest status change is a conditional update on its own id and status CLAIMED (the fence)"
    - "Injected clock (deps.now) for lease expiry in tests; real timers for the send deadline"
key-files:
  created:
    - src/lib/notifications/digest.ts
    - src/lib/notifications/digest-config.ts
    - src/lib/notifications/digest-sender.ts
    - src/lib/worker/jobs/notification-digest.ts
    - tests/unit/digest-config.test.ts
    - tests/integration/notification-digest.test.ts
  modified:
    - src/lib/channels/email/smtp-client.ts
    - src/lib/worker/index.ts
    - docker-compose.yml
    - .env.example
    - docs/OPERATIONS.md
    - tests/integration/egress-fixtures/probe.ts
    - tests/support/fake-smtp.ts
decisions:
  - "The claim also refuses a former member and leaves fallback rows out when the recipient is not an owner or admin (not only at the re-check), so a former member or a demoted admin does not create a new CANCELED digest every run"
  - "A send cut off by the deadline is always ambiguous, even when nodemailer attached a reply code from a partial reply"
  - "Labels per type: Assigned to you, Customer replies, Mentions, SLA at risk, SLA breached; fallback rows on 'On unassigned tickets' (amendment A4)"
  - "A row whose ticket no longer exists counts in its line but shows no number or link; it is stamped with the rest"
  - "runDigests never throws for one pair: a pair that throws (for example afterSend) is reported failed and its digest stays as it is; it throws only for invalid timing or an unusable BETTER_AUTH_URL, before any claim"
  - "The egress probe sets a placeholder BETTER_AUTH_URL when absent (link text only), so the egress compose file stays unchanged"
metrics:
  duration: "about 75 minutes (2026-11-12T22:25Z to 23:41Z)"
  completed: 2026-11-13
  tasks: 3
  files: 13
estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 23800
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 05ead9e1fca375f5eae00c19ea6792c6cd0c884c
---

# Phase 10 Plan 09: Email digest Summary

The worker now emails each member one PII-free digest per run ("Your AIDA updates": per-type counts, ticket numbers and links only). Each (organization, recipient) pair is claimed under a five-minute lease inside a per-pair advisory transaction lock, using 10-04's `FOR UPDATE SKIP LOCKED` claim. Before sending, the digest re-checks membership, preferences, the unassigned opt-out and admin rights. The mail goes out on a TCP socket the sender owns: it is handed to nodemailer through `getSocket` and destroyed at a real wall-clock deadline. The digest is marked SENT only after the server's final acceptance. A definitive rejection releases it at once. An ambiguous result keeps it CLAIMED until the lease expires. Twenty-four unmocked integration cases against a `node:net` fake SMTP prove each of these paths.

## What was built

- **digest-config.ts**
  - `AIDA_DIGEST_INTERVAL_HOURS`: allowed values 1, 2, 3, 4, 6, 8, 12 and 24; anything else gives 4.
  - Cron: `0 * * * *` for 1 hour, `0 */N * * *` for N hours, `0 0 * * *` for 24 hours.
  - Cadence text: "every hour", "every N hours" or "once a day".
  - Timing constants: 45 s deadline, 15 s commit margin, 300 s lease and 10 s SMTP timeout.
  - `assertDigestTiming` runs at module load and again in `runDigests` for overrides. It throws unless every value is a positive finite number, the lease is greater than deadline plus margin, and the deadline is greater than the SMTP timeout.
- **smtp-client.ts**: `createSmtpTransport` takes an optional `getSocket` and passes it on unchanged. Host, port, `secure`, auth and the three timeouts are the same whether or not it is given.
- **digest-sender.ts**: `sendDigestMail` works in four steps.
  1. It opens the connection with `net.connect`, with its own connect timeout.
  2. It hands the socket over as `{ connection: socket }`.
  3. A timer destroys the socket at `deadlineMs`.
  4. It awaits `sendMail` until it settles, and only then clears the timer.

  `classifySendResult` (R2-5) returns one of three outcomes:
  - **accepted**: the recipient is in `info.accepted` and `info.rejected` is empty.
  - **rejected**: the error has a `responseCode` from 400 to 599, or the recipient is in `info.rejected`.
  - **ambiguous**: anything else. A send cut off by the deadline is always ambiguous.

  The sender never logs anything.
- **digest.ts**: `runDigests({ now, timing, hooks: { beforeSend, beforeConnect, afterSend } })` runs steps (a) to (f) of the plan. The header comment documents each step.
  - The module holds no query on the notification table. Notification access goes only through `store.ts`, and `listDigestPairs` is the single cross-organization read.
  - Ticket reads select only `id` and `number`.
  - It returns `{ pairs, reports }`. Each report has one of these outcomes: `email-off`, `held`, `nothing`, `canceled`, `lease-short`, `rejected`, `ambiguous`, `sent`, `fenced` or `failed`.
- **Worker**: `notificationDigestHandler` calls `runDigests` and logs only a failure count. `index.ts` registers the queue like the Phase 14 cleanup block: `createQueue(NOTIFICATION_DIGEST_QUEUE, { policy: "singleton" })`, then `work`, then `schedule(…, digestCron())`.
- **Compose and env**: the worker gets `BETTER_AUTH_URL: ${BETTER_AUTH_URL}` and `AIDA_DIGEST_INTERVAL_HOURS: ${AIDA_DIGEST_INTERVAL_HOURS:-4}`. The app gets `AIDA_DIGEST_INTERVAL_HOURS` because the preferences page shows the cadence. `.env.example` documents the variable.
- **fake-smtp.ts**:
  - `trickle` writes the reply to the end of data one byte per `tricklePauseMs` (default 200). The message counts as accepted only once the last byte is written.
  - `starttls` advertises STARTTLS and answers 220. The first bytes after that close the connection.
  - New `connections` and `startTlsCommands` counters.
  - Existing modes are unchanged.
- **OPERATIONS.md**: a new "Team and notifications" section covers:
  - the digest setting;
  - the delivery guarantee: every duplicate window, "more than one duplicate", and no exactly-once claim;
  - unassigned tickets, with the two O-7 limits;
  - invitation tokens in access logs;
  - deactivation, and the private-project risk of 14-o1;
  - the Better Auth 1.7.20 upgrade note.

  It also adds a row for the variable to the environment variable reference.
- **probe.ts**: two new flows, `invitation-email-sent` and `digest-email-sent`, both through stub-smtp. The allowed-destination set and `docker-compose.egress-test.yml` are unchanged.

## How the key properties are proven

- **Lease and races**: two `runDigests` start at once over two recipients, five times on fresh data. Each recipient gets exactly one email and one SENT digest, and every other report is `held` or `nothing`. A drop-on-data run stays CLAIMED, a run before the lease expires reports `held` and sends nothing, and a run past the lease (injected clock) sends exactly one.
- **Per-recipient batching and isolation**:
  - X's digest freezes exactly X's id.
  - Rows of Y and of another organization, and rows that are read or archived, never appear in X's email and are never stamped for X.
  - Y and Z each get their own single email.
- **PII-free subject and body**:
  - The ticket carries distinct markers in its subject, contact name, contact email and message text, and an `AuditEvent.input` carries one too.
  - None of these markers appears in the raw captured email or in the decoded text.
  - The subject equals "Your AIDA updates".
- **Re-checks after beforeSend**:
  - Turning MENTION's digest switch off drops the mention line and leaves that row undigested. A control run without the hook includes the line.
  - Deleting the member rows means no email, a CANCELED digest, and no new claim on the next run.
  - Turning the unassigned switch off, or demoting the owner to member, drops the "On unassigned tickets" line and leaves the fallback row undigested. A control run with the line comes first.
- **Rejection versus ambiguity (R2-5)**:
  - `reject-data`, `reject-data-command` and `reject-rcpt` each release the digest at once with nothing stamped. In each case the next run sends exactly one email with the same frozen ids.
  - `drop-after-data-end` stays CLAIMED, and a second copy arrives after the lease.
  - Two ambiguous cycles followed by a success give three received copies: the digests are RELEASED, RELEASED, SENT, and every row's `digestedAt` equals that `sentAt`.
  - When `afterSend` throws, the digest stays CLAIMED with nothing stamped, and it is resent after the lease.
  - Fence case: a stalled sender's lease is released, the digest is sent again by another run, and the stalled sender then reports `fenced` and changes nothing.
- **Deadline (V-29)**:
  - Through `runDigests`, with a 1 000 ms SMTP timeout and a 2 500 ms deadline, a trickled reply is cut off at 2 538 ms, within the 3 500 ms bound. The outcome is ambiguous and the digest stays CLAIMED.
  - Called directly, `sendDigestMail` returns ambiguous with `deadlineReached` and an elapsed time from 2 400 to 3 500 ms.
  - On the same trickle, `createSmtpTransport` with the same 1 000 ms timeout kept reading until the reply completed, after more than 3 500 ms. So the inactivity timeout alone bounds nothing.
- **Lease check**: `beforeConnect` moves the clock so the remaining lease is 1 s below deadline plus margin. The digest becomes RELEASED (`lease-short`) and the fake's connection count does not change. A later run sends it once.
- **Email off**: an organization with email off and one with no host each get no NotificationDigest row. In the same run an organization with email on is sent, over exactly one connection.

## TLS equivalence (V-29, T-10-38)

The flagged assumption about `getSocket` holds: nodemailer still upgrades a socket it did not create.

| Server | `createSmtpTransport` (own socket) | `sendDigestMail` (owned socket via `getSocket`) | Extra evidence |
|---|---|---|---|
| Plain fake, `secure: false` | accepted | accepted | 2 messages accepted, 0 STARTTLS commands |
| Fake in `starttls` mode (advertises STARTTLS, answers 220, cannot complete a handshake), `secure: false` | ambiguous | ambiguous | 2 STARTTLS commands seen, 0 messages received: neither path fell back to plain text |
| Plain fake, `secure: true` | ambiguous | ambiguous | 2 connections, 0 messages received, 0 STARTTLS: both started TLS at once |

Certificate verification against a real CA is not exercised; no test certificate is committed (flagged in the plan).

## Verification

All Docker steps used run id `mwe6990c-4313501acf201175`, `DOCKER_HOST` from the Colima context and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Before each Docker step, `colima status` exited 0 and `docker info` exited 0 (server 29.5.2).

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (Task 1) | 0 | clean |
| `vitest run tests/unit/digest-config.test.ts` | 0 | 33 passed |
| `pnpm test:integration tests/integration/notification-digest.test.ts` (Task 1 tracer) | 0 | 1 passed |
| `pnpm test tests/unit/digest-config.test.ts` (Task 1 verify; the script runs the whole unit tree) | 0 | 108 files, 1930 passed |
| `pnpm test:integration tests/integration/notification-digest.test.ts` (Task 2, first run) | 1 | 23 passed, 1 failed: a fake-server timing bug (the trickled message was marked accepted only after the pause that followed the last byte); fixed in `fake-smtp.ts`, no product change |
| `vitest run --config vitest.integration.config.ts tests/integration/notification-digest.test.ts --reporter=verbose` | 0 | 24 passed |
| `pnpm test:integration tests/integration/notification-digest.test.ts` (Task 2 verify) | 0 | 24 passed |
| `docker compose config --quiet` | 0 | renders; the worker and app environments contain `BETTER_AUTH_URL` and `AIDA_DIGEST_INTERVAL_HOURS` (key names read from `docker compose config --format json`; values not printed) |
| `esbuild src/lib/worker/index.ts` with the Dockerfile flags, output into a temp directory | 0 | the worker bundles with the new modules |
| `pnpm typecheck` (Task 3 verify) | 0 | clean |
| `pnpm test` (final) | 0 | 108 files, 1930 passed |
| `pnpm lint` (final) | 0 | 735 files, 1 warning, which predates this plan (`tests/unit/container-config.test.ts:160`) |

The tracer gate passed: Task 1's `<verify>` ran end to end before any expansion.

Acceptance greps:
- **Task 1**:
  - `pg_advisory_xact_lock` in digest.ts: 1.
  - Notification-table pattern in digest.ts: 0.
  - `getSocket`: smtp-client.ts 5, digest-sender.ts 3.
  - In digest-sender.ts: `destroy` 6, `responseCode` 6.
  - `assertDigestTiming` in digest-config.ts: 3.
  - `@/` in the three modules: 0 each.
- **Task 2**:
  - `NOTIFICATION_DIGEST_QUEUE` in worker/index.ts: 4.
  - `AIDA_DIGEST_INTERVAL_HOURS` in docker-compose.yml: 2; in `.env.example`: 1.
  - In fake-smtp.ts: `trickle` 12, `starttls` 6.
  - `it(` in the integration file: 24.
  - The `git diff --stat -- .env` check was **not run**: the secret-read hook blocks any command that names that file. `git status --short` listed no such file.
- **Task 3**:
  - "more than one duplicate": 1.
  - `invitation-email-sent\|digest-email-sent` in probe.ts: 4.
  - In OPERATIONS.md: exactly-once 1, access log 2, `14-o1\|private project` 2, `AIDA_DIGEST_INTERVAL_HOURS` 2.
  - `git diff --stat -- docs/SECURITY.md` and `git diff --stat -- docker-compose.egress-test.yml`: both empty.

Not run:
- `pnpm test:egress`, which runs the new probe flows: **not run** in this plan, because it belongs to 10-14's gate and needs an image build. Measured: host free space 27 GiB (`df -g /`); free space in the Colima VM was not measured. So under rule J any egress run stays `blocked (space)` until both are confirmed at 20 GiB or more. No image was built.
- The full `pnpm test:integration` suite and `pnpm test:e2e`: not run. This plan names only its own suite and has no E2E step.

## docs/SECURITY.md lines: blocked (08-o4)

Owner item 08-o4 (O-6) holds every edit to `docs/SECURITY.md`. These are the exact lines Phase 10 would add there, recorded as **blocked (08-o4)**:

> **Invitation and digest email (Phase 10).** Both send paths go through the organization's configured SMTP transport, the same server as ticket replies: Phase 10 adds no new egress destination. The invitation email carries the invitation link; the digest email carries counts per notification type, ticket numbers and links into the app only, never a customer name or email address, a ticket subject, message text or `AuditEvent.input`. Both build their links from `BETTER_AUTH_URL`, never from a request header.
>
> **Invitation links.** The invitation token travels in the URL path of `/invite/<token>` links. AIDA stores only its SHA-256 hash, never logs the link, and sends `Referrer-Policy: no-referrer` on the invitation page. The shipped `Caddyfile` has no access log. An operator who enables access logging in Caddy, or in another proxy or CDN in front of AIDA, records those tokens, so such logs must be protected like credentials or the `/invite/` path redacted. A token works once and expires 7 days after the invitation is created.

## TDD note (Task 2, `tdd="true"`)

The orchestrator did not pass `TDD_MODE`. Most Task 2 behaviour is built in Task 1's `digest.ts`, as the plan's step list puts it there. So most Task 2 cases passed on first run. They prove behaviour that already existed, and no separate RED commit of product behaviour was possible for them; 10-04 records the same situation. The new code in Task 2 is the fake's modes, the worker job, the registration and the compose entries. The only red run was the fake-server timing bug in the table above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] The claim also checks membership and admin rights**
- **Found during:** Task 1
- **Issue:** The plan's claim step reads only the unassigned setting for `includeFallback`, and re-checks membership only after the claim. A former member with leftover unread rows (D-25 keeps them inert), or a demoted admin with fallback rows, would be claimed and then CANCELED on every run. That writes an unbounded series of CANCELED NotificationDigest rows.
- **Fix:** Inside the claim transaction, `readMemberRights` runs after the advisory lock. With no member row, nothing is claimed. `includeFallback` is now the unassigned setting AND `isAdmin`. The re-check after `beforeSend` is unchanged and still decides; the deactivation case proves both, the CANCELED digest first and then `nothing` on the next run.
- **Files modified:** src/lib/notifications/digest.ts
- **Commit:** 1b9a7dd

**2. [Rule 1 - Bug] Fake SMTP trickle marked the message accepted too late**
- **Found during:** Task 2, first run
- **Issue:** The pause also ran after the last byte, so the client resolved before the fake recorded the message as accepted.
- **Fix:** Pauses run only between bytes.
- **Files modified:** tests/support/fake-smtp.ts
- **Commit:** 9db1c2c

### Other differences from the plan text

- **Extra outcome rules.**
  - An empty recipient email cancels the digest.
  - An organization's settings that cannot be decrypted count as email off for that run, and nothing is claimed.
  - An empty from address also counts as email off, as in 10-05.
- **Body format.**
  - Each ticket entry is `#<number> <BETTER_AUTH_URL>/tickets/<id>`, and entries are separated by commas inside the parentheses.
  - Ticket numbers are de-duplicated within a line, while the count is the number of rows.
- **Extra seams and exports.**
  - `classifySendResult` is exported for the TLS-equivalence cases.
  - `runDigests` returns per-pair reports for the tests and the probe.
  - The fake has `connections` and `startTlsCommands` counters.
- **Extra cases beyond the behaviour list.**
  - The fence case.
  - The direct trickle comparison against `createSmtpTransport`.
  - A no-host variant in the email-off case.
- **Isolation in the test file.** After each case, the test switches email off for each of its organizations and archives their rows, so a case's leftovers can never send in a later case.
- **Docs ahead of their UI.** OPERATIONS.md names "Settings → Team" (revoke, the reassign offer) and "Settings → Notifications" (the switches, the cadence). Later Phase 10 plans build those pages (10-10, 10-11). The digest itself reads preferences that 10-04 stores.

## Owner items and defaults used

- O-6 (08-o4): `docs/SECURITY.md` was not edited. Its lines are above, marked blocked (08-o4).
- O-7: defaults (a) and (b) are documented in OPERATIONS.md, "Unassigned tickets".
- O-8 (14-o1): the risk is documented in OPERATIONS.md, "Removing a member".
- O-9: REQUIREMENTS.md was not edited, and no requirement was marked complete (that is the orchestrator's job).

## Manual items (open)

- A digest sent to a real mail server and read in a real mailbox: open for a human. No real email was sent.
- The look of the digest in a mail client: open; no visual pass is claimed.

## Known Stubs

None.

## Threat Flags

None. The only egress is the organization's configured SMTP, which already existed (D-26). The fake server is loopback and test-only. The worker gains `BETTER_AUTH_URL`, which is only written into email text as links.

## Rule notes

- `.env` was not read. One command that named it, `git diff --stat -- .env` (an acceptance check), was blocked by the hook before it ran. No workaround was attempted.
- The first attempt at the compose key check wrote the rendered config to a temp file. The hook blocked that whole command line (it also named the protected file), so no file was written. The check that ran pipes `docker compose config --format json` straight into a filter that prints key names only.

## Self-Check: PASSED

- Created files exist: digest.ts, digest-config.ts, digest-sender.ts, jobs/notification-digest.ts, digest-config.test.ts, notification-digest.test.ts.
- Commits exist: 1b9a7dd, 9db1c2c, fad24da.
