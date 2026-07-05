# Phase 3: Email Channel - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-05
**Phase:** 03-email-channel
**Areas discussed:** Inbound mechanism & polling, Threading & auto-reply safety, Email body & attachments, Outbound send & config surfacing

---

## Inbound mechanism & polling

| Option | Description | Selected |
|--------|-------------|----------|
| IMAP polling | Any mailbox via app password; matches ARCHITECTURE.md; zero third-party dependency | |
| Provider inbound webhook | Postmark/Mailgun/SES inbound-parse; simpler parsing, mandatory third-party dependency | |
| Both (pluggable) | Ship IMAP now, shape `lib/channels/email` for a future webhook adapter | ✓ |

**User's choice:** Both (pluggable) — IMAP built now, webhook adapter left as a future extension point.

| Option | Description | Selected |
|--------|-------------|----------|
| Recurring poll job | pg-boss job every 1–2 min, reuses heartbeat/SLA job pattern | ✓ |
| IMAP IDLE (push) | Persistent connection, near-instant, new lifecycle pattern | |
| You decide | Claude picks simplest reliable approach | |

**User's choice:** Recurring poll job.

| Option | Description | Selected |
|--------|-------------|----------|
| Every 1 minute | Responsive, low mailbox load | ✓ |
| Every 5 minutes | Lower load | |
| Configurable in Settings | Admin sets interval | |

**User's choice:** Every 1 minute.

| Option | Description | Selected |
|--------|-------------|----------|
| One mailbox per workspace | Matches existing per-workspace Setting model | ✓ |
| Multiple mailboxes with routing rules | e.g. support@ / billing@ with different defaults | |

**User's choice:** One mailbox per workspace.

**Notes:** Maintainer then provided a comprehensive, pre-decided answer covering the remaining inbound details plus all 3 other selected areas in a single reply (see below), explicitly delegating rather than continuing question-by-question.

---

## Inbound (remaining details) — maintainer-provided, not re-asked

- Idempotency: store RFC Message-ID (+ IMAP UID) on the Message row; dedupe on Message-ID before ingest.
- Mark `\Seen` only after successful ingest; poll UNSEEN only; poison-message guard skips after N consecutive failures.
- IMAP/SMTP credentials = org-scoped Settings, encrypted at rest (same mechanism as LLM provider keys — non-negotiable).

**Selected:** All of the above, verbatim (see CONTEXT.md D-05, D-06, D-07). Verified against `prisma/schema.prisma` and `docs/SECURITY.md` — no conflicts found.

---

## Threading & auto-reply safety

- Primary threading: In-Reply-To/References matched against stored Message-IDs (every inbound + outbound Message stores its Message-ID).
- Fallback: ticket-number subject token `[#N]`, outbound subject `Re: {subject} [#{number}]`.
- Both miss → new ticket via existing `createTicket()`, contact auto-linked by normalized email.
- Inbound reply to RESOLVED/CLOSED mirrors 02-12's auto-reopen exactly.
- Auto-generated detection: Auto-Submitted (RFC 3834), X-Auto-Response-Suppress, Precedence bulk/junk/auto_reply, null Return-Path, multipart/report, List-Id.
- Auto-generated mail never creates a ticket or triggers reopen; still appended if it threads to an existing ticket.
- Self-loop guard: ignore mail from the workspace's own configured address.
- v1 sends zero automated outbound email — loops structurally impossible.

**Selected:** All of the above, verbatim (see CONTEXT.md D-08–D-15). Verified `Message.triggeredReopen` and 02-12/02-09 plans exist and match the described mechanism — no conflicts found.

---

## Email body & attachments

- `sanitizeEmailHtml()` added alongside `renderMarkdown()` in `src/lib/markdown/render.ts`, same rehype-sanitize schema family.
- Inbound HTML → `sanitizeEmailHtml()` → `bodyHtml`; text/plain (or html-to-text fallback) → `bodyMarkdown`. Plain-text email uses existing `renderMarkdown()` path.
- Strip remote images from inbound HTML (privacy-first, no tracking pixels).
- Inline cid: images saved as Attachments, cid: refs rewritten to the authenticated attachment route.
- Regular attachments reuse Phase 2 Attachment model/limits; oversized/disallowed files dropped with a visible note.

**Selected:** All of the above, verbatim (see CONTEXT.md D-16–D-20). Verified `src/lib/markdown/render.ts` module location and schema shape — no conflicts found.

---

## Outbound send & config surfacing

- Sending runs as a pg-boss job (exponential backoff, ~3 attempts), never inline. `deliveryStatus` (QUEUED/SENT/FAILED) with a "Failed to send — Retry" affordance.
- multipart/alternative: text/plain = raw Markdown, text/html = renderMarkdown() output in an email-safe wrapper. No quoted history in v1.
- Outbound headers: generated Message-ID stored; In-Reply-To = latest inbound Message-ID; References capped ~10. From = configured mailbox address, display name = workspace name.
- Settings → new admin-gated Email tab (IMAP/SMTP/from-address sections, each with a real "Test connection" action).
- Worker persists lastPollAt/lastPollError to Settings; shown as a health line. Failures surfaced via per-message FAILED chip + Settings health line.
- Email channel fully optional/toggleable.

**Selected:** All of the above, verbatim (see CONTEXT.md D-21–D-26). Verified Settings tab pattern (`sla`/`tags`/`custom-fields` + `settings-nav.tsx`) — no conflicts found.

---

## Claude's Discretion

- Library choice: mailparser + nodemailer recommended by maintainer; IMAP client library (e.g. imapflow) left to Claude.
- Exact retry counts/backoff caps and poison-message failure threshold.
- New Message field naming for RFC Message-ID/In-Reply-To/References (must avoid colliding with `Attachment.messageId`).
- AES-256-GCM encryption helper shape (env var, key rotation).
- Minimal email-safe HTML wrapper styling.

## Deferred Ideas

- Provider inbound webhooks (Postmark/Mailgun/SES) — later, pluggable adapter point left open.
- IMAP IDLE / push-based inbound — later.
- Multi-mailbox / per-address routing rules — later.
- Admin-configurable poll interval — later; v1 hardcodes 1 minute.
- Quoted history in outbound replies — later.
- OAuth-based mailbox auth — not explicitly discussed; flagged for a future phase if needed.
