# Phase 8 Part A gate

Tested commit: 4d0eefd8f79542e8680d3baa27459f0a3e2f0698
Date: 2026-11-11
Run id: mwc83b4f-d165ad43755f5ab7
Evidence dir: /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l
Tree state: clean

Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): 4d0eefd8f79542e8680d3baa27459f0a3e2f0698

## Results

| Command | Exit code | Result | Note |
| --- | --- | --- | --- |
| pnpm lint | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/lint.log |
| pnpm typecheck | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/typecheck.log |
| pnpm test | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/test.log; files=71 passed=1156 failed=0 skipped=0 |
| pnpm build | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/build.log |
| pnpm audit --prod | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/audit.log; exit 1; "Severity: 2 low \| 30 moderate \| 10 high" |
| pnpm audit --prod --audit-level=high | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/audit-high.log; exit 1; "Severity: 2 low \| 30 moderate \| 10 high" |
| pnpm test:integration | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/integration.log; files=101 passed=1327 failed=0 skipped=0 |
| pnpm test:e2e | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/e2e.log; expected=219 unexpected=0 skipped=1 flaky=0 |
| pnpm test:egress | 1 | blocked (space) | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/egress.log; file=tests/integration/egress-isolation.test.ts passed=0 failed=0 other=4 word=blocked (space); "Free space on the host is 18.5 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check runner | 3 | blocked (space) | "IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=runner tag=aida-test-nonroot-runner:mwc83b4f-d165ad43755f5ab7"; "Free space on the host is 18.5 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check builder | 3 | blocked (space) | "IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=builder tag=aida-test-nonroot-builder:mwc83b4f-d165ad43755f5ab7"; "Free space on the host is 18.5 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| pnpm test:docker-cleanup --run | 0 | passed | "0 resource(s) of run mwc83b4f-d165ad43755f5ab7; dry run, nothing removed." |
| compose stack gate | - | moved to Phase 8.1 | Part B: plan 08-16 (deferred-8.1); not run by this gate (08-SPLIT) |

## Evidence checks

| Check | Result | Note |
| --- | --- | --- |
| pnpm audit --prod exit recorded | passed | exit 1 |
| build log has no Google Fonts host | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/build.log: no Google Fonts host |
| OPERATIONS.md volume upgrade procedure | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/ops-volume.log: "volume upgrade procedure documented" |
| OPERATIONS.md client IP section | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/ops-client-ip.log: "client IP constraint documented" |
| sla-flag raw SQL comment | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-wXmL2l/sla-flag-comment.log: "sla-flag raw SQL comment present" |
| foreign resources unchanged | passed | 1 listed line(s), identical |
| no foreign project named in gate logs | passed | 20 log file(s) scanned |

## Design-system checklist (§9)

| Item | Result | Evidence |
| --- | --- | --- |
| 1 new tokens live in globals.css, not hardcoded | passed | pnpm test :: tests/unit/design-tokens.test.ts; pnpm test :: tests/unit/build-egress-guards.test.ts |
| 2 empty state uses halo and icon box | not run (manual: 6 UI files changed) | part-a-src.patch: src/components/theme-provider.tsx, src/app/layout.tsx, src/app/(app)/settings/email/test-connection-button.tsx, src/app/(app)/settings/embedding-test-connection-button.tsx, src/app/(app)/settings/llm-test-connection-button.tsx, src/app/globals.css |
| 3 sidebar uses `sidebar-*` tokens | not run (manual: 6 UI files changed) | part-a-src.patch: src/components/theme-provider.tsx, src/app/layout.tsx, src/app/(app)/settings/email/test-connection-button.tsx, src/app/(app)/settings/embedding-test-connection-button.tsx, src/app/(app)/settings/llm-test-connection-button.tsx, src/app/globals.css |
| 4 top bar is sticky with backdrop blur | not run (manual: 6 UI files changed) | part-a-src.patch: src/components/theme-provider.tsx, src/app/layout.tsx, src/app/(app)/settings/email/test-connection-button.tsx, src/app/(app)/settings/embedding-test-connection-button.tsx, src/app/(app)/settings/llm-test-connection-button.tsx, src/app/globals.css |
| 5 auth page does not wrap itself | not run (manual: 6 UI files changed) | part-a-src.patch: src/components/theme-provider.tsx, src/app/layout.tsx, src/app/(app)/settings/email/test-connection-button.tsx, src/app/(app)/settings/embedding-test-connection-button.tsx, src/app/(app)/settings/llm-test-connection-button.tsx, src/app/globals.css |
| 6 typography uses explicit `text-[Npx]` | passed | part-a-src.patch: 104 added .tsx/.css line(s), no named text size |
| 7 dark mode tested | not run (manual: visual check) | human item |
| 8 `tsc --noEmit` clean | passed | pnpm typecheck |

## Evidence matrix

| # | Requirement | Acceptance item | Required | Part A evidence | Part A state | Phase 8.1 part | Phase 8.1 state | Closed in Part A |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | AIDA-25 | `pnpm audit --prod --audit-level=high` exits 0 | part-a | pnpm audit --prod --audit-level=high | failed | - | - | no |
| 2 | AIDA-25 | the exit code of plain `pnpm audit --prod` is recorded as it is | part-a | pnpm audit --prod exit recorded | passed | - | - | yes |
| 3 | AIDA-26 | `.github/dependabot.yml` exists | part-a | pnpm test :: tests/unit/build-egress-guards.test.ts | passed | - | - | yes |
| 4 | AIDA-26 | a CI job runs `pnpm audit --prod --audit-level=high` (files only) | part-a | pnpm test :: tests/unit/build-egress-guards.test.ts | passed | - | - | yes |
| 5 | AIDA-27 | `app` and `worker` run with a non-zero UID while up | phase-8.1 | - | - | 08-14, 08-16 | moved to Phase 8.1 | no |
| 6 | AIDA-27 | the one-shot `migrate` runs with a non-zero UID and exits 0 | phase-8.1 | - | - | 08-14, 08-16 | moved to Phase 8.1 | no |
| 7 | ↳ | build path: the runner and builder images are built to run as a non-root user | part-a | pnpm test :: tests/unit/container-config.test.ts; image check runner; image check builder | blocked (space) | - | - | no |
| 8 | AIDA-27 | an attachment upload succeeds on a fresh volume | phase-8.1 | - | - | 08-14 | moved to Phase 8.1 | no |
| 9 | AIDA-27 | the upgrade path for an existing root-owned `uploads_data` volume is documented in docs/OPERATIONS.md | part-a | OPERATIONS.md volume upgrade procedure | passed | - | - | yes |
| 10 | ↳ | D-09: the documented procedure works on a real root-owned volume, and backups run as non-root | phase-8.1 | - | - | 08-23 | moved to Phase 8.1 | no |
| 11 | AIDA-28 | an E2E test asserts the CSP header and zero CSP violations on login, inbox, ticket, public request and public status pages | part-a | pnpm test:e2e :: tests/e2e/csp.spec.ts | passed | - | - | yes |
| 12 | ↳ | review C6: the same pages under `next start` with the production policy | phase-8.1 | - | - | 08-21 | moved to Phase 8.1 | no |
| 13 | ↳ | D-11: inline script without a nonce is blocked and `connect-src` is `'self'` in production | phase-8.1 | - | - | 08-21 | moved to Phase 8.1 | no |
| 14 | AIDA-29 | unit tests cover the shipped Caddy topology and a spoofed header | part-a | pnpm test :: tests/unit/client-ip.test.ts | passed | - | - | yes |
| 15 | AIDA-29 | all public routes use the helper | part-a | pnpm test:integration :: tests/integration/public-route-limits.test.ts; pnpm test:integration :: tests/integration/auth-ip-source.test.ts | passed | - | - | yes |
| 16 | AIDA-29 | the deployment constraint is documented in docs/OPERATIONS.md | part-a | OPERATIONS.md client IP section | passed | - | - | yes |
| 17 | ↳ | D-19: a spoofed X-Forwarded-For through real Caddy does not change the identity | phase-8.1 | - | - | 08-22 | moved to Phase 8.1 | no |
| 18 | ↳ | review C7: over real HTTP against `next start` the client-sent `x-aida-client-ip` is overwritten and the sign-in limiter is per identity | phase-8.1 | - | - | 08-21 | moved to Phase 8.1 | no |
| 19 | AIDA-30 | `/api/health` is throttled | part-a | pnpm test :: tests/unit/health.test.ts | passed | - | - | yes |
| 20 | AIDA-30 | the throttle does not break the container healthcheck | phase-8.1 | - | - | 08-21, 08-22 | moved to Phase 8.1 | no |
| 21 | AIDA-30 | `/api/public/status/[token]/attachments/[id]` is throttled | part-a | pnpm test:integration :: tests/integration/public-route-limits.test.ts | passed | - | - | yes |
| 22 | AIDA-30 | `follow-up` enforces a combined request-size cap | part-a | pnpm test:integration :: tests/integration/public-upload-caps.test.ts | passed | - | - | yes |
| 23 | AIDA-30 | both status POST routes check the rate limit before the token lookup | part-a | pnpm test:integration :: tests/integration/public-route-limits.test.ts | passed | - | - | yes |
| 24 | ↳ | D-24: bodies above the old 12 MB Caddy cut pass through Caddy within the product limits | phase-8.1 | - | - | 08-14 | moved to Phase 8.1 | no |
| 25 | ↳ | review R2-7: the probe never reaches the upstream through Caddy, and both health routes stay within one database read per 3-second window on the production build | phase-8.1 | - | - | 08-21, 08-22 | moved to Phase 8.1 | no |
| 26 | AIDA-31 | all four call sites return a fixed category | part-a | pnpm test :: tests/unit/connection-test-errors.test.ts; pnpm test :: tests/unit/settings-connection-actions.test.ts | passed | - | - | yes |
| 27 | AIDA-32 | `NEXT_TELEMETRY_DISABLED=1` is set in the image build and runtime | both | pnpm test :: tests/unit/container-config.test.ts | passed | 08-14 | moved to Phase 8.1 | no |
| 28 | AIDA-32 | `next build` makes no request to Google Fonts | part-a | pnpm test :: tests/unit/build-egress-guards.test.ts; pnpm build; build log has no Google Fonts host | passed | - | - | yes |
| 29 | AIDA-32 | `addTag` gates before validating | part-a | pnpm test :: tests/unit/add-tag-gate.test.ts | passed | - | - | yes |
| 30 | AIDA-32 | `sla-flag` documents why its raw SQL has no org filter | part-a | sla-flag raw SQL comment | passed | - | - | yes |
| 31 | AIDA-32 | `docs/SECURITY.md` matches the code | phase-8.1 | - | - | 08-15 | moved to Phase 8.1 | no |

## Requirement status

| Requirement | Part A rows closed | Moved to Phase 8.1 | Requirement closed |
| --- | --- | --- | --- |
| AIDA-25 | no | - | no |
| AIDA-26 | yes | - | yes |
| AIDA-27 | no | 5, 6, 8, 10 | no |
| AIDA-28 | yes | 12, 13 | no (split: Phase 8.1) |
| AIDA-29 | yes | 17, 18 | no (split: Phase 8.1) |
| AIDA-30 | yes | 20, 24, 25 | no (split: Phase 8.1) |
| AIDA-31 | yes | - | yes |
| AIDA-32 | yes | 27, 31 | no (split: Phase 8.1) |

## Human items still open

- Owner: decide whether the Part A commit on the candidate line is enough for `v1.0.0` (08-SPLIT "Release safe point"). This plan offers it only as a candidate.
- Owner: Docker VM space (queue item 0a2). Until the host and the VM each have at least 20 GiB free, `pnpm test:egress` and both 08-09 image checks stay `blocked (space)`. Re-run those rows once space is added. The build-path halves of AIDA-27 and AIDA-32 stay open until then.
- Owner: Phase 8.1 (Part B, queue row 08.1). The rows marked `moved to Phase 8.1`, the open HIGH findings R4-1 (plan 08-16) and R4-2 (plan 08-05b), and the blockers 0a2 and 08-o2 wait for the owner's decision on how Part B proceeds.
- Human: visual approval of the system font stack in light and dark mode, and re-capture of the screenshots and hero GIF in `docs/assets` (plan 08-05, D-26). Never claimed here.
- Human: every design-system checklist item recorded as `not run (manual: ...)`.
- Orchestrator: if the cleanup dry run listed resources, apply `pnpm test:docker-cleanup --run <run id> --apply` (rule H) and record it in RUN-LOG.md. This plan removes nothing.

Design-system checklist:
- 2 empty state uses halo and icon box: not run (manual: 6 UI files changed)
- 3 sidebar uses `sidebar-*` tokens: not run (manual: 6 UI files changed)
- 4 top bar is sticky with backdrop blur: not run (manual: 6 UI files changed)
- 5 auth page does not wrap itself: not run (manual: 6 UI files changed)
- 7 dark mode tested: not run (manual: visual check)

Re-run once the cause is gone:
- Results: pnpm audit --prod: failed
- Results: pnpm audit --prod --audit-level=high: failed
- Results: pnpm test:egress: blocked (space)
- Results: image check runner: blocked (space)
- Results: image check builder: blocked (space)

## Notes

- Rerun after 08-gap1. The tested commit `4d0eefd` holds the 08-gap1 test fix (`c403af7`). Outside `.planning` it differs from `c403af7` in nothing, and from the first run's `61c8696` only in the three integration test files of 08-gap1. No product code changed.
- `.next` moved once: `mv .next ~/.Trash/aida-next-1794408154`. The first `pnpm test:e2e` (exit 1, 0 tests run) hung in global setup on `/setup` (`page.waitForURL(/\/login/)` timeout at `tests/e2e/global-setup.ts:165`, the known stale `.next` after `pnpm build`). Its evidence is kept as `e2e-attempt1.log`, `.json` and `.exit` in the evidence directory. After the move, `pnpm test:e2e` was rerun once, alone, and its result is the recorded row.
- `pnpm test:egress` and both image checks stopped at J1's host check (18.5 GiB free on the host, checked before the VM; the VM had 13.9 GiB at 0a2). Both are rule J space stops, recorded `blocked (space)`. Nothing was freed, pruned or removed.
- `pnpm audit --prod` and `--audit-level=high` exit 1 with 0 critical and 10 high. The residual table is in 08-04-SUMMARY.md, "Residual table". AIDA-25 stays open.
