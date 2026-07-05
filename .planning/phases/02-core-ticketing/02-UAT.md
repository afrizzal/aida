---
status: complete
phase: 02-core-ticketing
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md]
started: 2026-07-05T03:27:59Z
updated: 2026-07-05T05:09:04Z
---

## Current Test

[testing complete]

## Execution Mode

User delegated execution: Claude drove every test through the real UI/API
(Playwright against a fresh instance per run + the live docker compose stack)
and recorded results. Evidence per suite:
- E2E feature suite: 24/24 passed (tests/e2e — fresh testcontainer DB, real browser, setup wizard included)
- UAT gap suite: 9/9 passed (tests/e2e/uat-gaps.spec.ts — written during this UAT for uncovered items)
- Integration: 14/14 passed (tests/integration — concurrency, SLA flags, org isolation)
- Unit: 14/14 passed (tests/unit)
- Cold start: verified against the real `docker compose` stack

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass
notes: |
  Full `docker compose down` → rebuild → `up -d`. Boot chain db→migrate→app+worker+caddy:
  "All migrations have been successfully applied", app & db healthy, /api/health returned
  {"status":"ok","db":"connected","worker":{"lastRunAt":"2026-07-05T05:01:21Z"}} (fresh
  pg-boss heartbeat), homepage renders the login page over Caddy auto-HTTPS.
  Issue found & fixed during this test: .claude/ agent worktrees (11.8GB) leaked into the
  docker build context because dockerignore patterns are root-anchored — builds stalled
  >45min. Fixed in .dockerignore (commit 28eb0c7); context now 1.2MB, rebuild ~8min.

### 2. Submit a Public Support Request
expected: An unauthenticated visitor can go to /request, fill in Name/Email/Subject/Message (+ optional file attachments), and submit with no login. On success they land on a "Request received" confirmation screen with a link to check their ticket's status.
result: pass

### 3. Public Intake Spam Protection
expected: A hidden "company_website" honeypot field, if filled in (as automated bots do), makes the form appear to succeed (confirmation shown) but silently creates no ticket. Separately, after 5 submissions from the same IP within an hour, further /request submissions are rejected with a rate-limit message instead of creating more tickets.
result: pass
notes: honeypot verified via browser form; rate limit verified end-to-end — 5 submissions 200, 6th 429, form shows the rate-limit message, exactly 5 tickets in DB.

### 4. Public Intake Attachment Validation
expected: Attaching a file over 10MB or of a disallowed type to the /request form is rejected on the server (checked by real file content, not just the browser-reported type or extension).
result: pass
notes: |
  Verified against the API directly (bypassing client-side validation): 11MB file → 413
  file_too_large; EXE magic bytes disguised as image/png named .png → 415
  unsupported_file_type (content-sniffed via file-type); zero tickets created.
  Issue found & fixed during this test: Next.js buffers proxied request bodies at 10MB by
  default, truncating uploads before the route's own 413/415 checks could run (and breaking
  legal multi-file submissions >10MB combined). Fixed via experimental.proxyClientMaxBodySize
  = MAX_TOTAL_REQUEST_BYTES (30MB) in next.config.ts.

### 5. Agent Creates a New Ticket
expected: From the ticket list's header, clicking "New Ticket" opens a dialog to enter subject/contact/priority/message; submitting creates the ticket and it immediately appears in the shared inbox list.
result: pass
notes: dialog flow verified incl. priority change to High; redirects to the new ticket and the row appears in the inbox list.

### 6. Sequential Ticket Numbering
expected: Each new ticket created within an organization is assigned the next sequential ticket number, with no duplicates, even when multiple tickets are created at nearly the same time.
result: pass
notes: integration test creates tickets concurrently and asserts gapless unique numbering.

### 7. Duplicate Contacts Are Merged Automatically
expected: Submitting a new ticket/request with an email address that already belongs to an existing contact (case-insensitive, e.g. "A@X.com" vs "a@x.com") links to that same existing contact instead of creating a second one.
result: pass
notes: case-variant emails dedupe to a single contact with both tickets in its history.

### 8. View the Shared Ticket Inbox
expected: The /tickets page shows a scrollable ticket list (contact + relative time, subject, status/priority chips, SLA timer, tags, assignee avatar) in a two-pane layout with a reading-pane area alongside it.
result: pass
notes: list chrome exercised across inbox/sla specs; two-pane verified explicitly (list search box stays visible alongside an open thread).

### 9. Filter Tickets by View/Status/Tag/Custom Field
expected: Using the filter controls above the list (Unassigned/Mine/All view pills, a status multi-select, a tag picker, a custom-field picker) narrows the visible tickets to only matching ones, and the URL updates to reflect the active filters.
result: pass
notes: Unassigned view, Mine view, status filter, tag filter, and custom-field filter each verified.

### 10. Search Tickets by Keyword
expected: Typing into the ticket search box (after a short debounce) returns only tickets in the current organization whose subject or message body contains the search term.
result: pass
notes: full-text body search verified; org isolation covered by integration search-isolation test.

### 11. Inbox Empty States
expected: A brand-new workspace with zero tickets shows a "Your inbox is empty" empty state; a filter/search combination that matches nothing shows a smaller "Nothing here" message instead of an error or blank screen.
result: pass
notes: fresh workspace (0 tickets) shows "Your inbox is empty"; no-match search shows "Nothing here — no tickets match this view."

### 12. Open a Ticket in the Reading Pane
expected: Clicking a ticket row opens /tickets/[id], showing the full message thread in chronological order while the ticket list remains visible alongside it.
result: pass

### 13. Change Ticket Status
expected: Using the Status dropdown in the ticket header updates the ticket's status (e.g. to Resolved), and the new status chip is reflected immediately in both the reading pane and the list row.
result: pass
notes: full lifecycle new→open→pending→resolved→closed persists across reload.

### 14. Change Ticket Priority
expected: Using the Priority dropdown updates the ticket's priority chip and recalculates its SLA due timer to match the new priority's targets.
result: pass
notes: priority change recomputes SLA due timestamps and clears stale flags.

### 15. Assign a Ticket to an Agent
expected: Using the Assignee dropdown in the ticket header assigns the ticket to an agent, replacing the dashed "Unassigned" placeholder with that agent's avatar/initials.
result: pass

### 16. Add and Remove Tags on a Ticket
expected: From the ticket header's tag editor, an agent can search for or create a tag and add it (appears as a chip on the ticket), and can remove an existing tag chip from the ticket.
result: pass

### 17. Edit Custom Field Values on a Ticket
expected: Custom fields defined in Settings (text/select/number/checkbox/date) appear as editable inputs in the ticket header, and changing a value saves it against that specific ticket.
result: pass
notes: value persists across reload.

### 18. Post a Public Reply
expected: Using the composer's "Public Reply" mode, an agent writes a message (Markdown bold/links etc. render correctly) and sends it; it appears in the thread as an outbound message visible to the customer.
result: pass
notes: markdown rendering verified in-thread; sanitization covered by unit markdown-render tests.

### 19. Add an Internal Note
expected: Switching the composer to "Internal Note" mode and sending a message adds it to the thread with a visually distinct locked/amber style, and this note never appears on the customer-facing public status page.
result: pass
notes: amber styling asserted; public status page verified to show only PUBLIC messages.

### 20. Attach Files to a Reply and Download Them
expected: An agent can attach one or more files to a composer message; after sending, each attachment appears as a downloadable chip in the thread, and downloading it requires being logged into that workspace.
result: pass
notes: authenticated download works; anonymous (cookie-less) request is rejected.

### 21. SLA At-Risk/Breach Indicators
expected: Each ticket shows an SLA timer chip reading "on track" normally, switching to "at-risk" as the due time approaches and to "breached" once overdue, recomputed automatically every few minutes. The indicator clears immediately once an agent sends the first public reply or resolves the ticket, rather than waiting for the next automatic refresh.
result: pass
notes: on-track chip with plausible due time verified in UI; at-risk/breach transitions and immediate clearing covered by sla-flag-handler integration tests (worker recompute logic).

### 22. Configure SLA Policy Targets (Admin)
expected: In Settings > SLA Policies, an org admin can view and edit the first-response and resolution time targets (in hours) for each of the 4 priority levels, and the changes persist.
result: pass
notes: edited first-response target to 7.5h, saved, survives reload.

### 23. Manage Tags (Admin)
expected: In Settings > Tags, an admin sees every tag with a count of how many tickets use it, can rename a tag inline, and can delete a tag after confirming in a dialog.
result: pass
notes: usage count shown, inline rename committed on Enter, delete behind confirm dialog.

### 24. Manage Custom Field Definitions (Admin)
expected: In Settings > Custom Fields, an admin can add a new field (choosing Text/Select/Number/Checkbox/Date, with option values for Select), edit an existing definition, or delete one after a confirmation dialog.
result: pass
notes: full add (Dropdown with 2 options) → edit label → confirmed delete verified end-to-end.

### 25. Non-Admin Blocked From Admin Settings Mutations
expected: A user who is not an org owner/admin cannot successfully save/rename/delete SLA policies, tags, or custom fields — the action is rejected server-side even if the settings page is reached.
result: pass
notes: member's SLA save rejected server-side (value unchanged after reload); unauthenticated /api/* returns 401 JSON (middleware unit tests); org isolation covered by integration tests.

### 26. Browse Contacts List
expected: The /contacts page lists every contact in the org (avatar, email, company, ticket count, last activity) and can be filtered by typing a name, email, or company into the search box.
result: pass
notes: list renders name/company; search narrows to matching contact only.

### 27. View Contact Detail and Ticket History
expected: Opening a contact from the list shows a header card with their info plus every ticket they've ever opened, newest first, each row showing its status chip.
result: pass

### 28. Add Notes to a Contact
expected: Typing a note into the contact detail page's Notes field and clicking away (blur) autosaves it, showing a "Saved" confirmation without requiring an explicit save button.
result: pass
notes: autosave on blur verified and note survives reload.

### 29. View Public Ticket Status Page
expected: A customer visiting their /status/{token} link (no login) sees the ticket's current status and only the public parts of the conversation thread — internal notes are never shown.
result: pass
notes: internal notes absent from public page; invalid token shows dead-end state.

### 30. Follow Up on a Public Ticket
expected: From the status page, a customer can send a follow-up message (with optional attachments); if the ticket was Resolved/Closed, this automatically reopens it and a "Ticket reopened" event row appears in the thread. Attachments linked from this page can only be downloaded via the tokenized public route and can never expose files attached to internal-only notes.
result: pass
notes: follow-up on resolved ticket auto-reopens (visible on both pages); public attachment route only ever serves public-message attachments.

## Summary

total: 30
passed: 30
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — 2 issues surfaced during testing were root-caused and fixed inline:
 (1) docker build context bloat via .claude worktrees → .dockerignore fix;
 (2) Next.js 10MB proxy body cap truncating intake uploads before app-level
 413/415 checks → proxyClientMaxBodySize = 30MB in next.config.ts]

## Follow-ups (non-blocking)

- Next 16 warns `middleware.ts` convention is deprecated → rename to `proxy.ts` in a future phase.
- 12 stale agent worktree directories remain under .claude/worktrees (~11GB disk); `git worktree prune` + manual cleanup recommended after checking for uncommitted agent work.
