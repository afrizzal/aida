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
