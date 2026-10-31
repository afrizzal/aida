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

## Notes

- Rerun after 08-gap1. The tested commit `4d0eefd` holds the 08-gap1 test fix (`c403af7`). Outside `.planning` it differs from `c403af7` in nothing, and from the first run's `61c8696` only in the three integration test files of 08-gap1. No product code changed.
- `.next` moved once: `mv .next ~/.Trash/aida-next-1794408154`. The first `pnpm test:e2e` (exit 1, 0 tests run) hung in global setup on `/setup` (`page.waitForURL(/\/login/)` timeout at `tests/e2e/global-setup.ts:165`, the known stale `.next` after `pnpm build`). Its evidence is kept as `e2e-attempt1.log`, `.json` and `.exit` in the evidence directory. After the move, `pnpm test:e2e` was rerun once, alone, and its result is the recorded row.
- `pnpm test:egress` and both image checks stopped at J1's host check (18.5 GiB free on the host, checked before the VM; the VM had 13.9 GiB at 0a2). Both are rule J space stops, recorded `blocked (space)`. Nothing was freed, pruned or removed.
- `pnpm audit --prod` and `--audit-level=high` exit 1 with 0 critical and 10 high. The residual table is in 08-04-SUMMARY.md, "Residual table". AIDA-25 stays open.
