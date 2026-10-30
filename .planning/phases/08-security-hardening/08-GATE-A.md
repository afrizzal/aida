# Phase 8 Part A gate

Tested commit: 61c86966ec79466b05f2ac361e6009883879ca90
Date: 2026-11-11
Run id: mwc6vmbv-8de59ebf3cc1c67e
Evidence dir: /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH
Tree state: clean

Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): 61c86966ec79466b05f2ac361e6009883879ca90

## Results

| Command | Exit code | Result | Note |
| --- | --- | --- | --- |
| pnpm lint | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/lint.log |
| pnpm typecheck | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/typecheck.log |
| pnpm test | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/test.log; files=71 passed=1156 failed=0 skipped=0 |
| pnpm build | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/build.log |
| pnpm audit --prod | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/audit.log; exit 1; "Severity: 2 low \| 30 moderate \| 10 high" |
| pnpm audit --prod --audit-level=high | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/audit-high.log; exit 1; "Severity: 2 low \| 30 moderate \| 10 high" |
| pnpm test:integration | 1 | failed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/integration.log; files=101 passed=1314 failed=13 skipped=0 |
| pnpm test:e2e | 0 | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/e2e.log; expected=219 unexpected=0 skipped=1 flaky=0 |
| pnpm test:egress | 1 | blocked (space) | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/egress.log; file=tests/integration/egress-isolation.test.ts passed=0 failed=0 other=4 word=blocked (space); "Free space on the host is 19.4 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check runner | 3 | blocked (space) | "IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=runner tag=aida-test-nonroot-runner:mwc6vmbv-8de59ebf3cc1c67e"; "Free space on the host is 19.4 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| image check builder | 3 | blocked (space) | "IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=builder tag=aida-test-nonroot-builder:mwc6vmbv-8de59ebf3cc1c67e"; "Free space on the host is 19.4 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." |
| pnpm test:docker-cleanup --run | 0 | passed | "0 resource(s) of run mwc6vmbv-8de59ebf3cc1c67e; dry run, nothing removed." |
| compose stack gate | - | moved to Phase 8.1 | Part B: plan 08-16 (deferred-8.1); not run by this gate (08-SPLIT) |

## Evidence checks

| Check | Result | Note |
| --- | --- | --- |
| pnpm audit --prod exit recorded | passed | exit 1 |
| build log has no Google Fonts host | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/build.log: no Google Fonts host |
| OPERATIONS.md volume upgrade procedure | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/ops-volume.log: "volume upgrade procedure documented" |
| OPERATIONS.md client IP section | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/ops-client-ip.log: "client IP constraint documented" |
| sla-flag raw SQL comment | passed | log /private/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-a-JGKnKH/sla-flag-comment.log: "sla-flag raw SQL comment present" |
| foreign resources unchanged | passed | 1 listed line(s), identical |
| no foreign project named in gate logs | passed | 19 log file(s) scanned |

## Notes

- No `.next` move and no rerun. E2E global setup passed `/setup` on the first run.
- `pnpm test:integration` exit 1: 13 of 1327 tests failed in 3 files, all from the Part A rate limits (structured result in the evidence directory). `tests/integration/public-state-label.test.ts` (7) and `tests/integration/merge-reply-race.test.ts` (4) get `429 rate_limited` where they expect 409, 200 or a sentinel. `tests/integration/status-read-snapshot.test.ts` (2) throws `RATE_LIMIT_PEPPER is required to hash rate-limit identifiers`. No code changes after the tested commit, so the row stays `failed`. The fix belongs in a later plan.
- `pnpm test:egress` and both image checks stopped at J1's host check (19.4 GiB free on the host, checked before the VM; the VM had 13.9 GiB at 0a2). Both are rule J space stops, recorded `blocked (space)`. Nothing was freed, pruned or removed.
- `pnpm audit --prod` and `--audit-level=high` exit 1 with 0 critical and 10 high. The residual table is in 08-04-SUMMARY.md, "Residual table". AIDA-25 stays open.
