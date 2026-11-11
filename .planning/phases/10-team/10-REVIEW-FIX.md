# Phase 10: Code Review Fix Report

Fixes for the four-part Phase 10 code review (`10-REVIEW.md`, `10-REVIEW-b.md`, `10-REVIEW-c.md`, `10-REVIEW-d.md`), one section per fix batch (see "Dispositions (orchestrator, 2026-11-13)" in `10-REVIEW.md`, decisions K159 to K177). Every new behaviour is shown red before green. Runs used `AIDA_TEST_RUN_ID=mwecjbxx-c345b639c7117ed3` and the Colima `DOCKER_HOST` with `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, one test process at a time, exit codes read without a pipe.

## F1

**Date:** 2026-11-13. **Scope:** K159 to K163, for findings b-WR-1 to b-WR-5, a-WR-3 and a-IN-2, plus the part b info items that touch the same files (b-IN-2, b-IN-3 with a-IN-5, b-IN-5, b-IN-6). The other part b info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree (`workflow.use_worktrees` is `false`, and the dispatch named the branch). **Result:** 5 of 5 decisions fixed, 4 info items fixed, 10 commits.

### D-04 amendment (K159)

D-04 said the accept page sends `Referrer-Policy: no-referrer`. From F1 on, `/invite/…` sends `Referrer-Policy: same-origin`. This is the run's own decision (K159), not an owner's.

- **Why:** under `no-referrer` a browser sends the card's own form post with `Origin: null`. `dd941e0` then admitted `null` with same-origin navigation fetch metadata. Browsers send that metadata only to HTTPS or localhost, and only recent versions send it at all. Elsewhere the post was refused and nobody could join.
- **What D-04 protects still holds:** `same-origin` sends a `Referer` only to AIDA itself, which already has the token in the accept path. No other origin ever gets it. AIDA loads nothing from another origin.
- **What changes for the route:** the browser now sends the real `Origin`, so the accept route is back to an exact match. `null` is refused, whatever metadata comes with it.
- **Status paths:** `/status` and `/api/public/status` keep `no-referrer`.
- **Not edited:** `10-CONTEXT.md` (D-04, V-04, V-24) and UI-SPEC Surface 2 still say `no-referrer` and a 403. Those amendment entries are left to the orchestrator (`deferred-items.md`).

### b-WR-1, a-IN-2 / K159: `/invite` sends same-origin; the accept route needs an exact Origin

**Change.**
- `src/lib/security/csp.ts`: `/invite` leaves `NO_REFERRER_PATH_PREFIXES`. A new `SAME_ORIGIN_REFERRER_PATH_PREFIXES` gives it `same-origin`. `src/proxy.ts`: comment only.
- `src/app/(auth)/invite/[token]/accept/route.ts`: `isSameOriginPost` admits only an `Origin` string equal to one entry of `getTrustedAppOrigins()`. The `null` plus fetch-metadata branch of `dd941e0` is removed.
- `src/lib/app-url.ts`: new `getTrustedAppOrigins()`. It returns the origin of `BETTER_AUTH_URL`, then every entry of `BETTER_AUTH_TRUSTED_ORIGINS` that is an exact http(s) origin, each once. It skips wildcards, other schemes and garbage.

**Interpretation (flagged).** K159 says "exact Origin match only". I read that as exact string equality against the origins the deployment declares, not against `BETTER_AUTH_URL` alone. The reason is the shipped default:
- `BETTER_AUTH_URL=http://localhost`, and Caddy serves `https://localhost` (`.env.example`, `Caddyfile`).
- So the browser's Origin is `https://localhost`. A match against `BETTER_AUTH_URL` alone refuses every join on the default compose stack. `dd941e0` had only been hiding that.
- `BETTER_AUTH_TRUSTED_ORIGINS` (default `http://localhost,https://localhost`) is the list Better Auth already trusts for its own CSRF checks. b-WR-1's fix 1 names it.
- No other shape is admitted: no wildcard, no `null`, no missing Origin.

**Tests.**
- Unit: `tests/unit/csp.test.ts` G, H and H2; `tests/unit/proxy.test.ts` Z5 and Z6 (`same-origin`); `tests/unit/app-url.test.ts`, four `getTrustedAppOrigins` cases.
- Integration (`tests/integration/invite-onboarding.test.ts`):
  - the two `dd941e0` cases are adjusted. `null` with `same-origin`/`navigate` metadata is now refused, and so is every other `null` or metadata shape;
  - a new case: an exact trusted origin joins, while the same origin with another port, a suffix or a trailing slash is refused.
- E2E:
  - `tests/e2e/team-invitations.spec.ts`, new case "K159: the card's own form post carries the page's real Origin and joins …". It asserts the policy header. It starts a navigation from the card to another origin (`127.0.0.1` against `localhost`) and asserts that the request has no `Referer` and no header holding the token. It then creates the account through the card and asserts that the browser's POST carries `Origin: http://localhost:3100`, lands on `/tickets` with the welcome toast, and has one member row.
  - The D-04 case and the two `/invite` rows of `tests/e2e/csp.spec.ts` assert `same-origin`.

**Runs.**
- Red, unit: exit 1, 8 failed and 52 passed (60).
- Red, integration: exit 1, 2 failed and 22 passed (24). The `null` case answered 303, so it was admitted. The trusted-origin case answered 403.
- Red, E2E (`--grep K159`):
  - Attempt 1 stalled in global setup at `/setup` (`global-setup.ts:174`). The log was kept, `.next` was moved to the Trash, and the run was retried once (see "`.next` moves").
  - Attempt 2: exit 1, 4 failed. The header was `no-referrer` in all four. The new case also failed on a navigation-order fault in the test itself; I fixed the test by waiting for the cross-origin navigation to finish.
  - Attempt 3, the new case alone: exit 1. Two soft failures: `no-referrer` (expected `same-origin`), and the card's POST carried `Origin: "null"` (expected `http://localhost:3100`). The join itself still succeeded through the `dd941e0` branch.
- Green: unit (4 files, with `proxy-security-headers`) exit 0, 62 passed. Integration exit 0, 24 passed. E2E `--grep K159` exit 0, 4 passed. `tsc` exit 0.

**Files:** `src/lib/security/csp.ts`, `src/proxy.ts`, `src/lib/app-url.ts`, `src/app/(auth)/invite/[token]/accept/route.ts`, `src/app/(auth)/invite/[token]/page.tsx` (comment), `tests/unit/csp.test.ts`, `tests/unit/proxy.test.ts`, `tests/unit/app-url.test.ts`, `tests/integration/invite-onboarding.test.ts`, `tests/e2e/team-invitations.spec.ts`, `tests/e2e/csp.spec.ts`.

**Commit:** `13a7b5d` fix(10-F1): K159 /invite sends same-origin and the accept route needs an exact Origin

### b-WR-5 / K160: accept redirects use a relative Location

**Change.** `seeOther` in the accept route takes only a root-relative path. Every 303 now carries `Location: /tickets?joined=1` or `Location: /invite/<encoded token>?…`. The browser resolves it against the URL it actually posted to, so it never jumps from https to http after the form post, and it depends on no request header. `getAppOrigin` is no longer used in the route.

**Tests.** `invite-onboarding.test.ts`:
- the seven `Location` assertions are relative now;
- a new case posts a join from a trusted origin with the other scheme. It gets exactly `/tickets?joined=1`, with no `//` prefix and no configured origin in it.

**Runs.**
- Red: exit 1, 8 failed and 17 passed (25). Each failure was an absolute `http://invite-onboarding.example.test…` Location.
- Green: exit 0, 25 passed.
- In the browser, every join of the E2E runs below follows the relative 303.

**Files:** `src/app/(auth)/invite/[token]/accept/route.ts`, `tests/integration/invite-onboarding.test.ts`.

**Commit:** `23f5314` fix(10-F1): K160 accept redirects use a relative Location

### b-WR-3, a-WR-3 / K161: refusals land on the invitation card; 60 per address and 10 per token

**Change.**
- **Route.** Every refusal before a join is a 303 back to the link, never JSON:
  - a missing or foreign `Origin` → `?error=origin` (the token comes from the path parameter, before any read);
  - either rate limit → `?error=throttled`;
  - a body it cannot read (invalid, too large, too many parts) or an unknown intent → `?error=request`.
- **Page.** `page.tsx` maps the three new values to the existing server-error callout over the card's own form. That is the UI-SPEC copy "Something went wrong while joining. Wait a moment and try again." and amendment A6 for throttling, so no new copy was added.
- **Limits** (`src/lib/rate-limit/public-limits.ts`): `inviteAccept` is 60 per hour per client address. The new `inviteAcceptToken` is 10 per hour per invitation token. Both are consumed in that order, before the token lookup and the body.
- **Token key.** The token limit is keyed on `inviteTokenRateLimitIdentity(token)` (`invite-token:` plus the SHA-256 hash, in `invite-token.ts`), so the raw token is never a limiter key.

**Tests.**
- Integration:
  - a helper asserts the refusal shape: 303, the relative target, no JSON content type, no cookie, empty body;
  - every Origin refusal case now expects `?error=origin` and no limiter row;
  - the 61st post from one address is `throttled`, with a new unknown token each time, and writes no token row;
  - the 11th post for one invitation is `throttled` from a fresh address even with the right password. Nothing is accepted, and another invitation from that address still joins;
  - a JSON body, a 5 KiB body, a five-part body and an unknown intent are each `?error=request`, and none creates an account.
- E2E:
  - `warmAcceptRoute` now polls for the `?error=origin` target;
  - the two V-24 cases assert the 303 target;
  - a new case adds two hidden fields to the real card's form, so the browser's own post has five parts. The browser lands on the card with the callout, no JSON is shown, and no account exists. `?error=throttled` shows the same callout with the form still offered.

**Runs.**
- Red, integration: exit 1, 8 failed and 19 passed (27). Origin refusals were 403, the limit was 10 and not 60, the token scope was missing, and the JSON body got 400.
- Red, E2E (`--grep K161`): exit 1, 3 failed. Both V-24 cases got 403 where 303 was expected. The new case failed at the warm-up, because the refusal had no `Location`.
- Green: integration exit 0, 27 passed. E2E `--grep "K161|K159"`:
  - First run: exit 1, 4 passed and 1 failed. That was a locator fault in the new test: Next's route announcer also has `role="alert"`. The callout itself was present. I fixed the test by filtering the alert by its text.
  - Rerun: exit 0, 5 passed.
- `invite-no-log`, `membership-inventory` and `page-access-inventory` unit: exit 0, 73 passed.

**Files:** `src/app/(auth)/invite/[token]/accept/route.ts`, `src/app/(auth)/invite/[token]/page.tsx`, `src/lib/rate-limit/public-limits.ts`, `src/lib/workspace-members/invite-token.ts`, `tests/integration/invite-onboarding.test.ts`, `tests/e2e/team-invitations.spec.ts`.

**Commit:** `f116202` fix(10-F1): K161 accept refusals land on the invitation card; limits per address and per token

### b-WR-2 / K162: the Team page shows any owner row as Owner and protects it

**Change.**
- `listMembers` (`member-admin.ts`) keeps `role` as the conservative reading, which is what the user may do. It adds `hasOwnerRow`, and `displayRole`, which is `owner` whenever the user holds any `owner` row (V-26 (3)). It sorts by `displayRole`.
- The Team page passes `displayRole` and `hasOwnerRow` to the rows. The actor's own `actorRole` stays the conservative `role`.
- `rowRights` moves to a pure `src/app/(app)/settings/team/team-rights.ts`, together with the `TeamMember` and `RowRights` types. An admin gets neither the Select nor "Deactivate member" on any owner-row target; the owner tooltip shows instead. An owner whose every row is `owner` keeps both, because the server allows it.
- `deactivateMemberAction` maps `NOT_ALLOWED` and `SELF_CHANGE` to a new `not_allowed` key. The dialog then shows the existing role-refusal copy "You can't make this change with your role." instead of "… could not be removed. Wait a moment and try again."

**Tests.**
- Unit, new `tests/unit/team-row-rights.test.ts`: mixed-row targets for an admin actor and an owner actor, plain targets, a member actor and the actor's own row.
- Unit, new `tests/unit/team-actions-refusals.test.ts`: the action runs for real, with the session, the services and `next/cache` mocked. It checks the refusal mapping and the copy.
- Integration, `team-member-admin.test.ts`: `hasOwnerRow`, `displayRole` and the order. The existing duplicate-row case now expects both owner-row users first.
- E2E, `team-deactivation.spec.ts`, new case: users with `owner`+`admin` and `owner`+`member` rows. The admin sees the Owner badge with no Select and no Deactivate on both rows, and both are listed before the admin. The owner sees the Select and Deactivate on those rows.

**Runs.**
- Red, unit: exit 1. `team-rights` did not exist, and the refusal mapping gave `unknown`.
- Red, integration: exit 1, 1 failed and 41 passed (42).
- Red, E2E:
  - Attempt 1 stalled in global setup at `/setup` (`global-setup.ts:173`, the click before the line-174 wait). The log was kept, `.next` was moved, and the run was retried once.
  - Attempt 2: exit 1. "Mixed Owner Admin" had no Owner badge.
- Green: unit (with `membership-inventory` and `member-writers`) exit 0, 62 passed. Integration exit 0, 42 passed. E2E `--grep "K162|D-09"` exit 0, 2 passed. `tsc` exit 0.

**Files:** `src/lib/workspace-members/member-admin.ts`, `src/app/(app)/settings/team/team-rights.ts` (new), `team-member-row.tsx`, `page.tsx`, `deactivate-dialog.tsx` (type import), `actions.ts`, `team-copy.ts`, `tests/unit/team-row-rights.test.ts` (new), `tests/unit/team-actions-refusals.test.ts` (new), `tests/integration/team-member-admin.test.ts`, `tests/e2e/team-deactivation.spec.ts`.

**Commit:** `431098b` fix(10-F1): K162 Team page shows any owner row as Owner and protects it

### b-WR-4 / K163: invite email validated like Better Auth's sign-up, one address only

**Change.** `isPlausibleEmail` (`invitations.ts`) keeps its length, whitespace and single-`@` checks. It then requires `z.email()` of the installed zod 4.6.7, which is the version better-auth 1.7.20 resolves; I checked with `require.resolve` from its package. That is the schema `signUpEmail` applies to the same address later. It refuses:
- single-label domains;
- non-ASCII local parts;
- address-list syntax: commas, semicolons, angle brackets, display names, quoted local parts and IP literals.

The schema is imported from `zod/v4`, as elsewhere in `src`. No package or lockfile changed.

**Tests.** New case in `tests/integration/invitations.test.ts`: ten addresses, among them `it@intranet`, `ops@corp.local1`, `a,b@example.test`, `<other@example.test>x` and `Name <a@example.test>`. Each is `INVALID_EMAIL`, and no row is written. A plus-tagged address on a subdomain is accepted.

**Runs.**
- Red: exit 1, 1 failed and 35 passed (36). `it@intranet` was accepted.
- Green: the first attempt hit `ReferenceError: z is not defined`, because the import line was not added. With the import: exit 0, 36 passed. `tsc` exit 0.

**Files:** `src/lib/workspace-members/invitations.ts`, `tests/integration/invitations.test.ts`.

**Commit:** `ae97491` fix(10-F1): K163 invitation email validated like Better Auth's sign-up, one address only

### b-IN-3, a-IN-5: `/invite` anchored on its token segment

**Change.** `PUBLIC_PREFIXES` in `src/proxy.ts` and `SAME_ORIGIN_REFERRER_PATH_PREFIXES` in `csp.ts` use `"/invite/"`. `/invites`, `/invitations`, `/invited/…` and a bare `/invite` are no longer public, and they get the default referrer policy.

**Tests.** Unit: proxy Z8 checks five such paths, each a 307 to `/login` with `strict-origin-when-cross-origin`. `csp` G and I are updated.

**Runs.** Red: exit 1, 3 failed and 45 passed (48). Green (with `proxy-security-headers` and `proxy-matcher`): exit 0, 55 passed.

**Commit:** `5e2f9da` fix(10-F1): b-IN-3, a-IN-5 anchor the /invite public prefix on its token segment

### b-IN-2: a refused reassignment retry reveals no open-ticket count

**Change.** `runReassignment` in `settings/team/actions.ts` reads the remaining count only when the caller passes `mayCount`. Only `deactivateMemberAction` does, because the deactivation just committed under the actor's admin check. In `reassignTicketsAction`:
- a refusal (`NOT_ALLOWED`, `INVALID_REASSIGNEE`) answers `{ ok: false }` with no count and no `revalidatePath`;
- an unexpected error reports `failed: null`, which the dialog already handles.

**Tests.** Four cases in `tests/unit/team-actions-refusals.test.ts`: both refusals, an error, a success, and the deactivate path that still counts.

**Runs.** Red: exit 1, 2 failed and 5 passed (7). Green (with `membership-inventory`): exit 0, 50 passed. `tsc` exit 0.

**Commit:** `37732f6` fix(10-F1): b-IN-2 a refused reassignment retry reveals no open-ticket count

### b-IN-5: the accept retry path is bounded by the invitation's expiry

**Change.** In the retry path of `acceptInvitation` (`invitations.ts`), at or after `expiresAt` the result is `refuse("expired")`, which is the generic invalid result. A response lost within the expiry is still retried. The header comment is updated.

**Tests.** New case in `invitations.test.ts`: after an accept, `expiresAt` is moved into the past. The retry is `INVALID_INVITATION` with reason `expired`, the session is not moved, and there is still one member row and one audit row.

**Runs.** Red: exit 1, 1 failed and 36 passed (37). The retry returned `ok: true`. Green, `invitations` plus `invite-onboarding`: exit 0, 64 passed.

**Commit:** `41dc9ed` fix(10-F1): b-IN-5 the accept retry path is bounded by the invitation's expiry

### b-IN-6: the mismatch card's Sign out recovers from a network failure

**Change.** `WrongAccount.handleSignOut` in `invite-card.tsx` now uses try/catch/finally. On a rejection the card stays as it is and the button is usable again. The installed `@better-fetch/fetch` 1.3.3 awaits `fetch` with no catch (`dist/index.js:514`), so a network failure rejects.

**Tests.** New E2E case in `team-invitations.spec.ts`. The sign-out request is aborted once; the button is enabled again and the mismatch card is unchanged. After `unroute`, the second click signs out and the join card appears.

**Runs.** Red: exit 1, "Expected: enabled, Received: disabled". Green, with the D-05 case: exit 0, 2 passed.

**Commit:** `d113f7c` fix(10-F1): b-IN-6 the mismatch card's Sign out recovers from a network failure

### Other part b info items

These are recorded in `deferred-items.md`, one row each:
- b-IN-1 is covered in substance by K162. A mixed user now shows as Owner, so choosing Admin works in one step. It has no test of its own.
- b-IN-4 goes to F2 (K165).
- b-IN-7 is README wording.
- b-IN-8 is UI-SPEC verbatim copy, owner item O-10.

The same file also records the D-04, V-24 and UI-SPEC wording that K159, K161 and K162 amend, and that wildcard trusted origins are skipped.

**Commit:** `d5ab2b4` docs(10-F1): record part b info items and amendments not done in F1

### Final checks

Run at `d5ab2b4`, after the last commit. `colima status` exit 0 and `docker info` exit 0 before the Docker steps.

| Command | Exit | Counts |
|---|---|---|
| `pnpm typecheck` | 0 | 0 errors |
| `pnpm lint` | 0 | 763 files, 1 warning, pre-existing and known: `tests/unit/container-config.test.ts:160` |
| `pnpm test` | 0 | 112 files, 1985 tests passed |
| `vitest --config vitest.integration.config.ts` `invite-onboarding`, `invitations`, `team-member-admin` | 0 | 3 files, 106 passed |
| `playwright test` `team-invitations.spec.ts`, `csp.spec.ts`, `team-deactivation.spec.ts` (all three in full, one process) | 0 | 36 passed (17, 14 and 5), 0 failed, 0 flaky |

The unit run includes `membership-inventory.test.ts` (Rules A to E), which passed. The session cookie cache is still off (`src/lib/auth.ts:17`, `cookieCache: { enabled: false }`, from `0db72a9`). `readFreshSession` stays the only session read. F1 did not touch `auth.ts`, `fresh-session.ts`, `package.json`, the lockfile or the schema.

Not run: the full `pnpm test:integration` and the full `pnpm test:e2e`. Only the integration files and E2E specs that F1 changed, or that pin the changed behaviour, were run. No other integration file references the accept route, the invitation limits, `listMembers`, `csp.ts` or `app-url.ts` (checked with `grep`).

### Not done, and limits

- **Manual items:** I made no visual, dark-mode or screen-reader check of the refusal callouts, the Owner badge on mixed rows, or the re-enabled Sign out button.
- **Browser coverage:** the E2E ran in Chromium on `http://localhost:3100`. No other browser, no plain-HTTP LAN host and no browser without fetch metadata was run. That the real Origin is sent under `same-origin` is proven in Chromium only.
- **Default compose stack:** no run used Caddy (`https://localhost` with `BETTER_AUTH_URL=http://localhost`). The scheme mismatch is covered only by the integration case that posts from a trusted origin with the other scheme.
- **The `/setup` stall (owner item next-o1):** it happened twice and was handled as the dispatch says (see "`.next` moves"). The cause is not fixed.
- **Report:** this file is written and left uncommitted for the orchestrator.

### `.next` moves

Both moves followed a stall in the E2E global setup at `/setup` (owner item next-o1). In each case the dev-server output was kept in the run's log, `.next` was moved with `mv` (never deleted), and the run was retried once. Both retries passed the global setup.

1. K159 red, attempt 1, at 09:26: `page.waitForURL` timeout at `global-setup.ts:174`. The server log shows only repeated `GET /setup` and "Compiled" lines. Moved to the Trash folder `aida-next-1794536825`.
2. K162 red, attempt 1, at 09:41: `locator.click` timeout on "Create workspace" at `global-setup.ts:173`, while `/setup` kept navigating. Moved to the Trash folder `aida-next-1794537728`.

## F2

**Date:** 2026-11-13. **Scope:** K164 and K165, for findings a-WR-1 and a-WR-2, plus b-IN-4 (the same root cause as a-WR-2) and a-IN-7 (it touches the same routes as K164). The other part a info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree (`workflow.use_worktrees` is `false`, and the dispatch named the branch). Runs used `AIDA_TEST_RUN_ID=mweduwiq-bf4e247751ce7dbf`. **Result:** 2 of 2 decisions fixed, 2 info items fixed (b-IN-4, a-IN-7), 3 commits.

**How red was shown.** Each new test was run and seen failing before the fix it pins, except where the fix was already written when the test first ran. There the red run used the old behaviour put back by hand in the one or two lines that carry it (marked `TEMP-RED`, never committed), and the file was restored from a copy in the run's temporary directory right after. No `git checkout`, `git restore` or `git stash` was used. Each such run says so below.

### a-WR-2, b-IN-4 / K165: links use the bare origin; a path stops the app and the worker at start

**Change.**
- `src/lib/app-url.ts`: `parseAppUrl` refuses a `BETTER_AUTH_URL` that is not a bare origin with the new reason `not_origin`. That covers any path (`/aida`, `/api/auth`, `//`), a query, a fragment (also an empty `?` or `#`) and credentials. `getAppBaseUrl` returns the origin only. `getAppOrigin` and `getTrustedAppOrigins` refuse the same values, so the accept route's Origin check fails closed on them. The message names the variable and what is expected, never the value.
- **Where start-up validation lives:** the new `assertAppUrlAtStart(env)` in `app-url.ts`, which is framework-free and uses relative imports only, so the worker bundle can load it. It is called in `src/instrumentation.ts` `register()`, right after the database URL check, and in `src/lib/worker/index.ts` before pg-boss is created. This is the same pattern as `assertDatabaseUrlConsistent`. On `AppUrlError` each logs one `[boot] …` line and exits 1.
- **An unset value is not refused at start.** Today's paths stay: invitations answer `INVITE_CONFIG` and the digest pass refuses. K165 asks only for a path to be refused.
- **Docs:** one comment block in `.env.example`; in `docs/OPERATIONS.md`, a paragraph under "The email digest" and the `BETTER_AUTH_URL` row of the variable reference; the same row on the website's environment page.

**Tests.**
- Unit, `tests/unit/app-url.test.ts`:
  - the path cases are refused with `not_origin` by all three readers;
  - query, fragment and credentials are refused;
  - the message carries no value;
  - `assertAppUrlAtStart` passes for a bare origin and for an unset value, and refuses `not_origin`, `invalid` and `scheme`;
  - the old case "keeps a path prefix" is replaced.
- Unit, new `tests/unit/app-url-boot.test.ts`:
  - `register()` with four bad values exits 1, logs `[boot]` and `BETTER_AUTH_URL` but not the value, and runs no tenant bootstrap; two bare origins start normally;
  - the worker runs for real through `tsx` with `DATABASE_URL` pointed at loopback port 1. It exits 1 with the `[boot]` line and no connection error.
- Integration:
  - `invitations.test.ts`: the `INVITE_CONFIG` case adds `…/aida` and `…/api/auth`; nothing is written;
  - `notification-digest.test.ts`, new case: with both path values `runDigests` throws `AppUrlError` `not_origin` before any claim, so there is no digest row and no mail. Restored, the same notification is sent with an origin-only link.

**Runs.**
- Red, unit: exit 1, 10 failed and 12 passed (22). The worker's red was `[worker] fatal: Error: connect ECONNREFUSED 127.0.0.1:1`, so it got past where the check now sits.
- Red, integration, with the old path-keeping lines put back by hand: exit 1, 2 failed and 60 passed (62).
  - The invitation with `…/aida` was created (`ok: true`).
  - The digest pass with `…/aida` sent its email.
- Green:
  - Unit: exit 0, 22 passed. The first attempt had one `tsc` error in the new test (a spawn `env` without `NODE_ENV`); after the fix `tsc` exit 0.
  - Integration, `invitations`, `notification-digest` and `invite-onboarding`: exit 0, 89 passed.

**Files:** `src/lib/app-url.ts`, `src/instrumentation.ts`, `src/lib/worker/index.ts`, `.env.example`, `docs/OPERATIONS.md`, `website/src/content/docs/configuration/environment.md`, `tests/unit/app-url.test.ts`, `tests/unit/app-url-boot.test.ts` (new), `tests/integration/invitations.test.ts`, `tests/integration/notification-digest.test.ts`.

**Commit:** `4bcae5e` fix(10-F2): K165 links use the bare origin of BETTER_AUTH_URL; a path stops app and worker at start

### a-WR-1 / K164 (with a-IN-7): no active organization or no member row is the typed MEMBERSHIP_ENDED refusal

**Change.**
- **The gates.**
  - `AccessDeniedError` (`src/lib/membership.ts`) now carries `code: "MEMBERSHIP_ENDED"` beside `status: 403`.
  - `getSessionActor` throws it when the session names no organization, like `getScopedDb`. It used to throw a plain `Error`.
  - `requireOrgAdminScope` throws it for no organization or no member row. A member without an admin role keeps `Error("Forbidden: admin role required")`, the v1 role refusal, which K164 does not cover (see `deferred-items.md`).
- **One refusal path for actions.** New framework-free helpers in `membership.ts`:
  - `nullOnAccessDenied` turns only `AccessDeniedError` into null and rethrows everything else, the redirect to `/login` included;
  - `membershipEnded()` builds the refusal, and `isMembershipEnded()` tests for it on the client;
  - `membershipEndedNotice()` is for the three v1 forms that display `error`. It carries the code and the app's sentence from `state-copy.ts`.
- **Every server action that calls a gate**, 66 in all, now refuses this way. On the refusal it returns at once, before any read, write or `revalidatePath`, so the page is not re-rendered and keeps its state (R10-1).
  - 54 actions read the gate as `await gate().catch(nullOnAccessDenied)`.
  - The 7 KB proposal actions map `AccessDeniedError` in their existing catch.
  - The 5 notification actions already did this.

  What each returns:
  - `{ ok: false, error: "MEMBERSHIP_ENDED" }` for the ticket, bulk, merge, relation, snooze, saved-view, new-ticket, status, SLA, contact, insight, KB, tag, custom-field delete, AI and email actions;
  - `{ ok: false, code: "MEMBERSHIP_ENDED" }` for the KB proposal actions, and `{ kind: "MEMBERSHIP_ENDED" }` for the start selection. These used to map the thrown error to UNKNOWN;
  - `membership_ended` for the Team actions, a new key in `team-copy.ts`. Its copy is the app's existing access-ended sentence, so no new copy;
  - for saveBranding and create/update custom field, the code with the sentence in `error`;
  - the notification and notification-settings actions return their existing `membership_ended`.

  The gate call stays inside each exported action, so the membership inventory (Rules A and C2) sees it unchanged.
- **Routes.**
  - The logo route answers 403 `membership_ended` for no organization or no member row. It used to answer 401 and 403 `not_allowed`.
  - The messages, notifications and mentionable routes already answered 403. The attachment route keeps its deliberate 404 (D-08, no existence oracle).
- **Client.** These show the access-ended sentence instead of "… Try again":
  - the ticket header's eight field changes (`fieldChangeError`);
  - the Team dialogs (through the copy keys);
  - the logo card;
  - the three connection-test buttons.

  The other v1 forms keep their own failure line, and their state is kept (`deferred-items.md`).
- **a-IN-7.** New `src/lib/http/gate-failure.ts`. In the attachment, messages, notifications, mentionable and logo routes, only Next's redirect error is a 401. It is recognised by its `NEXT_REDIRECT;replace|push;…` digest, the same test as Next's `isRedirectError`. Any other gate failure is a 500 with one fixed line, `[<route>] session gate failed: <error class>`, with no error text in the line or the body. Server actions rethrow such a failure; it is not reported as MEMBERSHIP_ENDED.

**Tests.**
- Unit, new `tests/unit/membership-ended-refusals.test.ts`, 107 cases. The real gates, actions and routes run; Better Auth's `getSession`, the member read, Next's request scope and cache, and the queue are replaced, and every other database access throws and is recorded.
  - All three gates throw the typed error; the non-admin role refusal is unchanged.
  - Without an active organization, every one of the 66 server actions in the table returns its refusal. Each reads the session once, touches nothing and revalidates nothing.
  - The 33 actions behind `getScopedDb` or `requireOrgAdminScope` do the same with no member row.
  - The routes answer 403, and the attachment 404, in both states.
  - a-IN-7: a throwing session read gives 500 on all five routes, with no error text in the body or the log. With no session the answer is still 401. Actions rethrow the failure.
- Integration, new `tests/integration/membership-ended-refusals.test.ts`: real sign-up and sign-in, the real `deactivateMember`, a one-organization install.
  - First, presence: `changePriority` succeeds and the bell answers 200.
  - After deactivation the session row's `activeOrganizationId` is null. Seventeen representative actions return their refusal with no `revalidatePath`. The four routes answer 403, and the attachment 404. A database snapshot is unchanged: the ticket fields, counts of tickets, audit events, tags, views, states, settings, proposals and messages, and the member rows.
  - A second case keeps the organization on the session and deletes the member row, with the same result. There the Team action answers `not_allowed`, from the 10-03 service; it is not thrown.
- Updated: `membership-gate.test.ts` (the mocked redirect carries Next's digest; a non-member is refused by `requireOrgAdminScope` with `AccessDeniedError`), `authz-conservative-membership.test.ts` (no member row is `AccessDeniedError`), `tests/unit/logo-upload-route.test.ts` (role null is `membership_ended`), `tests/unit/settings-connection-actions.test.ts` (type narrowing only).
- E2E, `tests/e2e/team-deactivation.spec.ts`, V-27 case: after the refused assignment from the open ticket page, the access-ended sentence is visible and "Couldn't update assignee. Try again." is not. The URL and the header are unchanged.

**Runs.**
- Red, unit, with the two original gate lines put back by hand and no caller changed yet: exit 1, 94 failed and 13 passed (107).
  - The actions rejected with `Error: No active organization on session — cannot scope queries` or `Error: Forbidden: admin role required`, or answered `UNKNOWN`.
  - The logo route answered 401 and `not_allowed`. The routes answered 401 to a database failure.
- Red, integration, with the same two lines put back by hand: exit 1, 3 failed and 26 passed (29), across `membership-ended-refusals` and `membership-gate`.
- Red, E2E (`team-deactivation.spec.ts --grep V-27`), with the `getSessionActor` line put back by hand: exit 1. The sentence was not found, and the page showed "Couldn't update assignee. Try again.". Global setup did not stall.
- Green:
  - Unit, the new file: exit 0, 107 passed.
  - Integration, `membership-ended-refusals`, `membership-gate` and `authz-conservative-membership`. The first run gave exit 1, with one existing case still expecting "Forbidden" for no member row. I updated it to K164's contract. Then exit 0, 38 passed.
  - `tsc` exit 0. Three client buttons and one test needed narrowing for the new result variant.

**Files:** `src/lib/membership.ts`, `src/lib/session.ts`, `src/lib/authz.ts`, `src/lib/http/gate-failure.ts` (new), 23 server action files under `src/app/(app)/`, `team-copy.ts`, `logo-card.tsx`, the three connection-test buttons, `src/components/tickets/ticket-meta-header.tsx`, the five routes named above, `tests/unit/membership-ended-refusals.test.ts` (new), `tests/integration/membership-ended-refusals.test.ts` (new), `tests/integration/membership-gate.test.ts`, `tests/integration/authz-conservative-membership.test.ts`, `tests/unit/logo-upload-route.test.ts`, `tests/unit/settings-connection-actions.test.ts`, `tests/e2e/team-deactivation.spec.ts`.

**Commit:** `1575ec4` fix(10-F2): K164 no active organization or member row is a typed MEMBERSHIP_ENDED refusal; a-IN-7 gate failure is 500. a-IN-7 shares the commit with K164: both change the same five catch blocks and are pinned by the same unit file.

### Other part a info items

These are recorded in `deferred-items.md`, one row each:
- a-IN-1: `auth.ts`, the session setup F2 leaves alone;
- a-IN-3: page files and `page-access.ts`;
- a-IN-4: a page behaviour, which K164 leaves to `requirePageAccess`;
- a-IN-6: a schema change, which is not allowed.

a-IN-2 and a-IN-5 were fixed in F1. The same file records four K164 and K165 limits:
- the v1 form copy;
- the Team service's `not_allowed` for a non-member actor whose session still names the organization;
- the unchanged non-admin role refusal;
- the stale "sends no referrer" sentence in `docs/OPERATIONS.md` (K159).

**Commit:** `108beba` docs(10-F2): record part a info items and K164 limits not done in F2; b-IN-4 fixed

### Final checks

Run at `108beba`, after the last commit. `colima status` exit 0 and `docker info` exit 0 before each Docker step.

| Command | Exit | Counts |
|---|---|---|
| `pnpm typecheck` | 0 | 0 errors |
| `pnpm lint` | 0 | 767 files, 1 warning, pre-existing and known: `tests/unit/container-config.test.ts:160` |
| `pnpm test` | 0 | 114 files, 2101 tests passed |
| `vitest --config vitest.integration.config.ts`: `membership-ended-refusals`, `membership-gate`, `authz-conservative-membership`, `invitations`, `notification-digest`, `invite-onboarding` | 0 | 6 files, 127 passed |
| `pnpm test:integration` (full, once) | 0 | 132 files, 1849 tests passed, 467.6 s |
| `pnpm test:e2e` `team-deactivation`, `bulk-actions`, `snooze`, `ticket-statuses` (one process) | 0 | 52 passed (5, 12, 15 and 20), 0 failed, 0 flaky |

The unit run includes `membership-inventory.test.ts` (Rules A to E) and `page-access-inventory.test.ts`, and both passed.
- The session cookie cache is still off (`src/lib/auth.ts:17`, `cookieCache: { enabled: false }`, from `0db72a9`).
- `readFreshSession` stays the only session read.
- F2 did not touch `auth.ts`, `fresh-session.ts`, `page-access.ts`, `package.json`, the lockfile or the schema.

Not run: the full `pnpm test:e2e`. Only the four refusal specs the dispatch named were run.

### Not done, and limits

- **Manual items:** I made no visual, dark-mode or screen-reader check of the access-ended toasts, callouts and dialog lines.
- **Browser coverage:** the E2E ran in Chromium on `http://localhost:3100` only.
- **Default compose stack:** no run used the compose stack. The start-up refusal is proven by `register()` in a unit test and by the worker run through `tsx`, not by a container that exits.
- **Report:** this section is written and left uncommitted for the orchestrator.

### `.next` moves

None. Global setup did not stall in either E2E run (the K164 red run and the final run).
