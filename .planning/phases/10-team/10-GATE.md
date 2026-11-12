# Phase 10 gate

Tested commit: 2418e4c5d80de6a538a606c65fc742240c9e8740
Date: 2026-11-13, 01:30Z to 01:51Z
Run id: mweatnnb-9c8802fc3d28e482
Evidence dir: a `mktemp -d` directory under `${TMPDIR}` (`aida-gate-10-*`), removed after the SUMMARY quoted it
Tree state: clean, apart from the untracked `.planning/state.json`, which is not part of the gate

Every row of the Results table ran at the tested commit, in the plan's order, one process at a time. Nothing was committed between the first row and the last one. Each command wrote its own log, and each exit code was written to its own `.exit` file and read without a pipe. This file records only what this gate measured; the earlier runs on this branch (integration 127 files and 1781 tests after 10-06, E2E 292 passed after 10-13) are not evidence here.

## Results

States: passed (exit 0 only), failed (non-zero exit), blocked (reason, with evidence), not run. Times are UTC.

| Command | State | Exit code or reason | Log summary | Commit |
| --- | --- | --- | --- | --- |
| pnpm lint | passed | 0 | lint.log, 01:30Z. "Checked 760 files", 0 errors, 1 warning (`tests/unit/container-config.test.ts:160`, `noTemplateCurlyInString`, the old known one) | 2418e4c |
| pnpm typecheck | passed | 0 | typecheck.log, 01:30Z; no output from `tsc --noEmit` | 2418e4c |
| pnpm test | passed | 0 | test.log, 01:30:14Z to 01:30:40Z (25.4 s). Files 110 passed of 110; tests 1967 passed, 0 failed, 0 skipped | 2418e4c |
| pnpm test:integration | failed | 1 | integration.log, 01:30:57Z to 01:38:42Z (464.7 s). Files 130 passed, 1 failed (131); tests 1838 passed, 1 failed (1839). The failure: `tests/integration/backup-failures.test.ts` > "run deadline (K143): a dump waiting on a held ACCESS EXCLUSIVE lock is stopped at BACKUP_MAX_RUN_SECONDS 8 …", `backup-failures.test.ts:460`: expected stdout to contain "[backup] backup aborted: run deadline passed", received "[backup] backup failed: dump" after 7161 ms. `tests/integration/egress-isolation.test.ts` is not among the files run: the log names it 0 times, and the 131 files are exactly `tests/integration/*.test.ts` (132) minus that file (`vitest.integration.config.ts:8`). See the diagnostic rerun below. | 2418e4c |
| pnpm test:egress | blocked (space) | 1; the rule J preflight stopped it before any build | egress.log, 01:40:28Z. "DockerPreflightError: Free space on the Docker VM is 13.2 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." (`tests/support/docker-test-preflight.ts:90`, from `runBuildPreflight` at `:438`, called at `tests/integration/egress-isolation.test.ts:268`). The host check runs first in `runBuildPreflight` (`:436`) and passed; `df -h /System/Volumes/Data` read 23 GiB available just before the run. Counts: tests 1 passed (the stack-free installer egress inventory), 4 skipped; files 1 failed (the beforeAll stop). No image was built or pulled. | 2418e4c |
| pnpm test:e2e (run 1) | failed (global setup stalled on `/setup`) | 1 | e2e.log, 01:40:53Z to 01:41:33Z. `TimeoutError: page.waitForURL: Timeout 30000ms exceeded` at `tests/e2e/global-setup.ts:174`. No test ran. The 543 dev-server lines (prefix `[e2e-server]`) were copied to e2e-server-run1.log before the move: "Next.js 16.4.6 (Turbopack)", "Ready in 214ms", then 298 `GET /setup 200` lines alternating with "Compiled in 1ms", and no `POST /setup`. Owner item next-o1, not fixed here. | 2418e4c |
| `.next` move | done | mv exit 0 | 2026-11-13T01:41:41Z, after run 1: `mv .next ~/.Trash/aida-next-1794534101`. Never removed. Product code and config untouched. | - |
| pnpm test:e2e (run 2, the one rerun) | passed | 0 | e2e2.log, 01:41:51Z to 01:49:50Z (8.0 min). "Running 293 tests using 1 worker"; 292 passed, 0 failed, 0 flaky, 1 skipped. Phase 10 specs: team-invitations 14 passed, team-deactivation 4, notifications-bell 3, mentions-leak 7, csp 14, single-h1 9; none failed. | 2418e4c |
| pnpm build | passed | 0 | build.log, 01:50:03Z to 01:50:20Z. "Turbopack build encountered 5 warnings", each "Dynamic filesystem access causes tracing of the whole project" (the known Phase 02 deferred item). No Google Fonts host in the log (0 matches). | 2418e4c |
| pnpm audit --prod | failed | 1 | audit.log, 01:50:26Z. "48 vulnerabilities found", "Severity: 3 low \| 35 moderate \| 10 high" (AIDA-25, owner item 08-o3). The Phase 9 rerun gate had 42 (2 low, 30 moderate, 10 high). `git diff --stat 38ef41a 2418e4c -- package.json pnpm-lock.yaml` is empty, so no dependency changed in between; the difference comes from the advisory data the command reads (an inference: the old advisory list was not kept). | 2418e4c |

Further runs, recorded beside the charter rows and not replacing any of them:

| Command | State | Exit code | Log summary | Commit |
| --- | --- | --- | --- | --- |
| `pnpm test:integration tests/integration/backup-failures.test.ts` (diagnostic rerun of the one failing file, after the full run) | passed | 0 | backup-diag.log, 01:39:11Z to 01:40:17Z. 1 file, 20 tests passed, including the K143 run-deadline case. The failure in the full run is therefore timing-dependent, not deterministic. Phase 10 changed neither the backup code nor this test (`git diff --stat 5dc6890 2418e4c -- tests/integration/backup-failures.test.ts scripts src/lib/backup` is empty). The full-run row stays failed. | 2418e4c |
| `pnpm typecheck` (after E2E and build) | passed | 0 | typecheck-post.log, 01:50:28Z to 01:50:38Z. No second `.next` move was needed. | 2418e4c |

Docker: `colima status` and `docker info` both exited 0 before the first Docker step (01:30Z) and again before `pnpm test:egress` (01:40Z). Every Docker-using command ran with `AIDA_TEST_RUN_ID=mweatnnb-9c8802fc3d28e482`, `DOCKER_HOST` from the docker context and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. No `docker compose up`, `run`, `down`, `build` or `config` ran on any project, and no image was built or pulled. `pnpm test:docker-cleanup` was not run. After the last Docker-using run, `docker ps -a`, `docker images`, `docker volume ls` and `docker network ls`, each filtered on `label=aida.test.run=mweatnnb-9c8802fc3d28e482`, listed nothing, and no container name held the run id. Host disk stayed at 22 to 23 GiB available throughout (`df -h /System/Volumes/Data`).

## Static checks (re-run at 2418e4c)

| Check | Exit code | Result | Output |
| --- | --- | --- | --- |
| Single notification boundary (C10): `git grep -l -e "\.notification\." -e "\"Notification\"" -- src ':!src/generated'` | 0 | passed | `src/lib/notifications/store.ts`, `src/lib/scoped-db.ts`, exactly the two expected files |
| The one D-15 exception stays single (LOW): `git grep -l "listDigestPairs" -- src` | 0 | passed | `src/lib/notifications/digest.ts`, `src/lib/notifications/store.ts`, exactly the two expected files |
| `pnpm test tests/unit/membership-inventory.test.ts tests/unit/page-access-inventory.test.ts tests/unit/member-writers.test.ts tests/unit/invite-no-log.test.ts tests/unit/better-auth-routes.test.ts` | 0 | passed | unit5.log. The `test` script is `vitest run tests/unit`, so the named files only add to the whole unit tree: 110 files, 1967 tests passed |
| The same five files alone: `pnpm exec vitest run <the five files>` | 0 | passed | unit5-only.log: 5 files, 140 tests passed. A first attempt passed the five paths as one shell word, found no test file and exited 1; that was the command line, not the code, and the corrected run is the one recorded |
| `git diff --quiet 5dc6890 -- src/components/sidebar.tsx` | 0 | passed | the sidebar is unchanged in this phase |

## Design-system checklist (§9)

Mechanical checks only. The UI files are the 38 `.tsx` files under `src/` changed by `(10-NN)` commits (`git log --grep='(10-'` with `git diff-tree` over `src/**/*.tsx` and `src/**/*.css`, list ui-files.txt). No `.css` file and not `src/app/globals.css`. New surfaces: `src/app/(app)/settings/team/` (5 files), `src/app/(app)/settings/notifications/` (2), `src/app/(auth)/invite/[token]/` (2), `src/app/(auth)/no-access/` (2), `src/components/notification-bell.tsx`, `src/components/tickets/mention-autocomplete.tsx`, `src/components/join-welcome-toast.tsx`. Changed: `composer.tsx`, `top-bar.tsx`, `empty-state.tsx`, `settings-nav.tsx`, `(app)/layout.tsx` and the 18 existing `(app)` pages that gained `requirePageAccess` (10-17); all 20 `(app)` page files now call it (`git grep -l requirePageAccess` over them prints 20).

| Item | Result | Evidence |
| --- | --- | --- |
| 1 new tokens live in `globals.css`, not hardcoded | passed | The plan's grep `oklch\(\|#[0-9a-fA-F]{6}\b` over the six new-surface paths: exit 1 (no output). Over all 38 files: `oklch(`, `#hex` (3 to 8 digits), `rgb(`, `rgba(`, `hsl(`: exit 1; Tailwind palette colours (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, gradient stops with red, blue, gray, slate, white, black and the like): exit 1. |
| 2 empty state uses halo and icon box | passed | The bell's empty list renders `EmptyState` (`src/components/notification-bell.tsx:352-357`, `className="min-h-0 px-4 py-8"`, the compact variant of UI-SPEC Surface 3); `src/components/empty-state.tsx:35` halo (`-m-3 rounded-2xl bg-primary/5 blur-[2px]`), `:38` icon box (`rounded-xl border border-primary/15 bg-primary/10`). `EmptyState` gained only the optional `className` (`:15`, `:28-30`). |
| 3 sidebar uses `sidebar-*` tokens | passed (unchanged) | `git diff --quiet 5dc6890 -- src/components/sidebar.tsx` exit 0; `sidebar.tsx:48` `border-r border-sidebar-border bg-sidebar text-sidebar-foreground` |
| 4 top bar is sticky with backdrop blur | passed | `grep -c "sticky top-0 z-10" src/components/top-bar.tsx` prints 1; `top-bar.tsx:42` `sticky top-0 z-10 … border-border/70 … backdrop-blur-sm`; the bell sits at `:68` between Search and `ThemeToggle` (`:69`), amendment A8 |
| 5 auth page does not wrap itself | passed | `src/app/(auth)/no-access/page.tsx` returns one `Card` (`max-w-[400px] border-border/70 shadow-xl shadow-primary/5`) and nothing around it; `src/app/(auth)/invite/[token]/page.tsx:59`, `:92` return only `<InviteCard>`, and `invite-card.tsx:76`, `:386` render a `Card` as the outermost element. Neither adds a background, a `min-h-screen` or a `main`; both rely on `src/app/(auth)/layout.tsx`. |
| 6 typography uses explicit `text-[Npx]` | passed | The plan's grep `text-(xs\|sm\|base\|lg\|xl)\b` over the six new-surface paths: exit 1. Over all 38 files, `text-(xs\|sm\|base\|lg\|xl\|2xl…9xl)`: exit 1. The shadcn `CommandItem` default `text-sm` (`src/components/ui/command.tsx:145`) is overridden by `text-[13px]` on the instance (`mention-autocomplete.tsx:135`). |
| 7 dark mode tested | open (human) | Dark mode of the Team page and its three dialogs, the invitation page in every state, the bell (count pill, unread dot, empty state), the mention span in the thread and the autocomplete, Settings → Notifications and `/no-access` (DS §7, §8 rule 8), including the contrast of the count pill and the mention text. Not tested here; no result is recorded. |
| 8 `tsc --noEmit` clean | passed | `pnpm typecheck` exit 0, before and after E2E and build (Results above) |

Checks from the UI-SPEC hooks and the plan's acceptance, beyond the eight items:

| Check | Result | Evidence |
| --- | --- | --- |
| No inline script | passed | `grep -rEn "<script\|dangerouslySetInnerHTML"` over the six new-surface paths: exit 1; over all 38 files: exit 1. `tests/e2e/csp.spec.ts` loads `/invite/<valid>`, `/invite/<unknown>` and `/no-access` with zero CSP violations (E2E run 2, csp 14 passed). |
| Spacing on the declared scale (4, 8, 16, 24, 32; UI-SPEC "Spacing Scale") | failed (1 finding, not fixed by the gate) | A grep for off-scale padding, margin, gap, space and inset steps (`0.5`, `1.5`, `2.5`, `3`, `3.5`, `5`, `7`, `9` to `12`) over the seven new files and folders finds one: `src/components/tickets/mention-autocomplete.tsx:135` `py-0.5` (2px) on each autocomplete `CommandItem` (commit `6ac3176`, plan 10-12). It overrides the shadcn default `py-1.5`. Neither value is on the scale, and UI-SPEC lists no exception for it. The added lines of `composer.tsx`, `empty-state.tsx`, `top-bar.tsx` and `settings-nav.tsx` since `5dc6890` have no off-scale step (exit 1). For the phase code review; this gate changes no product code. |
| Sizes outside the scale by design | passed | `size-8` avatars and icon buttons, `w-[280px]` autocomplete, `w-[360px]` popover, `h-5 min-w-5` count pill, as UI-SPEC lists them |

`/no-access` has no `<main>` landmark (`deferred-items.md`, from 10-17): the `(auth)` layout has none. That is for the screen-reader item below, not a §9 item.

## UI-SPEC amendments (V-19)

UI-SPEC stays approved and binding; `10-UI-SPEC.md` was not edited. Each amendment below was made by the plan named and is recorded here.

| Amendment | What changed against UI-SPEC | Plan |
| --- | --- | --- |
| A1 | The scope line (UI-SPEC line 17) says Phase 9's `BrandMark`, Backups tab and single-`<h1>` work "do **not** exist". It is stale: all three exist (`src/components/brand-mark.tsx`, `/settings/backups`, `tests/e2e/single-h1.spec.ts`), and Phase 10 builds on them. | the replan (CONTEXT V-19); recorded here |
| A2 | Settings nav: Team and Notifications follow Backups, the last item today (UI-SPEC said "after Email", the last item on 2026-11-08); `settings-nav.tsx:15-18` | 10-10 |
| A3 | The "Unassigned tickets" switch on Settings → Notifications, for owners and admins only, default on, one switch for in-app and digest (owner item 11) | 10-11 |
| A4 | The digest's line "On unassigned tickets" for fallback rows | 10-09 |
| A5 | The `/no-access` body: "You are not a member of this workspace, or your membership was removed. If this is a mistake, ask a workspace admin to invite you again." (also covers the never-a-member case of V-27) | 10-02 |
| A6 | The throttled invitation view ("Something went wrong while joining." / "Wait a moment and try again." with "Go to sign in") and the server-side field refusal callout | 10-08 |
| A7 | Deactivation with reassignment: the skipped-ticket count in the toast, the warning callout for tickets that could not be reassigned, and "Try again" | 10-10 |
| A8 | The bell sits between the Search button and `ThemeToggle` (UI-SPEC said "before ThemeToggle"; Search was added since) | 10-11 |
| A9 | Mention autocomplete rows use on-scale `py-1` (4px; was the off-scale `py-0.5`), so a row is the `size-8` avatar plus 2 × 4px = 40px, and the list height for eight visible rows is `max-h-[320px]` (UI-SPEC Surface 4 said `max-h-[288px]`, which no on-scale padding meets). `max-h-[320px]` is a size, not spacing. Run decision K176, review d-WR-6; `mention-autocomplete.tsx:126`, `:137`. Re-run of the gate's off-scale spacing grep on that file after the change: exit 1 (no hit); pinned by `tests/unit/mention-autocomplete-spacing.test.ts`. | code-review fix batch F4 (`563b6dc`, `3d77f43`) |

## Requirement evidence

Each acceptance item of `REQUIREMENTS.md` (read only, O-9) is one row, with the test file and case that prove it and the state of that case in this gate's runs. Rows marked ↳ are Phase 10 decision clauses or human boundary items from CONTEXT below the acceptance text; like Phases 8 and 9, they hold a requirement open too. Command rows: "integration" is the full `pnpm test:integration` run, whose exit 1 comes from the one `backup-failures.test.ts` case above and from no Phase 10 file (130 of 131 files passed, every Phase 10 integration file among them); "E2E" is `pnpm test:e2e` run 2 (exit 0); "unit" is `pnpm test` (exit 0). An item is passed only when every case it cites passed in those runs.

A requirement is **evidence complete** only when every acceptance row is passed. Closing it, and any change to `REQUIREMENTS.md`, stays with the orchestrator and the owner (O-9).

### AIDA-42 (invite by email and role)

| # | Acceptance item | Test file and case | Command row | State |
| --- | --- | --- | --- | --- |
| 42.1 | with a fake SMTP, the invitation reaches the invited address with a working link | `tests/integration/invitations.test.ts` "the invitation email through the fake SMTP (V-15, D-06, R2-5)" > "sends one message to the invited address with the UI-SPEC subject and body; its link is valid and accepts …" and the failure modes after it; `tests/e2e/team-invitations.spec.ts` "fake SMTP (V-15): the invitation email reaches the invited address and its link joins in a fresh browser" | integration; E2E | passed |
| 42.2 | a reused token fails | `invitations.test.ts` "acceptInvitation: every refusal is one generic INVALID_INVITATION" > "accepted by another user, revoked, expired at expiresAt and unknown tokens all fail identically"; `team-invitations.spec.ts` "a link works once: after a join, the same link in another fresh browser is the invalid card" | integration; E2E | passed |
| 42.3 | an expired token fails | the same integration case (expired at `expiresAt`) and "one millisecond before expiresAt is still accepted (edge AIDA-42)"; `team-invitations.spec.ts` "an expired invitation shows the invalid card and creates nothing" | integration; E2E | passed |
| 42.4 | a mismatched-email token fails | `invitations.test.ts` "a different address fails; the same address in another case with surrounding spaces succeeds"; `invite-onboarding.test.ts` "signUpAndAccept: the account is created only for the invited address"; `team-invitations.spec.ts` "D-05: a signed-in account with another email sees the mismatch card and gets no membership" | integration; E2E | passed |
| 42.5 | an inviter cannot grant a role above their own | `invitations.test.ts` "createInvitation: role ceilings, input and duplicates" > "an admin invites member and admin but not owner (ROLE_ABOVE_OWN); an owner invites owner", "a member or a non-member inviting anyone is NOT_ALLOWED …", "an owner with a mixed owner and admin row inviting owner is ROLE_ABOVE_OWN (V-26 (2)) …", and "the inviter's current rights decide at accept …" | integration | passed |
| 42.6 | when SMTP is off a copyable link is offered | `invitations.test.ts` "email disabled or not configured: nothing is sent and the link is returned (smtp_off)" and the send-failure cases that return the link; `team-invitations.spec.ts` "tracer: the owner invites with email off, a fresh browser creates the account …" (the copy-link view) | integration; E2E | passed |
| 42.7 | E2E covers accept, expiry and org isolation | `team-invitations.spec.ts`: accept (tracer, fake SMTP, C9 (a), C9 (b), "an existing account with no workspace …"), expiry ("an expired invitation …"), isolation ("isolation: an invitation to organization B grants B only; neither side reaches the other's ticket"); 14 of 14 passed | E2E | passed |
| ↳ | V-24 and the `dd941e0` change: the accept POST admits `Origin: null` only with `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`; a missing, foreign or bare-null Origin is 403 | `invite-onboarding.test.ts` "the accept route (V-24): Origin, rate limit, validation, 303"; `team-invitations.spec.ts` the two V-24 cases | integration; E2E | passed; the change is still to be critiqued (see "Security-relevant change" below) |
| ↳ | C9, R2-2, R3-1, V-23: account created then accept failed, a session deleted before accept, a link revoked before sign-up | `invite-onboarding.test.ts` "C9: account created, accept failed, and the defined retry", "V-23: a session revoked before accept"; `invitations.test.ts` the V-23 rollback, retry and race blocks; `team-invitations.spec.ts` "R2-2 …", "R3-1 (c) …" | integration; E2E | passed |
| ↳ | a test with real email (charter phase table) | none | - | open (human) |
| ↳ | visual approval and dark mode of the invitation page in every state, the 360px backstops, screen reader (10-08) | none | - | open (human) |

Evidence complete: **yes**, all seven acceptance rows passed. Held open by: the real-email test and the visual, dark-mode, 360px and screen-reader items (human); the `dd941e0` security change awaits the phase code review and the Codex diff critique. The requirement's note that this delivers the invite half of v1's AIDA-10 is not a test item; nothing here changes AIDA-10's record.

### AIDA-43 (list, change role, deactivate; access ends at once)

| # | Acceptance item | Test file and case | Command row | State |
| --- | --- | --- | --- | --- |
| 43.1 | an admin can list members, change a role and deactivate a member from Settings → Team | `tests/integration/team-member-admin.test.ts` "listMembers (V-26 …)", "changeMemberRole (tracer …)", "deactivateMember (D-07, D-09, D-10, V-26 (5))"; `tests/e2e/team-deactivation.spec.ts` "V-27, C6: …" (the owner deactivates in the UI) and "R2-4: … A demotes B …" (role change in the UI); `team-invitations.spec.ts` tracer (the Team page lists the new Member) | integration; E2E | passed |
| 43.2 | authorization is enforced server-side | `team-member-admin.test.ts` "rule matrix: admin on an owner or an owner-row target, member on anyone and self are refused", "a user id of another organization is NOT_A_MEMBER …", the adjacency cases; `team-deactivation.spec.ts` "R2-4 …" (the server refuses B's stale change: "You can't make this change with your role."); `tests/unit/better-auth-routes.test.ts` and `team-deactivation.spec.ts` "C4, V-03, O-5: the organization and admin plugin routes answer 403 over HTTP to every caller and change nothing" (80 requests) | integration; unit; E2E | passed |
| 43.3 | a session opened before the deactivation is refused on its next request to pages, server actions, API routes and attachment downloads | `tests/integration/membership-gate.test.ts` "getScopedDb (D-08): membership re-read on every call", "/api/attachments/[id] (D-08): a removed member gets the missing-attachment answer", "requirePageAccess (V-27) …", "/api/tickets/[id]/messages (D-08): 403 for a removed member", "readFreshSession (V-23) …"; `team-deactivation.spec.ts` "V-27, C6: an open session lands on /no-access on six pages, its server action changes nothing, the API answers 403 and the attachment 404"; `tests/unit/page-access-inventory.test.ts`, `membership-inventory.test.ts` | integration; unit; E2E | passed |
| 43.4 | "the last admin cannot be removed, including by two concurrent requests", read under O-10 as: **the organization keeps at least one owner, who holds every admin right** | `team-member-admin.test.ts` "assertOwnerFloor (direct cases …)", "races between the last two owners (D-09 amended, R2-4)" > "owners A and B deactivate each other: A succeeds, B is NOT_ALLOWED, one owner remains" and "… demote each other …", "an actor removed or demoted mid-race (R2-4)", "duplicate rows under the lock (V-26 (2), O-4)"; `tests/integration/member-rights.test.ts` "countOwners counts distinct users all of whose rows are owner"; `team-deactivation.spec.ts` "D-09, O-10: the only owner's row shows a Badge and no Deactivate control …" and "R2-4 …" | integration; E2E | passed (under the O-10 default reading; an owner may remove the last plain admin) |
| 43.5 | notifications and digests stop for a deactivated member | `tests/integration/notifications-core.test.ts` "skip rules" > "a recipient whose member row was deleted gets nothing"; `tests/integration/notification-digest.test.ts` "a deactivation mid-batch: beforeSend deletes the member rows; no email, the digest is CANCELED"; `tests/integration/notification-race.test.ts` "SLA pass against deactivation", "emitting assignment against deactivation of the assignee" | integration | passed |
| 43.6 | invitations they sent that nobody accepted are revoked | `team-member-admin.test.ts` "cancels pending invitations sent by the target and addressed to the target's email, in this organization only", "a role change that lowers the target's rights cancels the invitations the target sent" | integration | passed |
| 43.7 | each change writes an audit event | `team-member-admin.test.ts` "an owner promotes a member to admin: every row updated, one ROLE_CHANGED …", "setting the role a member already holds writes nothing and adds no audit row", "two admins deactivate the same member: one success, one NOT_A_MEMBER, one audit row"; `invitations.test.ts` tracer ("… both audit rows"); `tests/integration/team-schema.test.ts` "MemberAuditEvent (D-12, V-14)" (append-only, kept when the actor's account is removed) | integration | passed |
| 43.8 | the optional third role is decided in the Phase 10 CONTEXT | CONTEXT V-02: owner item 12, "10-O-3: tidak"; roles stay `owner`, `admin`, `member`; `member-rights.test.ts` "MEMBER_ROLES and isMemberRole (D-13, V-02)" | integration | passed |
| ↳ | V-25: assignment and bulk assignment of 100 tickets against deactivation, without deadlock | `tests/integration/deactivation-race.test.ts` both blocks | integration | passed |
| ↳ | V-26 (6): no new `member` writer outside the allowed files | `tests/unit/member-writers.test.ts` | unit | passed |
| ↳ | visual approval and dark mode of the Team page, Invite, Deactivate and Revoke dialogs, and `/no-access`; the 360px backstops; screen reader (10-02, 10-10) | none | - | open (human) |
| ↳ | O-10: whether AIDA-43 means a floor on plain admins | owner | - | open (owner) |

Evidence complete: **yes** under the O-10 default reading (all eight acceptance rows passed). Held open by: O-10 (if the owner reads it as a floor on plain admins, the floor changes), and the human items.

### AIDA-44 (in-app notifications)

| # | Acceptance item | Test file and case | Command row | State |
| --- | --- | --- | --- | --- |
| 44.1 | members get in-app notifications for assignment | `tests/integration/notification-emitters.test.ts` "ASSIGNED in runTicketMutation (V-08, D-16)"; `tests/e2e/notifications-bell.spec.ts` "assignment: …" | integration; E2E | passed |
| 44.2 | … for customer reply | `notification-emitters.test.ts` "CUSTOMER_REPLY: email ingest appending to a ticket", "CUSTOMER_REPLY: the status-page follow-up"; `notifications-bell.spec.ts` "customer replies: …" | integration; E2E | passed |
| 44.3 | … for mention | `tests/integration/mentions.test.ts` "mention tracer (D-20)" > "… stores it, notifies and renders the span"; `tests/e2e/mentions-leak.spec.ts` "a mention in an internal note shows in the thread and in the mentioned member's bell" | integration; E2E | passed |
| 44.4 | … for SLA at-risk or breach | `tests/integration/sla-flag-handler.test.ts` "slaFlagHandler notifications (plan 10-06, V-09, V-30)": one SLA_AT_RISK, one SLA_BREACHED and no at-risk on a direct breach, at-risk then breach, the rollback and re-run cases, the reset and re-flag case, the boundaries at exactly now and exactly 20 percent | integration | passed |
| 44.5 | a top-bar bell shows the unread count | `notifications-bell.spec.ts` "assignment: …" (the trigger's label carries "Notifications, 1 unread") | E2E | passed |
| 44.6 | read and archive persist | `notifications-bell.spec.ts` "assignment: … Mark as read, Archive and Mark all read persist across reload"; `notifications-core.test.ts` "read state (D-19)" | E2E; integration | passed |
| 44.7 | notifications are scoped to organization and user, with an unmocked isolation test | `notifications-core.test.ts` "organization and recipient isolation (D-15, D-28, unmocked)" (six cases); `team-schema.test.ts` "organization isolation of the notification and mention models (D-28)" | integration | passed |
| ↳ | owner item 11 option b: on an unassigned ticket a customer reply or an SLA transition notifies every current owner and admin, each of whom can turn it off | `notifications-core.test.ts` "emitForTicket: assignee or the unassigned fallback (V-28, owner item 11)", "fan-out on an unassigned ticket" (61 rows); `sla-flag-handler.test.ts` "an unassigned breached ticket notifies every owner and admin …", "fan-out: … 60 admins writes 61 rows …"; `notifications-bell.spec.ts` "customer replies: …" | integration; E2E | passed. The requirement text is the owner's (O-9): `REQUIREMENTS.md` is not edited and the widening is cited as owner item 11 |
| ↳ | O-7 defaults: a new ticket notifies nobody; a former-member assignee is not "unassigned" | `notification-emitters.test.ts` "no notification for new tickets and seeded history (O-7 (a), V-10)"; `notifications-core.test.ts` "a recipient whose member row was deleted gets nothing" | integration | passed (default); O-7 open (owner) |
| ↳ | visual approval and dark mode of the bell (count pill, unread dot, empty state, long text, gone ticket or actor), its 360px backstops, screen reader (10-11) | none | - | open (human) |

Evidence complete: **yes** (all seven acceptance rows passed). Held open by: O-7 (owner) and the human items.

### AIDA-45 (@mentions in internal notes)

| # | Acceptance item | Test file and case | Command row | State |
| --- | --- | --- | --- | --- |
| 45.1 | autocomplete offers members only | No test reads `GET /api/members/mentionable` (`git grep -l "members/mentionable" -- tests` prints nothing). Indirect evidence only: the route (`src/app/api/members/mentionable/route.ts`) returns `listMembers(orgId)` minus the caller behind `getScopedDb`; `team-member-admin.test.ts` "listMembers … lists nothing of another organization" and "an unknown role string is listed as member …"; `membership-inventory.test.ts` passes the route through Rules A to E; `mentions-leak.spec.ts` picks members from the list. No case shows that a non-member, a removed member or a user of another organization is absent from the list the composer receives. | integration; unit; E2E (indirect) | **not proven** (no direct test) |
| 45.2 | the mention renders through the sanitized markdown path | `tests/unit/markdown-render.test.ts` "wraps an exact @name in the mention span", "drops a literal span tag in the Markdown, mention classes included", "50 distinct mentions render 50 spans and no other new element", "keeps the mention classes out of inbound email HTML …"; `mentions.test.ts` tracer (renders the span) | unit; integration | passed |
| 45.3 | the mentioned member is notified | `mentions.test.ts` tracer; "who is recorded and notified (D-16, D-20, V-26, T-10-27)" (duplicates collapse, the author, non-members and other organizations dropped); `mentions-leak.spec.ts` "a mention in an internal note shows … in the mentioned member's bell" | integration; E2E | passed |
| 45.4 | a mention inside a public reply cannot leak to the customer | `mentions.test.ts` "mention field validation over HTTP" > "refuses a mention on a public reply with 400 mentions_not_allowed …", "a mention never reaches the customer (D-21, V-12, T-10-26)"; `tests/integration/mention-mode-switch.test.ts`; `tests/integration/status-token.test.ts` "loadStatusPageData is PUBLIC-only (D-21, AIDA-45)"; `mentions-leak.spec.ts` D-21, C7/R2-1, V-12, R3-2, status-page and outgoing-SMTP cases (7 of 7 passed) | integration; E2E | passed |
| ↳ | the AI-draft path into public mode | `tests/unit/mention-tokens.test.ts` (the reducer's `loadDraft`); no E2E (no paid LLM) | unit | passed (reducer only) |
| ↳ | visual approval and dark mode of the autocomplete and the mention span, the 50-mention layout backstop, screen reader (10-07, 10-12) | none | - | open (human) |

Evidence complete: **no**. Missing: a test of the list the composer receives (45.1): a member is offered, while a non-member, a removed member, another organization's user and the caller are not. Also held open by the human items.

### AIDA-46 (preferences and email digest)

| # | Acceptance item | Test file and case | Command row | State |
| --- | --- | --- | --- | --- |
| 46.1 | members control notifications per event type | `notifications-core.test.ts` "preferences and the unassigned opt-out (D-22, V-28)", "in-app off for ASSIGNED drops ASSIGNED and still delivers MENTION"; `notifications-bell.spec.ts` "with 'Assigned to me: in app' off, a new assignment adds no row; the switch stays off after reload" | integration; E2E | passed |
| 46.2 | with a fake SMTP, a pg-boss job batches unread notifications into one email per recipient | Batching: `notification-digest.test.ts` tracer "sends exactly one message …" and "two workers racing (D-23)" > "two runDigests at once over two recipients send exactly one email per recipient (5 repetitions …)", against the `node:net` fake SMTP. The pg-boss part: the queue, worker and schedule are registered in `src/lib/worker/index.ts:162-170`, and the handler `src/lib/worker/jobs/notification-digest.ts` is one call to `runDigests`; `tests/unit/digest-config.test.ts` checks the queue name and the schedule values. No test runs the job through pg-boss. The egress probe's flow 7 ("digest-email-sent") would run the digest in a stack, but `pnpm test:egress` is blocked (space). | integration; unit | **partly proven**: the batching passed; the job through pg-boss is not run by any test |
| 46.3 | turning an event type off removes it from the digest | `notification-digest.test.ts` "a preference change mid-batch: beforeSend turns the digest off for MENTION; the email lacks the mention line …" with its control case; `notifications-core.test.ts` "claimDigestCandidates returns only this recipient's eligible rows of those types …" | integration | passed |
| 46.4 | a digest is marked sent only after the SMTP server accepts it | `notification-digest.test.ts` tracer; "ambiguous outcomes keep the claim until the lease expires (C8, R2-5, V-29)" (five cases) | integration | passed |
| 46.5 | a job retried after a failure before that handoff sends no duplicate | `notification-digest.test.ts` "definitive rejections release the batch at once (R2-5)": reject-data, reject-data-command and reject-rcpt each followed by "the next run sends exactly one"; "lease check: … the digest is RELEASED …" | integration | passed |
| 46.6 | the remaining window (accepted but not confirmed) is documented | `docs/OPERATIONS.md:581-590` "Delivery guarantee" (ambiguous drop or deadline, the five-minute lease, a crash after acceptance, "AIDA does not claim exactly-once delivery"); the cases "drop-after-data-end …", "repeated ambiguous …", "afterSend throwing after acceptance …" prove the documented behaviour | read at the tested commit; integration | passed |
| 46.7 | no recipient sees another's notifications | `notification-digest.test.ts` "isolation (AIDA-46 prohibition)" > "X's digest never includes Y's rows or another organization's rows; read or archived rows are never included"; `notifications-core.test.ts` "claim and stamp never reach another recipient's or organization's rows …" | integration | passed |
| 46.8 | subjects carry no customer PII and no `AuditEvent.input` | `notification-digest.test.ts` "privacy (D-24, T-10-34)" > "the raw email carries no ticket subject, contact name, contact email, message text or AuditEvent.input; the subject is the constant" | integration | passed |
| ↳ | V-29: a wall-clock deadline that destroys the socket, TLS unchanged | `notification-digest.test.ts` "the deadline and the lease check (V-29)", "TLS behaviour is unchanged on the owned socket (V-29, T-10-38)" | integration | passed |
| ↳ | a digest sent to a real mail server; its look in a mail client | none | - | open (human) |
| ↳ | visual approval and dark mode of Settings → Notifications, its 360px backstops, screen reader (10-11) | none | - | open (human) |

Evidence complete: **no**. Missing: a run of the digest as a pg-boss job (46.2), either a test that drives the registered queue or the egress stack's flow 7 once the Docker VM has 20 GiB free. Also held open by the human items.

### Summary

| Requirement | Evidence complete | Missing evidence | Open beside it |
| --- | --- | --- | --- |
| AIDA-42 | yes | - | real-email test, visual, dark mode, 360px, screen reader (human); the `dd941e0` change awaits critique |
| AIDA-43 | yes (O-10 reading) | - | O-10 (owner); visual, dark mode, 360px, screen reader (human) |
| AIDA-44 | yes | - | O-7 (owner); visual, dark mode, 360px, screen reader (human) |
| AIDA-45 | no | 45.1: no direct test of the list the autocomplete receives | visual, dark mode, screen reader (human) |
| AIDA-46 | no | 46.2: the digest is never run as a pg-boss job by a test | real-email digest (human); visual, dark mode, screen reader (human) |

None of the five can be closed on this gate alone, because each still has open human items; AIDA-45 and AIDA-46 also miss evidence.

## Security-relevant change still to be critiqued

`dd941e0` (plan 10-13, Rule 1): `src/app/(auth)/invite/[token]/accept/route.ts` now admits `Origin: null` when the request also carries `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`, because the page's `Referrer-Policy: no-referrer` (D-04) makes the browser send `Origin: null` on the card's own form post. A missing Origin, a foreign Origin (with or without fetch metadata) and a bare `null` stay 403; browsers without Fetch Metadata fail closed. It changes the V-24 check, so it is listed for the phase code review and the Codex diff critique (charter step 7, after this plan). The alternative 10-13 named is a different referrer policy for `/invite` (for example `same-origin`), which would change D-04. Its tests passed here (42.1 to 42.7 and the V-24 ↳ row).

## Changes since the plans were written, reflected here

- R10-1 (`0db72a9`): the session cookie cache is off (`cookieCache: { enabled: false }` in `src/lib/auth.ts`); `readFreshSession` stays the only session read. `membership-gate.test.ts` "R10-1: a session read sets no cookie for a valid session" passed. Amendment at the end of `10-CONTEXT.md`; record `.planning/debug/r10-1-action-session-cookie.md`.
- `fe34bb8`: `tests/integration/auth-upgrade.test.ts` lists `20261115100000_team_foundation` in the pinned migration list (passed in the integration run).
- `76a08ca`: the Phase 9 settings-tab-order E2E follows amendment A2 (passed in E2E run 2).

## docs/SECURITY.md (blocked (08-o4))

Owner item 08-o4 (O-6) holds every edit to `docs/SECURITY.md`; the file is unchanged (`git diff --quiet -- docs/SECURITY.md` exit 0). These are the lines Phase 10 would add there, from `10-09-SUMMARY.md`, each **blocked (08-o4)**:

| Line | State |
| --- | --- |
| **Invitation and digest email (Phase 10).** Both send paths go through the organization's configured SMTP transport, the same server as ticket replies: Phase 10 adds no new egress destination. The invitation email carries the invitation link; the digest email carries counts per notification type, ticket numbers and links into the app only, never a customer name or email address, a ticket subject, message text or `AuditEvent.input`. Both build their links from `BETTER_AUTH_URL`, never from a request header. | blocked (08-o4) |
| **Invitation links.** The invitation token travels in the URL path of `/invite/<token>` links. AIDA stores only its SHA-256 hash, never logs the link, and sends `Referrer-Policy: no-referrer` on the invitation page. The shipped `Caddyfile` has no access log. An operator who enables access logging in Caddy, or in another proxy or CDN in front of AIDA, records those tokens, so such logs must be protected like credentials or the `/invite/` path redacted. A token works once and expires 7 days after the invitation is created. | blocked (08-o4) |

If the owner releases 08-o4, the `dd941e0` Origin rule (above) is a candidate third line, after its critique.

## Owner items and the default each plan used

| Item | Question | Default used | Plans |
| --- | --- | --- | --- |
| O-4 (12.2-o4) | a unique key on `member (organizationId, userId)` | no member constraint; every rule is correct with duplicate rows (V-06, V-26); an only owner with mixed rows counts as no owner and owner-right actions fail closed | 10-01, 10-03, 10-05 (tests: "duplicate rows under the lock", "readMemberRights with duplicate member rows") |
| O-5 (09-o3) | organization deletion | closed over HTTP with the rest of the plugin routes; `disableOrganizationDeletion` not set, no in-process deletion path; the route test names 09-o3 on `/organization/delete` (`tests/unit/better-auth-routes.test.ts:41-43`, `:205`) | 10-15, 10-13 |
| O-6 (08-o4) | `docs/SECURITY.md` | untouched; its lines are above as blocked (08-o4); the access-log warning is in `docs/OPERATIONS.md` | 10-05, 10-08, 10-09, this gate |
| O-7 | (a) does a new ticket count as a customer reply; (b) is a former-member assignee "unassigned" | (a) no: new tickets notify nobody; (b) no: nobody is notified, and the Deactivate dialog offers reassignment | 10-04, 10-06, 10-09 (documented in OPERATIONS.md "Unassigned tickets") |
| O-8 (14-o1) | private projects of a deactivated member | deactivation is not blocked and changes no project access rule; the rows stay inert; the risk is documented | 10-03 ("changes no ProjectMember row and is not blocked by a private project (O-8 default)"), 10-09 (OPERATIONS.md "Removing a member") |
| O-9 | the text of AIDA-44 in `REQUIREMENTS.md` | untouched; the widening is cited as owner item 11 | every plan (`git diff --quiet -- .planning/REQUIREMENTS.md` exit 0) |
| O-10 | the reading of "the last admin cannot be removed" | the organization keeps at least one owner, who holds every admin right; an owner may remove the last plain admin | 10-03, 10-10, 10-13 |

## Open items

Human (none performed here, none recorded as passed):

- A test with real email: an invitation and a digest sent through a real mail server and read in a real mailbox, and the look of both in a mail client.
- Visual approval and dark-mode review (DS §7) of every new surface: Settings → Team with the Invite, Deactivate and Revoke dialogs; `/invite/[token]` in every state, the throttled card included; the bell (count pill and unread dot contrast, empty state, long text, gone ticket or actor); the autocomplete and the mention span in the thread (mention text contrast); Settings → Notifications; `/no-access`.
- The 360px backstops of 10-08, 10-10 and 10-11 (long names and emails, no horizontal scroll, controls visible) and the 50-mention layout backstop of 10-07.
- Screen-reader checks: `/no-access` (one `<h1>`, no `<main>` landmark), the invitation card, the Team page and its dialogs, the bell, the autocomplete combobox, the preference switches.
- Sign out from `/no-access` in a real browser (10-02).

Owner:

- O-4, O-5, O-7, O-8, O-10 (above); O-6 holds the `docs/SECURITY.md` lines; O-9 keeps `REQUIREMENTS.md` the owner's.
- Docker VM space (rule J): `pnpm test:egress` stays blocked (space) until the VM has 20 GiB free; the preflight measured 13.2 GiB.
- `pnpm audit --prod` exits 1 with 10 high (AIDA-25, owner item 08-o3); 48 in total now, against 42 at the Phase 9 rerun gate, with no dependency change in between.
- Owner item next-o1: E2E run 1 stalled again in the global setup on `/setup`; one `.next` move and one rerun passed. The cause is not fixed.

For the phase code review and the Codex diff critique (charter step 7):

- `dd941e0`, the accept route's Origin rule (above).
- The spacing finding `src/components/tickets/mention-autocomplete.tsx:135` `py-0.5` (§9 section above).
- The flaky K143 case in `tests/integration/backup-failures.test.ts` (failed in the full run, passed alone; Phase 9 code, unchanged by Phase 10).

Evidence still missing (a follow-up plan, not this gate):

- AIDA-45 45.1: a test of `GET /api/members/mentionable` that shows a member offered and a non-member, a removed member, a user of another organization and the caller not offered.
- AIDA-46 46.2: the digest run as a pg-boss job, through the registered queue or the egress stack's flow 7.

Upgrade note: Phase 10 is built and tested on `better-auth` 1.7.20 (`package.json:36`; `@better-auth/cli` stays 1.4.21, `:87`, so no CLI schema generation). A later Better Auth upgrade reruns every invitation and membership suite of this phase (`invitations`, `invite-onboarding`, `team-member-admin`, `member-rights`, `membership-gate`, `deactivation-race`, `auth-upgrade`, `tests/unit/better-auth-routes.test.ts` with its version guard, and the E2E specs `team-invitations` and `team-deactivation`).

Blocked or failed gate rows: `pnpm test:integration` failed (one timing-dependent Phase 9 case); `pnpm test:egress` blocked (space); `pnpm audit --prod` failed (08-o3); `pnpm test:e2e` run 1 failed in global setup (next-o1), run 2 passed.

## README correction (D-26)

Applied, because every AIDA-42 acceptance row (42.1 to 42.7) passed in this gate. `README.md`, "When AIDA is not the right choice", lost the clause "and there is currently no in-product way to invite a second team member to a workspace" (then at lines 121-122) and gained one sentence: "Admins invite team members to that workspace by email with a role from Settings → Team, or copy the invitation link when email is not set up." The single-workspace statement before it is unchanged. The open human items of AIDA-42 (real email, visual) do not touch that sentence: the invitation flow itself is proven end to end in the browser.

## Notes

- No visual, dark-mode, screen-reader or UAT result is recorded here.
- `REQUIREMENTS.md`, `docs/SECURITY.md`, `STATE.md`, `ROADMAP.md` and `.planning/run-loop/` were not edited by this plan.
