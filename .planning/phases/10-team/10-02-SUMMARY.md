---
phase: 10-team
plan: 02
subsystem: auth, membership gate, static inventory
status: complete
tags: [better-auth, session, cookie-cache, membership, authorization, typescript-parser, inventory]
requires:
  - "10-01: src/lib/workspace-members/member-rights.ts (readMemberRights, a membership reader the inventory recognises)"
provides:
  - "src/lib/fresh-session.ts: readFreshSession(requestHeaders), the only auth.api.getSession call (disableCookieCache)"
  - "src/lib/session.ts: getCurrentSession through readFreshSession; getScopedDb re-reads membership, throws AccessDeniedError, returns { db, session, orgId, role }"
  - "src/lib/membership.ts: AccessDeniedError (status 403); nothing else changed"
  - "src/lib/page-access.ts: requirePageAccess() redirecting to /no-access or /login"
  - "src/app/(auth)/no-access: the no-access page (UI-SPEC Surface 6, amendment A5) and its Sign out button"
  - "tests/support/source-inventory.ts: parser helpers and findViolations"
  - "tests/unit/membership-inventory.test.ts: Rules A, C, C2, D, the allowlist and the Rule E slot for 10-16"
  - "tests/integration/membership-gate.test.ts: 25 cases on Testcontainers"
affects: [10-15, 10-16, 10-17, 10-08, 10-11]
tech-stack:
  added: []
  patterns:
    - "One uncached session read (readFreshSession) behind every session helper and the two direct readers"
    - "AccessDeniedError mapped per surface: 403 in routes and actions, the missing-attachment 404 for attachments, a /no-access redirect for pages"
    - "Per-function static inventory with a {rule, file, function, reason} allowlist and hygiene checks"
key-files:
  created:
    - src/lib/fresh-session.ts
    - src/lib/page-access.ts
    - src/app/(auth)/no-access/page.tsx
    - src/app/(auth)/no-access/sign-out-button.tsx
    - tests/integration/membership-gate.test.ts
    - tests/support/source-inventory.ts
    - tests/unit/membership-inventory.test.ts
  modified:
    - src/lib/session.ts
    - src/lib/membership.ts
    - src/lib/authz.ts
    - src/app/api/attachments/[id]/route.ts
    - src/app/api/tickets/[id]/messages/route.ts
    - src/app/api/palette/tickets/route.ts
    - src/app/api/tickets/picker/route.ts
    - src/app/(app)/tickets/ticket-list-panel.tsx
decisions:
  - "No React cache memo on getCurrentSession: K141 call-count tests and the gate cases stay exact; V-23 allows a memo but does not need one"
  - "TicketListPanel reads the actor through getSessionActor instead of getScopedDb, so a removed member keeps its in-page membership-ended state until 10-17 (its loader checks membership)"
  - "Rule D treats a ScopedDb-typed parameter and the callback parameter of a scoped $transaction as bound from scopedDb(...)"
  - "The inventory follows server components rendered as JSX from src/app (TicketListPanel), in addition to the plan's default-exported (app) components"
metrics:
  duration: "about 18 minutes (2026-11-12T19:11Z to 19:29Z)"
  completed: 2026-11-13
  tasks: 3
  files: 15
estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 27000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: f3aaee1a8fc74bebe651162d435fa493ce47ebd5
---

# Phase 10 Plan 02: Fresh session read, membership-checked getScopedDb, page helper, /no-access and the per-function membership inventory Summary

Every session read now goes through `readFreshSession`, an uncached Better Auth read. `getScopedDb` re-reads the member rows on every call and throws `AccessDeniedError`, so a removed member gets no tenant client whatever the cookie holds. `requirePageAccess` and `/no-access` are in place for 10-17 to wire in. The messages route now answers 403 and the attachment route answers its missing-attachment 404. A TypeScript-parser inventory makes a skipped gate, a second session read or an unscoped worker write fail the unit suite.

## What was built

- **`src/lib/fresh-session.ts`**: `readFreshSession(requestHeaders)` returns `auth.api.getSession({ headers, query: { disableCookieCache: true } })`. It uses relative imports only (`./auth`) and no `next/*` import. It is the only `auth.api.getSession` call in `src` (acceptance grep after commit: `src/lib/fresh-session.ts:21` only).
- **`src/lib/session.ts`**: `getCurrentSession` returns `readFreshSession(await headers())`. `requireSession` keeps its `/login` redirect. `getScopedDb` reads the session once, throws `AccessDeniedError` when `activeOrganizationId` is null, reads `findConservativeMembership(prisma, userId, orgId)`, throws `AccessDeniedError` when that returns null, and returns `{ db, session, orgId, role }`. `getSessionActor` keeps its contract (no membership check), and its JSDoc now says so and names the inventory's rule.
- **`src/lib/membership.ts`**: adds only `class AccessDeniedError extends Error { readonly status = 403 }`. `git diff 5dc6890 -- src/lib/membership.ts` has 0 `^-export` lines, and the file still has no `next` or `@/` import.
- **Palette and picker routes**: `readFreshSession(request.headers)` replaces their direct getSession calls. Nothing else changed.
- **`/api/attachments/[id]`**: `AccessDeniedError` answers `404 { error: "not_found" }`, the same constant body the route uses for a missing attachment. The unauthenticated 401 is unchanged.
- **`src/lib/page-access.ts`**: `requirePageAccess()` reads the session once (fresh). It calls `redirect("/login")` without a session and `redirect("/no-access")` when there is no active organization or no member row (conservative read). It returns `{ session, orgId, role, db: scopedDb(orgId) }`. The JSDoc says to call it first and outside any `try` (C6).
- **`/no-access`** (`src/app/(auth)/no-access/page.tsx`): a server component that reads nothing. It renders only `Card w-full max-w-[400px] border-border/70 shadow-xl shadow-primary/5` (DS §4.4), one `<h1 className="text-[18px] font-semibold">` "You don't have access to this workspace", the 13px muted body of amendment A5, and a full-width default **Sign out** button. `sign-out-button.tsx` is a client component that calls `authClient.signOut()` (the same call as `user-menu.tsx`), then `router.push("/login")`, with the button disabled while the call runs. There is no workspace name and no inline script.
- **`src/lib/authz.ts`**: a doc line only. Every export and result is unchanged. Its session read was already through `requireSession`, which is now fresh.
- **Messages route**: the catch around `getScopedDb` answers `AccessDeniedError` with `{ error: "membership_ended" }` and status `err.status` (403). The 401 for no session and both existing membership checks (before and inside the transaction) are unchanged. The stale comment "getScopedDb does not check the member row" was corrected.
- **Inventory**: `tests/support/source-inventory.ts` (976 lines after formatting, `ts.createSourceFile`, no checker) and `tests/unit/membership-inventory.test.ts` (30 cases). See the sections below.

## Recorded cookie-cache behaviour (V-23, flagged assumption, D3)

I read this in the installed `node_modules/better-auth/dist/api/routes/session.mjs`, 1.7.20, lines 32 to 228:

- With `disableCookieCache: true`, `shouldUseCookieCache` is false (`:48`). The `session_data` cookie is never decoded or trusted. The session token cookie is verified (signed) and looked up in the database with `internalAdapter.findSession(token)` (`:160`).
- **Row missing or expired** (`:162-172`): `deleteSessionCookie(ctx)` expires `session_token`, `session_data` (with any chunks) and `dont_remember` with `Max-Age=0`, and the call returns `null`. An expired row is also deleted. The integration case "on a deleted row the fresh read expires the session token and the cached data cookies" proves this with `returnHeaders: true`: both names come back with `Max-Age=0`. In-process through `readFreshSession`, those Set-Cookie headers reach the browser only where `nextCookies` can write them (a server action or route handler). The deciding fact is the database lookup, not the cookie.
- **Row present**: the session is returned from the database row, and `setCookieCache` rewrites `session_data` from that row (`:222`), so the cached copy is refreshed and not trusted.
- **The cached read with the same cookies, after the row was deleted**, was made in the test and returned the **stale session**: same user id and the old `activeOrganizationId`. After `session.activeOrganizationId` was updated in the database, the fresh read returned the new organization and the cached read still returned the old one. Both are asserted in `tests/integration/membership-gate.test.ts`. This is why no AIDA path may read through the cookie cache.

## Per-function inventory (real tree, 101 entry functions)

Gate column: the gate the inventory found; "getSessionActor+membership service" means getSessionActor plus a src/lib function that reads membership. "ALLOWLIST" means the Rule A reason below applies. Paths are under `src/app/`.

| Entry | Function | Kind | Gate or exemption |
|---|---|---|---|
| `(app)/contacts/[id]/actions.ts` | saveContactNotes | server-action | getScopedDb |
| `(app)/contacts/[id]/page.tsx` | ContactDetailPage | page | getSessionActor+membership service |
| `(app)/contacts/page.tsx` | ContactsPage | page | getScopedDb |
| `(app)/insights/actions.ts` | generateInsightRun | server-action | getScopedDb |
| `(app)/insights/page.tsx` | InsightsPage | page | getScopedDb |
| `(app)/kb/[id]/page.tsx` | KbArticleDetailPage | page | getScopedDb |
| `(app)/kb/actions.ts` | createKbArticleAction | server-action | requireOrgAdminScope |
| `(app)/kb/actions.ts` | updateKbArticleAction | server-action | requireOrgAdminScope |
| `(app)/kb/new/page.tsx` | NewKbArticlePage | page | no tenant reach |
| `(app)/kb/page.tsx` | KbPage | page | getScopedDb |
| `(app)/kb/proposals/[id]/page.tsx` | ProposalReviewPage | page | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | loadStartSelectionAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | publishProposalAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | rejectProposalAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | requestProposalAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | restartGenerationAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | retryIndexingAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/actions.ts` | saveProposalAction | server-action | getSessionActor+membership service |
| `(app)/kb/proposals/page.tsx` | KbProposalsPage | page | getSessionActor+membership service |
| `(app)/layout.tsx` | AppLayout | layout | ALLOWLIST |
| `(app)/settings/actions.ts` | reembedAllKb | server-action | requireOrgAdminScope |
| `(app)/settings/actions.ts` | saveEmbeddingSettings | server-action | requireOrgAdminScope |
| `(app)/settings/actions.ts` | saveLlmSettings | server-action | requireOrgAdminScope |
| `(app)/settings/actions.ts` | setAiEnabled | server-action | requireOrgAdminScope |
| `(app)/settings/actions.ts` | testEmbeddingConnection | server-action | requireOrgAdminScope |
| `(app)/settings/actions.ts` | testLlmConnection | server-action | requireOrgAdminScope |
| `(app)/settings/backups/page.tsx` | BackupsSettingsPage | page | ALLOWLIST |
| `(app)/settings/branding/actions.ts` | saveBranding | server-action | requireOrgAdminScope |
| `(app)/settings/branding/page.tsx` | BrandingSettingsPage | page | getScopedDb |
| `(app)/settings/custom-fields/actions.ts` | createCustomField | server-action | requireOrgAdminScope |
| `(app)/settings/custom-fields/actions.ts` | deleteCustomField | server-action | requireOrgAdminScope |
| `(app)/settings/custom-fields/actions.ts` | updateCustomField | server-action | requireOrgAdminScope |
| `(app)/settings/custom-fields/page.tsx` | CustomFieldsPage | page | getScopedDb |
| `(app)/settings/email/actions.ts` | saveEmailSettings | server-action | requireOrgAdminScope |
| `(app)/settings/email/actions.ts` | setEmailChannelEnabled | server-action | requireOrgAdminScope |
| `(app)/settings/email/actions.ts` | testImapConnection | server-action | requireOrgAdminScope |
| `(app)/settings/email/actions.ts` | testSmtpConnection | server-action | requireOrgAdminScope |
| `(app)/settings/email/page.tsx` | EmailSettingsPage | page | getScopedDb |
| `(app)/settings/layout.tsx` | SettingsLayout | layout | no tenant reach |
| `(app)/settings/page.tsx` | SettingsPage | page | getScopedDb |
| `(app)/settings/sla/actions.ts` | saveAutoCloseSetting | server-action | getSessionActor+membership service |
| `(app)/settings/sla/actions.ts` | saveSlaTargets | server-action | requireOrgAdminScope |
| `(app)/settings/sla/page.tsx` | SlaPoliciesPage | page | getScopedDb |
| `(app)/settings/statuses/actions.ts` | createStatusAction | server-action | getSessionActor+membership service |
| `(app)/settings/statuses/actions.ts` | deleteStatusAction | server-action | getSessionActor+membership service |
| `(app)/settings/statuses/actions.ts` | moveStatusAction | server-action | getSessionActor+membership service |
| `(app)/settings/statuses/actions.ts` | setDefaultStatusAction | server-action | getSessionActor+membership service |
| `(app)/settings/statuses/actions.ts` | updateStatusAction | server-action | getSessionActor+membership service |
| `(app)/settings/statuses/page.tsx` | TicketStatusesSettingsPage | page | getSessionActor+membership service |
| `(app)/settings/tags/actions.ts` | deleteTag | server-action | requireOrgAdminScope |
| `(app)/settings/tags/actions.ts` | renameTag | server-action | requireOrgAdminScope |
| `(app)/settings/tags/page.tsx` | TagsPage | page | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | addTag | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/actions.ts` | assignTicket | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/actions.ts` | changePriority | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/actions.ts` | changeState | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/actions.ts` | generateDraftReply | server-action | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | removeTag | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/actions.ts` | rerunTriage | server-action | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | retryOutboundSend | server-action | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | setCustomFieldValue | server-action | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | setTriageCategory | server-action | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | setTriageLanguage | server-action | getScopedDb |
| `(app)/tickets/[id]/actions.ts` | setTriageSentiment | server-action | getScopedDb |
| `(app)/tickets/[id]/merge-actions.ts` | mergeTicketAction | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/page.tsx` | TicketDetailPage | page | getSessionActor+membership service |
| `(app)/tickets/[id]/relation-actions.ts` | addRelationAction | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/relation-actions.ts` | removeRelationAction | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/snooze-actions.ts` | snoozeTicketAction | server-action | getSessionActor+membership service |
| `(app)/tickets/[id]/snooze-actions.ts` | wakeTicketAction | server-action | getSessionActor+membership service |
| `(app)/tickets/bulk-actions.ts` | bulkUpdateTickets | server-action | getSessionActor+membership service |
| `(app)/tickets/layout.tsx` | TicketsLayout | layout | no tenant reach |
| `(app)/tickets/new-ticket-action.ts` | createTicketAction | server-action | getSessionActor+membership service |
| `(app)/tickets/page.tsx` | TicketsPage | page | getSessionActor+membership service (through the JSX-rendered TicketListPanel) |
| `(app)/tickets/saved-view-actions.ts` | createSavedViewAction | server-action | getSessionActor+membership service |
| `(app)/tickets/saved-view-actions.ts` | deleteSavedViewAction | server-action | getSessionActor+membership service |
| `(app)/tickets/saved-view-actions.ts` | updateSavedViewAction | server-action | getSessionActor+membership service |
| `(auth)/layout.tsx` | AuthLayout | layout | no tenant reach |
| `(auth)/login/page.tsx` | LoginPage | page | ALLOWLIST |
| `(auth)/no-access/page.tsx` | NoAccessPage | page | no tenant reach |
| `(auth)/setup/actions.ts` | completeSetup | server-action | ALLOWLIST |
| `(auth)/setup/page.tsx` | SetupPage | page | ALLOWLIST |
| `(public)/layout.tsx` | PublicLayout | layout | excluded, Rule E slot (plan 10-16) |
| `(public)/request/page.tsx` | RequestPage | page | excluded, Rule E slot (plan 10-16) |
| `(public)/status/[token]/page.tsx` | StatusPage | page | excluded, Rule E slot (plan 10-16) |
| `api/attachments/[id]/route.ts` | GET | route-handler | getScopedDb |
| `api/auth/[...all]/route.ts` | GET | route-handler | ALLOWLIST |
| `api/auth/[...all]/route.ts` | POST | route-handler | ALLOWLIST |
| `api/health/probe/route.ts` | GET | route-handler | ALLOWLIST |
| `api/health/route.ts` | GET | route-handler | ALLOWLIST |
| `api/palette/tickets/route.ts` | GET | route-handler | ALLOWLIST |
| `api/public/intake/route.ts` | POST | route-handler | excluded, Rule E slot (plan 10-16) |
| `api/public/logo/[orgId]/[version]/route.ts` | GET | route-handler | excluded, Rule E slot (plan 10-16) |
| `api/public/status/[token]/attachments/[id]/route.ts` | GET | route-handler | excluded, Rule E slot (plan 10-16) |
| `api/public/status/[token]/csat/route.ts` | POST | route-handler | excluded, Rule E slot (plan 10-16) |
| `api/public/status/[token]/follow-up/route.ts` | POST | route-handler | excluded, Rule E slot (plan 10-16) |
| `api/settings/branding/logo/route.ts` | DELETE | route-handler | getActiveOrgAccess |
| `api/settings/branding/logo/route.ts` | POST | route-handler | getActiveOrgAccess |
| `api/tickets/[id]/messages/route.ts` | POST | route-handler | getScopedDb |
| `api/tickets/picker/route.ts` | GET | route-handler | ALLOWLIST |
| `layout.tsx` | RootLayout | layout | no tenant reach |
| `page.tsx` | Home | page | no tenant reach |

## Allowlist (every entry, with its reason)

Each entry is `{ rule, file, function, reason }` in `tests/unit/membership-inventory.test.ts`. All 23 entries suppress at least one finding, and the hygiene check is empty.

**Rule A** (tenant reach with no gate):

| File | Function | Reason |
|---|---|---|
| `src/app/(app)/layout.tsx` | AppLayout | reads the organization name, branding, logo and saved views after requireSession only; the saved views service checks membership; plan 10-17 puts requirePageAccess first (V-27) |
| `src/app/(app)/settings/backups/page.tsx` | BackupsSettingsPage | reads only the instance-wide SystemSetting backup record, and only when getOrgRole (a conservative member read) is owner or admin, so a non-member reads nothing; plan 10-17 puts requirePageAccess first (V-27) |
| `src/app/(auth)/login/page.tsx` | LoginPage | pre-authentication: counts users to send an empty install to /setup; reads no tenant row |
| `src/app/(auth)/setup/page.tsx` | SetupPage | pre-authentication: counts users to send a set-up install to /login; reads no tenant row |
| `src/app/(auth)/setup/actions.ts` | completeSetup | creates the first owner and organization under the tenant seed lock, only while no user exists; there is no session or membership yet |
| `src/app/api/auth/[...all]/route.ts` | GET | Better Auth's own HTTP handler (sign-in, sign-out, session); its organization and admin routes are blocked in src/proxy.ts (V-03, plan 10-15) |
| `src/app/api/auth/[...all]/route.ts` | POST | same as GET |
| `src/app/api/health/route.ts` | GET | health check: a database ping and the instance-wide worker heartbeat; reads no tenant row |
| `src/app/api/health/probe/route.ts` | GET | container health probe: the same instance-wide snapshot; reads no tenant row |
| `src/app/api/palette/tickets/route.ts` | GET | reads the session through readFreshSession and passes the actor to searchTicketsForPalette, whose service checks membership before it searches (V-05) |
| `src/app/api/tickets/picker/route.ts` | GET | reads the session through readFreshSession and passes the actor to searchTicketsForPicker, whose service checks membership before it searches (V-05) |

**Rule C** (session readers outside the gates and `auth.api.` calls):

| File | Function | Reason |
|---|---|---|
| `src/app/(app)/layout.tsx` | AppLayout | requireSession only, before the layout's organization reads; plan 10-17 puts requirePageAccess first (V-27) |
| `src/app/api/palette/tickets/route.ts` | GET | readFreshSession from the request headers (a route has no Next request scope); its service checks membership (V-05) |
| `src/app/api/tickets/picker/route.ts` | GET | readFreshSession from the request headers (a route has no Next request scope); its service checks membership (V-05) |
| `src/app/(auth)/setup/actions.ts` | completeSetup | in-process auth.api.signUpEmail and createOrganization create the first owner under the tenant seed lock while no user exists |
| `src/lib/bootstrap.ts` | createFirstOrgAndAdmin | boot-time bootstrap from the environment: in-process sign-up and organization creation under the tenant seed lock on an empty install |
| `src/lib/demo/identities.ts` | createDemoIdentities | DEMO_MODE seed: in-process sign-up of the demo agent behind the demo guard; never runs on a real install |

`auth.api.getSession` has a fixed home, `src/lib/fresh-session.ts#readFreshSession`. It is never allowlisted anywhere else: a fixture proves that an allowlist entry for another function does not suppress it.

**Rule C2** (more than one session read in one action or route): **no entry. The real tree has no pre-existing C2 violation**, so the pre-existing list is empty. The suite fails when a C2 entry names a file under one of the Phase 10 prefixes (`src/lib/workspace-members/`, `src/lib/notifications/`, `src/lib/mentions/`, `src/app/(app)/settings/team/`, `src/app/(app)/settings/notifications/`, `src/app/(auth)/invite/`, `src/app/api/notifications/`, `src/app/api/members/`).

**Rule D** (worker): I read each of these functions before writing its reason.

| File | Function | Reason |
|---|---|---|
| `src/lib/worker/jobs/insight-run.ts` | insightRunHandler | updates only the status of the InsightRun row it loaded by the job's own id; the row keeps its organization and no other row is touched |
| `src/lib/worker/jobs/kb-embed-article.ts` | swapChunks | raw INSERT of KbChunk rows (pgvector column) carrying the locked article's organizationId, inside the scoped transaction under the article row lock |
| `src/lib/worker/jobs/sla-flag.ts` | updateBreach | raw UPDATE of the locked ticket ids, each paired with its own organizationId through unnest; returns a count only |
| `src/lib/worker/jobs/sla-flag.ts` | updateAtRisk | same, for the at-risk flag |
| `src/lib/worker/jobs/snooze-wake.ts` | wakeDueTicket | raw UPDATE … RETURNING of one locked ticket, filtered by id and organizationId |
| `src/lib/worker/jobs/auto-close.ts` | closeResolvedTicketIfQuiet | raw UPDATE … RETURNING of one locked ticket, filtered by id and organizationId, with the state join scoped to the same organization |

## The worker rule (Rule D), as checked

- No file under `src/lib/worker/` imports `next` or `next/*`, a file under `src/app`, or `src/lib/session.ts` (value imports; type-only imports are ignored). No file there calls `auth.api.*`.
- A `create*`, `update*`, `upsert` or `delete*` call on a DOMAIN_MODELS model (the list is read from `src/lib/scoped-db.ts` at test time; the model name is the Prisma accessor, for example `kbChunk`) must go through a client bound from `scopedDb(...)`. That covers a `const x = scopedDb(...)`, a parameter typed `ScopedDb`, and the callback parameter of such a client's `$transaction`. Otherwise its argument literal must name `organizationId`: in `where` for update and delete, in `data` for create, and in both `where` and `create` for upsert. A `data` given as a variable cannot be verified and is flagged.
- Every `$executeRaw`, `$queryRaw` (and the `Unsafe` variants), and every `sql` tagged template whose text contains INSERT, UPDATE or DELETE needs an allowlist entry. Row locks (`FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`) are not writes.
- The heartbeat (`systemSetting`) and rate-limit cleanup (`rateLimitHit`) write models outside DOMAIN_MODELS and are not judged. `ai-triage` and `email-outbound-send` write through `scopedDb`.

## Verification

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (Task 1, Task 2, Task 3) | 0, 0, 0 | clean |
| `pnpm test:integration tests/integration/membership-gate.test.ts` (Task 1) | 0 | 1 file, 14 passed |
| `pnpm test:integration` ticket-picker, kb-proposal-entry-flags, kb-proposal-reader-isolation, palette-search, list-panel-data, saved-views-ui-state, authz-conservative-membership (regression after Task 1) | 0 | 7 files, 51 passed |
| RED: `pnpm test:integration tests/integration/membership-gate.test.ts` with the Task 2 cases, before `page-access.ts` existed | 1 | "Cannot find package '@/lib/page-access'" |
| GREEN: `pnpm test:integration tests/integration/membership-gate.test.ts` (Task 2) | 0 | 1 file, 25 passed |
| `pnpm lint` (Task 2, Task 3) | 0, 0 | 696 and 698 files, 1 warning each, pre-existing at `tests/unit/container-config.test.ts:160` (not touched) |
| `pnpm exec vitest run tests/unit/membership-inventory.test.ts` | 0 | 30 passed |
| Fail-first check: the same file with `findViolations` changed to return no violations and no hygiene problems (temporary, restored from a byte copy) | 1 | 20 failed, 10 passed (the 10 are the compliant controls and the real-tree "no violation" checks) |
| `pnpm test tests/unit/membership-inventory.test.ts` (the script runs the whole `tests/unit` directory) | 0 | 102 files, 1760 passed |
| `pnpm test:integration` file-delete-inventory, merge-race-coverage, merge-reply-race, merge-provenance, sla-pause, snooze, ticket-merge, status-read-snapshot, membership-gate (regression after Task 2 and 3) | 0 | 9 files, 158 passed |

Every Docker step ran with `AIDA_TEST_RUN_ID=mwdx6d41-80641a0fab45d931`, `DOCKER_HOST` from `docker context inspect` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. `colima status` and `docker info` exited 0 before the first Docker step of each task. `pnpm test:docker-cleanup --apply` was not run, and no container was started or removed by hand.

Acceptance greps: `git grep -n "auth.api.getSession" -- src` lists only `src/lib/fresh-session.ts:21`. `disableCookieCache` appears 2 times in fresh-session.ts. `from "(next|@/)"` appears 0 times in fresh-session.ts and in membership.ts. `findConservativeMembership` appears 3 times in session.ts. `AccessDeniedError` appears 2 times in the attachment route. The membership diff has 0 `^-export` lines. `it(` appears on 27 lines of membership-gate (25 test cases). `redirect("/no-access")` appears 2 times in page-access.ts. The title and body strings appear 1 time each in the page. `text-(xs|sm|base|lg|xl)` appears 0 times in both no-access files. `prisma|scopedDb|getCurrentSession` appears 0 times in the page. `status: 403|err.status|error.status` appears 3 times in the messages route. `createSourceFile` appears 2 times, `DOMAIN_MODELS` 11 times, `Rule E slot: plan 10-16` 1 time and `readFreshSession` 12 times. `git diff --stat -- package.json pnpm-lock.yaml` prints nothing.

## Prohibition

AIDA-43 safety ("MUST NOT let a session opened before deactivation read or write any tenant data of the removed organization on its next request, whatever the cookie cache holds"): verified by test, for the paths this plan owns. With the same cookies, a deleted member row makes `getScopedDb` throw `AccessDeniedError`. `requirePageAccess` redirects to `/no-access`. The attachment route answers its missing-attachment 404, and the messages route answers 403 with no message written. A deleted session row reads as null, and a changed active organization is seen at once. Pages that still call `getScopedDb` now fail closed: they throw instead of rendering the removed organization's data. The redirect for every page comes with 10-17. Until then such a page shows the error boundary, not data.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug caused by this plan] TicketListPanel would have thrown for a removed member**
- **Found during:** Task 1
- **Issue:** `src/app/(app)/tickets/ticket-list-panel.tsx` called `getScopedDb`, and its loader then answered a removed member with the defined "membership ended" line. Once `getScopedDb` throws `AccessDeniedError`, `/tickets` and `/tickets/[id]` would hit the error boundary instead. That breaks the access-ended row of `tests/e2e/single-h1.spec.ts` before 10-17 replaces it.
- **Fix:** the panel reads `getSessionActor()` and binds `scopedDb(orgId)` itself. `loadTicketListPanelData` and `findConservativeMembership` take the actor as before. The behaviour is identical. The inventory judges `/tickets` as gated by getSessionActor plus its membership-reading loader.
- **Files modified:** `src/app/(app)/tickets/ticket-list-panel.tsx` (outside the plan's file list)
- **Commit:** 6876ee4

### Interpretations

**2. Rule C expected entries.** The plan expected Rule C entries for "the login page, the setup page and action" calling requireSession, getCurrentSession or readFreshSession. In the real tree the login and setup pages call none of them (they count users with `prisma.user.count()`). An allowlist entry that suppresses nothing fails hygiene, so they carry **Rule A** entries (tenant reach without a gate) instead. The setup action carries a Rule C entry for its `auth.api` calls and a Rule A entry. The (app) layout needs both a Rule A and a Rule C entry until 10-17, which the plan did not list. The health and Better Auth handler routes needed Rule A entries.

**3. Rule D expected entries.** The plan named insight-run, sla-flag and kb-embed-article. After reading every worker file, `snooze-wake.ts#wakeDueTicket` and `auto-close.ts#closeResolvedTicketIfQuiet` also run raw `UPDATE … RETURNING` through `$queryRaw`, so they carry entries too. sla-flag needs two entries (`updateBreach`, `updateAtRisk`), and kb-embed-article needs one (`swapChunks`, the raw INSERT). Its model writes go through `ScopedDb`-typed clients.

**4. The R2-3 row "session.ts getCurrentSession allowlisted by function"** is superseded by V-23 (Round 3): `session.ts` no longer calls `auth.api`, so the only home is `fresh-session.ts#readFreshSession`. I implemented it as a fixed rule, never an allowlist entry, and the fresh-session-shaped fixture flags exactly the second function.

**5. Inventory reach details** (for the reader of the test):
- A gated entry is reported as tenant-reaching.
- Calling the session or gate functions is not reach by itself.
- Server components rendered as JSX from src/app are followed, besides the plan's default-exported (app) components. This is what makes `/tickets` judged through TicketListPanel.
- getSessionActor counts as a gate only with a src/lib function whose own call graph reaches a membership reader (function level, stricter than module level).

**6. React `cache` memo not added.** V-23 allows one, but the K141 call-count unit test and the integration cases are exact without it.

**7. Scope addition, tests only.** Beyond the listed behaviours I added these cases: readFreshSession with no cookie; the cookie-expiry headers on a deleted row; getScopedDb redirect without a session; the attachment 401; requirePageAccess after a deleted session row and with mixed rows; the messages route positive case and its null-organization 403. In the unit suite I added getOrgRole-not-a-gate, the JSX-rendered component, the public exclusion, a C2 helper case, auth.api.getSession never allowlistable, a create without organizationId, models outside DOMAIN_MODELS, and SELECT … FOR UPDATE not being a write.

### Plan-level notes

- UI-SPEC amendment **A5** (no-access body copy) applies in the page: "You are not a member of this workspace, or your membership was removed. If this is a mistake, ask a workspace admin to invite you again." It replaces UI-SPEC line 353's body, and the title and button are unchanged. `10-UI-SPEC.md` was not edited (it is not in this plan's files). The amendment is recorded here for the gate in plan 10-14.
- `/no-access` is not in `PUBLIC_PREFIXES`, so a request with no session cookie is sent to `/login` by the proxy, which is the intended result. `/no-access` joining `tests/e2e/csp.spec.ts` and `single-h1.spec.ts` belongs to 10-17 and 10-14 (V-27).

## Ledger rows applied

- Round 3 V-23 supersedes Round 2's "cached readers kept for /login": every session read is fresh, with no cached reader.
- Round 3 V-27 supersedes Round 1 C6 (`getPageScopedDb` in 13 entries): the plan builds `requirePageAccess` and wires no page (10-17 does).
- Round 2 R2-2's `requireMembership` and `getFreshSession()` names are superseded by the Round 3 must_haves (`readFreshSession`, getScopedDb with membership). No `requireMembership` or `getFreshSession` was created.
- V-05: membership.ts gains only AccessDeniedError, and the Rule A gates include getActiveOrgAccess, requireOrgAdminScope and conditional getSessionActor. C5 and R2-3 are implemented as Task 3, with the Rule E slot left for 10-16.

## Manual items (left open)

None of these was performed or is claimed:
- Visual check of `/no-access` in light and dark mode, at 360px (no horizontal scroll), and the DESIGN-SYSTEM §9 checklist for this page.
- Screen-reader check of the page (one `<h1>`, button label).
- The E9 backstop rows of UI-SPEC: they hold by construction (fixed copy, no data read, a server component with no spinner), but no browser run in this plan checks them.
- Sign out from `/no-access` in a real browser (the call is the user menu's, which has no test of its own here).

## Known Stubs

None.

## Threat Flags

None. The new surface is `/no-access`, which reads no data, and the existing routes changed only to refuse more.

## Self-Check: PASSED

- FOUND: src/lib/fresh-session.ts, src/lib/page-access.ts, src/app/(auth)/no-access/page.tsx, src/app/(auth)/no-access/sign-out-button.tsx
- FOUND: tests/integration/membership-gate.test.ts, tests/support/source-inventory.ts, tests/unit/membership-inventory.test.ts
- FOUND commits: 6876ee4, 69ac2cd, 0acbca3, 9a0b517
