# Phase 9 gate

Tested commit: 2c7568006fa38d9e9e034c5ae0fdc283d151996a
Date: 2026-11-12
Run id: mwdhvyco-1108bd301a637466
Evidence dir: /var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/aida-gate-09-RHuPxT (removed after the SUMMARY quoted it)
Tree state: clean, apart from the untracked `.planning/state.json`, which is not part of the gate

Lint, typecheck and the unit suite ran at the tested commit. The other rows ran at `961eb27`, the plan's Task 1 commit. `git diff --name-only 2c75680 961eb27` lists only `.planning/phases/09-operations/09-GATE.md` and `09-STACK-PROOFS.md`, so the code under test is the same.

## Results

| Command | Exit code | Result | Note |
| --- | --- | --- | --- |
| pnpm lint | 0 | passed | log lint.log; "Checked 665 files", 0 errors, 1 warning |
| pnpm typecheck | 0 | passed | log typecheck.log |
| pnpm test | 0 | passed | log test.log; files=91 passed=1646 failed=0 skipped=0 |
| pnpm test:integration | 0 | passed | log integration.log; files=112 passed=1500 failed=0 skipped=0 |
| pnpm test:egress | 1 | blocked (space) | log egress.log. The J1 preflight stopped before any build: "Free space on the Docker VM is 13.2 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." The host had 34 GiB free (`df -h /System/Volumes/Data`). `colima ssh -- df -h /var/lib/docker` read 14G free of 40G before the run. Counts: 1 test passed (the stack-free installer egress inventory), 4 skipped, 1 file failed (the beforeAll stop). |
| pnpm test:e2e (run 1) | 1 | failed (global setup hung on `/setup`) | log e2e.log. `TimeoutError: page.waitForURL: Timeout 30000ms exceeded` at `tests/e2e/global-setup.ts:174`, after repeated `navigated to "http://localhost:3100/setup"`. No test ran. This is owner item next-o1, not fixed here. The dev-server lines (945, prefix `[e2e-server]`) were copied to e2e-server-run1.log. They start with "Next.js 16.4.6 (Turbopack)", "Ready in 239ms", `GET /api/health 200`, and end with alternating `GET /setup 200` and "Compiled in 1ms". |
| `.next` move | - | done | 2026-11-12T12:07:52Z, after `pnpm test:e2e` run 1: `mv .next ~/.Trash/aida-next-1794485272` (exit 0). Never removed. |
| pnpm test:e2e (run 2, the one rerun) | 0 | passed | log e2e2.log; passed=260 failed=0 flaky=0 skipped=1 (6.5 min) |
| pnpm build | 0 | passed | log build.log. "Turbopack build encountered 5 warnings", each "Dynamic filesystem access causes tracing of the whole project" (the known Phase 02 deferred item). No Google Fonts host in the log. |
| pnpm typecheck (after E2E and build) | 0 | passed | log typecheck-post.log; no `.next` move needed after the build |
| pnpm audit --prod | 1 | failed | log audit.log; "42 vulnerabilities found", "Severity: 2 low \| 30 moderate \| 10 high", the same counts as the Phase 8 Part A gate (AIDA-25, owner item 08-o3) |
| pnpm test:docker-cleanup --run mwdhvyco-1108bd301a637466 | 0 | passed (dry run) | "0 resource(s) of run mwdhvyco-1108bd301a637466; dry run, nothing removed." `--apply` was not run. |
| SP-1 scheduled backup service in a compose stack | - | not run (waiting for the Phase 8.1 harness and the owner) | 09-STACK-PROOFS.md; U-15 |
| SP-2 restore into an isolated stack with a content comparison | - | not run (waiting for the Phase 8.1 harness and the owner) | 09-STACK-PROOFS.md; U-15 |
| SP-3 boot with a reserved-character password | - | not run (waiting for the Phase 8.1 harness and the owner) | 09-STACK-PROOFS.md; U-15 |

No `docker compose up`, `run`, `down` or `build` ran on any project, and no image was built or pulled. After the last Docker-using run, `docker ps -a`, `docker images` and `docker volume ls`, each filtered on `label=aida.test.run=mwdhvyco-1108bd301a637466`, listed nothing.

## Requirement matrix

Evidence kind: host (a test or check on this machine, Testcontainers included), container (needs a compose stack), human. A row marked ↳ is a Phase 9 decision clause (CONTEXT) below the REQUIREMENTS.md acceptance text. Like 08-GATE-A, it holds the requirement open too.

| # | Requirement | Clause | Kind | Plan and test | Command row | State |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AIDA-33 | backups run on a schedule inside the single compose stack: the service and scheduler are defined in compose | host | 09-08: tests/unit/backup-scheduler.test.ts, tests/unit/compose-backup.test.ts, tests/integration/compose-backup-config.test.ts | pnpm test; pnpm test:integration | passed |
| 2 | AIDA-33 | backups run on a schedule inside the single compose stack: observed in a running stack | container | 09-11 SP-1 | SP-1 | not run (waiting for the Phase 8.1 harness and the owner) |
| 3 | AIDA-33 | with retention | host | 09-13: tests/integration/backup-failures.test.ts "retention (D-03)" | pnpm test:integration | passed |
| 4 | AIDA-33 | can be turned off (`BACKUP_ENABLED=false`) | host | 09-08: tests/unit/backup-scheduler.test.ts, tests/integration/compose-backup-config.test.ts | pnpm test; pnpm test:integration | passed |
| 5 | AIDA-33 | each run produces one set holding the database dump and the uploads archive | host | 09-06: tests/integration/backup-consistency.test.ts | pnpm test:integration | passed |
| 6 | AIDA-33 | if either part fails, the whole set is marked failed and reported | host | 09-13: tests/integration/backup-failures.test.ts; 09-08: tests/unit/backup-status.test.ts, tests/e2e/backups-status.spec.ts | pnpm test:integration; pnpm test; pnpm test:e2e (run 2) | passed |
| 7 | AIDA-33 | retention prunes whole sets | host | 09-13: tests/integration/backup-failures.test.ts "retention (D-03)" | pnpm test:integration | passed |
| 8 | AIDA-33 | every attachment record in a set's dump has its file in the archive, even when attachments are added, replaced or deleted during the run, proven by a test that changes attachments mid-backup | host | 09-04: tests/integration/file-fence.test.ts; 09-06 and 09-13: tests/integration/backup-consistency.test.ts | pnpm test:integration | passed |
| 9 | ↳ | U-14: the dump-to-archive check covers `TaskAttachment` and the logo | host | 09-06 and 09-13: tests/integration/backup-consistency.test.ts | pnpm test:integration | passed |
| 10 | AIDA-33 | a test restores a set and compares attachment records with their file contents: component round trip | host | 09-10: tests/integration/backup-restore-roundtrip.test.ts | pnpm test:integration | passed |
| 11 | AIDA-33 | a test restores a set into an isolated stack and compares attachment records with their file contents (`Attachment`, `TaskAttachment`, logo; U-16 ownership) | container | 09-11 SP-2 | SP-2 | not run (waiting for the Phase 8.1 harness and the owner) |
| 12 | AIDA-33 | no Redis and no managed service: in the compose file | host | 09-08: `grep -c -i redis docker-compose.yml` prints 0; tests/integration/compose-backup-config.test.ts | pnpm test:integration | passed |
| 13 | AIDA-33 | no Redis and no managed service: observed in a running stack | container | 09-11 SP-1 | SP-1 | not run (waiting for the Phase 8.1 harness and the owner) |
| 14 | AIDA-33 | `docs/OPERATIONS.md` covers it | host | 09-08 and 09-10: `## Backups` (line 5) and `## Restore` (line 133) | grep at the tested commit | passed |
| 15 | AIDA-34 | an admin can upload a workspace logo, shown in the sidebar and on public pages, with the name-only fallback intact | host | 09-07: tests/e2e/logo.spec.ts "upload", "request page", "valid status", "fallback" | pnpm test:e2e (run 2) | passed |
| 16 | AIDA-34 | bytes are sniffed | host | 09-05: tests/unit/logo-validate.test.ts | pnpm test | passed |
| 17 | AIDA-34 | SVG is rejected | host | 09-05: tests/unit/logo-validate.test.ts; 09-07: tests/e2e/logo.spec.ts "svg" | pnpm test; pnpm test:e2e (run 2) | passed |
| 18 | AIDA-34 | the public serving route is listed in `src/proxy.ts` (through the existing `/api/public` entry of `PUBLIC_PREFIXES`, U-02) | host | 09-05: tests/unit/proxy.test.ts | pnpm test | passed |
| 19 | AIDA-34 | the public serving route is throttled | host | 09-05: tests/integration/logo-routes.test.ts | pnpm test:integration | passed |
| 20 | AIDA-34 | an E2E test covers upload, replace and fallback | host | 09-07: tests/e2e/logo.spec.ts "upload", "replace", "remove", "fallback" | pnpm test:e2e (run 2) | passed |
| 21 | ↳ | D-11: the logo's look in the sidebar, Branding preview and public pages, light and dark | human | 09-07 manual items | - | open (human) |
| 22 | AIDA-35 | with a synthetic password containing `/ @ : # ?`, a test checks the `DATABASE_URL` that `docker compose config` resolves for every service that uses one, without printing it | host | 09-01: tests/integration/compose-database-url.test.ts | pnpm test:integration | passed |
| 23 | AIDA-35 | a stack booted with the same password connects from `migrate`, `app` and `worker` | container | 09-11 SP-3 | SP-3 | not run (waiting for the Phase 8.1 harness and the owner) |
| 24 | AIDA-35 | no log or recorded evidence contains the password: host tests | host | 09-01: tests/integration/compose-database-url.test.ts prints service names and pass or fail only | pnpm test:integration | passed |
| 25 | AIDA-35 | no log or recorded evidence contains the password: stack logs | container | 09-11 SP-3 | SP-3 | not run (waiting for the Phase 8.1 harness and the owner) |
| 26 | AIDA-36 | an E2E test asserts the `<h1>` count on every app route | host | 09-09: tests/e2e/single-h1.spec.ts | pnpm test:e2e (run 2) | passed |
| 27 | ↳ | D-14: every rendered route state (error, loading, unseeded data variants, long text, streaming) | host | 09-09 "Open parts of AIDA-36" | - | not run (states not rendered by any test) |
| 28 | ↳ | screen-reader check of the h1 changes | human | 09-09 manual items | - | open (human) |
| 29 | AIDA-37 | infrastructure data never counts (`_prisma_migrations`, `pgboss`, `SystemSetting`, `RateLimitHit`) | host | 09-02: tests/integration/seed-guard.test.ts, tests/integration/demo-boot.test.ts | pnpm test:integration | passed |
| 30 | AIDA-37 | before any write, `pnpm db:seed` refuses when tenant data exists | host | 09-02: tests/integration/seed-guard.test.ts | pnpm test:integration | passed |
| 31 | AIDA-37 | the `DEMO_MODE` boot seeds, skips or refuses as specified | host | 09-02: tests/integration/demo-boot.test.ts | pnpm test:integration | passed |
| 32 | AIDA-37 | tests cover a fresh and a repeated demo boot after the heartbeat has run | host | 09-02: tests/integration/demo-boot.test.ts | pnpm test:integration | passed |
| 33 | AIDA-37 | refusal by both paths on a database holding a non-demo organization or user with zero tickets, comparing the row count of every table | host | 09-02: tests/integration/seed-guard.test.ts, tests/integration/demo-boot.test.ts | pnpm test:integration | passed |
| 34 | AIDA-37 | `prisma/seed.ts` and `scripts/capture-demo-assets.ts` no longer print the password | host | 09-02: tests/integration/seed-guard.test.ts (stdout scan); `scripts/capture-demo-assets.ts:810-811` redacts | pnpm test:integration | passed |
| 35 | AIDA-38 | demo-boot idempotency, the seed guard and the backup/restore round trip run from the repository test suites | host | tests/integration/demo-boot.test.ts, seed-guard.test.ts, backup-restore-roundtrip.test.ts, all in `vitest.integration.config.ts` | pnpm test:integration | passed |
| 36 | AIDA-39 | `01-VERIFICATION.md` sits in `milestones/v1.0.0-phases/01-foundation/`, cites commands at a named commit, and leaves human-only checks open | host | 09-03: the file exists (`ls`), re-runs at `0764100`, criterion 1 open for a human, criterion 2 failed | `ls` at the tested commit; 09-03-SUMMARY | passed |
| 37 | AIDA-40 | `scripts/install.sh` is tested against a local stand-in for a release and makes no call beyond the documented download | host | 09-12: tests/unit/install-script.test.ts; tests/integration/egress-isolation.test.ts "installer egress inventory" | pnpm test; pnpm test:egress (the inventory test passed; the file was stopped by the preflight) | passed |
| 38 | AIDA-40 | the `check-version` workflow exists | host | 09-03: `.github/workflows/check-version.yml`; tests/unit/check-version.test.ts | pnpm test | passed |
| 39 | AIDA-40 | `AGENTS.md` exists | host | 09-03: `AGENTS.md` | `ls` at the tested commit | passed |
| 40 | AIDA-40 | `CODEOWNERS` exists | host | 09-03: `.github/CODEOWNERS` | `ls` at the tested commit | passed |
| 41 | AIDA-40 | README widgets exist | - | none (U-05) | - | not added (owner decision, item 13) |
| 42 | ↳ | D-22: the installer on a clean VM | human | 09-12 manual items | - | open (human) |
| 43 | AIDA-41 | every open todo and caveat in `STATE.md` is re-checked against the repository and corrected or removed: executor-owned sections | host | 09-03 audit; 09-11 Task 3 | 09-11-SUMMARY "STATE.md re-check" | passed |
| 44 | AIDA-41 | the same, for the front matter, Current Position and Session Continuity (orchestrator-owned) | host | 09-11-SUMMARY, list for the orchestrator | - | open (orchestrator) |

## Requirement status

A requirement is closed only when every row is `passed`, or `not added (owner decision)` for the AIDA-40 widget clause.

| Requirement | REQUIREMENTS.md clauses all passed | ↳ rows all passed | Closed | Holding it open |
| --- | --- | --- | --- | --- |
| AIDA-33 | no | yes | no | rows 2, 11, 13 (SP-1, SP-2) |
| AIDA-34 | yes | no | no | row 21 (logo look, human) |
| AIDA-35 | no | - | no | rows 23, 25 (SP-3) |
| AIDA-36 | yes | no | no | rows 27, 28 |
| AIDA-37 | yes | - | yes | - |
| AIDA-38 | yes | - | yes | - |
| AIDA-39 | yes | - | yes | - |
| AIDA-40 | yes (widgets: not added, owner decision) | no | no | row 42 (clean-VM run, human) |
| AIDA-41 | no | - | no | row 44 (orchestrator-owned STATE.md sections) |

## Design-system checklist (§9)

Mechanical checks only. The UI files are the 26 `.tsx` and `.css` files under `src/` changed by `(09-NN)` commits (`git log --grep='(09-'` with `git diff-tree` over `src/**/*.tsx` and `src/**/*.css`, list ui-files.txt). `src/app/globals.css` is not among them.

| Item | Result | Evidence |
| --- | --- | --- |
| 1 new tokens live in `globals.css`, not hardcoded | passed | grep for `#hex`, `oklch(`, `rgb(`, `rgba(`, `hsl(` and Tailwind palette colours (`bg-`, `text-`, `border-` with red, blue, gray and the like) over the 26 files: no match (exit 1 each) |
| 2 empty state uses halo and icon box | passed | `src/app/(app)/settings/backups/page.tsx:70` renders `EmptyState`; `src/components/empty-state.tsx:21` halo (`bg-primary/5 blur-[2px]`), `:24` icon box (`rounded-xl border border-primary/15 bg-primary/10`) |
| 3 sidebar uses `sidebar-*` tokens | passed | `src/components/brand-mark.tsx:59-60` `bg-sidebar-primary text-sidebar-primary-foreground`, `:67` `text-sidebar-foreground`; `src/components/sidebar.tsx:48` `border-sidebar-border bg-sidebar` |
| 4 top bar is sticky with backdrop blur | passed | `src/components/top-bar.tsx:54` `sticky top-0 z-10 ... border-border/70 ... backdrop-blur-sm` |
| 5 auth page does not wrap itself | passed | no `(09-NN)` commit touches `src/app/(auth)` (`git log --grep='(09-' -- 'src/app/(auth)'` lists 0 commits) |
| 6 typography uses explicit `text-[Npx]` | passed | grep for `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl` and `text-2xl` to `text-9xl` over the 26 files: no match (exit 1) |
| 7 dark mode tested | open (human) | Branding, Backups and the sidebar in dark mode, including logo legibility on the dark sidebar (DESIGN-SYSTEM §7). 09-08's axe contrast scan in both themes is automated evidence only. |
| 8 `tsc --noEmit` clean | passed | pnpm typecheck (both rows) |

The logo look, light and dark, is `open (human)` (row 21).

## Manual and owner items

- Human: run the installer on a clean VM (D-22, 09-12). It needs a real host, a real network and the published v1.0.0 tag.
- Human: approve the logo's look in the sidebar, the Branding preview, `/request` and `/status/[token]`, in light and dark mode (D-11, 09-07).
- Human: review Branding, Backups and the sidebar in dark mode, including logo legibility on the dark sidebar (§9 item 7).
- Human: screen-reader checks of the h1 changes (09-09) and of the Logo card: error rows, the Remove dialog and the `alt=""` brand logo (09-07).
- Owner and Phase 8.1: the stack proofs SP-1, SP-2 and SP-3 (09-STACK-PROOFS.md), waiting for the Phase 8.1 harness and the owner. The stack clauses of AIDA-33 and AIDA-35 stay open until then.
- Owner: the version bump policy (U-05; `LAUNCH.md` "Repo-health owner items").
- Owner: the `v1.0.0` tag and release (human-only; no tag exists).
- Owner: limit L1 of the fence (09-04-SUMMARY "Stated limits").
- Open parts of AIDA-36 (09-09-SUMMARY), not rendered by any test:
  - error states of the routes without an `error.tsx`;
  - loading states other than the `/tickets` fallback;
  - unseeded data variants;
  - the 255-character long-text backstop;
  - the streaming backstop.
- Owner: Docker VM space (queue item 0a2). `pnpm test:egress` stays `blocked (space)` until the VM has 20 GiB free. It had 13.2 GiB by the preflight's measure.
- Owner: `pnpm audit --prod` exits 1 with 10 high (AIDA-25, owner item 08-o3). The count is unchanged by Phase 9.
- Owner item next-o1: the E2E global setup hung on `/setup` in run 1. The `.next` move and one rerun passed. The cause is not fixed.
- Orchestrator: the stale orchestrator-owned STATE.md statements listed in 09-11-SUMMARY.

## Notes

- Every Docker-using command ran with `AIDA_TEST_RUN_ID=mwdhvyco-1108bd301a637466`, `DOCKER_HOST` from the docker context and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. `colima status` and `docker info` both exited 0 before the first Docker step.
- One test process at a time. Every exit code was written to its own `.exit` file and read without a pipe.
- No visual, dark-mode, screen-reader or UAT result is recorded here.
