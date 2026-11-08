---
phase: 10-team
plan: 15
subsystem: proxy, security headers, Better Auth route inventory
status: complete
tags: [better-auth, proxy, organization-plugin, admin-plugin, csp, referrer-policy, invite]
requires:
  - "10-02: src/app/(auth)/no-access (the page the proxy now keeps behind a session cookie)"
provides:
  - "src/proxy.ts: /api/auth/organization/ and /api/auth/admin/ in BLOCKED_PUBLIC_ROUTES (403, Settings → Team message), matched on a canonical form of the path; /invite in PUBLIC_PREFIXES"
  - "src/lib/security/csp.ts: /invite in NO_REFERRER_PATH_PREFIXES"
  - "tests/unit/better-auth-routes.test.ts: installed-route enumeration (version guard, static scan, plugin-factory cross-check, set comparison, refusal per route)"
affects: [10-03, 10-05, 10-13]
tech-stack:
  added: []
  patterns:
    - "Route list read from the installed package through module resolution, compared with a constant list kept with the version"
    - "Blocked-prefix match on a decoded, lower-case, slash-collapsed path; routing keeps the raw path"
key-files:
  created:
    - tests/unit/better-auth-routes.test.ts
  modified:
    - src/proxy.ts
    - src/lib/security/csp.ts
    - tests/unit/proxy.test.ts
    - tests/unit/csp.test.ts
decisions:
  - "better-auth's exports map does not expose ./package.json, so the test resolves the main entry with require.resolve('better-auth') and walks up to the package.json named better-auth"
  - "Blocked prefixes are matched on decodeURIComponent(path).toLowerCase() with repeated slashes collapsed, so case, %2F and // spellings are refused by the proxy itself (Better Auth's router already 404s them)"
  - "BLOCKED_PUBLIC_ROUTES became a list of { prefix, error } so sign-up keeps its message and both plugin prefixes answer 'Team changes are made in AIDA under Settings → Team.'"
metrics:
  duration: "about 6 minutes (2026-11-12T19:36Z to 19:42Z UTC)"
  completed: 2026-11-13
  tasks: 2
  files: 5
estimate:
  tokens: 40000
  tasks: 2
actuals:
  tokens: 6900
  tasks: 2
  commits: 3
commits: 3
plan_head_before: e958622b6a56d8c99b4bceafffaa010d8d339f67
---

# Phase 10 Plan 15: Better Auth plugin routes closed over HTTP, /invite public with no referrer Summary

The proxy refuses every organization-plugin and admin-plugin route of the installed better-auth 1.7.20 (36 + 15 paths, read from the package and pinned by a test that fails on any upgrade), and `/invite` is public, nonce-protected and sends no referrer through the existing forwarding helper.

## Route listing (read 2026-11-13 from the installed better-auth 1.7.20)

Counts found: **36 organization paths, 15 admin paths**, as the plan expected. The static scan of `dist/plugins/organization` and `dist/plugins/admin` and the plugin factories (all groups enabled) agree; with AIDA's options (`organization({ allowUserToCreateOrganization: false })`) 22 organization paths are registered, the 14 conditional ones are not. One more organization endpoint, `addMember`, has no path (server-only, never routed over HTTP); the test pins that count at 1. No file elsewhere in `dist` defines an `/organization/` or `/admin/` endpoint.

**None is left open:** every path below, prefixed with `/api/auth`, answers 403 JSON from `proxy()` for GET and POST, with and without a session cookie.

| Plugin | Path | Note |
|--------|------|------|
| organization | /organization/create | |
| organization | /organization/check-slug | |
| organization | /organization/update | |
| organization | /organization/delete | owner item 09-o3: closed by default (O-5) |
| organization | /organization/get-organization | |
| organization | /organization/get-full-organization | |
| organization | /organization/set-active | |
| organization | /organization/list | |
| organization | /organization/invite-member | |
| organization | /organization/accept-invitation | |
| organization | /organization/reject-invitation | |
| organization | /organization/cancel-invitation | |
| organization | /organization/get-invitation | |
| organization | /organization/list-invitations | |
| organization | /organization/list-user-invitations | |
| organization | /organization/remove-member | would bypass the D-09 owner floor |
| organization | /organization/update-member-role | |
| organization | /organization/get-active-member | |
| organization | /organization/leave | would bypass the D-09 owner floor |
| organization | /organization/list-members | |
| organization | /organization/get-active-member-role | |
| organization | /organization/has-permission | |
| organization | /organization/create-team | team route, registered only when teams.enabled |
| organization | /organization/remove-team | team route |
| organization | /organization/update-team | team route |
| organization | /organization/list-teams | team route |
| organization | /organization/set-active-team | team route |
| organization | /organization/list-user-teams | team route |
| organization | /organization/list-team-members | team route |
| organization | /organization/add-team-member | team route |
| organization | /organization/remove-team-member | team route |
| organization | /organization/create-role | dynamic-role route, registered only when dynamicAccessControl.enabled |
| organization | /organization/delete-role | dynamic-role route |
| organization | /organization/list-roles | dynamic-role route |
| organization | /organization/get-role | dynamic-role route |
| organization | /organization/update-role | dynamic-role route |
| admin | /admin/set-role | |
| admin | /admin/get-user | |
| admin | /admin/create-user | |
| admin | /admin/update-user | |
| admin | /admin/list-users | |
| admin | /admin/list-user-sessions | |
| admin | /admin/unban-user | |
| admin | /admin/ban-user | |
| admin | /admin/impersonate-user | |
| admin | /admin/stop-impersonating | |
| admin | /admin/revoke-user-session | |
| admin | /admin/revoke-user-sessions | |
| admin | /admin/remove-user | |
| admin | /admin/set-user-password | |
| admin | /admin/has-permission | |

`disableOrganizationDeletion` is not set and no in-process deletion path was added (O-5). In-process `auth.api.*` calls do not traverse the proxy and are unaffected. A later Better Auth upgrade fails the version guard and the set comparison until the list is re-read.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | List the installed plugin routes and block both prefixes | bc18a35 | src/proxy.ts, tests/unit/better-auth-routes.test.ts |
| 2 (tdd) RED | Cookie variants, sign-up, /invite, /no-access cases | 04e4bab | tests/unit/proxy.test.ts |
| 2 (tdd) GREEN | /invite public with no referrer | 06a662b | src/proxy.ts, src/lib/security/csp.ts, tests/unit/csp.test.ts |

Tracer gate: after commit `bc18a35` the tracer verify (`vitest run tests/unit/better-auth-routes.test.ts`) was re-run: exit 0, 56 passed, then expansion continued.

RED evidence: `vitest run tests/unit/proxy.test.ts` before the GREEN change: exit 1, 6 failed and 31 passed. Failures were the /invite cases (307 redirect instead of 200, no nonce) and the d-WR-d3 CSP cases that gained an /invite entry; the plugin-block, sign-up and /no-access cases already passed after Task 1.

## Verification

| Command | Exit | Result |
|---------|------|--------|
| `pnpm exec vitest run tests/unit/better-auth-routes.test.ts` (Task 1) | 0 | 1 file, 56 passed |
| `pnpm test tests/unit/better-auth-routes.test.ts` (Task 1; the script's `tests/unit` filter runs the whole unit suite) | 0 | 103 files, 1816 passed |
| `pnpm typecheck` (Task 1, before and after the rename) | 0 | clean |
| `pnpm exec vitest run tests/unit/proxy.test.ts` (RED) | 1 | 6 failed, 31 passed (expected) |
| `pnpm exec vitest run tests/unit/proxy.test.ts tests/unit/better-auth-routes.test.ts` (GREEN) | 0 | 2 files, 93 passed |
| `pnpm test tests/unit/proxy.test.ts tests/unit/better-auth-routes.test.ts` (first run) | 1 | 1 failed (`csp.test.ts` G pinned the old prefix list), 1823 passed |
| same, after updating `csp.test.ts` | 0 | 103 files, 1824 passed |
| `pnpm typecheck` (final) | 0 | clean |
| `pnpm lint` (`biome check .`) | 0 | 0 errors, 1 pre-existing warning in `tests/unit/container-config.test.ts:160` (not touched) |

Acceptance greps: `/api/auth/organization/` and `/api/auth/admin/` in `src/proxy.ts`: 1 each; `1.7.20` in the route test: 3; `09-o3`: 2; `require.resolve`: 1; `node_modules/`: 0; `"/invite"` in `src/proxy.ts`: 1 and in `src/lib/security/csp.ts`: 1; `git diff 5dc6890 -- src/proxy.ts` exit 0 with 0 added `NextResponse.next(` lines; `no-access` in `tests/unit/proxy.test.ts`: 5.

Not run: Docker-based suites (`pnpm test:integration`, `pnpm test:e2e`); this plan defines none. The HTTP check against a running server is 10-13 Task 2. The `/invite` entry in `tests/e2e/csp.spec.ts` (V-01) belongs to the plan that adds the page.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `better-auth/package.json` cannot be resolved**
- **Found during:** Task 1
- **Issue:** better-auth's `exports` map does not list `./package.json`, so `require.resolve("better-auth/package.json")` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Fix:** resolve the main entry with `require.resolve("better-auth")` (a `createRequire` instance) and walk up to the `package.json` whose name is `better-auth`. Still no hard-coded path.
- **Commit:** bc18a35

**2. [Rule 2 - Security] Canonical-form match for the blocked prefixes**
- **Found during:** Task 1
- **Issue:** a raw `startsWith` match lets spellings such as `/api/auth/Organization/leave`, `/api/auth/organization%2Fleave` or `/api/auth//organization/leave` past the proxy. Better Auth's router (better-call 1.4.5 with rou3 0.9.2) answers 404 to each today (case-sensitive static match, `//` refused), so this was not an open route, but the block depended on that detail.
- **Fix:** `blockedRouteFor()` decodes the path (after the malformed-path guard, so decoding cannot throw), lower-cases it and collapses repeated slashes before the prefix check. Routing keeps the raw path. Covered by proxy case Z2; case Z4 shows `/api/auth/organizations` and `/api/auth/administrator` still pass.
- **Commit:** bc18a35

**3. [Rule 2 - Additional check] Second source for the route list**
- **Found during:** Task 1
- **Fix:** besides the static scan, the test instantiates `organization()` (all groups enabled, and AIDA's options) and `admin()` from `better-auth/plugins` and compares their endpoint paths with the constant list. It also fails on an endpoint defined in a form the scan cannot read, and on any path outside the two blocked prefixes.
- **Commit:** bc18a35

**4. [Rule 1 - Bug] `tests/unit/csp.test.ts` pinned the old no-referrer list**
- **Found during:** Task 2 verification
- **Fix:** case G expects `["/status", "/api/public/status", "/invite"]`; case H also checks `/invite/abc` and `/invite/abc/accept`. File not in `files_modified`.
- **Commit:** 06a662b

**5. Extra case in the existing d-WR-d3 block**
- `tests/unit/proxy.test.ts`: the forwarded list of the "emitted CSP equals buildCsp()" block gains an `/invite/abc` entry, so the page is checked in all three NODE_ENV modes.

## Notes

- Out of scope, checked only: Better Auth core `/delete-user` refuses unless `user.deleteUser.enabled` is set, which `src/lib/auth.ts` does not set; the admin plugin's user fields are `input: false`, so core `/update-user` cannot write a role.
- `/invite` as a prefix also makes any path starting with `/invite` public (e.g. `/invites`), the same as the existing `/status` and `/request` prefixes; no such route exists in `src/app`.

## Known Stubs

None.

## Threat Flags

None. T-10-06, T-10-09, T-10-52 and T-10-53 are mitigated as the plan's register states; no surface outside the register was added.

## Self-Check: PASSED

All five files exist; commits bc18a35, 04e4bab and 06a662b are in the log.
