---
phase: 08-security-hardening
plan: 05
subsystem: build, ci
tags: [fonts, egress, telemetry, dependabot, audit, github-actions, rule-i]
status: complete
requires: []
provides:
  - tests/unit/build-egress-guards.test.ts (9 permanent guards)
  - .github/workflows/audit.yml (job `audit`)
  - .github/dependabot.yml
  - "--font-system CSS custom property"
affects: [08-07, 08-09, 08-05b]
tech-stack:
  added: []
  patterns: [comment-stripped YAML text assertions without a YAML package]
key-files:
  created:
    - tests/unit/build-egress-guards.test.ts
    - .github/workflows/audit.yml
    - .github/dependabot.yml
  modified:
    - src/app/layout.tsx
    - src/app/globals.css
    - .github/workflows/ci.yml
    - .github/workflows/integration.yml
decisions:
  - "System font stack via one :root custom property --font-system; --font-sans, --font-heading and body all point at it (D-26)"
  - "audit.yml triggers are pull_request, push to master and workflow_dispatch only, per owner decision 2026-11-11 under rule I (supersedes the weekly schedule in D-07)"
metrics:
  duration: ~25m
  completed: 2026-11-11
actuals:
  tokens: 6500
  tasks: 2
  commits: 2
plan_head_before: 2657c71c870cb1fe738d2b1f0b1889d44a9e7470
---

# Phase 8 Plan 05: System font stack, CI telemetry opt-out, audit workflow and Dependabot Summary

The Google-hosted Inter font is gone. The app now uses one system font stack (`--font-system`), so `next build` fetches nothing from Google. CI turns off Next.js telemetry and the Prisma checkpoint ping. `pnpm audit` and Dependabot exist as files only, on the owner's rule I triggers and limit. A permanent 9-test guard pins all of this, including `runs-on: ubuntu-latest` everywhere and no new schedule.

Task 3 (egress workflow) was not executed; it lives in `deferred-8.1/08-05b-PLAN.md` (Revision 5).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | ee1aa81 | fix(08-05): replace Google-hosted Inter with a system font stack (D-26) |
| 2 | c595569 | ci(08-05): add dependency audit workflow, Dependabot, and CI telemetry opt-out (D-06, D-07, D-27, rule I) |

## Results

### Task 1 (tracer)
- RED: `pnpm exec vitest run tests/unit/build-egress-guards.test.ts` gave exit 1 with 4 of 4 failing before the change.
- `pnpm exec vitest run tests/unit/build-egress-guards.test.ts tests/unit/design-tokens.test.ts` gave exit 0, 2 files, 33 tests passed.
- `pnpm typecheck` gave exit 0.
- `pnpm build` gave exit 0. The build log had **0** lines matching `fonts.googleapis.com|fonts.gstatic.com|Failed to fetch font`.
- Docker health rule: `colima status` exit 0 (running) and `docker info` exit 0 (Server 29.5.2), so Docker was healthy.
- `pnpm test:e2e tests/e2e/a11y-contrast.spec.ts` (with `AIDA_TEST_RUN_ID=mwbzwsd7-37e06af11a1983c5` and DOCKER_HOST taken from the docker context) gave exit 0: 18 passed, 0 contrast violations.
- Greps:
  - `grep -rn "next/font/google" src` prints nothing.
  - `grep -rn -- "--font-inter" src` prints nothing.
  - `grep -c -- "--font-system" src/app/globals.css` gives 4.
- Tracer gate (auto): the verify steps were re-run end to end and passed before Task 2 started.

### Task 2
- RED: the guard file gave exit 1, with Tests 5, 6 and 7 failing and Tests 8 and 9 passing, as the plan expected.
- `ruby -ryaml ... YAML.load_file` on all 4 files printed `yaml ok` (exit 0).
- The ruby rule I check printed `rule I ok: 4 workflows` (exit 0).
- `pnpm exec vitest run tests/unit/build-egress-guards.test.ts` gave exit 0, 9 passed, with no `.github/workflows/egress.yml` present (`test ! -e` exit 0).
- Re-run of the guard and design-tokens tests: exit 0, 38 tests passed.
- `pnpm lint` gave exit 0 (562 files) after the fix below.
- `pnpm typecheck` gave exit 0.
- `grep -c 'NEXT_TELEMETRY_DISABLED: "1"'` gives 1 in each of audit.yml, ci.yml and integration.yml.
- `grep -c 'open-pull-requests-limit: 3' .github/dependabot.yml` gives 4.
- `git show --numstat --format= HEAD -- .github/workflows/integration.yml` gives `6 0`: integration.yml has zero deleted lines and gained only the env block.
- No workflow was triggered and nothing was pushed. `pnpm test:egress` was not run, and no image was built.

## Deviations from Plan

**1. [Rule 1 - Lint] Biome findings in the new guard test**
- **Found during:** Task 2 (`pnpm lint` exit 1).
- **Issue:** Biome reported 1 error and 4 warnings in the new guard test:
  - `noTemplateCurlyInString` on the literal `audit-${{ github.ref }}`, plus a formatter diff (the error);
  - `noNonNullAssertion` warnings, from Task 1's code.
- **Fix:**
  - The GitHub expression is now built from string parts.
  - `html![0]` and `body![0]` became `?.[0] ?? ""`.
  - Ran `biome format --write`.
- **Commit:** c595569. The Task 1 commit ee1aa81 contains the warning-level form; the lint fix is in c595569.

Otherwise the plan was executed as written.

## Known Stubs

None.

## Manual items (left open for a human)

- Re-capture the screenshots and hero GIF in `docs/assets` (made with Inter, now stale) and approve the look (D-26). Not done. **Visual approval: not run, never claimed.**
- Make the `audit` job a required status check in repository settings (D-07; owner only).
- Owner confirmation on the Dependabot limit. `open-pull-requests-limit: 3` applies per update entry, so the four entries allow up to 12 open version-update PRs in total. Security-update PRs have GitHub's own separate limit of 10. If "3" was meant as a total, the config needs fewer entries or a lower per-entry limit.
- The first real CI run of `audit` (and of the D-27 env blocks) happens only after the owner pushes. Until then its status is **not run** (file only). The egress CI job and its owner items are plan 08-05b (Phase 8.1).

## Self-Check: PASSED

- All 3 created files exist.
- Commits ee1aa81 and c595569 are present in `git log`.
- `git rev-list --count 2657c71..HEAD` = 2.
