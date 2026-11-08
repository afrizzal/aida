# Phase 10: Team - Pattern Map

**Mapped:** 2026-11-13 (for the replan, owner decision 2026-11-11 item 2 option b; analogs read in the current checkout of branch `v2/run-loop` at `8f0a6bd`)
**Files analyzed:** 104 entries from the `files_modified` lists of 10-01 to 10-16 (85 unique paths), plus 19 files the current code adds to the scope (section 0)
**Analogs found:** 96 / 104 (the rest are under "No Analog Found")

Every analog path below is tracked source (`git ls-files`); no install or runtime mirror is named. Line numbers are for the current checkout. Repo-relative paths only.

---

## 0. Drift since the plans were written (read this first)

The plans and CONTEXT were written on 2026-11-08 against `626588a`, before Phase 8 Part A, Phases 9, 11, 12, 12.1, 12.2 and 14 changed the code. CONTEXT line 12 ("Phases 8 and 9 are parked... `better-auth` is still 1.6.22, there is no trusted client-IP helper, no CSP") is false today.

### 0.1 Better Auth, sessions and membership

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D1 | D-01, 10-02, 10-05, 10-08, 10-14, 10-15: "build on better-auth 1.6.22" | `package.json:36` `"better-auth": "1.7.20"`; `@better-auth/cli` still `1.4.21` (`package.json:87`) | Rebase every "on 1.6.22" claim and test name on 1.7.20. The CLI ban (D-01) still holds. The installed package is in `node_modules`, so C4's route list can now be read from it (no longer "unverified") |
| D2 | C4/10-15: "list the organization plugin routes from the installed package" | Installed 1.7.20 exposes 35 `/organization/*` routes, including team routes (`create-team`, `add-team-member`, `list-user-teams`, `set-active-team`...), dynamic roles (`create-role`, `update-role`, `delete-role`, `list-roles`, `get-role`), `has-permission`, `get-active-member-role`, `delete`, `leave`, `invite-member`, `accept-invitation`, `cancel-invitation`, `reject-invitation`, `remove-member`, `update-member-role`, `set-active`. The admin plugin exposes 15 `/admin/*` routes (`set-role`, `remove-user`, `create-user`, `ban-user`, `impersonate-user`...) | The 10-15 block list and `tests/unit/better-auth-routes.test.ts` must enumerate the 1.7.20 set, not the 1.6.22 one. `src/lib/auth.ts:25` sets only `allowUserToCreateOrganization: false`; `/organization/delete` is open today (owner item 09-o3, recommendation a); `/organization/leave` and `/organization/remove-member` bypass D-09 |
| D3 | R2-2: "a fresh-session helper that reads without the cookie cache" (mechanism unverified) | `auth.ts:11` `cookieCache: { enabled: true, maxAge: 5 * 60 }`. 1.7.20 `getSession` accepts `query: { disableCookieCache: true }` (seen in `node_modules/better-auth/dist/api/index.d.mts`) | `src/lib/fresh-session.ts` = `auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } })`. Prove with an integration test that a session row deleted after sign-in is seen as gone |
| D4 | 10-02 creates `src/lib/membership.ts` as a new file with `requireMembership` | `src/lib/membership.ts` exists (150 lines): `findActiveMembership` `:28-39` (single unordered row), `findConservativeMembership` `:79-91` (all rows, id order, admin only when every row is admin), `shareLockActiveMembership` `:122-136` (`FOR SHARE`, id order), `isAdminRole` `:147-150`. Header `:1-6` says Phase 11 kept "the same name and signature as parked Phase 10 planned, so Phase 10 extends it" | 10-02 EXTENDS this file. Keep all four exports and their callers (26 files call them, for example `src/lib/tickets/mutations.ts:46`, `src/lib/projects/access.ts:22`, `src/lib/kb/proposal-review.ts`). Relative imports only, no framework import (`:6`): the worker calls it |
| D5 | 10-02 rule A: entries must call one of `getScopedDb`, `getPageScopedDb`, `requireMembership`, `requirePageMembership`, `getOrgRole`, `requireOrgAdmin` | New gates since: `getActiveOrgAccess` (`src/lib/authz.ts:34-40`, one session read + conservative role, K141/K151), `requireOrgAdminScope` (`:59-68`, 8 caller files), `getSessionActor` (`src/lib/session.ts:53-58`, 16 caller files, documented as NOT checking membership; each caller passes the actor to a service that checks it). `getOrgRole` is display-only (`authz.ts:42-50`) | The inventory must recognise these three. `getSessionActor` callers are exempt only when the called service reads membership in its transaction (pattern of `src/lib/tickets/ticket-state-admin.ts:202-209`); the inventory follows that call. Never re-introduce two session reads per write (K141) |
| D6 | D-08: `getScopedDb` must re-read the member row | Still true: `session.ts:38-43` reads only `activeOrganizationId`. 18 files call `getScopedDb(` | Unchanged requirement. Note `src/app/api/tickets/[id]/messages/route.ts:34-41` already adds its own `findActiveMembership` check after `getScopedDb` |
| D7 | D-11: add `UNIQUE (organizationId, userId)` on `member` | Still absent (`prisma/schema.prisma:160-171`, two single-column indexes). Owner item 12.2-o4 is still open (`run-loop/ANTREAN.md:42`). Six integration tests deliberately insert mixed duplicate rows to prove the conservative read: `tests/integration/authz-conservative-membership.test.ts` (header `:1-12`, insert `:34`), `kb-proposal-membership.test.ts`, `kb-proposal-publish-race.test.ts`, `kb-proposal-entry-flags.test.ts`, `project-access.test.ts`, `project-review-race.test.ts` | The migration makes those inserts fail. The replan must (a) state that D-11 closes 12.2-o4 (owner approved the replan, but name it), (b) rewrite the duplicate cases as "the constraint refuses a second row" plus keep the single-row behaviour, and (c) keep `findConservativeMembership` and `shareLockActiveMembership` (harmless on unique rows). Add these test files to the plan's `files_modified` |
| D8 | Session hook | `auth.ts:13-22`: `session.create.before` sets `activeOrganizationId` from `prisma.member.findFirst({ where: { userId } })` (unordered) | A freshly signed-up invitee has no member row at sign-up, so the new session gets `null`; accept must set it explicitly (C9). Deactivation (D-07) must move sessions in the same transaction; the hook only runs at creation |

### 0.2 Public routes, proxy, CSP, rate limits

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D9 | 10-15 line 98: "add `/invite` to PUBLIC_PREFIXES and return `NextResponse.next()` with Referrer-Policy no-referrer" | Every pass-through goes through `forwardWithSecurityHeaders` (`src/proxy.ts:46-58`), which sets the per-request CSP nonce, the request CSP header and `x-aida-client-ip`. Referrer is set per path by `securityHeadersFor` from `NO_REFERRER_PATH_PREFIXES` (`src/lib/security/csp.ts:25`, `:73-80`) | A bare `NextResponse.next()` would drop the CSP nonce and the client-IP header. Correct edit: add `"/invite"` to `PUBLIC_PREFIXES` (`proxy.ts:6-14`) AND to `NO_REFERRER_PATH_PREFIXES` (`csp.ts:25`); no new branch. The malformed-path guard (`proxy.ts:108`) already runs first |
| D10 | CONTEXT line 12 "no CSP"; 10-08/10-11 "adds no inline script" | Nonce CSP is live: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src 'self'`, `img-src 'self' data: blob:`, `form-action 'self'`, `frame-ancestors 'none'` (`csp.ts:48-67`); E2E `tests/e2e/csp.spec.ts` | The rule is now enforced, not just a promise. Bell polling uses same-origin `fetch` (allowed). Avatars must not load remote images. Add `/invite/<token>` and `/no-access` to the CSP E2E route list |
| D11 | 10-05/10-08: invitation accept and invitee sign-up have no throttle | Public routes call `consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs })` and `rateLimitedResponse` (`src/app/api/public/status/[token]/follow-up/route.ts:37-41`); scopes in `PUBLIC_RATE_LIMITS` (`src/lib/rate-limit/public-limits.ts:7-17`). Only route handlers use it today (5 routes) | Add `inviteView` / `inviteAccept` scopes to `PUBLIC_RATE_LIMITS`. A server action has no `Request`: read `(await headers()).get(CLIENT_IP_HEADER)` (written only by the proxy, `proxy.ts:53`) and key it with `rateLimitKeyForIp` (`src/lib/rate-limit/client-ip.ts:123-130`), or make accept a POST route handler. Limit before the token lookup (follow-up comment `:35-36`) |
| D12 | Public bodies | Public routes read bodies with `readBoundedFormData(request, MAX_REQUEST_BODY_BYTES, { maxParts })` (`follow-up/route.ts:56-65`, `src/lib/http/read-bounded-form-data.ts:149`) | Any public invite route handler copies this. Server actions are bounded by Next's own action body limit |
| D13 | D-04 "tokens never in logs" | `TRUSTED_PROXY_HOPS` and client IP logging live in `client-ip.ts:1-32` (logs the setting name, never an address). No request-URL logging in `src` (C12 still true) | C12's static check stays valid; also assert `client-ip.ts` never logs a path |

### 0.3 Setup, tenant seed lock, sign-up

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D14 | 10-08: invitee sign-up through `auth.api.signUpEmail` | `/setup` now runs its count and its sign-up under `withTenantSeedLock` (`src/app/(auth)/setup/actions.ts:49-81`, `src/lib/tenant-seed-lock.ts:79`); the lock header (`tenant-seed-lock.ts:13-14`) records "user sign-up outside /setup does not take it (stated limit)". `proxy.ts:24-28` names exactly three in-process `signUpEmail` callers | Invitee sign-up becomes a fourth in-process caller: update the `proxy.ts` comment and the tenant-seed-lock stated limit. It must not take the tenant lock (an organization already exists), and must refuse when `setupComplete` is not set. Pattern for `redirect()` after a transaction: `setup/actions.ts:90-91` |

### 0.4 Emitters and ticket paths

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D15 | D-17, 10-06: `assignTicket` updates `assigneeId` with no membership check; create `src/lib/tickets/assign-ticket.ts` with `assignTicketCore` under `lockOrganization` | `assignTicket` (`src/app/(app)/tickets/[id]/actions.ts:189-213`) calls `runTicketMutation` (`src/lib/tickets/mutations.ts:260-...`). It already checks the actor (`:271-273`, `MEMBERSHIP_ENDED`) and the assignee (`:198-200`, `MEMBER_NOT_ACTIVE`) inside the transaction. Bulk assign of up to 100 tickets uses the same service (`src/app/(app)/tickets/bulk-actions.ts:14`, `mutations.ts:59`) | D-17 is already met. Drop `assign-ticket.ts`. Emit `ASSIGNED` inside `applyOp` case `"assign"` (`mutations.ts:372-381`), per ticket, only when `ticket.assigneeId !== op.assigneeId` and the assignee is not the actor, for single and bulk |
| D16 | C11, 10-06: the assignee check runs "under the organization lock" (`lockOrganization` first) | `mutations.ts:6-24` documents a fixed order (actor membership, op references, ticket lock `FOR UPDATE` in id order, ...) that the Phase 12.1 race tests depend on ("Keep this order"). No code takes an organization row lock today (`git grep 'FROM "organization"'` finds only a migration loop) | Adding `lockOrganization` first to every ticket mutation serialises all of an organization's ticket writes. Safer: read the assignee with `shareLockActiveMembership` (`membership.ts:122-136`) in step 3; deactivation's `DELETE FROM member` then waits for the assignment, and an assignment that waited sees no row. Re-run the 12.1 race suites |
| D17 | D-18: SLA job "two global raw UPDATEs"; add `RETURNING` | Rewritten (review C6): each pass is one transaction with a lock SELECT `FOR UPDATE OF t SKIP LOCKED` then an UPDATE over the locked ids, both with OPEN-group and pause eligibility (`src/lib/worker/jobs/sla-flag.ts:62-160`). The UPDATEs use `$executeRaw` (count only, `:85`, `:129`). Hooks `onPassTransaction`, `afterPassLock`, `afterPassUpdate` (`:29-45`). Relative imports only (`:2`, `:23-24`) | Change the two UPDATEs to `$queryRaw … RETURNING "Ticket".id, "Ticket"."organizationId", "Ticket"."assigneeId"` and emit for exactly those rows inside `runPass` (`:153-166`). Breach implies at-risk in one statement, so a direct breach gets one `SLA_BREACHED`. The notification module must be relative-import-only to bundle into the worker |
| D18 | D-18: inbound paths "email ingest, the public pages, any other" | Four INBOUND writers: `src/lib/channels/email/ingest-message.ts:194-243` (append, effective ticket from `resolveReplyTicket` `:200`), `ingest-message.ts:249-259` (new ticket via `createTicket`), `src/app/api/public/status/[token]/follow-up/route.ts:119-158` (effective ticket `:120-122`), `src/app/api/public/intake/route.ts:108` (new ticket) | Notify the assignee of the EFFECTIVE (merge target) ticket. The two new-ticket paths have no assignee, so under owner item 10-O-2 option b they notify owners and admins; the replan must say whether a new ticket counts as a "customer reply" (D-16 wording). `createTicket` (`src/lib/tickets/create-ticket.ts`) runs its own transaction: emit inside it or pass a hook |
| D19 | D-16 "unassigned tickets produce no reply or SLA notification" | Owner 2026-11-11 item 11: 10-O-2 option b, owners and admins are notified, with a per-person opt-out (`ANTREAN.md:38`, `:89`) | D-16 and D-22 change: recipients for unassigned = every current owner and admin (conservative read), minus those who opted out. `NotificationPreference` needs the opt-out (a separate switch, not a type). AIDA-44 widening is the owner's call, already made |
| D20 | 10-16, R2-3: the status page queries inline (`page.tsx:38`); extract `findTicketByStatusToken` | The page and the attachment route now load through `loadStatusPageData` (`src/lib/tickets/status-page-data.ts:77`) and `loadStatusAttachment` (`:146`), one REPEATABLE READ snapshot. Inline lookups remain only in `csat/route.ts:32` and `follow-up/route.ts:46`. `src/lib/tickets/status-token.ts` exists (generator only, `:7-9`) | Rule E detects calls to `status-page-data.ts` loaders or a new lookup in `status-page-data.ts`; do not add a second loader for the page. R3-4 (helper plus other tenant reads) still applies to the two POST routes |
| D21 | 10-07: mentions in the messages route | `src/app/api/tickets/[id]/messages/route.ts`: `getScopedDb` `:26-31`, membership `:40`, unbounded `request.formData()` `:52`, `mode` from form `:57`, transaction `:116`, membership again `:122`, `lockTicketForAgentWrite` `:127-129`, `message.create` `:131-140` | Validate mention ids and insert `MessageMention` + `MENTION` notifications after `message.create`, inside this transaction, only when `mode === "internal"`; a `mentions` field with `mode=public` is a 400 before the transaction |
| D22 | D-21: outbound sends only PUBLIC | `email-outbound-send.ts:70` returns unless OUTBOUND and PUBLIC; `compose-outbound.ts:51` re-renders `bodyMarkdown` with `renderMarkdown` | The SMTP leak test must assert on `bodyMarkdown`-derived output, not only `bodyHtml` |
| D23 | 10-12: composer mode switch | Three switch paths now: `ComposerToggle` (`src/components/tickets/composer.tsx:143`), the `r`/`n` keys and palette commands via `focusComposer` (`:45-75`, Phase 11), and AI draft insertion that replaces the body and forces public (`:80-87`) | The mention strip (R2-1) must run in one `changeMode` wrapper used by all three; the draft path must also clear mention spans |

### 0.5 Schema, migrations, models

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D24 | 10-01: `prisma/migrations/20261108120000_team_foundation` | Latest folder is `20261114100000_project_file_cleanup_upload_xact_id`; `20261108120000` would sort before six applied migrations | New folder must sort after `20261114100000` (for example `20261115100000_team_foundation`) |
| D25 | D-27, 10-01: apply the migration in `aida-dev-db` on `127.0.0.1:55432` | 08-02 forbids touching `aida-dev-db` for this; dev migrations use a run-labelled `aida-test-devdb-<runId>-<6 hex>` container (procedure in `.planning/phases/08-security-hardening/08-02-PLAN.md`; Docker helpers in section 3.6) | Copy 08-02's procedure. Rule J: label `aida.test=1`, prefix `aida-test-`, cleanup by label and prefix only |
| D26 | D-12: `MemberAuditEvent` "same append-only protection as AuditEvent" | Two newer copies of the pattern: `TicketAuditEvent` (`prisma/migrations/20261108140000_inbox/migration.sql:95-106`) and `ProjectActivity` (`20261113100000_projects_foundation/migration.sql:693+`). `TicketAuditEvent.actorUserId` is a plain `String?` with no user FK (`schema.prisma:697`); the org FK is `onDelete: Cascade` | Copy the inbox trigger verbatim with new names. Store actor and target user ids as text without a user FK, so the admin plugin's user removal does not hit the append-only trigger. The org cascade plus a BEFORE DELETE trigger makes organization delete fail (ties to 09-o3) |
| D27 | D-28: list new models in `DOMAIN_MODELS` | `src/lib/scoped-db.ts:14-57` (Phase 14 block `:39-57`); `tests/unit/project-schema-parity.test.ts:1-26` checks every name against `Prisma.ModelName` | Append a "Phase 10 team" block; the parity test covers spelling. `member` and `invitation` stay excluded (`:3-4`) |
| D28 | `src/lib/team/`, "Team page" | Phase 14 added AIDA models `Team`, `TeamMember`, `ProjectMember`, `ProjectTeam` (`schema.prisma:1048-1104`) and services `src/lib/projects/teams.ts`, `src/lib/projects/members.ts`; the org plugin's own team routes exist (D2) | Name collision. Either rename the folder (for example `src/lib/workspace-members/`) or record in the plan that `src/lib/team/` means organization membership, never `Team`. Deactivation leaves `ProjectMember` and `TeamMember` rows inert (project access re-reads org membership, `src/lib/projects/access.ts:4-13`); private-project orphaning stays owner item 14-o1 |

### 0.6 Email, workers, compose

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D29 | 10-05 `tests/support/fake-smtp.ts`; C8 and R2-5 faults | No SMTP server double exists. Tests replace the transport with `vi.mock("@/lib/channels/email/smtp-client", …)` (`tests/integration/email-outbound-merge.test.ts:44-55`). No `smtp-server` package in `package.json`. Socket-level fakes exist only as `net.createServer` probes (`tests/unit/connection-test-probes.test.ts:39-71`) | The C8/R2-5 faults (DATA accepted then dropped; RCPT accepted, DATA rejected) need a real socket server, hand-written on `node:net` (no new dependency). Simple send/no-send cases may keep the `vi.mock` pattern |
| D30 | D-23: lease longer than the SMTP timeouts | `createSmtpTransport` sets `connectionTimeout`, `greetingTimeout`, `socketTimeout` to `timeoutMs` (default 10 000, `src/lib/channels/email/smtp-client.ts:21-31`); worker-bundleable, relative imports (`:3-5`) | Lease must exceed the sum of the three (30 s with the default), with margin |
| D31 | 10-05 `src/lib/app-url.ts`, 10-09 digest links | App reads `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (`docker-compose.yml:70`, `:72`); the `worker` service env (`docker-compose.yml:113-130`) has neither | The digest runs in the worker: add one URL variable to the worker env (10-09 already lists `docker-compose.yml`). Use the server-side `BETTER_AUTH_URL`, never `Host`. E2E sets both to `http://localhost:3100` (`tests/e2e/global-setup.ts:87-89`) |
| D32 | 10-09: register the digest job | Registry pattern `src/lib/worker/index.ts:150-157` (`createQueue(…, { policy: "singleton" })`, `work`, `schedule` with a cron constant from a contract module) | Copy the Phase 14 block; put the queue name and cron in `digest-config.ts` |

### 0.7 Tests, gates, owner items

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D33 | 10-01 `tests/support/lock-barrier.ts` with `waitForLockWaiter` on an ungranted `pg_locks` row (R3-3) | `tests/support/lock-wait.ts` exists: `backendPid` (`:37-42`), `waitForBlockedBy(observer, holderPid, waiterPids)` via `pg_blocking_pids` (`:50-70`), with the comment (`:9-12`) explaining why a `pg_locks` relation predicate fails for row-lock waiters. `tests/support/project-race.ts`: `createObserverClient` `:14`, `createServiceRace` `:38`, `settleAll` `:94`, `assertNoDeadlock` `:99` | Drop `lock-barrier.ts`; use `lock-wait.ts` and `project-race.ts`. R3-3 is solved by existing code |
| D34 | C1, 10-14: `pnpm test:egress` and the egress file "blocked (O-1)"; run integration "with the egress file excluded by an explicit command" | O-1 decided yes (rule J, owner item 5). `vitest.integration.config.ts:8` already excludes the egress file; `pnpm test:egress` uses `vitest.egress.config.ts` and project `aida-test-egress` (`tests/integration/egress-isolation.test.ts:46-48`); currently `blocked (space)` (VM under 20 GiB, `ANTREAN.md:9`) | `pnpm test:integration` runs as is. Record egress as `blocked (space)` (or run it if space allows), never "blocked (O-1)" |
| D35 | 10-13 E2E | One `next dev` on port 3100 (`tests/e2e/global-setup.ts:21-22`), `TRUSTED_PROXY_HOPS: "0"` (`:96`), `AIDA_E2E_FAULTS: "1"` (`:99`), owner `owner@e2e.aida.test` and member `member@e2e.aida.test` in org `aida-e2e` (`:24-32`, `:196-220`); no SMTP configured; fault points `src/lib/testing/e2e-fault.ts:23-31`; rate-limit reset fixture `tests/e2e/support/fixtures.ts:8` | E2E invitations use the copyable-link path (no SMTP). New users created in a spec must not break the shared owner/member state other specs use. Unique `X-Forwarded-For` per request in throttled specs (08-gap1 lesson). R3-1 and R3-2 must be fixed in the scripts |
| D36 | C6: every `(app)` page redirects to `/no-access` without membership | An in-page "access ended" state exists and is E2E-tested: `src/app/(app)/tickets/[id]/page.tsx:42`, `src/app/(app)/contacts/[id]/page.tsx:41` render `EmptyState headingAs="h1"` "Your access to this workspace has ended."; `tests/e2e/single-h1.spec.ts` uses an `ENDED_STORAGE` session (`:43`) and `ACCESS_ENDED_HEADING` (`:49`). 18 `(app)` pages exist (10-02 lists 13; new: `settings/statuses`, `settings/backups`, `kb/new`, `kb/proposals`, `kb/proposals/[id]`; `tickets/page.tsx` not listed) | The replan picks one behaviour and updates `single-h1.spec.ts` with it. `single-h1.spec.ts:52-71` lists every page and `:578` fails if one is not rendered: add `/settings/team` and `/settings/notifications`. Enumerate pages with `git ls-files 'src/app/(app)/**/page.tsx'` at execution |
| D37 | Session reads in routes | `src/app/api/palette/tickets/route.ts:18` and `src/app/api/tickets/picker/route.ts:19` call `auth.api.getSession` directly and let the service check membership | Inventory rule C must allowlist them by function, with that reason |
| D38 | 10-09, C12, D-26: edit `docs/SECURITY.md` | Owner item 08-o4 (`ANTREAN.md:34`): the run does not change `docs/SECURITY.md` until the owner decides | Conflict. The replan either waits for 08-o4 or records the Phase 10 SECURITY.md edits as blocked and puts the text in the SUMMARY |

### 0.8 UI and design system

| # | Plan text | Current code | Consequence for the replan |
|---|---|---|---|
| D39 | UI-SPEC: bell before `ThemeToggle` | `src/components/top-bar.tsx:45-68`: right cluster = Search button (`:48-65`), `ThemeToggle` (`:66`), `UserMenu` (`:67`). Title is a `<p>` (`:44`) from `getPageTitle` (`src/lib/navigation/page-title.ts:5-10`) | Insert `<NotificationBell />` between `:65` and `:66`. `TopBar` is a client component; the bell fetches its own data |
| D40 | Settings nav | `src/app/(app)/settings/settings-nav.tsx:7-16` has 8 items (AI Features, Branding, SLA Policies, Statuses, Tags, Custom Fields, Email, Backups); `settings/layout.tsx` has no role gate | Add Team and Notifications. Notifications preferences are for every member; Team is visible to all, writes admin-gated |
| D41 | EmptyState "compact variant" | `src/components/empty-state.tsx:3-36` has `headingAs` (`:12`) and a fixed `min-h-[60vh]` (`:18`) | Add an optional `size="compact"` that only changes the outer min-height; keep the halo and icon box (DESIGN-SYSTEM §4.3) and the default unchanged |
| D42 | DESIGN-SYSTEM references | §4.2 top bar `.planning/DESIGN-SYSTEM.md:123-133` (title is `<p>`, page owns one `<h1>`), §4.3 empty state `:135-153`, §4.4 auth pages `:155-167`, §8 rules `:230-243`, §9 checklist `:245-256`; Phase 9 migration note `:258` (`BrandMark`) | Use these anchors. Auth pages render only a `Card`; `src/app/(auth)/layout.tsx:1-12` wraps them |
| D43 | Bell polling | Polling analog `src/app/(app)/kb/proposals/proposal-list-refresh.tsx:36-37` (`setInterval` + cleanup, interval constant from a contract module) | Copy; keep the interval constant in `src/lib/notifications/`. JSON GET analog section 2.7 |

---

## 1. File Classification

"Match": exact = same role and data flow; role = same role; flow = same data flow; partial = one aspect only.

### 10-01 Schema, audit, org lock (wave 1)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `prisma/schema.prisma` (5 models, `member` unique, `invitation.tokenHash`) | model | CRUD | `TicketAuditEvent` `:692-707`; `TeamMember` `:1076-1088` (composite unique + org index) | exact |
| `prisma/migrations/<after 20261114100000>_team_foundation/migration.sql` (D24) | migration | n/a | `20261108140000_inbox/migration.sql:95-106` (append-only); duplicate-abort `DO $$ … RAISE EXCEPTION` style `20261110100000_ticket_states/migration.sql:132-157` | exact |
| `src/lib/scoped-db.ts` | config | n/a | itself `:14-57` | exact |
| `src/lib/team/member-audit.ts` (see D28 on the folder name) | service | CRUD (append) | `src/lib/tickets/ticket-audit.ts:43-62` (`recordTicketAudit(tx, …)`) | exact |
| `src/lib/team/team-errors.ts` | utility | n/a | `src/lib/tickets/ticket-state-admin.ts:53-80` (code union + `Error` class + `{ ok: false, error }`) | exact |
| `src/lib/team/org-lock.ts` | utility | request-response (row lock) | `shareLockActiveMembership` `src/lib/membership.ts:122-136` (raw `$queryRaw` lock in caller's tx) | role |
| ~~`tests/support/lock-barrier.ts`~~ | | | replaced by `tests/support/lock-wait.ts` + `project-race.ts` (D33) | n/a |
| `tests/integration/team-schema.test.ts` | test | CRUD | `tests/integration/audit-append-only.test.ts`; `workspace-isolation.test.ts:1-45` | exact |
| `tests/integration/authz-conservative-membership.test.ts` and the five other duplicate-row tests (D7) | test | CRUD | themselves | exact |

### 10-02 Membership gate and inventory (wave 1)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/membership.ts` (extend, D4) | utility | request-response | itself | exact |
| `src/lib/fresh-session.ts` (new, D3) | utility | request-response | `src/lib/session.ts:12-14` | exact |
| `src/lib/session.ts` | utility | request-response | itself `:38-58` | exact |
| `src/lib/authz.ts` | utility | request-response | itself `:34-68` | exact |
| `src/app/(app)/layout.tsx` | component (layout) | request-response | itself `:11-28` (no-workspace fallback) | exact |
| `src/app/(auth)/no-access/page.tsx`, `sign-out-button.tsx` | component (page) | n/a | `src/app/(auth)/login/page.tsx` + `login-form.tsx` (Card on auth layout); sign-out via `authClient` in `src/components/user-menu.tsx` | role |
| `src/app/api/attachments/[id]/route.ts` | controller | file-I/O | itself `:8-36` | exact |
| `src/app/api/tickets/[id]/messages/route.ts` | controller | request-response | itself `:22-41` | exact |
| 18 `(app)` pages (D36; plan lists 13) | component (page) | request-response | `src/app/(app)/tickets/[id]/page.tsx:42` (access-ended state) | exact |
| `src/app/(app)/tickets/ticket-list-panel.tsx` | component | request-response | itself `:134` | exact |
| `src/app/api/palette/tickets/route.ts`, `src/app/api/tickets/picker/route.ts` (D37, inventory only) | controller | request-response | themselves | exact |
| `tests/unit/membership-inventory.test.ts` | test | file-I/O (static scan) | `tests/unit/project-schema-parity.test.ts`; `tests/unit/proxy-matcher.test.ts` | role |
| `tests/integration/membership-gate.test.ts` | test | request-response | `tests/integration/authz-conservative-membership.test.ts:13-30` (`vi.mock("@/lib/session")`, real member rows) | exact |
| `tests/e2e/single-h1.spec.ts` (D36) | test | e2e | itself `:44-71`, `:578` | exact |

### 10-03 Member administration (wave 2)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/team/member-admin.ts` | service | CRUD (locked tx) | `src/lib/tickets/ticket-state-admin.ts:202-209` (membership, role, then work) + `src/lib/projects/members.ts:280-290` (member delete in tx) | exact |
| `tests/integration/team-member-admin.test.ts` | test | CRUD + race | `tests/integration/project-members-teams.test.ts` + `tests/support/lock-wait.ts:50-70` | exact |

### 10-04 Notification core (wave 2)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/notifications/types.ts` | utility | n/a | `src/lib/projects/contract.ts` (constants, unions; relative imports) | role |
| `src/lib/notifications/emit.ts` | service | event-driven (in caller's tx) | `src/lib/tickets/ticket-audit.ts:62` (write through the caller's `tx`) | flow |
| `src/lib/notifications/store.ts` | service | CRUD | `src/lib/saved-views/service.ts` (viewer-scoped reads, membership first) | role |
| `src/lib/notifications/preferences.ts` | service | CRUD | `src/lib/tickets/auto-close-settings.ts` (per-org setting with default when missing) | role |
| `tests/integration/notifications-core.test.ts` | test | CRUD | `tests/integration/workspace-isolation.test.ts:1-45`; `project-members-isolation.test.ts` | exact |

### 10-05 Invitations core (wave 2)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/app-url.ts` | utility | transform | `src/lib/db-url.ts` (pure env read/validation, boot-safe) | role |
| `src/lib/team/invite-token.ts` | utility | transform | `src/lib/tickets/status-token.ts:7-9` (`randomBytes(24).toString("base64url")`); hash like `hashIp` in `check-rate-limit.ts` | exact |
| `src/lib/team/invitations.ts` | service | CRUD (locked tx) | `ticket-state-admin.ts` result contract + `org-lock.ts` | role |
| `src/lib/team/invite-email.ts` | service | request-response (SMTP) | `src/lib/channels/email/compose-outbound.ts` + `smtp-client.ts:21-31` | exact |
| `tests/support/fake-smtp.ts` | test helper | streaming (socket) | `tests/unit/connection-test-probes.test.ts:39-71` (`net.createServer`) | partial |
| `tests/unit/app-url.test.ts` | test | transform | `tests/unit/db-url.test.ts` | exact |
| `tests/integration/invitations.test.ts` | test | CRUD + race | `tests/integration/project-members-teams.test.ts` + `lock-wait.ts` | role |

### 10-06 Emitters (wave 3), rewritten by D15 to D18

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| ~~`src/lib/tickets/assign-ticket.ts`~~ | | | dropped (D15): emit in `src/lib/tickets/mutations.ts:372-381` | n/a |
| `src/lib/tickets/mutations.ts` (new to the list) | service | CRUD (locked tx) | itself | exact |
| `src/app/(app)/tickets/[id]/actions.ts` | controller (action) | request-response | itself `:189-213` (no change expected) | exact |
| `src/lib/channels/email/ingest-message.ts` | service | event-driven | itself `:194-259` | exact |
| `src/app/api/public/status/[token]/follow-up/route.ts` | controller | request-response | itself `:119-158` | exact |
| `src/app/api/public/intake/route.ts` (new to the list, D18) | controller | request-response | itself `:108` | exact |
| `src/lib/tickets/create-ticket.ts` (new to the list, D18) | service | CRUD | itself | exact |
| `src/lib/worker/jobs/sla-flag.ts` | service (job) | batch | itself `:62-166` | exact |
| `tests/integration/notification-emitters.test.ts` | test | event-driven | `tests/integration/email-ingest.test.ts`, `merge-reply-race.test.ts` | role |
| `tests/integration/sla-flag-handler.test.ts` | test | batch | itself | exact |
| Phase 12.1 race suites (re-run, D16) | test | race | `tests/integration/merge-race-coverage.test.ts` | exact |

### 10-07 Mentions server (wave 3)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/mentions/mentions.ts` | service | transform + CRUD | `activeOrgUserIds` `src/lib/projects/members.ts:66-77` (one query validates many user ids as org members) | role |
| `src/lib/markdown/render.ts` | utility | transform | itself `:53` (`renderMarkdown`), `:154`, `:204` | exact |
| `src/app/api/tickets/[id]/messages/route.ts` | controller | request-response | itself `:52-140` | exact |
| `tests/unit/markdown-render.test.ts` | test | transform | itself | exact |
| `tests/integration/mentions.test.ts` | test | CRUD | `tests/integration/email-outbound-merge.test.ts:44-80` (fake transport records the outbound body) | role |

### 10-08 Invite page and onboarding (wave 3)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/(auth)/invite/[token]/page.tsx` | component (page) | request-response | `src/app/(auth)/login/page.tsx`; token page `src/app/(public)/status/[token]/page.tsx` | role |
| `src/app/(auth)/invite/[token]/actions.ts` | controller (action) | request-response | `src/app/(auth)/setup/actions.ts:32-91` | exact |
| `src/app/(auth)/invite/[token]/invite-card.tsx` | component | request-response | `src/app/(auth)/login/login-form.tsx` | exact |
| `src/lib/team/invite-onboarding.ts` | service | CRUD | `setup/actions.ts:49-81` (sign-up + org work, result type) | role |
| `src/lib/rate-limit/public-limits.ts` (new to the list, D11) | config | n/a | itself `:7-17` | exact |
| `src/proxy.ts` comment `:24-28` (D14) | config | n/a | itself | exact |
| `tests/unit/membership-inventory.test.ts` | test | file-I/O | (10-02) | exact |
| `tests/integration/invite-onboarding.test.ts` | test | request-response | `tests/integration/auth-setup.test.ts`, `setup-seed-lock.test.ts` | exact |
| `tests/unit/invite-no-log.test.ts` | test | file-I/O (static) | `tests/unit/proxy-matcher.test.ts` (static read of source) | role |

### 10-09 Digest (wave 3)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/notifications/digest.ts` | service | batch (claim, send, stamp) | `sweepProjectFileCleanup` `src/lib/projects/file-cleanup.ts:149-219` (`FOR UPDATE SKIP LOCKED` batch) + `email-outbound-send.ts` (send then record) | role |
| `src/lib/notifications/digest-config.ts` | config | transform | `src/lib/projects/contract.ts:324-332` (`*_CRON`, `*_QUEUE`, tx options) | exact |
| `src/lib/worker/jobs/notification-digest.ts` | service (job) | batch | `src/lib/worker/jobs/project-file-cleanup.ts:14-16` | exact |
| `src/lib/worker/index.ts` | config (registry) | event-driven | itself `:150-157` | exact |
| `docker-compose.yml` (worker URL env, D31) | config | n/a | itself `:70-72`, worker `:113-130` | exact |
| `.env.example` | config | n/a | itself `:2-5` | exact |
| `docs/OPERATIONS.md` | docs | n/a | itself, "Environment variable reference" `:561` | exact |
| `docs/SECURITY.md` (D38, blocked by 08-o4) | docs | n/a | itself `:5-12` | exact |
| `tests/integration/egress-fixtures/probe.ts` | test helper | n/a | itself | exact |
| `tests/unit/digest-config.test.ts` | test | transform | `tests/unit/db-url.test.ts` | role |
| `tests/integration/notification-digest.test.ts` | test | batch + race | `tests/integration/project-file-cleanup.test.ts` + `lock-wait.ts` | exact |

### 10-10 Team settings UI (wave 3)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/(app)/settings/settings-nav.tsx` | component | n/a | itself `:7-16` | exact |
| `src/app/(app)/settings/team/page.tsx` | component (page) | request-response | `src/app/(app)/settings/statuses/page.tsx` (52 lines) | exact |
| `src/app/(app)/settings/team/actions.ts` | controller (action) | request-response | `src/app/(app)/settings/statuses/actions.ts:1-62` | exact |
| `team-member-row.tsx`, `pending-invitation-list.tsx` | component | request-response | `src/app/(app)/settings/statuses/status-manager.tsx` | role |
| `deactivate-dialog.tsx` | component | request-response | `src/app/(app)/settings/statuses/delete-status-dialog.tsx` (replacement select + destructive confirm) | exact |
| `invite-dialog.tsx` | component | request-response | `src/app/(app)/settings/statuses/status-form-dialog.tsx`; `settings/tags/tag-manager.tsx` (UI-SPEC's named shape) | exact |

### 10-11 Bell and preferences (wave 4)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/notifications/format.ts` | utility | transform | `src/lib/tickets/activity-copy.ts` (event row to copy) + `src/lib/format-relative-time.ts` | role |
| `src/app/api/notifications/route.ts` | controller | request-response | `src/app/api/palette/tickets/route.ts:1-31` | exact |
| `src/components/notification-bell.tsx` | component | request-response (polling) | `src/components/command-palette.tsx` (client popover + fetch) + `proposal-list-refresh.tsx:36-37` | role |
| `src/components/top-bar.tsx` | component | n/a | itself `:45-68` | exact |
| `src/components/empty-state.tsx` | component | n/a | itself (D41) | exact |
| `src/app/(app)/settings/notifications/page.tsx`, `actions.ts`, `notification-preferences-form.tsx` | page / action / component | CRUD | `src/app/(app)/settings/sla/auto-close-form.tsx` + `settings/statuses/actions.ts` | role |
| `src/lib/navigation/page-title.ts` (only if a new top-level route; Settings children already map to "Settings") | utility | n/a | itself `:5-10` | exact |
| `tests/unit/notification-format.test.ts` | test | transform | `tests/unit/` copy tests for `activity-copy` | role |

### 10-12 Mention composer (wave 4)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/mentions/composer-tokens.ts` | utility | transform | none (pure text-span logic) | none |
| `tests/unit/mention-tokens.test.ts` | test | transform | pure unit test style of `tests/unit/markdown-render.test.ts` | role |
| `src/app/api/members/mentionable/route.ts` | controller | request-response | `src/app/api/tickets/picker/route.ts:18-40` | exact |
| `src/components/tickets/mention-autocomplete.tsx` | component | request-response | `src/components/tickets/ticket-picker.tsx` (Command list + fetch + access-ended copy `:194`) | exact |
| `src/components/tickets/composer.tsx` | component | request-response | itself `:24-143` (D23) | exact |
| `tests/integration/mention-mode-switch.test.ts` | test | request-response | `tests/integration/email-outbound-merge.test.ts` | role |

### 10-13 E2E (wave 5)

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `tests/e2e/support/team.ts` | test helper | CRUD | `tests/e2e/support/db.ts:1-24` (import `test-env` first) | exact |
| `tests/e2e/team-invitations.spec.ts`, `team-deactivation.spec.ts`, `notifications-bell.spec.ts`, `mentions-leak.spec.ts` | test | e2e | `tests/e2e/authz.spec.ts`, `tests/e2e/public-status.spec.ts`, `tests/e2e/single-h1.spec.ts:44-71` (extra storage states) | exact |
| `tests/e2e/csp.spec.ts`, `tests/e2e/single-h1.spec.ts` (new to the list, D10, D36) | test | e2e | themselves | exact |

### 10-14 Gate, 10-15 Proxy, 10-16 Status token

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `.planning/phases/10-team/10-GATE.md` | docs | n/a | `.planning/phases/08-security-hardening/08-GATE-A.md` | exact |
| `README.md` (`:122`), `docs/OPERATIONS.md` | docs | n/a | themselves | exact |
| `src/proxy.ts` | middleware | request-response | itself `:6-14`, `:32`, `:110-125` | exact |
| `src/lib/security/csp.ts` (new to the list, D9) | config | n/a | itself `:25` | exact |
| `tests/unit/proxy.test.ts` | test | request-response | itself `:1-20` (stub `TRUSTED_PROXY_HOPS`) | exact |
| `tests/unit/better-auth-routes.test.ts` | test | file-I/O | `tests/unit/csp-style-hashes.test.ts` (reads the installed package) | role |
| `src/lib/tickets/status-token-lookup.ts` (or extend `status-page-data.ts`, D20) | service | request-response | `src/lib/tickets/status-page-data.ts:77-160` | exact |
| `src/app/(public)/status/[token]/page.tsx`, `csat/route.ts`, `follow-up/route.ts`, `attachments/[id]/route.ts` | controller / page | request-response | themselves | exact |
| `tests/integration/status-token.test.ts` | test | request-response | `tests/integration/status-read-snapshot.test.ts` | exact |

---

## 2. Pattern Assignments

### 2.1 Append-only audit model and migration (10-01)

**Analog:** `prisma/migrations/20261108140000_inbox/migration.sql:95-106`

```sql
CREATE OR REPLACE FUNCTION aida_ticket_audit_event_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'TicketAuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_ticket_audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "TicketAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION aida_ticket_audit_event_immutable();
```

Model shape: `prisma/schema.prisma:692-707` (`id @default(cuid())`, `organizationId` + `organization @relation(… onDelete: Cascade)`, `actorUserId String?` with no user relation, `createdAt @default(now())`, `@@index([organizationId, …])`). Composite unique on a Better Auth table: write it in SQL as `CREATE UNIQUE INDEX "member_organizationId_userId_key" ON "member"("organizationId","userId")` after a `DO $$` block that counts duplicates and `RAISE EXCEPTION` with the count (style of `20261110100000_ticket_states/migration.sql:132-157`), and mirror it in Prisma as `@@unique([organizationId, userId])`.

Writer: `recordTicketAudit(tx, …)` `src/lib/tickets/ticket-audit.ts:43-62` takes the caller's transaction client; `member-audit.ts` follows it.

### 2.2 Error and result contract (10-01 `team-errors.ts`, 10-03, 10-05)

**Analog:** `src/lib/tickets/ticket-state-admin.ts:53-80`, `:202-209`

```ts
export type StateAdminErrorCode = … | "NOT_ALLOWED" | "MEMBERSHIP_ENDED";
export class StateAdminError extends Error { … }
export type StateAdminFailure = { ok: false; error: StateAdminErrorCode };
…
return await client.$transaction(async (tx) => {
  const membership = await findActiveMembership(tx, actor?.userId, actor?.orgId);
  if (!membership) throw new StateAdminError("MEMBERSHIP_ENDED");
  if (!isAdminRole(membership.role)) throw new StateAdminError("NOT_ALLOWED");
```

The service throws its typed error inside the transaction (rollback), catches it outside and returns `{ ok: false, error }`; the server action returns the result unchanged and never throws a refusal (`settings/statuses/actions.ts:18-23`). Phase 10 uses `findConservativeMembership` (or the lock form) for the actor, since that is the current rule for new paths (K59). Hooks object for tests: `StateAdminHooks` `:83` and `TicketMutationHooks` `mutations.ts:119-127` (`onTransactionStart`, `afterItem`, `clock`).

### 2.3 Locks inside a transaction (10-01 `org-lock.ts`, 10-03, 10-05)

**Analog:** `src/lib/membership.ts:122-136`

```ts
const rows = await client.$queryRaw<ActiveMembership[]>`
  SELECT "id", "role"
  FROM "member"
  WHERE "userId" = ${userId} AND "organizationId" = ${orgId}
  ORDER BY "id"
  FOR SHARE
`;
```

`lockOrganization(tx, orgId)` = `SELECT id FROM "organization" WHERE id = ${orgId} FOR UPDATE` in the same structural-client style (`MembershipLockClient` `:97-99`). Lock order for team admin and invitations: organization row, then member rows. For assignment use the `FOR SHARE` read of the assignee instead (D16).

### 2.4 Concurrency tests (10-01, 10-03, 10-05, 10-06, 10-09)

**Analog:** `tests/support/lock-wait.ts:37-70`, `tests/support/project-race.ts:14-104`

```ts
export async function backendPid(tx: RawQueryClient): Promise<number> { … pg_backend_pid() … }
export async function waitForBlockedBy(observer, holderPid, waiterPids …) {
  // SELECT pid FROM pg_stat_activity
  // WHERE pid = ANY(${wanted}::int[]) AND ${holderPid}::int = ANY(pg_blocking_pids(pid))
```

Shape: transaction A takes the lock and records its PID through a hook (`onTransactionStart`/`afterLock`), awaits a `deferred()`; transaction B starts; the observer client (`createObserverClient`) calls `waitForBlockedBy(observer, pidA, [pidB])`; then A is released. Assert with `settleAll` and `assertNoDeadlock`. Each test asserts the error code the check order produces (R2-4).

### 2.5 Membership gate (10-02)

**Analogs:** `src/lib/authz.ts:34-40`, `src/lib/session.ts:38-58`, `src/app/(app)/tickets/[id]/page.tsx:42`

```ts
export async function getActiveOrgAccess(): Promise<ActiveOrgAccess> {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId ?? null;
  if (!orgId) return { session, orgId: null, role: null };
  const member = await findConservativeMembership(prisma, session.user.id, orgId);
  return { session, orgId, role: member?.role ?? null };
}
```

`getScopedDb` and `getSessionActor` gain the same membership read (one session read, K141). The page variant catches the access error and either redirects to `/no-access` or renders the existing access-ended `EmptyState headingAs="h1"` (decide per D36). Route variant: 403 `{ error: "MEMBERSHIP_ENDED" }` (`messages/route.ts:40-41`); attachment route 404 (`attachments/[id]/route.ts:23-25` shape). Session for routes: read from `request.headers` like `palette/tickets/route.ts:18`.

Integration test of the gate: `tests/integration/authz-conservative-membership.test.ts:13-30` (mock only `requireSession`, keep real member rows).

### 2.6 Server action under a lock with a redirect after commit (10-08)

**Analog:** `src/app/(auth)/setup/actions.ts:32-91`

```ts
const parsed = setupSchema.safeParse(input);
if (!parsed.success) { return { error: parsed.error.issues[0]?.message ?? "…" }; }
…
result = await withTenantSeedLock(async (tx): Promise<SetupResult> => { … auth.api.signUpEmail({ body: { name, email, password } }) … }, OPTIONS);
…
if (result) return result;
// Outside the lock: redirect() throws, and the transaction must commit first.
redirect("/login?setup=complete");
```

Invite accept: zod parse, rate limit (D11), fresh session (D3), then the locked accept in `src/lib/team/invitations.ts`, then `redirect` outside. Do not take the tenant seed lock (D14). Sign-up uses `auth.api.signUpEmail` in process (the proxy blocks only the HTTP route, `proxy.ts:32`).

### 2.7 Authenticated JSON GET (10-11 notifications, 10-12 mentionable)

**Analog:** `src/app/api/palette/tickets/route.ts:15-31`

```ts
const NO_STORE = { "Cache-Control": "no-store" } as const;
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "no_workspace" }, { status: 403, headers: NO_STORE });
  const result = await service(prisma, { userId: session.user.id, orgId }, …);
  if (!result.ok) return NextResponse.json({ error: "membership_ended" }, { status: 403, headers: NO_STORE });
```

Writes (mark read, archive) go through server actions with the 2.2 contract, or a POST in the same file with the same checks.

### 2.8 Public token route with rate limit (10-08 if a route handler, 10-16)

**Analog:** `src/app/api/public/status/[token]/follow-up/route.ts:32-66`

```ts
const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.followUp;
const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
// bearer-token flow, bare prisma, never scopedDb
const ticket = await prisma.ticket.findUnique({ where: { statusToken: token }, select: { … } });
if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
const body = await readBoundedFormData(request, MAX_REQUEST_BODY_BYTES, { maxParts: … });
```

Invitation lookup = hash the URL token and look up `invitation.tokenHash`; the failure message is the same for unknown, expired, revoked and mismatched-email (D-03).

### 2.9 Emitting inside existing transactions (10-06, 10-07)

- Assignment: `src/lib/tickets/mutations.ts:372-381` (`case "assign"`), the emit call after `updateTicket`, using `tx`.
- Email append: `src/lib/channels/email/ingest-message.ts:214-243`, after `tx.message.create`, recipient from the EFFECTIVE ticket `ticketIdToUpdate` (`:202`).
- Follow-up: `follow-up/route.ts:130-158`, after `tx.message.create`, ticket `effectiveTicketId` (`:122`).
- SLA: `sla-flag.ts:153-166` `runPass`; change `updateBreach`/`updateAtRisk` (`:83-104`, `:127-150`) from `$executeRaw` to `$queryRaw<{ id; organizationId; assigneeId }[]>` with `RETURNING`.
- Mentions: `messages/route.ts:131-140`, after `message.create`, only for `INTERNAL`.

`emit.ts` uses `INSERT … ON CONFLICT ("organizationId","recipientUserId","type","eventKey") DO NOTHING` through `tx.$executeRaw` with explicit organization and recipient terms (C10 ledger), relative imports only (`sla-flag.ts:2`). Validating many recipients at once: `activeOrgUserIds` `src/lib/projects/members.ts:66-77`.

### 2.10 Batch claim for the digest (10-09)

**Analogs:** `src/lib/projects/file-cleanup.ts:149-219` (claim with `FOR UPDATE SKIP LOCKED` in one transaction, db clock, bounded batch), `src/lib/worker/index.ts:150-157`

```ts
await boss.createQueue(PROJECT_FILE_CLEANUP_QUEUE, { policy: "singleton" });
await boss.work(PROJECT_FILE_CLEANUP_QUEUE, async (jobs: Job[]) => { await projectFileCleanupHandler(jobs); });
await boss.schedule(PROJECT_FILE_CLEANUP_QUEUE, PROJECT_FILE_CLEANUP_CRON, {});
```

Transport: `createSmtpTransport(settings, { timeoutMs })` (`smtp-client.ts:21-31`); settings and decryption as in `email-outbound-send.ts`. Success = resolved `sendMail` (R2-5).

### 2.11 Settings page, actions and dialogs (10-10, 10-11)

**Analog:** `src/app/(app)/settings/statuses/` (page 52 lines, actions `:1-62`, `delete-status-dialog.tsx`, `status-form-dialog.tsx`, `status-manager.tsx`)

```ts
"use server";
export async function createStatusAction(raw: unknown): Promise<TicketStateWriteResult> {
  const actor = await getSessionActor();
  const result = await createTicketState(prisma, actor, raw);
  if (result.ok) revalidateStatusPaths();
  return result;
}
```

Page header markup: `src/app/(app)/settings/backups/page.tsx:52-58` (`<h1 className="text-[18px] font-semibold">`, subtitle `text-[13px] text-muted-foreground`); role read for display `getOrgRole()` + `isAdminRole` (`:42-44`). Access-ended copy string: "Your access to this workspace has ended. Sign out, then sign in again." (`src/lib/tickets/state-copy.ts:60`).

### 2.12 Bell (10-11)

**Analogs:** `src/components/top-bar.tsx:45-68` (cluster), `src/app/(app)/kb/proposals/proposal-list-refresh.tsx:36-37`

```ts
const timer = setInterval(() => router.refresh(), PROPOSAL_POLL_INTERVAL_MS);
return () => clearInterval(timer);
```

The bell polls its own GET (2.7) with `fetch` instead of `router.refresh()`. Popover from `@/components/ui/popover`, count pill `Badge`, empty state `EmptyState` compact (D41).

### 2.13 Mention autocomplete (10-12)

**Analog:** `src/components/tickets/ticket-picker.tsx` (Command list over a fetched JSON list, loading and access-ended states, `:194`). Composer integration points: `composer.tsx:26` (`mode` state), `:45-52` (`focusComposer`), `:80-87` (draft insertion), `:117-124` (FormData send: add `mentions` only when `mode === "internal"`).

### 2.14 E2E specs (10-13)

**Analogs:** `tests/e2e/single-h1.spec.ts:44-71` (extra storage states per role, own passwords), `tests/e2e/support/db.ts:1-24` (import `./test-env` first so `DATABASE_URL` is set before `@/lib/db`), `tests/e2e/support/fixtures.ts:8` (`resetRateLimit`). New users are created in-process through `auth.api.signUpEmail` with `BETTER_AUTH_SECRET` set (`global-setup.ts:190-196` pattern) or through the UI.

---

## 3. Shared Patterns

### 3.1 Relative imports in worker-reachable modules
**Source:** `src/lib/membership.ts:6`, `src/lib/worker/jobs/sla-flag.ts:2`, `src/lib/channels/email/smtp-client.ts:3-5`, `src/lib/tenant-seed-lock.ts:16`
**Apply to:** `src/lib/notifications/*`, `src/lib/team/*` (or renamed folder), `src/lib/mentions/mentions.ts`, `src/lib/app-url.ts`, `digest*.ts`. No `@/`, no `next/*` import.

### 3.2 Explicit organization terms
**Source:** `src/lib/scoped-db.ts:3-13` and `src/lib/projects/access.ts:19-20` ("scopedDb does not scope raw SQL, findUnique, aggregate or nested filters: every statement here writes the organization term itself")
**Apply to:** every raw SQL statement and every `member`/`invitation`/`session` query (Better Auth models are outside `DOMAIN_MODELS`).

### 3.3 Membership read rule
**Source:** `src/lib/membership.ts:66-91` (conservative read for new paths), `:101-136` (lock form)
**Apply to:** every Phase 10 actor and recipient check. Read inside the transaction that writes; re-read after a lock.

### 3.4 Security headers and public prefixes
**Source:** `src/proxy.ts:46-68`, `src/lib/security/csp.ts:25`, `:73-80`
**Apply to:** `/invite` (prefix + no-referrer list), `/no-access` (not public; protected path). Never build a response that skips `withSecurityHeaders`.

### 3.5 Rate limits on public entry points
**Source:** `src/lib/rate-limit/public-limits.ts:7-27`, `follow-up/route.ts:37-41`
**Apply to:** invite view and accept, invitee sign-up.

### 3.6 Rule-J Docker test resources
**Source:** `tests/support/docker-test-labels.ts:13-16` (`aida.test`, `aida.test.run`, prefix `aida-test-`, `AIDA_TEST_RUN_ID`), `tests/support/docker-test-resources.ts:14-41` (`startLabeledPostgres`, image `pgvector/pgvector:pg16`), `tests/support/docker-test-preflight.ts:18` (20 GiB), `tests/integration/global-setup.ts:12-30` (one labelled container per run, all migrations applied), `vitest.integration.config.ts:8-12` (egress excluded, `fileParallelism: false`), `tests/support/migration-harness.ts:28-74` (migration container, `applyMigrations`)
**Apply to:** every integration test and the dev migration (D25). Seed with unique slugs; reuse `seedOrgWithMembers` (`tests/support/inbox-fixtures.ts:72`), `addOrgMember`/`removeOrgMember` (`tests/support/project-fixtures.ts:46`, `:71`).

### 3.7 E2E fault states
**Source:** `src/lib/testing/e2e-fault.ts:23-31`, used as `await e2eFault("settings-backups-page")` (`settings/backups/page.tsx:41`)
**Apply to:** new pages only if `single-h1.spec.ts` must render their error or loading state; add the point to the list.

### 3.8 Design-system tokens
**Source:** `.planning/DESIGN-SYSTEM.md:123-167`, `:230-256`; `src/components/empty-state.tsx`; `src/app/(auth)/layout.tsx:1-12`
**Apply to:** every UI file. `text-[Npx]` only, tokens only, one `<h1>` per page inside `<main>`, auth pages render only a `Card`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `tests/support/fake-smtp.ts` | test helper | streaming (SMTP socket) | No SMTP server double exists; only `vi.mock` of `smtp-client` and plain `net.createServer` probes. Hand-write a minimal SMTP dialogue on `node:net` with fault switches (D29) |
| `src/lib/mentions/composer-tokens.ts` | utility | transform | No text-span tracking exists in the codebase; follow 10-12 and R2-1 directly |
| `src/lib/fresh-session.ts` (mechanism only) | utility | request-response | No caller uses `disableCookieCache` yet; the option is confirmed in the installed 1.7.20 types, behaviour needs its own test (D3) |
| `tests/unit/better-auth-routes.test.ts` (route enumeration) | test | file-I/O | Nothing reads the Better Auth route table today; `csp-style-hashes.test.ts` is the nearest "read the installed package" test |
| `src/app/(auth)/no-access/page.tsx` (if kept, D36) | page | n/a | The current access-ended behaviour is in-page, not a separate route |
| `NotificationDigest` lease semantics | service | batch | `ProjectFileCleanup` claims without a lease; the lease plus SMTP-outcome handling is new |
| Owner/admin fan-out with per-person opt-out (D19) | service | event-driven | No fan-out to role holders exists; build from `findConservativeMembership` semantics over all org members |
| `src/lib/team/invite-email.ts` subject/body without tenant data | service | transform | `compose-outbound.ts` composes customer mail with ticket content; the invite and digest mails must carry none |

---

## Metadata

**Analog search scope:** `src/lib/{auth,auth-client,session,authz,membership,scoped-db,tenant-seed-lock}.ts`, `src/proxy.ts`, `src/lib/security`, `src/lib/rate-limit`, `src/lib/http`, `src/lib/tickets`, `src/lib/channels/email`, `src/lib/worker`, `src/lib/projects`, `src/app/(app)`, `src/app/(auth)`, `src/app/(public)`, `src/app/api`, `src/components`, `prisma/schema.prisma`, `prisma/migrations`, `tests/support`, `tests/integration`, `tests/e2e`, `tests/unit`, `docker-compose.yml`, `.env.example`, `package.json`, `vitest.*.config.ts`, installed `node_modules/better-auth` (route strings and types only), `.planning/DESIGN-SYSTEM.md`, `.planning/run-loop/ANTREAN.md`
**Files scanned:** about 95
**Pattern extraction date:** 2026-11-13
