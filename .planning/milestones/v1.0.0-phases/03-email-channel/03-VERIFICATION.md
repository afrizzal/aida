---
phase: 03-email-channel
verified: 2026-07-06T04:58:32Z
status: passed
score: 30/30 must-haves verified (6 plans)
---

# Phase 3: Email Channel Verification Report

**Phase Goal:** Real email support — the default channel for a CS helpdesk.
**Requirement:** AIDA-09 — Inbound email is parsed into a ticket (replies thread onto the existing ticket via message-id/headers); agents' public replies are delivered outbound via SMTP.
**Verified:** 2026-07-06T04:58:32Z
**Status:** passed
**Re-verification:** No — initial verification

## Method

Read all 6 PLAN.md/SUMMARY.md pairs, `03-CONTEXT.md`, ROADMAP.md's Phase 3 entry (goal + 3 Success Criteria), and REQUIREMENTS.md. Cross-referenced every `must_haves` truth/artifact/key_link against the actual files on disk (not the SUMMARY narrative), then ran the project's own automated gates:

- `pnpm exec tsc --noEmit` → clean (0 errors)
- `pnpm test` (unit, vitest) → **40/40 passed**, 9 test files
- `volta run --node 22.23.1 -- pnpm test:integration` (Testcontainers Postgres, 4 migrations incl. `20260706025051_email_channel`) → **20/20 passed**, 6 test files, including all 6 `email-ingest.test.ts` scenarios (create / header-thread-append / dedupe / subject-token-fallback / auto-generated-drop / resolved-ticket-reopen)
- `pnpm exec biome check "src/app/(app)/settings/email" src/components/tickets/delivery-failed-chip.tsx` → clean
- Re-ran the exact Dockerfile esbuild worker-bundle command (`esbuild src/lib/worker/index.ts --bundle --platform=node --format=esm --target=node22 --external:pg --external:@prisma/client`) → succeeded, 4.6MB bundle, proving the worker's `createTicket()`-transitive `@/`-aliased graph resolves
- Verified all 20 task-commit hashes cited across the 6 SUMMARYs exist in git history
- grep-verified the additive migration contains zero `searchVector` references (Pitfall 3 guard)

## Goal Achievement — ROADMAP Success Criteria (priority over derived truths)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Inbound email creates a ticket; a reply threads onto the existing ticket via message-id/headers; no duplicate tickets | ✓ VERIFIED | `src/lib/channels/email/ingest-message.ts` (`ingestMessage`) dedupes on `emailMessageId` (`db.message.findFirst`), thread-matches via `findTicketIdByEmailMessageIds` (header) then `extractSubjectTicketNumber`/`findTicketByNumber` ([#N] fallback), else `createTicket()`. Proven by 6/6 green integration scenarios in `tests/integration/email-ingest.test.ts` (create, header-append, dedupe, subject-token, auto-drop, resolved-reopen) |
| 2 | An agent's public reply is delivered by SMTP to the requester and recorded in the thread | ✓ VERIFIED | `src/app/api/tickets/[id]/messages/route.ts` stamps `deliveryStatus: QUEUED` and enqueues `email-outbound-send` post-commit; `src/lib/worker/jobs/email-outbound-send.ts` calls `transporter.sendMail(composeMail(...))` and flips `deliveryStatus` to `SENT`/`FAILED`; `thread-message.tsx` renders `DeliveryFailedChip` for FAILED (Retry re-enqueues via `retryOutboundSend`) |
| 3 | Email config (IMAP/inbound + SMTP) lives in Settings; failures are surfaced, not silent | ✓ VERIFIED | `/settings/email` page (`getEmailSettings` + `EmailChannelToggle` + `EmailSettingsForm` with real `testImapConnection`/`testSmtpConnection` 10s-timeout probes) + `EmailHealthLine` renders `lastPollError` in a destructive banner (never silent) — `pollInbox()` persists `lastPollAt`/`lastPollError` via `updateEmailHealth` on every run, success or failure |

**Score:** 3/3 Success Criteria verified.

## Must-Haves by Plan (goal-backward truths)

### 03-01 — Data foundation (4/4)

| Truth | Status | Evidence |
|---|---|---|
| Email libraries installed and importable | ✓ | `package.json` has all 5 deps + 2 `@types`; `imapflow`/`mailparser`/`nodemailer`/`html-to-text`/`rehype-parse` are actually imported and exercised throughout `src/lib/channels/email/*` and pass `tsc`/tests |
| Message model stores RFC email identity + deliveryStatus | ✓ | `prisma/schema.prisma`: `emailMessageId`/`emailInReplyTo`/`emailReferences String[]`/`deliveryStatus MessageDeliveryStatus?` + `@@index([organizationId, emailMessageId])` |
| Dedicated EmailIngestFailure poison table | ✓ | `model EmailIngestFailure` (org-scoped, unique on `organizationId+emailMessageId`), actively read/written by `poll-inbox.ts` |
| scopedDb auto-scopes EmailIngestFailure | ✓ | `src/lib/scoped-db.ts` `DOMAIN_MODELS` includes `"EmailIngestFailure"` |

Migration `20260706025051_email_channel/migration.sql` confirmed additive-only (grep for `searchVector` → 0 matches); `migrate deploy` applies all 4 migrations cleanly in the integration-test run above.

### 03-02 — Credential encryption + settings module (4/4)

| Truth | Status | Evidence |
|---|---|---|
| IMAP/SMTP passwords encrypted at rest (AES-256-GCM) before touching Setting | ✓ | `settings.ts` `saveEmailSettings` calls `encryptSecret()` before writing `*PasswordEnc` keys |
| Fresh IV per call + auth tag, one opaque base64 blob | ✓ | `secret-box.ts`: `randomBytes(12)` IV, `cipher.getAuthTag()`, `Buffer.concat([iv, authTag, ciphertext])` |
| One typed module over the Setting key/value store, no schema change | ✓ | `EMAIL_SETTING_KEYS` (14 keys), `getEmailSettings`/`saveEmailSettings`/`updateEmailHealth`, `findFirst`+create/update (no `.upsert`) |
| Tampered blob throws, never silently returns plaintext | ✓ | `decryptSecret` calls `setAuthTag` before `.final()`; `tests/unit/secret-box.test.ts` asserts tamper-throws — part of the 40/40 green unit suite |

### 03-03 — Parsing primitives (5/5)

| Truth | Status | Evidence |
|---|---|---|
| Inbound HTML sanitized through the SAME module as renderMarkdown() | ✓ | `sanitizeEmailHtml` lives in `src/lib/markdown/render.ts` beside `renderMarkdown`, reuses the same `schema`/`rehypeSafeLinks` |
| Remote images stripped (tracking-pixel defense) | ✓ | `rehypeStripRemoteImages` clears `http(s)://` `img.src`; `tests/unit/sanitize-email-html.test.ts` asserts strip + same-origin survival |
| Body reduces to sanitized-HTML + plain-text/markdown, html-to-text fallback | ✓ | `parse-body.ts` `extractEmailBody` — html-only case falls back to `convert()` |
| Threading candidates: header Message-IDs then [#N] subject fallback | ✓ | `thread-match.ts`: `collectCandidateMessageIds`, `extractSubjectTicketNumber` |
| Auto-generated mail detected as a pure predicate | ✓ | `auto-generated.ts` `isAutoGenerated` — RFC 3834/Precedence/bounce/List-Id dual-check |

### 03-04 — Inbound ingest orchestrator + poll loop + worker wiring (7/7)

| Truth | Status | Evidence |
|---|---|---|
| No-thread-match email creates a ticket via the ONE createTicket(), contact auto-linked | ✓ | `ingest-message.ts` no-match branch calls `createTicket(orgId, {..., contact, direction:"INBOUND", emailMessageId, ...})`; integration test scenario 1 |
| Reply threads via header match or [#N] fallback, no duplicate ticket | ✓ | Integration test scenarios 2 (header) + 4 (subject-token) both assert ticket count unchanged |
| Same email polled twice never double-creates | ✓ | `db.message.findFirst({ where: { emailMessageId }})` dedupe check; integration test scenario 3 (`"duplicate"`) |
| Reply to RESOLVED/CLOSED reopens in same transaction with triggeredReopen | ✓ | `ingest-message.ts` matched-thread branch: `shouldReopen` computed, same `$transaction` updates `ticket.status:"OPEN", resolvedAt:null`; integration test scenario 6 |
| Auto-generated mail never creates/reopens; self-addressed mail ignored | ✓ | `isAuto` gates both the no-match `"dropped-auto"` return and `shouldReopen`; `from === selfAddress` returns `"skipped"`; integration test scenario 5 |
| Poll fetches UNSEEN only, marks \Seen only after success, poison guard after threshold | ✓ | `poll-inbox.ts`: `client.search({ seen:false })`, `messageFlagsAdd` only on success or poison-skip, `POISON_THRESHOLD = 5` against `EmailIngestFailure` |
| Poll health persisted; worker bundles both jobs | ✓ | `updateEmailHealth` called on every branch; `worker/index.ts` registers `email-inbound-poll` (singleton, `* * * * *`) + `email-outbound-send`; esbuild bundle re-run succeeded (4.6MB) |

### 03-05 — Outbound SMTP send + delivery-failed retry (5/5)

| Truth | Status | Evidence |
|---|---|---|
| Public reply delivered as multipart/alternative, no quoted history | ✓ | `composeMail` sets both `text`/`html` (nodemailer auto-produces multipart/alternative); no quoted-history concatenation anywhere in `compose-outbound.ts` |
| Outbound send runs as pg-boss job (~3 attempts), never inline; Message row QUEUED immediately | ✓ | `boss-client.ts` `retryLimit:2, retryBackoff:true`; `messages/route.ts` sets `deliveryStatus:"QUEUED"` inside the transaction, enqueues AFTER commit |
| Own bracketed Message-ID; In-Reply-To = latest inbound; References capped ~10 | ✓ | `buildOutboundMessageId` bracket format; `email-outbound-send.ts` derives `inReplyTo` from the last INBOUND prior message, `references` from all prior (excludes self); `composeMail` caps `.slice(-10)` |
| Failed send shows "Failed to send — Retry"; retry re-enqueues | ✓ | `DeliveryFailedChip` + `retryOutboundSend` (sets `QUEUED`, calls `getBoss().send(...)`) |
| Channel disabled → reply behaves exactly as Phase 2 (no enqueue, no deliveryStatus) | ✓ | `shouldQueue` gate: `mode==="public" && emailSettings.enabled && !!ticket.contactId`; `deliveryStatus: shouldQueue ? "QUEUED" : undefined` |

### 03-06 — Settings Email tab (5/5)

| Truth | Status | Evidence |
|---|---|---|
| Admin can configure IMAP/SMTP/from-address and save | ✓ | `email-settings-form.tsx` (IMAP + SMTP sections + From address field) → `saveEmailSettings` Server Action → `persistEmailSettings` |
| Real Test Connection per side, reports within ~10s, never a stuck spinner | ✓ | `testImapConnection`/`testSmtpConnection` use `{ timeoutMs: 10000 }`; `TestConnectionButton` shows idle/testing/success/failure states |
| Channel toggled with a Switch; Phase 2 unaffected when off | ✓ | `EmailChannelToggle` + `setEmailChannelEnabled`; `messages/route.ts`'s `shouldQueue` gate is false when disabled |
| Inbound poll health shown, failures surfaced | ✓ | `EmailHealthLine` three states, destructive banner for `lastPollError` |
| Every mutating action admin-gated via requireOrgAdmin() | ✓ | All 4 actions (`saveEmailSettings`, `setEmailChannelEnabled`, `testImapConnection`, `testSmtpConnection`) call `requireOrgAdmin()` first (grep count 9 total incl. comments) |

**Score:** 30/30 must-haves verified across all 6 plans.

## Required Artifacts (all 27 across 6 plans)

| Artifact | Status | Details |
|---|---|---|
| `package.json` (+lockfile) | ✓ VERIFIED | imapflow/mailparser/nodemailer/html-to-text/rehype-parse + @types present |
| `prisma/schema.prisma` | ✓ VERIFIED | `MessageDeliveryStatus`, email fields, `EmailIngestFailure`, back-relation |
| `prisma/migrations/20260706025051_email_channel/` | ✓ VERIFIED | Additive-only, no `searchVector`, applies cleanly (proven in integration run) |
| `src/lib/scoped-db.ts` | ✓ VERIFIED | `EmailIngestFailure` in `DOMAIN_MODELS` |
| `src/lib/crypto/secret-box.ts` + test | ✓ VERIFIED | `aes-256-gcm`, `getAuthTag`/`setAuthTag`, node:crypto-only |
| `src/lib/channels/email/settings.ts` | ✓ VERIFIED | 14 keys, get/save/updateHealth, relative crypto import |
| `.env.example` (`APP_ENCRYPTION_KEY`) | ✓ VERIFIED | documented |
| `src/lib/markdown/render.ts` (`sanitizeEmailHtml`) | ✓ VERIFIED | exported, tested |
| `src/lib/channels/email/parse-body.ts` | ✓ VERIFIED | `extractEmailBody` |
| `src/lib/channels/email/thread-match.ts` | ✓ VERIFIED | 4 exports, no `@/` |
| `src/lib/channels/email/auto-generated.ts` | ✓ VERIFIED | `isAutoGenerated` |
| `src/lib/tickets/create-ticket.ts` (extended) | ✓ VERIFIED | `bodyHtml`/`emailMessageId`/`emailInReplyTo`/`emailReferences` in input, `messageId` in result |
| `src/lib/channels/email/imap-client.ts` | ✓ VERIFIED | `createImapClient`, explicit timeouts |
| `src/lib/channels/email/ingest-message.ts` | ✓ VERIFIED | `deriveEmailMessageId` + `ingestMessage`, no `@/` |
| `src/lib/channels/email/poll-inbox.ts` | ✓ VERIFIED | `pollInbox`, `POISON_THRESHOLD`, `messageFlagsAdd` |
| `src/lib/worker/jobs/email-inbound-poll.ts` | ✓ VERIFIED | mirrors heartbeat.ts shape |
| `src/lib/worker/index.ts` | ✓ VERIFIED | registers both email queues, esbuild-bundles |
| `tests/integration/email-ingest.test.ts` | ✓ VERIFIED | 6/6 scenarios green |
| `src/lib/channels/email/smtp-client.ts` | ✓ VERIFIED | `createSmtpTransport`, timeouts |
| `src/lib/channels/email/compose-outbound.ts` | ✓ VERIFIED | `buildOutboundMessageId`/`wrapEmailSafeHtml`/`composeMail` |
| `src/lib/queue/boss-client.ts` | ✓ VERIFIED | `getBoss`, `email-outbound-send` queue, `retryLimit:2` |
| `src/lib/worker/jobs/email-outbound-send.ts` | ✓ VERIFIED | `emailOutboundSendHandler`, SENT/FAILED transitions |
| `src/components/tickets/delivery-failed-chip.tsx` | ✓ VERIFIED | "Failed to send" + Retry |
| `src/app/(app)/settings/email/actions.ts` | ✓ VERIFIED | 4 admin-gated actions |
| `src/app/(app)/settings/email/page.tsx` | ✓ VERIFIED | loads `getEmailSettings`, `force-dynamic` |
| `src/app/(app)/settings/email/email-settings-form.tsx` | ✓ VERIFIED | IMAP/SMTP/From + Save |
| `src/app/(app)/settings/email/test-connection-button.tsx` | ✓ VERIFIED | 4 states |
| `src/app/(app)/settings/settings-nav.tsx` | ✓ VERIFIED | `/settings/email` entry present |

No stubs, no placeholders, no orphaned (unwired) artifacts found.

## Key Link Verification (15 across 6 plans)

| From | To | Via | Status |
|---|---|---|---|
| `prisma/schema.prisma Message` | generated Prisma client | `prisma generate` | ✓ WIRED (tsc clean, fields typed) |
| `scoped-db.ts DOMAIN_MODELS` | `EmailIngestFailure` model | allowlist entry | ✓ WIRED |
| `channels/email/settings.ts` | `crypto/secret-box.ts` | relative import | ✓ WIRED |
| `saveEmailSettings` | `Setting` table | scopedDb findFirst+create/update | ✓ WIRED |
| `sanitizeEmailHtml` | rehype-sanitize + remote-image strip | unified pipeline | ✓ WIRED |
| `extractEmailBody` | `html-to-text convert()` | fallback | ✓ WIRED |
| `ingest-message.ts` | `createTicket()` | no-match path | ✓ WIRED (integration test scenario 1) |
| `poll-inbox.ts` | `EmailIngestFailure` | poison increment/skip + health update | ✓ WIRED |
| `worker/index.ts` | `emailInboundPollHandler` + `emailOutboundSendHandler` | createQueue+work+schedule | ✓ WIRED |
| `messages/route.ts` | `email-outbound-send` job | `getBoss().send` post-commit | ✓ WIRED |
| `email-outbound-send.ts` | SMTP transport | `createSmtpTransport(...).sendMail(composeMail(...))` | ✓ WIRED |
| `thread-message.tsx` | `retryOutboundSend` | `DeliveryFailedChip` on `deliveryStatus===FAILED` | ✓ WIRED |
| `settings/email/actions.ts testImapConnection` | `createImapClient(...).connect()` | requireOrgAdmin+10s timeout | ✓ WIRED |
| `settings/email/actions.ts testSmtpConnection` | `createSmtpTransport(...).verify()` | requireOrgAdmin+10s timeout | ✓ WIRED |
| `settings/email/page.tsx` | `getEmailSettings` | scopedDb load | ✓ WIRED |

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| AIDA-09 | 03-01, 03-02, 03-03, 03-04, 03-05, 03-06 (all 6) | Inbound email parsed into a ticket (thread via message-id/headers); public replies delivered outbound via SMTP | ✓ SATISFIED | Full inbound ingest + outbound send pipeline verified end-to-end (see Success Criteria + must-haves tables above); 6/6 integration scenarios green |

REQUIREMENTS.md / ROADMAP.md map exactly one requirement (AIDA-09) to Phase 3. All 6 plans declare `requirements: [AIDA-09]` in frontmatter — no orphaned requirements (nothing else maps to Phase 3 per ROADMAP.md's `**Requirements:** AIDA-09` line).

## Anti-Patterns Found

None. Scanned every file created/modified across all 6 plans (`src/lib/channels/email/*`, `src/lib/worker/jobs/email-*`, `src/lib/worker/index.ts`, `src/lib/tickets/create-ticket.ts`, `src/lib/queue/boss-client.ts`, `src/lib/crypto/secret-box.ts`, `src/app/(app)/settings/email/*`, `src/components/tickets/delivery-failed-chip.tsx`, `src/components/tickets/thread-message.tsx`) for TODO/FIXME/placeholder/stub markers, empty handlers, hardcoded-empty returns, and design-system violations (named Tailwind text sizes, hardcoded hex). None found. `wrapEmailSafeHtml`'s inline literal styles are an intentional, documented exception (email HTML must survive third-party mail clients — 03-UI-SPEC scope note), not a violation.

## Behavioral Verification (in lieu of live-server spot-checks)

This phase has no HTTP endpoints suitable for a quick curl spot-check (its surface is a background worker + a Settings form) — behavior was instead verified via the project's own real test suites, which is stronger evidence than a synthetic spot-check:

| Behavior | Command | Result | Status |
|---|---|---|---|
| Typecheck across all new/modified files | `pnpm exec tsc --noEmit` | 0 errors | ✓ PASS |
| Unit suite (secret-box, sanitize-email-html, parse-body, thread-match, compose-outbound, etc.) | `pnpm test` | 40/40 | ✓ PASS |
| Integration suite incl. real-MIME email-ingest fixtures against Testcontainers Postgres | `volta run --node 22.23.1 -- pnpm test:integration` | 20/20 (6 email-ingest scenarios) | ✓ PASS |
| Lint on new UI files | `pnpm exec biome check "src/app/(app)/settings/email" src/components/tickets/delivery-failed-chip.tsx` | clean | ✓ PASS |
| Worker module graph bundles (createTicket's `@/`-transitive imports resolve under esbuild) | exact Dockerfile esbuild command | 4.6MB bundle, exit 0 | ✓ PASS |
| Migration is additive-only | `grep searchVector prisma/migrations/20260706025051_email_channel/migration.sql` | 0 matches | ✓ PASS |
| All cited task commits exist | `git cat-file -e <hash>` × 20 | all present | ✓ PASS |

## Human Verification Required

Everything checkable by static analysis, typecheck, and automated test suites passes. Three items remain that only a human/UAT pass can confirm (consistent with the SUMMARYs' own "deferred to UAT" notes):

### 1. Real mailbox round-trip (GreenMail or a live IMAP/SMTP account)

**Test:** Point the Settings → Email tab at a real (or GreenMail-simulated) mailbox, enable the channel, send an email in, and post a public reply from a ticket.
**Expected:** The inbound poll (every minute) creates/threads a ticket within ~60s; the outbound reply arrives in the test mailbox as multipart/alternative with correct threading headers (visible In-Reply-To/References in the recipient's mail client).
**Why human:** No live SMTP/IMAP server is available in this environment; `ingestMessage()`/`emailOutboundSendHandler` are proven correct against real-MIME fixtures and mocked transports, but never against a real mail transport end-to-end.

### 2. Test Connection UX against a real misconfigured host

**Test:** In Settings → Email, enter a deliberately wrong IMAP/SMTP host and click Test Connection.
**Expected:** A visible "Connection failed: …" message appears within ~10 seconds (never a stuck spinner).
**Why human:** The 10s timeout wiring is code-verified (`timeoutMs: 10000` threaded through `createImapClient`/`createSmtpTransport`), but actual wall-clock behavior against a real unreachable host depends on network/DNS conditions this environment can't reproduce.

### 3. UI/visual review against DESIGN-SYSTEM.md §9 checklist

**Test:** Visually review the rendered Settings → Email tab (toggle, form, health banner, Test Connection states) and the thread's "Failed to send" chip in a browser.
**Expected:** Matches 03-UI-SPEC.md pixel/spacing/token intent; no visual regressions.
**Why human:** Token-usage and explicit-size conventions were grep-verified as present in the source (no violations found), but rendered visual fidelity (spacing, alignment, responsive wrap) requires eyes on a real browser — this is the standard "design-check" step of the phase loop (per CLAUDE.md) and is explicitly still pending per STATE.md's "Next action" note.

## Gaps Summary

No gaps. All 30 must-haves (across 6 plans), all 3 ROADMAP Success Criteria, all 27 required artifacts, and all 15 key links are verified present, substantive, and wired in the actual codebase — not just claimed in SUMMARYs. The full automated gate (tsc, 40 unit tests, 20 integration tests including 6 real-MIME email-ingest scenarios, biome, and the exact Docker esbuild worker-bundle command) passes. The only remaining work is the UI-review/UAT pass against a real mailbox, which is a human/manual step by design (no live IMAP/SMTP server exists in this environment) and does not block phase-goal achievement in code.

---
*Verified: 2026-07-06T04:58:32Z*
*Verifier: Claude (gsd-verifier)*
