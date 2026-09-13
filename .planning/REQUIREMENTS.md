# REQUIREMENTS — AIDA v2.0 (Helpdesk & Projects)

**Defined:** 2026-11-07, from the owner's decision recorded in `PROJECT.md` and the run charter `run-loop/PIAGAM.md`.
**Core value:** unchanged from `PROJECT.md`. v2.0 closes the v1 gaps that need no human, then adds a Projects module inside AIDA.

Each requirement is a single testable statement. The bracket names its source: `F-nn` is a finding in `milestones/v1.0.0-phases/07-launch-readiness/07-SECURITY-PASS.md`, `SEED-nnn` is a file in `seeds/`, `FITUR` is a row of `run-loop/FITUR-PROJECTS.md`, and `Charter` is the phase table in `run-loop/PIAGAM.md`. `Accept` is the check that closes it. A requirement closes only on that evidence.

IDs continue at AIDA-25. AIDA-18 keeps its v1 ID.

## Security hardening

- [ ] **AIDA-25** `v2` — Production dependencies carry no known critical or high advisory. [Charter, F-05] Accept: `pnpm audit --prod` reports 0 critical and 0 high; any residual is listed in `docs/SECURITY.md` with its advisory ID, why it cannot be fixed, and why it is not reachable.
- [ ] **AIDA-26** `v2` — Dependency updates and audits are automated in the repository. [Charter] Accept: `.github/dependabot.yml` exists and a CI job runs `pnpm audit --prod --audit-level=high`. Files only; this run triggers no workflow.
- [ ] **AIDA-27** `v2` — The `app`, `worker` and `migrate` containers run as a non-root user, and uploads keep working. [Charter, F-06] Accept: `id -u` is non-zero in each container; an attachment upload succeeds on a fresh volume; the upgrade path for an existing root-owned `uploads_data` volume is handled or documented in `docs/OPERATIONS.md`.
- [ ] **AIDA-28** `v2` — Every HTML response carries a Content-Security-Policy that blocks inline script without a nonce and limits `connect-src` to the same origin. [Charter, F-15] Accept: an E2E test asserts the header and zero CSP violations on login, inbox, ticket, public request and public status pages.
- [ ] **AIDA-29** `v2` — The client IP used for rate limiting comes from one trusted-proxy-aware helper, so a client cannot change its rate-limit identity by sending `X-Forwarded-For`. [Charter, F-07] Accept: unit tests cover the shipped Caddy topology and a spoofed header; all public routes use the helper; the deployment constraint is documented in `docs/OPERATIONS.md`.
- [ ] **AIDA-30** `v2` — Public routes are protected against abuse. [Charter, F-12] Accept: `/api/health` and `/api/public/status/[token]/attachments/[id]` are throttled without breaking the container healthcheck; `follow-up` enforces a combined request-size cap; both status POST routes check the rate limit before the token lookup.
- [ ] **AIDA-31** `v2` — Connection tests return categorized errors, not raw failure text. [Charter, F-08] Accept: all four call sites (`settings/actions.ts` for LLM and embedding, `settings/email/actions.ts` for SMTP and IMAP) return a fixed category. The v1 pass named only two of these.
- [ ] **AIDA-32** `v2` — The remaining open v1 security findings are closed or justified. [F-11, F-13, F-14] Accept: `NEXT_TELEMETRY_DISABLED=1` is set in the image build and runtime; `next build` no longer fetches Google Fonts, or the owner-facing reason it still does is written down; `addTag` gates before validating; `sla-flag` documents why its raw SQL has no org filter; `docs/SECURITY.md` matches the code.

## Operations

- [ ] **AIDA-33** `v2` — Backups run on a schedule inside the single compose stack, with retention, and can be turned off. [Charter] Accept: a test shows a scheduled run produces a restorable dump and prunes old ones; no Redis and no managed service; `docs/OPERATIONS.md` covers it.
- [ ] **AIDA-34** `v2` — An admin can upload a workspace logo shown in the sidebar and on public pages, with the name-only fallback intact. [Charter] Accept: bytes are sniffed, SVG is rejected, the public serving route is listed in `src/proxy.ts` and throttled, and an E2E test covers upload, replace and fallback.
- [ ] **AIDA-35** `v2` — A `POSTGRES_PASSWORD` containing URL-reserved characters works. [Charter] Accept: a test boots or parses the connection string with a password containing `/ @ : # ?`.
- [ ] **AIDA-36** `v2` — Every app page has exactly one `<h1>`. [Charter] Accept: an E2E test asserts the count on every app route.
- [ ] **AIDA-37** `v2` — `pnpm db:seed` against a populated workspace changes nothing and prints no password. [Charter, F-09, F-10] Accept: the guard runs before `ensureDemoIdentities()`; `prisma/seed.ts` and `scripts/capture-demo-assets.ts` no longer print the password.
- [ ] **AIDA-38** `v2` — Demo-boot idempotency, the seed guard and the backup/restore round trip are permanent regression tests. [Charter] Accept: they run from the repository test suites, not from one-off evidence in `07-VERIFICATION.md`.
- [ ] **AIDA-39** `v2` — Phase 1 has a `01-VERIFICATION.md` built from evidence. [Charter] Accept: the file sits in `milestones/v1.0.0-phases/01-foundation/`, cites commands run at a named commit, and leaves human-only checks open rather than marking them passed.
- [ ] **AIDA-40** `v2` — The repo-health items of SEED-010 ship. [Charter, SEED-010] Accept: `scripts/install.sh` is tested against a local stand-in for a release and makes no call beyond the documented download; `check-version` workflow, `AGENTS.md`, `CODEOWNERS` and README widgets exist, except any item that needs an owner account, which is recorded as a manual item.
- [ ] **AIDA-41** `v2` — `STATE.md` contains no stale statement. [Charter] Accept: every open todo and caveat is re-checked against the repository and either corrected or removed.

## Team and collaboration

- [ ] **AIDA-42** `v2` — An admin can invite a person by email and role, and that person can join the workspace. [Charter, SEED-007, F-16] Accept: tokens are single-use and expire; the signed-in email must match; an inviter cannot grant a role above their own; when SMTP is off a copyable link is offered; E2E covers accept, expiry and org isolation. This also delivers the invite half of v1's AIDA-10, which was recorded complete although no invite flow exists.
- [ ] **AIDA-43** `v2` — An admin can list members, change a role and deactivate a member from Settings → Team. [Charter, SEED-007] Accept: authorization is enforced server-side; the last admin cannot be removed; a deactivated member loses access; each change writes an audit event. The optional third role is decided in the Phase 10 CONTEXT.
- [ ] **AIDA-44** `v2` — Members get in-app notifications for assignment, customer reply, mention, and SLA at-risk or breach. [Charter, SEED-008] Accept: a top-bar bell shows the unread count; read and archive persist; notifications are scoped to organization and user, with an unmocked isolation test.
- [ ] **AIDA-45** `v2` — Internal notes support `@mentions` of workspace members. [Charter, SEED-008] Accept: autocomplete offers members only; the mention renders through the sanitized markdown path; the mentioned member is notified; a mention inside a public reply cannot leak to the customer.
- [ ] **AIDA-46** `v2` — Members control notifications per event type and can receive a batched email digest. [Charter, SEED-008] Accept: a pg-boss job sends one digest per batch through a fake SMTP in tests; subjects carry no customer PII and no `AuditEvent.input`.

## Inbox productivity

- [ ] **AIDA-47** `v2` — An agent can save the current inbox filters as a private or shared view. [Charter, SEED-005] Accept: filters are validated against the existing filter schema; shared views are org-scoped with an unmocked isolation test; views appear in the sidebar using `sidebar-*` tokens.
- [ ] **AIDA-48** `v2` — An agent can select many tickets and assign, change status, change priority, or add and remove a tag in one action. [Charter, SEED-005] Accept: one transaction, one audit entry per ticket, and a test proves a failure rolls back the batch.
- [ ] **AIDA-49** `v2` — A command palette opens with `⌘K` and `Ctrl+K`, with context-aware commands for navigation, ticket search, ticket creation and switching views. [Charter, SEED-006] Accept: E2E covers each command group; the registry can accept commands from other modules.
- [ ] **AIDA-50** `v2` — The inbox and ticket page can be driven by keyboard. [Charter, SEED-006] Accept: shortcuts, chords with a timeout, and a `?` help modal work; keystrokes are ignored inside inputs and editors; a docs page lists the keys.
- [ ] **AIDA-51** `v2` — Resolved tickets close automatically after a configurable quiet period. [Charter, SEED-009] Accept: an org setting with 0 meaning off; a pg-boss cron job closes qualifying tickets with an audit event; any customer notice is a fixed template, off by default, with no AI text.

## Ticket lifecycle

- [ ] **AIDA-52** `v2` — Tickets can be linked as `duplicate_of`, `related_to` or `child_of`. [Charter, SEED-003] Accept: links are unique per pair, org-scoped, and shown from both sides.
- [ ] **AIDA-53** `v2` — An agent can merge one ticket into another. [Charter, SEED-003] Accept: messages and attachments move; the source closes as a duplicate; the old status link resolves to the surviving ticket; confirmation is required; a full `AuditEvent` is written; no hard delete.
- [ ] **AIDA-54** `v2` — A ticket can be snoozed until a date or the next customer reply. [Charter, SEED-003] Accept: a pg-boss job and the inbound reply paths both wake it; the inbox has a snoozed filter; auto-close skips snoozed tickets.
- [ ] **AIDA-55** `v2` — A ticket shows a unified activity feed of merges, snoozes, relations, state changes and assignments. [SEED-003, plane-inspiration §4] Accept: the feed renders in order and is org-scoped.
- [ ] **AIDA-56** `v2` — Admins can define custom ticket states grouped into `open`, `pending`, `resolved` and `closed`. [Charter, SEED-004] Accept: existing tickets migrate with no data loss; a migration test runs against populated data; filters, chips, Insight SQL, the public status page, stored saved-view filters, auto-close and demo fixtures all reason about the group.
- [ ] **AIDA-57** `v2` — SLA clocks pause while a ticket sits in a `pending`-group state. [Charter, SEED-004] Accept: tests cover pause, resume and repeated pauses for first-response and resolution timers.
- [ ] **AIDA-18** `v2` — AIDA proposes a new KB article drafted from one or more resolved tickets, for admin review and approval. [Charter, v1 backlog] Accept: generation goes through `src/lib/llm/`, is disabled when AI is off, redacts secrets, treats ticket text as untrusted, and nothing publishes without an admin action.

## Integrations

- [ ] **AIDA-58** `v2` — Admins can create API tokens that are hashed at rest, with expiry, last-used tracking and a per-token rate limit. [Charter, SEED-002] Accept: the secret is shown once; a revoked or expired token gets 401; tokens are org-scoped with an unmocked isolation test.
- [ ] **AIDA-59** `v2` — A versioned REST API at `/api/v1/*` authenticates with those tokens. [Charter, SEED-002] Accept: an OpenAPI document is published in the docs; responses never include encrypted settings or `AuditEvent.input`.
- [ ] **AIDA-60** `v2` — Admins can register outbound webhooks signed with HMAC-SHA256. [Charter, SEED-002] Accept: delivery retries with backoff through pg-boss, keeps a delivery log, and auto-deactivates after repeated failures; the SSRF guard blocks private ranges, localhost, redirects and DNS rebinding; a test verifies the signature.
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
- [ ] **AIDA-69** `v2` — A workspace can define teams of members and assign them to projects. [Charter, FITUR] Accept: an org-scoped `Team` model with unmocked isolation.
- [ ] **AIDA-70** `v2` — Projects can be archived and restored, and a user can favorite a project. [Charter, FITUR] Accept: archived projects leave default lists and can be restored; favorites are per user.
- [ ] **AIDA-71** `v2` — A private project is invisible to non-members. [Charter, FITUR] Accept: unmocked tests prove a non-member cannot reach it, or its tasks, comments, attachments and activity, through any read path. Search and notifications inherit this rule in Phase 16.

## Work views

- [ ] **AIDA-72** `v2` — Projects have a list page in grid and list form and a detail page with overview and progress, including favorite and archive controls. [FITUR] Accept: E2E covers both forms.
- [ ] **AIDA-73** `v2` — A task opens in a drawer or on a full page. [FITUR] Accept: both render the same data and deep links work.
- [ ] **AIDA-74** `v2` — The List view has collapsible groups, a quick-add composer and multi-select bulk actions. [Charter, FITUR] Accept: E2E covers each.
- [ ] **AIDA-75** `v2` — The Board view has a column per status, drag and drop, collapsible columns and a keyboard alternative. [Charter, FITUR] Accept: E2E performs the same move by mouse and by keyboard.
- [ ] **AIDA-76** `v2` — The Table view has columns with in-cell editing. [Charter, FITUR] Accept: edits persist and invalid values are rejected.
- [ ] **AIDA-77** `v2` — The Calendar view shows a month and lets a task move to another date. [Charter, FITUR] Accept: a keyboard alternative exists and time zones are tested.
- [ ] **AIDA-78** `v2` — The Timeline view supports zoom, grouping and moving a schedule. [Charter, FITUR] Accept: a keyboard alternative exists.
- [ ] **AIDA-79** `v2` — The Files view lists project attachments in grid and list form. [Charter, FITUR] Accept: access follows project privacy.
- [ ] **AIDA-80** `v2` — A user can save a view per project. [Charter, FITUR] Accept: stored per user, using the SEED-005 model when Phase 11 shipped it.

## Workspace

- [ ] **AIDA-81** `v2` — Home summarizes upcoming tasks, projects, activity and assigned tickets. [Charter, FITUR] Accept: E2E on seeded data.
- [ ] **AIDA-82** `v2` — My Tasks shows the user's tasks across projects. [Charter, FITUR] Accept: private projects are honored.
- [ ] **AIDA-83** `v2` — One notification center covers ticket and task events, with categories, an unread filter and a detail panel. [Charter, FITUR, SEED-008] Accept: it extends AIDA-44 rather than adding a second system; "Inbox" keeps meaning tickets.
- [ ] **AIDA-84** `v2` — An Activity page shows a filtered timeline. [Charter, FITUR] Accept: it reads the AIDA-68 source and honors project privacy.
- [ ] **AIDA-85** `v2` — Search returns results grouped by task, project, person and ticket. [Charter, FITUR] Accept: Postgres FTS only; org-scoped; private projects excluded for non-members, with an unmocked test.
- [ ] **AIDA-86** `v2` — The command palette, shortcuts and context menus reach the Projects module through the AIDA-49 registry. [FITUR] Accept: one mechanism, no second palette.
- [ ] **AIDA-87** `v2` — A Members page lists members, roles, invitations and teams. [Charter, FITUR] Accept: it reuses AIDA-42, AIDA-43 and AIDA-69.
- [ ] **AIDA-88** `v2` — First-run onboarding guides workspace, first project, template and invitations, and complements `/setup`. [Charter, FITUR] Accept: `/setup` still works unchanged; E2E covers skipping and finishing.
- [ ] **AIDA-89** `v2` — A user can set theme, accent, density, sidebar size, week start, date format, time zone, motion, start page, task-open mode, and change their password. [Charter, FITUR] Accept: stored per user through design tokens; the accent cannot break the brand color rule, proven by the contrast tests.
- [ ] **AIDA-90** `v2` — Every Projects and Workspace page handles empty, loading, error and narrow-screen states. [FITUR] Accept: E2E or component checks per page, following the AIDA empty-state pattern.

## Unification

- [ ] **AIDA-91** `v2` — A ticket can become a task through an `internal` adapter of the AIDA-61 interface, and the two stay linked. [Charter, FITUR] Accept: links are visible from both sides and org-scoped.
- [ ] **AIDA-92** `v2` — Task status changes return as an internal note on the linked ticket. [Charter, FITUR] Accept: never a public reply; tested.
- [ ] **AIDA-93** `v2` — AI can suggest task actions from ticket context, behind a human gate. [Charter, FITUR] Accept: goes through `src/lib/llm/`, off when AI is off, no tool surface, nothing is applied without a human action, ticket and task text are untrusted; injection tests use fakes.
- [ ] **AIDA-94** `v2` — Demo data covers the Projects module. [Charter] Accept: `DEMO_MODE` seeds it idempotently and stored AI output keeps `provider: "demo"`.
- [ ] **AIDA-95** `v2` — Docs and README describe the Projects module honestly. [Charter] Accept: `README.md`, the docs site and `CHANGELOG.md` are updated, with no fabricated metrics.
- [ ] **AIDA-96** `v2` — The whole product passes full regression on the final commit. [Charter] Accept: every gate in `ROADMAP.md` → Gates passes, plus the compose health check and an empty clean-room grep.

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
| AIDA-18 | Phase 12 | Pending |
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
| AIDA-47 | Phase 11 | Pending |
| AIDA-48 | Phase 11 | Pending |
| AIDA-49 | Phase 11 | Pending |
| AIDA-50 | Phase 11 | Pending |
| AIDA-51 | Phase 11 | Pending |
| AIDA-52 | Phase 12 | Pending |
| AIDA-53 | Phase 12 | Pending |
| AIDA-54 | Phase 12 | Pending |
| AIDA-55 | Phase 12 | Pending |
| AIDA-56 | Phase 12 | Pending |
| AIDA-57 | Phase 12 | Pending |
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
| AIDA-91 | Phase 17 | Pending |
| AIDA-92 | Phase 17 | Pending |
| AIDA-93 | Phase 17 | Pending |
| AIDA-94 | Phase 17 | Pending |
| AIDA-95 | Phase 17 | Pending |
| AIDA-96 | Phase 17 | Pending |

73 requirements: AIDA-18 and AIDA-25 through AIDA-96. Item 0c of the run queue may add rows after walking the public demo; new IDs continue at AIDA-97.
