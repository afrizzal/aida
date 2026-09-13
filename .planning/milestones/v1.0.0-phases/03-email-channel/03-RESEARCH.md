# Phase 3: Email Channel - Research

**Researched:** 2026-07-06
**Domain:** IMAP polling / SMTP send / MIME parsing / at-rest credential encryption (Node.js + Next.js 16 + pg-boss + Prisma 7)
**Confidence:** HIGH (library APIs verified via Context7 official docs + npm registry; a few implementation-shape recommendations are marked MEDIUM/discretionary since CONTEXT.md left them open)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Inbound mechanism & polling**
- **D-01:** Pluggable channel architecture — ship **IMAP polling only** in v1 (works with any provider/self-hosted mailbox via app password/basic auth); shape `lib/channels/email` so a future webhook adapter (Postmark/Mailgun/SES) can be added later without a rewrite.
- **D-02:** Inbound mail is checked via a **recurring pg-boss job** — reuses the exact heartbeat/SLA-flag job pattern from Phases 1–2. No persistent IMAP IDLE connection.
- **D-03:** Poll interval = **every 1 minute**, fixed in v1 (not admin-configurable).
- **D-04:** **One inbound mailbox per workspace/organization** — matches the existing per-workspace `Setting` model already used for SLA/tags/AI config. No multi-mailbox routing in v1.
- **D-05:** **Idempotency** — store each email's RFC Message-ID (+ IMAP UID); dedupe on Message-ID before ingest so re-polls or worker restarts never double-create tickets/messages.
- **D-06:** Poll fetches **UNSEEN only**; mark `\Seen` **only after successful ingest**. On failure: leave unread, log the error, retry next poll. A **poison-message guard** skips a message after N consecutive failures and records the error (never an infinite retry loop on one bad message).
- **D-07:** IMAP/SMTP credentials are **org-scoped Settings, encrypted at rest** with the same AES-256-GCM mechanism SECURITY.md specifies for provider keys (non-negotiable). This is the **first phase to implement that encryption helper** — Phase 4's LLM provider keys will reuse it.

**Threading & auto-reply safety**
- **D-08:** Primary threading — match inbound `In-Reply-To`/`References` headers against stored Message-IDs. Every inbound AND outbound Message stores its own Message-ID.
- **D-09:** Fallback threading — a ticket-number token in the subject. Outbound subjects are `Re: {subject} [#{number}]`; inbound parsing regexes the `[#N]` token when header matching misses.
- **D-10:** If both header and subject-token matching miss → **create a new ticket via the existing `createTicket()` single entrypoint** (Phase 2 pattern), contact auto-linked by normalized email (Phase 2 D-07).
- **D-11:** An inbound reply to a RESOLVED/CLOSED ticket **mirrors Phase 2's auto-reopen exactly** (02-12) — same-transaction status flip + `Message.triggeredReopen` marker, rendered via the existing `ThreadSystemEvent` row (02-09).
- **D-12:** Auto-generated mail detection: `Auto-Submitted != no` (RFC 3834), `X-Auto-Response-Suppress`, `Precedence: bulk/junk/auto_reply`, null `Return-Path <>`, `multipart/report` (bounce/DSN), `List-Id` present.
- **D-13:** Auto-generated mail **NEVER creates a new ticket and NEVER triggers auto-reopen**. If it threads to an existing ticket it's appended as a normal inbound message (agent still sees it) — it's excluded only from ticket-creation and reopen triggers.
- **D-14:** **Self-loop guard** — ignore mail whose sender is the workspace's own configured inbound/outbound address.
- **D-15:** v1 sends **zero automated outbound email** (no auto-acknowledgment on ticket creation) — mail loops are **structurally impossible**, not just heuristically filtered. Human-initiated agent replies are exempt from all auto-reply suppression logic.

**Email body & attachments**
- **D-16:** Preserve the Phase 2 "one sanitization authority" invariant — add **`sanitizeEmailHtml()`** in the SAME module as `renderMarkdown()` (`src/lib/markdown/render.ts`), reusing the same `rehype-sanitize` schema family.
- **D-17:** Inbound HTML → `sanitizeEmailHtml()` → `Message.bodyHtml`; the text/plain part (or an html-to-text fallback when only HTML exists) → `Message.bodyMarkdown` (used for FTS indexing and reply quoting). A plain-text-only inbound email uses the existing `renderMarkdown()` path unchanged.
- **D-18:** **Privacy-first** — strip remote images (`http`/`https` `img src`) from inbound HTML so tracking pixels never fire when an agent opens a ticket.
- **D-19:** Inline `cid:` images are saved as **Attachments** (reusing the existing FileStorage + file-type sniff + `ALLOWED_MIME`/`MAX_BYTES` limits from Phase 2) and `cid:` references are rewritten to the authenticated attachment-serving route.
- **D-20:** Regular (non-inline) attachments reuse the Phase 2 Attachment model and limits as-is; oversized or disallowed files are **dropped with a visible note appended to the message** (never silently discarded).

**Outbound send & config surfacing**
- **D-21:** Sending runs as a **pg-boss job** (exponential-backoff retry, ~3 attempts) — never inline in the Server Action. The Message row is created immediately (Phase 2 flow unchanged); add a `deliveryStatus` field (`QUEUED`/`SENT`/`FAILED`) with a visible **"Failed to send — Retry"** affordance on the thread message.
- **D-22:** Outbound MIME = `multipart/alternative`: `text/plain` is the agent's raw Markdown; `text/html` is `renderMarkdown()` output wrapped in a minimal email-safe HTML wrapper. **No quoted history appended in v1** — threading headers plus the recipient's own mail client preserve context.
- **D-23:** Outbound headers — a generated Message-ID is stored on the row; `In-Reply-To` = the latest inbound Message-ID for that ticket; `References` chain capped (~last 10 Message-IDs). `From` = the configured mailbox address; display name = the workspace name.
- **D-24:** Settings gets a new **admin-gated Email tab** (same pattern as SLA/Tags/Custom Fields, `requireOrgAdmin()`): IMAP section, SMTP section, from-address — each with a real **"Test connection"** action reporting inline success/failure (not just save-and-hope).
- **D-25:** The worker persists `lastPollAt`/`lastPollError` to org-scoped Settings; the Email tab shows that health line. Failures are surfaced in **two places** — a per-message FAILED chip in the thread, and the Settings health line — never silent (Success Criterion 3).
- **D-26:** The email channel is **fully optional/toggleable**; everything shipped in Phase 2 keeps working with it off.

### Claude's Discretion
- Library choice for IMAP fetch/SMTP send/MIME parsing — **mailparser + nodemailer recommended** by the maintainer; an IMAP client library (e.g. imapflow) still needs picking for the fetch side. **→ Resolved below: imapflow.**
- Exact retry counts/backoff caps beyond "~3 attempts" (outbound) and "poison-message guard after N failures" (inbound).
- Naming of the new Message field(s) for RFC Message-ID/In-Reply-To/References — **must NOT collide** with the existing `Attachment.messageId` FK name (e.g. use `emailMessageId`).
- Exact shape of the AES-256-GCM encryption helper (env var name for the app key, key-rotation strategy).
- Minimal email-safe HTML wrapper styling for the outbound text/html part.
- Poison-message guard's exact failure-count threshold.

### Deferred Ideas (OUT OF SCOPE)
- Provider inbound webhooks (Postmark/Mailgun/SES) — later; `lib/channels/email` is shaped to add this without a rewrite (D-01).
- IMAP IDLE / push-based inbound — later; v1 is poll-only (D-02).
- Multi-mailbox / per-address routing rules — later; v1 is one mailbox per workspace (D-04).
- Admin-configurable poll interval — later; v1 hardcodes 1 minute (D-03).
- Quoted history in outbound replies — later; v1 relies on threading headers + the recipient's own client (D-22).
- OAuth-based mailbox auth (Gmail/O365 OAuth) — not discussed explicitly; v1 assumes basic-auth/app-password IMAP+SMTP per D-07.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AIDA-09 | Inbound email is parsed into a ticket (replies thread onto the existing ticket via message-id/headers); agents' public replies are delivered outbound via SMTP. | Standard Stack (imapflow/mailparser/nodemailer), Architecture Patterns (poll job, threading match, outbound send job), Code Examples (fetch-unseen loop, threading query, MIME compose), Common Pitfalls (Message-ID bracket consistency, poison-guard, encryption). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Single server / no new moving parts.** IMAP and SMTP are outbound TCP connections the worker/app make to the operator's own mail server — no new Docker service, no inbound port, no webhook receiver (directly satisfied by D-01's IMAP-only choice).
- **Queue = pg-boss only (no Redis).** The inbound poll job and the outbound send job must both be pg-boss jobs on the existing worker, following the exact `heartbeat.ts` shape already in the repo.
- **Model-agnostic / BYO is an AI-layer rule, not applicable here** — but the sibling rule **"never send data to any third party other than the user-configured LLM"** extends by project convention to email: IMAP/SMTP must only ever talk to the operator's own configured mail server, never a third-party relay baked into the product.
- **Privacy-first, encrypt secrets at rest.** IMAP/SMTP passwords are exactly the class of secret `docs/SECURITY.md` requires AES-256-GCM for. Never log credentials or raw email bodies at `info` level (SECURITY.md: "never logged").
- **Human-in-the-loop for customer-facing sends** — not directly triggered by this phase (no AI drafting yet), but D-15's "zero automated outbound email" is this project's concrete embodiment of that principle for the email channel: only a human-authored agent reply ever goes out.
- **Design system compliance (`.planning/DESIGN-SYSTEM.md`)** applies to the new Settings "Email" tab (token-only colors, explicit `text-[Npx]` sizing, admin-gated). It does **NOT** apply to the outbound HTML email wrapper itself — that HTML is rendered in the recipient's mail client, which cannot load Tailwind/CSS variables, so inline styles with literal color values are the correct (and only) approach there. Flag this distinction clearly so the design checklist isn't misapplied to email HTML.
- **Repo health / one-command self-host.** No new required environment variable should be able to break a fresh `docker compose up` — the email channel must default to disabled/unconfigured and the app must run fully without it (D-26).

## Summary

Phase 3 adds one new intake/outbound channel to an already-working ticketing core. The codebase gives strong existing scaffolding to extend rather than invent: a recurring pg-boss job pattern (`heartbeat.ts`), a single `createTicket()` entrypoint, a single Markdown→sanitized-HTML pipeline (`render.ts`), an `Attachment`/`FileStorage` abstraction, and a `Setting` key/value model already used for a per-org toggle (`aiEnabled`). Phase 3's job is almost entirely **wiring**, not new infrastructure — with three genuinely new pieces: (1) a small AES-256-GCM encryption helper (first use in the codebase, will be reused by Phase 4), (2) the **first time the Next.js app itself needs to enqueue a pg-boss job** rather than just the worker scheduling its own recurring jobs (outbound send is triggered from a Route Handler, not from a cron schedule), and (3) a new lightweight failure-tracking record for the poison-message guard (inbound ingest failures happen *before* a `Message` row exists, so they need their own tiny table).

For libraries: **imapflow** is the clear choice for the IMAP fetch side — MIT-licensed, ships its own TypeScript types, actively maintained (last publish the day before this research, 2026-07-05), and its `client.fetchOne()` + `client.search({ seen: false })` + `client.messageFlagsAdd(..., ['\Seen'])` API maps directly onto D-06's "fetch UNSEEN, mark Seen only after success" requirement. **mailparser** (`simpleParser`) and **nodemailer**, both maintainer-locked, cover MIME parsing and sending respectively, and both are from the same publisher (nodemailer org) so their header-normalization conventions agree (bracketed Message-IDs). One extra library is needed beyond what CONTEXT.md named: **html-to-text**, for the plain-text fallback in D-17 — it's already a transitive dependency of mailparser, but per this project's own established convention (hast-util-sanitize in Phase 2), it should be added as an **explicit** direct dependency rather than relying on hoisting.

**Primary recommendation:** imapflow (fetch) + mailparser (parse) + nodemailer (send) + html-to-text (plain-text fallback, explicit dep), a new `Message.emailMessageId`/`emailInReplyTo`/`emailReferences[]`/`deliveryStatus` field set, a new tiny `EmailIngestFailure` model for the poison guard, a `src/lib/crypto/secret-box.ts` AES-256-GCM helper reused verbatim by Phase 4, and a new `src/lib/queue/boss-client.ts` singleton so Route Handlers can `.send()` a one-off pg-boss job (not just the worker scheduling recurring ones).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `imapflow` | ^1.4.6 | IMAP fetch (poll UNSEEN, mark \Seen) | MIT license; ships native `.d.ts` (no `@types` package needed); actively maintained (published 2026-07-05, the day before this research); promise/async-iterator API (`search`, `fetchOne`, `messageFlagsAdd`) maps directly onto D-05/D-06's poll-and-dedupe flow; built by the same team (Postal Systems / EmailEngine) that maintains mailparser/nodemailer, so header-handling conventions are consistent. |
| `mailparser` | ^3.9.14 | MIME parsing of raw IMAP message source into headers/text/html/attachments | Maintainer-locked (per CONTEXT.md). `simpleParser()` gives structured `messageId`/`inReplyTo`/`references` (bracket-normalized), a `headers` Map for arbitrary headers (Auto-Submitted, Precedence, List-Id, X-Auto-Response-Suppress), and per-attachment `cid`/`content` for inline-image rewriting. |
| `nodemailer` | ^9.0.3 | SMTP send (multipart/alternative, custom headers, `verify()`) | Maintainer-locked. `MailComposer`/`sendMail()` natively builds `multipart/alternative`; `transporter.verify()` is exactly D-24's "Test connection" primitive; `headers`/`messageId`/`references`/`inReplyTo` options map directly onto D-23. License `MIT-0` (public-domain-equivalent, zero runtime deps). |
| `html-to-text` | ^10.0.0 | HTML→plain-text fallback (D-17, when inbound mail has no `text/plain` part) | Not named in CONTEXT.md but required by D-17. Already a transitive dependency of `mailparser` — add as an **explicit** direct dependency (mirrors the Phase 2 `hast-util-sanitize` precedent: pnpm's strict linking makes transitive-only packages unreliable for direct imports). `convert(html, options)` is a one-line call. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/nodemailer` | ^8.0.1 (devDependency) | TypeScript types for nodemailer | nodemailer ships no bundled `.d.ts`; add as devDependency. Version numbering doesn't track nodemailer's major 1:1 (this is normal for DefinitelyTyped packages) — spot-check that `SendMailOptions.headers`/`references`/`messageId` are typed as expected during Wave 0. |
| `@types/mailparser` | ^3.4.6 (devDependency) | TypeScript types for mailparser | Same reasoning — mailparser ships no bundled `.d.ts`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| imapflow | `node-imap` (mscdex) | Legacy, callback-based API; last meaningful activity years ago (npm metadata last-modified ~2020); `@types/node-imap` typings are stale; would need a promise-wrapper layer. Rejected — no upside over imapflow for a fresh v1 build. |
| imapflow | `node-imap` fork `@lovely-inbox/imap` (TS rewrite) | Smaller community, unproven at this project's bar for "standard/expert-recommended". Rejected in favor of the more established imapflow. |
| A dedicated `EmailIngestFailure` table for the poison guard | Track failure counts as a custom IMAP keyword flag (e.g. `$AidaRetry3`) | IMAP custom keyword ("flag") support is inconsistent across self-hosted/hosted providers, and flags can't hold a structured error message. Rejected — not portable, not testable without a real mailbox per provider. |
| A dedicated `EmailIngestFailure` table | In-memory counter in the worker process | Resets on worker restart, defeating the "never infinite retry loop across restarts" intent implicit in D-06's dedupe-across-restarts language. Rejected — DB-backed is consistent with this project's existing idempotency rigor (see `TicketCounter`, `RateLimitHit`). |
| GreenMail (integration test double) | Mailpit / MailDev | Mailpit and MailDev are SMTP-capture-only (no IMAP retrieval) — they can verify outbound send but cannot simulate the inbound-poll path at all. GreenMail is Java-based but supports SMTP **and** IMAP **and** POP3 in one container, which is required to integration-test D-01–D-06 end-to-end. Docker is available in this environment (Docker Desktop 29.5.2 confirmed) and `greenmail/standalone:latest` is a real, pullable image — recommended as a Testcontainers fixture alongside the existing Postgres Testcontainers setup. |

**Installation:**
```bash
pnpm add imapflow mailparser nodemailer html-to-text
pnpm add -D @types/nodemailer @types/mailparser
```

**Version verification (2026-07-06, via `npm view`):**
| Package | Latest | License | Notes |
|---|---|---|---|
| imapflow | 1.4.6 | MIT | published 2026-07-05 (1 day before this research) |
| mailparser | 3.9.14 | MIT | ships `html-to-text@10.0.0` as a transitive dep |
| nodemailer | 9.0.3 | MIT-0 | zero runtime deps |
| html-to-text | 10.0.0 | MIT | requires Node >=20.19.0 (project requires >=22, fine) |
| @types/nodemailer | 8.0.1 | — | devDependency |
| @types/mailparser | 3.4.6 | — | devDependency |

## Architecture Patterns

### Recommended Project Structure
```
src/lib/
├── channels/
│   └── email/
│       ├── imap-client.ts       # thin ImapFlow factory from decrypted Settings
│       ├── smtp-client.ts       # thin nodemailer transporter factory from decrypted Settings
│       ├── poll-inbox.ts        # D-01–D-06: fetch UNSEEN, dedupe, ingest-or-fail, mark \Seen
│       ├── ingest-message.ts    # parse → thread-match → sanitize/attach → createTicket() or append
│       ├── auto-generated.ts    # D-12/D-13: RFC 3834 + Precedence + List-Id + bounce detection
│       ├── thread-match.ts      # D-08/D-09: header match, then [#N] subject-token fallback
│       ├── compose-outbound.ts  # D-22/D-23: multipart/alternative + headers
│       └── settings.ts          # typed getEmailSettings()/saveEmailSettings() over Setting rows
├── crypto/
│   └── secret-box.ts            # D-07: AES-256-GCM encrypt/decrypt helper (Phase 4 reuses this)
├── queue/
│   └── boss-client.ts           # NEW: app-side singleton PgBoss client for one-off .send()
└── worker/jobs/
    ├── email-inbound-poll.ts    # recurring job, mirrors heartbeat.ts shape
    └── email-outbound-send.ts   # one-off job, enqueued by the messages Route Handler
```

### Pattern 1: Recurring inbound-poll job (mirrors `heartbeat.ts`)
**What:** A pg-boss recurring job, scheduled every minute, that polls the configured mailbox for UNSEEN messages.
**When to use:** D-02/D-03.
**Example (grounded in the actual `heartbeat.ts`/`worker/index.ts` shape already in this repo):**
```typescript
// src/lib/worker/jobs/email-inbound-poll.ts (relative imports only — worker is esbuild-bundled)
import { pollInbox } from "../../channels/email/poll-inbox";

export async function emailInboundPollHandler(_data?: unknown): Promise<void> {
  await pollInbox(); // iterates all orgs with email channel enabled (v1: effectively one org)
}
```
```typescript
// src/lib/worker/index.ts — add a THIRD recurring job, same shape as sla-flag/rate-limit-cleanup,
// but use the "singleton" queue policy so an overrunning poll (slow IMAP server) never overlaps
// with the next minute's scheduled run — heartbeat/sla-flag/rate-limit-cleanup don't need this
// because they're idempotent set-based SQL, but an IMAP session mid-flight is stateful.
await boss.createQueue("email-inbound-poll", { policy: "singleton" });
await boss.work("email-inbound-poll", async ([job]: Job[]) => {
  await emailInboundPollHandler(job.data);
});
await boss.schedule("email-inbound-poll", "* * * * *", {});
```
Source: pg-boss docs confirm `policy: "singleton"` = "allows only one active job" (github.com/timgit/pg-boss/blob/master/docs/api/queues.md via Context7 `/timgit/pg-boss`).

### Pattern 2: Fetch-UNSEEN-then-mark-Seen (D-06)
**What:** Search for UNSEEN, fetch full source, ingest, mark `\Seen` only on success.
**Example:**
```typescript
// Source: ImapFlow README + usage-examples (Context7 /postalsys/imapflow)
const client = new ImapFlow({ host, port, secure, auth: { user, pass } });
await client.connect();
const lock = await client.getMailboxLock("INBOX");
try {
  const uids = await client.search({ seen: false }, { uid: true }); // D-06: UNSEEN only
  for (const uid of uids) {
    const msg = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
    try {
      await ingestMessage(msg.source); // parse, dedupe, thread, createTicket/append
      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true }); // ONLY after success
    } catch (err) {
      await recordIngestFailure(uid, err); // poison-guard counter — see EmailIngestFailure below
      // leave unread; next poll retries (unless failure threshold reached)
    }
  }
} finally {
  lock.release();
  await client.logout();
}
```
Note: `fetchOne`'s internal body fetches already use `BODY.PEEK` (never auto-marks `\Seen` as a side effect of fetching) — confirmed in imapflow's own source comments — so explicit `messageFlagsAdd` is the only place `\Seen` gets set.

### Pattern 3: Threading match (D-08/D-09/D-10)
**What:** Match inbound `In-Reply-To`/`References` against stored `Message.emailMessageId`; fall back to a `[#N]` subject token; else create a new ticket.
**Example:**
```typescript
// mailparser normalizes these to bracketed strings already, e.g. "<abc123@mail.example.com>"
const candidateIds = [parsed.inReplyTo, ...(parsed.references ?? [])].filter(Boolean);

let ticket = candidateIds.length
  ? await findTicketByEmailMessageId(orgId, candidateIds) // WHERE emailMessageId IN (...)
  : null;

if (!ticket) {
  const match = parsed.subject?.match(/\[#(\d+)\]/);
  if (match) ticket = await findTicketByNumber(orgId, Number(match[1]));
}

if (!ticket) {
  // D-10: no match at all → the ONE ticket-creation entrypoint, never a second ad hoc path
  const result = await createTicket(orgId, { subject: parsed.subject, ... });
}
```
**Critical consistency detail:** when *generating* outbound Message-IDs (for nodemailer's `messageId` option), construct them in the SAME bracketed format mailparser produces on the way in (e.g. `` `<${cuid()}@${mailDomain}>` ``) and store that exact bracketed string in `Message.emailMessageId`. If outbound IDs are stored unbracketed while inbound `In-Reply-To`/`References` arrive bracketed, string-equality matching silently breaks threading for every reply. This is the single highest-value "get it right the first time" detail in this phase.

### Pattern 4: Outbound compose (D-22/D-23)
**Example:**
```typescript
// Source: Nodemailer docs (Context7 /nodemailer/nodemailer) — MailComposer / sendMail
await transporter.sendMail({
  from: { name: organizationName, address: configuredFromAddress },
  to: contact.email,
  subject: `Re: ${ticket.subject} [#${ticket.number}]`, // D-09 fallback token
  text: message.bodyMarkdown, // raw agent Markdown
  html: wrapEmailSafeHtml(renderMarkdown(message.bodyMarkdown)), // D-22
  messageId: emailMessageId, // bracketed, generated, stored on the Message row
  inReplyTo: latestInboundEmailMessageId ?? undefined, // D-23
  references: referencesChain.slice(-10).join(" "), // D-23: capped ~last 10
});
```
nodemailer auto-produces `multipart/alternative` whenever both `text` and `html` are supplied (confirmed via `MailComposer` docs — `contentType` resolves to `'multipart/alternative'`).

### Pattern 5: App-side one-off job enqueue (NEW — no existing precedent in this repo)
**What:** Phase 1/2's three recurring jobs (`heartbeat`, `sla-flag`, `rate-limit-cleanup`) are all scheduled by the **worker process itself** via `boss.schedule()`. Phase 3's outbound send is different: it must be enqueued **on demand, from the Next.js app**, the moment an agent posts a public reply — a `grep` of `src/` confirms `pg-boss`/`PgBoss` is currently imported ONLY in `src/lib/worker/index.ts`. The app has never needed a live `PgBoss` client before.
**Recommendation:** mirror the `src/lib/db.ts` Prisma singleton pattern exactly (same `globalThis`-caching trick for Next.js dev hot-reload safety), but cache a `Promise<PgBoss>` since `.start()` is async:
```typescript
// src/lib/queue/boss-client.ts — imports via "@/lib/..." (Next.js webpack bundling, NOT
// the worker's relative-import esbuild convention — this file is never bundled by esbuild)
import { PgBoss } from "pg-boss";

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  boss.on("error", (err) => console.error("[app] pg-boss error:", err));
  await boss.start();
  await boss.createQueue("email-outbound-send", {
    retryLimit: 2,        // D-21: "~3 attempts" = 1 initial + 2 retries
    retryBackoff: true,   // exponential backoff
    retryDelayMax: 300,   // cap at 5 minutes between attempts
  });
  return boss;
}

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) globalForBoss.boss = createBoss();
  if (process.env.NODE_ENV !== "production") globalForBoss.boss = globalForBoss.boss;
  return globalForBoss.boss;
}
```
```typescript
// Integration point: src/app/api/tickets/[id]/messages/route.ts, inside the existing
// transaction block, only for mode === "public" AND email channel enabled:
const boss = await getBoss();
await boss.send("email-outbound-send", { messageId: message.id });
```
`retryLimit`/`retryBackoff`/`retryDelayMax` are documented queue-creation options (Context7 `/timgit/pg-boss`, `docs/api/queues.md`); `retryLimit: 2` gives 3 total attempts (1 initial + 2 retries), matching D-21's "~3 attempts" exactly.

### Pattern 6: Auto-generated mail detection (D-12)
```typescript
// mailparser's headers Map lowercases all keys and is safe to .get() defensively.
function isAutoGenerated(parsed: ParsedMail): boolean {
  const autoSubmitted = String(parsed.headers.get("auto-submitted") ?? "no").toLowerCase();
  if (autoSubmitted !== "no") return true; // RFC 3834 §5.2: "auto-generated" | "auto-replied"

  if (parsed.headers.has("x-auto-response-suppress")) return true;

  const precedence = String(parsed.headers.get("precedence") ?? "").toLowerCase();
  if (["bulk", "junk", "auto_reply", "list"].includes(precedence)) return true;

  const returnPath = parsed.headers.get("return-path");
  if (returnPath && String(returnPath).trim() === "<>") return true; // null return-path = bounce

  const contentType = parsed.headers.get("content-type") as { value?: string } | undefined;
  if (contentType?.value === "multipart/report") return true; // DSN/bounce (RFC 3464)

  // List-Id: mailparser aggregates List-* headers into a single "list" object keyed by
  // sub-type (list.id / list.post / list.unsubscribe). Spot-check the exact shape during
  // Wave 0 (see Open Questions) — the safest belt-and-suspenders check also scans the raw
  // headerLines for a "list-id:" line so detection doesn't silently depend on one parsed shape.
  if (parsed.headers.get("list")?.id) return true;
  if (parsed.headerLines?.some((h) => h.key === "list-id")) return true;

  return false;
}
```

### Anti-Patterns to Avoid
- **Second `dangerouslySetInnerHTML` / second sanitize pass:** Every inbound HTML body MUST go through `sanitizeEmailHtml()` in `src/lib/markdown/render.ts` — never sanitize inline in the ingest module. This is the exact anti-pattern the Phase 2 team already guarded against for agent-authored Markdown (STATE.md 02-02).
- **Calling `.start()` on a fresh `PgBoss` instance per request:** `.start()` runs pg-boss's own schema migrations/setup — doing this on every Route Handler invocation is slow and racy. Always use the singleton in Pattern 5.
- **Storing IMAP/SMTP passwords as plain `Setting.value` strings:** every credential field must go through the `secret-box.ts` encrypt/decrypt helper before touching the `Setting` table (D-07, non-negotiable per SECURITY.md).
- **Trusting `mailparser`'s `html`/`text` fields for tracking-pixel safety:** `sanitizeEmailHtml()` must actively strip `<img src="http(s)://...">` — mailparser does not do this for you (it's a parser, not a sanitizer).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME parsing (headers, multipart, encodings, charsets) | A regex-based email parser | `mailparser`'s `simpleParser()` | RFC 2045/2047/822 MIME parsing (base64/quoted-printable, charset decoding, multipart boundaries) is notoriously easy to get subtly wrong; mailparser handles it as a stream with low overhead and is the de facto standard in the Node ecosystem. |
| MIME composition (multipart/alternative, header folding) | Hand-built MIME string concatenation | `nodemailer`'s `sendMail()`/`MailComposer` | Correct header folding/encoding for non-ASCII subjects, boundary generation, and `Content-Transfer-Encoding` selection is easy to get wrong in ways that only surface in specific mail clients. |
| HTML→plain-text conversion | A naive `.replace(/<[^>]+>/g, "")` tag stripper | `html-to-text`'s `convert()` | Handles block-level line breaks, lists, tables, and entity decoding correctly; a naive stripper produces unreadable FTS-indexed text and broken reply-quoting. |
| AES-256-GCM encryption | A hand-rolled cipher wrapper without an auth tag, or ECB/CBC mode | Node's built-in `node:crypto` `createCipheriv("aes-256-gcm", ...)` + `getAuthTag()`/`setAuthTag()` | GCM's authentication tag is what prevents ciphertext tampering; omitting it (or reusing an IV) turns "encrypted at rest" into a false sense of security. This is exactly the SECURITY.md-mandated mechanism — there is no library to reach for here, just the correct built-in API usage (see Common Pitfalls). |
| IMAP protocol handling (tagged commands, literals, IDLE) | A raw TCP client against the IMAP wire protocol | `imapflow` | IMAP's tagged-response/literal-length protocol is fiddly to implement correctly (partial reads, continuation responses); imapflow already handles reconnection, TLS, and the full command set. |

**Key insight:** every "don't hand-roll" item in this table already has a maintained, MIT-licensed, TypeScript-friendly library available — the actual planning risk in this phase is not "which library" (already resolved) but **correct wiring**: bracket-consistent Message-ID matching, mark-Seen-after-not-before ingest, and never storing a credential unencrypted even transiently in a log line.

## Common Pitfalls

### Pitfall 1: Message-ID bracket-format mismatch breaks threading silently
**What goes wrong:** Inbound `In-Reply-To`/`References` arrive from mailparser already wrapped in angle brackets (`<id@host>`) because mailparser's header processing specifically "formats message identity headers with angle brackets." If the outbound Message-ID generator stores the ID *without* brackets (e.g., just a cuid), or nodemailer's `messageId` option is passed without brackets, later inbound replies will never string-match against the stored value.
**Why it happens:** It's easy to generate outbound IDs as a bare cuid/UUID and forget the wire format requires `<...>`.
**How to avoid:** Always construct outbound Message-IDs as `` `<${id}@${domain}>` `` and store that exact bracketed string in `Message.emailMessageId`. Write a Wave-0 unit test asserting round-trip equality: generate an ID, pass it through nodemailer's compose step, parse the resulting raw MIME with mailparser, and assert `parsed.messageId === original`.
**Warning signs:** Threading silently degrades to the `[#N]` subject-token fallback for every single reply (looks like it "works" via the fallback, masking the header-match bug).

### Pitfall 2: AES-256-GCM IV reuse or missing auth tag
**What goes wrong:** Reusing the same IV for multiple encryptions with the same key breaks GCM's confidentiality guarantee; forgetting to persist/verify the auth tag turns "authenticated encryption" into plain encryption (silently accepts tampered ciphertext).
**Why it happens:** Copy-pasting a hardcoded/derived IV, or storing only the ciphertext and dropping the tag to "save space."
**How to avoid:** Generate a fresh `crypto.randomBytes(12)` IV per encryption call; pack `iv + authTag + ciphertext` into one opaque blob (fits the existing `Setting.value: String` column with zero schema changes) so they can never be separated. Verified pattern (multiple independent sources agree): 12-byte/96-bit IV is the GCM-recommended size, `cipher.getAuthTag()` after `cipher.final()`, `decipher.setAuthTag()` **before** `decipher.final()`.
**Warning signs:** Decryption throws `Unsupported state or unable to authenticate data` — this is GCM correctly detecting either a wrong key/IV or (rarer) real tampering; never silently swallow this error and fall back to plaintext.

### Pitfall 3: Prisma migration touching the hand-written `searchVector` columns
**What goes wrong:** `Message` already has a hand-written `GENERATED ALWAYS AS (to_tsvector('english', coalesce("bodyMarkdown", '')))` column (`searchVector`) added via a raw migration OUTSIDE `schema.prisma` (STATE.md 02-01: "dodges three known Prisma diff-engine bugs around `GENERATED ALWAYS` columns"). Adding new `Message` fields (`emailMessageId`, `emailInReplyTo`, `emailReferences`, `deliveryStatus`) via `prisma migrate dev` generates a fresh migration — this has a documented history of Prisma's diff engine mishandling generated columns on this exact table.
**Why it happens:** Prisma's introspection sees a column on `Message` it doesn't manage; usually it just ignores it, but this project has already hit generator-diff bugs here once.
**How to avoid:** After running `prisma migrate dev`, manually read the generated `migration.sql` before applying and confirm it contains ONLY `ADD COLUMN` statements for the new fields — no `DROP COLUMN "searchVector"` or index changes. This is a review step, not a new library.
**Warning signs:** Migration file contains any `searchVector` or `Message_searchVector_idx` reference.

### Pitfall 4: Poison-guard failure counter needs its own storage (failures happen before a `Message` row exists)
**What goes wrong:** D-06's poison-message guard ("skip after N consecutive failures") sounds like it could piggyback on the `Message` table, but ingest failures (parse error, DB error, attachment-save error) happen **before** any `Message` row is created for that email — there's nothing to attach a counter to yet.
**Why it happens:** The natural instinct is "just add a field to Message," but a failed ingest, by definition, never reaches the point of creating one.
**How to avoid:** Add a small dedicated model keyed by `(organizationId, emailMessageId)` that increments on each ingest failure and records the last error; the poll loop checks this before attempting ingest and skips (but still marks `\Seen`, logging permanently-poisoned status) once the threshold is hit. Recommended threshold: 5 (project has no existing precedent to match; this is a reasonable, documentable default consistent with the "~3 attempts" order of magnitude used for outbound send retries, biased slightly higher since inbound failures may be transient network/IMAP issues rather than data issues).
**Warning signs:** A single malformed email causes the poll job to error every minute forever, or (worse) never marks `\Seen`, so every subsequent poll re-attempts the same message alongside genuinely new mail.

### Pitfall 5: Server Actions / Route Handlers for IMAP/SMTP "Test connection" need explicit timeouts
**What goes wrong:** A misconfigured host/port (typo, firewalled port, wrong TLS setting) can leave a raw TCP connection attempt hanging far longer than a user will wait on a Settings page, since neither `ImapFlow` nor `nodemailer` apply an aggressive default connection timeout.
**Why it happens:** Default socket timeouts in Node are effectively "OS default" (often 2+ minutes) unless explicitly configured.
**How to avoid:** Pass explicit `connectionTimeout`/`socketTimeout` (nodemailer) and imapflow's own timeout options when constructing test-connection clients — e.g., 8–10 seconds — so a bad config fails fast with a clear inline error rather than a spinner that never resolves.
**Warning signs:** The "Test connection" button spins indefinitely on a bad host instead of surfacing an error.

### Pitfall 6: `html-to-text` must be an explicit dependency, not relied on transitively
**What goes wrong:** `mailparser` already depends on `html-to-text@10.0.0` internally, so `require("html-to-text")` may resolve today via pnpm's node_modules layout — but this project's pnpm setup uses strict linking (documented Phase 2 pitfall: "pnpm's strict `node_modules` linking makes transitive-only packages unresolvable for direct type imports," which forced `hast-util-sanitize` to become an explicit devDependency).
**Why it happens:** It "works" in whichever environment happens to hoist it, then breaks in a fresh clone/CI/Docker build with strict pnpm resolution.
**How to avoid:** Add `html-to-text` to `package.json` `dependencies` explicitly (already recommended above in Standard Stack) — don't rely on it resolving via mailparser's own `node_modules`.

## Code Examples

### AES-256-GCM secret-box helper (D-07)
```typescript
// src/lib/crypto/secret-box.ts
// Source: Node.js crypto module (createCipheriv/createDecipheriv), cross-verified against
// multiple independent AES-256-GCM Node.js reference implementations (WebSearch, MEDIUM-HIGH
// confidence — this is a stable, unchanged Node crypto API, not version-sensitive).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;   // 96-bit — GCM-recommended IV size
const TAG_LENGTH = 16;  // GCM auth tag is always 16 bytes

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is required to encrypt/decrypt secrets");
  const key = Buffer.from(raw, "base64"); // matches this repo's existing `openssl rand -base64 32` convention
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32)");
  }
  return key;
}

// Packs iv + authTag + ciphertext into one opaque base64 string — fits the existing
// `Setting.value: String` column with ZERO schema changes required for credential storage.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(packed: string): string {
  const raw = Buffer.from(packed, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag); // MUST be called before .final()
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```
**Env var:** `.env.example` should add, matching the existing `BETTER_AUTH_SECRET`/`RATE_LIMIT_PEPPER` convention exactly:
```
# --- Email channel credential encryption (AIDA-09, first consumer; Phase 4 LLM keys reuse this) ---
# Generate with: openssl rand -base64 32
APP_ENCRYPTION_KEY=replace-me-with-a-random-32-byte-base64-key
```
**Key-rotation strategy (discretionary — recommend for v1):** ship with a single active key and NO rotation support; document this as a known v1 limitation. Leave room for a future versioned scheme (e.g. prefixing the packed string with a key-id byte) without over-building it now — rotation was explicitly left to discretion and isn't required for AIDA-09.

### Settings key scheme (reuses the existing `Setting` key/value model — zero schema change)
Following the exact `aiEnabled` precedent (`src/app/(app)/settings/actions.ts`), add a namespaced set of keys (namespacing is a deliberate small extension since this phase introduces ~10 new keys vs. the single existing `aiEnabled`):
```
email:enabled          "true" | "false"
email:fromAddress       string
email:imapHost          string
email:imapPort          string (parse to number)
email:imapSecure        "true" | "false"
email:imapUser          string
email:imapPasswordEnc   output of encryptSecret()
email:smtpHost          string
email:smtpPort          string
email:smtpSecure        "true" | "false"
email:smtpUser          string
email:smtpPasswordEnc   output of encryptSecret()
email:lastPollAt        ISO-8601 string (D-25)
email:lastPollError     string, cleared to "" on next successful poll (D-25)
```
No separate "from name" setting is needed — D-23 already specifies display name = the workspace/organization name, so read `organization.name` directly at send time.

### Threading lookup query shape
```typescript
// findFirst, not findMany — first match wins; scopedDb auto-injects organizationId
const ticket = await db.message.findFirst({
  where: { emailMessageId: { in: candidateIds } },
  select: { ticketId: true },
}).then((m) => m ? db.ticket.findFirst({ where: { id: m.ticketId } }) : null);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `node-imap` (mscdex), callback-based IMAP client | `imapflow`, promise/async-iterator IMAP client with native TS types | node-imap has seen no meaningful maintenance in recent years; imapflow has been the community's de facto successor for several years and remains actively published (2026-07-05) | Cleaner async/await code, native TypeScript, `BODY.PEEK`-by-default fetch semantics that align with D-06's "don't mark Seen on fetch" requirement without extra flags. |
| Persistent IMAP IDLE connection for "real-time" inbound | Poll-based `search({ seen: false })` on a fixed interval | N/A — this project deliberately chose poll for v1 (D-02); IDLE remains available in imapflow for a future phase | Poll is simpler to reason about (fits the existing recurring-pg-boss-job architecture exactly), at the cost of up-to-1-minute latency — an explicit, accepted v1 tradeoff, not a technical limitation of the chosen library. |
| Manual multipart MIME string building | `nodemailer`'s `MailComposer`/`sendMail()` | Long-standing (not a recent change) | Correct RFC 2045 encoding/boundary handling without hand-rolling. |

**Deprecated/outdated:** `node-imap` for new projects — superseded by `imapflow` for TypeScript-first, actively maintained Node IMAP work.

## Open Questions

1. **Exact shape of mailparser's `list` header object for `List-Id` detection**
   - What we know: mailparser aggregates `List-Post`/`List-Unsubscribe`/etc. into a single `list` object keyed by sub-type (`post`, `unsubscribe`, ...), confirmed via official docs' `parseListHeader(key, value)` examples showing `{ post: { mail } }` / `{ unsubscribe: { url } }` shapes.
   - What's unclear: the docs don't show a concrete example specifically for `List-Id` (as opposed to `List-Post`/`List-Unsubscribe`), so whether it surfaces as `list.id` with a `{ id: '...' }` sub-shape, or under a differently-named key, isn't 100% pinned down from documentation alone.
   - Recommendation: during Wave 0, write a one-off unit test that feeds a raw `.eml` fixture containing a `List-Id:` header through `simpleParser()` and logs `parsed.headers.get("list")` to confirm the exact shape before wiring `isAutoGenerated()`. The Code Examples section above already includes a defensive fallback (scanning raw `headerLines` for a `list-id:` key) so detection doesn't depend on getting this 100% right the first time.

2. **Poison-message guard failure threshold**
   - What we know: CONTEXT.md explicitly left the exact number to discretion; this research recommends 5 (see Pitfall 4), reasoning from the outbound "~3 attempts" order of magnitude, biased upward since inbound polling failures are more likely transient (IMAP hiccup) than a permanently malformed message.
   - What's unclear: no project precedent to anchor this number to (first phase needing this exact pattern).
   - Recommendation: 5 consecutive failures, configurable as a named constant (not hardcoded inline) so it's trivially tunable without a migration.

3. **Whether `deliveryStatus` should be a Prisma enum or a plain string**
   - What we know: existing enums in the schema (`TicketStatus`, `MessagePriority`-style fields) are all Prisma enums; D-21 specifies exactly three values (`QUEUED`/`SENT`/`FAILED`).
   - What's unclear: nothing substantive — this is a straightforward enum, flagged only so the planner explicitly adds `enum MessageDeliveryStatus { QUEUED SENT FAILED }` and a nullable `deliveryStatus MessageDeliveryStatus?` field (null for any non-email-channel message: internal notes, web-form-originated messages, pre-Phase-3 historical messages).
   - Recommendation: nullable enum field, as stated.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Testcontainers-based integration tests (GreenMail fixture) | ✓ | Docker Desktop 29.5.2 (client) | — |
| `greenmail/standalone` image | Integration-testing D-01–D-06 (IMAP) and D-21–D-23 (SMTP) end-to-end without real mail credentials | ✓ (manifest resolves; not yet pulled locally) | `latest` tag confirmed pullable | If pulling is impractical in CI, fall back to unit-testing `poll-inbox.ts`/`compose-outbound.ts` against fixture `.eml` files + a mocked `ImapFlow`/nodemailer transport, deferring the full-stack integration test to a manual pre-merge check. |
| Real IMAP/SMTP mailbox (for manual/UAT verification of D-24 "Test connection" against an actual provider) | Human sign-off / UAT, not automated tests | Not applicable to this research session (no operator mailbox credentials in this environment) | — | GreenMail (or any self-hosted Postfix/Dovecot) stands in for automated tests; manual UAT against a real provider (Gmail app-password, self-hosted Postfix, etc.) is a human-in-the-loop verification step outside this research's scope. |

**Missing dependencies with no fallback:** none — the phase's actual runtime dependency (an operator-configured IMAP/SMTP server) is by design something the *operator* supplies at deploy time, not something the dev/CI environment needs to provide.

**Missing dependencies with fallback:** GreenMail image not yet pulled locally — pull during Wave 0 setup (`docker pull greenmail/standalone:latest`) or let Testcontainers pull it lazily on first integration-test run (same pattern already used for the Postgres Testcontainers fixture).

## Sources

### Primary (HIGH confidence)
- Context7 `/postalsys/imapflow` — `search`, `fetchOne`/`fetch`, `messageFlagsAdd`, `getMailboxLock`, `BODY.PEEK` semantics, IDLE capability check.
- Context7 `/nodemailer/mailparser` — `ParsedMail` type shape, `headers` Map, `processHeaders` special-casing rules, `parseListHeader`, attachment/`cid` handling, `updateImageLinks`.
- Context7 `/nodemailer/nodemailer` — `MailComposer`/`sendMail` multipart/alternative behavior, `messageId`/`references`/`inReplyTo` options, `transporter.verify()`, `SMTPPool` retry/timeout options, custom `headers`.
- Context7 `/timgit/pg-boss` — `createQueue` options (`retryLimit`/`retryDelay`/`retryBackoff`/`retryDelayMax`/`deadLetter`), queue `policy` semantics (`standard`/`singleton`/`stately`/`exclusive`/`key_strict_fifo`), `schedule()`/`send()` signatures.
- Context7 `/html-to-text/node-html-to-text` — `convert(html, options)` API.
- `npm view` (registry, 2026-07-06) — verified current versions/licenses/engines for imapflow, mailparser, nodemailer, html-to-text, @types/nodemailer, @types/mailparser, node-imap.
- Direct repo inspection (this session): `prisma/schema.prisma`, `src/lib/worker/{index,jobs/heartbeat}.ts`, `src/lib/markdown/render.ts`, `src/lib/attachments/{constants,file-storage,local-file-storage}.ts`, `src/lib/tickets/create-ticket.ts`, `src/lib/scoped-db.ts`, `src/lib/db.ts`, `src/app/(app)/settings/**`, `src/app/api/tickets/[id]/messages/route.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`, `.env.example`, `package.json`.

### Secondary (MEDIUM confidence)
- RFC 3834 (datatracker.ietf.org) — fetched directly, confirmed exact `Auto-Submitted` values (`no`/`auto-generated`/`auto-replied`) and the suppression rule text.
- arp242.net/autoreply.html — practical cross-reference for `X-Auto-Response-Suppress`, `Precedence`, `List-Id`/`List-Unsubscribe` detection conventions (single source, but consistent with RFC 3834 for the header it overlaps on — cross-verified).
- RFC 2919 / RFC 3464 (via WebSearch summaries) — `List-Id` syntax and `multipart/report` + `report-type=delivery-status` bounce/DSN format.
- WebSearch (multiple independent sources: gist.github.com/rjz, coreui.io, node-security.com, dev.to) — AES-256-GCM Node.js pattern (12-byte IV, `getAuthTag()`/`setAuthTag()`, pack-together storage) — consistent across all sources, cross-verified against Node's stable `node:crypto` API from training knowledge.
- WebSearch — imapflow vs. node-imap maintenance/TypeScript comparison (cross-verified against direct `npm view` results: node-imap 0.9.6 vs. imapflow 1.4.6 published yesterday).
- WebSearch — GreenMail vs. Mailpit vs. MailDev protocol coverage comparison (cross-verified: `docker manifest inspect greenmail/standalone:latest` confirms the image is real and pullable).

### Tertiary (LOW confidence)
- Exact `mailparser` `list.id` sub-shape for `List-Id` specifically (as opposed to `List-Post`/`List-Unsubscribe`, which ARE documented with examples) — flagged explicitly in Open Questions with a defensive fallback already built into the recommended code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library verified via Context7 official docs + live npm registry version/license checks.
- Architecture: HIGH for patterns 1–4, 6 (directly grounded in this repo's existing code + official library docs); MEDIUM for pattern 5 (app-side pg-boss singleton) since it's a genuinely new pattern with no existing precedent in this repo to copy — reasoning is sound (mirrors the proven `lib/db.ts` singleton) but unverified in this codebase until implemented.
- Pitfalls: HIGH for Pitfalls 1, 3, 6 (grounded in this project's own documented history); MEDIUM for Pitfalls 2, 4, 5 (well-established general patterns, cross-verified across multiple sources, but not project-specific precedent).

**Research date:** 2026-07-06
**Valid until:** ~2026-08-05 (30 days) for library API surfaces (stable, low-churn libraries); re-verify `npm view` versions if planning is delayed more than a few weeks, since imapflow publishes frequently.
