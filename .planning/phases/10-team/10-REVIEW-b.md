---
phase: 10-team
part: b (team administration and invitations)
reviewed: 2026-11-13T02:10:00Z
depth: standard
diff_range: bd02a39..HEAD
head: c1ed7fc
files_reviewed: 21
files_reviewed_list:
  - src/lib/workspace-members/errors.ts
  - src/lib/workspace-members/invitations.ts
  - src/lib/workspace-members/invite-email.ts
  - src/lib/workspace-members/invite-onboarding.ts
  - src/lib/workspace-members/invite-token.ts
  - src/lib/workspace-members/member-admin.ts
  - src/lib/workspace-members/member-audit.ts
  - src/lib/workspace-members/member-rights.ts
  - src/lib/workspace-members/org-lock.ts
  - src/app/(auth)/invite/[token]/page.tsx
  - src/app/(auth)/invite/[token]/invite-card.tsx
  - src/app/(auth)/invite/[token]/accept/route.ts
  - src/app/(app)/settings/team/actions.ts
  - src/app/(app)/settings/team/page.tsx
  - src/app/(app)/settings/team/team-copy.ts
  - src/app/(app)/settings/team/team-member-row.tsx
  - src/app/(app)/settings/team/deactivate-dialog.tsx
  - src/app/(app)/settings/team/invite-dialog.tsx
  - src/app/(app)/settings/team/pending-invitation-list.tsx
  - src/components/join-welcome-toast.tsx
  - README.md
coverage_note: "All nine workspace-members modules, the accept route, the invite page, the Team actions, the Team page and team-member-row.tsx were read in full. invite-card.tsx was read except the sign-up and sign-in form bodies, which were only scanned for field names and the form action. deactivate-dialog.tsx, invite-dialog.tsx and pending-invitation-list.tsx were scanned for their action calls, state handling and link handling, not line by line. team-copy.ts was read for grantableRoles, expiresInText and the deactivate copy. For context only, these were also read: 10-CONTEXT 'Update 2026-11-13' (V-04, V-06, V-07, V-10, V-23 to V-27, O-4, and the R10-1 amendment), the dd941e0 commit message, the Origin lines of 10-08, 10-13 and 10-GATE, src/lib/membership.ts, src/lib/session.ts, src/lib/page-access.ts, src/lib/fresh-session.ts, src/lib/app-url.ts, src/lib/auth.ts, the proxy and csp.ts diffs, rateLimitedResponse, the Caddyfile, the BETTER_AUTH_URL rows of docs/OPERATIONS.md and .env.example, the sign-up email check in the installed better-auth (dist/api/routes/sign-up.mjs) and the email regex of the installed zod 4.6.7. No test, build, container or browser was run. Browser behaviour (Fetch Standard Origin serialisation, Fetch Metadata only on potentially trustworthy URLs, CSP form-action on redirects, Caddy's HTTP-to-HTTPS redirect for localhost) comes from the specifications and product documentation as I know them, not from a live run; each finding says so where it depends on it."
findings:
  critical: 0
  warning: 5
  info: 8
  total: 13
status: issues_found
---

# Phase 10: Code Review Report (part b, team administration and invitations)

**Reviewed:** 2026-11-13
**Depth:** standard (security emphasis)
**Files Reviewed:** 21
**Status:** issues_found

## Summary

I found no blocker. I traced the authorization of every Team action and every join path, and I found no way around the server rules:

- Every server action takes the actor from the session only (`getSessionActor`). Each one calls a service that re-reads the actor's rights after `lockOrganization`, inside one transaction.
- Owner rights need every row of the user to be `owner`. Target protection uses "any owner row" (`checkActorAndTarget`, `member-admin.ts:216`). Self-change is refused before any rule that depends on the role.
- The owner floor cannot be crossed in a race. Only an owner may act on an owner-row target, so the loser of two crossed demotions fails at the actor re-check.
- Accept re-reads the invitation, the email, the role, the inviter's current rights and "no member row yet" under the organization lock. It activates exactly the requesting session row and rolls everything back on zero rows. Its retry path needs an `INVITATION_ACCEPTED` audit row for the same user plus a current member row, so a used link cannot bring a deactivated member back.
- The token has 256 bits and only its SHA-256 is stored. No new code logs anything. Location targets are built with `encodeURIComponent(token)` on the configured origin, so the redirect is neither open nor injectable.

**Question 1: is the `Origin: null` branch of `dd941e0` sound?** Against cross-site request forgery, yes. My reasons, from the Fetch Standard and the Fetch Metadata spec, not from a live run:

- `Sec-Fetch-Site` and `Sec-Fetch-Mode` are forbidden request headers, so no page script can set them.
- `Sec-Fetch-Site` is computed from the request's real origin against every URL of its redirect chain. A cross-site form, or a cross-site page that bounces through a same-origin redirect, is therefore labelled `cross-site`.
- A sandboxed frame has an opaque origin, which is never same-origin with anything, so its post is labelled `cross-site` too. `X-Frame-Options: DENY` also stops AIDA pages from being framed.
- `Sec-Fetch-Mode: navigate` excludes `fetch`/XHR in `no-cors` mode.
- Attachments are served with `Content-Disposition: attachment` (`api/attachments/[id]/route.ts:38`), so no user-supplied HTML runs on the AIDA origin. Same-origin script injection would defeat any CSRF check anyway.
- A non-browser client can forge both headers, but it carries no victim cookie. Forgery needs a victim's browser, and the client still needs the bearer token plus a password (sign-in) or a link nobody has used (sign-up).

What the branch does cost is availability, and it fails closed. Browsers send Fetch Metadata only to potentially trustworthy URLs (HTTPS or localhost) and only in recent versions. On a plain-HTTP host, and in older browsers, the card's own post is a 403 JSON page (b-WR-1).

There is a better option that keeps D-04's purpose: `Referrer-Policy: same-origin` for `/invite`. It sends no Referer to any other origin, and the browser then serialises the real Origin on the card's same-origin post. The `null` branch can then go. That is a wording change to D-04 and V-04, so it is the orchestrator's or the owner's decision. The option that keeps D-04 literally is a form token (b-WR-1, fix 2).

**Question 2: is the Team page's display consistent with V-26?** No. `listMembers` gives each user one conservative role, the "for granting" reading. `rowRights` uses that same role for "may I act on this target", which V-26 (3) reads the other way. A user with `owner` and `admin` rows is shown as Admin. A user with `owner` and `member` rows is shown as Member. In both cases an admin is offered a role Select and "Deactivate member", and the server refuses both. The deactivate refusal even says "could not be removed. Wait a moment and try again." (b-WR-2). This is the UI's fault, not the server's. The server is right and fails closed.

The other three warnings:

- b-WR-3: refusals before the 303 reach the invitee as raw JSON, and the accept limit of 10 per hour per address is low for an office joining together.
- b-WR-4: `createInvitation` accepts addresses that Better Auth's sign-up then refuses, which leaves the invitee at a permanent "Something went wrong".
- b-WR-5: the success redirect is absolute on `BETTER_AUTH_URL`. With the documented default (`http://localhost` behind Caddy's HTTPS), that is an HTTPS-to-HTTP redirect after a form post, and CSP `form-action 'self'` should block it *(browser behaviour unverified)*.

## Warnings

### b-WR-1: The `Origin: null` branch depends on Fetch Metadata, which plain-HTTP hosts and older browsers never get, so those invitees cannot join at all

**File:** `src/app/(auth)/invite/[token]/accept/route.ts:80-88`, `:124-127`; `src/lib/security/csp.ts:28`, `:77-81`
**Issue:** The `/invite` page sends `Referrer-Policy: no-referrer`. Under that policy the browser sends the card's own form post with `Origin: null`. The route admits `null` only together with `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`. The Fetch Metadata spec appends those headers only when the request URL is potentially trustworthy, that is HTTPS or localhost *(spec reading, not run in a browser)*. Browsers from before Fetch Metadata send neither header. Examples are Safari before 16.4, which is every iPhone that stops at iOS 15 or early iOS 16, and Firefox before 90 *(version numbers from memory, unverified)*. In all these cases the post is refused with `403 {"error":"forbidden_origin"}`, shown as raw JSON. Nothing in the UI says why, and there is no path that works.

Plain HTTP is not the shipped path: the Caddyfile serves `localhost` with Caddy's local CA, and a real domain with Let's Encrypt. But self-hosters often put AIDA behind their own HTTP-only proxy on a LAN name or IP, and `docs/OPERATIONS.md:639` lists `http://localhost` as an example URL. An internal IT install over `http://aida.lan` would create invitations that nobody can accept. The E2E ran on localhost, which counts as trustworthy, so it cannot see this.

The exact-match branch also compares only against the origin of `BETTER_AUTH_URL`. It ignores `BETTER_AUTH_TRUSTED_ORIGINS` (`OPERATIONS.md:642`, default `http://localhost,https://localhost`), which the project added because the served scheme and the configured one can differ.
**Fix (either one; the first is simpler):**
1. Change the `/invite` policy to `same-origin`. The token-bearing URL is then sent as Referer only to AIDA itself, which already has it, and never to another origin, which is D-04's purpose. Under that policy the Fetch Standard serialises the real Origin for a same-origin POST, so the `null` branch can be removed. Compare `Origin` against the configured origin plus the trusted-origins list. This is a wording amendment to D-04 and V-04 (owner or orchestrator), recorded like R10-1.
2. Keep `no-referrer` and add a synchronizer token. The proxy sets a random nonce cookie (`HttpOnly`, `SameSite=Strict`, `Path=/invite`) on GET `/invite/*`. The page renders `HMAC(BETTER_AUTH_SECRET, tokenHash ‖ nonce)` as a hidden field. The route admits `Origin == configured or trusted`, or else (`Origin` null or absent) with a valid field for the nonce cookie, compared in constant time. This works on HTTP and in old browsers. Whichever you pick, render the 403 as a 303 back to the card with an error state (see b-WR-3).

Also record `dd941e0` as an amendment of V-24 in `10-CONTEXT.md`: V-24 still says that a missing `Origin`, or one that differs, is refused.

### b-WR-2: The Team page shows owner-protected users with mixed rows as Admin or Member and offers controls that the server always refuses

**File:** `src/lib/workspace-members/member-admin.ts:347-357` (role per user), `:216` (server rule); `src/app/(app)/settings/team/team-member-row.tsx:64-73` (`rowRights`); `src/app/(app)/settings/team/actions.ts:117-119`; `src/app/(app)/settings/team/team-copy.ts:113-119`
**Issue:** `listMembers` reduces a user's rows to `conservativeRole`: owner only if every row is `owner`, admin only if every row is `owner` or `admin`. That is V-26 (1) and (2), the reading for what the user may *do*. `rowRights` then uses the same value for what an admin may do *to* that user. V-26 (3) says any `owner` row protects the target.

- **Rows `owner` and `admin`.** The user is shown as "Admin", and an admin actor gets the Select (Member, Admin) and "Deactivate member". `changeMemberRole` and `deactivateMember` both answer `NOT_ALLOWED` at `checkActorAndTarget:216`. The role path shows the "not allowed" callout. The deactivate path maps `NOT_ALLOWED` to `"unknown"`, so the dialog says "{Name} could not be removed. Wait a moment and try again." A retry fails the same way forever.
- **Rows `owner` and `member`.** The user is shown as "Member" and sorted among members, with the same controls and the same refusals.

The server is correct and fails closed, so this is not an authorization hole. But the page contradicts the server, and the copy tells the admin the failure is transient.
**Fix:** carry the protection bit to the client and use it:
```ts
// member-admin.ts, MemberListEntry
hasOwnerRow: boolean; // V-26 (3)
// in listMembers:
hasOwnerRow: e.roles.includes("owner"),

// team-member-row.tsx, rowRights
if (actorRole === "admin" && (member.role === "owner" || member.hasOwnerRow)) {
  return { roleOptions: [], ownerTooltip: true, canDeactivate: false };
}
```
Optionally show a small "mixed roles" hint for such rows (O-4). Also map `NOT_ALLOWED` and `SELF_CHANGE` in `deactivateMemberAction` to a not-allowed copy, as `changeRoleAction` already does, so a permanent refusal is never phrased as "try again". Add an E2E or unit case for `rowRights` with a mixed-row target.

### b-WR-3: Refusals before the 303 reach the invitee as raw JSON, and 10 accepts per hour per address is low for a team joining from one office

**File:** `src/app/(auth)/invite/[token]/accept/route.ts:126`, `:132`, `:138`, `:140`, `:169`; `src/lib/rate-limit/public-limits.ts` (`inviteAccept: max 10, windowMs HOUR_MS`)
**Issue:** The route answers a plain HTML form navigation. Every outcome after the checks is a 303 back to a styled card. But the five early refusals return JSON bodies that the browser renders as text: `forbidden_origin` 403, `rate_limited` 429, `invalid_form_data` 400, `payload_too_large` 413 and `invalid_intent` 400. The page side has amendment A6 (a throttled view shows the server-error card). The route has no equivalent.

The limit is keyed on the client address (an IPv6 /64), which is shared by everyone behind one NAT. Every POST counts, including a wrong password and the retry after it. An admin who invites a 12-person team that joins together from the office will see the 11th person or later get `{"error":"rate_limited"}` for up to an hour. The file itself calls the value a hypothesis. The cost of being wrong is a dead end, and no copy explains it.
**Fix:** for the browser-facing refusals, answer `303` to `/invite/<token>?error=server`, or a new `?error=throttled` (A6 copy), instead of JSON. Keep the status codes for tests through a header, or check the 303 target. Consider keying the accept limit on (address, token hash) with a separate, looser per-address ceiling. That caps password guessing per invitation without throttling a whole office, for example 10 per hour per (address, token) and 100 per hour per address.

### b-WR-4: `createInvitation` accepts addresses that Better Auth's sign-up refuses, so the invitee hits a permanent "Something went wrong"

**File:** `src/lib/workspace-members/invitations.ts:82-87`, `:162-163`; `src/lib/workspace-members/invite-onboarding.ts:186-197`; `src/lib/workspace-members/invite-email.ts:91-102`
**Issue:** `isPlausibleEmail` checks only for one `@`, non-empty parts, no whitespace and at most 254 characters. `signUpAndAccept` passes `view.email` to `auth.api.signUpEmail`. In the installed better-auth, that runs `z.email()` (`node_modules/better-auth/dist/api/routes/sign-up.mjs:17`, `:151`). The installed zod 4.6.7 regex (`v4/core/regexes.js:34`) requires a dotted domain with a letters-only TLD of 2 or more characters, and ASCII letters, digits and `_'+-.` in the local part. *(Which of the two installed zod 4 versions better-auth resolves was not checked; both are 4.x.)* So invitations to `it@intranet`, `ops@corp.local1` or a Unicode local part are created and sent, but a new invitee's sign-up gets 400. The route maps that to `server_error`, which shows "Something went wrong while joining". Every retry gives the same result, and the admin has no indication.

The loose check also lets characters through that nodemailer reads as address syntax. For example, `a,b@example.com` or `<other@example.com>x` makes nodemailer send to a different or extra recipient. `info.accepted` then does not contain the stored string, so the dialog reports `send_failed` and shows the link, although a mail with that link went out *(nodemailer parsing from its documented address-list behaviour, not run)*. The admin typed the address, so this grants nobody new rights, but the delivery status is wrong.
**Fix:** validate with the same rule as sign-up: import `z` and use `z.email().safeParse(email).success` in `isPlausibleEmail`, or reuse the regex. Return `INVALID_EMAIL` otherwise. Add the single-label and comma cases to `invitations.test.ts`. If single-label domains must be supported for internal IT, that needs a Better Auth hook or a custom sign-up schema, so record it as an owner item instead.

### b-WR-5: The success redirect is absolute on `BETTER_AUTH_URL`, which with the documented default is an HTTPS-to-HTTP redirect after a form post

**File:** `src/app/(auth)/invite/[token]/accept/route.ts:58-65`, `:152`, `:161`, `:167`; `src/lib/security/csp.ts:66` (`form-action 'self'`); `.env.example:4`; `Caddyfile` (site `{$DOMAIN:localhost}`)
**Issue:** `seeOther` builds `Location: ${getAppOrigin()}${path}`. `.env.example` and `OPERATIONS.md:639` default `BETTER_AUTH_URL` to `http://localhost`. The shipped Caddy serves `localhost` over HTTPS and redirects HTTP to HTTPS, so the browser is on `https://localhost/invite/...`. The card posts to the relative `/invite/<token>/accept` over HTTPS. The 303 then points at `http://localhost/tickets?joined=1`. CSP `form-action` also applies to redirects of a form submission, and `'self'` on an HTTPS page does not match an `http:` URL. So the browser should block the navigation with a CSP violation after the accept has committed. The member is in, but sees an error page instead of the welcome. *(Caddy's localhost redirect and form-action enforcement on redirects come from documentation, not a live run. `BETTER_AUTH_TRUSTED_ORIGINS` listing both schemes shows the project expects the mismatch.)* The same applies when the browser reaches AIDA through any host other than the configured one: the redirect lands on a host where it holds no session cookie.
**Fix:** answer with a relative `Location` (`/tickets?joined=1`, `/invite/<token>?error=…`). The browser resolves it against the URL it actually posted to, so it depends on no request header and cannot be poisoned (T-10-20 is about links in email, not redirects). `NextResponse` accepts a relative `Location` header as given. Keep `getAppOrigin()` only for the Origin comparison. Add a unit assertion that the Location starts with `/`.

## Info

### b-IN-1: An owner cannot normalise a mixed `owner`/`admin` user to plain Admin in one step

**File:** `src/app/(app)/settings/team/team-member-row.tsx:177`
**Issue:** The user is displayed as "admin", so choosing "Admin" hits `next === member.role` and does nothing. The server would accept it and rewrite the `owner` row to `admin`. The owner has to go through "Member", which revokes the user's pending invitations (`member-admin.ts:278-280`), and then back to "Admin".
**Fix:** with `hasOwnerRow` from b-WR-2, skip the no-op check when the rows are mixed, or offer the current role as an explicit "set all rows" choice.

### b-IN-2: A plain member can read any user's open-ticket count through `reassignTicketsAction`

**File:** `src/app/(app)/settings/team/actions.ts:73-89`, `:129-138`
**Issue:** For a non-admin, `reassignOpenTickets` returns `NOT_ALLOWED`. `runReassignment` then falls through to `countOpenAssignedTickets(orgId, fromUserId)` and returns it as `failed`. Any member can therefore call the action with any user id and get that user's open-assigned count. The page itself counts only for owners and admins (`page.tsx:42-43`). Members can probably see assignments in the inbox, so the exposure is small, but it bypasses the page's own rule. The action also calls `revalidatePath` on a refusal.
**Fix:** return `{ ok: false }` when the service refused for `NOT_ALLOWED` or `INVALID_REASSIGNEE`. Count only on an unexpected error, and only after an admin check.

### b-IN-3: `/invite` is matched as a bare prefix in the proxy and in the no-referrer list

**File:** `src/proxy.ts:17`, `:156`; `src/lib/security/csp.ts:28`, `:77`
**Issue:** `startsWith("/invite")` also matches a future `/invites` or `/invitations` page. Such a page would skip the proxy's login redirect (the page helper would still gate it) and would get `no-referrer`. This follows the existing `/status` pattern, so it is latent.
**Fix:** use `"/invite/"` in both lists, since the page always has a token segment, or match `p === pathname || pathname.startsWith(p + "/")`.

### b-IN-4: The invite link keeps the path of `BETTER_AUTH_URL`, but the form action and the redirects are root-relative

**File:** `src/lib/app-url.ts:51-55`; `src/lib/workspace-members/invitations.ts:239`; `src/app/(auth)/invite/[token]/page.tsx:52`; `accept/route.ts:145`
**Issue:** `getAppBaseUrl` keeps a path (its own doc example is `https://example.com/aida`), and `next.config.ts` has no `basePath`. A `BETTER_AUTH_URL` with a path therefore produces links such as `/aida/invite/<token>` or `/api/auth/invite/<token>` that do not resolve. That second form is a common Better Auth misconfiguration.
**Fix:** build invitation links from `getAppOrigin()`, or refuse a non-root path with `INVITE_CONFIG` until sub-path deployment is supported.

### b-IN-5: The retry path ignores expiry, so an accepted link keeps working for its acceptor

**File:** `src/lib/workspace-members/invitations.ts:443-458`
**Issue:** After acceptance, the same link activates the acceptor's session on that organization with no expiry check, as long as they are still a member. That is harmless, since they are a member anyway, but it contradicts the email ("The link works once and expires on …") and makes the link a permanent "switch organization" handle.
**Fix:** bound the retry path, for example to `now < expiresAt` or a short window after the `INVITATION_ACCEPTED` row's timestamp, and refuse `used` otherwise.

### b-IN-6: The wrong-account Sign out button has no error path

**File:** `src/app/(auth)/invite/[token]/invite-card.tsx:344-350`
**Issue:** If `authClient.signOut()` rejects, `pending` stays `true` and the rejection is unhandled. The button stays disabled until a reload. *(Whether the Better Auth client rejects or resolves `{ error }` on a network failure was not checked.)*
**Fix:** use `try { await authClient.signOut(); router.refresh(); } finally { setPending(false); }`.

### b-IN-7: The README's invite sentence now sits in "When AIDA is not the right choice" as a feature

**File:** `README.md:120-123`
**Issue:** The bullet used to end with a limitation ("no in-product way to invite"). It now ends with a capability, so the bullet reads oddly in a list of reasons not to choose AIDA. The claim itself is accurate: owners as well as admins invite, and the link is shown when email is off or the send failed.
**Fix:** keep the limitation in the bullet ("v1 ships a single workspace in the UI") and move the invite sentence to the features or quick-start section, for example "Invite teammates by email from Settings → Team".

### b-IN-8: The LAST_OWNER copy names admins, but the floor is owners only

**File:** `src/app/(app)/settings/team/team-copy.ts:116-117`
**Issue:** "This would leave the workspace without an owner or admin" is shown for `LAST_OWNER`. Since D-09 was amended (O-10 default), the floor counts only owners, so an owner can remove the last plain admin without this message.
**Fix:** "This would leave the workspace without an owner. Make another member an owner first." If the text is UI-SPEC verbatim, record it as an A-item. It may wait for O-10.

---

_Reviewed: 2026-11-13T02:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
