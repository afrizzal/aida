# Phase 3: Email Channel - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Real email support as the default channel for a CS helpdesk: inbound email creates a ticket or threads onto an existing one (via headers, with a subject-token fallback), an agent's public reply is delivered outbound via SMTP and recorded in the thread, and IMAP/SMTP config lives in Settings with failures surfaced (never silent).

**NOT in scope (deferred, see below):** provider inbound webhooks (Postmark/Mailgun/SES), IMAP IDLE/push, multi-mailbox routing, admin-configurable poll interval, quoted history in outbound replies, OAuth mailbox auth.

</domain>

<decisions>
## Implementation Decisions

### Inbound mechanism & polling
- **D-01:** Pluggable channel architecture — ship **IMAP polling only** in v1 (works with any provider/self-hosted mailbox via app password/basic auth); shape `lib/channels/email` so a future webhook adapter (Postmark/Mailgun/SES) can be added later without a rewrite.
- **D-02:** Inbound mail is checked via a **recurring pg-boss job** — reuses the exact heartbeat/SLA-flag job pattern from Phases 1–2. No persistent IMAP IDLE connection.
- **D-03:** Poll interval = **every 1 minute**, fixed in v1 (not admin-configurable).
- **D-04:** **One inbound mailbox per workspace/organization** — matches the existing per-workspace `Setting` model already used for SLA/tags/AI config. No multi-mailbox routing in v1.
- **D-05:** **Idempotency** — store each email's RFC Message-ID (+ IMAP UID); dedupe on Message-ID before ingest so re-polls or worker restarts never double-create tickets/messages.
- **D-06:** Poll fetches **UNSEEN only**; mark `\Seen` **only after successful ingest**. On failure: leave unread, log the error, retry next poll. A **poison-message guard** skips a message after N consecutive failures and records the error (never an infinite retry loop on one bad message).
- **D-07:** IMAP/SMTP credentials are **org-scoped Settings, encrypted at rest** with the same AES-256-GCM mechanism SECURITY.md specifies for provider keys (non-negotiable). This is the **first phase to implement that encryption helper** — Phase 4's LLM provider keys will reuse it.

### Threading & auto-reply safety
- **D-08:** Primary threading — match inbound `In-Reply-To`/`References` headers against stored Message-IDs. Every inbound AND outbound Message stores its own Message-ID.
- **D-09:** Fallback threading — a ticket-number token in the subject. Outbound subjects are `Re: {subject} [#{number}]`; inbound parsing regexes the `[#N]` token when header matching misses.
- **D-10:** If both header and subject-token matching miss → **create a new ticket via the existing `createTicket()` single entrypoint** (Phase 2 pattern), contact auto-linked by normalized email (Phase 2 D-07).
- **D-11:** An inbound reply to a RESOLVED/CLOSED ticket **mirrors Phase 2's auto-reopen exactly** (02-12) — same-transaction status flip + `Message.triggeredReopen` marker, rendered via the existing `ThreadSystemEvent` row (02-09).
- **D-12:** Auto-generated mail detection: `Auto-Submitted != no` (RFC 3834), `X-Auto-Response-Suppress`, `Precedence: bulk/junk/auto_reply`, null `Return-Path <>`, `multipart/report` (bounce/DSN), `List-Id` present.
- **D-13:** Auto-generated mail **NEVER creates a new ticket and NEVER triggers auto-reopen**. If it threads to an existing ticket it's appended as a normal inbound message (agent still sees it) — it's excluded only from ticket-creation and reopen triggers.
- **D-14:** **Self-loop guard** — ignore mail whose sender is the workspace's own configured inbound/outbound address.
- **D-15:** v1 sends **zero automated outbound email** (no auto-acknowledgment on ticket creation) — mail loops are **structurally impossible**, not just heuristically filtered. Human-initiated agent replies are exempt from all auto-reply suppression logic.

### Email body & attachments
- **D-16:** Preserve the Phase 2 "one sanitization authority" invariant — add **`sanitizeEmailHtml()`** in the SAME module as `renderMarkdown()` (`src/lib/markdown/render.ts`), reusing the same `rehype-sanitize` schema family.
- **D-17:** Inbound HTML → `sanitizeEmailHtml()` → `Message.bodyHtml`; the text/plain part (or an html-to-text fallback when only HTML exists) → `Message.bodyMarkdown` (used for FTS indexing and reply quoting). A plain-text-only inbound email uses the existing `renderMarkdown()` path unchanged.
- **D-18:** **Privacy-first** — strip remote images (`http`/`https` `img src`) from inbound HTML so tracking pixels never fire when an agent opens a ticket.
- **D-19:** Inline `cid:` images are saved as **Attachments** (reusing the existing FileStorage + file-type sniff + `ALLOWED_MIME`/`MAX_BYTES` limits from Phase 2) and `cid:` references are rewritten to the authenticated attachment-serving route.
- **D-20:** Regular (non-inline) attachments reuse the Phase 2 Attachment model and limits as-is; oversized or disallowed files are **dropped with a visible note appended to the message** (never silently discarded).

### Outbound send & config surfacing
- **D-21:** Sending runs as a **pg-boss job** (exponential-backoff retry, ~3 attempts) — never inline in the Server Action. The Message row is created immediately (Phase 2 flow unchanged); add a `deliveryStatus` field (`QUEUED`/`SENT`/`FAILED`) with a visible **"Failed to send — Retry"** affordance on the thread message.
- **D-22:** Outbound MIME = `multipart/alternative`: `text/plain` is the agent's raw Markdown; `text/html` is `renderMarkdown()` output wrapped in a minimal email-safe HTML wrapper. **No quoted history appended in v1** — threading headers plus the recipient's own mail client preserve context.
- **D-23:** Outbound headers — a generated Message-ID is stored on the row; `In-Reply-To` = the latest inbound Message-ID for that ticket; `References` chain capped (~last 10 Message-IDs). `From` = the configured mailbox address; display name = the workspace name.
- **D-24:** Settings gets a new **admin-gated Email tab** (same pattern as SLA/Tags/Custom Fields, `requireOrgAdmin()`): IMAP section, SMTP section, from-address — each with a real **"Test connection"** action reporting inline success/failure (not just save-and-hope).
- **D-25:** The worker persists `lastPollAt`/`lastPollError` to org-scoped Settings; the Email tab shows that health line. Failures are surfaced in **two places** — a per-message FAILED chip in the thread, and the Settings health line — never silent (Success Criterion 3).
- **D-26:** The email channel is **fully optional/toggleable**; everything shipped in Phase 2 keeps working with it off.

### Claude's Discretion
- Library choice for IMAP fetch/SMTP send/MIME parsing — **mailparser + nodemailer recommended** by the maintainer; an IMAP client library (e.g. imapflow) still needs picking for the fetch side.
- Exact retry counts/backoff caps beyond "~3 attempts" (outbound) and "poison-message guard after N failures" (inbound).
- Naming of the new Message field(s) for RFC Message-ID/In-Reply-To/References — **must NOT collide** with the existing `Attachment.messageId` FK name (e.g. use `emailMessageId`).
- Exact shape of the AES-256-GCM encryption helper (env var name for the app key, key-rotation strategy).
- Minimal email-safe HTML wrapper styling for the outbound text/html part.
- Poison-message guard's exact failure-count threshold.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & data model
- `docs/ARCHITECTURE.md` — `lib/channels`: pluggable intake (web-form, email); "Email (IMAP/SMTP) is reached by the worker for inbound polling / outbound send" topology note.
- `.planning/phases/01-foundation/01-CONTEXT.md` — pg-boss worker pattern (D-16), `organizationId`/`scopedDb` tenancy (D-04/D-15).
- `.planning/phases/02-core-ticketing/02-CONTEXT.md` — D-06 (ticket number chosen specifically to support an email-subject fallback), D-11 (Markdown→sanitized-HTML pipeline), D-22/D-23 (Attachment/FileStorage model) — this phase's deferred section names Phase 3 as the consumer of these choices.
- `.planning/phases/02-core-ticketing/02-01-PLAN.md`, `02-09-PLAN.md`, `02-12-PLAN.md`/`02-12-SUMMARY.md` — `Message.triggeredReopen` field + auto-reopen wiring (`ThreadSystemEvent`) that this phase's inbound auto-reopen (D-11) must mirror exactly.
- `prisma/schema.prisma` — current `Message`, `Setting`, `Attachment` model shapes (verified during discussion). No RFC-Message-ID-style field exists yet on `Message` — must be added with a name that doesn't collide with `Attachment.messageId`.

### Security
- `docs/SECURITY.md` — "LLM provider API keys, email credentials, and other secrets are encrypted at rest (AES-256-GCM via an app key from env/secret store)" — binding constraint for IMAP/SMTP credential storage (D-07); "Ticket subjects, bodies, and email content are untrusted" — governs D-16–D-20 (sanitization, remote-image stripping).

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — AIDA-09 full acceptance statement.
- `.planning/ROADMAP.md` — Phase 3 goal + the 3 success criteria that gate completion.

### Project rules
- `CLAUDE.md` — stack non-negotiables (pg-boss not Redis, single-server, human-in-the-loop, privacy-first/no-egress) — directly governs D-01 (IMAP-only, no mandatory third-party webhook) and D-18 (remote-image stripping).
- `.planning/DESIGN-SYSTEM.md` — the Settings Email tab UI must conform (token-only, explicit `text-[Npx]` sizing) — applies to D-24.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/markdown/render.ts` — `renderMarkdown()`, the shared `rehype-sanitize` schema, and `rehypeSafeLinks()`. D-16 adds `sanitizeEmailHtml()` alongside these, reusing the same schema.
- `src/lib/attachments/` (local file storage, file-type sniff, `ALLOWED_MIME`/`MAX_BYTES`, `buildStorageKey`/`safeKey`) — reused as-is for email attachments (D-19/D-20).
- `src/lib/worker/jobs/heartbeat.ts` — the recurring pg-boss job shape to copy for the inbound-poll job (D-02); the SLA-flag job (Phase 2) already follows this same shape.
- `src/app/(app)/settings/{sla,tags,custom-fields}/` + `settings-nav.tsx` — the exact tab/page/Server-Action pattern (with `requireOrgAdmin()`) to copy for the new Email settings tab (D-24).
- `src/lib/tickets/create-ticket.ts` `createTicket(orgId, input)` — the ONE ticket-creation entrypoint; inbound email that doesn't thread must call this, not a second ad hoc path (D-10).

### Established Patterns
- Tenant scoping: `organizationId` + `scopedDb(orgId)`; `Setting` is already in `scopedDb`'s `DOMAIN_MODELS` allowlist.
- pg-boss v12: `createQueue()` before `work()`/`schedule()`; handler destructures `([job]: Job[]) =>`; worker uses relative imports only (no `@/`).
- `Message` already has `direction` (INBOUND/OUTBOUND), `visibility` (PUBLIC/INTERNAL), `triggeredReopen` — Phase 3 adds email-specific fields to this same model rather than a parallel `EmailMessage` table.

### Integration Points
- Settings nav (`src/app/(app)/settings/settings-nav.tsx`) gets a new "Email" entry alongside AI Features/SLA Policies/Tags/Custom Fields.
- Worker entrypoint gets a third recurring job (heartbeat, SLA-flag, now inbound-poll).
- Docker/self-host: no new service needed — IMAP/SMTP are outbound connections the worker makes to the operator's mail server; the v1 IMAP-only path requires no inbound port/webhook exposure.

</code_context>

<specifics>
## Specific Ideas

- "IMAP/SMTP config screen must have a real Test Connection button, not just Save" (D-24).
- "Auto-reply loops must be structurally impossible" — v1 sends zero automated outbound mail (no auto-ack on ticket creation), so combined with Auto-Submitted/Precedence detection, ticket storms can't happen even if detection has a gap (D-15).
- mailparser + nodemailer explicitly named by the maintainer as the intended libraries.

</specifics>

<deferred>
## Deferred Ideas

- Provider inbound webhooks (Postmark/Mailgun/SES) — later; `lib/channels/email` is shaped to add this without a rewrite (D-01).
- IMAP IDLE / push-based inbound — later; v1 is poll-only (D-02).
- Multi-mailbox / per-address routing rules — later; v1 is one mailbox per workspace (D-04).
- Admin-configurable poll interval — later; v1 hardcodes 1 minute (D-03).
- Quoted history in outbound replies — later; v1 relies on threading headers + the recipient's own client (D-22).
- OAuth-based mailbox auth (Gmail/O365 OAuth) — not discussed explicitly; v1 assumes basic-auth/app-password IMAP+SMTP per D-07. Flag for a future phase if a self-hoster needs it.

</deferred>

---

*Phase: 03-email-channel*
*Context gathered: 2026-07-05*
