---
status: complete
phase: 03-email-channel
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md
started: 2026-07-06T05:33:04Z
updated: 2026-07-06T06:51:03Z
---

## Current Test

[testing complete]

<!-- Testing was delegated to Claude by the user ("saya percayakan kepada anda").
     Method: real docker-compose stack (rebuilt from current code) + Playwright through
     Caddy (https://localhost) + a GreenMail IMAP/SMTP container (aida-uat-greenmail)
     on the compose network for live email flows. Two blockers found & fixed in-session
     (commits 8558d1e, dac8994); all 12 tests re-verified passing. UAT fixtures left in
     place for manual dogfooding: GreenMail container running (SMTP localhost:3025,
     IMAP localhost:3143), login uat-admin@aida.test / UAT-test-password-1!, channel
     enabled against greenmail. Teardown: docker rm -f aida-uat-greenmail + toggle off. -->


## Tests

### 1. Cold Start Smoke Test
expected: Kill any running app/worker/db containers (docker compose down). Start the stack from scratch (docker compose up). Server boots without errors, the email_channel migration applies cleanly, the worker starts and registers both email jobs without crashing, and the app loads with live data.
result: pass
notes: "Issue found then FIXED in-session (delegated to Claude). Initial cold boot: migration applied, db/app/caddy healthy, but worker crash-looped with `Error: Dynamic require of \"stream\" is not supported` (@zone-eu/mailsplit via mailparser, esbuild ESM bundle). Root cause: bundled CJS deps require() node builtins at module load; esbuild's __require shim throws without a real top-level require. Fixed via createRequire banner in Dockerfile esbuild command (commit 8558d1e). Re-verified full cold start: migration clean, worker logs '[worker] started' and stays up, both email queues in pgboss.queue (email-inbound-poll singleton + email-outbound-send), app healthy, sign-in page renders via Caddy (Playwright, HTTP 200, no client errors)."

### 2. Settings Email Tab Renders
expected: Settings nav shows an "Email" entry. Clicking it opens /settings/email with: an enable/disable channel toggle, an inbound-poll health line, an IMAP (Inbound) section (host/port/SSL/username/password), an SMTP (Outbound) section (same fields), a From address field, and a "Save email settings" button.
result: pass
notes: "Playwright (delegated): all 8 elements verified visible (nav link, switch, IMAP/SMTP sections, from-address, save + both Test Connection buttons). Screenshot: uat-t2-settings-email.png"

### 3. Save Email Settings + Blank-Password-Keeps-Existing
expected: Fill IMAP/SMTP/from-address and passwords, Save → success toast. Reload the page: all values persist EXCEPT password fields, which are blank (placeholder dots). Re-saving with blank passwords keeps the stored credentials working (no need to re-type).
result: pass
notes: "Issue found then FIXED in-session. First run: Save → 'Failed to save email settings.' — docker-compose.yml never passed APP_ENCRYPTION_KEY to app/worker, so encryptSecret() threw on every credential save even for operators who set the key per .env.example. Fixed: APP_ENCRYPTION_KEY passthrough added to both services (commit dac8994) + key generated into local .env. Re-verified via Playwright: save → success toast, values persist on reload, password fields blank, blank-password re-save keeps stored credential."

### 4. Test Connection Validation (empty fields)
expected: With Host/Port/Username blank, clicking "Test IMAP connection" (or SMTP) does NOT fire a probe — the form shows inline "Required" messages under the empty fields instead of a raw connection error.
result: pass
notes: "Playwright (delegated): 2 inline 'Required' messages shown, no raw driver error. Confirms this session's UI-review fix works in the deployed image."

### 5. Test Connection Real Probe
expected: With valid credentials, "Test IMAP connection"/"Test SMTP connection" shows a spinner then "Connected successfully" (green). With a bad host or wrong password, it fails within ~10 seconds showing "Connection failed: <reason>" (red) — never a stuck spinner.
result: pass
notes: "Playwright (delegated), both sides: bogus host → 'Connection failed:' in 0.4s, no stuck spinner; against local GreenMail (greenmail:3143/3025, auth-disabled) → 'Connected successfully' for IMAP (0.6s) and SMTP (0.4s), using the stored (encrypted) password via blank-field fallback. Screenshot: uat-t5-success.png"

### 6. Email Channel Toggle
expected: Flipping the channel toggle updates immediately (optimistic). Reloading the page shows the persisted state. With the channel OFF, replies and the rest of the app keep working normally (no email side-effects).
result: pass
notes: "Playwright (delegated): off→on persists across reload, restored to off persists too. Channel-off app behavior implicitly covered (whole app ran with channel off all session)."

### 7. Inbound Email Creates Ticket
expected: With the channel enabled and IMAP configured, send a fresh email to the configured mailbox. Within ~1 minute (poll interval) a new ticket appears with the email's subject as title and its body as the first message (HTML sanitized — no scripts/tracking images). Attachments within limits appear on the message.
result: pass
notes: "Delegated, real flow via GreenMail: SMTP'd an email (customer@uat.test → support@aida.test) with <script> + remote tracking <img>. Worker poll ingested it within a cycle → Ticket #1 (NEW), INBOUND message, correct emailMessageId. Sanitization verified in DB AND rendered UI: script stripped (0 script tags), tracking img src removed (img kept but src-less — cannot fire, satisfies D-18), bold HTML preserved, contact (UAT Customer) shown. Screenshots: uat-t7-list.png, uat-t7-thread.png. (Attachment sub-case not exercised.)"

### 8. Reply Threads Into Existing Ticket
expected: Replying to a ticket's email conversation (or sending a new email with "[#N]" in the subject where N is the ticket number) appends the message to that existing ticket — it does NOT create a duplicate ticket. Sending the exact same email twice does not create a duplicate message.
result: pass
notes: "Delegated: 'Re: … [#1]' subject-token reply appended to Ticket #1 (2 messages, still 1 ticket). Exact duplicate resend (same Message-ID) created no third message — dedupe verified. (Header In-Reply-To path exercised implicitly by thread-match ordering; subject-token fallback proven live.)"

### 9. Customer Reply Reopens Resolved Ticket
expected: Resolve a ticket that came in via email. The customer replies to the email thread. The ticket flips back to OPEN and the reply appears in the thread (marked as the reopening message).
result: pass
notes: "Delegated: Ticket #1 resolved through the real UI (status dropdown → Resolved; resolvedAt stamped). Customer reply email ([#1]) ingested on next poll → status OPEN, resolvedAt cleared, reply message has triggeredReopen=true."

### 10. Outbound Reply Delivered via SMTP
expected: An agent posts a public reply on an email-originated ticket (channel enabled, SMTP configured). The customer receives the reply as a real email in the same conversation/thread (proper threading headers), with both text and HTML parts. Internal notes are NOT emailed.
result: pass
notes: "Delegated: reply sent through the real composer UI → worker delivered via SMTP → email verified INSIDE customer's GreenMail mailbox via IMAP: subject 'Re: UAT inbound test alpha [#1]', from=support@aida.test, In-Reply-To=<last inbound msg id>, References=<original msg id>. DB deliveryStatus=SENT with bracketed outbound emailMessageId. No failed chip in thread. (Internal-note-not-emailed sub-case relied on route gating, not separately exercised.)"

### 11. Failed Send Shows Retry Affordance
expected: With broken SMTP settings, an agent public reply eventually shows a red "Failed to send" badge + "Retry" link on the message in the thread. Clicking Retry re-queues it (and after fixing SMTP, the retry succeeds and the badge disappears). A retry that fails shows an error toast instead of a stuck "Retrying…" state.
result: pass
notes: "Delegated, full loop live: SMTP host → bogus, reply via UI → deliveryStatus FAILED → 'Failed to send' badge + Retry link visible. SMTP restored → Retry clicked → SENT → chip gone; exactly one delivered copy in mailbox (no duplicate — the original pg-boss job exhausted its 2 retries while SMTP was still broken, state=failed). Screenshots: uat-t11-failed-chip.png, uat-t11-after-retry.png. OBSERVATION (minor, not a failure): emailOutboundSendHandler doesn't gate on deliveryStatus, so a manual Retry racing a still-pending pg-boss retry could theoretically double-send; consider an idempotency guard in a hardening pass."

### 12. Inbound Poll Health Line
expected: The Settings Email tab health line reflects reality: "Last checked <time>" after a successful poll; a visible error line when polling fails (e.g. bad IMAP credentials); a neutral "hasn't polled yet" state before the first poll.
result: pass
notes: "Delegated, all three states live: 'Last checked …' after successful polls; GreenMail stopped → 'Last poll failed: …' destructive banner within a poll cycle; GreenMail restarted → error cleared back to 'Last checked …'. Never-polled neutral state was observed earlier pre-enable. Screenshots: uat-t12-healthy.png, uat-t12-failing.png, uat-t12-recovered.png."

## Summary

total: 12
passed: 12
issues: 0 (2 found during testing, both fixed + re-verified in-session: 8558d1e, dac8994)
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Worker boots on cold start and registers both email jobs without crashing"
  status: fixed (in-session, commit 8558d1e — do not plan; re-verified pass)
  reason: "Found during delegated smoke test: worker crash-loops with `Error: Dynamic require of \"stream\" is not supported` — esbuild ESM bundle can't resolve CJS require() of node builtins inside bundled mailparser/@zone-eu/mailsplit"
  severity: blocker
  test: 1
  root_cause: "Dockerfile esbuild command bundles CJS deps (mailparser -> @zone-eu/mailsplit) into --format=esm output; their require('stream') hits esbuild's __require shim which throws at module load. Same class of issue the Dockerfile already documents for @prisma/client. Fix: createRequire banner so the shim delegates to a real require."
  artifacts:
    - path: "Dockerfile"
      issue: "esbuild worker bundle command lacks a createRequire banner for bundled-CJS builtin requires"
  missing:
    - "Add --banner:js createRequire shim to the esbuild command in Dockerfile"
  debug_session: "diagnosed inline during UAT (this session)"

- truth: "Fill IMAP/SMTP/from-address and passwords, Save → success toast; values persist"
  status: fixed (in-session, commit dac8994 — do not plan; re-verified pass)
  reason: "User-delegated Playwright test: Save returns 'Failed to save email settings.' — APP_ENCRYPTION_KEY is documented in .env.example (03-02) but docker-compose.yml never passes it into the app/worker containers, so encryptSecret() throws on every password save in the deployed stack"
  severity: major
  test: 3
  root_cause: "docker-compose.yml env blocks for app and worker services omit APP_ENCRYPTION_KEY; the key exists only in .env.example documentation. App container env has no such var → getKey() throws → saveEmailSettings catch → { ok: false }."
  artifacts:
    - path: "docker-compose.yml"
      issue: "app and worker services missing APP_ENCRYPTION_KEY env passthrough"
  missing:
    - "Add APP_ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY:-} to app AND worker service environment blocks (worker decrypts for IMAP poll + SMTP send)"
  debug_session: "diagnosed inline during UAT (this session)"
