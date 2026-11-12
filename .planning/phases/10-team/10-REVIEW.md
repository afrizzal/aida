---
phase: 10-team
part: a (schema, membership gate, sessions, page access, proxy)
reviewed: 2026-11-13T02:11:58Z
depth: standard (security emphasis)
diff_range: bd02a39..HEAD (HEAD c1ed7fc)
files_reviewed: 43
files_reviewed_list:
  - prisma/schema.prisma
  - prisma/migrations/20261115100000_team_foundation/migration.sql
  - src/lib/auth.ts
  - src/lib/fresh-session.ts
  - src/lib/session.ts
  - src/lib/scoped-db.ts
  - src/lib/membership.ts
  - src/lib/authz.ts
  - src/lib/page-access.ts
  - src/lib/app-url.ts
  - src/lib/security/csp.ts
  - src/lib/rate-limit/public-limits.ts
  - src/lib/tenant-seed-lock.ts
  - src/proxy.ts
  - src/app/(app)/layout.tsx
  - src/app/(app)/contacts/[id]/page.tsx
  - src/app/(app)/contacts/page.tsx
  - src/app/(app)/insights/page.tsx
  - src/app/(app)/kb/[id]/page.tsx
  - src/app/(app)/kb/new/page.tsx
  - src/app/(app)/kb/page.tsx
  - src/app/(app)/kb/proposals/[id]/page.tsx
  - src/app/(app)/kb/proposals/page.tsx
  - src/app/(app)/settings/backups/page.tsx
  - src/app/(app)/settings/branding/page.tsx
  - src/app/(app)/settings/custom-fields/page.tsx
  - src/app/(app)/settings/email/page.tsx
  - src/app/(app)/settings/notifications/page.tsx
  - src/app/(app)/settings/page.tsx
  - src/app/(app)/settings/sla/page.tsx
  - src/app/(app)/settings/statuses/page.tsx
  - src/app/(app)/settings/tags/page.tsx
  - src/app/(app)/settings/team/page.tsx
  - src/app/(app)/tickets/[id]/page.tsx
  - src/app/(app)/tickets/page.tsx
  - src/app/(app)/tickets/ticket-list-panel.tsx
  - src/app/(auth)/no-access/page.tsx
  - src/app/(auth)/no-access/sign-out-button.tsx
  - src/app/api/attachments/[id]/route.ts
  - src/app/api/palette/tickets/route.ts
  - src/app/api/tickets/picker/route.ts
  - docker-compose.yml
  - .env.example
coverage_note: "Every file in the list was read in full or as its diff hunks against bd02a39 together with the code around them. Read for context only, not reviewed: the accept route (src/app/(auth)/invite/[token]/accept/route.ts), the invite page, src/lib/workspace-members/{member-admin,invitations,invite-onboarding}.ts (deactivateMember, listMembers, link building, signUpAndAccept), src/lib/notifications/digest.ts (claim lock, link building), src/lib/rate-limit/client-ip.ts, the server actions that call getSessionActor and getScopedDb, src/app/(auth)/login/page.tsx, src/lib/bootstrap.ts and the setup action (how many organizations an install can have), tests/unit/app-url.test.ts and tests/e2e/team-deactivation.spec.ts (the post-deactivation server action case). In node_modules (better-auth 1.7.20, better-call 1.4.5), these were read: the core route list (createAuthEndpoint paths), update-session.mjs, parseInputData in db/schema.mjs, the organization and admin plugin session and user field definitions, the nextCookies plugin, getBaseURL and withPath in utils/url.mjs, the router's basePath in api/index.mjs, and better-call's router.mjs. No test, build, Docker or pnpm command was run. Checked and found sound, so not reported: the proxy blocks /api/auth/organization/ and /api/auth/admin/ before the /api/auth public prefix, on a decoded, lower-cased, slash-collapsed path, and the malformed-path guard runs first. The core routes left open over HTTP cannot write membership, role or the active organization: update-session refuses activeOrganizationId and impersonatedBy (input: false, parseInputData throws FIELD_NOT_ALLOWED); role, banned and the ban fields are input: false on update-user; change-email and delete-user are disabled by configuration (the configuration was read; the endpoints were not called). readFreshSession is the only getSession call under src; no client component reads the session; no component under src/components imports db, session, scoped-db or authz. All 20 (app) pages call requirePageAccess first and outside any try; the settings and tickets nested layouts read no tenant data. /no-access is not a public prefix, so the proxy sends a request without a cookie to /login; the page reads no session or tenant data. The palette and picker routes answer 401 without a session, 403 without an active organization, and pass the actor to a service that checks membership. The attachment route answers 404 for AccessDeniedError. The migration matches the schema, drops nothing, adds no member constraint (O-4), and its append-only trigger copies the TicketAuditEvent pattern. The Phase 10 code calls no unscoped scopedDb operation (findUnique, createMany, groupBy, aggregate) on the six new models; the gap in scopedDb itself was already reported in 12.2-REVIEW and is not reported again. The digest claim is serialised per pair by an advisory transaction lock, so NotificationDigest needs no partial unique index. The worker gets BETTER_AUTH_URL the same way as the app (no default in either)."
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
status: issues_found
---

# Phase 10: Code Review Report (part a, schema, membership gate, sessions, page access, proxy)

**Reviewed:** 2026-11-13
**Depth:** standard, with security emphasis (full files and diff hunks; see coverage note)
**Files Reviewed:** 43
**Status:** issues_found

## Summary

The membership gate holds on every path this review traced. Each of the 20 `(app)` pages, the layout and the ticket list panel call `requirePageAccess` first and outside any `try`. `getScopedDb` re-reads the member rows on every call. Every session read goes through `readFreshSession`, and the cookie cache is off. I found no way for a removed member, a user with no member row, or a user of another organization to get a tenant client, tenant data on a page, or an attachment. The proxy closes both Better Auth plugin route groups on a canonical path. The open core routes cannot write the active organization, a role, a ban field or an email address. The schema and migration are additive and match each other. There are no critical findings.

The defects are at the edges. A removed member's open tab gets a thrown error from almost every server action, because deactivation clears the session's organization and `getSessionActor` and `getScopedDb` throw rather than return a refusal (a-WR-1). `getAppBaseUrl` keeps the path of `BETTER_AUTH_URL`, and its unit test pins that. But Better Auth takes any path in that URL as its own base path, so every path-bearing value breaks either the invitation and digest links or sign-in itself (a-WR-2). The invite accept limit of 10 per hour is keyed per client address only, so a team that joins from one office is locked out after about ten form posts (a-WR-3).

## Warnings

### a-WR-1: After a deactivation, a removed member's open tab gets thrown errors from server actions, not the designed refusal

**File:** `src/lib/session.ts:69-73` (with `src/lib/session.ts:48-55`, `src/lib/authz.ts:62-70`; cause in `src/lib/workspace-members/member-admin.ts:420-428`)
**Issue:** Deactivation moves the target's sessions to their oldest other membership, or to `null` (D-07). An install has one organization: `/setup`, `bootstrap.ts` and the demo seed each create the first one, and `allowUserToCreateOrganization: false` blocks the rest. So in practice the value is always `null`. From then on:
- `getSessionActor` throws a plain `Error("No active organization on session …")` (`session.ts:72`). About 30 server actions call it: every ticket mutation, bulk actions, saved views, relations, snooze, merge, statuses, SLA auto-close, the Team actions and the KB proposal actions. The services' typed `MEMBERSHIP_ENDED` result, which those actions map to the "access ended" copy, is never reached.
- `getScopedDb` throws `AccessDeniedError` (`session.ts:51`). That is right for the four route handlers that catch it. But the server actions in `tickets/[id]/actions.ts` (7 calls), `contacts/[id]/actions.ts` and `insights/actions.ts` let it escape too. D-08 says server actions "answer 403". A thrown error in a server action is not a 403. It is Next's generic action failure, logged server-side with a stack, and the client sees only whatever its own `.catch` shows.
- `requireOrgAdminScope` throws `Error("Forbidden: admin role required")` in the same state.

Nothing is written, so this is not an authorization bypass. But the refusal contract D-08 and V-27 describe ("server actions … answer 403 (`MEMBERSHIP_ENDED` where the service already does)") does not hold on the most common deactivation path. The E2E case (`tests/e2e/team-deactivation.spec.ts:145-162`) checks only that the assignment did not change, not what the user saw. This was verified in code for `changeState`, `changePriority` and `saveContactNotes` and their `.catch(() => null)` callers. Whether every client caller of the other actions catches the rejection was not checked.
**Fix:** Give every action one refusal path. Make `getSessionActor` throw `AccessDeniedError` when the organization is null, like `getScopedDb`. Then add one wrapper that the server actions use, which maps it to the typed result the UI already renders:
```ts
// src/lib/session.ts
export async function getSessionActor() {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new AccessDeniedError("No active organization on session");
  return { userId: session.user.id, orgId };
}

// src/lib/action-refusal.ts (new)
export async function withMembership<T>(fn: () => Promise<T>, ended: T): Promise<T> {
  try { return await fn(); }
  catch (err) { unstable_rethrow(err); if (err instanceof AccessDeniedError) return ended; throw err; }
}
```
Extend the deactivation E2E so it asserts the visible "access ended" text after the refused assignment.

### a-WR-2: `getAppBaseUrl` keeps the path of BETTER_AUTH_URL, but no path-bearing value works with Better Auth or this app

**File:** `src/lib/app-url.ts:47-56` (the test `tests/unit/app-url.test.ts:29-37` pins it; used at `src/lib/workspace-members/invitations.ts:239` and `src/lib/notifications/digest.ts:228`)
**Issue:** The docstring promises sub-path deployments such as `https://example.com/aida`, and the base URL keeps the path. Better Auth reads the same variable differently. `withPath` (`node_modules/better-auth/dist/utils/url.mjs:42-49`) returns a URL that has a path unchanged, and the router's base path is that URL's pathname (`dist/api/index.mjs:156`). So:
- `BETTER_AUTH_URL=https://example.com/aida` makes Better Auth's base path `/aida`. The Next handler is mounted at `/api/auth/[...all]`, so every request there fails the router's base-path check (better-call `router.mjs:32-33`), and sign-in breaks. `next.config.ts` has no `basePath` either.
- `BETTER_AUTH_URL=https://example.com/api/auth` is the one path value Better Auth accepts. It makes every invitation link `https://example.com/api/auth/invite/<token>` and every digest link `…/api/auth/tickets/<id>`. Those paths fall to Better Auth's catch-all and 404.
- The accept route redirects to `${origin}${path}` (origin only, `accept/route.ts:58-66`), so a link and its redirect disagree whenever a path is set.

The effect is broken invitation and digest emails, or a broken install, from a configuration the code documents as supported. It is not a security issue. The Better Auth behaviour was read in `node_modules`. No request was run with a path-bearing `BETTER_AUTH_URL`.
**Fix:** Build links from the origin only, and refuse a path that is not exactly `/api/auth` (or strip that one suffix), so a wrong value fails loudly at invite time and not in the invitee's inbox:
```ts
export function getAppBaseUrl(env: Env = process.env): string {
  const url = parseAppUrl(env);
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "" && path !== "/api/auth") throw new AppUrlError("invalid");
  return url.origin;
}
```
Update the unit test and the docstring. Add one line to `.env.example` saying `BETTER_AUTH_URL` must be the bare public origin.

### a-WR-3: The invite accept limit is 10 per hour per client address, so a team joining from one office is locked out

**File:** `src/lib/rate-limit/public-limits.ts:17-23` (consumed at `src/app/(auth)/invite/[token]/accept/route.ts:130-132`)
**Issue:** `inviteAccept` allows 10 POSTs per hour per client identity, and the identity is only the address (or the IPv6 /64). The comment beside it says the view limit leaves room for "many invitees behind one address". Yet the accept limit is sized for one invitee ("covers a few wrong passwords and retries"). The usual first use of AIDA-42 is an admin inviting the whole support team at once, and the team accepts from the same office NAT. Each join is one POST, or more after a field error or a wrong password. So the 11th POST from that address in an hour gets a 429. That 429 comes from a form navigation, so the browser shows the raw JSON body `{"error":"rate_limited"}` instead of the invite card. A stuck invitee can only wait up to an hour. Behind an unsupported topology with no `X-Forwarded-For`, every client shares one bucket (`client-ip.ts:83-86`), and the whole install gets 10 joins per hour. The NAT scenario is inferred from the code. No run reproduced it.
**Fix:** Key the tight limit per (identity, token), which is what password guessing through one link needs. Add a looser per-identity cap for token spraying, for example:
```ts
inviteAccept: { scope: "invite-accept", max: 10, windowMs: HOUR_MS },          // key: `${identity}:${sha256(token)}`
inviteAcceptPerIp: { scope: "invite-accept-ip", max: 100, windowMs: HOUR_MS }, // key: identity
```
On a refusal, answer the form post with a 303 back to the invite page, which already has a `throttled` state, not with JSON.

## Info

### a-IN-1: A user in two organizations lands in an arbitrary one at every sign-in and has no way to switch

**File:** `src/lib/auth.ts:22-25`, `src/proxy.ts:56`
**Issue:** The session hook sets `activeOrganizationId` from `prisma.member.findFirst({ where: { userId } })`, with no `orderBy`. Phase 10 makes multi-organization membership reachable for the first time (an invitation to a second organization), and it closes `/organization/set-active` over HTTP with no AIDA replacement. Accept sets the invited organization on the accepting session only. Every later sign-in picks a row in heap order, usually the older membership, and the user cannot reach the other organization except through the invite link's retry path. Deactivation uses a different, deterministic rule (oldest by `createdAt`, then `id`, `member-admin.ts:420-424`). Today this does no harm, because the product creates only one organization per install (see a-WR-1). That this path is otherwise unrecorded was checked in the phase documents only.
**Fix:** Give the hook the same `orderBy: [{ createdAt: "asc" }, { id: "asc" }]` as deactivation. Record as a known limit that a second organization needs an AIDA-owned switcher (a server action that sets the session's organization under the membership check) before any path creates one.

### a-IN-2: The `/invite` no-referrer policy is what forces the accept route to admit `Origin: null`

**File:** `src/lib/security/csp.ts:24-28` (with `src/app/(auth)/invite/[token]/accept/route.ts:67-87`, commit `dd941e0`)
**Issue:** Under `Referrer-Policy: no-referrer`, a browser sends `Origin: null` on the card's own same-origin form post. So the accept route now trusts `null` when `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate` are present. This works, but the CSRF check now rests on fetch metadata. A browser that does not send `Sec-Fetch-*` cannot join at all (403 JSON). `Referrer-Policy: same-origin` would still keep the token from every third party, because no `Referer` leaves the origin, and the browser would send the real `Origin` on a same-origin post. The route could then keep its strict equality check. The browser behaviour here (Origin serialisation per policy, which browsers send `Sec-Fetch-*`) comes from the Fetch Standard as I understand it. It was not checked in a browser.
**Fix:** Consider `same-origin` for `/invite` only, then remove the `null` branch from `isSameOriginPost`. Keep `no-referrer` for the status paths, whose pages post no forms that need an Origin.

### a-IN-3: Several session reads per render, and three settings pages take the role from a second read

**File:** `src/lib/page-access.ts:24-31`; `src/app/(app)/settings/branding/page.tsx:23`, `settings/sla/page.tsx:32`, `settings/backups/page.tsx:46`
**Issue:** No per-request memo exists, although V-23 allows one. `/tickets/[id]` reads the session and the member rows in the layout, the page and `TicketListPanel` (three fresh session reads and five membership reads). The branding, SLA and backups pages then call `getOrgRole()`, a further session read, although `requirePageAccess` already returned `role` for the same organization. The organization can change mid-render only through an accept or a deactivation. Both orgs are ones the user belongs to at read time, so this does not leak data. But it is the two-read shape K141 forbids for writes, and one render can mix two organizations.
**Fix:** Use the `role` from `requirePageAccess` on those three pages. Optionally wrap `getCurrentSession` in React's `cache()` so one render reads the session once.

### a-IN-4: A membership that ends after the gate is handled two ways

**File:** `src/app/(app)/tickets/[id]/page.tsx:36`, `contacts/[id]/page.tsx:40` (redirect) against `settings/statuses/page.tsx:25-33`, `kb/proposals/page.tsx:59-62`, `kb/proposals/[id]/page.tsx` and `tickets/ticket-list-panel.tsx:145` (in-page state)
**Issue:** V-27 says "every protected page behaves the same". When the loader's second membership check fails, two pages redirect to `/no-access` and four render an in-page "access ended" state. This happens only in the window between the gate and the loader, so its impact is small.
**Fix:** Redirect on the loader's membership-ended result everywhere, or record the in-page states as deliberate.

### a-IN-5: `/invite` is an unanchored public prefix

**File:** `src/proxy.ts:17`, `:156`; `src/lib/security/csp.ts:28`, `:77`
**Issue:** `pathname.startsWith("/invite")` also matches `/invites`, `/invitations` or `/invited`. A later route with such a name skips the proxy's session-cookie check without anyone choosing that. Today no route matches, and every `(app)` page runs its own gate, so nothing is exposed.
**Fix:** Use `"/invite/"` in both lists, and keep a bare `/invite` (if wanted) as an exact match.

### a-IN-6: The new tables do not enforce their own cross-row invariants

**File:** `prisma/migrations/20261115100000_team_foundation/migration.sql:27-40`, `:97-105`
**Issue:** `MessageMention.organizationId` is not tied to its message's organization (no composite foreign key). `Notification` carries a free `entityType` and `entityId`. `MemberAuditEvent.action`, `oldRole` and `newRole` have no CHECK, unlike `TicketAuditEvent`'s `actorType` check in the inbox migration. Tenant consistency on these rows rests entirely on the emitters.
**Fix:** Optionally add `CHECK ("oldRole" IS NULL OR "oldRole" IN ('owner','admin','member'))` and the same for `newRole`, and a unique `(id, organizationId)` on `Message` with a composite foreign key from `MessageMention`. Otherwise record that the application is the only guard.

### a-IN-7: The attachment route reports a database failure in the gate as 401

**File:** `src/app/api/attachments/[id]/route.ts:13-20` (same shape in `api/tickets/[id]/messages/route.ts:36-42` and `api/notifications/route.ts:38-45`)
**Issue:** Every error other than `AccessDeniedError` becomes `401 unauthorized`. The catch was meant for the redirect from `requireSession`. `getScopedDb` now also runs a member read, so a database outage tells a signed-in user they are signed out, and leaves no log line.
**Fix:** Rethrow anything that is not Next's redirect or `AccessDeniedError` (`unstable_rethrow` first, then a 500 with a fixed log line).

---

_Reviewed: 2026-11-13T02:11:58Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (security emphasis)_

---

## Dispositions (orchestrator, 2026-11-13)

Four parts reviewed: a 0/3/7, b 0/5/8, c 0/5/8, d 0/6/8 (critical/warning/info), files `10-REVIEW.md`, `10-REVIEW-b.md`, `10-REVIEW-c.md`, `10-REVIEW-d.md`. No critical finding. The claims below were checked in code by the orchestrator before deciding: `composer-tokens.ts:312-327` (no boundary check before `@`), `render.ts:187-196` (the same guard function used twice), `session.ts:69-73` (`getSessionActor` throws a plain Error), `public-limits.ts:23` (accept limit 10 per hour per address), `accept/route.ts:61` (absolute `Location`), `proxy.ts:16` (no-referrer on `/invite`). Every warning is accepted. Run decisions K159 to K177:

| Decision | Findings | Decision |
|---|---|---|
| K159 | b-WR-1, a-IN-2 | `/invite` moves from `Referrer-Policy: no-referrer` to `same-origin` (amends D-04; this run's own decision, not an owner's). Third parties still never receive the token; the server already sees it in the accept path, so a same-origin Referer exposes nothing new. The accept route returns to an exact Origin match only and the `Origin: null` plus fetch-metadata path of `dd941e0` is removed, so plain-HTTP self-hosts and browsers without fetch metadata can join. Fewer accepted shapes is the conservative choice. Codex critiques this in the diff round. |
| K160 | b-WR-5 | Accept redirects use a relative `Location`. |
| K161 | b-WR-3, a-WR-3 | Refusals of the accept form post (403, 429, 400, 413) land on the invitation page with a readable state, never raw JSON. Rate limit: per client address 60 per hour, plus per invitation token 10 per hour, so password guessing stays capped per invitation while a team behind one address can join. |
| K162 | b-WR-2 | The Team page follows V-26: a user with any owner row is shown as Owner and protected (no role Select, no Deactivate); the actor's own rights stay conservative. |
| K163 | b-WR-4 | The invite email is validated like Better Auth's sign-up (`z.email()`), as exactly one address; address-list syntax is refused. |
| K164 | a-WR-1 | No active organization or no member row gives the typed `MEMBERSHIP_ENDED` refusal (403 in routes and actions), never a thrown Error; tests on a representative set of actions. |
| K165 | a-WR-2 | `getAppBaseUrl` uses the origin only; a `BETTER_AUTH_URL` with a path is refused at start with a clear configuration error and documented in `.env.example` and `docs/OPERATIONS.md`. |
| K166 | c-WR-01 | One rule for unassigned-fallback rows in the bell and the digest, following V-28 and the settings copy; test both surfaces. |
| K167 | c-WR-02 | The SLA pass is bounded: one transaction per organization and a per-pass row cap, the remainder in the next pass; notifications still come from exactly the flipped rows inside the same transaction; a test with a backlog above the cap. |
| K168 | c-WR-03 | Privacy tests for `GET /api/notifications` and the three bell actions with another member's and another organization's notification ids. |
| K169 | c-WR-04 | An integration test runs the digest through pg-boss end to end; job options make an overlapping run impossible or harmless by design, and the wrong comments are corrected. |
| K170 | c-WR-05 | Digest failures are logged with error class and code only (no address, no content). A permanent SMTP rejection (5xx) closes the batch as failed instead of retrying forever, with no growth of `NotificationDigest` rows; transient failures keep today's behaviour; tests. The digest also carries `Auto-Submitted: auto-generated` (c-IN, prevents a reply becoming a customer ticket) if the inbound path honours it; otherwise recorded. |
| K171 | d-WR-1 | The span guard runs before and after sanitizing through two distinct plugin instances; a unit test proves the second run happens. |
| K172 | d-WR-2 | The server keeps only mention ids whose member's current display name appears as an `@Name` mention in the body (the renderer's boundary rule); other ids are dropped and notify nobody; tests for the three ways in. |
| K173 | d-WR-3 | The strip on a switch to public removes `@Name` only at a mention boundary; e-mail addresses and text inside words are kept; test with `orders@sales-desk.example`. |
| K174 | d-WR-4 | Inserted names are escaped for Markdown and the renderer matches the escaped form; tests with `*`, `_` and `[x](url)` in names. |
| K175 | d-WR-5 | Integration test for `GET /api/members/mentionable`: current members only, other organization excluded, removed member 403, unauthenticated 401. |
| K176 | d-WR-6 | UI-SPEC amendment A9: on-scale row padding (`py-1`) with the list height recalculated for eight rows; recorded in the gate's amendment list. |
| K177 | gate row (10-GATE.md) | `tests/integration/backup-failures.test.ts:460` (K143 run deadline) failed under the full suite and passed alone; make it independent of wall-clock load without loosening the deadline it proves. |

Info findings are fixed in the batch that touches the same file when the fix is small and testable; the rest go to `deferred-items.md` with a reason. Fix batches, one per round, each with tests seen failing first: F1 = K159 to K163 (invitations and Team page), F2 = K164 and K165, F3 = K166 to K170 (notifications and digest), F4 = K171 to K176 (mentions), F5 = K177. Then the Codex critique of the phase diff (step 7, at most 3 rounds).

**Clarification after F1 (2026-11-13), K159:** "exact Origin match" is read as exact equality against the origin of `BETTER_AUTH_URL` plus each exact (non-wildcard) origin in `BETTER_AUTH_TRUSTED_ORIGINS`, the same list Better Auth's own origin check uses. With `BETTER_AUTH_URL` alone every join on the default stack would be refused (Caddy serves `https://localhost`, `BETTER_AUTH_URL` is `http://localhost`). Accepted by the orchestrator; Codex critiques it with the diff.

## Codex diff critique round 1 dispositions (orchestrator, 2026-11-13)

Answer: `.planning/run-loop/codex/fase10-diff-jawab.md` (log `model: gpt-6.1-terra`, `reasoning effort: xhigh`): 1 HIGH, 3 MEDIUM, 1 LOW; Codex judged K159 to K177 covered on the paths it traced and the phase not ready. Each claim was checked in code by the orchestrator: `member-admin.ts:432-441` (deactivation moves the removed member's sessions to their oldest other membership, D-07), `digest-sender.ts:112` and `digest.ts:368` (535 classed permanent and stamped), `composer-tokens.ts:310` and `composer.tsx:283` (a pasted `(@Name)` is outside the boundary and the guard does not hold it), `digest.ts:325` (membership checked before the body is built and the connection opened), `app-url.ts:109` (the origin of a trusted entry that had a path is trusted). All five accepted:

| Decision | Codex finding | Decision |
|---|---|---|
| K178 | HIGH: a stale tab writes to the wrong organization after deactivation | Amends D-07: deactivation sets the removed member's sessions in that organization to `activeOrganizationId = null` instead of moving them to another membership, so every later action gets the typed `MEMBERSHIP_ENDED` refusal (K164) and every page lands on `/no-access`; the person reaches another organization only by signing in again. This removes the only automatic organization switch. The user-initiated switch at invitation accept (V-23) stays; a stale tab of the old organization after the person deliberately accepted elsewhere is recorded as a known limit and put to Codex in round 2 (the complete fix, binding every action to the rendered organization, touches every server action). Tests: a two-organization member deactivated from A, a stale-tab action for A, nothing written in B. |
| K179 | MEDIUM: K170 loses digests when SMTP authentication is misconfigured | SMTP authentication and configuration failures (535 and the other auth or "not accepting" codes the sender can tell apart) are operator-recoverable: release the claim without stamping, stop sending for that organization for the rest of the run, log class and code once; recipient-permanent 5xx (550-type) keep the K170 close. Tests for both. |
| K180 | MEDIUM: a pasted `(@Name)` can still reach the customer | The C7 guarantee is stated precisely: inserted mention spans are stripped at the switch and blocked at the public send. In addition, the public-send guard (d-IN-7) holds the first Send whenever the public body contains `@` followed by the name of any member mentioned in this draft, wherever it appears (no boundary rule), and shows the switch note; free text is never auto-stripped (so e-mail addresses are not corrupted). The second Send goes through as written: human in the loop. Tests. |
| K181 | MEDIUM: digest window after deactivation | Re-check membership and preferences immediately before the SMTP connection is opened (after the body is built), in the same claim; document that a digest whose transmission already started when the deactivation commits may still arrive (the same bound as V-25 for actions); a race test for the ordering that the re-check closes. |
| K182 | LOW: K159 trusted origins | A `BETTER_AUTH_TRUSTED_ORIGINS` entry that carries a path, query or fragment is ignored for the accept check (not trusted), consistent with K165; `.env.example` and `docs/OPERATIONS.md` state that every listed origin is trusted fully for invitation accepts. The same-origin Referer reaching the server's own logs was accepted in K159 (the token is already in the accept path). |

Fix batch F6 = K178 to K182, then the full E2E (not run since `2418e4c`) and Codex round 2.

## Codex diff critique round 2 dispositions (orchestrator, 2026-11-13)

Answer: `.planning/run-loop/codex/fase10-diff-r2-jawab.md` (log `model: gpt-6.1-terra`, `reasoning effort: xhigh`): no new HIGH; 2 MEDIUM, 2 LOW; K178 closed on the traced path; V-23 acceptable as a written limit while v1 ships one workspace per install, to be raised to HIGH before multi-workspace support. Claims checked in code by the orchestrator: `composer.tsx:372` (the hold shows "The mentioned names were removed from this reply." though nothing was removed), `app-url.ts:72-81` (`isBareOrigin` checks the normalised `pathname`, so `/a/..` or `/%2e` pass), `digest.ts:395-400` (a configuration rejection releases the claim; nothing prunes RELEASED rows). All accepted:

| Decision | Codex finding | Decision |
|---|---|---|
| K183 | MEDIUM: K180 hold shows a false sentence; an edit after the hold does not re-arm the guard | The hold gets its own copy asking the agent to review the reply because it still names a mentioned member (UI-SPEC amendment A10); the switch note keeps its sentence only after a real strip. Any edit of the body after a hold re-arms the guard. The unbounded match (and its false positives such as an address containing `@Name`) stays, explained by the copy. Tests. |
| K184 | MEDIUM: K181's bound is wider than written | Move the last membership and preference re-check to immediately before the connection, with no other reads in between; document the bound exactly: a deactivation that commits after the last re-check may still let that one digest through. Test the ordering just after the re-check. |
| K185 | LOW: K182 accepts dot-segment paths after URL normalisation | The bare-origin rule checks the raw text: after the scheme and authority only an optional single trailing `/` may follow (no `.`/`%2e` segments, `?`, `#`, credentials), for `BETTER_AUTH_URL` and every trusted-origin entry. Tests with `/a/..`, `/%2e`, `/.`. |
| K186 | LOW: K179 keeps digests but adds a RELEASED row every run while SMTP stays broken | Retention: each digest run deletes RELEASED and CANCELED digest rows older than 7 days in a bounded batch (notifications are untouched); operators see the configuration failure in the existing log line and `docs/OPERATIONS.md` says so. Test. |
| (limit) | V-23 stale tab after a deliberate invitation accept | Accepted as a written limit for v1 (one workspace per install in the UI). Documented in `docs/OPERATIONS.md` and in the Phase 10 gate's known limits, with the note that it becomes HIGH before multi-workspace support (bind every server action to the rendered organization). Recorded for the owner in LAPORAN. |
| (info) | K178 recovery path not explained | The `/no-access` page adds one sentence: signing out and in again opens another workspace the person still belongs to (UI-SPEC amendment A11). |

Fix batch F7 = K183 to K186 plus the two rows above, then Codex round 3 (the last).
