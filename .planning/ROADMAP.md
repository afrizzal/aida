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
**Coverage:** 73/73 requirements mapped (`REQUIREMENTS.md`).

- [ ] **Phase 8: Security Hardening** — Dependency audit to zero critical and high, non-root containers, CSP, trusted client IP, public-route abuse controls
- [ ] **Phase 9: Operations** — Backup schedule, logo upload, password encoding, single `<h1>`, seed guard, permanent regression tests, repo health
- [ ] **Phase 10: Team** — Invitations and roles, notifications and mentions
- [ ] **Phase 11: Inbox** — Saved views, bulk actions, command palette, keyboard inbox, auto-close
- [ ] **Phase 12: Ticket Lifecycle** — Relations, merge, snooze, custom states with SLA pause, KB article proposals
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

1. `pnpm audit --prod` reports 0 critical and 0 high, or each residual has a written reason in `docs/SECURITY.md`.
2. `docker compose -p aida up -d --build` serves `https://localhost/api/health` with `app`, `worker` and `migrate` running as non-root, and uploads still work.
3. Every HTML response carries a CSP, and the core pages run with zero CSP violations.
4. A spoofed `X-Forwarded-For` cannot change a rate-limit identity, and the two unthrottled public routes are throttled while the container healthcheck stays green.
5. All four connection tests return categorized errors, and `docs/SECURITY.md` matches the code.
6. Dependabot and a CI audit job exist as files.

**Stays open for a human:** the real security contact, the `v1.0.0` tag, the release, and repository settings in `LAUNCH.md`.
**Plans:** 0 plans

### Phase 9: Operations

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-33, AIDA-34, AIDA-35, AIDA-36, AIDA-37, AIDA-38, AIDA-39, AIDA-40, AIDA-41
**UI hint**: yes
**Goal:** A self-hoster can run AIDA unattended: backups happen on their own, the known boot and seed traps are fixed and pinned by tests, and the planning records tell the truth.
**Success Criteria (what must be TRUE):**

1. A scheduled backup produces a dump that restores, and old dumps are pruned.
2. A logo uploads, shows in the sidebar and on public pages, and falls back to the name.
3. A password containing `/ @ : # ?` works, and every app page has exactly one `<h1>`.
4. `pnpm db:seed` on a populated workspace changes nothing and prints no password, and the demo-boot, seed-guard and backup/restore tests live in the repository suites.
5. `01-VERIFICATION.md` exists and is backed by evidence, and `STATE.md` has no stale statement.
6. `scripts/install.sh`, `check-version`, `AGENTS.md`, `CODEOWNERS` and the README widgets exist, or an item needing an owner account is recorded as manual.

**Stays open for a human:** the Phase 5 visual pass and the Phase 6 real-LLM Insight quality check.
**Plans:** 0 plans

### Phase 10: Team

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-42, AIDA-43, AIDA-44, AIDA-45, AIDA-46
**UI hint**: yes
**Goal:** A workspace can grow past one person, and its members hear about what concerns them.
**Success Criteria (what must be TRUE):**

1. An admin invites a person, who joins with the invited role; expired and mismatched invitations fail.
2. An admin can change roles and deactivate members, and cannot remove the last admin.
3. Assignment, customer reply, mention and SLA events produce per-user notifications in the top bar.
4. A mention in an internal note notifies the member and cannot reach the customer.
5. Preferences apply, and the digest sends one batched email through a fake SMTP with no PII in the subject.

**Stays open for a human:** a test with real email.
**Plans:** 0 plans

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

**Plans:** 0 plans

### Phase 12: Ticket Lifecycle

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-18, AIDA-52, AIDA-53, AIDA-54, AIDA-55, AIDA-56, AIDA-57
**UI hint**: yes
**Goal:** Tickets model real support work: duplicates, waiting, a team's own states, and knowledge that grows from resolved work.
**Success Criteria (what must be TRUE):**

1. Tickets link in all three relation types, and links show from both sides.
2. A merge moves the thread, closes the source as a duplicate, keeps the old status link working, and leaves a full audit event.
3. A snoozed ticket wakes by date or by customer reply, and auto-close skips it.
4. Custom states migrate existing data without loss, and every reader of status reasons about the group.
5. SLA clocks pause in `pending`-group states, including repeated pauses.
6. An admin can review a proposed KB article from resolved tickets, and nothing publishes without that review.

**Plans:** 0 plans

### Phase 13: Integrations

**Depends on:** Phase 10
**Requirements:** AIDA-58, AIDA-59, AIDA-60, AIDA-61, AIDA-62, AIDA-63
**UI hint**: yes
**Goal:** AIDA plugs into other tools through a public API, signed webhooks and an issue-tracker bridge.
**Success Criteria (what must be TRUE):**

1. API tokens are hashed, expire, and are rate-limited, and `/api/v1/*` never crosses organizations.
2. Webhook deliveries are signed, retried, logged and auto-deactivated, and the SSRF guard blocks private targets and rebinding.
3. A ticket escalates to GitHub Issues and to Plane against fake servers.
4. A tracker status change returns as an internal note, and a bad signature or replay is rejected before parsing.
5. `docs/SECURITY.md` and the egress test cover the new destinations.
6. `docker compose -p aida up -d --build` serves `https://localhost/api/health`.

**Stays open for a human:** a test with real credentials.
**Plans:** 0 plans

### Phase 14: Projects Foundation

**Depends on:** Nothing beyond run order
**Requirements:** AIDA-64, AIDA-65, AIDA-66, AIDA-67, AIDA-68, AIDA-69, AIDA-70, AIDA-71
**UI hint**: no
**Goal:** The Projects module has a correct, tenant-safe data and logic layer before any view is built.
**Success Criteria (what must be TRUE):**

1. Projects, tasks, subtasks, comments, attachments, activity and teams are scoped through `scopedDb`, with unmocked isolation tests.
2. Every mutation writes one activity record.
3. A private project cannot be reached by a non-member through any read path, proven by unmocked tests.
4. Archive, restore and favorite work.
5. `git grep -i -n gr8r -- src docs website README.md public prisma tests` is empty.

**Plans:** 0 plans

### Phase 15: Work Views

**Depends on:** Phase 14
**Requirements:** AIDA-72, AIDA-73, AIDA-74, AIDA-75, AIDA-76, AIDA-77, AIDA-78, AIDA-79, AIDA-80
**UI hint**: yes
**Goal:** A team can plan and move work through the views it expects, all on real data.
**Success Criteria (what must be TRUE):**

1. Project pages and the task drawer and full page work on real data.
2. List, Board, Table, Calendar, Timeline and Files all read and write through the Phase 14 logic.
3. Every drag has a keyboard alternative, proven by E2E.
4. Saved views persist per user and per project.
5. The clean-room grep is empty, and DESIGN-SYSTEM §9 passes.

**Plans:** 0 plans

### Phase 16: Workspace

**Depends on:** Phase 10, Phase 14
**Requirements:** AIDA-81, AIDA-82, AIDA-83, AIDA-84, AIDA-85, AIDA-86, AIDA-87, AIDA-88, AIDA-89, AIDA-90
**UI hint**: yes
**Goal:** Projects and tickets feel like one workspace, with one place for what is mine, what changed, and how I work.
**Success Criteria (what must be TRUE):**

1. Home and My Tasks show the user's real work, including assigned tickets.
2. One notification center covers tickets and tasks, and "Inbox" still means tickets.
3. Search and Activity never expose a private project to a non-member, proven by unmocked tests.
4. Onboarding complements `/setup` without changing it.
5. Preferences persist per user, and the accent cannot break the contrast tests.
6. Every page handles empty, loading, error and narrow-screen states.
7. The clean-room grep is empty, and DESIGN-SYSTEM §9 passes.

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
5. Every gate below passes on the final commit, including the compose health check.
6. The clean-room grep is empty.

**Stays open for a human:** the visual pass and the release decision.
**Plans:** 0 plans

## Gates

**End of every phase**, one process at a time, with the exit code read without a pipe: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:egress`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --prod`.

**End of Phases 8, 13 and 17:** `docker compose -p aida up -d --build`, then `curl -sk https://localhost/api/health`, then `docker compose -p aida down`.

**Phases with a UI:** the checklist in `DESIGN-SYSTEM.md` §9. **Phases 14–17:** the clean-room grep.

## Cross-phase risks

These links are softer than the parking chain, so a later phase must check them instead of assuming them.

| Risk | Where it bites | Rule |
|---|---|---|
| Saved views store status values (Phase 11), then the status enum becomes a table (Phase 12) | AIDA-56 | Migrate stored filters in the same plan as the enum |
| Auto-close ships before snooze and custom states exist | AIDA-54, AIDA-56 | Phase 12 must update the auto-close query |
| Notifications start with ticket events only (Phase 10), then gain task events (Phase 16) | AIDA-44, AIDA-83 | Keep the model entity-generic from the start |
| The tracker adapter is built for HTTP providers (Phase 13), then gains `internal` (Phase 17) | AIDA-61, AIDA-91 | The interface must not assume a network call |
| AIDA-86 needs the Phase 11 palette, and AIDA-80 prefers its saved-view model, but the chain does not make Phase 11 a phase dependency | AIDA-80, AIDA-86 | If Phase 11 parks, AIDA-86 parks alone; AIDA-80 records its fallback |
| A Better Auth upgrade in Phase 8 may change its schema or API | AIDA-25, AIDA-42 | Check migrations during the bump, and build invitations on the upgraded version |
| A nonce-based CSP forces dynamic rendering, and any later inline script breaks it | AIDA-28 | The CSP E2E test stays in the suite for every later UI phase |
| Throttling `/api/health` can trip the container healthcheck, which calls it from loopback with no `X-Forwarded-For` | AIDA-29, AIDA-30 | Design the two requirements together |

## Backlog

- Longer-horizon (`PROJECT.md` → Out of Scope until a milestone pulls them in): live chat widget, more channels (WhatsApp/social/voice), i18n UI, SSO/SAML + advanced RBAC, hosted offering.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---|---|---|
| 8. Security Hardening | v2.0 | 0/0 | Not started | - |
| 9. Operations | v2.0 | 0/0 | Not started | - |
| 10. Team | v2.0 | 0/0 | Not started | - |
| 11. Inbox | v2.0 | 0/0 | Not started | - |
| 12. Ticket Lifecycle | v2.0 | 0/0 | Not started | - |
| 13. Integrations | v2.0 | 0/0 | Not started | - |
| 14. Projects Foundation | v2.0 | 0/0 | Not started | - |
| 15. Work Views | v2.0 | 0/0 | Not started | - |
| 16. Workspace | v2.0 | 0/0 | Not started | - |
| 17. Unification | v2.0 | 0/0 | Not started | - |
