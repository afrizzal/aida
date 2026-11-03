# Phase 8 Part A gate

Tested commit: fc8078f04292c7718b31cae09050ff5cd56bfe3c
Date: 2026-11-12
Run id: mwcgrr52-67111e2a3044e0ec
Evidence dir: /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa
Tree state: clean

Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): fc8078f04292c7718b31cae09050ff5cd56bfe3c

## Results

| Command | Exit code | Result | Note |
| --- | --- | --- | --- |
| pnpm lint | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/lint.log |
| pnpm typecheck | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/typecheck.log |
| pnpm test | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/test.log; files=78 passed=1395 failed=0 skipped=0 |
| pnpm build | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/build.log |
| pnpm audit --prod | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/audit.log; exit 1; "Severity: 2 low \| 30 moderate \| 10 high" |
| pnpm audit --prod --audit-level=high | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/audit-high.log; exit 1; "Severity: 2 low \| 30 moderate \| 10 high" |
| pnpm test:integration | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/integration.log; files=101 passed=1360 failed=0 skipped=0 |
| pnpm test:e2e | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/e2e.log; expected=225 unexpected=0 skipped=1 flaky=0 |
| pnpm test:egress | 1 | blocked (space) | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/egress.log; file=tests/integration/egress-isolation.test.ts passed=0 failed=0 other=4 word=blocked (space); "Free space on the host is 14.8 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check runner | 3 | blocked (space) | "IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=runner tag=aida-test-nonroot-runner:mwcgrr52-67111e2a3044e0ec exit=3"; "Free space on the host is 14.8 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check builder | 3 | blocked (space) | "IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=builder tag=aida-test-nonroot-builder:mwcgrr52-67111e2a3044e0ec exit=3"; "Free space on the host is 14.8 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| pnpm test:docker-cleanup --run | 0 | passed | "0 resource(s) of run mwcgrr52-67111e2a3044e0ec; dry run, nothing removed." |
| compose stack gate | - | moved to Phase 8.1 | Part B: plan 08-16 (deferred-8.1); not run by this gate (08-SPLIT) |

## Evidence checks

| Check | Result | Note |
| --- | --- | --- |
| pnpm audit --prod exit recorded | passed | exit 1 |
| build log has no Google Fonts host | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/build.log: no Google Fonts host |
| OPERATIONS.md volume upgrade procedure | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/ops-volume.log: "volume upgrade procedure documented" |
| OPERATIONS.md client IP section | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/ops-client-ip.log: "client IP constraint documented" |
| sla-flag raw SQL comment | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-gVxEUa/sla-flag-comment.log: "sla-flag raw SQL comment present" |
| listed containers, and the volumes of project `aida`, unchanged | passed | 3 listing(s) before and after, each exit 0 with its header line; 1 row(s), identical |
| no foreign project named in gate logs | passed | 19 log file(s) scanned |

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

- Final gate after the code review fixes F1 to F8 (charter step 8). The tested commit `fc8078f` equals `e20c094` outside `.planning`. The verifier `scripts/part-a-gate-check.ts` is the one at the tested commit, unchanged by this rerun (its last change is `e4466f0`, batch F6, K134).
- No `.next` move and no rerun: every command ran once. `pnpm test:e2e` did not hang on `/setup`.
- The row ``listed containers, and the volumes of project `aida`, unchanged`` (K134) measures only its three listings, each captured by its own command with its own `.exit` file: the containers of compose project `aida`, the `aida-dev-db` container, and the volumes of project `aida`. It does not show that no other resource was touched, and it says nothing about what is inside a volume. Its table note is derived by the verifier and is not hand-edited, so the limit is written here.
- `pnpm test:egress` and both image checks stopped at J1's host check (14.8 GiB free on the host). Both are rule J space stops, recorded `blocked (space)`. Nothing was freed, pruned or removed, and no compose command ran.
- `pnpm audit --prod` and `--audit-level=high` exit 1 with 0 critical and 10 high. The residual table is in 08-04-SUMMARY.md, "Residual table". AIDA-25 stays open.
- The design-system patch `part-a-src.patch` is the plan's command, which selects the `type(08-NN):` commits of plans 08-01 to 08-13 and 08-17 to 08-20. The F1 to F8 fixes (`fix(08-F<n>):`) are not in it. They changed four `.tsx` files under `src/` (`settings/embedding-test-connection-button.tsx`, `request/request-form.tsx`, `status/[token]/follow-up-form.tsx`, `components/theme-provider.tsx`), and a read-only `git diff 4d0eefd fc8078f` over `src/**/*.tsx` and `src/**/*.css` shows no added named text size. That diff is outside the derivation and is noted only.
