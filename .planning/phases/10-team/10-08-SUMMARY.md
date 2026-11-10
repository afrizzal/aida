---
phase: 10-team
plan: 08
subsystem: invitations
status: complete
tags: [invitations, onboarding, better-auth, origin-check, rate-limit, privacy, testcontainers]
requires:
  - "10-02: readFreshSession / getCurrentSession, the membership inventory (cookie cache off since 0db72a9, R10-1)"
  - "10-05: acceptInvitation (activation of the requesting session inside the organization-locked transaction), getInvitationView, createInvitation, revokeInvitation"
  - "10-15: /invite in PUBLIC_PREFIXES and NO_REFERRER_PATH_PREFIXES (src/proxy.ts, src/lib/security/csp.ts)"
  - "10-16: inventory file order (Rule E)"
  - "10-17: requirePageAccess first in the (app) layout"
provides:
  - "src/app/(auth)/invite/[token]/page.tsx: rate-limited (inviteView), server-decided card state"
  - "src/app/(auth)/invite/[token]/accept/route.ts: POST, Origin check, inviteAccept limit, bounded form, intents accept / sign-up / sign-in, 303"
  - "src/app/(auth)/invite/[token]/invite-card.tsx: InviteCard (sign_up, sign_in, accept, wrong_account, invalid, throttled)"
  - "src/lib/workspace-members/invite-onboarding.ts: acceptAsSignedIn, signUpAndAccept, signInAndAccept, OnboardingResult, JoinResult, JoinHooks, INVITEE_* limits"
  - "src/lib/rate-limit/public-limits.ts: inviteView (60/min), inviteAccept (10/h)"
  - "src/components/join-welcome-toast.tsx: JoinWelcomeToast, mounted in the (app) layout"
  - "tests/unit/invite-no-log.test.ts: the C12 / V-20 static no-token-logging check"
affects: [10-09, 10-13, 10-14]
tech-stack:
  added: []
  patterns:
    - "A join is a plain HTML form POST to a route handler that answers 303 (no server action, no client fetch); Origin checked before any read"
    - "Better Auth in-process sign-up and sign-in with returnHeaders; the route appends the returned Set-Cookie values to its 303"
    - "Pending state on a native form post: inputs read-only and only the button disabled (a disabled input drops out of the posted form)"
key-files:
  created:
    - src/app/(auth)/invite/[token]/page.tsx
    - src/app/(auth)/invite/[token]/accept/route.ts
    - src/app/(auth)/invite/[token]/invite-card.tsx
    - src/lib/workspace-members/invite-onboarding.ts
    - src/components/join-welcome-toast.tsx
    - tests/integration/invite-onboarding.test.ts
    - tests/unit/invite-no-log.test.ts
  modified:
    - src/lib/rate-limit/public-limits.ts
    - src/proxy.ts
    - src/lib/tenant-seed-lock.ts
    - src/app/(app)/layout.tsx
    - tests/unit/membership-inventory.test.ts
decisions:
  - "A missing or invalid BETTER_AUTH_URL refuses every accept POST with the same 403 forbidden_origin (fail closed); the 303 Location is built from that configured origin, never from the request"
  - "The Set-Cookie values of an in-process sign-up or sign-in are appended to the 303 explicitly; in the Next runtime nextCookies also writes them, and Next merges by cookie name with the response's own cookie winning, so each is sent once"
  - "A sign-up or sign-in whose accept then fails still carries its cookies (C9: the account stays signed in with no membership)"
  - "Password limits: 8 (the setup form's minimum) to 128 (Better Auth's default maximum); name 1 to 100 characters after trim"
  - "Amendment A6: a throttled view renders h1 'Something went wrong while joining.' with body 'Wait a moment and try again.' (the server-error copy split) and the 'Go to sign in' link; a server-side field refusal shows the new callout 'Check your name and password, then try again.'"
  - "The wrong-account card signs out with the existing authClient.signOut call and refreshes the same link, which then renders the signed-out state"
metrics:
  duration: "about 20 minutes (2026-11-12T22:58Z, approximate, to 23:18Z)"
  completed: 2026-11-13
  tasks: 3
  files: 12
actuals:
  tokens: 21200
  tasks: 3
  commits: 4
plan_head_before: d4da355b8f5647f4d0724ef67c96a1d85b82292e
---

# Phase 10 Plan 08: Invitation page and join flows Summary

The invitation link now opens a server-decided card in the (auth) group, and every join (accept as the signed-in user, create an account fixed to the invited address, or sign in) is one plain form POST to `/invite/<token>/accept`. That route refuses a missing or foreign Origin with 403 before any read, then rate-limits, reads a bounded form and answers 303. The accept activates the invited organization inside 10-05's locked transaction. No server action, no client fetch, no general sign-up.

## What was built

- **Rate-limit scopes** (`public-limits.ts`): `inviteView` (`invite-view`, 60 per minute) and `inviteAccept` (`invite-accept`, 10 per hour). Both are hypotheses to tune.
- **Onboarding module** (`src/lib/workspace-members/invite-onboarding.ts`): relative imports only, no `next/*` import, request headers passed in. All three functions share one result mapping: ok → `{ kind: "ok", orgId, workspaceName }`, SESSION_GONE → `signed_out`, INVALID_INVITATION → `invalid`, anything else → `server_error`, plus `wrong_password` for the sign-in path.
  - `acceptAsSignedIn`: one `readFreshSession` read, then `acceptInvitation` with `session: { id }`.
  - `signUpAndAccept`: runs in this order:
    1. `getInvitationView` first: an invalid link or an existing account gives `invalid`, and nothing is created (R3-1).
    2. `setupComplete` must be `"true"`, else `server_error`.
    3. `auth.api.signUpEmail` with `email: view.email`. There is no email parameter, and the tenant seed lock is not taken.
    4. The `afterAccount` seam.
    5. `acceptInvitation` with `session: { token }`.

    The Set-Cookie values come back on every outcome after the account exists.
  - `signInAndAccept`: the view first, then `auth.api.signInEmail` as the invitation's own email. A 401 gives `wrong_password`, then accept runs on the new session.
- **Accept route**: does the checks in this order:
  1. Origin.
  2. `consumeRateLimit(inviteAccept, getRateLimitIdentity(request))`.
  3. `readBoundedFormData` (4 KiB, 4 parts).
  4. The intent: `accept`, `sign-up` (name 1 to 100 after trim, password 8 to 128) or `sign-in` (password 1 to 128).
  5. One onboarding call.
  6. A 303 to one of: `/tickets?joined=1`, `/invite/<token>`, `?error=password`, `?error=field` or `?error=server`.

  An unknown intent is 400 JSON, and a malformed or oversized body is 400 or 413 JSON.
- **Page**: `consumeRateLimit(inviteView, rateLimitKeyForIp(x-aida-client-ip ?? SHARED_CLIENT_BUCKET))` runs before any lookup. A throttled view shows the A6 card and looks nothing up. Otherwise the page calls `getInvitationView` and `getCurrentSession` (fresh) and picks the state:
  - matching email → accept;
  - another email → wrong account, and the invited address is not passed;
  - signed out → sign-in or create-account, by `accountExists`;
  - anything else → invalid.

  The token is in the form action only, never in the page text.
- **Card**: the Card `w-full max-w-[400px] border-border/70 shadow-xl shadow-primary/5`, with one `<h1>` (`text-[18px] font-semibold wrap-anywhere`) and one primary action per state, using the Copywriting rows verbatim. Each form posts to the action path with a hidden `intent` and runs client checks before submit. The pending labels are "Creating account…", "Signing in…" and "Joining…" with a spinner; the button is disabled and the inputs turn read-only. Errors appear as follows:
  - wrong password: the login error copy under the field;
  - field and server errors: the destructive callout with `role="alert"`.

  Spacing is only `space-y-2`, `space-y-4`, `gap-2` and `p-4`, and text sizes are only `text-[12px]`, `[13px]` and `[18px]`.
- **Welcome toast**: `JoinWelcomeToast` reads `joined=1`. It fires `toast.success("Welcome to {workspace name}.")` once (with a toast id and a ref guard), then removes the parameter with `window.history.replaceState`. It is mounted in a `Suspense` in the (app) layout with the layout's `workspaceName`.
- **Comments**: `src/proxy.ts` now names four in-process sign-up callers, including `invite-onboarding.ts`. `src/lib/tenant-seed-lock.ts` states that invitee sign-up does not take the lock.

## Cookie mechanism (flagged assumption resolved as far as tests reach)

- **Proven (integration):** the route appends the Set-Cookie values from `auth.api.signUpEmail` / `signInEmail` (`returnHeaders: true`) to its 303. In the in-process test, Better Auth's `nextCookies` plugin finds no request scope and does nothing (`cookies()` throws "outside a request scope", which the plugin catches). So the explicit append is what carries the cookie: exactly one `session_token` Set-Cookie on the 303, and a fresh read with it names the invited organization.
- **From code reading, unverified at runtime:** in a real Next request, `nextCookies` also calls `cookies().set()` for the same values. Next's `appendMutableCookies` (`next/dist/server/web/spec-extension/adapters/request-cookies.js:93-112`, Next 16.4.6) merges those into the returned response through `ResponseCookies.set` by cookie name, and the response's own values take precedence. So each cookie is written once and the route does not need to detect which mechanism ran. The browser proof is plan 10-13.

## Cookie cache (R10-1)

The session cookie cache stays off (`src/lib/auth.ts`). The tracer mints a pre-accept `session_data` cookie naming organization A with a separate cache-on Better Auth instance (`cachingAuth`, as in `membership-gate.test.ts`). After the accept POST, `readFreshSession` with exactly those cookies names B. A cache-trusting read still names A, which is recorded in the test. With the cache off, this case is defence in depth: AIDA mints no such cookie, and `readFreshSession` stays the only session read.

## How the safety properties are proven (tests/integration/invite-onboarding.test.ts, 21 cases)

| Property | Proof |
|---|---|
| Origin check before any read | No Origin → 403 `{ error: "forbidden_origin" }`, the invitation row deep-equal to before, no member row, and **zero RateLimitHit rows** for that identity (the limiter never ran). A foreign Origin (`https://evil…`, `${ORIGIN}.evil…`, `"null"`) → 403 each, with no limiter row and nothing accepted. |
| Rate limit | The 10 POSTs from one identity are counted (10 limiter rows); the 11th → 429 `{ error: "rate_limited" }` with Retry-After ≥ 1. |
| No general sign-up | Sign-up refuses when an account with the address exists (`invalid`, still one user), when the link was revoked or expired before submit (no user row, R3-1), and when `setupComplete` is absent (`server_error`, no user row). `/api/auth/sign-up` stays blocked (unchanged 10-15 block; `tests/unit/proxy.test.ts` passes). |
| Fixed invited address | `signUpAndAccept` called with a smuggled `email` key creates the user with the invited address only (no user with the smuggled one). The route's sign-up POST with an `email` form field creates the invited address only. Static: `grep -cE "email: *(input|data|form|args|body)\."` prints 0, and the module has exactly one `signUpEmail`. |
| C9 retry | The `afterAccount` seam revokes the invitation, or moves expiresAt into the past (two cases). The result is `invalid`, the user exists, it has no member row anywhere, and the session cookies are signed in with `activeOrganizationId` null. A new invitation to the same address then joins through `signInAndAccept`, and that session is active in the organization. |
| Revoked session (V-23) | The session is first proven valid, then its row is deleted. `acceptAsSignedIn` → `signed_out`, no member row, the invitation still pending, and `signInAndAccept` then joins. SESSION_GONE inside accept (the row deleted in `beforeLock`) → `signed_out`, rolled back. |
| Route outcomes | sign-up → 303 `/tickets?joined=1` with the session cookie; sign-in with the right password → 303 `/tickets?joined=1`; wrong password → 303 `?error=password` with no Set-Cookie; invalid fields → `?error=field` with no account; signed-out accept and an unknown token → 303 back to the link. |

## Inventory entries (tests/unit/membership-inventory.test.ts)

- Rule A: `src/app/(auth)/invite/[token]/page.tsx#InvitePage`, the public onboarding page. It is rate limited first, and it reads the session only through the fresh `getCurrentSession`.
- Rule A: `src/app/(auth)/invite/[token]/accept/route.ts#POST`, Origin-checked, rate-limited public onboarding. It makes one `readFreshSession` read through the onboarding module.
- Rule C: `InvitePage`, for its one fresh `getCurrentSession` read.
- Rule C: `src/lib/workspace-members/invite-onboarding.ts#signUpAndAccept` and `#signInAndAccept`, each with the reason "account creation or sign-in for the exact invited address only …".

## Verification

| Command | Exit | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/membership-inventory.test.ts` (Task 1) | 0 | 43 passed |
| `pnpm test:integration tests/integration/invite-onboarding.test.ts` (Task 1 tracer) | 0 | 1 passed |
| same, Task 2 RED (before the implementation) | 1 | 14 failed, 7 passed (21) |
| same, Task 2 GREEN | 0 | 21 passed |
| `pnpm exec vitest run tests/unit/membership-inventory.test.ts tests/unit/proxy.test.ts` | 0 | 80 passed (2 files) |
| `pnpm exec vitest run tests/unit/invite-no-log.test.ts tests/unit/membership-inventory.test.ts` | 0 | 51 passed |
| `pnpm test tests/unit/invite-no-log.test.ts` (runs the whole unit suite) | 0 | 107 files, 1897 passed |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | 729 files; 1 warning, pre-existing, in `tests/unit/container-config.test.ts:160` (not touched) |
| `pnpm test:integration tests/integration/invite-onboarding.test.ts` (final state) | 0 | 21 passed |

Docker steps ran with `AIDA_TEST_RUN_ID=mwe5fey0-76f523031d6173d2`; `colima status` and `docker info` were healthy before each. No E2E was run (this plan has none), and `.next` was not moved. All acceptance greps of the three tasks print the required values.

## Deviations from Plan

1. **[Inventory] No allowlist entry for `acceptAsSignedIn`, and no Rule C entry for the route.** Plan Task 1 (6) asked for one for the `readFreshSession` call of `acceptAsSignedIn`. The inventory raises no finding there: Rule C judges `readFreshSession` calls only from entries under `src/app`, and the route reaches it only through the src/lib module. An entry that suppresses nothing fails the suite's hygiene case. So only entries that suppress a real finding were added: Rule A for the page and the route, and Rule C for the page and the two account functions.
2. **[Rule 2 - correctness] Inputs read-only, not disabled, while pending.** A disabled input is left out of a native form post, and React flushes the pending state during the submit event. So "disables the form" is done as a disabled button plus read-only inputs, and the hidden `intent` is never disabled. A `pageshow` handler clears the pending state when the page comes back from the back-forward cache.
3. **[Rule 2 - security] Fail closed on configuration.** A missing or invalid `BETTER_AUTH_URL` refuses every POST with the same 403. The password upper bound of 128 (Better Auth's default) is checked in the route, as is the 8 minimum.
4. **[Copy] Amendment A6, for the 10-14 gate:**
   - (a) The throttled card splits the server-error copy into its h1 and body, with the existing "Go to sign in" link.
   - (b) There is new callout copy for a server-side field refusal: "Check your name and password, then try again."
   - (c) There is client field copy reused from existing forms: "Your name is required" and "Password must be at least 8 characters" (setup), and "Password is required" (login). There is one new message, "Use at most 100 characters", which the input's `maxLength` makes practically unreachable.
   - The password help text is the setup rule "Password must be at least 8 characters."
5. **Behaviour detail.** `signInAndAccept` also awaits the optional `afterAccount` seam (no production caller passes hooks). The wrong-account "Sign out" refreshes the same link instead of navigating to /login, so the card turns into the signed-out state, as its body copy says.
6. **TDD.** Task 2 was committed RED (`b0b77c4`, 14 failing) before GREEN (`5a4e73a`).

## Open manual items (never recorded as passed)

- Visual approval of the invitation page in all five Surface 2 states, plus the throttled card (light and dark mode, screen reader).
- The 360px backstops:
  - A 255-character workspace name and a 254-character email wrap inside the 400px card without horizontal scroll.
  - The card never scrolls horizontally in any state.
  - A valid token shows the workspace name, the read-only invited email and exactly one primary action.
  - A user invited to several organizations sees only the token's organization, and accepting one does not accept the others.
- The browser proof of the three join paths, of the welcome toast and of the runtime cookie merge (plan 10-13). Adding `/invite/<token>` to the route list of `tests/e2e/csp.spec.ts` (V-01) is not in this plan's files: not run.

## Blocked

- The SECURITY.md lines of C12 / D-26 are `blocked (08-o4)` (O-6): invitation tokens travel in the URL path, AIDA ships no access log (the Caddyfile has no `log` directive, which `tests/unit/invite-no-log.test.ts` checks), and an operator who enables one records tokens. They are recorded here and go to `10-GATE.md` (plans 10-09 and 10-14).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-10-30, T-10-31, T-10-32, T-10-33 and T-10-33b are mitigated as listed above.

## Commits

- `d687eb8` feat(10-08): invitation page and Origin-checked accept route for a signed-in invitee
- `b0b77c4` test(10-08): failing cases for invitee sign-up and sign-in through the accept route
- `5a4e73a` feat(10-08): create account or sign in fixed to the invited address, then accept
- `c2f2f4c` feat(10-08): create-account and sign-in forms, welcome toast, no-token-logging check

## Self-Check: PASSED

All seven created files exist; commits d687eb8, b0b77c4, 5a4e73a and c2f2f4c exist.
