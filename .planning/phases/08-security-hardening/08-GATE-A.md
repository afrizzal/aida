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

## Notes

- Final gate after the code review fixes F1 to F8 (charter step 8). The tested commit `fc8078f` equals `e20c094` outside `.planning`. The verifier `scripts/part-a-gate-check.ts` is the one at the tested commit, unchanged by this rerun (its last change is `e4466f0`, batch F6, K134).
- No `.next` move and no rerun: every command ran once. `pnpm test:e2e` did not hang on `/setup`.
- The row ``listed containers, and the volumes of project `aida`, unchanged`` (K134) measures only its three listings, each captured by its own command with its own `.exit` file: the containers of compose project `aida`, the `aida-dev-db` container, and the volumes of project `aida`. It does not show that no other resource was touched, and it says nothing about what is inside a volume. Its table note is derived by the verifier and is not hand-edited, so the limit is written here.
- `pnpm test:egress` and both image checks stopped at J1's host check (14.8 GiB free on the host). Both are rule J space stops, recorded `blocked (space)`. Nothing was freed, pruned or removed, and no compose command ran.
- `pnpm audit --prod` and `--audit-level=high` exit 1 with 0 critical and 10 high. The residual table is in 08-04-SUMMARY.md, "Residual table". AIDA-25 stays open.
- The design-system patch `part-a-src.patch` is the plan's command, which selects the `type(08-NN):` commits of plans 08-01 to 08-13 and 08-17 to 08-20. The F1 to F8 fixes (`fix(08-F<n>):`) are not in it. They changed four `.tsx` files under `src/` (`settings/embedding-test-connection-button.tsx`, `request/request-form.tsx`, `status/[token]/follow-up-form.tsx`, `components/theme-provider.tsx`), and a read-only `git diff 4d0eefd fc8078f` over `src/**/*.tsx` and `src/**/*.css` shows no added named text size. That diff is outside the derivation and is noted only.
