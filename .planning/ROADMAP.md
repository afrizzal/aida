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

1. `pnpm audit --prod --audit-level=high` exits 0, or the gate is reported red with every residual explained in `docs/SECURITY.md`.
2. `docker compose -p aida up -d --build` serves `https://localhost/api/health`; `app` and `worker` run as non-root; the one-shot `migrate` ran as non-root and exited 0; uploads still work.
3. Every HTML response carries a CSP, and the core pages run with zero CSP violations.
4. A spoofed `X-Forwarded-For` cannot change a rate-limit identity, and the two unthrottled public routes are throttled while the container healthcheck stays green.
5. All four connection tests return categorized errors, and `docs/SECURITY.md` matches the code.
6. Dependabot and a CI audit job exist as files.

**Stays open for a human:** the real security contact, the `v1.0.0` tag, the release, and repository settings in `LAUNCH.md`.
**Plans:** 0/23 plans complete
**Wave 1**

- [ ] 08-01-PLAN.md — Upgrade `next` to >=16.4.1, pinned (Wave 1)
- [ ] 08-05-PLAN.md — System font stack, telemetry off in CI, audit workflow, Dependabot, nightly egress job (Wave 1)
- [ ] 08-06-PLAN.md — Categorized connection-test errors, `addTag` gate first, `sla-flag` comment (Wave 1)
- [ ] 08-17-PLAN.md — E2E harness: cross-platform worker teardown, honesty-invariants flake (Wave 1)
- [ ] 08-19-PLAN.md — Egress suite off the default integration path (review C1) (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 08-02-PLAN.md — Upgrade `better-auth` to >=1.7.7 with migration proof (Wave 2)
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

- [ ] 08-14-PLAN.md — Guarded project-`aida` container harness, four-state reporter, first runtime proofs (K22) (Wave 10)

**Wave 11** *(blocked on Wave 10 completion)*

- [ ] 08-21-PLAN.md — Production-mode host E2E: CSP, client identity and the health DB bound (reviews C6, C7) (Wave 11)
- [ ] 08-22-PLAN.md — Real Caddy: spoofing, probe refusal at an instrumented upstream, health floods (Wave 11)

**Wave 12** *(blocked on Wave 11 completion)*

- [ ] 08-23-PLAN.md — Root-owned uploads volume procedure and non-root backup on the real stack (Wave 12)

**Wave 13** *(blocked on Wave 12 completion)*

- [ ] 08-15-PLAN.md — `docs/SECURITY.md` reconciliation with an evidence-status table (Wave 13)

**Wave 14** *(blocked on Wave 13 completion)*

- [ ] 08-16-PLAN.md — End-of-phase gate on one tested commit, guarded compose gate, evidence matrix (Wave 14)

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
**Requirements:** AIDA-18, AIDA-52, AIDA-53, AIDA-54, AIDA-55, AIDA-56, AIDA-57, AIDA-97
**UI hint**: yes
**Goal:** Tickets model real support work: duplicates, waiting, a team's own states, and knowledge that grows from resolved work.
**Success Criteria (what must be TRUE):**

1. Tickets link in all three relation types, and links show from both sides.
2. A merge moves the thread, closes the source as a duplicate, and leaves a full audit event, and no status link exposes one contact's messages to another.
3. A snoozed ticket wakes by date or by customer reply, and auto-close skips it.
4. Custom states migrate existing data without loss, admins can manage them, and every reader of status, including the `sla-flag` worker, reasons about the group.
5. Each SLA due time moves by exactly the paused time across repeated pauses, and the real SLA worker raises no flag while a ticket is paused.
6. An admin can review a proposed KB article from resolved tickets, and nothing publishes without that review.

**Plans:** 0 plans

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

**Plans:** 0 plans

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
| 10. Team | v2.0 | 0/0 | Not started | - |
| 11. Inbox | v2.0 | 0/0 | Not started | - |
| 12. Ticket Lifecycle | v2.0 | 0/0 | Not started | - |
| 13. Integrations | v2.0 | 0/0 | Not started | - |
| 14. Projects Foundation | v2.0 | 0/0 | Not started | - |
| 15. Work Views | v2.0 | 0/0 | Not started | - |
| 16. Workspace | v2.0 | 0/0 | Not started | - |
| 17. Unification | v2.0 | 0/0 | Not started | - |
