# REQUIREMENTS — AIDA v2.0 (Helpdesk & Projects)

**Defined:** 2026-11-07, from the owner's decision recorded in `PROJECT.md` and the run charter `run-loop/PIAGAM.md`.
**Core value:** unchanged from `PROJECT.md`. v2.0 closes the v1 gaps that need no human, then adds a Projects module inside AIDA.

Each requirement is a single testable statement. The bracket names its source: `F-nn` is a finding in `milestones/v1.0.0-phases/07-launch-readiness/07-SECURITY-PASS.md`, `SEED-nnn` is a file in `seeds/`, `FITUR` is a row of `run-loop/FITUR-PROJECTS.md`, and `Charter` is the phase table in `run-loop/PIAGAM.md`. `Accept` is the check that closes it. A requirement closes only on that evidence.

IDs continue at AIDA-25. AIDA-18 keeps its v1 ID.

## Security hardening

- [ ] **AIDA-25** `v2` — Production dependencies carry no known critical or high advisory. [Charter, F-05] Accept: `pnpm audit --prod --audit-level=high` exits 0. Otherwise every remaining critical and high advisory is listed in `docs/SECURITY.md` with its ID, why it cannot be fixed, and why it is not reachable, and the gate is reported red with that list, never as passed. The exit code of plain `pnpm audit --prod` is recorded as it is.
- [ ] **AIDA-26** `v2` — Dependency updates and audits are automated in the repository. [Charter] Accept: `.github/dependabot.yml` exists and a CI job runs `pnpm audit --prod --audit-level=high`. Files only; this run triggers no workflow.
- [ ] **AIDA-27** `v2` — The `app`, `worker` and `migrate` containers run as a non-root user, and uploads keep working. [Charter, F-06] Accept: `app` and `worker` run with a non-zero UID while up; the one-shot `migrate` service runs with a non-zero UID and exits 0, shown by inspecting its exited container or by `id -u` in the same image; an attachment upload succeeds on a fresh volume; the upgrade path for an existing root-owned `uploads_data` volume is handled or documented in `docs/OPERATIONS.md`.
- [ ] **AIDA-28** `v2` — Every HTML response carries a Content-Security-Policy that blocks inline script without a nonce and limits `connect-src` to the same origin. [Charter, F-15] Accept: an E2E test asserts the header and zero CSP violations on login, inbox, ticket, public request and public status pages.
- [ ] **AIDA-29** `v2` — The client IP used for rate limiting comes from one trusted-proxy-aware helper, so a client cannot change its rate-limit identity by sending `X-Forwarded-For`. [Charter, F-07] Accept: unit tests cover the shipped Caddy topology and a spoofed header; all public routes use the helper; the deployment constraint is documented in `docs/OPERATIONS.md`.
- [ ] **AIDA-30** `v2` — Public routes are protected against abuse. [Charter, F-12] Accept: `/api/health` and `/api/public/status/[token]/attachments/[id]` are throttled without breaking the container healthcheck; `follow-up` enforces a combined request-size cap; both status POST routes check the rate limit before the token lookup.
- [ ] **AIDA-31** `v2` — Connection tests return categorized errors, not raw failure text. [Charter, F-08] Accept: all four call sites (`settings/actions.ts` for LLM and embedding, `settings/email/actions.ts` for SMTP and IMAP) return a fixed category. The v1 pass named only two of these.
- [ ] **AIDA-32** `v2` — The remaining open v1 security findings are closed or justified. [F-11, F-13, F-14] Accept: `NEXT_TELEMETRY_DISABLED=1` is set in the image build and runtime; `next build` makes no request to Google Fonts (the conservative default is a system font stack; a vendored font needs its license cleared first); `addTag` gates before validating; `sla-flag` documents why its raw SQL has no org filter; `docs/SECURITY.md` matches the code.

## Operations

- [ ] **AIDA-33** `v2` — Backups run on a schedule inside the single compose stack, with retention, and can be turned off. [Charter] Accept: each run produces one set holding the database dump and the uploads archive; if either part fails, the whole set is marked failed and reported; retention prunes whole sets; every attachment record in a set's dump has its file in that set's archive, even when attachments are added, replaced or deleted during the run, proven by a test that changes attachments mid-backup; a test restores a set into an isolated stack and compares attachment records with their file contents; no Redis and no managed service; `docs/OPERATIONS.md` covers it.
- [ ] **AIDA-34** `v2` — An admin can upload a workspace logo shown in the sidebar and on public pages, with the name-only fallback intact. [Charter] Accept: bytes are sniffed, SVG is rejected, the public serving route is listed in `src/proxy.ts` and throttled, and an E2E test covers upload, replace and fallback.
- [ ] **AIDA-35** `v2` — A `POSTGRES_PASSWORD` containing URL-reserved characters works. [Charter] Accept: with a synthetic test password containing `/ @ : # ?`, a test checks the `DATABASE_URL` that `docker compose config` resolves for every service that uses one, programmatically and without printing it, and a stack booted with the same password connects from `migrate`, `app` and `worker`; no log or recorded evidence contains the password.
- [ ] **AIDA-36** `v2` — Every app page has exactly one `<h1>`. [Charter] Accept: an E2E test asserts the count on every app route.
- [ ] **AIDA-37** `v2` — Neither `pnpm db:seed` nor the `DEMO_MODE` boot can plant demo data or demo accounts in a database that holds anything else, and neither prints a password. [Charter, F-09, F-10] Accept: infrastructure data never counts: `_prisma_migrations`, the `pgboss` schema, `SystemSetting` (which the worker heartbeat writes every minute) and `RateLimitHit`. Tenant data is any `organization` or `user` row; every org-scoped row hangs off an organization, so this covers all of it. Before any write, `pnpm db:seed` refuses when tenant data exists. The `DEMO_MODE` boot seeds when no tenant data exists, skips when the only organization is the demo one and every user is a demo identity, and refuses otherwise (today `src/lib/demo/bootstrap-demo.ts` checks only the ticket count). Tests cover a fresh and a repeated demo boot after the heartbeat has run, and refusal by both paths on a database holding a non-demo organization or user with zero tickets, comparing the row count of every table before and after; `prisma/seed.ts` and `scripts/capture-demo-assets.ts` no longer print the password.
- [ ] **AIDA-38** `v2` — Demo-boot idempotency, the seed guard and the backup/restore round trip are permanent regression tests. [Charter] Accept: they run from the repository test suites, not from one-off evidence in `07-VERIFICATION.md`.
- [ ] **AIDA-39** `v2` — Phase 1 has a `01-VERIFICATION.md` built from evidence. [Charter] Accept: the file sits in `milestones/v1.0.0-phases/01-foundation/`, cites commands run at a named commit, and leaves human-only checks open rather than marking them passed.
- [ ] **AIDA-40** `v2` — The repo-health items of SEED-010 ship. [Charter, SEED-010] Accept: `scripts/install.sh` is tested against a local stand-in for a release and makes no call beyond the documented download; `check-version` workflow, `AGENTS.md`, `CODEOWNERS` and README widgets exist, except any item that needs an owner account, which is recorded as a manual item.
- [ ] **AIDA-41** `v2` — `STATE.md` contains no stale statement. [Charter] Accept: every open todo and caveat is re-checked against the repository and either corrected or removed.

## Team and collaboration

- [ ] **AIDA-42** `v2` — An admin can invite a person by email and role, and that person can join the workspace. [Charter, SEED-007, F-16] Accept: with a fake SMTP, the invitation reaches the invited address with a working link; a reused, expired or mismatched-email token fails; an inviter cannot grant a role above their own; when SMTP is off a copyable link is offered; E2E covers accept, expiry and org isolation. This also delivers the invite half of v1's AIDA-10, which was recorded complete although no invite flow exists.
- [ ] **AIDA-43** `v2` — An admin can list members, change a role and deactivate a member from Settings → Team, and a deactivated member loses access at once. [Charter, SEED-007] Accept: authorization is enforced server-side; a session opened before the deactivation is refused on its next request to pages, server actions, API routes and attachment downloads (today `getScopedDb` reads only `activeOrganizationId` and never re-checks membership); the last admin cannot be removed, including by two concurrent requests; notifications and digests stop for a deactivated member, and invitations they sent that nobody accepted are revoked; each change writes an audit event. The optional third role is decided in the Phase 10 CONTEXT.
- [ ] **AIDA-44** `v2` — Members get in-app notifications for assignment, customer reply, mention, and SLA at-risk or breach. [Charter, SEED-008] Accept: a top-bar bell shows the unread count; read and archive persist; notifications are scoped to organization and user, with an unmocked isolation test.
- [ ] **AIDA-45** `v2` — Internal notes support `@mentions` of workspace members. [Charter, SEED-008] Accept: autocomplete offers members only; the mention renders through the sanitized markdown path; the mentioned member is notified; a mention inside a public reply cannot leak to the customer.
- [ ] **AIDA-46** `v2` — Members control notifications per event type and can receive a batched email digest. [Charter, SEED-008] Accept: with a fake SMTP, a pg-boss job batches unread notifications into one email per recipient; turning an event type off removes it from the digest; a digest is marked sent only after the SMTP server accepts it, a job retried after a failure before that handoff sends no duplicate, and the remaining window (accepted but not confirmed) is documented; no recipient sees another's notifications; subjects carry no customer PII and no `AuditEvent.input`.

## Inbox productivity

- [x] **AIDA-47** `v2` — An agent can save the current inbox filters as a private or shared view. [Charter, SEED-005] Accept: filters are validated against the existing filter schema; shared views are org-scoped with an unmocked isolation test; views appear in the sidebar using `sidebar-*` tokens.
- [x] **AIDA-48** `v2` — An agent can select many tickets and assign, change status, change priority, or add and remove a tag in one action. [Charter, SEED-005] Accept: one transaction, one audit entry per ticket, and a test proves a failure rolls back the batch.
- [x] **AIDA-49** `v2` — A command palette opens with `⌘K` and `Ctrl+K`, with context-aware commands for navigation, ticket search, ticket creation and switching views. [Charter, SEED-006] Accept: E2E covers each command group; the registry can accept commands from other modules.
- [x] **AIDA-50** `v2` — The inbox and ticket page can be driven by keyboard. [Charter, SEED-006] Accept: shortcuts, chords with a timeout, and a `?` help modal work; keystrokes are ignored inside inputs and editors; a docs page lists the keys.
- [x] **AIDA-51** `v2` — Resolved tickets close automatically after a configurable quiet period. [Charter, SEED-009] Accept: an org setting with 0 meaning off; a pg-boss cron job closes qualifying tickets with an audit event; any customer notice is a fixed template, off by default, with no AI text.

## Ticket lifecycle

- [x] **AIDA-52** `v2` — Tickets can be linked as `duplicate_of`, `related_to` or `child_of`. [Charter, SEED-003] Accept: links are unique per pair, org-scoped, and shown from both sides.
- [ ] **AIDA-53** `v2` — An agent can merge one ticket into another. [Charter, SEED-003] Accept: messages and attachments move; the source closes as a duplicate; confirmation is required; a full `AuditEvent` is written; no hard delete. Each status link keeps working but shows only what its holder could see before the merge plus replies addressed to that holder, tested with two contacts across the status page, attachments, follow-up and CSAT. If that rule cannot be met, merging tickets of different contacts is refused.
- [x] **AIDA-54** `v2` — A ticket can be snoozed until a date or the next customer reply. [Charter, SEED-003] Accept: a pg-boss job and the inbound reply paths both wake it; the inbox has a snoozed filter; auto-close skips snoozed tickets.
- [x] **AIDA-55** `v2` — A ticket shows a unified activity feed of merges, snoozes, relations, state changes and assignments. [SEED-003, plane-inspiration §4] Accept: the feed renders in order and is org-scoped.
- [x] **AIDA-56** `v2` — Tickets move from the fixed status enum to org-defined states grouped into `open`, `pending`, `resolved` and `closed`, without data loss. [Charter, SEED-004] Accept: a migration test on populated data gives every organization its default state set; every reader of status reasons about the group, each one tested: filters, chips, the raw SQL in `src/lib/worker/jobs/sla-flag.ts`, Insight SQL, the public status page, stored saved-view filters, auto-close and demo fixtures.
- [x] **AIDA-97** `v2` — Admins can create, rename, recolor, reorder and set the default ticket state, and can remove a state only after its tickets are reassigned. [Charter, SEED-004] Accept: an admin gate on the server; org-scoped with an unmocked isolation test; E2E covers each action.
- [x] **AIDA-57** `v2` — SLA clocks pause while a ticket sits in a `pending`-group state. [Charter, SEED-004] Accept: after several pauses of controlled length, each timer's due time has moved by exactly the paused time, including across a worker restart; the real `sla-flag` worker raises no flag while a ticket is paused and flags correctly after it resumes; tickets already pending at migration time get a defined, tested pause start, with no retroactive deadline change.
- [x] **AIDA-18** `v2` — AIDA proposes a new KB article drafted from one or more resolved tickets, for admin review and approval. [Charter, v1 backlog] Accept: generation goes through `src/lib/llm/`, is disabled when AI is off, redacts secrets, treats ticket text as untrusted, and nothing publishes without an admin action.

## Integrations

- [ ] **AIDA-58** `v2` — Admins can create API tokens that are hashed at rest, with expiry, last-used tracking, a read or read-write scope and a per-token rate limit. [Charter, SEED-002] Accept: the secret is shown once; a revoked or expired token gets 401; a read token cannot write; a token whose creator is deactivated stops working; going over the limit returns 429; tokens are org-scoped with an unmocked isolation test.
- [ ] **AIDA-59** `v2` — A versioned REST API at `/api/v1/*` authenticates with those tokens and covers at least reading tickets, messages, contacts and tags, creating tickets, updating status, priority and assignee, and adding internal notes. [Charter, SEED-002] Accept: the OpenAPI document in the docs lists every operation with its required scope; every operation has an authentication test and an unmocked cross-org test; responses never include encrypted settings or `AuditEvent.input`.
- [ ] **AIDA-60** `v2` — Admins can register outbound webhooks signed with HMAC-SHA256. [Charter, SEED-002] Accept: tests against a fake receiver verify the signature, an org-bound payload, retry with backoff through pg-boss, the delivery log, and auto-deactivation after repeated failures, which notifies the workspace admins in-app and by email when SMTP is on; the SSRF guard blocks private ranges, localhost, redirects and DNS rebinding.
- [ ] **AIDA-61** `v2` — An agent can escalate a ticket to GitHub Issues or Plane through one adapter interface. [Charter, SEED-001] Accept: an interface mirroring `src/lib/llm/`, a `TicketExternalLink` model, encrypted credentials, and adapters tested against fake servers only. Implemented from `research/plane-inspiration.md`, never from AGPL source.
- [ ] **AIDA-62** `v2` — Tracker status changes return as an internal note on the ticket. [Charter, SEED-001] Accept: the inbound route verifies the HMAC before parsing, is rate-limited and listed in `src/proxy.ts`, rejects replays, and treats the payload as untrusted.
- [ ] **AIDA-63** `v2` — Every new egress path is documented and tested. [Charter] Accept: `docs/SECURITY.md` and `tests/integration/egress-isolation.test.ts` cover webhook and tracker destinations.

## Projects foundation

Clean-room rule for this and every later section: `PIAGAM.md` → Clean-room. Sources are `run-loop/FITUR-PROJECTS.md` and the public demo's visible behavior only.

- [ ] **AIDA-64** `v2` — A workspace can hold projects with name, color, order, overview and member list. [Charter, FITUR] Accept: the model is scoped through `scopedDb`, with an unmocked isolation test.
- [ ] **AIDA-65** `v2` — A project holds tasks with status (`backlog`, `todo`, `in_progress`, `review`, `done`), assignee, due date, priority and labels. [Charter, FITUR] Accept: logic tests cover create, update, reorder and status change, plus unmocked isolation.
- [ ] **AIDA-66** `v2` — A task can have subtasks. [Charter, FITUR] Accept: parent progress is derived from subtasks; a subtask cannot cross project or organization.
- [ ] **AIDA-67** `v2` — A task can carry comments and attachments. [Charter, FITUR] Accept: comments use the sanitized markdown path; attachments use the existing pipeline; task content is treated as untrusted.
- [ ] **AIDA-68** `v2` — Every project and task change writes one activity record, the single source for the project feed and task history. [Charter, FITUR] Accept: a test proves each mutation records actor, verb and old and new values.
- [ ] **AIDA-69** `v2` — A workspace can define teams, add and remove their members, and assign teams to projects. [Charter, FITUR] Accept: an org-scoped `Team` model with unmocked isolation; tests cover membership changes and project assignment.
- [ ] **AIDA-70** `v2` — Projects can be archived and restored, and a user can favorite a project. [Charter, FITUR] Accept: archived projects leave default lists and can be restored; favorites are per user.
- [ ] **AIDA-71** `v2` — A private project is hidden from non-members, who can neither read nor change it. [Charter, FITUR] Accept: unmocked tests as a member, a non-member of the same organization, and a user of another organization cover every read and write path of the project and its tasks, subtasks, comments, attachments and activity; no relation can point to a task in another project or organization. `scopedDb` alone only scopes by organization, so this needs its own server-side check. Search and notifications inherit the rule in Phase 16, ticket links and AI suggestions in Phase 17.
- [ ] **AIDA-100** `v2` — A project has an icon, a description, a status from a fixed set, a due date, and progress derived from its tasks. [FITUR] Accept: progress is computed from tasks, never typed in, and tested, including an empty project; status changes write activity; the status set is decided in the Phase 14 CONTEXT.
- [ ] **AIDA-101** `v2` — Each task has a key made of its project prefix and a number, plus a start date, an estimate, and a rich-text description. [FITUR] Accept: keys stay unique under concurrent creation, tested the way `TicketCounter` is; the description renders through the sanitized markdown path; a start date after the due date is rejected.
- [ ] **AIDA-102** `v2` — A task can repeat daily, weekly or monthly, and completing it creates the next occurrence. [FITUR] Accept: tests cover each rule, month ends and time zones; the next occurrence is created exactly once, even when completion is retried.
- [ ] **AIDA-103** `v2` — A task can be duplicated, moved to another project, favorited, archived and restored, and deleted. [FITUR] Accept: a moved task gets a new key while its old link still resolves; archive keeps history; delete needs confirmation and writes an audit event; private-project rules hold across a move.
- [ ] **AIDA-104** `v2` — A project can be edited, duplicated with or without its tasks, and deleted. [FITUR] Accept: both duplicate options are tested; delete needs confirmation, writes an audit event, and never removes `AuditEvent` rows.
- [ ] **AIDA-105** `v2` — A project can have dated milestones, and a task can belong to one. [FITUR] Accept: org-scoped with an unmocked isolation test; milestones show in the Timeline (AIDA-78) and the workspace overview (AIDA-107).

## Work views

- [ ] **AIDA-72** `v2` — Projects have a list page in grid, list and table form, with search, a status filter and sorting, and a detail page with tabs for the overview, each Phase 15 view and activity, including favorite and archive controls. [FITUR] Accept: E2E covers the three list forms, search, filter and sort, the detail page's overview and progress, and favorite and archive from both pages.
- [ ] **AIDA-73** `v2` — A task opens in a drawer or on a full page. [FITUR] Accept: both render the same data and deep links work.
- [ ] **AIDA-74** `v2` — The List view has collapsible groups, a quick-add composer and multi-select bulk actions. [Charter, FITUR] Accept: E2E covers collapsing a group, quick add and each bulk action offered, and checks the result after reload.
- [ ] **AIDA-75** `v2` — The Board view has a column per status, drag and drop, collapsible columns and a keyboard alternative. [Charter, FITUR] Accept: E2E performs the same move by mouse and by keyboard and collapses a column, and both persist after reload.
- [ ] **AIDA-76** `v2` — The Table view has in-cell editing, a choice of visible columns, and grouping. [Charter, FITUR] Accept: edits and the column choice persist after reload, and invalid values are rejected.
- [ ] **AIDA-77** `v2` — The Calendar view shows a month or a week, can add a task on a chosen day, and lets a task move to another date. [Charter, FITUR] Accept: a move persists after reload; a keyboard alternative exists; time zones are tested.
- [ ] **AIDA-78** `v2` — The Timeline view supports zoom, grouping and moving a schedule. [Charter, FITUR] Accept: zoom, grouping and a schedule move each work and persist after reload; a keyboard alternative exists.
- [ ] **AIDA-79** `v2` — The Files view lists project attachments in grid and list form. [Charter, FITUR] Accept: access follows project privacy.
- [ ] **AIDA-80** `v2` — A user can save a view per project. [Charter, FITUR] Accept: stored per user, using the SEED-005 model when Phase 11 shipped it.
- [ ] **AIDA-106** `v2` — Tasks, Calendar and Timeline also work at workspace level, across every project the user may see. [FITUR] Accept: the workspace Tasks page offers list, board and table with grouping and a column choice; private projects are excluded for non-members, with an unmocked test.

## Workspace

- [ ] **AIDA-81** `v2` — Home summarizes upcoming tasks, projects, activity and assigned tickets. [Charter, FITUR] Accept: E2E on seeded data covers the summary counts, the user's tasks split into upcoming, overdue and done with completion in place, project progress, deadlines grouped by day, recent activity, and the quick actions.
- [ ] **AIDA-82** `v2` — My Tasks shows the user's tasks across projects in a list and in at least one other Phase 15 view. [Charter, FITUR] Accept: E2E covers both views; private projects are honored.
- [ ] **AIDA-83** `v2` — One notification center covers ticket and task events, with categories, an unread filter and a detail panel. [Charter, FITUR, SEED-008] Accept: it extends AIDA-44 rather than adding a second system; E2E covers categories by event type, mark all as read, the unread filter, the detail panel and a project at-risk alert; "Inbox" keeps meaning tickets.
- [ ] **AIDA-84** `v2` — An Activity page shows a timeline filtered by event type and by person. [Charter, FITUR] Accept: it reads the AIDA-68 source and honors project privacy; E2E covers both filters.
- [ ] **AIDA-85** `v2` — Search returns results grouped by task, project, person and ticket. [Charter, FITUR] Accept: Postgres FTS only; org-scoped; private projects excluded for non-members, with an unmocked test.
- [ ] **AIDA-86** `v2` — The command palette, shortcuts and context menus reach the Projects module through the AIDA-49 registry. [FITUR] Accept: one mechanism, no second palette; tests cover command search, each shortcut and each context menu in Projects.
- [ ] **AIDA-87** `v2` — A Members page lists members with search and a role filter, invitations and teams, and can invite several addresses at once with a role and a team. [Charter, FITUR] Accept: it reuses AIDA-42, AIDA-43 and AIDA-69; E2E covers search, the role filter and a multi-address invitation.
- [ ] **AIDA-88** `v2` — First-run onboarding guides workspace, first project, template and invitations, and complements `/setup`. [Charter, FITUR] Accept: `/setup` still works unchanged; E2E covers skipping, finishing, starting from a template and sending an invitation.
- [ ] **AIDA-89** `v2` — A user can set theme, accent, density, sidebar size and motion. [Charter, FITUR] Accept: stored per user through design tokens and applied again after re-login; the accent cannot break the brand color rule, proven by the contrast tests.
- [ ] **AIDA-98** `v2` — A user can set week start, date format, time zone, start page, how a task opens, and which view a project opens on. [Charter, FITUR] Accept: each setting changes what that user sees and survives re-login, each one tested.
- [ ] **AIDA-99** `v2` — A user can change their password. [Charter, FITUR] Accept: the current password is required; the user's other sessions are revoked; tests cover a wrong current password.
- [ ] **AIDA-90** `v2` — Every Projects and Workspace page handles empty, loading, error and narrow-screen states, and the module has a not-found page and an offline notice. [FITUR] Accept: E2E or component checks per page, following the AIDA empty-state pattern.
- [ ] **AIDA-107** `v2` — A workspace overview shows project portfolio status, tasks by status, workload per person and upcoming milestones. [FITUR] Accept: the numbers come from org-scoped SQL aggregates tested against seeded data; private projects are honored.
- [ ] **AIDA-108** `v2` — Favorites and Archive pages list the user's favorite projects and tasks, and the archived tasks and projects with a restore action. [FITUR] Accept: E2E covers favoriting, archiving, restoring and both empty states.
- [ ] **AIDA-109** `v2` — Each team has a page with its projects, open tasks and members, and teams can be created and edited from the UI. [FITUR] Accept: E2E covers create, edit and the team page, on top of the AIDA-69 logic.
- [ ] **AIDA-110** `v2` — A guest role sees only the projects shared with it and no helpdesk data, and admins choose which roles may create projects and invite guests. [FITUR] Accept: unmocked tests prove a guest cannot reach tickets, contacts, the KB, settings or unshared projects through any path; the permission choices are enforced on the server.
- [ ] **AIDA-111** `v2` — A user can switch between the workspaces they belong to and create a new workspace. [FITUR] Accept: every page and query follows the active workspace, with unmocked isolation tests; who may create a workspace is decided in the Phase 16 CONTEXT, and the conservative default is instance admins only; `/setup` keeps creating the first one.
- [ ] **AIDA-112** `v2` — A user can edit their profile name, title and avatar color. [FITUR] Accept: the change shows wherever the user appears; the email is read-only on this page.
- [ ] **AIDA-113** `v2` — A user can list their active sessions and sign out of the others. [FITUR] Accept: a revoked session is refused on its next request, tested.
- [ ] **AIDA-114** `v2` — A user can turn on two-factor authentication with an authenticator app and recovery codes. [FITUR] Accept: once enabled, login needs the second factor; recovery codes are single-use and stored hashed; nothing leaves the server; tests use generated codes; any new package follows the charter's package rule.

## Unification

- [ ] **AIDA-91** `v2` — A ticket can become a task through an `internal` adapter of the AIDA-61 interface, and the two stay linked. [Charter, FITUR] Accept: links are visible from both sides and org-scoped.
- [ ] **AIDA-92** `v2` — Task status changes return as an internal note on the linked ticket. [Charter, FITUR] Accept: never a public reply; tested.
- [ ] **AIDA-93** `v2` — AI can suggest task actions from ticket context, behind a human gate. [Charter, FITUR] Accept: goes through `src/lib/llm/`, off when AI is off, no tool surface, nothing is applied without a human action, ticket and task text are untrusted; injection tests use fakes.
- [ ] **AIDA-94** `v2` — Demo data covers the Projects module. [Charter] Accept: `DEMO_MODE` seeds it idempotently and stored AI output keeps `provider: "demo"`.
- [ ] **AIDA-95** `v2` — Docs and README describe the Projects module honestly. [Charter] Accept: `README.md`, the docs site and `CHANGELOG.md` are updated, with no fabricated metrics.
- [ ] **AIDA-96** `v2` — The whole product passes full regression on one named code commit. [Charter] Accept: every gate in `ROADMAP.md` → Gates runs on that commit with its exit code recorded, plus the compose health check and an empty clean-room grep; any later commit touches only `.planning/`, proven by diff; human items stay open.

## Out of scope for v2.0

| Item | Reason |
|---|---|
| Real security contact, `v1.0.0` tag, GitHub release, repository settings | Owner only, in `LAUNCH.md` |
| Live chat, more channels, UI translation, SSO/SAML, billing | Unchanged from `PROJECT.md` → Out of Scope |
| Reusing AGPL or unlicensed code | Unchanged; the Projects module is clean-room |
| Real LLM, real email and real tracker runs | Tests use fakes; the human checks stay open in `ROADMAP.md` |

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| AIDA-18 | Phase 12.2 | Complete (acceptance verified, `12.2-VERIFICATION.md`; phase visual sign-off and owner items 12.2-o1 to 12.2-o4 pending) |
| AIDA-25 | Phase 8 | Pending |
| AIDA-26 | Phase 8 | Pending |
| AIDA-27 | Phase 8 | Pending |
| AIDA-28 | Phase 8 | Pending |
| AIDA-29 | Phase 8 | Pending |
| AIDA-30 | Phase 8 | Pending |
| AIDA-31 | Phase 8 | Pending |
| AIDA-32 | Phase 8 | Pending |
| AIDA-33 | Phase 9 | Pending |
| AIDA-34 | Phase 9 | Pending |
| AIDA-35 | Phase 9 | Pending |
| AIDA-36 | Phase 9 | Pending |
| AIDA-37 | Phase 9 | Pending |
| AIDA-38 | Phase 9 | Pending |
| AIDA-39 | Phase 9 | Pending |
| AIDA-40 | Phase 9 | Pending |
| AIDA-41 | Phase 9 | Pending |
| AIDA-42 | Phase 10 | Pending |
| AIDA-43 | Phase 10 | Pending |
| AIDA-44 | Phase 10 | Pending |
| AIDA-45 | Phase 10 | Pending |
| AIDA-46 | Phase 10 | Pending |
| AIDA-47 | Phase 11 | Complete (acceptance verified, `11-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-48 | Phase 11 | Complete (acceptance verified, `11-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-49 | Phase 11 | Complete (acceptance verified, `11-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-50 | Phase 11 | Complete (acceptance verified, `11-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-51 | Phase 11 | Complete (acceptance verified; no customer notice built, D-19, owner item O-2 open; phase visual sign-off pending) |
| AIDA-52 | Phase 12 | Complete (acceptance verified, `12-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-53 | Phase 12 | Pending: implemented and verified except the clause "a full `AuditEvent` is written"; the merge audit is in `TicketAuditEvent` (owner item 12-o1) |
| AIDA-54 | Phase 12 | Complete (acceptance verified, `12-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-55 | Phase 12 | Complete (acceptance verified, `12-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-56 | Phase 12.1 | Complete (acceptance verified, `12.1-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-57 | Phase 12.1 | Complete (acceptance verified, `12.1-VERIFICATION.md`; known limitation K47 deferred; phase visual sign-off pending) |
| AIDA-97 | Phase 12.1 | Complete (acceptance verified, `12.1-VERIFICATION.md`; phase visual sign-off pending) |
| AIDA-58 | Phase 13 | Pending |
| AIDA-59 | Phase 13 | Pending |
| AIDA-60 | Phase 13 | Pending |
| AIDA-61 | Phase 13 | Pending |
| AIDA-62 | Phase 13 | Pending |
| AIDA-63 | Phase 13 | Pending |
| AIDA-64 | Phase 14 | Pending |
| AIDA-65 | Phase 14 | Pending |
| AIDA-66 | Phase 14 | Pending |
| AIDA-67 | Phase 14 | Pending |
| AIDA-68 | Phase 14 | Pending |
| AIDA-69 | Phase 14 | Pending |
| AIDA-70 | Phase 14 | Pending |
| AIDA-71 | Phase 14 | Pending |
| AIDA-72 | Phase 15 | Pending |
| AIDA-73 | Phase 15 | Pending |
| AIDA-74 | Phase 15 | Pending |
| AIDA-75 | Phase 15 | Pending |
| AIDA-76 | Phase 15 | Pending |
| AIDA-77 | Phase 15 | Pending |
| AIDA-78 | Phase 15 | Pending |
| AIDA-79 | Phase 15 | Pending |
| AIDA-80 | Phase 15 | Pending |
| AIDA-81 | Phase 16 | Pending |
| AIDA-82 | Phase 16 | Pending |
| AIDA-83 | Phase 16 | Pending |
| AIDA-84 | Phase 16 | Pending |
| AIDA-85 | Phase 16 | Pending |
| AIDA-86 | Phase 16 | Pending |
| AIDA-87 | Phase 16 | Pending |
| AIDA-88 | Phase 16 | Pending |
| AIDA-89 | Phase 16 | Pending |
| AIDA-90 | Phase 16 | Pending |
| AIDA-98 | Phase 16 | Pending |
| AIDA-99 | Phase 16 | Pending |
| AIDA-91 | Phase 17 | Pending |
| AIDA-92 | Phase 17 | Pending |
| AIDA-93 | Phase 17 | Pending |
| AIDA-94 | Phase 17 | Pending |
| AIDA-95 | Phase 17 | Pending |
| AIDA-96 | Phase 17 | Pending |
| AIDA-100 | Phase 14 | Pending |
| AIDA-101 | Phase 14 | Pending |
| AIDA-102 | Phase 14 | Pending |
| AIDA-103 | Phase 14 | Pending |
| AIDA-104 | Phase 14 | Pending |
| AIDA-105 | Phase 14 | Pending |
| AIDA-106 | Phase 15 | Pending |
| AIDA-107 | Phase 16 | Pending |
| AIDA-108 | Phase 16 | Pending |
| AIDA-109 | Phase 16 | Pending |
| AIDA-110 | Phase 16 | Pending |
| AIDA-111 | Phase 16 | Pending |
| AIDA-112 | Phase 16 | Pending |
| AIDA-113 | Phase 16 | Pending |
| AIDA-114 | Phase 16 | Pending |

91 requirements: AIDA-18 and AIDA-25 through AIDA-114. Revised after Codex roadmap critique rounds 1 to 3 (`run-loop/codex/roadmap-v2-jawab.md`, `roadmap-v2-r2-jawab.md`, `roadmap-v2-r3-jawab.md`). Run-queue item 0c walked the public demo and added AIDA-100 through AIDA-114 (`run-loop/FITUR-PROJECTS.md` → Hasil penelusuran demo); new IDs continue at AIDA-115.
