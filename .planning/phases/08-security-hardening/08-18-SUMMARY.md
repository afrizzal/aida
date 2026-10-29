---
phase: 08-security-hardening
plan: 18
subsystem: security
status: complete
tags: [client-ip, x-forwarded-for, caddy, cdn, docs, AIDA-29]
requires: ["08-09", "08-10"]
provides:
  - "docker-compose.yml: TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-} in the app service"
  - ".env.example: TRUSTED_PROXY_HOPS= (blank, advanced)"
  - "docs/OPERATIONS.md: ## Client IP and reverse proxies, env row, Health checks pointer"
  - "website environment page: TRUSTED_PROXY_HOPS row and pointer paragraph"
affects: ["08-12", "08-15"]
tech-stack:
  added: []
  patterns: ["deployment contract documented next to the code that depends on it"]
key-files:
  created: []
  modified: [.env.example, docker-compose.yml, docs/OPERATIONS.md, website/src/content/docs/configuration/environment.md]
decisions:
  - "TRUSTED_PROXY_HOPS goes to the app service only; worker and migrate handle no HTTP requests"
  - "The website row links to OPERATIONS.md on GitHub, the link style the page already uses for the operations runbook"
metrics:
  duration: "about 4m"
  completed: 2026-11-11
  tasks: 2
  files: 4
estimate:
  tokens: 35000
actuals:
  tokens: 3000
  tasks: 2
  commits: 2
plan_head_before: 8395e64eceaf3edebab11bcd4ed66ce71626f6ef
---

# Phase 8 Plan 18: Client-IP Deployment Contract Summary

`TRUSTED_PROXY_HOPS` now flows from `.env` through compose into the app container, blank by default (read as 0). docs/OPERATIONS.md has a new `## Client IP and reverse proxies` section covering six things: the one supported topology, direct `app:3000` access as the trust boundary, the three-step CDN setup, the CDN contract, how wrong settings fail closed, and the Better Auth header. Both environment tables list the new variable.

`actuals.tokens` is chars/4 over the plan diff (12,178 chars).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | bddae40 | chore(08-18): pass TRUSTED_PROXY_HOPS to the app container (D-17) |
| 2 | aec5466 | docs(08-18): client-IP deployment contract and TRUSTED_PROXY_HOPS (D-16, D-17) |

## Compose config results

| Command | Exit | Result |
|---------|------|--------|
| Task 1 verify (scratch env `TRUSTED_PROXY_HOPS=1`, then `--env-file /dev/null`) | 0 | `compose passes TRUSTED_PROXY_HOPS`: app gets `"1"`, then `""` |
| `docker compose -f docker-compose.yml --env-file /dev/null config --quiet` | 0 | valid (only the usual unset-variable warnings) |
| rendered config, worker and migrate | n/a | `TRUSTED_PROXY_HOPS` undefined in both, as intended |
| `grep -nF 'TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-}' docker-compose.yml` | 0 | one line (72), inside `app` |
| Task 2 verify (docs check) | 0 | `client-ip docs ok` |
| `pnpm exec vitest run tests/unit/client-ip.test.ts` | 0 | 1 file, 32 passed |

No Docker daemon step ran: `config` renders without the daemon. The compose stack was not started. The scratch directory under `${TMPDIR}` was deleted.

## Docs sections added

- docs/OPERATIONS.md `## Client IP and reverse proxies`, placed directly before `## Environment variable reference`.
- docs/OPERATIONS.md env table: a `TRUSTED_PROXY_HOPS` row after `RATE_LIMIT_PEPPER`.
- docs/OPERATIONS.md `## Health checks`: the "never port 3000 directly" sentence now goes on: "Exposing port 3000 is unsupported; see Client IP and reverse proxies." The rest of the section is unchanged.
- website environment page: the same row, linking to the GitHub OPERATIONS.md anchor, plus a paragraph after the table.

## Statement-to-proof list

| Statement in the new section | Proof |
|------------------------------|-------|
| Caddy overwrites X-Forwarded-For with the TCP peer (`header_up X-Forwarded-For {remote_host}`) | Caddyfile line inside `reverse_proxy app:3000`; Caddy contract unit test in tests/unit/client-ip.test.ts (08-10) |
| The app uses the rightmost entry; IPv4 is used whole, IPv6 by its /64 | `getClientIp` and `rateLimitKeyForIp` in src/lib/rate-limit/client-ip.ts; unit tests (08-10) |
| Only a peppered hash is stored | 08-10-SUMMARY, C9; tests/unit/rate-limit-pepper.test.ts |
| Direct app:3000 access lets the caller choose its identity; Next.js fills a missing XFF with the TCP peer | `getClientIp` takes the header as sent; next 16.4.6 base-server.js:604 (08-10-SUMMARY platform fact) |
| Compose does not publish port 3000 | docker-compose.yml `app` has no `ports:` (rendered config) |
| With hops N, the entry N places from the right is used; max 10 | `index = entries.length - 1 - hops`; `MAX_TRUSTED_PROXY_HOPS = 10`; C8 unit tests |
| Invalid value, short chain, or malformed trusted entry gives the shared bucket | `SHARED_CLIENT_BUCKET` returns in `getClientIp`; C8 unit tests |
| The invalid value logs one line with no address, with the quoted text | `console.error` at client-ip.ts line 65; log-content unit test (08-10) |
| Leading zeros are invalid | `HOPS_PATTERN = /^(?:[0-9]|10)$/` (code reading; tests/unit/client-ip.test.ts has no `010` case) |
| Too low keys on the CDN's address; too high gives the shared bucket | C8 unit tests "hops too low" and "hops too high" |
| Left entries are ignored, never parsed | loop starts at `index`; the C8 left-entries unit test |
| Better Auth reads only `x-aida-client-ip`, which the proxy overwrites | src/lib/auth.ts `ipAddressHeaders: [CLIENT_IP_HEADER]`; proxy unit tests P, Q, R; tests/integration/auth-ip-source.test.ts (08-10) |
| Caddy ignores an incoming XFF unless the peer is in `trusted_proxies` | Caddy docs, checked by the planner through Context7 and recorded in the plan; not checked again here, and no real-Caddy test (that proof is 08-22, deferred to 8.1) |

## Deviations from Plan

1. **Acceptance check replaced.** The plan's `git status --porcelain .env` was blocked by the secret-file read guard. `.env` was never opened, and both commits staged only named files, so the operator's `.env` is untouched.
2. **Grep form.** `grep -n` with `${...}` returned 0 on macOS BSD grep, so the check uses `grep -nF`. It finds one line.
3. **Docs detail added.** The section names the global-options form `servers { trusted_proxies static <ranges> }` and says leading zeros are invalid (from `HOPS_PATTERN`). Both are descriptions only; no code changed.

## Review Dispositions Ledger applied

- C7: the trust boundary is written as reachable, with what it allows and whose job it is. It is described as neither supported nor impossible.
- C8 (accepted part): the CDN overwrite-or-sanitize contract, the firewall restriction when hops are above 0, and the effects of too low and too high are in the section. C8 (rejected part): the docs say left entries are "ignored, never parsed or validated". Nothing promises validation.
- C12: ordering only (wave 7).
- R2-2: not applicable; no Docker daemon step.

## Threat model check

T-08-73, T-08-74 and T-08-80 are mitigated by the section, the Health checks pointer and the compose plumbing as planned. No new security surface was added.

## Known Stubs

None.

## Manual items

None for this plan.

## Self-Check: PASSED

- FOUND: commits bddae40, aec5466
- `git rev-list --count 8395e64..HEAD` = 2 before the docs commit
- All four modified files contain `TRUSTED_PROXY_HOPS`
