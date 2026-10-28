# Roadmap — AIDA (Open-Source AI-Native Helpdesk)

## Milestones

- ✅ **v1.0.0 Minimum Lovable Helpdesk** — Phases 1–7 (shipped 2026-09-13; archive: [`milestones/v1.0.0-ROADMAP.md`](milestones/v1.0.0-ROADMAP.md))
- 🚧 **v2.0 Helpdesk & Projects** — Phases 8–17 (in progress on branch `v2/run-loop`, opened 2026-11-07; a draft the owner applies, autonomy level 2)

## Phases

<details>
<summary>✅ v1.0.0 Minimum Lovable Helpdesk (Phases 1–7) — SHIPPED 2026-09-13</summary>

- [x] Phase 1: Foundation (8/8 plans) — completed 2026-06-29
- [x] Phase 2: Core Ticketing (12/12 plans) — completed 2026-07-02
- [x] Phase 3: Email Channel (6/6 plans) — completed 2026-07-06
- [x] Phase 4: AI Foundation (7/7 plans) — completed 2026-07-18
- [x] Phase 5: RAG & Drafted Replies (7/7 plans) — completed 2026-07-22
- [x] Phase 6: AIDA Insight (7/7 plans) — completed 2026-07-24
- [x] Phase 7: Launch Readiness (13/13 plans, incl. inserted gap-closure 07-09.1) — completed 2026-09-03

Coverage: 23/23 MVP requirements validated (AIDA-18 stretch → backlog). Closeout 2026-09-13 as override_closeout (23 acknowledged items — `STATE.md` → Deferred Items); git tag left to `LAUNCH.md`. Full phase goals, plan lists and success criteria: `milestones/v1.0.0-ROADMAP.md`. Phase artifacts: `milestones/v1.0.0-phases/`.

</details>

## 🚧 v2.0 Helpdesk & Projects (In Progress)

**Milestone goal:** close the v1 gaps that need no human, then build a Projects module inside AIDA with a real backend. The owner's decision behind this is recorded in `PROJECT.md` → Key Decisions (2026-11-07).
**Granularity:** 10 phases. A phase may split into more plans, but nothing in it may be dropped.
**Sequencing:** phases run in numeric order. `Depends on` lists only the hard parking chain from `run-loop/PIAGAM.md`; softer links are in Cross-phase risks below.
**Coverage:** 91/91 requirements mapped (`REQUIREMENTS.md`).

- [ ] **Phase 8: Security Hardening** — Dependency audit to zero critical and high, non-root containers, CSP, trusted client IP, public-route abuse controls
- [ ] **Phase 8.1: Docker test tooling and runtime proofs** — Split from Phase 8 after plan review cycle 4 (owner decision 2026-11-11): container harness, runtime proofs, full gate, CI egress job; waits for owner (`08-SPLIT.md`)
- [ ] **Phase 9: Operations** — Backup schedule, logo upload, password encoding, single `<h1>`, seed guard, permanent regression tests, repo health
- [ ] **Phase 10: Team** — Invitations and roles, notifications and mentions
- [ ] **Phase 11: Inbox** — Saved views, bulk actions, command palette, keyboard inbox, auto-close
- [ ] **Phase 12: Ticket Lifecycle** — Relations, merge, snooze and the activity feed (split K32)
- [ ] **Phase 12.1: Ticket Lifecycle** — Custom states with SLA pause
- [ ] **Phase 12.2: Ticket Lifecycle** — KB article proposals from resolved tickets
- [ ] **Phase 13: Integrations** — Public API, tokens, signed webhooks, GitHub Issues and Plane adapters
- [ ] **Phase 14: Projects Foundation** — Schema, tenancy and logic for projects, tasks, teams and privacy
- [ ] **Phase 15: Work Views** — Project pages, task detail, List, Board, Table, Calendar, Timeline, Files, saved views
- [ ] **Phase 16: Workspace** — Home, My Tasks, notification center, Activity, search, Members, onboarding, preferences
- [ ] **Phase 17: Unification** — Ticket to task, status back to ticket, gated AI suggestions, demo data, docs, full regression

### Phase 8: Security Hardening

**Depends on:** Nothing (v1.0.0 shipped)
**Requirements:** AIDA-25, AIDA-26, AIDA-27, AIDA-28, AIDA-29, AIDA-30, AIDA-31, AIDA-32
**UI hint**: no
**Goal:** The v1 code is safe to release: no known critical or high production advisory, and every accepted v1 security finding is fixed or justified in writing.
**Success Criteria (what must be TRUE):**

1. `pnpm audit --prod --audit-level=high` exits 0, or the gate is reported red with every residual explained in `docs/SECURITY.md`.
2. `docker compose -p aida up -d --build` serves `https://localhost/api/health`; `app` and `worker` run as non-root; the one-shot `migrate` ran as non-root and exited 0; uploads still work.
3. Every HTML response carries a CSP, and the core pages run with zero CSP violations.
4. A spoofed `X-Forwarded-For` cannot change a rate-limit identity, and the two unthrottled public routes are throttled while the container healthcheck stays green.
5. All four connection tests return categorized errors, and `docs/SECURITY.md` matches the code.
6. Dependabot and a CI audit job exist as files.

**Stays open for a human:** the real security contact, the `v1.0.0` tag, the release, and repository settings in `LAUNCH.md`.
**Plans:** 0/23 plans complete
**Wave 1**

- [x] 08-01-PLAN.md — Upgrade `next` to >=16.4.1, pinned (Wave 1)
- [x] 08-05-PLAN.md — System font stack, telemetry off in CI, audit and egress workflows without new schedules (rule I), Dependabot weekly with limit 3 (Wave 1)
- [x] 08-06-PLAN.md — Categorized connection-test errors, `addTag` gate first, `sla-flag` comment (Wave 1)
- [x] 08-17-PLAN.md — E2E harness: cross-platform worker teardown, honesty-invariants flake (Wave 1)
- [x] 08-19-PLAN.md — Permanent guard keeping the rule-J egress suite (J1) off the integration path; egress recording rule (review C1, R3-2) (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-02-PLAN.md — Upgrade `better-auth` to >=1.7.7 with migration proof (Wave 2)
- [ ] 08-07-PLAN.md — Nonce CSP with `strict-dynamic` and security headers in `src/proxy.ts` (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 08-03-PLAN.md — Better Auth upgrade regression tests (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 08-04-PLAN.md — `shadcn` out of production, remaining bumps, residual advisory table (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 08-08-PLAN.md — CSP zero-violation E2E on the five acceptance pages, 404 and error cases (Wave 5)
- [ ] 08-09-PLAN.md — Non-root `app`, `worker`, `migrate` images; root-owned volume procedure (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 08-10-PLAN.md — Trusted-proxy-aware client-IP helper, Caddy header, Better Auth alignment (Wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [ ] 08-11-PLAN.md — Atomic limiter, limit before parsing and token lookup, attachment throttle (Wave 7)
- [ ] 08-18-PLAN.md — Client-IP deployment contract, CDN contract, `TRUSTED_PROXY_HOPS` plumbing (Wave 7)

**Wave 8** *(blocked on Wave 7 completion)*

- [ ] 08-12-PLAN.md — `/api/health` cache and in-memory throttle in one process-global store (Wave 8)
- [ ] 08-13-PLAN.md — Byte caps on received bytes, three-layer alignment, cleanup on failure (Wave 8)

**Wave 9** *(blocked on Wave 8 completion)*

- [ ] 08-20-PLAN.md — `/api/health/probe` for the container healthcheck, refused by Caddy (review C2) (Wave 9)

**Wave 10** *(blocked on Wave 9 completion)*

- [ ] 08-14-PLAN.md (moved to Phase 8.1, `deferred-8.1/`, waits for owner) — Container harness on per-run `aida-test-` projects over J1 (rule J), four-state reporter, first runtime proofs (Wave 10)

**Wave 11** *(blocked on Wave 10 completion)*

- [ ] 08-21-PLAN.md (moved to Phase 8.1, `deferred-8.1/`, waits for owner) — Production-mode host E2E: CSP, client identity and the health DB bound (reviews C6, C7) (Wave 11)
- [ ] 08-22-PLAN.md (moved to Phase 8.1, `deferred-8.1/`, waits for owner) — Real Caddy: spoofing, probe refusal at an instrumented upstream, health floods (Wave 11)

**Wave 12** *(blocked on Wave 11 completion)*

- [ ] 08-23-PLAN.md (moved to Phase 8.1, `deferred-8.1/`, waits for owner) — Root-owned uploads volume procedure and non-root backup on the real stack (Wave 12)

**Wave 13** *(blocked on Wave 12 completion)*

- [ ] 08-15-PLAN.md (moved to Phase 8.1, `deferred-8.1/`, waits for owner) — `docs/SECURITY.md` reconciliation with an evidence-status table (Wave 13)

**Wave 14** *(blocked on Wave 13 completion)*

- [ ] 08-16-PLAN.md (moved to Phase 8.1, `deferred-8.1/`, waits for owner) — End-of-phase gate on one tested commit, guarded compose gate, evidence matrix (Wave 14)
- [ ] 08-24-PLAN.md — Part A gate: host gates on one tested commit, mechanical Part A evidence matrix, container rows moved to Phase 8.1, candidate v1.0.0 safe point (Wave 10)
- [ ] 08-05b-PLAN.md (Phase 8.1, `deferred-8.1/`, waits for owner; carries R4-2) — CI egress workflow and result classifier

### Phase 9: Operations

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-33, AIDA-34, AIDA-35, AIDA-36, AIDA-37, AIDA-38, AIDA-39, AIDA-40, AIDA-41
**UI hint**: yes
**Goal:** A self-hoster can run AIDA unattended: backups happen on their own, the known boot and seed traps are fixed and pinned by tests, and the planning records tell the truth.
**Success Criteria (what must be TRUE):**

1. A scheduled backup produces one consistent set of database dump and uploads archive, even while attachments change, that restores with matching attachments; a failed part fails the set; old sets are pruned.
2. A logo uploads, shows in the sidebar and on public pages, and falls back to the name.
3. A compose stack with a password containing `/ @ : # ?` connects from every service, and every app page has exactly one `<h1>`.
4. Neither `pnpm db:seed` nor the `DEMO_MODE` boot writes into a database holding non-demo tenant data, a repeated demo boot still works after the heartbeat has run, neither prints a password, and the demo-boot, seed-guard and backup/restore tests live in the repository suites.
5. `01-VERIFICATION.md` exists and is backed by evidence, and `STATE.md` has no stale statement.
6. `scripts/install.sh`, `check-version`, `AGENTS.md`, `CODEOWNERS` and the README widgets exist, or an item needing an owner account is recorded as manual.

**Stays open for a human:** the Phase 5 visual pass and the Phase 6 real-LLM Insight quality check.
**Plans:** 0/11 plans complete
**Wave 1**

- [ ] 09-01-PLAN.md — Make a `POSTGRES_PASSWORD` with URL-reserved characters work for migrate, app and worker (AIDA-35, D-12, D-13) (Wave 1)
- [ ] 09-02-PLAN.md — Close F-09 and F-10 (AIDA-37) and make the guards permanent regression tests (AIDA-38) (Wave 1)
- [ ] 09-03-PLAN.md — Make the planning records true (AIDA-39, AIDA-41) and ship the repo-health files that need no owner account (A (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 09-04-PLAN.md — Build the storage half of the D-02 consistency protocol (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 09-05-PLAN.md — Logo backend (AIDA-34) (Wave 3)
- [ ] 09-06-PLAN.md — The backup core for AIDA-33 with its permanent tests (AIDA-38) (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 09-07-PLAN.md — Logo UI for AIDA-34 per `09-UI-SPEC.md` Surfaces 1-3 (Wave 4)
- [ ] 09-08-PLAN.md — Put the backup core on a schedule inside the single compose stack (AIDA-33, D-01), give admins a read-only sta (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 09-09-PLAN.md — Exactly one `<h1>` per app route state (AIDA-36, D-14), per UI-SPEC Surface 5, pinned by an E2E test over ever (Wave 5)
- [ ] 09-10-PLAN.md — Restore (D-05, D-06 component half of AIDA-33/AIDA-38) and the installer (D-22, AIDA-40), built against the fi (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 09-11-PLAN.md — Write the stack-level proofs (run later, after the owner's container decision), then run the phase gate, the D (Wave 6)

### Phase 10: Team

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-42, AIDA-43, AIDA-44, AIDA-45, AIDA-46
**UI hint**: yes
**Goal:** A workspace can grow past one person, and its members hear about what concerns them.
**Success Criteria (what must be TRUE):**

1. An admin invites a person, who joins with the invited role; expired and mismatched invitations fail.
2. An admin can change roles and deactivate members; an already-open session of a deactivated member is refused on its next request; the last admin cannot be removed, even concurrently.
3. Assignment, customer reply, mention and SLA events produce per-user notifications in the top bar.
4. A mention in an internal note notifies the member and cannot reach the customer.
5. Preferences apply, and the digest sends one batched email through a fake SMTP with no PII in the subject.

**Stays open for a human:** a test with real email.
**Plans:** 0/16 plans complete
**Wave 1**

- [ ] 10-01-PLAN.md — Lay the whole Phase 10 data foundation in one migration so later waves never edit the schema in parallel (Wave 1)
- [ ] 10-02-PLAN.md — Build the one membership-checking helper every data path uses (D-08) and close the Better Auth bypasses (D-02) (Wave 1)
- [ ] 10-15-PLAN.md — Close the Better Auth organization and admin plugin endpoints over HTTP (D-02) and open /invite with no referrer (D-04, D-05) (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 10-03-PLAN.md — Implement the server-side team administration service (AIDA-43): list members, change roles, deactivate (Wave 2)
- [ ] 10-04-PLAN.md — Build the entity-generic notification core (AIDA-44) with per-type preferences and explicit defaults (D-22) (Wave 2)
- [ ] 10-05-PLAN.md — Implement the invitation service (AIDA-42): role ceilings, hashed token, 7-day expiry, revoke, safe accept (Wave 2)
- [ ] 10-16-PLAN.md — Give the public status-token path one named lookup helper and make the inventory's public-token rule a real check (D-08) (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 10-06-PLAN.md — Wire the notification producers (AIDA-44): assignment, every customer-reply path and SLA transitions (Wave 3)
- [ ] 10-07-PLAN.md — Implement mentions on the server (AIDA-45): member-validated ids, sanitized rendering, internal notes only (Wave 3)
- [ ] 10-08-PLAN.md — Build the invitation landing page and its join flows (AIDA-42, D-05) (Wave 3)
- [ ] 10-09-PLAN.md — Deliver the batched email digest (AIDA-46): leased scheduled job, one PII-free email per recipient (Wave 3)
- [ ] 10-10-PLAN.md — Build Settings → Team (AIDA-43, AIDA-42 UI): members, invite dialog, pending invitations, per UI-SPEC (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 10-11-PLAN.md — Ship the in-app surfaces for AIDA-44 and AIDA-46: the top-bar bell and Settings → Notifications (Wave 4)
- [ ] 10-12-PLAN.md — Add the member autocomplete to the internal-note composer (AIDA-45, UI-SPEC Surface 4) (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 10-13-PLAN.md — Prove the phase's acceptance criteria in the real UI (AIDA-42 to AIDA-46) (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 10-14-PLAN.md — Run the phase gate and the §9 design checklist, record evidence per requirement, list what stays open (Wave 6)

### Phase 11: Inbox

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-47, AIDA-48, AIDA-49, AIDA-50, AIDA-51
**UI hint**: yes
**Goal:** An agent can work the inbox fast: saved views, batch actions, and the keyboard.
**Success Criteria (what must be TRUE):**

1. Private and shared views persist, and shared views never cross organizations.
2. A bulk action applies to all selected tickets or none, with one audit entry per ticket.
3. `⌘K` and `Ctrl+K` open the palette, and its commands change with the page.
4. The inbox and ticket page work by keyboard, keystrokes are ignored inside inputs, and `?` lists the keys.
5. Resolved tickets close after the configured quiet period, and a value of 0 turns this off.

**Plans:** 9/9 plans complete
**Wave 1**

- [x] 11-01-PLAN.md — Lay the data and parsing foundation: SavedView and TicketAuditEvent in one migration, the membership helper, the filter schema and the auto-close days parser (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 11-02-PLAN.md — Build the one ticket mutation service, route the single-ticket actions through it, and add the all-or-nothing bulk action with audit (AIDA-48) (Wave 2)
- [x] 11-03-PLAN.md — Build the saved-views service and actions (AIDA-47) and the membership-checked palette ticket search (Wave 2)
- [x] 11-04-PLAN.md — Ship auto-close (AIDA-51): settings, the daily audited job, the race fix in both customer-reply paths, and the SLA card (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 11-05-PLAN.md — Give saved views their interface: sidebar Views, Save view dialog and the saved-view strip (AIDA-47) (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 11-06-PLAN.md — Give bulk actions their interface: row checkboxes, selection and the bulk action bar (AIDA-48) (Wave 4)
- [x] 11-07-PLAN.md — Build the command palette and its registry (AIDA-49) (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 11-08-PLAN.md — Make the inbox and ticket page work by keyboard, with ⌘K/Ctrl+K, the help modal and docs/KEYBOARD.md (AIDA-50) (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 11-09-PLAN.md — Run the keyboard E2E, the phase gate and the §9 design checklist, and record evidence per requirement (Wave 6)

### Phase 12: Ticket Lifecycle — relations, merge, snooze and activity

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-52, AIDA-53, AIDA-54, AIDA-55
**UI hint**: yes
**Goal:** Tickets model duplicates and waiting: links between tickets, safe merges, snooze, and an activity feed.
**Split (run-loop K32, 2026-11-08):** the original Phase 12 is carried out as three phases in order, with no scope removed: Phase 12 (this one), Phase 12.1 (custom states and SLA pause) and Phase 12.2 (KB proposals). The six original success criteria are kept and divided among them.
**Success Criteria (what must be TRUE):**

1. Tickets link in all three relation types, and links show from both sides.
2. A merge moves the thread, closes the source as a duplicate, and leaves a full audit event in the append-only `TicketAuditEvent` (owner decision 12-o1, 2026-11-11), and no status link exposes one contact's messages to another.
3. A snoozed ticket wakes by date or by customer reply, and auto-close skips it.

**Plans:** 10/10 plans complete

- [x] 12-01-PLAN.md — One migration (relations, merge provenance, snooze, audit actions), isolation tests, label and status-link visibility helpers (Wave 1)
- [x] 12-02-PLAN.md — Relations service with one parent and no cycles under a lock, and the ticket picker endpoint (AIDA-52) (Wave 2)
- [x] 12-03-PLAN.md — Merge service: same contact only, all-or-nothing, id-ordered locks, replies refused on a merged source (AIDA-53) (Wave 2)
- [x] 12-04-PLAN.md — Status-link visibility after a merge, follow-up and email redirect without deadlock (AIDA-53) (Wave 3)
- [x] 12-05-PLAN.md — Snooze, wake job, wake on customer reply, auto-close skip, snoozed filter (AIDA-54) (Wave 4)
- [x] 12-06-PLAN.md — Linked tickets row, picker, link and merge dialogs (AIDA-52, AIDA-53) (Wave 4)
- [x] 12-07-PLAN.md — Merged banner, moved marker, public merged notice, snooze control (Wave 5)
- [x] 12-08-PLAN.md — Agent activity feed and the Snoozed toggle (AIDA-55, AIDA-54) (Wave 6)
- [x] 12-09-PLAN.md — README note, phase gate and §9 checklist, evidence per requirement (Wave 7)
- [x] 12-10-PLAN.md — Forced-order race tests: two merges into one target racing a reply, the second-mismatch 409, relation removal against a merge replacement (Codex review C10) (Wave 4)

### Phase 12.1: Ticket Lifecycle — custom states and SLA pause

**Depends on:** Phase 12 (run order; the state migration must cover snooze and merge)
**Requirements:** AIDA-56, AIDA-97, AIDA-57
**UI hint**: yes
**Goal:** A team's own states, with every status reader reasoning about the group and SLA timers that pause correctly.
**Success Criteria (what must be TRUE):**

1. Custom states migrate existing data without loss, admins can manage them, and every reader of status, including the `sla-flag` worker, reasons about the group.
2. Each SLA due time moves by exactly the paused time across repeated pauses, and the real SLA worker raises no flag while a ticket is paused.

**Plans:** 17 plans
**Wave 1**

- [x] 12.1-01-PLAN.md — One hand-edited migration (state model, data move, saved views v2, pause start, organization trigger, enum dropped), default-state create path, lock helper without a state join, shared state helpers and fixtures (Wave 1)
- [x] 12.1-02-PLAN.md — State colour tokens with contrast proven, colour and copy modules, StateChip, StateDot, PublicGroupChip and the paused SLA chip (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 12.1-03-PLAN.md — Migration test on populated data in its own container: no loss, pause start, saved-view conversion and rollback, Insight aggregates equal (AIDA-56, AIDA-57) (Wave 2)
- [x] 12.1-04-PLAN.md — Shared state-transition service (group effects, SLA pause accounting, injected clock) and single and bulk state change on state ids (Wave 2)
- [x] 12.1-05-PLAN.md — Reply reopen, auto-close and email matching on groups and roles; public status loader returns the group only (Wave 2)
- [x] 12.1-10-PLAN.md — Filter grammar version 2, state= URL contract with the legacy redirect, list query and loader, grouped Status filter and missing-status notice (Wave 2)
- [x] 12.1-11-PLAN.md — Picker, palette, merge dialog, actions menu and contact page on state names and colours (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 12.1-06-PLAN.md — sla-flag worker on group OPEN and not paused; pause proofs with the real worker, restart and two PID-bound race orders (AIDA-57) (Wave 3)
- [x] 12.1-08-PLAN.md — Admin state service (create, rename, recolour, reorder, default, delete with same-group replacement) with the D-15 lock protocol and race proofs (AIDA-97) (Wave 3)
- [x] 12.1-09-PLAN.md — Public status page group label and CSAT eligibility by group (Wave 3)
- [x] 12.1-13-PLAN.md — Ticket page: grouped top-bar picker, paused SLA chip, snooze control by group, feed rows with state names and the deleted marker (Wave 3)
- [x] 12.1-14-PLAN.md — Inbox rows, bulk Status picker and saved views with missing state references (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 12.1-07-PLAN.md — Merge on the mergeClose role with the pending pause closed, snooze by group, demo seed on states, Phase 12 suites migrated (Wave 4)
- [x] 12.1-12-PLAN.md — Ticket statuses settings page, dialogs and server actions (AIDA-97) (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 12.1-15-PLAN.md — Old chip deleted, existing E2E specs migrated, whole-repo typecheck and lint green (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 12.1-16-PLAN.md — New E2E for every admin action, picker, paused chip, bulk, public label and missing states; contrast of the new palette in both themes (Wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 12.1-17-PLAN.md — Phase gate, reader-matrix and requirement evidence, §9 checklist, README note, open items (Wave 7)

### Phase 12.2: Ticket Lifecycle — knowledge from resolved work

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-18
**UI hint**: yes
**Goal:** Knowledge grows from resolved work under human review.
**Success Criteria (what must be TRUE):**

1. An admin can review a proposed KB article from resolved tickets, and nothing publishes without that review.

**Plans:** 12 plans
**Wave 1**

- [x] 12.2-01-PLAN.md — One hand-edited migration (KbProposal, KbProposalSource with composite tenancy keys, status fence, audit action and link), frozen contract, fixtures, constraint and D-05 reader-isolation proofs (Wave 1)
- [x] 12.2-02-PLAN.md — Fixed system prompt, fenced and bounded ticket input with truncation flag, validated output and the shared field validator, lengths in code points (Wave 1)
- [x] 12.2-03-PLAN.md — Typed LLM errors with a classifier and the 30 s Ollama timeout (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 12.2-04-PLAN.md — Request path: membership, role, count, AI-off and per-ticket eligibility refusals; post-commit enqueue; PUBLIC-only source input and snapshot markers (Wave 2)
- [x] 12.2-05-PLAN.md — Review service: save, reject, transactional publish with slug retry and post-commit embedding, restart, retry indexing; PID-bound races (Wave 2)
- [x] 12.2-06-PLAN.md — Copy module with total code mappings and the proposal status chip (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 12.2-07-PLAN.md — Generation job: claim lease, D-01/D-08/D-09 rechecks, complete() with one audit row, validated store, typed failures, worker registration, claim races (Wave 3)
- [x] 12.2-08-PLAN.md — Server actions and D-01-first loaders, proposal list with polling, admin-only Proposals link, Start dialog (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 12.2-09-PLAN.md — Review page: editor, sources card, status views, restart and retry, publish and reject dialogs (Wave 4)
- [x] 12.2-10-PLAN.md — Entry points: ticket actions menu item and inbox bulk-bar button, admin-only with reasons (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 12.2-11-PLAN.md — E2E with the LLM stub: generate, review, publish, reject, AI off, provider failure, roles and isolation, absence from RAG and Insight; contrast scan (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 12.2-12-PLAN.md — Phase gate, AIDA-18 and D-01 to D-17 evidence, greps, §9 checklist, README note, open items (Wave 6)

### Phase 13: Integrations

**Depends on:** Phase 10
**Requirements:** AIDA-58, AIDA-59, AIDA-60, AIDA-61, AIDA-62, AIDA-63
**UI hint**: yes
**Goal:** AIDA plugs into other tools through a public API, signed webhooks and an issue-tracker bridge.
**Success Criteria (what must be TRUE):**

1. API tokens are hashed, scoped, expire and are rate-limited, and every `/api/v1/*` operation has an authentication test and a cross-org test.
2. Webhook deliveries are signed, retried, logged and auto-deactivated, and the SSRF guard blocks private targets and rebinding.
3. A ticket escalates to GitHub Issues and to Plane against fake servers.
4. A tracker status change returns as an internal note, and a bad signature or replay is rejected before parsing.
5. `docs/SECURITY.md` and the egress test cover the new destinations.
6. `docker compose -p aida up -d --build` serves `https://localhost/api/health`.

**Stays open for a human:** a test with real credentials.
**Plans:** 0 plans

### Phase 14: Projects Foundation

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-64, AIDA-65, AIDA-66, AIDA-67, AIDA-68, AIDA-69, AIDA-70, AIDA-71, AIDA-100, AIDA-101, AIDA-102, AIDA-103, AIDA-104, AIDA-105
**UI hint**: no
**Goal:** The Projects module has a correct, tenant-safe data and logic layer before any view is built.
**Success Criteria (what must be TRUE):**

1. Projects, tasks, subtasks, comments, attachments, activity and teams are scoped through `scopedDb`, with unmocked isolation tests.
2. Every mutation writes one activity record.
3. A private project can be neither read nor changed by a non-member or another organization through any path, proven by unmocked tests.
4. The logic layer offers every operation the Phase 15 views need (move, reorder, bulk update, date change), each authorized on the server.
5. Archive, restore and favorite work.
6. `git grep -i -n gr8r -- src docs website README.md public prisma tests` is empty.
7. Task keys stay unique under concurrency, a recurring task produces its next occurrence exactly once, and project progress is derived from tasks.

**Plans:** 13 plans
**Wave 1**

- [x] 14-01-PLAN.md — Frozen contract: access matrix as an operation table, lock order, subtask trigger protocol, activity verbs and cascades, key, date and recurrence formats, refusal codes, delete contract, C1 to C18 and K59, K61 to K69 dispositions, review round 1 items, owner defaults (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 14-02-PLAN.md — One hand-edited migration for all 18 org-scoped models with composite keys (K67), CHECKs, subtask and append-only triggers; scopedDb registration and parity test; fixtures; schema proofs (Wave 2)
- [x] 14-03-PLAN.md — Pure helpers: K65 task Markdown renderer, shared upload validator, rank math, recurrence date rules (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 14-04-PLAN.md — Service kit, the one access policy, activity writer and feeds with redaction, project operations; access matrix, isolation and race harness (Wave 3)
- [x] 14-05-PLAN.md — Attachment-file cleanup outbox and scheduled sweep (K66); the worker mounts the uploads volume in both compose files (K68), with the inbound-email defect note (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 14-06-PLAN.md — Tasks, keys and the key namespace, versioned edits, dates, status, one-level subtasks; counter concurrency, trigger races, isolation (Wave 4)
- [x] 14-07-PLAN.md — Comments, attachments (upload, download read, delete), labels and milestones; isolation (Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 14-08-PLAN.md — Project members and teams, last-manager rule, K69 team assignment copies members into private projects; PID-bound revocation races; isolation (Wave 5)
- [x] 14-09-PLAN.md — Recurrence: set and clear, the next occurrence exactly once on completion; month ends, time zones, races; isolation (Wave 5)
- [x] 14-10-PLAN.md — Archive, restore, favorites; confirmed hard delete with tombstones, file cleanup and the append-only delete record; races; isolation (Wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 14-11-PLAN.md — Move with new keys, aliases and label and milestone mapping; duplicate a task and a project with and without tasks; races; isolation (Wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 14-12-PLAN.md — Reorder, atomic bulk update, derived progress; races; isolation (Wave 7)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 14-13-PLAN.md — Operation inventory proof, phase gate with blocked suites, evidence per requirement and criterion, clean-room grep, open items (Wave 8)

### Phase 15: Work Views

**Depends on:** Phase 14
**Requirements:** AIDA-72, AIDA-73, AIDA-74, AIDA-75, AIDA-76, AIDA-77, AIDA-78, AIDA-79, AIDA-80, AIDA-106
**UI hint**: yes
**Goal:** A team can plan and move work through the views it expects, all on real data.
**Success Criteria (what must be TRUE):**

1. Project pages and the task drawer and full page work on real data.
2. List, Board, Table, Calendar, Timeline and Files all read and write through the Phase 14 logic.
3. Every drag has a keyboard alternative, proven by E2E.
4. Saved views persist per user and per project.
5. The clean-room grep is empty, and DESIGN-SYSTEM §9 passes.
6. Workspace-level Tasks, Calendar and Timeline never show a private project to a non-member.

**Plans:** 0 plans

### Phase 16: Workspace

**Depends on:** Phase 10, Phase 14
**Requirements:** AIDA-81, AIDA-82, AIDA-83, AIDA-84, AIDA-85, AIDA-86, AIDA-87, AIDA-88, AIDA-89, AIDA-90, AIDA-98, AIDA-99, AIDA-107, AIDA-108, AIDA-109, AIDA-110, AIDA-111, AIDA-112, AIDA-113, AIDA-114
**UI hint**: yes
**Goal:** Projects and tickets feel like one workspace, with one place for what is mine, what changed, and how I work.
**Success Criteria (what must be TRUE):**

1. Home and My Tasks show the user's real work, including assigned tickets.
2. One notification center covers tickets and tasks, and "Inbox" still means tickets.
3. Search and Activity never expose a private project to a non-member, proven by unmocked tests.
4. Onboarding complements `/setup` without changing it.
5. Preferences persist per user and survive re-login, the accent cannot break the contrast tests, and a password change needs the current password.
6. Every page handles empty, loading, error and narrow-screen states.
7. The clean-room grep is empty, and DESIGN-SYSTEM §9 passes.
8. A guest cannot reach helpdesk data or unshared projects, and switching workspaces never mixes data, proven by unmocked tests.
9. Session revocation and two-factor login work end to end.

**Plans:** 0 plans

### Phase 17: Unification

**Depends on:** Phase 13, Phase 14, Phase 15, Phase 16
**Requirements:** AIDA-91, AIDA-92, AIDA-93, AIDA-94, AIDA-95, AIDA-96
**UI hint**: yes
**Goal:** Tickets and tasks work as one system, and the whole product is documented and proven on one commit.
**Success Criteria (what must be TRUE):**

1. A ticket becomes a linked task through the `internal` adapter.
2. Task status returns as an internal note, never a public reply.
3. AI suggestions pass through a human gate, stay off when AI is off, and survive injection tests with fakes.
4. Demo data covers Projects, and the README and docs describe it honestly.
5. Every gate below runs on one named code commit, including the compose health check, and later commits touch only `.planning/`.
6. The clean-room grep is empty.

**Stays open for a human:** the visual pass and the release decision.
**Plans:** 0 plans

## Gates

**End of every phase**, one process at a time, with the exit code read without a pipe: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:egress`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --prod`.

**End of Phases 8, 13 and 17:** `docker compose -p aida up -d --build`, then `curl -sk https://localhost/api/health`, then `docker compose -p aida down`.

**Phases with a UI:** the checklist in `DESIGN-SYSTEM.md` §9. **Phases 14–17:** the clean-room grep.

How a gate result is recorded:

- **Audit.** `pnpm audit --prod` exits non-zero while any advisory remains, moderate and low included. Record its exit code as it is. The security bar is `pnpm audit --prod --audit-level=high`. A residual high or critical with a written reason is reported as red with that reason, never as passed.
- **Network.** Install, audit and the Prisma engine download need the package registry, the advisory service and the Prisma binary host. If one is unreachable, the gate is recorded as blocked, never assumed.
- **Human checks.** In §9, the token, typography and contrast items, including dark mode, are proven by tests. The look itself stays a human item. A `human_needed` verification never becomes `passed`.
- **Commit.** Each result names the commit it ran on. A later commit that touches only `.planning/` keeps the result valid if `git diff --stat <tested>..HEAD -- . ':!.planning'` is empty.

## Cross-phase risks

These links are softer than the parking chain in `run-loop/PIAGAM.md`, which this table does not change. Before relying on a link, run the check. If the prerequisite is missing, independent work continues, but a requirement whose acceptance includes the missing part stays open: it is never closed, and the phase verification lists it as incomplete until the earlier phase returns and its tests run. A fallback keeps building possible; it never closes a requirement. Every fallback is recorded in `RUN-LOG.md`.

| Link | Check before relying on it | If the prerequisite is missing |
|---|---|---|
| Saved views store status values (Phase 11), then the status enum becomes a table (AIDA-56) | `SavedView` exists in `prisma/schema.prisma` | The saved-view part of AIDA-56 stays open. When Phase 11 returns, its filters are built on states and that test runs |
| Auto-close ships before snooze and custom states (AIDA-51 vs AIDA-54, AIDA-56) | the auto-close job is registered in `src/lib/worker/` | The auto-close parts of AIDA-54 and AIDA-56 stay open. When Phase 11 returns, auto-close must skip snoozed tickets and use state groups, with those tests |
| AIDA-86 reuses the Phase 11 palette registry, and AIDA-80 prefers its saved-view model | AIDA-49 and AIDA-47 are closed | AIDA-86 stays open. AIDA-80 builds a per-project view store, which its acceptance allows, and records it for merging later |
| Phase 16 uses Phase 15 for task links, other views (AIDA-82) and how a task opens (AIDA-98) | AIDA-73 and one more Phase 15 view are closed | AIDA-82 and AIDA-98 stay open; the rest of Phase 16 proceeds |
| Invitations (Phase 10) build on Better Auth after the Phase 8 upgrade | `better-auth` in `package.json` matches the version Phase 8 recorded | Build on the current version, and record that a later upgrade must rerun the invitation tests |
| Notifications start with ticket events (Phase 10), then gain task events (AIDA-83) | the `Notification` model is entity-generic | Covered by the chain: Phase 16 needs Phase 10 |
| The tracker adapter is built for HTTP providers (Phase 13), then gains `internal` (AIDA-91) | the interface does not assume a network call | Covered by the chain: Phase 17 needs Phase 13 |
| Every new data path must honor deactivation (AIDA-43) and private projects (AIDA-71) | new access goes through the membership-checking helper | A new path without the check is a defect, not a fallback |
| A nonce-based CSP forces dynamic rendering, and a later inline script breaks it (AIDA-28) | the CSP E2E test is in the suite | If Phase 8 parks, later phases still add no inline script |
| Throttling `/api/health` can trip the container healthcheck, which calls it from loopback without `X-Forwarded-For` | AIDA-29 and AIDA-30 are designed together | Not applicable: same phase |

## Backlog

- Longer-horizon (`PROJECT.md` → Out of Scope until a milestone pulls them in): live chat widget, more channels (WhatsApp/social/voice), i18n UI, SSO/SAML + advanced RBAC, hosted offering.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---|---|---|
| 8. Security Hardening | v2.0 | 0/23 | Parked (Codex plan review cycle 3 left HIGH findings; owner decision) | - |
| 9. Operations | v2.0 | 0/11 | Parked (Codex plan review cycle 3 left a HIGH finding; owner decision) | - |
| 10. Team | v2.0 | 0/16 | Parked (Codex plan review cycle 3 left HIGH findings; owner decision) | - |
| 11. Inbox | v2.0 | 9/9 | Verified: human_needed (visual, dark mode, 360px and screen-reader checks open) | - |
| 12. Ticket Lifecycle (relations, merge, snooze, activity) | v2.0 | 10/10 | Verified: human_needed (visual, dark mode, layout widths and screen-reader checks open; AIDA-53 closed by owner decision 12-o1 on 2026-11-11) | - |
| 12.1. Ticket Lifecycle (custom states, SLA pause) | v2.0 | 17/17 | Verified: human_needed (visual, dark mode, contrast by eye, screen reader and UAT open; K47 deferred) | - |
| 12.2. Ticket Lifecycle (KB proposals) | v2.0 | 12/12 | Verified: human_needed (visual, dark mode, screen reader, UI-SPEC amendments A1 to A8 and UAT open; owner items 12.2-o1 to 12.2-o4) | - |
| 13. Integrations | v2.0 | 0/0 | Parked (depends on parked Phase 10) | - |
| 14. Projects Foundation | v2.0 | 13/13 | Verified: human_needed (owner items 14-o1, 14-o2, 14-o3; O-1 suites blocked) | - |
| 15. Work Views | v2.0 | 0/0 | Not started | - |
| 16. Workspace | v2.0 | 0/0 | Parked (depends on parked Phase 10) | - |
| 17. Unification | v2.0 | 0/0 | Parked (depends on parked Phases 10, 13 and 16) | - |
