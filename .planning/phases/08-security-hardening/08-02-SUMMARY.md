---
phase: 08-security-hardening
plan: 02
subsystem: auth
status: complete
tags: [better-auth, dependency-upgrade, security, migration-proof, rule-j]
requires: ["08-01", "08-19"]
provides:
  - "better-auth pinned at 1.7.20"
  - "tests/integration/fixtures/better-auth-pre-upgrade.ts (BA_PRE_UPGRADE_FIXTURE, PRE_UPGRADE_MIGRATIONS) for plan 08-03"
  - "D-18 IP-source findings for plan 08-10"
affects: ["08-03", "08-04", "08-10"]
tech-stack:
  added: []
  patterns: ["disposable labelled dev database via plain docker run, removed only through pnpm test:docker-cleanup"]
key-files:
  created:
    - tests/integration/fixtures/better-auth-pre-upgrade.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/lib/auth-client.ts
decisions:
  - "better-auth 1.7.20 (newest stable 1.7.x on 2026-11-11), exact pin, MIT"
  - "better-call override removed: 1.7.20 pins better-call 1.4.5 itself, the 1.3.7 override would force a downgrade, and no audit advisory names better-call"
  - "@better-auth/cli stays 1.4.21: no 1.7.20 CLI is published; schema diff done with getAuthTables from the installed better-auth"
  - "No Prisma migration: the 1.7.20 schema diff against prisma/schema.prisma is empty"
metrics:
  duration: "12m 28s"
  completed: 2026-11-11
  tasks: 3
  files: 4
estimate:
  tokens: 110000
actuals:
  tokens: 1400
  tasks: 3
  commits: 2
plan_head_before: 33db4a06aba52a11d945591af8f2a0f30a9382f0
---

# Phase 8 Plan 02: better-auth 1.6.22 to 1.7.20 Upgrade Summary

better-auth is now pinned at 1.7.20. A fixture captured from the real 1.6.22 sign-up and sign-in path comes first. The upgrade needs no schema change. Proof on a database populated under 1.6.22 shows `prisma migrate deploy` exits 0 and the five row counts do not change. The old signed session cookie and the old password hash still work. The full integration suite and the E2E `/setup` wizard pass. Everything ran in the plan's own `aida-test-devdb-*` container, which the J1 cleanup script removed. `aida-dev-db` was never touched.

`actuals.tokens` is chars/4 over the hand-written diff (5,502 chars, the lockfile excluded). The estimate covered the whole session, so the two numbers are not on the same scale for the lockfile; the lockfile is generated.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | e170e28 | test(08-02): capture better-auth 1.6.22 session fixture (D-02) |
| 2 | c45473d | chore(08-02): upgrade better-auth to 1.7.20 (D-01, D-02) |
| 3 | none | No test fix was required, so Task 3 made no commit |

## Version choice

| Package | Chosen version | Chosen on | Published | Newest stable 1.7.x seen | Registry |
|---|---|---|---|---|---|
| better-auth | 1.7.20 | 2026-11-11 | 2026-11-10T17:29:28.609Z | 1.7.20 | https://registry.npmjs.org/ |

- Licence: `npm view better-auth@1.7.20 license` printed `MIT`. Repository: `git+https://github.com/better-auth/better-auth.git`.
- Every stable 1.7.x seen: 1.7.0 to 1.7.20. 1.7.7, the minimum D-01 sets, was published 2026-09-30T21:30:55.572Z. The previous version, 1.6.22, was published 2026-06-26T12:46:04.616Z.
- `@better-auth/cli` did not move, so it has no row. `npm view @better-auth/cli@1.7.20 version` returned `E404 No match found for version 1.7.20`. The newest published CLI versions are 1.5.0 betas.

## Upgrade-guide findings (Context7 `/better-auth/better-auth/v1.7.15`, guides/1-7-upgrade-guide and the 1.7 RC notes)

- Order the guide asks for: check duplicate account keys; for Prisma, generate the schema and apply it with Prisma; then deploy packages and config together.
- The schema-changing 1.7 features are protected resources, resource-bound tokens, DPoP, refresh-token reuse, authorization-code replay, back-channel logout, requested claims, SCIM, organization team counters, the provider client store and Device Authorization. None of them is configured here: there is no OAuth provider, no SCIM, no device flow, and the organization plugin runs without teams. The empty schema diff below confirms this.
- Email/password, database sessions with `cookieCache`, `databaseHooks.session.create.before`, the organization plugin (`allowUserToCreateOrganization: false`, system-action `createOrganization` with `userId`), the admin plugin (`impersonationSessionDuration`) and `nextCookies` last: none of them has a breaking change listed. Proof: the code compiles unchanged, sign-in and getSession work on the old data, and the E2E `/setup` wizard plus UI login pass.
- One listed breaking change touches proxies: "Proxy headers are not trusted by default; opt in with `advanced.trustedProxyHeaders: true`". From the RC notes this applies to forwarded host and protocol, not to the client IP. That reading is not checked in the code; plan 08-10 should confirm it. The IP source is covered under D-18 below.

## Duplicate-key query (Task 2 step 2, database `aida_fixture`)

`SELECT "providerId", "accountId", count(*) FROM account GROUP BY 1, 2 HAVING count(*) > 1;` printed `(0 rows)`.

## CLI path

Fallback path. No `@better-auth/cli` 1.7.20 exists, so the devDependency stays at `1.4.21` and no differently named CLI was installed. The schema came from `getAuthTables(auth.options)`. better-auth/db re-exports it from `@better-auth/core/db` through `export * from "@better-auth/core/db"`, which was confirmed in the installed package. The call ran in a scratch script that imports the repo's `src/lib/auth.ts`, with `DATABASE_URL` pointing at `aida_fixture`.

## Override decision (D-02)

- Before the change, `pnpm why better-call` found a single version, 1.3.7, which the override forced.
- `better-auth@1.7.20` declares `better-call: 1.4.5` as an exact dependency, and `@better-auth/core@1.7.20` declares it as an exact peer. Keeping the 1.3.7 override would force a downgrade under the new version.
- The override's original reason (01-07): 1.6.22 needed better-call >= 1.3.7 for the `kAPIErrorHeaderSymbol` export at `next build`. It was a compatibility minimum, not an advisory fix.
- After removing it, `pnpm audit --prod --json` lists 0 advisories for `better-call`, and 0 for `better-auth` itself. The full audit, dev dependencies included, also names no `better-call` advisory.
- `pnpm why better-call` now shows `better-call@1.4.5` under `better-auth@1.7.20`, plus `better-call@1.1.8` only under the dev-only `@better-auth/cli@1.4.21 > better-auth@1.4.21` tree.
- **Decision: override removed.** `pnpm.overrides` held only that key, so the key is gone. `pnpm build` and every test pass without it.

## Schema diff (Task 2 step 5)

Each `getAuthTables` field compared with the Prisma model: name, type, required, unique, index, references.

| Model | Fields compared (1.7.20 output) | Prisma | Diff |
|---|---|---|---|
| user | name!, email! unique, emailVerified!, image, createdAt!, updatedAt!, role, banned, banReason, banExpires | same columns, `email @unique`, admin fields optional | none |
| session | expiresAt!, token! unique, createdAt!, updatedAt!, ipAddress, userAgent, userId! index ->user.id cascade, activeOrganizationId, impersonatedBy | same, `token @unique`, `@@index([userId])`, Cascade | none |
| account | accountId!, providerId!, userId! index ->user.id cascade, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt!, updatedAt!; table `indexes`: none | same, `@@index([userId])`, Cascade | none |
| verification | identifier! index, value!, expiresAt!, createdAt!, updatedAt! | same, `@@index([identifier])` | none |
| organization | name!, slug! unique index, logo, createdAt!, metadata | same, `slug @unique` | none |
| member | organizationId! index ->organization.id, userId! index ->user.id, role!, createdAt! | same, both `@@index`, Cascade on both | none |
| invitation | organizationId! index ->organization.id, email! index, role, status!, expiresAt!, createdAt!, inviterId! ->user.id | same, `@@index([organizationId])`, `@@index([email])` | none |

- No composite `(providerId, accountId)` index is added for this configuration: `account.indexes` is `null` and the resolver adds field-level indexes only.
- The `onDelete: Cascade` on `member` and `invitation` and the missing DB defaults are not new in 1.7. They predate this plan, and Better Auth sets those values in application code.

**No schema change required by better-auth 1.7.20.** `git status --porcelain prisma/` printed nothing. Database `aida_gen` was not created and `prisma migrate dev` did not run.

## Migration

None.

## Compile fixes (Task 2 step 7)

- `pnpm db:generate` exited 0. The first `pnpm typecheck` gave one error: `src/lib/auth-client.ts(6,3): error TS2578: Unused '@ts-expect-error' directive.` The 1.7.20 client plugins type-check under TS6, so the directive line was removed. The second `pnpm typecheck` exited 0 with 0 `error TS`.
- `src/lib/auth.ts` needed no change.

## D-18: Better Auth IP source after the upgrade

Source: the installed `@better-auth/core@1.7.20`, `dist/utils/ip.mjs` (`getIP`, `getIPFromHeader`, `normalizeIP`), and `better-auth/dist/api/rate-limiter/index.mjs`.

- **Headers read by default:** `DEFAULT_IP_HEADERS = ["x-forwarded-for"]`, used only when `advanced.ipAddress.ipAddressHeaders` is unset. Configured headers are tried in order, and the first that resolves wins. `advanced.ipAddress.disableIpTracking` returns `null` at once.
- **Multi-value X-Forwarded-For without `trustedProxies`:** the header is split on commas and trimmed. With more than one value it returns `null`, so the value is not trusted. A single value must be a valid IPv4 or IPv6 address, otherwise `null`.
- **With `trustedProxies`:** these are IP/CIDR entries; invalid ones are dropped. The chain is walked from the right, trusted hops are skipped, and the first untrusted hop is returned. An unparsable hop returns `null`.
- **Normalisation:** IPv4-mapped IPv6 becomes IPv4. Other IPv6 is masked to a subnet: `advanced.ipAddress.ipv6Subnet`, **default 64**.
- **Fallback when nothing resolves:** in test or development, `LOCALHOST_IP` `127.0.0.1`. In production, `null`. The rate limiter then logs one warning and keys on a single shared per-path bucket (`NO_TRUSTED_IP_KEY`), unless `disableIpTracking` is set, which skips the limiter.
- This is the same model the 08-02 context described for 1.6.22: single-value trust without `trustedProxies`. With the shipped Caddy setting a single `X-Forwarded-For` from the TCP peer (D-16), the default resolves. Alignment with `getClientIp` is plan 08-10. No config change was made here.

## Task 3 evidence

| Check | Result |
|---|---|
| Liveness before Task 3 | `true mwc1g42e-7de8bc34be87f628` |
| `prisma migrate deploy` on `aida_fixture` with 1.7.20 installed | exit 0, `No pending migrations to apply.` (no new migration exists) |
| Row counts `user / account / session / organization / member` | before (Task 1): 1 / 1 / 2 / 1 / 1; after: 1 / 1 / 2 / 1 / 1; `_prisma_migrations`: 14 |
| `auth.api.getSession` with the fixture cookie (`better-auth.session_token=<fixture signed value>`) on 1.7.20 | returns user id `KP26tgOcGJDvP6GOoyEcRBWIwmxSR4ob` (the fixture user); session id and `activeOrganizationId` match the fixture |
| `auth.api.signInEmail` with the fixture email and password (1.6.22 scrypt hash) | succeeds, same user id, token issued |
| Extra: wrong password | rejected (`UNAUTHORIZED`) |
| `pnpm test:integration` (run id set) | exit 0; Test Files 94 passed (94); Tests 1297 passed (1297); `grep -c egress-isolation` = 0 |
| `pnpm test:e2e tests/e2e/authz.spec.ts` (run id set), first run | exit 1: `/setup` `page.waitForURL` timed out (see Deviations 4) |
| `pnpm test:e2e tests/e2e/authz.spec.ts`, rerun after moving `.next` to the Trash | exit 0; 2 passed (12.6s); the global setup's real `/setup` wizard and UI logins succeeded |

Session counts note: sign-up with auto sign-in creates a session before the organization exists, and sign-in creates the second one, which the fixture cookie points at. The database holds exactly one user, one organization and one member, as Task 1 requires.

## Other gates

| Command | Exit | Counts |
|---|---|---|
| `pnpm lint` (Task 1) | 0 | Checked 569 files, no fixes |
| `pnpm typecheck` (Task 2, after fix) | 0 | 0 `error TS` |
| `pnpm test` | 0 | Test Files 59 passed; Tests 950 passed |
| `pnpm build` | 0 | Compiled successfully; 5 Turbopack NFT warnings from `src/lib/attachments/local-file-storage.ts`, already logged by 08-01 |

## Audit exit codes after the upgrade (D-01)

| Command | Exit | Counts |
|---|---|---|
| `pnpm audit --prod` | 1 | 117 vulnerabilities: 9 low, 64 moderate, 43 high, 1 critical |
| `pnpm audit --prod --audit-level=high` | 1 | same, **red, not passed** |

- Delta against 08-01's post-upgrade baseline (2 critical / 45 high): **-1 critical, -2 high**. The critical removed is better-auth GHSA-965c-763c-88jm.
- Critical/high by top-level package, from the JSON, counted per root:
  - better-auth 0 / 5 (was 1 / 7): no advisory names `better-auth` itself any more. The remaining five come through its optional peers and their trees: `drizzle-orm` 0.41.0 (GHSA-gpj5-g38j-94v9, `<0.45.2`), `mysql2` 3.15.3 (GHSA-3f6p-5ww8-9rcr, `<3.22.0`), `nanoid`, `source-map-js`, `vite`. drizzle-orm 0.41.0 and mysql2 are resolved because the dev-only `@better-auth/cli@1.4.21` brings them into the tree. The app uses the Prisma adapter only. These are input for 08-04.
  - shadcn 1 / 24 (`proxy-addr` critical; 08-03 or 08-04);
  - prisma 0 / 7 (`fast-uri`);
  - next 0 / 2 (`browserslist`);
  - nodemailer 0 / 2;
  - zod 0 / 1;
  - imapflow 0 / 1 (`ip-address`);
  - html-to-text 0 / 1 (`deepmerge-ts`).
- The dev-only `@better-auth/cli@1.4.21` tree still holds `better-auth@1.4.21` with advisories, including GHSA-965c-763c-88jm and GHSA-pw9m-5jxm-xr6h. It is not in the production audit. No matching newer CLI exists, so it stays a build-chain residual for 08-04 and `docs/SECURITY.md`.

## Dev database (rule J)

- **Run id:** `mwc1g42e-7de8bc34be87f628` (from the dispatch; never created by this plan).
- **Docker health** (before Task 1, Task 2, Task 3 and the teardown): `colima status` exit 0 and `docker info` exit 0 every time. Server 29.5.2, `colima`.
- **Scratch directory:** `${TMPDIR}/aida-08-02-Ngb9eK` from `mktemp -d`. It held `devdb.env` (mode 600, `umask 077`), the scratch scripts and the logs.
- **Image check:** `docker image inspect --format '{{.Id}}' pgvector/pgvector:pg16` printed `sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f`, exit 0. Nothing was pulled.
- **Ports:** none taken. 55433 was free on both checks (`nc -z` non-zero, no `:55433->` in `docker ps`), so **55433 was chosen**. 55432 was never tried.
- **Name and ledger:** `devdb.ts name` printed `aida-test-devdb-mwc1g42e-7de8bc34be87f628-8c1791` and the labels `aida.test=1` and `aida.test.run=mwc1g42e-7de8bc34be87f628`. The `planned` and `created` ledger lines are in J1's run ledger.
- **Container:** `aida-test-devdb-mwc1g42e-7de8bc34be87f628-8c1791`, id `c19310d075b75005fa237d17619836961a2d5d1f2054caf705929dc98bc30d09`.
- **Command:**

  ```
  docker run -d --pull never --name "$DEVDB_NAME" --label aida.test=1 --label "aida.test.run=$AIDA_TEST_RUN_ID" --tmpfs /var/lib/postgresql/data:rw -p "127.0.0.1:55433:5432" -e POSTGRES_USER=aida -e POSTGRES_PASSWORD=<redacted> pgvector/pgvector:pg16
  ```

  Exit 0.
- **Label guard:** `1 mwc1g42e-7de8bc34be87f628 /aida-test-devdb-mwc1g42e-7de8bc34be87f628-8c1791`.
- **Readiness:** `pg_isready -h 127.0.0.1` ready after 2 tries.
- **Port identity:** host `7706875417503252519` = container `7706875417503252519`, a match.
- **Task 1 verify:** `devdb ok aida-test-devdb-mwc1g42e-7de8bc34be87f628-8c1791 port 55433`. This covers labels, image, tmpfs, no volume, and a binding on `127.0.0.1` that is not 55432.
- **Databases:**
  - `aida_fixture`: `prisma migrate deploy` in Task 1, exit 0, 14 applied, equal to `ls prisma/migrations`. Then the capture script, the Task 2 duplicate-key query and schema generation, the Task 3 migrate-deploy proof, the row counts and the session check.
  - `aida_gen`: not created (empty diff).
- **Liveness checks:** Task 2 `true mwc1g42e-7de8bc34be87f628`; Task 3 `true mwc1g42e-7de8bc34be87f628`.
- **Teardown:**
  - dry run 1 (exit 0):

    ```
    would remove: container aida-test-devdb-mwc1g42e-7de8bc34be87f628-8c1791 (mwc1g42e-7de8bc34be87f628)
    1 resource(s) of run mwc1g42e-7de8bc34be87f628; dry run, nothing removed.
    ```

  - `--apply` (exit 0):

    ```
    removed: container aida-test-devdb-mwc1g42e-7de8bc34be87f628-8c1791 (mwc1g42e-7de8bc34be87f628)
    run mwc1g42e-7de8bc34be87f628: 1 removed, 0 already gone, 0 skipped, 0 failed.
    ```

  - final dry run (exit 0):

    ```
    0 resource(s) of run mwc1g42e-7de8bc34be87f628; dry run, nothing removed.
    ```

  - The integration and E2E Testcontainers databases of this run were already gone by their own teardown before the first dry run.
  - No container was stopped or removed by a direct docker command. `aida-dev-db` was not started, stopped, removed, changed or migrated; it was only ever matched by name in a read-only `docker ps -a` listing after the teardown.
  - The scratch directory is removed after this SUMMARY is written (teardown step 5).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale pnpm peer snapshot after the override removal**
- **Found during:** Task 2 step 5.
- **Issue:** After `pnpm add better-auth@1.7.20` and the override removal, the lockfile kept `@better-auth/core@1.7.20` resolved against `better-call@1.1.8` and `@better-fetch/fetch@1.1.21`. Both peers are declared exact, as 1.4.5 and 1.3.3. Importing auth then failed: `The requested module 'better-call' does not provide an export named 'kAPIErrorHeaderSymbol'`. `pnpm install --fix-lockfile` did not change it.
- **Fix:** `pnpm remove better-auth`, then `pnpm add better-auth@1.7.20 --save-exact`: the same package at the same exact version, no new package. Core now resolves `better-call@1.4.5` and `@better-fetch/fetch@1.3.3`.
- **Files:** package.json, pnpm-lock.yaml. **Commit:** c45473d.

**2. [Rule 1 - Bug] Capture-script timestamps read in local time**
- **Found during:** Task 1 step 3.
- **Issue:** The `pg` client parsed Prisma's `timestamp(3)` columns, which have no time zone, as host local time (UTC+7). The first capture output was 7 hours off what Postgres stores.
- **Fix:** the same rows were re-read with a UTC parser for type 1114. The fixture holds the stored values; `psql` showed `2026-11-11 11:33:11.724` for `user.createdAt`. No data was rewritten.
- **Commit:** e170e28.

**3. [Rule 2] Fixture fields added beyond the listed set**
- **Found during:** Task 1 step 4.
- **What:** `email` and `baseURL` are in `BA_PRE_UPGRADE_FIXTURE`, so plan 08-03 has every input of the capture in one place.
- **Commit:** e170e28.

**4. E2E first run hit a dev-server reload loop**
- **Found during:** Task 3 step 4.
- **Issue:** The first run never hydrated `/setup`. The server printed 703 `Compiled in` lines and reloaded the page; the form fell back to a native GET submit (`GET /setup?orgName=...`) and `waitForURL` timed out.
- **Fix:** the charter's procedure for a broken `.next` after a build or package change. `mv .next ~/.Trash/aida-next-1794397380`, then one rerun: exit 0, 2 passed, 0 `Compiled in` loops, 1 `/setup` GET. This was the first fix attempt; no product code changed.
- **Reported:** the `.next` move, for the orchestrator's LAPORAN.

**5. Scratch scripts used `.mts`**
- `reread.mts`, `schema-dump.mts` and `session-check.mts` use top-level await, which tsx transpiles to CommonJS for `.ts` under `${TMPDIR}`. They lived only in the scratch directory.

## Threat model check

- T-08-04: done. better-auth >= 1.7.7, and GHSA-965c-763c-88jm is gone from the production audit.
- T-08-05: done. The old cookie and the old hash work on 1.7.20.
- T-08-06: done. Empty diff, so no migration; deploy proven on a populated database; no `db push`.
- T-08-07: done. IP source recorded above.
- T-08-SC: done. No new package; exact pin; MIT.
- T-08-198 to T-08-202: done, as recorded in "Dev database".

No new security surface was introduced.

## Known Stubs

None.

## Manual items

None for this plan.

## Self-Check: PASSED

- FOUND: tests/integration/fixtures/better-auth-pre-upgrade.ts
- FOUND: e170e28, c45473d (`git log`)
- package.json `better-auth` is `1.7.20`; `pnpm.overrides` is absent
- `git status --porcelain prisma/` is empty
- Final cleanup dry run: `0 resource(s) of run mwc1g42e-7de8bc34be87f628; dry run, nothing removed.`
