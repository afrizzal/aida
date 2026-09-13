# Phase 2: Core Ticketing - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a genuinely usable helpdesk with **no AI** — agents create and work tickets through a shared inbox via the web. This phase delivers the core domain data model (Ticket, Contact, Message, Tag, CustomField, SLA policy, Attachment) plus the agent-facing screens and the public web intake channel.

**In scope (AIDA-01–08, AIDA-12 partial):** ticket lifecycle + priority; shared inbox with views/filter/full-text search; contacts with per-contact history; assignment; public replies vs private internal notes; tags + basic custom fields; SLA first-response/resolution timers with breach indicators; conversation thread with attachments; public web form → ticket with a status link; the settings surfaces needed for the above (SLA policies, tags, custom fields).

**NOT in scope (later phases):** email intake/threading + outbound SMTP (Phase 3); LLM layer, auto-triage, audit log, prompt-injection safeguards (Phase 4); knowledge base + RAG drafted replies (Phase 5); AIDA Insight analytics (Phase 6); demo seed data, docs site, README GIF (Phase 7). No customer login/portal accounts in v1.

</domain>

<decisions>
## Implementation Decisions

### Inbox layout & navigation
- **D-01:** **2-pane "Shared Inbox"** inside the existing Tickets route — a scrollable ticket **list column (left)** + a **detail/reading pane (right)** within the current content area (which already sits beside the app nav rail). No third column.
- **D-02:** Saved views (**Unassigned**, **Mine**, **by Status**) render as **filter chips/tabs above the list**, keeping navigation flat. The v1 view set is fixed (not user-savable custom views) — Claude's discretion to keep them simple.

### Ticket lifecycle & attributes
- **D-03:** **Flexible status model** — statuses `new / open / pending / resolved / closed`; an agent may transition to **any** status via a dropdown, no enforced linear order.
- **D-04:** **Auto-reopen:** a new message from the **requester** on a `resolved` or `closed` ticket automatically resets status to `open` (applies to both the public status-page follow-up and future email replies).
- **D-05:** **Priority scale = Low / Normal / High / Urgent** (4 levels). Priority is the **primary driver of SLA targets**. Customers do NOT set priority on the web form — agents (and AI triage later) do.
- **D-06:** **Human-friendly sequential ticket number** (e.g. `#1001`), **auto-incrementing per workspace**, is the primary reference in UI/search/future email subjects. A stable internal **cuid** is used for DB relations and for the secure public status link. (Sequence must be workspace-scoped — see code_context for the concurrency note.)

### Contacts
- **D-07:** **Auto-create / auto-link contacts by normalized (lowercased) email** during intake. If a workspace contact with that email exists, link the ticket to it; otherwise create a new contact. Missing name/fields fill in over time. Works unattended for the public web form.
- **D-08:** **Contact record fields:** name, email (dedup key), phone, company/organization, free-form **Notes**. A **searchable Contacts list** + a **dedicated contact detail page** show that contact's full ticket history (AIDA-03).
- **D-09:** Advanced duplicate detection + manual **merge tooling deferred** to a later phase.

### Conversation thread
- **D-10:** **Single composer** at the bottom of the thread with a **segmented Public Reply / Internal Note toggle**. Public replies render neutral/system colors; **internal notes render visually distinct** — amber-tinted background + lock icon + explicit "Internal Note" label (AIDA-04).
- **D-11:** **Composer format = Markdown**, rendered to **sanitized HTML** in the thread, for both replies and notes. Lightweight, portable, and email-ready for Phase 3. Sanitization is mandatory (untrusted input — see SECURITY.md).
- **D-12:** Thread is chronological (inbound + outbound + notes) and supports **per-message attachments** (AIDA-07).

### SLA
- **D-13:** **24/7 calendar clock** — first-response and resolution targets measured in **elapsed wall-clock time from ticket creation**. Business-hours/holiday/timezone calendars are **explicitly deferred**; the SLA-policy data model must be shaped so business-hours can layer on later without a rewrite.
- **D-14:** **Per-priority SLA targets** (first-response + resolution) configured by admins in **Settings** (AIDA-12), with **seeded sensible defaults** (illustrative: Urgent 1h/8h … Low 24h/72h — planner picks final numbers).
- **D-15:** **Breach surfacing:** each ticket shows a **color-coded due chip** ("Due in 2h" → amber "At risk" → red "Overdue"). A **recurring pg-boss job** periodically evaluates target timestamps and stamps **`isAtRisk` / `isBreached` flags** on the ticket record → enables performant inbox filtering and a stable hook for future notifications. (Reuses the existing worker/heartbeat pattern from Phase 1.)

### Tags
- **D-16:** **Free-form tagging** — agents create tags on the fly by typing; an **autocomplete dropdown** of existing workspace tags encourages reuse. Tickets are **filterable by tag**.
- **D-17:** A **tag management interface in Settings** (AIDA-12) lets admins **rename/delete** tags globally.

### Custom fields
- **D-18:** **Admin-defined custom fields** configured in Settings, from **five core types: Short Text, Dropdown (Select), Number, Checkbox, Date** (AIDA-05). Fields render in the ticket detail for agent input and are **integrated into inbox filtering**.

### Web intake (public channel)
- **D-19:** **Public web form** collects **Name, Email, Subject, Message, Attachments** → creates/links Contact + creates Ticket with an initial thread message. Implemented as a **Route Handler** (external-facing), zod-validated (per Phase 1 D-14/D-15). No category/priority picker on the form in v1.
- **D-20:** **Spam protection = hidden honeypot field + strict server-side per-IP rate limiting** on the submit route. **Fully self-contained — no third-party CAPTCHA, no external calls** (privacy-first / no-egress principle). Same guard applies to the public status-page follow-up composer.
- **D-21:** **Tokenized public status page** at `/status/[secure-token]` (token derived from the ticket cuid / a dedicated unguessable token). **Unauthenticated.** Shows current **status + the public conversation thread only (internal notes strictly excluded)** + a **follow-up composer**. A follow-up appends to the thread and triggers auto-reopen (D-04). No customer login.

### Attachments
- **D-22:** **Local storage on a dedicated Docker volume** (e.g. `/data/uploads`), served through an **authenticated, workspace-scoped route** (never a public static path). A lightweight **`FileStorage` interface** abstracts the backend so S3-compatible storage can be added later.
- **D-23:** **Limits: 10MB per file + a strict MIME-type allowlist** (Phase 2). Reject on the server, not just the client.

### Claude's Discretion (to decide during planning)
- **Full-text search:** use **PostgreSQL full-text search** (tsvector) — single-server, no Redis. Scope of indexed fields (subject/body/message text, and whether contacts are searchable) is Claude's discretion; default to ticket subject + message bodies + ticket number.
- **Assignment:** **individual-agent assignment only** (AIDA-04) — assign to a workspace member via dropdown; no teams/groups, no round-robin/auto-assign in v1.
- **Bulk actions** (multi-select change status/assign/tag): **deferred** — not in Phase 2.
- Fixed vs savable views: v1 ships the **fixed** Unassigned/Mine/Status set (D-02).
- Loading/empty/error states, exact spacing/typography (must follow DESIGN-SYSTEM.md), skeleton design, optimistic-update behavior, pagination/virtualization approach for long lists.
- Exact seeded SLA default numbers; the periodic job's cadence.
- `scopedDb` `DOMAIN_MODELS` allowlist extension for all new models.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & data model
- `docs/ARCHITECTURE.md` — data-model sketch (Ticket/Contact/Message/Tag/CustomField/SLA fields), module layout (`lib/db` scopedDb, `lib/channels` web-form intake), and the App-Router data-access flow this phase must follow.
- `.planning/phases/01-foundation/01-CONTEXT.md` — **binding Phase-1 decisions that constrain Phase 2:** tenancy via `organizationId` + `scopedDb(orgId)` (D-04/D-15), Server Components for reads / Server Actions for internal mutations / **Route Handlers for external endpoints** (D-14), zod at boundaries, Better Auth org roles owner/admin/member = "agent" (D-06), pg-boss worker pattern (D-16).

### Security (critical for the public channel)
- `docs/SECURITY.md` — untrusted-input handling, secret/authz model, what the Phase-7 security pass verifies. Directly governs: public web-form intake, Markdown→HTML sanitization (D-11), attachment MIME allowlist + authz-scoped serving (D-22/D-23), and the unauthenticated tokenized status page (D-21).

### Requirements & success criteria
- `.planning/REQUIREMENTS.md` — AIDA-01, 02, 03, 04, 05, 06, 07, 08, and AIDA-12 (partial) full acceptance statements.
- `.planning/ROADMAP.md` — Phase 2 goal + the 5 success criteria that gate completion.

### UI & project rules (mandatory)
- `.planning/DESIGN-SYSTEM.md` — **every UI change must conform** (token-only, sidebar/top-bar/empty-state patterns, explicit `text-[Npx]` sizing). Run the §9 design checklist before marking the phase complete.
- `CLAUDE.md` — stack non-negotiables (pg-boss not Redis, pgvector same Postgres, single-server, human-in-the-loop, privacy-first/no-egress).
- `.planning/LOOP-ENGINEERING.md` — phase loop + hard-stop (checkable) completion conditions.
- `.planning/PROJECT.md` — vision, architecture principles, v1 out-of-scope list.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- **UI components** (`src/components/ui/`): `card`, `badge`, `avatar`, `button`, `input`, `label`, `form`, `separator`, `switch`, `dropdown-menu`, `tooltip`, `sonner` (toasts). `src/components/empty-state.tsx` (used by the current Tickets stub), `sidebar.tsx`, `top-bar.tsx`, `theme-*`, `user-menu.tsx`. Reuse `Card`/`Badge`/`Avatar` for ticket rows, status/priority/SLA chips, and contact cards.
- **Tickets stub** (`src/app/(app)/tickets/page.tsx`): currently just an `EmptyState` — Phase 2 replaces it with the real 2-pane inbox.
- **Settings** (`src/app/(app)/settings/page.tsx`): pattern `const { db } = await getScopedDb();` + a Client child (`ai-toggle.tsx`). Extend with SLA-policy, tags, and custom-field admin sections (AIDA-12).

### Established Patterns (must follow)
- **Tenant scoping:** all new domain models get `organizationId` + relation + index; access via `scopedDb(orgId)`. **`src/lib/scoped-db.ts` `DOMAIN_MODELS` allowlist is currently `["Setting"]` and MUST be extended** to Ticket, Contact, Message, Tag, TicketTag, CustomField(+value), SlaPolicy, Attachment, etc.
- **Data access:** Server Components (reads) via `getScopedDb()`; Server Actions (internal mutations, e.g. status change, reply, assign); **Route Handlers** for the public web form + status page + attachment serving. zod-validate every boundary.
- **Auth:** protected routes call `requireSession()`; `session.session.activeOrganizationId` is the workspace id. `auth.ts` uses bare `prisma` (never scopedDb).
- **Worker/jobs:** pg-boss v12 — `boss.createQueue(name)` before `boss.work()`/`boss.schedule()`; handler receives `Job[]` (destructure `([job]) =>`); worker uses **relative imports only**. The SLA-flag job (D-15) follows the existing heartbeat job shape (`src/lib/worker/jobs/heartbeat.ts`).
- **Prisma:** generated client import path `@/generated/prisma/client`; `prisma generate` runs before build.

### Integration Points
- Sidebar nav already has **Tickets / Knowledge Base / Settings**; add **Contacts** (per-contact history, AIDA-03) — decide nav placement per DESIGN-SYSTEM.md.
- New **public route group** (unauthenticated) for the web form + `/status/[token]` — must NOT be caught by the auth middleware guard (middleware currently allows `/login`, `/setup`, `/api/auth/*`, `/api/health`; add the public intake + status paths).
- New Docker **volume for `/data/uploads`** in `docker-compose.yml` (single backup target alongside the Postgres volume).

### Watch-outs
- **Per-workspace sequential ticket number (D-06)** needs a concurrency-safe generator (e.g. a per-org counter row updated in the same transaction, or a Postgres sequence keyed per org) — plain `count()+1` races under concurrent intake.
- **Untrusted input everywhere on the public channel** — sanitize Markdown→HTML, enforce attachment MIME allowlist server-side, keep the status token unguessable and internal-note-blind.

</code_context>

<specifics>
## Specific Ideas

- Inbox should feel like a real **shared inbox (Front/Missive/Zendesk-style)**, not a plain list — the 2-pane reading experience is the product's face.
- **Internal notes must be impossible to confuse with public replies** — amber tint + lock icon + label, driven by an explicit composer toggle.
- The **tokenized status link is the v1 stand-in for email** — it must show the customer their conversation and let them reply/reopen without an account, since email delivery doesn't arrive until Phase 3.
- **Privacy-first shows up concretely here:** the public form uses honeypot + rate-limit rather than a third-party CAPTCHA specifically to honor no-egress.
- SLA model is intentionally **24/7 now but schema-ready for business hours** — don't hardcode assumptions that block the later upgrade.

</specifics>

<deferred>
## Deferred Ideas

- **Email intake/threading + outbound SMTP** — Phase 3 (AIDA-09). D-11 (Markdown→HTML) and D-06 (ticket number in subject) are chosen to make this smooth.
- **Business-hours / holiday / timezone SLA calendars** — later; Phase 2 ships 24/7 with a forward-compatible model (D-13).
- **Contact duplicate-merge tooling** — later phase (D-09).
- **Bulk inbox actions** (multi-select status/assign/tag) — deferred (Claude's Discretion note).
- **User-savable custom views** — v1 ships the fixed Unassigned/Mine/Status set (D-02).
- **Category / request-type picker on the public form** — later; overlaps with custom fields (D-19).
- **CAPTCHA as an optional toggle** — later; v1 is honeypot + rate-limit only (D-20).
- **S3-compatible attachment storage** — later; `FileStorage` interface leaves the door open (D-22).
- **Teams/groups, round-robin/auto-assignment** — later; v1 is individual assignment only.
- **AI on tickets** (triage/draft/insight) — Phases 4–6; zero LLM code in Phase 2.

</deferred>

---

*Phase: 02-core-ticketing*
*Context gathered: 2026-07-01*
