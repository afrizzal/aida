---
phase: 08-security-hardening
plan: 01
subsystem: dependencies
status: complete
tags: [security, dependencies, next, audit, AIDA-25]
requires: []
provides:
  - "next 16.4.6 exact pin (D-01 first step)"
  - "baseline and post-upgrade production audit evidence"
affects: [08-02, 08-03, 08-04, 08-05, 08-06, 08-07]
tech-stack:
  added: []
  patterns: ["exact pin for framework upgrades; audit before and after each package step"]
key-files:
  created:
    - .planning/phases/08-security-hardening/deferred-items.md
  modified:
    - package.json
    - pnpm-lock.yaml
    - next.config.ts
decisions:
  - "next pinned to 16.4.6, the newest stable 16.x on 2026-11-11 (latest dist-tag)"
  - "next.config.ts sets agentRules: false, because next 16.4 next dev otherwise writes a managed AGENTS.md into the repo root"
metrics:
  duration: "about 6 min wall clock (10:38Z to 10:44Z)"
  completed: 2026-11-11
  tasks: 2
  files: 3
actuals:
  tokens: 1500
  tasks: 2
  commits: 2
plan_head_before: a6a8499c4f159209e546cadad49fcf20c8fe5bb2
commits: 2
---

# Phase 8 Plan 01: next upgrade to 16.4.6 Summary

`next` moves from 16.2.11 to 16.4.6 with an exact pin and an MIT licence. Typecheck, the unit tests, the build, the proxy unit test and the three E2E specs pass on it. The production audit drops from 7 critical / 52 high to 2 critical / 45 high. The audit still exits 1 at both levels, so it is **not passed**.

## Version choice

| Package | Chosen version | Chosen on | Published | Newest stable 16.x seen | Registry |
|---|---|---|---|---|---|
| next | 16.4.6 | 2026-11-11 | 2026-11-09T20:33:38.821Z | 16.4.6 (`latest` dist-tag; canary 16.5.0-canary.47 and preview 16.3.0-preview.10 excluded) | https://registry.npmjs.org/ |

- Licence: `npm view next@16.4.6 license` printed `MIT`.
- Peer range of 16.4.6 for `react` and `react-dom` is `^18.2.0 || ^19.0.0`. The repo has 19.2.7, so no React change was needed.
- No other package was added or changed in `package.json`. The lockfile changed only transitive entries under `next`: `sharp` 0.34.5 to 0.35.5 (licence Apache-2.0), the `@img/sharp-*` and `@img/sharp-libvips-*` platform packages (1.2.4 to 1.3.4, plus the new optional `@img/sharp-freebsd-wasm32`), `postcss` 8.4.31 to 8.5.23 (the copy pinned by `next`), and a re-hash of the `better-auth` peer suffixes.
- Existing unmet peer warnings printed by `pnpm add` (`@better-fetch/fetch`, `kysely`, `drizzle-orm` under `better-auth`/`@better-auth/cli`) were there before this plan. They belong to 08-02.

## Upgrade notes

Sources: GitHub release notes https://github.com/vercel/next.js/releases/tag/v16.3.0, https://github.com/vercel/next.js/releases/tag/v16.4.0 and https://github.com/vercel/next.js/releases/tag/v16.4.1 (read through the GitHub REST API, keyword-filtered), plus Context7 `/vercel/next.js/v16.4.5` docs for `proxyClientMaxBodySize` and the version-16 upgrade guide.

| Item checked | Finding | Effect on this repo |
|---|---|---|
| `proxy.ts` convention | Still the file convention in 16.4 (`src/proxy.ts`, named export `proxy`). 16.3.0: "Turbopack: Match proxy matchers with webpack implementation" (#93594) and "Trace middleware/proxy source files in webpack NFT pipeline" (#93871). 16.4.0: "detect proxy.ts correctly with compound pageExtensions" (#93246) | None. `tests/unit/proxy.test.ts` and `tests/e2e/authz.spec.ts` pass |
| `experimental.proxyClientMaxBodySize` | Still `experimental.proxyClientMaxBodySize` in the 16.4.5 docs, number or string, default 10MB, over-limit bodies are truncated with a warning | None. Key and value `MAX_TOTAL_REQUEST_BYTES` unchanged, lockstep comment kept |
| Nonce / CSP handling | No change named in the 16.3.0, 16.4.0 or 16.4.1 notes | None for 08-01; 08-07 builds the CSP on 16.4.6 |
| `output: "standalone"` | 16.3.0: "Fix server actions in standalone mode with `cacheComponents`" (#91711), "Fix \"type: module\" in project dir when using standalone or adapters" (#93612) | No breaking change. The repo has `"type": "module"`; the build passes |
| Turbopack defaults | Turbopack stays the default for `next dev` and `next build` (version-16 guide); no new default named in 16.3 or 16.4 | None. Build prints `Next.js 16.4.6 (Turbopack)` |
| Minimum React | 16.4.0: "Pages Router: Deprecate React 18 support" (#97689) | None. App Router on React 19.2.7 |
| Edge runtime | 16.3.0: "Deprecate edge runtime" (#93369) | None. `grep` finds no `runtime = "edge"` in `src/` |
| `use cache` | 16.3.0 warns that `experimental.useCache` is deprecated | None. No `use cache` or `cacheComponents` in `src/` or `next.config.ts` |
| Security fixes | 16.4.1 notes fix GHSA-673q-mjm6-r5xr (`use cache` RCE), GHSA-2464-fhr4-w9xw (Image Optimization RCE with SVG), GHSA-p3m5-59mp-jv5r (Server Actions DoS) | All three were in the baseline; none remains after the bump |
| `next dev` writes `AGENTS.md` (new in 16.4, not in the keyword-filtered notes; found at runtime) | The first E2E run printed "Generated AGENTS.md for AI agents. Set `agentRules: false` in next.config to disable." and left an untracked `AGENTS.md` at the repo root. The option is typed in `node_modules/next/dist/server/config-shared.d.ts` (`agentRules?: boolean`, default true) | `next.config.ts` now sets `agentRules: false` (commit `1f88eed`); see Deviations |

Task 1 step 5: no breaking change required a `next.config.ts` key rename, so Task 1 left the file untouched. The only change to it is the `agentRules` line from Task 2.

## Baseline audit (before the bump, HEAD a6a8499, next 16.2.11)

| Command | Exit code | Totals |
|---|---|---|
| `pnpm audit --prod --json` | 1 | metadata: 13 low, 69 moderate, 52 high, 7 critical |
| `pnpm audit --prod` | 1 | 141 vulnerabilities: 13 low, 69 moderate, 52 high, 7 critical |
| `pnpm audit --prod --audit-level=high` | 1 | same 141 |

Critical and high advisories grouped by top-level production package (root of `findings[].paths`). An advisory that reaches two roots is counted under both.

| Top-level package | Critical | High | Vulnerable modules |
|---|---|---|---|
| next | 5 | 9 | browserslist, next, postcss, sharp |
| shadcn | 1 | 24 | @modelcontextprotocol/sdk, body-parser, brace-expansion, js-yaml, nanoid, postcss, proxy-addr, systeminformation, undici, zod |
| better-auth | 1 | 7 | better-auth, drizzle-orm, mysql2, nanoid, source-map-js, vite |
| prisma | 0 | 7 | fast-uri |
| nodemailer | 0 | 2 | nodemailer |
| imapflow | 0 | 1 | ip-address |
| html-to-text | 0 | 1 | deepmerge-ts |
| zod | 0 | 1 | zod |

`next` baseline advisories: critical GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j, GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr; high GHSA-cjq9-62q9-8jv4, GHSA-p3m5-59mp-jv5r; via `sharp` GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w; via `postcss` 8.4.31 GHSA-6g55-p6wh-862q; via `browserslist` GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g.

## Post-upgrade audit (after the bump, next 16.4.6, before any other dependency)

| Command | Exit code | Totals |
|---|---|---|
| `pnpm audit --prod --json` | 1 | metadata: 12 low, 64 moderate, 45 high, 2 critical |
| `pnpm audit --prod` | 1 | 123 vulnerabilities: 12 low, 64 moderate, 45 high, 2 critical |
| `pnpm audit --prod --audit-level=high` | 1 | same 123 |

Both forms still exit 1. **The audit is not passed.**

| Top-level package | Critical | High | Delta (critical / high) |
|---|---|---|---|
| next | 0 | 2 | -5 / -7 |
| shadcn | 1 | 24 | 0 / 0 |
| better-auth | 1 | 7 | 0 / 0 |
| prisma | 0 | 7 | 0 / 0 |
| nodemailer | 0 | 2 | 0 / 0 |
| imapflow | 0 | 1 | 0 / 0 |
| html-to-text | 0 | 1 | 0 / 0 |
| zod | 0 | 1 | 0 / 0 |
| **Total (metadata)** | **2** | **45** | **-5 / -7** |

Residual under `next`: `browserslist` 4.28.4 (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g, vulnerable `<=4.28.6`, patched `>=4.28.7`), path `next > styled-jsx > @babel/core > @babel/helper-compilation-targets > browserslist`. This is a build-time Babel helper. It is input for 08-04 (narrow override or upstream fix). The other residual critical advisories are `proxy-addr` under `shadcn` (08-03) and `better-auth` GHSA-965c-763c-88jm (08-02).

## sharp and F-05 (input for 08-04, D-04)

- `pnpm why --prod sharp` (exit 0): one version, `sharp@0.35.5`, reached through `next@16.4.6` (directly and through `better-auth@1.6.22`'s `next` peer).
- GHSA-f88m-g3jw-g9cj (F-05): reported 3 times in the baseline JSON, 0 times after the bump. F-05 is no longer reported by `pnpm audit --prod`. The other two sharp advisories (GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w) are gone too, so 08-04 has no `sharp` residual left to justify.

## Commands run

Logs and audit JSON are in a `mktemp -d` directory under `${TMPDIR}` (`aida-0801-taysp1`), outside the repo. Every exit code was read without a pipe.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `pnpm audit --prod --json` (baseline) | 1 | 7 critical, 52 high |
| 2 | `pnpm audit --prod` (baseline) | 1 | 141 vulnerabilities |
| 3 | `pnpm audit --prod --audit-level=high` (baseline) | 1 | 141 vulnerabilities |
| 4 | `npm view next versions --json`, `npm view next dist-tags --json`, `npm view next time --json`, `npm config get registry` | 0 | newest stable 16.4.6 |
| 5 | `npm view next@16.4.6 license peerDependencies dependencies --json` | 0 | MIT |
| 6 | `pnpm add next@16.4.6 --save-exact` | 0 | `next 16.2.11 -> 16.4.6` |
| 7 | `pnpm install --frozen-lockfile` | 0 | lockfile in sync |
| 8 | `pnpm typecheck` | 0 | clean |
| 9 | `pnpm test` | 0 | 53 files, 891 tests passed |
| 10 | `pnpm build` | 0 | Compiled successfully, no "Failed to compile"; 5 Turbopack warnings (see Deferred) |
| 11 | Task 1 verify (`node -e` exact-pin check) | 0 | `next 16.4.6` |
| 12 | `pnpm exec vitest run tests/unit/proxy.test.ts` | 0 | 1 file, 7 tests passed |
| 13 | `colima status` / `docker info` (Docker health rule) | 0 / 0 | healthy, no error lines |
| 14 | `pnpm test:e2e tests/e2e/authz.spec.ts tests/e2e/public-intake.spec.ts tests/e2e/public-status.spec.ts` | 0 | 7 passed, 0 failed |
| 15 | `pnpm audit --prod --json` (post) | 1 | 2 critical, 45 high |
| 16 | `pnpm audit --prod` (post) | 1 | 123 vulnerabilities |
| 17 | `pnpm audit --prod --audit-level=high` (post) | 1 | 123 vulnerabilities |
| 18 | `pnpm why --prod sharp` | 0 | sharp 0.35.5 |
| 19 | after the `agentRules` change: `pnpm typecheck` | 0 | clean |
| 20 | after the `agentRules` change: `pnpm build` | 0 | Compiled successfully, same 5 warnings |
| 21 | after the `agentRules` change: `colima status` / `docker info` | 0 / 0 | healthy |
| 22 | after the `agentRules` change: the same three E2E specs, one Playwright process | 0 | 7 passed, 0 failed, no "Generated AGENTS.md", no `AGENTS.md` on disk |
| 23 | `pnpm exec biome check next.config.ts` | 0 | clean |
| 24 | after the `agentRules` change: `pnpm exec vitest run tests/unit/proxy.test.ts` | 0 | 7 tests passed |

E2E environment: `AIDA_TEST_RUN_ID=mwbzitrz-2ce0bb0d4e44f006`, `DOCKER_HOST` from `docker context inspect`. No first-hit 404, so no spec change was needed. `.next/` was not moved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] next 16.4 `next dev` writes `AGENTS.md` into the repo root**
- **Found during:** Task 2, first E2E run (Playwright starts `next dev`).
- **Issue:** On 16.4.6, `next dev` detects an AI coding agent and writes a managed `AGENTS.md` at the project root. Its text tells agents to read `node_modules/next/dist/docs/` and to commit the file. That happens on every E2E run of every later plan, in a public repo whose agent instructions live in the checked-in `CLAUDE.md`. The file stays untracked, so a later broad stage could commit it.
- **Fix:** `agentRules: false` in `next.config.ts`, with a comment. Typed option, default `true`. The generated file was moved to the Trash (`~/.Trash/aida-AGENTS-md-<epoch>`), not committed. Typecheck, build, the proxy unit test and the three E2E specs were re-run and pass, and the file is not re-created.
- **Files modified:** `next.config.ts`
- **Commit:** `1f88eed`
- **Plan scope:** The plan expected `next.config.ts` to change only for a breaking key rename (Task 1 step 5), and expected Task 2 to change no file unless a regression was found. This is a behaviour change from the upgrade that affects the repo, so it was fixed under Task 2 step 2 ("If a failure is a real behaviour change from the upgrade, fix the product code and record the change"), with the `fix(08-01): ... on next 16.4.6` subject that step 5 prescribes.

## Deferred Issues

- Turbopack NFT warning "Dynamic filesystem access causes tracing of the whole project" (5 warnings) from `src/lib/attachments/local-file-storage.ts`. Logged in `.planning/phases/08-security-hardening/deferred-items.md`. Not checked against 16.2.11. It matters for the 08-03 standalone grep.

## Review Dispositions Ledger applied

- C12 (round 1): the "Version choice" table above has Chosen on, Published and Registry for `next`.
- R2-2 (round 2): the Docker health rule ran before each E2E run (`colima status` and `docker info`, both exit 0). Nothing is `blocked (docker unhealthy)`.

## Blocked or not run

- Nothing blocked. The release notes for 16.4.2 to 16.4.6 were not read one by one. The upgrade-note check covered the minors 16.3.0 and 16.4.0 plus 16.4.1, as the plan specified.

## Manual items

- None for this plan.

## Threat model outcome

- T-08-01: mitigated in part. `next`'s own critical advisories are gone (5 to 0 critical, 9 to 2 high under `next`). Residual `browserslist` goes to 08-04.
- T-08-02: proxy auth gate unchanged. `tests/unit/proxy.test.ts` 7/7, `authz.spec.ts` 2/2.
- T-08-03: both audit forms recorded with exit code 1, never as passed.
- T-08-SC: no new package name. Exact pin, MIT checked, lockfile integrity from pnpm.

## Self-Check: PASSED

- FOUND: package.json (`"next": "16.4.6"`), pnpm-lock.yaml (`next@16.4.6`), next.config.ts (`agentRules: false`), .planning/phases/08-security-hardening/deferred-items.md
- FOUND: commit 0d7796f, commit 1f88eed
