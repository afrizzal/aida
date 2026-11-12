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

## F3

**Date:** 2026-11-13. **Scope:** K166 to K170, for findings c-WR-01 to c-WR-05, plus the part c info items that touch the same files: c-IN-01, c-IN-04, c-IN-06 (the `Auto-Submitted` header, inside K170), c-IN-07 (the OPERATIONS.md wording) and c-IN-08. It also corrects the stale referrer sentence in `docs/OPERATIONS.md` (K159). The other part c info items are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree (`workflow.use_worktrees` is `false`, and the dispatch named the branch). Runs used `AIDA_TEST_RUN_ID=mwefaccq-0e2003a50e1b59ac`. **Result:** 5 of 5 decisions fixed, 5 info items fixed, 11 commits. **Schema:** unchanged.

**How red was shown.** Each new test was run and seen failing before its fix, except K168 and K169. For those two the code was already in place when the test first ran. The red run then put the old behaviour back by hand in the lines that carry it (marked `TEMP-RED`, never committed). The files were restored from a copy in the run's temporary directory right after. No `git checkout`, `git restore` or `git stash` was used.

### c-WR-01 / K166: one rule for unassigned-fallback rows in the bell and in the digest

**Change.**
- **The rule.** It follows V-28 and the Settings copy ("Owners and admins get these, in the app and in the digest"). A fallback row is decided by two things only: the "Unassigned tickets" switch, and the recipient being an owner or admin. The per-type switches ("… on my tickets", "… assigned to you") apply to the recipient's own tickets only.
- **The bell side.** The bell already followed this rule (`emitForTicket`).
- `store.claimDigestCandidates`: it claims non-fallback rows by the type list, and fallback rows by `includeFallback` alone, whatever their type. An empty type list with `includeFallback` now claims the fallback rows.
- `digest.recheck` applies the same split.
- Comments are updated in `digest.ts`, `store.ts` and `emit.ts`.

**Tests.** `notification-digest.test.ts`, new describe K166. The rows come from the real `emitForTicket`, and the bell is read through `listRecent` and `countUnread`.
- With "Customer replies: in app" off (owner) or "digest" off (admin) and "Unassigned tickets" on, the reply on an unassigned ticket shows in both bells and in both digests, on the "On unassigned tickets" line.
- Control: the same switches still govern assigned rows. The owner gets no row. The admin gets a bell row, which stays out of the digest and undigested.
- With the switch off, the owner gets no new row, and an existing fallback row is not claimed. The admin still gets both.
- `notifications-core.test.ts`: the claim case is updated to K166 (`[]` with `true` returns the fallback row).

**Runs.** Red: exit 1, 1 failed and 1 passed. Both pairs reported `nothing`, where `sent` was expected. Green, with `notifications-core` and `notification-emitters`: exit 0, 78 passed. `tsc` exit 0.

**Commit:** `ebffff8`

### c-WR-02 / K167: the SLA pass is bounded

**Change.** `src/lib/worker/jobs/sla-flag.ts`:
- **Discovery.** Each pass first reads the organizations that have candidates. This is a plain read outside any transaction, with no lock.
- **One transaction per organization**, in id order. It locks at most `SLA_PASS_ROW_CAP` = 500 of that organization's candidates: the lowest ids, with `LIMIT` before `FOR UPDATE OF t SKIP LOCKED`. It flips them and notifies exactly the flipped rows in the same transaction. The rest waits for the next run.
- **The predicates are unchanged.** Discovery and the lock share one `Prisma.sql` fragment per pass. The UPDATE re-checks are unchanged.
- **A failing organization rolls back alone.** It gets no at-risk pass in that run. The handler rethrows the first failure after both passes.
- **Interpretation (flagged).** "A per-pass row cap" is applied per organization and per pass, so one tenant's backlog cannot starve the others.
- **Unchanged:** SKIP LOCKED, the 30-second transaction timeout and the Phase 12.1 ticket-mutation lock order (step 4 of the `mutations.ts` header).
- **Seams.** The hooks receive the organization id as their last argument. A new test seam is `rowCap`.

**Tests.** `sla-flag-handler.test.ts`, new describe K167:
- **Backlog above the cap** (`rowCap: 3`): 5 tickets in org A and 2 in org B. Run 1 locks A's 3 lowest ids and B's 2, in two transactions (two different `txid_current()`). Inside each transaction the notification count equals the flipped rows. Run 2 flips A's last 2, and run 3 adds nothing.
- **The shipped cap:** 501 overdue tickets, then 500 flags and 500 notifications, then 501.
- **A failure in org A's transaction:** org B commits, A has nothing and is not at risk, the handler rejects, and the next run flags A.

Two existing suites are adjusted for one transaction per organization:
- `sla-pause-race.test.ts`:
  - orders 1 and A expect `[["breach", []]]`, because the at-risk pass has no candidate, so it opens no transaction;
  - `drain` repeats until a run locks nothing.
- `notification-race.test.ts`: the three hold and PID hooks act on the case's own organization.

The proofs themselves did not change: the worker never waits on a held row, and the deactivation commits while the pass is parked.

**Runs.**
- Red: exit 1, 3 failed. The hooks got no organization, and there was no cap and no export.
- First green run of the race suites: exit 1, 4 failed. Order 1 expected an at-risk entry. Its failure left the resume holding its rows, and that broke A, B and C after it. After the two expectation changes, the drain loop and the organization filter: exit 0.
- The Phase 12.1 and SLA set: `sla-flag-handler`, `sla-pause-race`, `notification-race`, `sla-pause`, `sla-pause-migrated` and `snooze`. Exit 0, 59 passed.

**Commit:** `201e4f9`

### c-WR-03 / K168: privacy tests for the bell route and actions

**Change.** Tests only: the new `tests/integration/notifications-privacy.test.ts`.
- **Setup.** The route and the three actions run for real, with a real Better Auth sign-in. Only `next/headers` is replaced.
- **What Y holds.** Member Y has the ids of X's row in the same organization, of Z's row in another organization where Y is also a member, and of Y's own row there. The session names the first organization.
- **The route.** List and count return Y's two rows only. That holds even with `user=`, `recipientUserId=`, `userId=`, `organizationId=` and `orgId=` in the query.
- **Read and archive** change Y's own row, and answer `changed: false` for the other three, which stay unread and not archived.
- **Mark all** marks 2.
- **No member row:** the route answers 403 `membership_ended`, the actions return `membership_ended`, and nothing changes.
- **No session:** 401.

**Runs.**
- On the current code: exit 0, 5 passed. The first attempt failed in the test fixture itself: the sign-up session is a second session row, so the check now looks up the sign-in token.
- Red, with `TEMP-RED` lines: the route read `?user=`; read and archive used the row's own organization and recipient; mark-all updated across organizations. Exit 1, 3 failed and 2 passed.
- Restored: green.

**Commit:** `570408b` (test)

### c-WR-04 / K169: the digest through pg-boss; no overlap by design

**Change.**
- **One registration function.** `registerNotificationDigest(boss, env)` in `notification-digest.ts` is called by `worker/index.ts`. It creates the queue `{ policy: "singleton", retryLimit: 0, expireInSeconds }` and then `updateQueue`s the same options, which corrects an install whose queue had only `policy: "singleton"`. Then it registers the worker and the schedule.
- **Expiry.** `digestExpireSeconds` is the interval, at most 23 h; pg-boss refuses an expiry of 24 h or more.
- **The signal.** The handler passes the job's `AbortSignal` to `runDigests`, which stops before its next claim (`stopped: true`).
- **Why that is enough.** An expired run is never retried, and it stops after the pair in flight. The per-pair lock and the lease keep that one pair apart from the next run.
- **No ids stored.** The handler's result (which holds ids) is not returned to pg-boss, so it is never stored as job output.
- **The wrong comments are corrected.**

**Tests.** New `tests/integration/notification-digest-job.test.ts`. A real `PgBoss` keeps its tables in a database of its own on the same server, so the shared database gains no `pgboss` schema. The handler uses the app's client on the shared database.
- **Queue options:** exact.
- **Registration**, after a pre-K169 `createQueue`:
  - `getQueue` shows singleton, `retryLimit` 0 and 14400 s;
  - the schedule is `0 */4 * * *`;
  - one `send` ends `completed`;
  - the fake SMTP has one digest with the link, the row is SENT, and the job's output is null.
- **An aborted signal** claims and sends nothing. A live one sends.
- **Abort during a pair:** that pair is sent, and the next pair is not claimed.

**Runs.** Red, with the pg-boss defaults (`retryLimit: 2`, 900 s) and the signal dropped (`TEMP-RED`): exit 1, 4 failed. Green: exit 0, 4 passed. With `notification-digest`: 31 passed. Unit `digest-config` and `app-url-boot`: 39 passed.

**Commit:** `79b023e`

### c-WR-05, c-IN-06 / K170: failures are logged by class and code; a 5xx closes the batch

**Change.**
- **Logging.** New `digest-log.ts`:
  - each line is `class=<err.name>[ code=<identifier>][ reply=<smtp code>]`, and a value that is not a plain identifier is dropped;
  - every failed send logs `send rejected (permanent|transient): …` or `send ambiguous: …`;
  - every throwing pair logs `pair failed: …`;
  - the handler logs one `run: pairs=… sent=… rejected=… rejectedPermanent=… ambiguous=… failed=… leaseShort=… stopped=…` line per run, and `run failed: class=…` before it rethrows.
- **Classification.** `classifySendResult` marks a 5xx as `permanent`. That includes a recipient in `info.rejected`, through its `rejectedErrors` code.
- **What a permanent rejection does.**
  - It moves CLAIMED to CANCELED and stamps the rows it tried to send, in one transaction (outcome `rejected-permanent`).
  - Later runs write no row for them, and they stay in the bell.
  - A new notification starts a new batch.
  - A 4xx keeps today's RELEASED.
- **No schema change.** There is no FAILED state, and the reason is in `deferred-items.md`.
- **The header.** The digest carries `Auto-Submitted: auto-generated`. The inbound path honours it: `isAutoGenerated` treats any value other than `no` as automatic, so such mail never opens and never reopens a ticket (D-13).
- **The fake SMTP** gains a `reject-auth` mode (535) and a `rejectCode` option.

**Tests.**
- Unit, new `tests/unit/digest-send-classify.test.ts`: 4xx against 5xx, `rejectedErrors`, ambiguous, and the label (no address; a bad name or code is dropped).
- Integration, `notification-digest.test.ts`:
  - **4xx (450, 451, 452):** the three R2-5 cases now run as transient rejections, with unchanged assertions.
  - **5xx (550 RCPT, 554 DATA, 554 after the data, 535 AUTH):** the outcome is `rejected-permanent` and the row is CANCELED with its rows stamped. Three more runs write no row and connect for nothing. The rows are still unread in the bell. A new notification is sent alone.
  - **Logs:** the lines carry class, code and reply, and never an organization, user, notification or ticket id, an address, `@example.test`, the server's reply text, the error message or the subject.
  - **The summary line:** exactly one per run, and `run failed: class=AppUrlError` before the rethrow.
  - **The tracer:** it asserts `auto-submitted: auto-generated` and `isAutoGenerated(mail) === true` on the delivered digest.

**Runs.** Red, unit: exit 1, the module was missing. Red, integration: exit 1, 7 failed and 26 passed (the header was missing, the 5xx cases gave `rejected`, the hooks were not passed). Green: unit exit 0, 6 passed. Integration (with the job file): exit 0, 37 passed.

**Commit:** `985187d`

### c-IN-01: an auto-reply threaded onto a ticket notifies nobody

**Change.** `ingest-message.ts` skips `emitForTicket` when `isAuto`. The inbound path already detected auto mail and never reopened on it.

**Test.** `notification-emitters.test.ts`, new case. A human reply notifies (presence). Then `Auto-Submitted: auto-replied`, `Auto-Submitted: auto-generated` and `Precedence: auto_reply`, each on an assigned and an unassigned ticket, are appended and add no row.

**Runs.** Red: exit 1, 10 rows where 1 was expected. Green, with `email-ingest`: exit 0, 32 passed.

**Commits:** `6ac545c`, plus `5678fbb` (a test typing fix found by `tsc`)

### c-IN-04: a SENT digest records the ids it sent

**Change.** The record transaction sets `notificationIds: sentIds`. A permanent close keeps the ids it tried. The `digest.ts` header is regrouped, because the K166 paragraph from `ebffff8` sat inside the step list.

**Runs.** Red: exit 1, the row held 2 ids where 1 was expected. Green: exit 0, digest suites 37 passed.

**Commit:** `4c7dbcb`

### c-IN-08, c-IN-07, the referrer sentence and the docs

- **c-IN-08:** the orphaned comment in `smtp-client.ts` is deleted. Comment only, so no test (`8baccdc`).
- **`docs/OPERATIONS.md`** (`de15be8`):
  - the 4xx and 5xx behaviour (K170);
  - the worker log lines;
  - slow runs (K169);
  - c-IN-07: "on the first scheduled run after that lease";
  - replies to a digest (c-IN-06, including the rest that is not fixed);
  - the Unassigned tickets rule (K166);
  - the invitation page "sends a referrer to AIDA itself only (`Referrer-Policy: same-origin`)" in place of "sends no referrer". The F2 deferred row is marked fixed.
- **`deferred-items.md`:**
  - c-IN-02 is closed by F2 (`1575ec4`);
  - c-IN-03, c-IN-05, and the rest of c-IN-06 and c-IN-07 are deferred with reasons;
  - the K170 limit: CANCELED, not FAILED, and a 535 closes every batch of that run.

### Final checks

Run at `5678fbb`. `colima status` exit 0 and `docker info` exit 0 before each Docker step.

| Command | Exit | Counts |
|---|---|---|
| `pnpm typecheck` | 0 | 0 errors (the first final run found one test typing error, fixed in `5678fbb`) |
| `pnpm lint` | 0 | 771 files, 1 warning, pre-existing and known: `tests/unit/container-config.test.ts:160` |
| `pnpm test` | 0 | 115 files, 2107 tests passed |
| Integration, touched suites plus the Phase 12.1 race and SLA suites (one process) | 0 | 22 files, 261 passed. The files: `notification-digest`, `notification-digest-job`, `notifications-core`, `notification-emitters`, `notifications-privacy`, `email-ingest`, `membership-ended-refusals`, `invitations`, `mentions`, `mention-mode-switch`, `email-outbound-merge`, `sla-flag-handler`, `sla-pause-race`, `notification-race`, `sla-pause`, `sla-pause-migrated`, `snooze`, `create-ticket-state-race`, `ticket-state-delete-race`, `reply-reopen-race`, `merge-reply-race`, `triage-priority-race` |
| `pnpm test:integration` (full, once) | 0 | 134 files, 1870 tests passed, 472.6 s |
| `pnpm test:e2e tests/e2e/notifications-bell.spec.ts` | 0 | 3 passed, 0 failed, 0 flaky |

The unit run includes `membership-inventory.test.ts` and `page-access-inventory.test.ts`, and both passed.
- The session cookie cache is still off (`src/lib/auth.ts:17`, `cookieCache: { enabled: false }`, from `0db72a9`).
- `readFreshSession` stays the only session read.
- F3 did not touch `auth.ts`, `fresh-session.ts`, `package.json`, the lockfile or the schema.
- No real email was sent: only the loopback fake SMTP. No new egress.

### Not done, and limits

- **Manual items:** I made no visual or screen-reader check; F3 changed no UI.
- **K167 timing:** the 501-ticket case asserts counts, not a duration. The time per pass against a real backlog is not measured.
- **K169:** expiry is proven through the options and the signal (an aborted signal, and an abort during a pair). No test waits for pg-boss to expire a real job.
- **K170:** the row says CANCELED; the failure is visible in the log only (`deferred-items.md`).
- **Report:** this section is written and left uncommitted for the orchestrator.

### `.next` moves

None. Global setup did not stall in the E2E run.

## F4

**Date:** 2026-11-13. **Scope:** K171 to K176, for findings d-WR-1 to d-WR-6, plus the part d info items that touch the same files: d-IN-1 (one boundary rule), d-IN-2 (comments), d-IN-3 (the cap in the composer), d-IN-7 (C7 at the public send) and d-IN-8 (a file-part body). d-IN-5 was fixed and then restored (see below). d-IN-4 and d-IN-6 are in `deferred-items.md`. **Where it ran:** the main checkout on `v2/run-loop`, no worktree (`workflow.use_worktrees` is `false`, and the dispatch named the branch). Runs used `AIDA_TEST_RUN_ID=mwegr1ot-e1b97e2aed73c552`. **Result:** 6 of 6 decisions fixed, 5 info items fixed, 1 restored, 14 commits. **Schema:** unchanged.

**How red was shown.** Each new test was run and seen failing before its fix, except K175. For K175 the route already existed, so the red runs put old or wrong lines back by hand (marked `TEMP-RED`, never committed) and restored the file from a copy in the run's temporary directory after each run. No `git checkout`, `git restore` or `git stash` was used.

### The one `@` boundary rule (d-IN-1)

New `src/lib/mentions/mention-syntax.ts`, with no imports. "@" + name is a mention only when:
- the character before the "@" is whitespace, or the "@" starts the text; and
- the character after the name is not a letter, combining mark, digit or `_`, or the name ends the text.

The trigger (`findMentionQuery`), the ids the composer sends (`outgoingMentionIds`), the strip (`stripMentionTokens`) and the renderer all use it. Through the renderer, the server's K172 check uses it too. The renderer reads the edges of each text node on the Markdown source, so `**@Ana**` is no mention there either.

**Tests.** In `markdown-render.test.ts`: `(@Ana)`, `**@Ana**`, `/@Ana/`, `@Ana` followed by a combining mark, `@Ana_b` and `x@Ana` are not wrapped. List items, quotes, line breaks, table cells and `**bold** @Ana` are wrapped. On plain text, the span count equals the number of hits of `isMentionAt`. The literal-span case now expects no span for `@Ana` right after `>`, and one span after a space. **Runs.** Red: exit 1, 2 failed. Green: 46 passed. **Commit:** `826b79e`

### d-WR-1, d-IN-2 / K171: the guard runs after the sanitize pass too

**Change.** The pass after sanitize is now `rehypeMentionSpanGuardAfterSanitize`, a distinct plugin. `renderMarkdownPlugins()` exposes the processor's attachers. The headers of `render.ts` and `mentions.ts` describe the real order (d-IN-2).

**Tests.** The attacher order is guard, sanitize, after-guard, stringify, and each guard is held once. Control: sanitize alone keeps `id="user-content-m"` and `title`. Sanitize followed by the after-guard leaves exactly the two classes. **Runs.** Red: exit 1, 2 failed (the plugin after sanitize was `rehypeStringify`). Green: 44 passed. **Commit:** `4c5402a`

### d-WR-3 / K173: the strip keeps text that is not a mention

**Change.** The second pass of `stripMentionTokens` (copies without a span) now applies the boundary rule. Intact inserted spans are still removed, whatever stands around them (C7). That interpretation is recorded in `deferred-items.md`.

**Tests.**
- Unit: `orders@sales-desk.example`, a URL path, `(@sales)`, `@sales_team`, `@salesforce` and a combining mark are kept. `@sales.` and `@sales,` are still removed. Through the reducer, the switch removes the inserted `@sales` and keeps the address.
- Integration (`mention-mode-switch`): a member without a display name, so the inserted name is the email's local part. The reducer, the route and the outbound handler keep `orders@<local>-desk.example` whole in the stored body, the HTML and the mail.

**Runs.** Red: unit exit 1, 2 failed; integration exit 1, 1 failed (`orders-desk.example`). Green: unit 28 passed, integration 2 passed. **Commit:** `8ffc5d3`

### d-WR-4 / K174: inserted names are escaped for Markdown

**Change.**
- `insertMention` writes `mentionToken(name)`. Every one of `` \ ` * _ [ ] < > ~ & | : `` is backslash-escaped, and so is the dot of `www.`.
- `isIntactSpan` and the strip compare against that token. The strip also removes an unescaped copy.
- GFM's autolink literal pass runs on parsed text, so escaping alone did not stop it. The renderer therefore now wraps mentions while the Markdown is parsed, right before that pass. A mention node has no text children, so a URL inside a name never becomes a link.

**Tests.** Thirteen names: `*Star*`, `**Bold**`, `_Under_`, `snake_case`, `[x](https://…)`, `[docs](https://…)`, backticks, tildes, `<b>`, `&amp;`, a backslash, `www.example.com` and a pipe. For each one:
- the name is inserted as an intact span and its id is sent;
- it renders as exactly one span, with no `<a`, `<em`, `<strong`, `<code`, `<del`, `<b>` or `<table`.

An unescaped copy is no mention. **Runs.** Red: exit 1, 3 failed. Green: 77 passed. **Commit:** `2f6cc5d`

### d-WR-2 / K172: only a mention the body shows is recorded

**Change.**
- The route renders with `renderMarkdownWithMentions` before `message.create`. It keeps a resolved member only when the member's current display name was wrapped. Every other id writes no row and sends no notification.
- `outgoingMentionIds` sends an intact span's id only on the boundary.

**Tests** (`mentions.test.ts`), for the three ways in:
- **A direct post**, with the bodies `hi`, `hi Mira Hidden`, `hi @Mira` and `x@Mira Hidden`.
- **Insert, Backspace, type:** `@Zetax`, and a letter typed before the `@`. The composer sends no id, and a post that still carries the id records only the other member in the note.
- **A rename** after the list was loaded.

Plus a K174 case through the route: the name renders as one span, with no link, and is recorded. **Runs.** Red: exit 1, 3 failed. Green (with `mention-mode-switch`): 16 passed. **Commit:** `eda10d8`

### d-WR-5 / K175: integration test for `GET /api/members/mentionable`

**Change.** Tests only: the new `tests/integration/mentionable-route.test.ts`.

**Tests.**
- The exact sorted array of `{ id, name, email }` objects. A member with two rows appears once. The fallback name is the email's local part, and no name contains `@`.
- The caller, a removed member, an org-B-only user and a user without a member row are all absent.
- `no-store` on every answer.
- 403 `membership_ended` for a removed member and for a session without an active organization; 401 without a session.

**Runs.**
- On the current code: exit 0, 3 passed.
- `TEMP-RED` runs, each exit 1 with 1 failed: no `no-store`; the caller kept; every organization listed; the full email as the name; the 401 path for a removed member.
- Restored: 3 passed.

**Commit:** `af6cba3`

### d-WR-6 / K176: amendment A9

**Change.** `py-1` rows and `max-h-[320px]`: eight rows of 40 px, each the 32 px avatar plus 2 × 4 px. Recorded as A9 in `10-GATE.md`. The gate's off-scale spacing grep on the file now exits 1 (no hit).

**Test.** The new `mention-autocomplete-spacing.test.ts` reads the component and checks three things: `py-1` is the row's only vertical padding, the list height equals 8 × (avatar + padding), and the off-scale grep is empty.

**Runs.** Red: exit 1, 3 failed. Green: 3 passed. **Commits:** `563b6dc`, `3d77f43` (a comment correction)

### Info items

- **d-IN-3:** `MAX_MENTIONS` moves to `mention-syntax.ts`, which is safe for the client bundle. At 50 ids the composer opens no list, and an insert of a new member changes nothing. Red: exit 1, 2 failed. Green: 34 passed. `2a83c63`
- **d-IN-7:** `guardPublicSend`. Before a public send, a copy of an inserted name that came back after the switch is removed and the switch note shows; the next Send goes out. Unit test, plus integration through the route and the mail. Red: exit 1 (unit 1 failed, integration 1 failed). Green: 36 unit, 22 integration. `36f13d9`. The send-time strip needs a UI-SPEC A-item (`deferred-items.md`).
- **d-IN-8:** a `body` sent as a file part is 400 `invalid_form_data`. Red: a TypeError and a 500. Green. `99c0850`
- **d-IN-5:** `99c0850` also changed the route's own two refusals to `membership_ended`. The full integration run then failed 6 cases in `ticket-merge.test.ts` (WR-03, Codex D2) and `file-delete-inventory.test.ts`, which pin `MEMBERSHIP_ENDED` on exactly these paths. Restored in `b917fc6`, with the d-IN-5 test removed; deferred (`470cbb5`).
- **`deferred-items.md`** (`4fc5f5b`, `470cbb5`): d-IN-4, d-IN-5, d-IN-6 and the F4 limits.

### Final checks

`colima status` exit 0 and `docker info` exit 0 before each Docker step.

| Command | Exit | Counts |
|---|---|---|
| `pnpm typecheck` (at `470cbb5`) | 0 | 0 errors |
| `pnpm lint` (at `470cbb5`) | 0 | 774 files, 1 warning, pre-existing and known: `tests/unit/container-config.test.ts:160` |
| `pnpm test` (at `470cbb5`) | 0 | 116 files, 2125 passed |
| `pnpm test:integration` (full, once, at `36f13d9`) | 1 | 135 files, 6 failed and 1875 passed: the d-IN-5 spelling, restored below |
| Integration rerun at `b917fc6`: `ticket-merge`, `file-delete-inventory`, `mentions`, `mention-mode-switch`, `mentionable-route`, `membership-gate`, `membership-ended-refusals` | 0 | 7 files, 125 passed |
| `pnpm test:e2e` for `mentions-leak`, `keyboard`, `attachments`, `phase5-rag`, `reading-pane`, `ticket-merge` and `activity-feed` (at `470cbb5`) | 0 | 55 passed, 0 failed |

- The unit run includes `membership-inventory` and `page-access-inventory`, and both passed.
- The session cookie cache is still off (`src/lib/auth.ts:17`).
- `readFreshSession` stays the only session read.
- No change to `auth.ts`, `fresh-session.ts`, `package.json`, the lockfile or the schema.
- No real email or LLM.

### Not done, and limits

- **No full integration rerun after `b917fc6`.** That commit only restores the two pre-F4 lines, and the 7 suites that cover them pass.
- **Manual items:** no visual or screen-reader check was made of the A9 rows.
- **The renderer with names** builds a processor per call (only for notes that carry mentions).
- **Report:** this section is written and left uncommitted for the orchestrator.

### `.next` moves

None. Global setup did not stall.

## F5

**Date:** 2026-11-13. **Scope:** K177, the gate row for `tests/integration/backup-failures.test.ts` "run deadline (K143)". In the full run it failed with "backup failed: dump" after 7161 ms; alone it passed. **Where it ran:** the main checkout on `v2/run-loop`, no worktree (`workflow.use_worktrees` is `false`, and the dispatch named the branch). Every Docker step ran against this run's own test containers only. Runs used `AIDA_TEST_RUN_ID=mweibo42-740fa2855dbbc798`. **Result:** 1 of 1 decision fixed, as a product fix with a test. 2 commits. **Schema:** unchanged.

**How red was shown.** Diagnostics were added by hand, marked `TEMP-RED` and never committed, then restored from copies in the run's temporary directory. They covered the script and the test: wall-clock times at start, before and after the dump, timeout's exit status, the error log, and a 12-run loop of the case under 12 CPU burners. A perl sampler compared `CLOCK_REALTIME` with `CLOCK_MONOTONIC` inside the runner container during that loop. No `git checkout`, `git restore` or `git stash` was used.

### Root cause: the deadline was judged by a wall clock that can step back

- `bounded` arms `timeout -k 10 <D - now>`. Linux runs a relative timer on the monotonic clock, so TERM comes at the deadline D plus the fraction of the second in which `bounded` read the clock. After the dump fails, `step_failed` asks `deadline_passed`, which reads `date -u +%s` again.
- When the steps before the dump cross a second boundary, the dump gets about 7 s instead of 8 s. In the loop, 5 of 12 runs ended after 7.37 to 7.62 s, and the 7161 ms of the gate is one of these. TERM then lands only milliseconds past D: 62 ms in one diagnostic run.
- The sampler saw the guest wall clock step **back by 100.9 ms** against the monotonic clock once in about 100 s of the loop. A step like that between the TERM and the check makes `date` read before D. The run then reports the dump's own failure (`fail dump`) instead of the deadline. This is a product bug, not a test bug.
- Ruled out: the dump never failed on its own. Every diagnostic run showed timeout's status 124 and "pg_dump: terminated by user". The lock holder, `BACKUP_DUMP_LOCK_TIMEOUT` (300 s) and `PGCONNECT_TIMEOUT` (10 s) play no part.

### The fix (K177)

**Change.**
- `lib.sh bounded` keeps the command's status and returns it as before. On timeout's own status 124 (none of the bounded tools exits 124 itself), it creates `BACKUP_DEADLINE_MARK`.
- `deadline_passed` returns true when that mark exists, then falls back to the wall clock as before.
- `aida-backup.sh` clears the variable at start, so the environment cannot set it, and points it at `$RUN_TMP/deadline.reached`. The exit trap removes that file with the directory.
- The deadline line is still printed only after timeout really ended a step at the deadline. Nothing else changes.

**Tests** (`backup-failures.test.ts`):
- New case "run deadline (K177)": a test-only `date` earlier in the runner's PATH reads `date -u +%s` 2 s back. The step is switched on once the run's `aida-backup` session is seen waiting on the held lock on `"Attachment"` (in `pg_locks`), after `bounded` armed its timer. The VM clock is never touched. The case expects the deadline line, exit 2, `failed`/`unknown`, no "backup failed: dump", an empty stderr, no unrecorded file, no set and no temporary directory.
- The K143 case keeps every assertion. It now also asserts that the dump was seen waiting on the lock, so it proves a waiting dump was stopped, and not an earlier step.

**Runs.**
- Red (product unchanged): exit 1, 1 failed (K177: received "[backup] backup failed: dump"), 1 passed (K143).
- Green: exit 0, 2 passed.

**Commits:** `3f903e3` (fix and tests), `897687b` (header comment rewrapped, comment only).

### Final checks

`colima status` exit 0 and `docker info` exit 0 before each Docker step.

| Command | Exit | Counts |
|---|---|---|
| `pnpm typecheck` (at `3f903e3`) | 0 | 0 errors |
| `pnpm lint` (at `3f903e3`) | 0 | 774 files, 1 warning, pre-existing and known: `tests/unit/container-config.test.ts:160` |
| `pnpm test` (at `3f903e3`) | 0 | 116 files, 2125 passed |
| `pnpm test:integration` (full, once, at `897687b`, 05:17:04Z to 05:25:08Z) | 0 | 135 files passed, 1881 tests passed, 0 failed (483.95 s) |

The full run also closes F4's gap: the last full run (at `36f13d9`) was red from the d-IN-5 change that `b917fc6` reverted, and this run at `897687b` includes that revert.

### Not done, and limits

- **The natural failure was not reproduced end to end.** It needs a backward clock step inside a window of a few milliseconds. The cause was shown in parts: the 7-second runs, the 62 ms margin and the measured -100.9 ms step. The exact mechanism was shown with the test clock.
- **What sets the guest clock** (the VM's time sync) was not investigated: nothing in `~/.colima` was read, and the VM was not entered.
- **A TERM that does not end the command** within 10 s exits 137 after KILL. That case is still judged by the wall clock, which is by then at least 10 s past the deadline.
- **Report:** this section is written and left uncommitted for the orchestrator.

### `.next` moves

None. No E2E run in F5.
