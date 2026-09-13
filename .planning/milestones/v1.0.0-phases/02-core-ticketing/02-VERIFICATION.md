---
phase: 02-core-ticketing
verified: 2026-07-02T03:48:27Z
status: passed
score: 5/5 must-haves (success criteria) verified; 12/12 plans verified
---

# Phase 2: Core Ticketing Verification Report

**Phase Goal:** A genuinely usable helpdesk (no AI yet): create/work tickets through a shared inbox via the web.
**Verified:** 2026-07-02T03:48:27Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent can create a ticket and move it new→open→pending→resolved→closed; changes persist and render in the thread | ✓ VERIFIED | `createTicket()` (src/lib/tickets/create-ticket.ts) stamps initial NEW ticket; `changeStatus` Server Action (`src/app/(app)/tickets/[id]/actions.ts:20-27`) updates status for all 5 enum values, stamping/clearing `resolvedAt` and SLA flags; `StatusChip` renders all 5 states; reading pane (`[id]/page.tsx`) re-fetches and renders the thread after every mutation (`revalidatePath`) |
| 2 | Shared inbox lists tickets with views (Unassigned/Mine/by status), filter, and full-text search | ✓ VERIFIED | `FilterChipRow` (view pills + status multi-select + tag/custom-field filters + debounced search) drives URL searchParams; `fetchTicketList` (`src/lib/tickets/list-query.ts`) builds the Prisma `where` and forwards to `searchTickets()` (org-safe raw FTS, `src/lib/tickets/search.ts`) when `q` is present, correctly forwarding the pagination limit (verified: `searchTickets(ctx.orgId, filters.q, limit)`) |
| 3 | Tickets link to contact records showing per-contact history; agents can assign tickets and post public replies vs private notes (visually distinct) | ✓ VERIFIED | `findOrCreateContact()` links every created ticket to a Contact by normalized email; `/contacts/[id]/page.tsx` shows full ticket history ordered desc; `assignTicket` Server Action + Assignee dropdown in `ticket-meta-header.tsx`; `ThreadMessage` renders 3 distinct variants — internal note uses `bg-warning/10 border-l-warning` + `Lock` icon + "Internal Note" label, confirmed never using primary/indigo |
| 4 | Tags + basic custom fields work and are filterable; SLA first-response/resolution timers compute from priority and show at-risk/breached states | ✓ VERIFIED | `addTag`/`removeTag`/`setCustomFieldValue` actions + tag/custom-field filters in `FilterChipRow`; `getSlaTargets`/`computeDueTimestamps` stamp due dates from `DEFAULT_SLA_TARGETS` at creation; `slaFlagHandler` worker job (2 set-based UPDATEs, breach + proportional 20% at-risk, excludes RESOLVED/CLOSED) wired into `src/lib/worker/index.ts` on a 5-min cron; `SlaDueChip` renders on-track/at-risk/overdue; flags are cleared in the same write as resolve/first-response/priority-downgrade (Pitfall 5, verified in `actions.ts` and `messages/route.ts`) |
| 5 | A public web form creates a ticket and returns a status link; the conversation thread supports attachments | ✓ VERIFIED | `/request` form → `POST /api/public/intake` (honeypot silent-success, `checkRateLimit`, `createTicket(..., direction:"INBOUND")`, attachment validation) → returns `statusToken`; `/status/[token]` reads `visibility: PUBLIC` only (internal notes structurally excluded); attachments accepted on both the agent composer (`/api/tickets/[id]/messages`) and public follow-up (`/api/public/status/[token]/follow-up`), validated via `file-type` magic-byte sniffing against `ALLOWED_MIME` + `MAX_BYTES` |

**Score:** 5/5 truths verified

### Required Artifacts (representative sample across all 12 plans)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | 11 new models + 5 enums | ✓ VERIFIED | 377 lines; Ticket/TicketCounter/Contact/Message/Tag/TicketTag/SlaPolicy/CustomFieldDefinition/CustomFieldValue/Attachment/RateLimitHit all present |
| `prisma/migrations/*_ticket_search/migration.sql` | GENERATED tsvector + GIN for Ticket & Message | ✓ VERIFIED | Confirmed `GENERATED ALWAYS AS` + `USING GIN` for both tables |
| `src/lib/scoped-db.ts` | DOMAIN_MODELS allowlist extended | ✓ VERIFIED | 10 entries incl. Ticket/Contact/Message/Tag/SlaPolicy/CustomFieldDefinition/CustomFieldValue/Attachment/TicketCounter; TicketTag/RateLimitHit correctly excluded |
| `src/lib/tickets/create-ticket.ts` | createTicket() single entrypoint | ✓ VERIFIED (99 lines) | Transaction: contact link → counter upsert → SLA stamp → Ticket + Message create |
| `src/lib/tickets/search.ts` | searchTickets() org-safe FTS | ✓ VERIFIED (33 lines) | `$queryRaw` tagged template, explicit `organizationId` filter, no `$queryRawUnsafe` |
| `src/lib/attachments/local-file-storage.ts` | path-traversal-proof storage | ✓ VERIFIED (42 lines) | `safeKey` regex guard + per-org directory join |
| `src/lib/worker/jobs/sla-flag.ts` | breach/at-risk flag job | ✓ VERIFIED (32 lines) | Two `$executeRaw` UPDATEs, RESOLVED/CLOSED excluded, 20% proportional window |
| `src/lib/authz.ts` | requireOrgAdmin() gate | ✓ VERIFIED (27 lines) | Used by all 3 settings action files (sla/tags/custom-fields) |
| `src/app/(app)/tickets/layout.tsx` + `ticket-list-panel.tsx` | 2-pane inbox shell | ✓ VERIFIED | `w-[360px]` list column; real DB-backed rows (no hardcoded empty data) |
| `src/app/(app)/tickets/[id]/page.tsx` + `actions.ts` | reading pane + mutations | ✓ VERIFIED (150 / 195 lines) | changeStatus/changePriority/assignTicket/addTag/removeTag/setCustomFieldValue all present and SLA-flag-aware |
| `src/components/tickets/thread-message.tsx` / `thread-system-event.tsx` | thread variants + reopen row | ✓ VERIFIED | Only `bodyHtml` passed to `dangerouslySetInnerHTML`; `attachmentHrefBase` prop supports both agent + public routing |
| `src/app/api/tickets/[id]/messages/route.ts` | multipart message + attachment route | ✓ VERIFIED (110 lines) | file-type sniffing, MAX_BYTES check, SLA flag clearing on first public reply |
| `src/app/api/attachments/[id]/route.ts` | authenticated attachment serve | ✓ VERIFIED (36 lines) | `getScopedDb()`-scoped lookup |
| `src/app/(app)/contacts/*` | searchable list + detail + notes | ✓ VERIFIED | ticket history + autosaving notes, nav wired in sidebar/top-bar |
| `src/app/(public)/request/*` + `src/app/api/public/intake/route.ts` | public intake form + route | ✓ VERIFIED | honeypot + rate-limit + createTicket(INBOUND) + attachment validation |
| `src/app/(public)/status/[token]/*` + follow-up/attachments routes | public status page + reopen | ✓ VERIFIED | `visibility: PUBLIC` server-side filter; `triggeredReopen` set only on reopening follow-up; token-scoped attachment join excludes internal notes |
| `docker-compose.yml` / `Caddyfile` / `.env.example` | uploads volume + body cap + env docs | ✓ VERIFIED | `uploads_data` volume, `request_body { max_size 12MB }`, `UPLOADS_DIR`/`RATE_LIMIT_PEPPER` documented |

All artifacts checked exist, are substantive (no stub bodies, no `TODO`/`PLACEHOLDER`/`not implemented` found via anti-pattern scan across every phase-2 file), and are wired (see Key Link Verification below).

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `prisma/migrations/*_ticket_search` | Ticket/Message.searchVector | `GENERATED ALWAYS AS ... STORED` + GIN index | ✓ WIRED | Confirmed in migration.sql for both tables |
| `scoped-db.ts` DOMAIN_MODELS | Ticket/Contact/Message/etc. | allowlist string array | ✓ WIRED | 9 tenant models present; TicketTag/RateLimitHit correctly excluded |
| `createTicket` | TicketCounter | `ticketCounter.upsert` inside `$transaction` | ✓ WIRED | Race-safety proven by `create-ticket.test.ts` (20-way concurrency, unique numbers, Set size === 20) |
| `createTicket` initial Message | `renderMarkdown` | sanitized bodyHtml | ✓ WIRED | grep-confirmed in create-ticket.ts |
| `searchTickets` | Ticket/Message.searchVector | `websearch_to_tsquery` + explicit `organizationId` filter | ✓ WIRED | Cross-tenant isolation proven by `search-isolation.test.ts` (subject-match + body-match scenarios, both green) |
| `messages route` | renderMarkdown + localFileStorage + file-type | sanitized bodyHtml + validated attachments | ✓ WIRED | Confirmed: `fileTypeFromBuffer`, `ALLOWED_MIME.has`, `localFileStorage.save`, `renderMarkdown(body)` all present |
| `changeStatus` (RESOLVED/CLOSED) | isAtRisk/isBreached cleared + resolvedAt set | same-write flag clearing | ✓ WIRED | `actions.ts:25`: `{ status, resolvedAt: new Date(), isAtRisk: false, isBreached: false }` |
| `changePriority` (downgrade) | recomputed due timestamps + flags cleared | same-write reset | ✓ WIRED | `actions.ts:65-66`: `isAtRisk: false, isBreached: false` in the same update as the recomputed due timestamps |
| `ThreadMessage` internal-note variant | `--warning` amber + Lock | `bg-warning/10 border-l-warning` + Lock icon | ✓ WIRED | Confirmed exact classes + `Lock` import + "Internal Note" label |
| `[id]/page.tsx` thread map | `ThreadSystemEvent` auto-reopen row | render immediately after `message.triggeredReopen === true` | ✓ WIRED | Confirmed in both the agent page (`[id]/page.tsx:137`) and the public status page (`status/[token]/page.tsx:90`) |
| `follow-up route` | ticket status → OPEN + `triggeredReopen: true` | same transaction, gated on `shouldReopen` | ✓ WIRED | Both writes gated on the identical `shouldReopen` boolean inside one `$transaction` |
| `status page query` | Message.visibility = PUBLIC | server-side `where` filter | ✓ WIRED | `messages: { where: { visibility: "PUBLIC" }, ... }` — never client-filtered |
| `public attachment route` | internal-note exclusion | Prisma join on `{ ticketId, visibility: PUBLIC }` | ✓ WIRED | Structural guarantee confirmed by reading the route source |
| `worker/index.ts` | `slaFlagHandler` / `rateLimitCleanupHandler` | createQueue + work + schedule | ✓ WIRED | `sla-flag` every 5 min, `rate-limit-cleanup` daily 03:00, both alongside pre-existing heartbeat |
| settings actions (sla/tags/custom-fields) | `requireOrgAdmin()` | called first in every mutating action | ✓ WIRED | Confirmed present in all 3 action files |
| `middleware.ts` | public routes | `PUBLIC_PREFIXES` | ✓ WIRED | Contains `/request`, `/status`, `/api/public` |
| `docker-compose.yml` app service | `uploads_data:/data/uploads` | named volume | ✓ WIRED | Present in both service mount and top-level `volumes:` block |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `TicketListPanel` | `tickets` | `fetchTicketList()` → `db.ticket.findMany()` (scopedDb) | Yes — real Prisma query, includes contact/assignee/tags | ✓ FLOWING |
| `TicketListPanel` | `totalTicketCount` | `db.ticket.count()` | Yes | ✓ FLOWING |
| `[id]/page.tsx` | `ticket` (with messages/tags/customFieldValues) | `db.ticket.findFirst({ include: {...} })` | Yes | ✓ FLOWING |
| `/contacts/[id]/page.tsx` | `contact.tickets` | `db.contact.findFirst({ include: { tickets } })` ordered desc | Yes | ✓ FLOWING |
| `/status/[token]/page.tsx` | `ticket.messages` | `prisma.ticket.findUnique` filtered `visibility: PUBLIC` | Yes | ✓ FLOWING |
| `sla/page.tsx` | SLA policy rows | `db.slaPolicy.findMany()` with seeded-default fallback | Yes | ✓ FLOWING |

No hollow props or static-empty-array data sources found in any Phase 2 UI surface.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean across all 12 plans' code | `pnpm exec tsc --noEmit` | exit 0, no output | ✓ PASS |
| Production build succeeds (all routes generate) | `pnpm run build` | Compiled successfully; 21 routes generated incl. all Phase-2 routes | ✓ PASS |
| Unit tests (renderMarkdown XSS/GFM + others) | `pnpm test` | 4 files, 14/14 tests passed | ✓ PASS |
| Integration tests (Testcontainers real Postgres): scoped-tx, create-ticket (20-way concurrency), search-isolation, workspace-isolation | `volta run --node 22 pnpm test:integration` | 4 files, 9/9 tests passed; migrations `core_ticketing` + `ticket_search` replay cleanly on a fresh Testcontainers DB | ✓ PASS |
| No `$queryRawUnsafe` in search module | grep | 0 matches | ✓ PASS |
| No hardcoded hex/oklch literals in chip components | grep `oklch(\|#[0-9a-f]{3,6}` across `src/components/tickets/*.tsx` | 0 matches | ✓ PASS |
| No TODO/FIXME/PLACEHOLDER/"not implemented" across all Phase-2 lib/app/component files | grep | 0 matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| AIDA-01 | 02-01, 02-03, 02-06, 02-09 | Create ticket + lifecycle transitions persist/visible | ✓ SATISFIED | `createTicket`, `changeStatus`, `StatusChip`, thread render |
| AIDA-02 | 02-01, 02-04, 02-08 | Shared inbox: views + filter + FTS | ✓ SATISFIED | `FilterChipRow`, `fetchTicketList`, `searchTickets` |
| AIDA-03 | 02-03, 02-10 | Contact linkage + ticket history view | ✓ SATISFIED | `findOrCreateContact`, `/contacts/[id]` |
| AIDA-04 | 02-02, 02-09, 02-12 | Assign + public reply vs internal note (visually distinct) | ✓ SATISFIED | `assignTicket`, `ThreadMessage` 3 variants |
| AIDA-05 | 02-07, 02-08, 02-09 | Tags + custom fields, filterable | ✓ SATISFIED | Tag/custom-field filter (08) + apply/edit (09) + admin CRUD (07) |
| AIDA-06 | 02-01, 02-03, 02-05, 02-06, 02-07, 02-09 | SLA timers from priority + at-risk/breach indicator | ✓ SATISFIED | `getSlaTargets`, `slaFlagHandler`, `SlaDueChip`, admin SLA settings, flag-clearing on resolve/reply/downgrade |
| AIDA-07 | 02-02, 02-04, 02-09 | Chronological thread + attachments | ✓ SATISFIED | `ThreadMessage`, multipart messages route, `AttachmentChip` |
| AIDA-08 | 02-05, 02-11, 02-12 | Public web form creates ticket + status link | ✓ SATISFIED | `/request` → `/api/public/intake` → `/status/[token]` + follow-up/reopen |
| AIDA-12 (partial) | 02-07 | Settings area (SLA policies + tags + custom fields slice only, per ROADMAP's explicit "partial" scope) | ✓ SATISFIED (scoped) | Settings sub-nav + 3 admin surfaces, `requireOrgAdmin()` gate on every mutation. Branding/channels/AI-provider-keys config are correctly deferred to later phases per ROADMAP's "(partial)" annotation — not a gap in Phase 2's own scope. |

No orphaned requirements: all 9 requirement IDs listed in ROADMAP.md for Phase 2 (AIDA-01…08, AIDA-12 partial) appear in at least one plan's frontmatter `requirements:` field and are backed by concrete, verified code.

### Anti-Patterns Found

None. Full grep sweep across every Phase-2 `src/lib`, `src/app/(app)/tickets`, `src/app/(app)/contacts`, `src/app/(app)/settings`, `src/app/(public)`, `src/app/api/tickets`, `src/app/api/attachments`, `src/app/api/public`, `src/components/tickets`, `src/components/public`, and `src/lib/worker/jobs` files found zero occurrences of `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon". No stub `return null`/empty-body handlers were found in the sampled route handlers and Server Actions (all read/write real data through scopedDb or bare-prisma-with-explicit-org-filter).

Two pre-existing, explicitly out-of-scope items are logged in `deferred-items.md` (repo-wide CRLF/LF formatter mismatch from `core.autocrlf=true`; a cosmetic Turbopack NFT-trace build warning on `local-file-storage.ts`) — both are environment/tooling artifacts, not functional gaps, and do not affect `tsc`, `next build`, or test outcomes (confirmed above).

### Human Verification Required

The following are inherently visual/interactive and were not (and cannot be) fully verified by static analysis or automated tests — recommended before considering the phase's UI polish final, per CLAUDE.md's design-checklist requirement:

1. **Visual QA of the 2-pane inbox, reading pane, and public pages against DESIGN-SYSTEM.md**
   **Test:** Open `/tickets`, `/tickets/[id]`, `/contacts`, `/request`, `/status/[token]` in a browser at both desktop width and with dark mode toggled.
   **Expected:** Sidebar/top-bar tokens, chip colors (amber/emerald/destructive), and typography match DESIGN-SYSTEM.md exactly (already grep-verified as token-only, but final pixel/contrast review needs human eyes).
   **Why human:** Visual rendering and color contrast cannot be verified from source code alone.

2. **End-to-end walkthrough: create ticket via public form → agent replies → customer follow-up reopens closed ticket**
   **Test:** Submit `/request`, resolve/close the resulting ticket as an agent, then submit a follow-up on `/status/[token]` and confirm the "Ticket reopened — new reply from {contact}." row appears in both the agent thread and the public thread at the correct chronological position, and the ticket's status flips back to OPEN.
   **Expected:** Reopen row renders immediately after the reopening message on both surfaces; ticket status updates without a page refresh issue.
   **Why human:** Requires a live database, live worker, and real browser interaction across two different session contexts (authenticated agent + unauthenticated public token) — code paths were verified statically and via integration tests, but the full live round-trip through the UI was not driven by this verification pass.

3. **SLA at-risk/breach visual states over real elapsed time**
   **Test:** Create a ticket, wait past its first-response due time (or manually backdate `firstResponseDueAt` in the DB), and confirm the worker's 5-minute `sla-flag` job actually flips `isAtRisk`/`isBreached` and the `SlaDueChip` updates to the correct color/icon in the UI on next load.
   **Expected:** Chip transitions on-track → at-risk (amber) → overdue (red) as time passes, matching the worker's proportional 20% window.
   **Why human:** Requires the live pg-boss worker process running on a schedule; not exercised by this verification's static/build/test checks (the worker's SQL logic itself is code-reviewed and matches spec exactly).

### Gaps Summary

None. All 5 phase success criteria are verified with concrete code evidence, all 12 plans' declared must-haves (truths/artifacts/key-links) are backed by existing, substantive, wired code, `tsc --noEmit` and `pnpm run build` both pass clean, and all 23 automated tests (14 unit + 9 integration against a real Testcontainers Postgres) pass. No stub code, no orphaned requirements, no missing artifacts. The phase goal — "a genuinely usable helpdesk (no AI yet): create/work tickets through a shared inbox via the web" — is achieved in the actual codebase, not merely claimed in SUMMARY.md files.

---

*Verified: 2026-07-02T03:48:27Z*
*Verifier: Claude (gsd-verifier)*
