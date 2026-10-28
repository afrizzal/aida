---
phase: 08-security-hardening
plan: 04
subsystem: dependencies
status: complete
tags: [security, dependencies, audit, shadcn, nodemailer, overrides, AIDA-25]
requires: ["08-02", "08-03"]
provides:
  - "shadcn 4.12.0 as an exact devDependency, proven absent from .next/standalone and dist/worker.mjs (D-03)"
  - "get-nonce 1.0.1 direct dependency for plan 08-08"
  - "pnpm.overrides ajv>fast-uri 3.1.9 and socks>ip-address 10.7.6 with tests/unit/dependency-overrides.test.ts"
  - "production and build-chain residual tables for docs/SECURITY.md (Phase 8.1, plan 08-15)"
affects: ["08-08", "08-24", "8.1 / 08-15"]
tech-stack:
  added: ["get-nonce 1.0.1 (direct; already in the tree at the same version)"]
  patterns: ["parent-scoped exact pnpm.overrides, each with a unit test that calls the consuming parent's public API"]
key-files:
  created:
    - tests/unit/dependency-overrides.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
decisions:
  - "nodemailer 9.1.1 (newest 9.x); mailparser 3.9.20 and imapflow 1.7.8 moved with it so no nodemailer 9.0.3 copy is left"
  - "Prisma trio stays 7.8.0: 7.10.1 install stalled at @prisma/engines postinstall for over 10 minutes (binaries.prisma.sh sends 0 bytes); no mirror used; Dockerfile glob unchanged"
  - "Overrides only for fast-uri and ip-address, parent-scoped, exact, newest version inside the parent's declared range"
  - "nodemailer major 10 is needed for both remaining nodemailer advisories; that conflicts with D-04 (stay on major 9) and is left for an owner decision"
metrics:
  duration: "about 20 min (12:06Z to 12:26Z)"
  completed: 2026-11-11
  tasks: 3
  files: 3
estimate:
  tokens: 95000
actuals:
  tokens: 1430
  tasks: 3
  commits: 2
plan_head_before: 92279703fd0a82ba022e2169074f746f3084585a
commits: 2
---

# Phase 8 Plan 04: shadcn to dev, vulnerable direct bumps, residual table Summary

`shadcn` is now a dev-only exact pin (4.12.0). The move takes 235 store entries out of the production tree, and none of them is in `.next/standalone`, its file traces or `dist/worker.mjs`. `nodemailer`, `zod`, `html-to-text`, `imapflow` and `mailparser` are bumped with exact pins, `get-nonce` 1.0.1 is a direct dependency, and two narrow tested overrides fix `fast-uri` and `ip-address`. The Prisma bump stalled on the unreachable Prisma binary host and was reverted. The production audit goes from 1 critical / 43 high (08-02) to **0 critical / 10 high**. Both audit forms still exit 1. **AIDA-25 gate: red, residuals listed.**

`actuals.tokens` is chars/4 over the hand-written diff (5,710 chars of package.json and the test file; the lockfile is generated and excluded).

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 216a33b | chore(08-04): move shadcn to devDependencies (D-03) |
| 2 | 3f48e65 | chore(08-04): bump vulnerable direct dependencies (D-04) |
| 3 | none | No tracked file changes (output is this SUMMARY) |

## Task 1: shadcn

### `pnpm why --prod` before the move

| Module | Version | Production parent(s) | Only through shadcn? |
|---|---|---|---|
| shadcn | 4.12.0 | aida (dependencies) | itself |
| proxy-addr | 2.0.7 | express 5.2.1 < @modelcontextprotocol/sdk 1.29.0 < shadcn | yes |
| @modelcontextprotocol/sdk | 1.29.0 | shadcn | yes |
| body-parser | 2.3.0 | express < @modelcontextprotocol/sdk < shadcn | yes |
| undici | 7.28.0 | @dotenvx/dotenvx 1.75.1 < shadcn, and shadcn directly | yes |
| systeminformation | 5.31.11 | @dotenvx/dotenvx < shadcn | yes |
| express | 5.2.1 | @modelcontextprotocol/sdk < shadcn | yes |

After the move, `pnpm why --prod <name>` prints nothing for all seven. `pnpm list --prod --depth Infinity --parseable` went from 857 store entries to 622: 235 removed and 0 added.

### Move

- `devDependencies.shadcn` = `4.12.0` (the version the lockfile resolved), with no caret; `dependencies.shadcn` removed. pnpm keeps devDependencies alphabetical.
- `pnpm build` exit 0 (`Compiled successfully`), and "Can't resolve 'shadcn/tailwind.css'" appears 0 times: the CSS import resolves from devDependencies.
- Worker bundle: built with the exact esbuild command from Dockerfile line 39, exit 0, writing `dist/worker.mjs`.

### Artifact evidence

Store form: the scope slash is written as `+`.

| Module | (a) `ls .next/standalone/node_modules/.pnpm` entries `<store>@` | (b) `find .next/standalone -type d -path "*/node_modules/<name>"` | (c) `grep -rl --include="*.nft.json"` for `node_modules/<name>/` or `.pnpm/<store>@` under `.next` | (d) `grep -c node_modules/<name>` in `dist/worker.mjs` | (e) `pnpm why --prod <name>` |
|---|---|---|---|---|---|
| shadcn | 0 | empty | empty | 0 | empty |
| proxy-addr | 0 | empty | empty | 0 | empty |
| @modelcontextprotocol/sdk | 0 | empty | empty | 0 | empty |
| body-parser | 0 | empty | empty | 0 | empty |
| undici | 0 | empty | empty | 0 | empty |
| systeminformation | 0 | empty | empty | 0 | empty |
| express | 0 | empty | empty | 0 | empty |

Sweep over all 235 removed store entries:
- (a) exact store-directory match in `.next/standalone/node_modules/.pnpm` (42 entries): 0 hits.
- (c) `.pnpm/<store>/` in the concatenated `*.nft.json` traces (4.19 MB): 0 hits.
- (d) `node_modules/<name>/` in `dist/worker.mjs`: 1 hit, `zod`. The removed copy is `zod@3.25.76` (shadcn's). The bundle names only `node_modules/.pnpm/zod@4.4.3` (87 paths) and `zod@3` 0 times. `zod` 4.x is the app's own direct dependency, so this is not a shadcn residual.

No shadcn-only module was found in either artifact, and every check ran. Nothing is recorded as "reachability not shown" from Task 1. `undici` has no other production parent; the remaining `undici@8.5.0` is dev-only, under `testcontainers`.

### Audit hand-off file

`/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-08-04-QNrMzf/audit-prod-after-shadcn.json`, from `pnpm audit --prod --json` (exit 1). Task 2 read this file. Its findings are reproduced in the Task 2 decisions below. The scratch directory is removed when this plan ends (executor brief), so the path is recorded but no longer resolves.

### Audits after the move

| Command | Exit | Counts |
|---|---|---|
| `pnpm audit --prod --json` (to the hand-off file) | 1 | 0 critical, 19 high |
| `pnpm audit --prod` | 1 | 4 low, 41 moderate, 19 high |
| `pnpm audit --prod --audit-level=high` | 1 | same |
| `pnpm audit` (dev included) | 1 | 10 low, 63 moderate, 46 high, 2 critical |

## Task 2: bumps, overrides, get-nonce

### Bump decisions (advisories from `audit-prod-after-shadcn.json`)

| Package | Old | New | Licence | Advisory | Decision |
|---|---|---|---|---|---|
| nodemailer | 9.0.3 | 9.1.1 | MIT-0 (9.0.3 was already MIT-0) | GHSA-2x7j-588g-ccc2 (high, `<9.1.0`, addressparser O(n²)) fixed; GHSA-v53p-9fqp-m79j (high, `<=10.0.5`) not fixed | Bumped to the newest 9.x, as D-04 requires. A newer advisory, GHSA-prgh-xp8r-p3m5 (`>=9.1.0 <=10.0.4`), covers every 9.x from 9.1.0, so the high count for nodemailer stays at 2. See Deviation 3 |
| mailparser | 3.9.14 | 3.9.20 | MIT | none of its own. 3.9.14 pins `nodemailer` 9.0.3 exactly | Bumped so no 9.0.3 copy is left. 3.9.20 pins `nodemailer` 9.1.1. 3.9.21 and later pin nodemailer 10 |
| imapflow | 1.4.6 | 1.7.8 | MIT | none of its own. 1.4.6 pins `nodemailer` 9.0.3; GHSA-mwp4-54f8-5fhr is in `ip-address` under its `socks` | Newest 1.x. 1.7.8 drops the nodemailer dependency and keeps `socks` 2.8.9. 2.11.0 (major) not taken |
| zod | 4.4.3 | 4.6.7 | MIT | GHSA-mrhx-c7xc-m3w5 (high, `<4.6.6`) | Fixed |
| html-to-text | 10.0.0 | 10.0.1 | MIT | GHSA-ggr8-5vv4-36mx in `deepmerge-ts` 7.1.5 (`<8.0.0`) | Fixed through the parent: 10.0.1 depends on `deepmerge-ts ^8.0.1` (8.0.2, BSD-3-Clause). The worker bundle holds only `deepmerge-ts@8.0.2` |
| prisma, @prisma/client, @prisma/adapter-pg | 7.8.0 | 7.8.0 (7.10.1 attempted, reverted) | Apache-2.0 | 7 x `fast-uri` (via prisma's `@prisma/dev`), `deepmerge-ts` 7.1.5 via `@prisma/config` 7.8.0 | Blocked: see "Prisma blocker". `fast-uri` was fixed by an override instead. `@prisma/config@7.10.1` would take `deepmerge-ts` 8.0.2 |
| get-nonce | (transitive) | 1.0.1 direct | MIT | none | Added for plan 08-08: its `setNonce` lets react-style-singleton (Radix scroll lock) stamp the per-response CSP nonce on its style tags. `pnpm why get-nonce` shows one version, 1.0.1, so no new package entered the tree |
| better-auth | 1.7.20 | 1.7.20 | MIT | none | Removed and re-added at the same exact version 3 times to repair its peer snapshot (Deviation 1). No version change |
| shadcn | ^4.12.0 (dependencies) | 4.12.0 (devDependencies) | MIT | moves `proxy-addr` (critical) and others out of production | Task 1 |

### Overrides

| Override | Version | Licence | Why | Consumer and test |
|---|---|---|---|---|
| `ajv>fast-uri` | 3.1.9 | BSD-3-Clause | After the direct bumps, `fast-uri` 3.1.2 still carried 7 high advisories (GHSA-4c8g-83qw-93j6, -7p8r-x3mc-p8w7, -f65p-4m7j-42xc, -fph4-wmhf-6fwf, -jqff-g426-hqxp, -qw65-cvwx-89v3, -v2hh-gcrm-f6hx; all fixed at `>=3.1.7`). One parent, `ajv` 8.20.0 (`fast-uri ^3.0.1`), under `prisma > @prisma/dev > @prisma/streams-local`. 3.1.9 is the newest 3.x | `it("fast-uri override ...")`: loads `ajv` from the `@prisma/streams-local` location, asserts that its default `uriResolver` is the overridden 3.1.9 copy, and compiles a schema whose relative `$ref` (`b.json#/definitions/n`) must resolve to validate |
| `socks>ip-address` | 10.7.6 | MIT | `ip-address` 10.2.0 carried GHSA-mwp4-54f8-5fhr (high, `<=10.3.0`). One production parent, `socks` 2.8.9 (`ip-address ^10.1.1`), under `imapflow`. 10.7.6 is the newest 10.x | `it("ip-address override ...")`: loads `socks` from the `imapflow` location, asserts the 10.7.6 copy, and round-trips an IPv6 UDP frame through `SocksClient.createUDPFrame` / `parseUDPFrame`, which call `ip-address` `Address6`. It asserts the exact bytes and the canonical host |

`pnpm exec vitest run tests/unit/dependency-overrides.test.ts`: exit 0, 2 passed. `pnpm why --prod fast-uri` → `fast-uri@3.1.9`, 1 version; `pnpm why --prod ip-address` → `ip-address@10.7.6`, 1 version.

`deepmerge-ts` and `sharp`: no override (step 4). `deepmerge-ts` is fixed in the app path through `html-to-text`. The remaining 7.1.5 copy is under the Prisma CLI (see residuals). `sharp` carries no critical or high advisory in the final production audit.

### Prisma blocker

- `curl -sS --max-time 30 https://binaries.prisma.sh/` at 2026-11-11T12:11Z: `curl: (28) Operation timed out after 30011 milliseconds with 0 bytes received`, http 000.
- `pnpm add prisma@7.10.1 @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 --save-exact`, started 2026-11-11T12:11:21Z under an 11-minute `alarm`. The log reached `Progress: resolved 1087, reused 915, downloaded 65, added 73, done`, then `.../node_modules/@prisma/engines postinstall$ node scripts/postinstall.js` at about 12:11:34Z. After that it printed nothing more. The alarm fired at 12:22:21Z (exit 142), with `node scripts/postinstall.js` at 10m51s elapsed. Its child processes were then stopped.
- No `PRISMA_ENGINES_MIRROR` or other engine variable was set (`env | grep -ci` printed 0).
- Revert: pnpm had not written `package.json` or the lockfile (no 7.10.1 in either), so the three entries were still 7.8.0. `pnpm install` (exit 0) relinked `node_modules/prisma` and `node_modules/@prisma/client` to the 7.8.0 store. Orphan 7.10.1 directories remain in the gitignored `node_modules/.pnpm` and are not linked.
- Dockerfile: unchanged. The builder glob `@prisma+client@7.8.0*` still matches `package.json` (Task 2 verify printed `pins ok`).
- Residual reason: "upstream fix exists but the Prisma binary host is unreachable (external blocker)".

### Task 2 gates

| Command | Exit | Counts |
|---|---|---|
| Task 2 pin verify (`node -e ...`) | 0 | `pins ok` |
| `pnpm install --frozen-lockfile` | 0 | lockfile in sync |
| `pnpm typecheck` | 0 | 0 `error TS` |
| `pnpm lint` | 0 | Checked 576 files, no fixes |
| `pnpm test` | 0 | Test Files 61 passed; Tests 969 passed |
| `pnpm build` | 0 | Compiled successfully |
| `colima status` | 0 | running, runtime docker |
| `docker info` | 0 | Server Version 29.5.2, no error lines |
| `pnpm test:integration tests/integration/email-ingest.test.ts tests/integration/create-ticket.test.ts` (`AIDA_TEST_RUN_ID=mwc2ntl4-fb6436bf71147da9`, `DOCKER_HOST` from `docker context inspect`) | 0 | Test Files 2 passed; Tests 11 passed |

No source file needed a change for any bump.

## Version choice

Registry: `npm config get registry` → `https://registry.npmjs.org/`. Chosen on 2026-11-11 (12:08Z).

| Package | Chosen | Published (`npm view <name> time --json`) | Newest seen and why this one |
|---|---|---|---|
| shadcn | 4.12.0 | 2026-06-26T17:26:54.932Z | The lockfile's resolved version, kept as the plan says (4.23.0 exists; not taken in a security move) |
| nodemailer | 9.1.1 | 2026-09-01T18:42:29.033Z | Newest 9.x; `latest` is 10.5.0, excluded by D-04 |
| mailparser | 3.9.20 | 2026-09-01T18:58:32.787Z | Newest release that pins nodemailer 9.x (9.1.1); `latest` 3.14.3 pins nodemailer 10.5.0 |
| imapflow | 1.7.8 | 2026-09-01T18:16:05.317Z | Newest 1.x; `latest` 2.11.0 is a major |
| zod | 4.6.7 | 2026-10-12T16:29:37.778Z | `latest` |
| html-to-text | 10.0.1 | 2026-08-19T17:28:48.390Z | `latest` |
| get-nonce | 1.0.1 | 2020-04-17T05:10:02.775Z | The version already in the lockfile |
| fast-uri (override) | 3.1.9 | 2026-10-19T23:05:26.357Z | Newest 3.x inside `ajv`'s `^3.0.1`; 4.2.3 is outside the range |
| ip-address (override) | 10.7.6 | 2026-11-03T16:58:46.090Z | Newest 10.x inside `socks`'s `^10.1.1` |
| prisma, @prisma/client, @prisma/adapter-pg (attempted, reverted) | 7.10.1 | 2026-10-15T19:25:15.682Z / 19:24:19.500Z / 19:17:19.563Z | Newest stable 7.x (`prev` tag); `prisma` `latest` is 8.0.0-rc.33, a release candidate, excluded |

## Task 3: final audit

| Command | Exit | Counts |
|---|---|---|
| `pnpm audit --prod --json` (saved to scratch) | 1 | 0 critical, 10 high |
| `pnpm audit --prod` | 1 | 2 low, 30 moderate, 10 high |
| `pnpm audit --prod --audit-level=high` | 1 | same |
| `pnpm audit --prod --audit-level=high --json` (Task 3 verify) | 1 | advisories, no `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT` (0 matches): an expected red result |
| `pnpm audit` (dev included) | 1 | 8 low, 59 moderate, 39 high, 2 critical |

Delta: 08-02 had 1 critical / 43 high in production; now 0 / 10.

Reachability checks behind the table: after the final `pnpm build` and a fresh worker bundle, each package was looked up as (a) a store directory in `.next/standalone/node_modules/.pnpm`, (c) a `.pnpm/<store>@` path in every `*.nft.json` under `.next`, and (d) a `node_modules/<name>/` path in `dist/worker.mjs`.

### Production residuals

Sorted critical before high, then by advisory ID. There is no critical advisory.

| Advisory ID | Package@version | Dependency path | Severity | Why not fixed now | Why not reachable |
|---|---|---|---|---|---|
| GHSA-2v37-7h3g-55p8 | nanoid@3.3.16 | `.>better-auth>vitest>vite>postcss>nanoid` | high | `vitest` is an optional peer of better-auth 1.7.20. It resolves only because the repo has `vitest` as a devDependency. The plan allows overrides only for fast-uri and ip-address | Not in `.next/standalone` (a), its traces (c) or `dist/worker.mjs` (d): all three empty for nanoid, postcss-under-vite, vite and vitest. `grep -rlnE 'from "(drizzle-orm\|mysql2\|vite\|vitest)' src` prints nothing |
| GHSA-3f6p-5ww8-9rcr | mysql2@3.15.3 | `.>better-auth>mysql2` | high | Optional peer of better-auth, resolved because the dev-only `@better-auth/cli` 1.4.21 brings `mysql2` into the tree. No newer CLI is published (08-02) | (a), (c) and (d) empty for mysql2. `src/lib/auth.ts:8` uses `prismaAdapter(prisma, { provider: "postgresql" })` only; no `mysql2` import in `src` |
| GHSA-587h-7wmj-h5pm | vite@8.1.0 | `.>better-auth>vitest>vite` | high | As nanoid (optional peer via the `vitest` devDependency) | (a), (c) and (d) empty for vite. The advisory is a Windows `launch-editor` path check in the dev server, and the image is Linux with no dev server |
| GHSA-68fv-2mgg-jv7q | source-map-js@1.2.1 | `.>better-auth>vitest>vite>postcss>source-map-js` | high | As nanoid | (a), (c) and (d) empty for source-map-js |
| GHSA-73wf-gq98-2v4g | browserslist@4.28.4 | `.>next>styled-jsx>@babel/core>@babel/helper-compilation-targets>browserslist` | high | Parent `next` 16.4.6 is the newest stable (08-01). An in-range `browserslist` 4.29.5 exists, but the plan restricts overrides to fast-uri and ip-address | `styled-jsx@5.1.6` is in `.next/standalone`, but `@babel/core` and `browserslist` are not, in (a), (c) or (d). styled-jsx's Babel plugin runs at build time only, and `grep -rln "styled-jsx\|<style jsx" src` prints nothing. The advisory needs an attacker-controlled `browserslist-stats.json` |
| GHSA-c83g-rgw3-j3cx | browserslist@4.28.4 | same as above | high | Same as above | Same as above. The memory growth needs many distinct runtime queries, but browserslist runs only during the build |
| GHSA-ggr8-5vv4-36mx | deepmerge-ts@7.1.5 | `.>prisma>@prisma/config>deepmerge-ts` | high | The fix is `@prisma/config` 7.10.1 (`deepmerge-ts` 8.0.2) through the Prisma trio bump, which is blocked by the unreachable Prisma binary host (external blocker) | (a), (c) and (d) empty for `deepmerge-ts@7.1.5` and `@prisma/config`; the worker holds only `deepmerge-ts@8.0.2`. The 7.1.5 copy runs only inside the Prisma CLI (`migrate` service, `pnpm prisma migrate deploy`, docker-compose.yml line 24), where it merges the repo's own `prisma.config.ts`, not untrusted input |
| GHSA-gpj5-g38j-94v9 | drizzle-orm@0.41.0 | `.>better-auth>drizzle-orm` | high | Optional peer of better-auth, resolved because the dev-only `@better-auth/cli` brings it in (`unmet peer drizzle-orm@"^0.45.2"`) | (a), (c) and (d) empty for drizzle-orm. The app uses the Prisma adapter only (`src/lib/auth.ts:2,8`); no drizzle import in `src` |
| GHSA-prgh-xp8r-p3m5 | nodemailer@9.1.1 | `.>nodemailer` (and `mailparser>nodemailer`) | high | Fixed only at `>=10.0.5`. D-04 keeps nodemailer on major 9, and every 9.x from 9.1.0 is affected; 9.0.x is excluded by the `>=9.1.0` floor (GHSA-2x7j). Needs an owner decision on nodemailer 10 | **Reachable.** `dist/worker.mjs` bundles `nodemailer@9.1.1` and `mailparser@3.9.20`. `simpleParser` parses inbound mail at `src/lib/channels/email/ingest-message.ts:84` and in `poll-inbox.ts`, and the advisory says it is "reachable via mailparser" (addressparser on attacker-sent headers, worker DoS) |
| GHSA-v53p-9fqp-m79j | nodemailer@9.1.1 | `.>nodemailer` (and `mailparser>nodemailer`) | high | Fixed only at `>=10.0.6` (major 10), so not fixable on major 9. It was present on 9.0.3 too | **Reachable.** Same path as GHSA-prgh: the addressparser free-text fallback runs on inbound headers through `simpleParser` in the worker |

### Build-chain residuals (dev only)

These advisories appear in the full `pnpm audit` but not in `pnpm audit --prod`. Every package here is outside `dependencies`, and Task 1 showed that no shadcn-tree module is in either artifact.

| Advisory ID | Package@version | Dependency path | Severity | Why not fixed now | Why not reachable |
|---|---|---|---|---|---|
| GHSA-965c-763c-88jm | better-auth@1.4.21 | `.>@better-auth/cli>better-auth` | critical | No `@better-auth/cli` newer than 1.4.21 matching 1.7.x is published (08-02: `E404` for 1.7.20) | devDependency CLI only; the app runs better-auth 1.7.20 |
| GHSA-pw9m-5jxm-xr6h | better-auth@1.4.21 | same | critical | same | same |
| GHSA-28wg-ghj8-5hjv | nanoid@3.3.15 | `.>@tailwindcss/postcss>postcss>nanoid` | high | dev build chain; not in scope of the plan's overrides | build-time CSS only |
| GHSA-2m5v-pch6-74hx, GHSA-4cwx-7wf7-3272, GHSA-4w7w-5xrc-9h26, GHSA-qrxm-fqhp-jwvm, GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3, GHSA-xjj6-f33q-929c | undici@8.5.0 | `.>testcontainers>undici` | high | test tooling, `testcontainers` 12.0.3 pin | test runner only |
| GHSA-392p-2q2v-4372, GHSA-7w99-5wm4-3g79, GHSA-86j7-9j95-vpqj, GHSA-9h47-pqcx-hjr4, GHSA-fmh4-wcc4-5jm3, GHSA-g38m-r43w-p2q7, GHSA-q84f-53jg-9ppm, GHSA-qq9h-g4jm-xgf3 | better-auth@1.4.21 | `.>@better-auth/cli>better-auth` | high | as GHSA-965c | as GHSA-965c |
| GHSA-3jxr-9vmj-r5cp, GHSA-6j4f-fj2g-mc7p, GHSA-mh99-v99m-4gvg, GHSA-qhr7-859c-m2p7, GHSA-rgw5-rvv9-x895 | brace-expansion@2.1.1 | `.>testcontainers>archiver>archiver-utils>glob>minimatch>brace-expansion` | high | test tooling | test runner only |
| GHSA-m9gg-hp2v-232j | @grpc/grpc-js@1.14.4 | `.>testcontainers>dockerode>@grpc/grpc-js` | high | test tooling | test runner only |
| GHSA-mrhx-c7xc-m3w5 | zod@4.4.3, 3.25.76 | `.>@better-auth/cli>zod` (+1) | high | CLI's own copies; the app's zod is 4.6.7 | devDependency CLI only |
| GHSA-mwp4-54f8-5fhr | ip-address@10.2.0 | `.>shadcn>@modelcontextprotocol/sdk>express-rate-limit>ip-address` | high | shadcn tree is dev-only now; the override is scoped to `socks` | Task 1 artifact evidence: no shadcn-tree module in either artifact |
| GHSA-r28c-9q8g-f849 | postcss@8.5.15, 8.5.16 | `.>@tailwindcss/postcss>postcss` (+1) | high | dev build chain (`postcss ^8.5.16` devDependency) | build-time CSS only |
| GHSA-r5fr-rjxr-66jc | lodash@4.17.21 | `.>@better-auth/cli>@mrleebo/prisma-ast>chevrotain>lodash` | high | CLI tree | devDependency CLI only |

### Gate result

**AIDA-25 gate: red, residuals listed** (`pnpm audit --prod --audit-level=high` exit 1). Plain `pnpm audit --prod` exit 1.

## Deviations from Plan

**1. [Rule 3 - Blocking] better-auth peer snapshot breaks on every `pnpm add`**
- **Found during:** Task 1 (first `pnpm build` failed: `The export kAPIErrorHeaderSymbol was not found in module .../better-call@1.1.8...`), then again after each Task 2 add.
- **Issue:** each `pnpm add` or `remove` re-resolves `@better-auth/core@1.7.20` against `better-call@1.1.8` and `@better-fetch/fetch@1.1.21`, the dev CLI's copies, instead of the exact 1.4.5 and 1.3.3 its peers require. This is the stale snapshot 08-02 recorded as its Deviation 1.
- **Fix:** 08-02's own fix, `pnpm remove better-auth` then `pnpm add better-auth@1.7.20 --save-exact`, done three times (after the shadcn move, after the bumps, after the overrides). The final lockfile resolves `better-call@1.4.5` and `@better-fetch/fetch@1.3.3`. `pnpm install --frozen-lockfile`, the build and the tests pass on it. `package.json` keeps `"better-auth": "1.7.20"` in place.
- **Follow-up:** any later plan that runs `pnpm add` (08-08's CSP work, Dependabot PRs) can hit this again. A permanent fix, for example removing the dev-only `@better-auth/cli` 1.4.21 that supplies the old copies, is not in this plan's scope. Recorded in `deferred-items.md`.
- **Commits:** 216a33b, 3f48e65.

**2. [Rule 3 - Blocking] mailparser and imapflow bumped with nodemailer**
- **Issue:** with `nodemailer` 9.1.1 alone, `pnpm why --prod nodemailer` found 2 versions. `mailparser` 3.9.14 (and `imapflow` 1.4.6) pin `nodemailer` 9.0.3 exactly, so GHSA-2x7j would have stayed in the tree.
- **Fix:** `mailparser` 3.9.14 → 3.9.20 (pins nodemailer 9.1.1) and `imapflow` 1.4.6 → 1.7.8 (no nodemailer dependency). Both are existing direct dependencies, MIT, exact. Now one `nodemailer` version, 9.1.1. The plan named `imapflow` for a bump but not `mailparser`.
- **Commit:** 3f48e65.

**3. nodemailer 9.1.1 swaps one high advisory for another (owner decision needed)**
- On 9.0.3: GHSA-2x7j-588g-ccc2 (`<9.1.0`) and GHSA-v53p-9fqp-m79j. On 9.1.1: GHSA-prgh-xp8r-p3m5 (`>=9.1.0 <=10.0.4`) and GHSA-v53p-9fqp-m79j. The count of critical or high advisories for nodemailer stays at 2. The production total does not rise from the bump. One new advisory ID appears, which the charter's package rule ("tidak menambah temuan critical atau high") makes worth flagging.
- All three are addressparser DoS bugs, reachable through inbound mail parsing. The plan's must-have pins `>=9.1.0 <10`, so no compliant version is free of them.
- Clearing them needs `nodemailer` >= 10.0.6 and `mailparser` >= 3.9.25. That is a major bump that contradicts D-04 ("staying on major 9"), so it was not done (Rule 4). It is reported to the orchestrator as an owner decision (`ANTREAN.md` belongs to the orchestrator).

**4. Prisma trio not bumped (planned fallback path)**
- The plan's step 2 path was followed exactly. See "Prisma blocker". The Dockerfile is not modified.

## Deferred Issues

- Recurring better-auth peer snapshot (Deviation 1): appended to `.planning/phases/08-security-hardening/deferred-items.md`.

## Review Dispositions Ledger applied

- C10 (round 1): checks (a) to (e) ran against `.next/standalone` node_modules, its `.pnpm` store, every `*.nft.json` under `.next`, `dist/worker.mjs` and `pnpm why --prod`, plus a sweep of all 235 removed store entries. `audit-prod-after-shadcn.json` was saved in Task 1, read in Task 2, and its path is recorded above. No module needed "reachability not shown".
- C12 (round 1): "Version choice" table with chosen date, publish date and registry for every version picked.
- R2-2 (round 2): the Docker health rule ran before the only Docker step (`colima status` exit 0, `docker info` exit 0). Nothing is `blocked (docker unhealthy)`.

## Threat model outcome

- T-08-12: mitigated. `proxy-addr` (critical) and every shadcn-only module are out of the production tree and both artifacts.
- T-08-13: partly mitigated. zod, html-to-text (deepmerge-ts), ip-address and fast-uri are fixed. nodemailer keeps 2 reachable highs (owner decision). Prisma's deepmerge-ts is blocked externally.
- T-08-14: mitigated. Prisma did not move, the Dockerfile glob matches `@prisma/client` 7.8.0, and the verify script checks it.
- T-08-15: mitigated. Two exact, parent-scoped overrides, each with a unit test through the consuming parent's public API.
- T-08-16: mitigated. Gate reported red with both exit codes.
- T-08-SC: mitigated. Only existing packages were changed, plus get-nonce at its existing lockfile version. Exact pins, licences checked with `npm view` (MIT, MIT-0, BSD-3-Clause, Apache-2.0), no Prisma mirror.

## Blocked or not run

- Prisma 7.10.1 bump: blocked (external, binaries.prisma.sh sends 0 bytes). Reverted to 7.8.0.
- Nothing else blocked. The full `pnpm test:integration` suite was not run; the plan names only the two files.

## Known Stubs

None.

## Manual items

- Owner decision: allow `nodemailer` 10.x (and `mailparser` >= 3.9.25) to clear GHSA-prgh-xp8r-p3m5 and GHSA-v53p-9fqp-m79j, which are reachable, or accept them as residuals. D-04 currently says major 9.

## Self-Check: PASSED

- FOUND: tests/unit/dependency-overrides.test.ts; package.json has `"shadcn": "4.12.0"` in devDependencies, `"get-nonce": "1.0.1"`, and `pnpm.overrides` with two entries; the Dockerfile has `@prisma+client@7.8.0*`
- FOUND: commits 216a33b and 3f48e65 (`git log`)
- `git rev-list --count 92279703..HEAD` = 2 before this SUMMARY commit
