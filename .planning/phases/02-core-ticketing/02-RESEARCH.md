# Phase 2: Core Ticketing - Research

**Researched:** 2026-07-01
**Domain:** Multi-tenant ticketing data model (Prisma 7 + Postgres 16) — full-text search, concurrency-safe sequencing, Markdown sanitization, local file uploads, SLA background jobs
**Confidence:** HIGH for library/version choices and Postgres patterns; MEDIUM for a few Prisma-extension edge cases flagged below (need a Wave-0 smoke check, not a full research blocker)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 2-pane "Shared Inbox" inside the existing Tickets route — scrollable ticket list column (left) + detail/reading pane (right). No third column.
- **D-02:** Saved views (Unassigned, Mine, by Status) render as filter chips/tabs above the list. Fixed v1 view set, not user-savable.
- **D-03:** Flexible status model — `new / open / pending / resolved / closed`; any-to-any transition via dropdown, no enforced linear order.
- **D-04:** Auto-reopen — a new message from the requester on a `resolved`/`closed` ticket resets status to `open` (applies to public status-page follow-up and future email replies).
- **D-05:** Priority scale = Low / Normal / High / Urgent (4 levels). Priority drives SLA targets. Customers never set priority on the web form.
- **D-06:** Human-friendly sequential ticket number (e.g. `#1001`), auto-incrementing per workspace, is the primary UI/search/future-email reference. A stable internal cuid is used for DB relations and (per D-06 wording) "the secure public status link" — see Open Questions for a security clarification recommendation on this point.
- **D-07:** Auto-create/auto-link contacts by normalized (lowercased) email during intake. Missing fields fill in over time.
- **D-08:** Contact fields: name, email (dedup key), phone, company/organization, free-form Notes. Searchable Contacts list + dedicated contact detail page with full ticket history (AIDA-03).
- **D-09:** Duplicate detection + merge tooling deferred.
- **D-10:** Single composer, bottom of thread, segmented Public Reply / Internal Note toggle. Public = neutral/system colors; internal note = amber-tinted background + lock icon + "Internal Note" label (AIDA-04).
- **D-11:** Composer format = Markdown, rendered to sanitized HTML in the thread, for both replies and notes. Mandatory sanitization (untrusted input).
- **D-12:** Thread is chronological (inbound + outbound + notes), supports per-message attachments (AIDA-07).
- **D-13:** 24/7 calendar clock — targets measured in elapsed wall-clock time from creation. Business-hours/holiday/timezone explicitly deferred; SLA-policy data model must be shaped so business-hours can layer on later without a rewrite.
- **D-14:** Per-priority SLA targets (first-response + resolution) configured by admins in Settings (AIDA-12), with seeded sensible defaults (illustrative only — planner picks final numbers).
- **D-15:** Breach surfacing via color-coded due chip ("Due in 2h" → amber "At risk" → red "Overdue"). A recurring pg-boss job periodically evaluates target timestamps and stamps `isAtRisk`/`isBreached` flags on the ticket. Reuses the heartbeat pattern.
- **D-16:** Free-form tagging — agents create tags on the fly with autocomplete of existing workspace tags. Tickets filterable by tag.
- **D-17:** Tag management interface in Settings (AIDA-12) — admins rename/delete tags globally.
- **D-18:** Admin-defined custom fields in Settings: Short Text, Dropdown (Select), Number, Checkbox, Date (AIDA-05). Fields render in ticket detail and are integrated into inbox filtering.
- **D-19:** Public web form collects Name, Email, Subject, Message, Attachments → creates/links Contact + creates Ticket with initial thread message. Route Handler, zod-validated. No category/priority picker.
- **D-20:** Spam protection = hidden honeypot field + strict server-side per-IP rate limiting on the submit route. Fully self-contained — no third-party CAPTCHA, no external calls. Same guard on the public status-page follow-up composer.
- **D-21:** Tokenized public status page at `/status/[secure-token]` (token derived from ticket cuid / a dedicated unguessable token). Unauthenticated. Shows status + public thread only (internal notes excluded) + follow-up composer. Follow-up appends + triggers auto-reopen (D-04). No customer login.
- **D-22:** Local storage on a dedicated Docker volume (e.g. `/data/uploads`), served through an authenticated, workspace-scoped route (never a public static path). Lightweight `FileStorage` interface so S3-compatible storage can be added later.
- **D-23:** Limits: 10MB per file + strict MIME-type allowlist (Phase 2). Reject on the server, not just the client.

### Claude's Discretion

- **Full-text search:** use PostgreSQL FTS (tsvector) — single-server, no Redis. Scope of indexed fields is discretion; default to ticket subject + message bodies + ticket number.
- **Assignment:** individual-agent assignment only (AIDA-04) — dropdown to a workspace member; no teams/groups, no round-robin/auto-assign in v1.
- **Bulk actions:** deferred — not in Phase 2.
- Fixed vs savable views: v1 ships fixed set (D-02).
- Loading/empty/error states, exact spacing/typography (DESIGN-SYSTEM.md), skeletons, optimistic updates, pagination/virtualization approach.
- Exact seeded SLA default numbers; the periodic job's cadence.
- `scopedDb` `DOMAIN_MODELS` allowlist extension for all new models.

### Deferred Ideas (OUT OF SCOPE)

- Email intake/threading + outbound SMTP (Phase 3, AIDA-09).
- Business-hours/holiday/timezone SLA calendars.
- Contact duplicate-merge tooling.
- Bulk inbox actions.
- User-savable custom views.
- Category/request-type picker on the public form.
- CAPTCHA as an optional toggle.
- S3-compatible attachment storage (interface only, not the adapter).
- Teams/groups, round-robin/auto-assignment.
- AI on tickets (Phases 4-6) — zero LLM code in Phase 2.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| AIDA-01 | Create ticket (subject, body, priority), lifecycle `new→open→pending→resolved→closed` persists | Ticket/Contact/Message schema sketch, concurrency-safe ticket-number transaction pattern (Topic 2) |
| AIDA-02 | Shared inbox with saved views, filter, full-text search | Postgres FTS design — generated tsvector columns, GIN index, `websearch_to_tsquery`, org-safe raw-query wrapper (Topic 1) |
| AIDA-03 | Every ticket linked to a contact; contact detail shows ticket history | Contact model (D-07/D-08), `@@unique([organizationId, email])` dedup pattern |
| AIDA-04 | Assign to agent; public reply vs private internal note, visually distinct | Message model (visibility enum), Markdown→sanitized-HTML pipeline (Topic 3) |
| AIDA-05 | Tags + filterable custom fields (5 core types) | Tag/TicketTag model, CustomFieldDefinition/CustomFieldValue EAV design (Secondary topic) |
| AIDA-06 | SLA timers (first-response/resolution) from priority/policy, breach/at-risk indicator | SlaPolicy + Ticket duration/due-timestamp model (Secondary topic), pg-boss SLA-flag job (Secondary topic) |
| AIDA-07 | Chronological thread with file attachments | Attachment model, `FileStorage` interface, Route Handler upload/serve pattern (Topic 4) |
| AIDA-08 | Public web form creates ticket; submitter gets confirmation + status link | Public intake Route Handler, honeypot + Postgres rate-limit table (Secondary topic), tokenized status page (Open Questions) |
| AIDA-12 (partial) | Settings surfaces for SLA policies, tags, custom fields | Data model for all three admin surfaces (Secondary topics) |

</phase_requirements>

## Summary

Phase 2 is a data-modeling and Postgres-idiom phase more than a new-library phase — three of the four priority topics (FTS, ticket numbering, SLA flags) are solved with plain PostgreSQL features plus careful Prisma-7 workarounds, not new npm packages. The one place a new dependency is genuinely warranted is Markdown→sanitized-HTML rendering, where the `unified`/`remark`/`rehype` ecosystem (specifically `rehype-sanitize`) is the correct, currently-maintained choice — it composes naturally with Markdown-source input (no DOM/jsdom needed, unlike DOMPurify-based options) and produces portable HTML that Phase 3's email channel can reuse directly.

The two biggest correctness traps in this phase are (1) **Prisma 7's inability to safely manage `GENERATED ALWAYS AS ... STORED` tsvector columns via `migrate dev`** — the fix is to keep the FTS columns entirely outside `schema.prisma` (hand-written migration only, queried only via `$queryRaw`) — and (2) **`scopedDb`'s `$extends` query hooks never touch raw SQL**, so any hand-written search query MUST manually filter `organizationId` or it becomes a cross-tenant data leak. Ticket numbering is solved with the same "atomic row" idiom already proven safe in Postgres: a per-org counter row updated with `upsert`/`UPDATE ... RETURNING` inside the ticket-creation transaction — never `count() + 1`.

**Primary recommendation:** Model FTS as two invisible-to-Prisma `GENERATED ALWAYS AS (...) STORED` tsvector columns (`Ticket.searchVector`, `Message.searchVector`) with GIN indexes, queried only through one reviewed `searchTickets(orgId, query)` raw-SQL helper; generate ticket numbers via a `TicketCounter` row upserted inside the same transaction as `Ticket.create`; render Markdown with `unified + remark-parse + remark-rehype + rehype-sanitize + rehype-stringify`; and implement all attachment-bearing endpoints (public intake, agent composer, status-page follow-up) as Route Handlers using the native `request.formData()` API — never Server Actions, which default-cap bodies at 1MB.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `prisma` / `@prisma/client` | 7.8.0 (already installed) | ORM, migrations | Locked in Phase 1; no change |
| `unified` | 11.0.5 | Pipeline processor that chains remark/rehype plugins | The canonical Markdown-processing core used by MDX, Next.js docs, GitHub-adjacent tooling |
| `remark-parse` | 11.0.0 | Markdown → mdast (Markdown AST) | Standard unified parser for CommonMark |
| `remark-gfm` | 4.0.1 | GitHub-Flavored-Markdown extensions (tables, strikethrough, autolinks, task lists) | Composer users will type GFM syntax by habit; cheap to support |
| `remark-rehype` | 11.1.2 | mdast → hast (HTML AST) bridge | Standard bridge step in the unified pipeline |
| `rehype-sanitize` | 6.0.0 | Allowlist-based HTML sanitizer operating on the HAST tree | Purpose-built for this exact pipeline; no DOM/jsdom dependency (see Alternatives) |
| `rehype-stringify` | 10.0.1 | hast → HTML string | Standard unified serializer |
| `file-type` | 22.0.1 | Magic-byte MIME sniffing for uploaded files | Only trustworthy way to verify a file's real type server-side (see Don't Hand-Roll) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `hast-util-sanitize` | 5.0.2 (peer of rehype-sanitize) | Exposes `defaultSchema` for customizing the sanitizer allowlist | Only if you need to extend `defaultSchema` (e.g. `a[target]`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `unified`/`remark`/`rehype` pipeline | `marked` (18.0.5) + `sanitize-html` (2.17.5) | `marked` is a fast, simple single-pass Markdown→HTML converter with a much smaller API surface; pair with `sanitize-html` (Node-native, no DOM) for sanitization. Perfectly viable, slightly less standards-compliant on edge-case CommonMark, and two independently-versioned libraries to keep in sync rather than one coherent plugin pipeline. Reasonable fallback if the team prefers a smaller dependency footprint. |
| `rehype-sanitize` | `isomorphic-dompurify` (3.18.0, wraps `dompurify` 3.4.11 + `jsdom` 29.1.1) | Requires a JSDOM window even on the server; in a long-running Node process (this app's `worker`/`app` services run indefinitely) the internal jsdom window accumulates state and needs explicit `clearWindow()` calls to avoid slow memory growth. Also means parsing Markdown and sanitizing HTML happen in two unrelated ecosystems instead of one pipeline. Only worth it if the team specifically wants DOMPurify's sanitization semantics. |
| Generated-column + GIN index FTS | Prisma `Unsupported("tsvector")` field declared directly in `schema.prisma` | Documented Prisma bugs (#24180, #24496) cause `prisma migrate dev` to clobber `GENERATED ALWAYS` columns/DEFAULT clauses on unrelated schema changes. Viable only with strict discipline (`migrate dev --create-only` + manual edit every time), which is fragile across contributors on an open-source project. |
| Per-org counter row (`UPDATE...RETURNING`/upsert) | Per-org Postgres `SEQUENCE` object | Requires dynamic `CREATE SEQUENCE "seq_org_<id>"` DDL at org-creation time — extra migration-time coupling to org lifecycle, harder to express in Prisma migrations, no practical benefit over a row-level atomic update at this scale. |
| Postgres-backed rate limiting | `express-rate-limit`-style in-memory limiter | Works today because `docker-compose.yml` runs exactly one `app` replica (D-09), but resets on every restart/deploy and doesn't fit the project's "everything lives in Postgres" self-host philosophy. Postgres-backed costs one extra table and is restart-safe. |

**Installation:**
```bash
pnpm add unified remark-parse remark-gfm remark-rehype rehype-sanitize rehype-stringify file-type
```

**Version verification:** All versions above were confirmed against the npm registry on 2026-07-01 via `npm view <package> version`. `prisma`/`@prisma/client` stay pinned at 7.8.0 (already installed, matches `package.json`). No installed dependency needs a version bump for this phase.

---

## Architecture Patterns

### Recommended Module Structure (additions to existing `src/lib/`)

```
src/lib/
├── tickets/
│   ├── create-ticket.ts        # transaction: TicketCounter upsert + Ticket.create
│   ├── search.ts                # searchTickets(orgId, query) — the ONLY raw-SQL FTS call site
│   ├── sla.ts                   # computeDueTimestamps(priority, policy) helper
│   └── status-token.ts          # generateStatusToken() — crypto.randomBytes, not the ticket id
├── contacts/
│   └── find-or-create-contact.ts  # normalized-email lookup/create (D-07)
├── markdown/
│   └── render.ts                # renderMarkdown(md): { html, plain? } — shared by replies + notes
├── attachments/
│   ├── file-storage.ts          # FileStorage interface
│   ├── local-file-storage.ts    # Docker-volume implementation
│   └── constants.ts             # MAX_BYTES, ALLOWED_MIME allowlist
├── rate-limit/
│   └── check-rate-limit.ts      # Postgres-backed hit-counter (D-20)
└── worker/jobs/
    └── sla-flag.ts               # mirrors heartbeat.ts shape (D-15)
```

New route groups:
```
src/app/api/public/intake/route.ts         # POST — public web form (D-19), unauthenticated
src/app/status/[token]/page.tsx            # public status page (D-21), unauthenticated
src/app/api/public/status/[token]/follow-up/route.ts  # POST — follow-up reply, unauthenticated
src/app/api/attachments/[id]/route.ts      # GET — authenticated, workspace-scoped file serving
src/app/api/attachments/upload/route.ts    # POST — authenticated, used by the internal composer
```

`middleware.ts` `PUBLIC_PREFIXES` must be extended: add `/status`, `/api/public` (the file currently allows `/login`, `/setup`, `/api/auth`, `/api/health`).

---

## Topic 1 — Multi-tenant Postgres Full-Text Search (AIDA-02)

**RECOMMENDATION:** Two `GENERATED ALWAYS AS (...) STORED` `tsvector` columns with GIN indexes, created and maintained by Postgres itself (no application code, no triggers to hand-write), declared **only in a hand-written SQL migration — never in `schema.prisma`** — and queried exclusively through one `$queryRaw` helper that manually enforces `organizationId`.

### Why not declare the column in `schema.prisma`

Prisma has two confirmed, still-open issues relevant here:
- [prisma/prisma#24180](https://github.com/prisma/prisma/issues/24180): `prisma migrate dev` **removes** custom SQL (a `GENERATED ALWAYS` column + its GIN index) on the very next unrelated migration, because Prisma's diff engine doesn't understand `GENERATED` expressions.
- [prisma/prisma#24496](https://github.com/prisma/prisma/issues/24496): if the column IS declared via `Unsupported("tsvector")` in the schema, Prisma incorrectly tries to strip the `DEFAULT`/`GENERATED` clause on the next migration.
- [prisma/prisma#8950](https://github.com/prisma/prisma/issues/8950) / [#12334](https://github.com/prisma/prisma/issues/12334): "indexes using a function (such as `to_tsvector`) to determine the indexed value are not yet supported by Prisma ORM" — confirmed still true; functional/expression indexes are invisible to `prisma db pull`.

**The workaround that avoids all three bugs:** don't model the tsvector columns or their GIN indexes in `schema.prisma` at all. A hand-written migration file that Prisma's migration history replays (via `prisma migrate deploy`/`dev`/`reset`) is completely safe — Prisma only computes drift between the migration history and `schema.prisma`; if a field is absent from **both**, there is nothing to diff and nothing gets dropped. This is the same category of trick commonly used for Postgres triggers, views, and RLS policies that Prisma doesn't model. The tradeoff: the column is genuinely invisible to Prisma Client's generated types — that's fine, because it's read/written exclusively as raw SQL anyway.

### Migration SQL (hand-written, `prisma/migrations/<timestamp>_ticket_search/migration.sql`)

```sql
-- Ticket: ticket number (exact-token weight A) + subject (natural-language weight B)
ALTER TABLE "Ticket"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("number"::text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce("subject", '')), 'B')
  ) STORED;

CREATE INDEX "Ticket_searchVector_idx" ON "Ticket" USING GIN ("searchVector");

-- Message: body text (searched via EXISTS join from Ticket, see query below)
ALTER TABLE "Message"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("bodyMarkdown", ''))
  ) STORED;

CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");
```

Notes:
- `'simple'` config for the ticket number (no stemming/stopwords — exact token matching for `#1001`-style search); `'english'` for subject/body (stemming so "cancelled" matches "cancel").
- Indexing the raw Markdown source (not a stripped-plaintext version) for message bodies is an acceptable v1 simplification — markdown punctuation (`#`, `*`, `` ` ``, `[`/`]`) is treated as token-separator noise by the tsvector parser and has negligible effect on relevance.
- `pg-boss` and `pgvector` already prove Postgres extensions/DDL work cleanly through this project's migration pipeline (Phase 1) — this is the same mechanism, no new infra.

### Query pattern (org-safe)

```typescript
// src/lib/tickets/search.ts — the ONLY place that runs this raw query
import { prisma } from "@/lib/db";

export interface TicketSearchRow {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
}

export async function searchTickets(
  orgId: string,
  queryText: string,
  limit = 25,
): Promise<TicketSearchRow[]> {
  return prisma.$queryRaw<TicketSearchRow[]>`
    SELECT t.id, t.number, t.subject, t.status, t.priority
    FROM "Ticket" t
    WHERE t."organizationId" = ${orgId}
      AND (
        t."searchVector" @@ websearch_to_tsquery('english', ${queryText})
        OR EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."ticketId" = t.id
            AND m."searchVector" @@ websearch_to_tsquery('english', ${queryText})
        )
      )
    ORDER BY ts_rank(t."searchVector", websearch_to_tsquery('english', ${queryText})) DESC
    LIMIT ${limit};
  `;
}
```

- **`websearch_to_tsquery`** (not `to_tsquery`/`plainto_tsquery`) is deliberate: it parses free-form user input (quoted phrases, `OR`, `-exclude`) without throwing a syntax error the way `to_tsquery` does on malformed input — the right choice for a search box fed by end users.
- **CRITICAL — the org-scoping gotcha the planner must not miss:** `scopedDb`'s `$extends` `query` component (`src/lib/scoped-db.ts`) only intercepts the named CRUD methods (`findMany`, `findFirst`, `count`, `create`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`). It does **not** intercept `$queryRaw`/`$queryRawUnsafe`/`$executeRaw` — Prisma's extension query-hooks never fire for raw client-level methods. This means `searchTickets()` MUST take `orgId` as an explicit parameter and filter it in the SQL, as shown above. **Never** add a second call site that writes raw SQL against `Ticket`/`Message` without this filter — that is a direct cross-tenant leak, structurally identical to the exact bug class Phase 1's AIDA-11 isolation test was written to catch. Always use the tagged-template form (`prisma.$queryRaw\`...\``, not `$queryRawUnsafe` with string concatenation) so interpolated values are parameterized by Prisma automatically (SQL-injection-safe).
- Ranking here only ranks by the ticket's own vector (ticket-number/subject match); a ticket that matches only via a message body still surfaces (via the `EXISTS` clause) but is ranked by its own (possibly zero) ticket-vector score. This is an acceptable v1 simplification — combining ranking across ticket+message vectors is possible later with a `GROUP BY`/`MAX()` aggregate if search quality complaints arise.

---

## Topic 2 — Concurrency-Safe Per-Workspace Ticket Number (D-06, AIDA-01)

**RECOMMENDATION:** Option (a) — a per-org counter row (`TicketCounter`), incremented via `upsert` inside the same interactive transaction that creates the `Ticket`. Reject `count() + 1` outright; reject per-org Postgres `SEQUENCE` objects as unnecessary DDL complexity for this scale.

### Why `count() + 1` races

`SELECT COUNT(*) FROM "Ticket" WHERE organizationId = $1` followed by `INSERT ... (number) VALUES (count + 1)` is a classic read-then-write race: two concurrent public-form submissions both read `count = 41`, both compute `42`, and either the unique constraint on `(organizationId, number)` throws (best case — a retry storm) or, without that constraint, two tickets silently share `#42`. This is confirmed general Postgres concurrency guidance, not Prisma-specific.

### Why the counter-row `UPDATE`/`upsert` pattern is safe

An `UPDATE`/`upsert` against a single row is naturally serialized by Postgres's row-level locking under the default `READ COMMITTED` isolation level: the first transaction to reach the row takes an exclusive row lock; any concurrent transaction targeting the same row blocks until the first commits or rolls back, then proceeds against the now-updated value. No explicit `SELECT ... FOR UPDATE` or advisory lock is needed — the atomic `UPDATE ... SET n = n + 1` (or `INSERT ... ON CONFLICT DO UPDATE`, which Prisma's `upsert` compiles to) IS the serialization point. This is the standard, well-documented idiom for Postgres hit-counters/sequence-like columns.

### Schema

```prisma
model TicketCounter {
  organizationId String @id
  lastNumber     Int    @default(0)
  organization   organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```

### Transaction pattern

```typescript
// src/lib/tickets/create-ticket.ts
export async function createTicket(
  db: ScopedDb, // from getScopedDb() — see gotcha below re: extension propagation
  orgId: string,
  input: CreateTicketInput,
) {
  return db.$transaction(async (tx) => {
    const counter = await tx.ticketCounter.upsert({
      where: { organizationId: orgId }, // scopedDb re-injects the same value; harmless, no compound-key conflict
      create: { lastNumber: 1 },        // organizationId auto-injected by the scopedDb create hook
      update: { lastNumber: { increment: 1 } },
    });

    const now = new Date();
    return tx.ticket.create({
      data: {
        number: counter.lastNumber,
        statusToken: generateStatusToken(),
        subject: input.subject,
        priority: input.priority,
        contactId: input.contactId,
        firstResponseTargetMinutes: input.firstResponseTargetMinutes,
        resolutionTargetMinutes: input.resolutionTargetMinutes,
        firstResponseDueAt: new Date(now.getTime() + input.firstResponseTargetMinutes * 60_000),
        resolutionDueAt: new Date(now.getTime() + input.resolutionTargetMinutes * 60_000),
      },
    });
  });
}
```

`TicketCounter` has no compound unique key (its `@id` IS `organizationId`), so it does **not** hit the STATE.md-documented `scopedDb` upsert bug (that bug was specifically about compound-unique `where` clauses like `Setting`'s `organizationId_key`, where injecting an extra top-level `organizationId` into `where` makes Prisma reject the upsert target). Here, `where: { organizationId }` already IS the valid unique identifier, so the injected duplicate key is a harmless no-op merge.

**GOTCHA — verify before relying on this (MEDIUM confidence, needs a Wave-0 smoke test):** Prisma Client extensions' `query` component (which is what `scopedDb` uses) is documented to apply inside `$transaction` callbacks in current Prisma versions, but there is a history of related bugs specifically about interactive transactions and extensions (e.g. [prisma/prisma#16582](https://github.com/prisma/prisma/issues/16582), fixed by Prisma 4.10; [prisma/prisma#19651](https://github.com/prisma/prisma/issues/19651), a `$queryRaw`-in-transaction-plus-extensions bug fixed by 4.16.2). Those were years before Prisma 7.8.0 and concerned custom `model`/`client` extension methods, not the `query` hook shape `scopedDb` uses — but because this directly affects tenant isolation (if the hook silently didn't apply inside `tx`, `TicketCounter`/`Ticket` rows could be created without `organizationId`), the plan should include a 5-minute smoke test in Wave 0: call `getScopedDb().db.$transaction(tx => tx.setting.create({ data: { key: "smoke", value: "1" } }))` and assert the created row's `organizationId` matches. If it does NOT auto-inject, fall back to passing `orgId` explicitly into `data`/`where` inside the transaction body (bypassing reliance on the extension for just those two calls).

**Gap tolerance:** because the counter increment and the `Ticket.create` are in the same transaction, a gap only occurs if the transaction as a whole aborts (rare) — acceptable per D-06 ("gaps OK").

---

## Topic 3 — Markdown → Sanitized HTML (D-10/D-11, AIDA-04/07)

**RECOMMENDATION:** `unified` + `remark-parse` (+ `remark-gfm`) + `remark-rehype` + `rehype-sanitize` + `rehype-stringify`. Single shared `renderMarkdown()` function used for both public replies and internal notes — visibility (amber tint, lock icon, "Internal Note" label) is a **UI-layer** concern applied to the rendered HTML container, not a sanitization difference, per the phase's own framing.

### Render function

```typescript
// src/lib/markdown/render.ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Schema } from "hast-util-sanitize";

const schema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["target", "_blank"], ["rel", "nofollow noopener noreferrer"]],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}
```

- `processSync` is appropriate here (no async plugins in this pipeline) — simpler call sites than `await process(...)`.
- `defaultSchema` (from `hast-util-sanitize`, re-exported by `rehype-sanitize`) mirrors github.com's sanitization allowlist: it strips `<script>`, inline event-handler attributes (`onclick`, etc.), `javascript:`/`data:` URLs on links, `<iframe>`/`<object>`/`<embed>`, and the `style` attribute by default. This is the safe baseline against untrusted requester/agent input; the only customization above is allowing `target`/`rel` on links.
- Store **both** `bodyMarkdown` (source of truth, re-renderable) and `bodyHtml` (the sanitized render, computed once at write time in the Server Action/Route Handler that creates the `Message`) on the `Message` row. This avoids re-running the pipeline on every thread read and gives Phase 3's email sender ready-to-send HTML without new rendering code.
- Because sanitization is identical for both visibilities, there is exactly one call site risk to watch: don't let a future contributor add a second ad hoc `dangerouslySetInnerHTML` somewhere that skips `renderMarkdown()` — keep `bodyHtml` as the only field ever passed to `dangerouslySetInnerHTML` in the thread view.

---

## Topic 4 — Next.js 16 File Uploads + Local Storage (D-22/D-23, AIDA-07)

**RECOMMENDATION:** Route Handlers only (never Server Actions) for every endpoint that accepts a file — public intake, agent composer attachments, and the public status-page follow-up. Use the native `request.formData()` Web API (no `multer`/`busboy` dependency needed). Enforce the 10MB limit and MIME allowlist server-side using `file-type` byte-sniffing, not the client-supplied `Content-Type` or file extension.

### Why Route Handlers, not Server Actions

- Server Actions have a **default 1MB body size limit** (`experimental.serverActions.bodySizeLimit` in `next.config.ts`, still 1MB as of Next.js 16) — well under the 10MB requirement.
- Next.js's own guidance: "for uploads larger than a few MB, prefer a Route Handler — Server Actions are designed for form data, not large file transfer."
- Route Handlers have **no Next.js-imposed body size limit** at all (that limit is Pages-Router-only, via the old `api.bodyParser.sizeLimit` config, which doesn't exist in App Router Route Handlers). The only real ceiling is the reverse proxy (Caddy) and available memory.
- This is a deliberate, justified exception to the Phase 1 convention ("Server Actions for internal mutations") — file-bearing mutations are the one category where Route Handlers are correct even for authenticated/internal use. Plain non-file mutations (status change, assign, tag) remain Server Actions.

### Caddy: add an explicit body-size ceiling for defense-in-depth

Caddy has **no default limit** (unlike nginx's 1MB default) — add one explicitly in the `Caddyfile` site block so a malicious huge upload never even reaches the app:
```
request_body {
    max_size 12MB
}
```
(12MB leaves headroom over the 10MB app-level limit for multipart boundary/header overhead — rule of thumb is 10-20KB of overhead per part, so 12MB is generous.)

### `FileStorage` interface (S3-ready shape)

```typescript
// src/lib/attachments/file-storage.ts
export interface FileStorage {
  save(params: { orgId: string; key: string; data: Buffer }): Promise<{ key: string; sizeBytes: number }>;
  read(params: { orgId: string; key: string }): Promise<Buffer>;
  delete(params: { orgId: string; key: string }): Promise<void>;
}
```

```typescript
// src/lib/attachments/local-file-storage.ts
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage } from "./file-storage";

const ROOT = process.env.UPLOADS_DIR ?? "/data/uploads";

// Keys are always server-generated (cuid + extension) — never derived from user-supplied filenames.
// This regex is the path-traversal guard: reject anything that isn't exactly that shape.
function safeKey(key: string): string {
  if (!/^[a-z0-9]+\.[a-z0-9]{1,8}$/i.test(key)) throw new Error("invalid attachment key");
  return key;
}

export const localFileStorage: FileStorage = {
  async save({ orgId, key, data }) {
    const dir = path.join(ROOT, orgId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeKey(key)), data);
    return { key, sizeBytes: data.byteLength };
  },
  async read({ orgId, key }) {
    return readFile(path.join(ROOT, orgId, safeKey(key)));
  },
  async delete({ orgId, key }) {
    await unlink(path.join(ROOT, orgId, safeKey(key)));
  },
};
```

**Path-traversal note:** the original uploaded filename is stored *only* as display metadata (`Attachment.originalFilename`) — it is never used to construct a filesystem path. The on-disk key is always server-generated, so `../../etc/passwd`-style filenames are structurally impossible to exploit.

### Upload Route Handler (shared shape — public intake and authenticated composer both use this)

```typescript
// src/app/api/attachments/upload/route.ts (illustrative — auth check differs per call site)
export const runtime = "nodejs"; // required: Edge runtime cannot do Buffer/node:fs work

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "text/plain", "text/csv",
]);

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES * 1.2) return new Response("Payload too large", { status: 413 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return new Response("Missing file", { status: 400 });
  if (file.size > MAX_BYTES) return new Response("File too large", { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { fileTypeFromBuffer } = await import("file-type");
  const sniffed = await fileTypeFromBuffer(buffer);
  if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
    return new Response("Unsupported file type", { status: 415 });
  }
  // proceed: localFileStorage.save(...) then Attachment.create via scopedDb
}
```

### Serving Route Handler (always authenticated, never a static public path)

```typescript
// src/app/api/attachments/[id]/route.ts
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, orgId } = await getScopedDb(); // requireSession() enforced inside — 401/redirect if absent
  const { id } = await params; // Next.js 16: dynamic route params are async
  const attachment = await db.attachment.findFirst({ where: { id } }); // organizationId auto-injected
  if (!attachment) return new Response("Not found", { status: 404 });

  const buffer = await localFileStorage.read({ orgId, key: attachment.storageKey });
  return new Response(buffer, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.originalFilename)}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
```

### Public web-form intake with attachments (D-19)

Bundle everything into **one** multipart POST — name/email/subject/message fields plus 0-N files in the same `request.formData()` call, all persisted inside one transaction (Contact find-or-create → Ticket create → Message create → Attachment rows). This avoids a separate "stage file, then link it" flow and the orphaned-temp-file cleanup job that flow would require. Cap total combined attachment size in addition to the per-file 10MB cap (e.g. reject if the whole request exceeds ~30MB) — this is Claude's-discretion territory the planner should pick a concrete number for.

### Docker volume

Add to `docker-compose.yml` (both `app` and `worker` don't need it — only `app` serves/writes attachments in this design, since uploads happen synchronously in the request/response cycle, not via a background job):
```yaml
services:
  app:
    volumes:
      - uploads_data:/data/uploads
volumes:
  uploads_data:
```
This is a **second** named volume alongside `postgres_data` — document it in the Phase 7 backup guidance (out of scope for Phase 2 itself, but flag it so Phase 7 doesn't miss it).

---

## Secondary Topics

### Recurring pg-boss SLA-flag job (D-15)

Mirrors `src/lib/worker/jobs/heartbeat.ts` exactly — same `createQueue`/`work`/`schedule` shape already proven in Phase 1.

```typescript
// src/lib/worker/index.ts additions
await boss.createQueue("sla-flag");
await boss.work("sla-flag", async ([job]: Job[]) => { await slaFlagHandler(job.data); });
await boss.schedule("sla-flag", "*/5 * * * *", {}); // every 5 minutes
```

**Cadence:** every 5 minutes is a sensible default — SLA targets are hour-granularity (per D-13/D-14 illustrative numbers), so up to 5 minutes of staleness on the "at risk"/"breached" chip is imperceptible, while keeping the scan cheap (two set-based `UPDATE`s over the whole `Ticket` table, no per-tenant loop).

**Single UPDATE with computed predicates (not per-ticket):**
```typescript
// src/lib/worker/jobs/sla-flag.ts
import { prisma } from "../../db";

export async function slaFlagHandler(_data?: unknown): Promise<void> {
  const now = new Date();

  // Pass 1: breach (implies at-risk) — monotonic, one-directional
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "isBreached" = true, "isAtRisk" = true
    WHERE "isBreached" = false
      AND status NOT IN ('RESOLVED', 'CLOSED')
      AND (
        ("firstRespondedAt" IS NULL AND "firstResponseDueAt" < ${now})
        OR ("resolvedAt" IS NULL AND "resolutionDueAt" < ${now})
      )
  `;

  // Pass 2: at-risk — proportional threshold (due within 20% of the original target duration)
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "isAtRisk" = true
    WHERE "isAtRisk" = false
      AND status NOT IN ('RESOLVED', 'CLOSED')
      AND (
        ("firstRespondedAt" IS NULL AND "firstResponseDueAt" > ${now}
          AND "firstResponseDueAt" - ${now} <= ("firstResponseTargetMinutes" * 0.2) * interval '1 minute')
        OR ("resolvedAt" IS NULL AND "resolutionDueAt" > ${now}
          AND "resolutionDueAt" - ${now} <= ("resolutionTargetMinutes" * 0.2) * interval '1 minute')
      )
  `;
}
```

**Important corollary — flags must also be CLEARED in application code, not just set by the job:** the job above is one-directional (only ever sets flags to `true`). The moment the underlying event actually happens — the first public reply is persisted (`firstRespondedAt` set) or the ticket transitions to `resolved`/`closed` — the Server Action that performs that write must also clear the now-irrelevant flag(s) in the same statement/transaction (e.g., set `isAtRisk = false, isBreached = false` when resolving, or re-evaluate the remaining flag when only first-response fires). Otherwise a ticket that was flagged at-risk stays visually flagged for up to 5 minutes after an agent responds — the periodic job alone can't produce instant feedback in the UI. This split (job sets, application code clears) is the standard pattern and should be called out explicitly in the plan's task list; it's an easy detail to drop.

### SLA data model shaped for future business-hours (D-13/D-14)

Store **durations** (minutes) on both `SlaPolicy` (the admin-configured template) and `Ticket` (a copy taken at creation time, so later policy edits never retroactively change an in-flight ticket's targets) plus **computed due timestamps** on `Ticket`. Business-hours math later only changes *how* `dueAt` is computed from `targetMinutes` (elapsed calendar minutes vs. elapsed business minutes) — no schema change needed.

```prisma
enum TicketPriority { LOW NORMAL HIGH URGENT }

model SlaPolicy {
  id                          String   @id @default(cuid())
  organizationId              String
  priority                    TicketPriority
  firstResponseTargetMinutes  Int
  resolutionTargetMinutes     Int
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  organization                organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, priority])
  @@index([organizationId])
}

model Ticket {
  // ...
  firstResponseTargetMinutes Int
  resolutionTargetMinutes    Int
  firstResponseDueAt         DateTime
  resolutionDueAt            DateTime
  firstRespondedAt           DateTime?
  resolvedAt                 DateTime?
  isAtRisk                   Boolean  @default(false)
  isBreached                 Boolean  @default(false)
}
```

Seeded defaults (illustrative, planner to confirm final numbers — matches D-14's own illustrative example): Urgent 1h/8h, High 4h/24h, Normal 8h/48h, Low 24h/72h (first-response/resolution).

### Custom fields storage (D-18, AIDA-05)

**RECOMMENDATION: EAV with typed value columns**, not a single JSONB column. Rationale: admin-defined fields must be independently filterable/sortable in the inbox (D-18's own requirement) — a typed column per value-kind (`valueText`, `valueNumber`, `valueBoolean`, `valueDate`) lets each be indexed and queried with normal typed `WHERE`/`ORDER BY` clauses. A single JSONB blob would require a GIN index plus per-field expression indexes (`(data->>'foo')::numeric`) to filter efficiently on an admin-chosen field — more moving parts, and re-runs into the exact "Prisma can't manage functional indexes" limitation documented in Topic 1.

```prisma
enum CustomFieldType { TEXT SELECT NUMBER CHECKBOX DATE }

model CustomFieldDefinition {
  id             String   @id @default(cuid())
  organizationId String
  label          String
  type           CustomFieldType
  options        Json?    // SELECT only: string[] of choices
  position       Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  values         CustomFieldValue[]
  @@index([organizationId])
}

model CustomFieldValue {
  id                       String   @id @default(cuid())
  organizationId           String
  ticketId                 String
  customFieldDefinitionId  String
  valueText                String?
  valueNumber              Float?
  valueBoolean             Boolean?
  valueDate                DateTime?
  ticket                   Ticket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  definition               CustomFieldDefinition @relation(fields: [customFieldDefinitionId], references: [id], onDelete: Cascade)
  @@unique([ticketId, customFieldDefinitionId])
  @@index([organizationId])
  @@index([customFieldDefinitionId, valueText])
  @@index([customFieldDefinitionId, valueNumber])
  @@index([customFieldDefinitionId, valueDate])
}
```

### Honeypot + per-IP rate limiting, no external service (D-20)

**Honeypot:** a hidden form field (e.g. `company_website`) styled off-screen (not `type="hidden"` — some simple bots skip literal hidden inputs but still fill visually-hidden ones, so `position: absolute; left: -9999px` + `tabindex="-1"` + `autocomplete="off"` is the more effective trap). If the server receives a non-empty value for this field, **return a normal-looking success response but silently drop the submission** (don't create the ticket, don't error) — erroring or 4xx-ing tips off the bot operator to adjust; silent success does not.

**Rate limiting — Postgres-backed, same "counter row" idiom as ticket numbering:**
```prisma
model RateLimitHit {
  id        String   @id @default(cuid())
  scope     String   // "public-intake" | "status-follow-up"
  ipHash    String   // sha256(ip + server-side pepper) — avoid storing raw IPs long-term
  createdAt DateTime @default(now())
  @@index([scope, ipHash, createdAt])
}
```
Check-then-insert (race-tolerant — worst case one extra request slips through under simultaneous hits, acceptable for anti-spam, not a security boundary):
```typescript
const windowStart = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
const recentCount = await prisma.rateLimitHit.count({
  where: { scope, ipHash, createdAt: { gte: windowStart } },
});
if (recentCount >= 5) return rejectWithGenericError();
await prisma.rateLimitHit.create({ data: { scope, ipHash } });
```
Add a small daily cleanup (reuse the worker's scheduling pattern) deleting rows older than 48h so the table doesn't grow unbounded. This table does **not** need `organizationId` for v1 (rate limiting happens before any org context is resolved in some flows) — revisit only if/when multiple organizations each expose their own public intake form.

### `scopedDb` `DOMAIN_MODELS` allowlist — models to add

Add these to `src/lib/scoped-db.ts`: `Ticket`, `Contact`, `Message`, `Tag`, `SlaPolicy`, `CustomFieldDefinition`, `CustomFieldValue`, `Attachment`, `TicketCounter`.

**Discretion / do NOT add:**
- `TicketTag` (pure join table) — mutate only via nested writes through `Ticket` (`ticket.update({ data: { tags: { create: { tagId } } } } )`), which is already org-scoped through the parent `Ticket` row. Giving it its own `organizationId` column and allowlist entry is extra denormalization with no benefit if it's never queried directly.
- `RateLimitHit` — not tenant-scoped in v1 (see above); accessed via bare `prisma`, same pattern as `auth.ts`'s bypass of `scopedDb` for Better-Auth models.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Full-text search relevance | Custom `LIKE '%term%'` matching in app code | Postgres `tsvector`/`tsquery` + GIN index | Native FTS gives stemming, stop-word handling, and ranking (`ts_rank`) for free; `LIKE` forces a sequential scan and has zero relevance signal. |
| Markdown parsing + XSS sanitization | Regex-based Markdown→HTML converter, or a hand-written HTML tag/attribute stripper | `unified`/`remark`/`rehype` + `rehype-sanitize` | Hand-rolled sanitizers reliably miss at least one XSS vector (event-handler attributes, `javascript:`/`data:` URLs, SVG script gadgets); `rehype-sanitize`'s allowlist schema is maintained against exactly these classes of bypass. |
| Concurrency-safe sequential numbering | `SELECT count(*) + 1` before insert, or a distributed lock service | Atomic Postgres `UPDATE`/`upsert` on a dedicated counter row | `count()+1` is a textbook TOCTOU race; a distributed lock (Redis/Zookeeper) would also violate the project's no-Redis mandate for a problem Postgres already solves natively. |
| Server-side MIME verification | Trusting the browser's `Content-Type` header or the file extension | `file-type` (magic-byte sniffing) | Both the header and the extension are trivially attacker-controlled; only inspecting the actual file bytes is a real allowlist check. |
| Spam/abuse protection | Third-party CAPTCHA/anti-spam API, or a Redis-backed rate limiter | Honeypot field + a small Postgres hit-counter table | Third-party services violate the no-egress/privacy-first mandate; Redis violates the single-Postgres mandate. Postgres is already the system of record — one more small table costs nothing. |

**Key insight:** almost every "hard part" of this phase is a problem Postgres already solves natively (search, sequencing, rate limiting) or a problem a small, security-focused npm package already solves better than a hand-rolled version would (sanitization, MIME sniffing). The actual engineering effort in Phase 2 is wiring these correctly through the existing `scopedDb`/Prisma-migration conventions — not inventing new algorithms.

---

## Common Pitfalls

### Pitfall 1: Prisma clobbers `GENERATED ALWAYS` tsvector columns
**What goes wrong:** a contributor runs `prisma migrate dev` for an unrelated schema change; Prisma's diff engine, seeing an `Unsupported("tsvector")` field it partially understands, emits a migration that drops the `GENERATED` expression or the column's `DEFAULT`.
**Why it happens:** documented Prisma limitation ([#24180](https://github.com/prisma/prisma/issues/24180), [#24496](https://github.com/prisma/prisma/issues/24496)) — expression/generated columns aren't represented in Prisma's schema DSL.
**How to avoid:** never declare the tsvector columns in `schema.prisma` at all (see Topic 1). Keep them purely in a hand-written migration file, accessed only via `$queryRaw`.
**Warning signs:** a routine `prisma migrate dev` diff mentions `searchVector`/`ALTER COLUMN ... DROP EXPRESSION` when you didn't touch search-related models.

### Pitfall 2: Raw SQL silently bypasses tenant scoping
**What goes wrong:** a future search/reporting feature adds a second ad hoc `$queryRaw` against `Ticket` without an `organizationId` filter, returning cross-tenant data.
**Why it happens:** `scopedDb`'s `$extends` `query` component only wraps the named CRUD methods; raw SQL methods are structurally invisible to it.
**How to avoid:** treat `searchTickets()` as the ONE reviewed call site for raw ticket queries; any new raw SQL against a `DOMAIN_MODELS` table needs the same manual `organizationId` discipline and ideally its own isolation test (see Validation Architecture below).
**Warning signs:** any `prisma.$queryRaw`/`$executeRaw` call that references a tenant table without an `organizationId`/`orgId` bound parameter in the `WHERE` clause.

### Pitfall 3: `count() + 1` for ticket numbers
**What goes wrong:** two concurrent public-form submissions produce duplicate or skipped ticket numbers under load.
**Why it happens:** classic read-then-write race, no row lock involved.
**How to avoid:** the `TicketCounter` upsert-in-transaction pattern (Topic 2). Never compute the next number by counting existing rows.
**Warning signs:** a `@@unique([organizationId, number])` constraint violation under concurrent-intake load testing.

### Pitfall 4: File uploads via Server Actions silently truncate
**What goes wrong:** an agent tries to attach a 6MB PDF to a reply; the Server Action throws or truncates because of the default 1MB `serverActions.bodySizeLimit`.
**Why it happens:** Server Actions have a Next.js-imposed default body cap that Route Handlers don't.
**How to avoid:** every attachment-bearing endpoint is a Route Handler (Topic 4), not a Server Action.
**Warning signs:** uploads work in manual testing with tiny files but fail specifically once a real-world-sized attachment (a few MB) is used.

### Pitfall 5: SLA flags never clear after the triggering event
**What goes wrong:** an agent replies to an at-risk ticket; the UI still shows "At risk" for up to 5 minutes because only the periodic job sets flags.
**Why it happens:** the pg-boss job is one-directional (sets `true` only) by design, for cheap set-based `UPDATE`s.
**How to avoid:** the Server Action that sets `firstRespondedAt`/`resolvedAt` must also clear the now-irrelevant `isAtRisk`/`isBreached` flags in the same write (see Secondary Topics above).
**Warning signs:** a ticket's SLA chip stays red/amber immediately after an agent action that should have cleared it.

### Pitfall 6: Path traversal via uploaded filenames
**What goes wrong:** an attacker names a file `../../../../data/uploads/other-org/secret.pdf` and the server writes to (or later reads from) an attacker-chosen path.
**Why it happens:** using the user-supplied filename directly to build a filesystem path.
**How to avoid:** always generate the on-disk key server-side (cuid + validated extension); store the original filename only as display metadata, never as part of a path (see `local-file-storage.ts` above).
**Warning signs:** any code path that does `path.join(uploadsDir, file.name)` with the raw browser-supplied name.

---

## Open Questions

1. **Is the public status-page token the raw ticket `cuid`, or a separate dedicated token?**
   - What we know: D-06 says the cuid is used "for DB relations and for the secure public status link"; D-21 says the token is "derived from the ticket cuid / a dedicated unguessable token" (explicitly offering both as options).
   - What's unclear: whether the human intends the cuid itself to double as the bearer secret for an unauthenticated page showing ticket contents.
   - Recommendation: use a **separate**, dedicated high-entropy token (e.g. `crypto.randomBytes(24).toString("base64url")`, stored in a new `statusToken` column, unique + indexed) rather than the `id`. Rationale: cuids are designed for uniqueness, not secrecy (they're time-ordered with only partial randomness), and primary keys routinely leak through logs, other UI surfaces, and error messages in ways a dedicated bearer token does not. This keeps `id` freely referenceable everywhere else (agent UI URLs, DB joins) without it also being a security-sensitive secret. Flag this for a quick human confirmation if the planner wants to be extra safe, but treat it as the default unless told otherwise.

2. **Which organization does the public web-form intake attach the new ticket to, given the schema is multi-tenant-ready but v1 only ever has one workspace?**
   - What we know: Better Auth's org plugin is configured with `allowUserToCreateOrganization: false` after setup (per Phase 1 STATE.md), so in practice exactly one `organization` row will ever exist in a v1 deployment.
   - What's unclear: whether to hardcode a `prisma.organization.findFirstOrThrow()` lookup (simplest, correct for v1) or to future-proof the public route path with an org slug segment now (e.g. `/api/public/intake/[orgSlug]`) even though nothing creates a second org yet.
   - Recommendation: `findFirstOrThrow()` for v1 — it's correct today and a one-line change later if/when multi-org public intake becomes real (out of scope per ROADMAP.md's phase sequencing). Note this clearly in code with a comment so it isn't mistaken for an oversight.

3. **Exact "at risk" threshold formula.**
   - What we know: D-15 wants a three-state chip (on-track / at-risk / overdue); Claude's Discretion leaves the exact cadence/threshold open.
   - What's unclear: whether a flat time threshold (e.g. "due within 30 minutes") or a proportional one (e.g. "due within 20% of the original target") reads better across a 1-hour Urgent target vs. a 72-hour Low target.
   - Recommendation: proportional (20% of target duration), as designed in the SLA-flag job above — a flat 30-minute threshold would make Urgent tickets (1h target) permanently "at risk" for half their life while barely registering on a 72h Low-priority ticket. The planner can adjust the 20% constant without a schema change since it's applied at query time against stored `targetMinutes`.

---

## Environment Availability

This phase introduces no new external services, tools, or runtimes — only npm packages (all confirmed resolvable against the public registry above) layered onto the stack already running from Phase 1.

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| PostgreSQL 16 + pgvector | FTS, SLA job, rate-limit table, ticket counter | ✓ (Phase 1) | pg16 image | — |
| Node.js | Route Handlers, worker | ✓ | 22.23.1 (Volta-pinned) | — |
| pnpm | package install | ✓ | 10.34.4 | — |
| Docker / docker-compose | new `uploads_data` volume | ✓ (Phase 1) | — | — |
| npm registry reachability | resolving the 7 new packages listed above | ✓ (verified 2026-07-01) | see Standard Stack table | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — no new infra dependency was introduced.

---

## Validation Architecture (testable seams worth flagging)

`workflow.nyquist_validation` is disabled in `.planning/config.json`, so this is an informal note rather than a full test-framework mapping — but three seams in this phase are exactly the kind of thing Phase 1's AIDA-11 isolation-test pattern already covers well, and are worth an equivalent integration test:

- **Cross-tenant search leak:** seed two orgs with tickets containing an identical search term; assert `searchTickets(orgA.id, term)` never returns `orgB`'s ticket IDs. Mirrors the existing Phase 1 workspace-isolation Testcontainers test almost exactly.
- **Ticket-number race:** fire N concurrent `createTicket()` calls for the same org (e.g. via `Promise.all`) and assert the resulting `number` values are unique and gap-tolerant (no duplicates, no unique-constraint violations).
- **`scopedDb` extension-through-transaction smoke test:** the Wave-0 check described in Topic 2's gotcha — confirms `organizationId` auto-injection survives an interactive `$transaction`, which several other tasks in this phase's plan will depend on.

---

## Code Examples

Already inlined per-topic above (search query, ticket-creation transaction, `renderMarkdown`, upload/serve Route Handlers, SLA-flag job). No additional standalone examples needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---------------|-------------------|----------------|--------|
| `multer`/`busboy` middleware for multipart parsing in Node | Native `Request.formData()` Web API in Next.js Route Handlers | Available since Next.js App Router's adoption of the Fetch API `Request`/`Response` types (Next 13+) | No extra dependency needed for this phase's uploads; keep `file-type` only for content verification, not parsing. |
| Trusting client-supplied MIME type/extension | Server-side magic-byte sniffing (`file-type`) | Standard security guidance for years, still the correct default | Non-negotiable for D-23's "reject on the server" requirement. |
| Expression/functional Postgres indexes fully modeled in an ORM schema | Still not supported by Prisma (`to_tsvector`-based indexes invisible to `prisma db pull`) | Ongoing limitation, not a recent regression — tracked issues remain open as of this research | Confirms the "keep it outside `schema.prisma`" recommendation isn't a workaround for a soon-to-be-fixed bug; plan around it as a durable constraint. |

---

## Sources

### Primary (HIGH confidence)
- [Prisma Docs — Indexes](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes) — GIN index syntax, confirms functional/expression indexes unsupported.
- [Prisma Docs — Client extensions: query component](https://www.prisma.io/docs/orm/prisma-client/client-extensions/query)
- [Caddy Docs — `request_body` directive](https://caddyserver.com/docs/caddyfile/directives/request_body) — confirms no default body-size limit, and the `max_size` config shape.
- [Next.js Docs — `next.config.js: serverActions`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions) — confirms `bodySizeLimit` default (1MB) applies to Server Actions specifically.
- npm registry version checks (`npm view <pkg> version`, run 2026-07-01) for all packages in the Standard Stack table.
- Existing codebase: `src/lib/scoped-db.ts`, `src/lib/worker/jobs/heartbeat.ts`, `src/lib/worker/index.ts`, `src/lib/db.ts`, `prisma/schema.prisma`, `prisma.config.ts`, `package.json`, `src/middleware.ts`, `docker-compose.yml` — ground truth for all "must reuse" patterns.

### Secondary (MEDIUM confidence)
- [prisma/prisma#24180](https://github.com/prisma/prisma/issues/24180), [#24496](https://github.com/prisma/prisma/issues/24496), [#8950](https://github.com/prisma/prisma/issues/8950), [#12334](https://github.com/prisma/prisma/issues/12334) — GitHub issues confirming the Prisma tsvector/generated-column limitations (cross-verified across 4 independent issues, all pointing the same direction).
- [prisma/prisma#16582](https://github.com/prisma/prisma/issues/16582), [#19651](https://github.com/prisma/prisma/issues/19651) — historical (Prisma 4.x-era) extension-inside-transaction bugs, both fixed in that era; cited to justify the Wave-0 smoke-test recommendation, not as evidence of a current bug.
- Medium article on "Bulletproof FTS in Prisma" — corroborates the community-standard workaround pattern (generated column outside schema.prisma), used as a secondary source alongside the official GitHub issues.
- WebSearch-sourced comparison of `rehype-sanitize` vs. `isomorphic-dompurify` vs. `sanitize-html` — cross-checked against each package's own stated runtime requirements (jsdom dependency for DOMPurify-based options).

### Tertiary (LOW confidence)
- None flagged — all load-bearing claims above were cross-verified against at least one official doc/GitHub issue or the live npm registry.

## Metadata

**Confidence breakdown:**
- Standard stack (Markdown/sanitize/file-type packages): HIGH — versions confirmed live against npm registry, API shapes match official docs/READMEs.
- Postgres FTS + ticket-counter patterns: HIGH — these are general Postgres concurrency/FTS idioms, not framework-specific, cross-verified against official Postgres docs and multiple independent sources.
- Prisma-extension-in-transaction propagation: MEDIUM — current-version behavior inferred from historical fix commits + extension mechanics, not directly tested against Prisma 7.8.0; flagged as a Wave-0 smoke-test item rather than asserted as fact.
- Next.js 16 Route Handler body-size behavior: HIGH — confirmed via official Next.js docs pages for both `serverActions.bodySizeLimit` and the Pages-Router-only nature of `api.bodyParser`.
- SLA/custom-field/rate-limit data models: HIGH confidence as *sound designs*, but they are original schema recommendations (not sourced from an external authority) — flagged as such rather than presented as "the industry standard."

**Research date:** 2026-07-01
**Valid until:** ~30 days for the Postgres/Prisma patterns (stable); ~14 days for exact npm package versions (fast-moving ecosystem) — re-verify versions with `npm view` immediately before `pnpm add` if planning is delayed.
