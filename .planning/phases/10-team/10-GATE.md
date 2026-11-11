# Phase 10 gate

Tested commit: 2418e4c5d80de6a538a606c65fc742240c9e8740
Date: 2026-11-13, 01:30Z to 01:51Z
Run id: mweatnnb-9c8802fc3d28e482
Evidence dir: a `mktemp -d` directory under `${TMPDIR}` (`aida-gate-10-*`), removed after the SUMMARY quoted it
Tree state: clean, apart from the untracked `.planning/state.json`, which is not part of the gate

Every row of the Results table ran at the tested commit, in the plan's order, one process at a time. Nothing was committed between the first row and the last one. Each command wrote its own log, and each exit code was written to its own `.exit` file and read without a pipe. This file records only what this gate measured; the earlier runs on this branch (integration 127 files and 1781 tests after 10-06, E2E 292 passed after 10-13) are not evidence here.

## Results

States: passed (exit 0 only), failed (non-zero exit), blocked (reason, with evidence), not run. Times are UTC.

| Command | State | Exit code or reason | Log summary | Commit |
| --- | --- | --- | --- | --- |
| pnpm lint | passed | 0 | lint.log, 01:30Z. "Checked 760 files", 0 errors, 1 warning (`tests/unit/container-config.test.ts:160`, `noTemplateCurlyInString`, the old known one) | 2418e4c |
| pnpm typecheck | passed | 0 | typecheck.log, 01:30Z; no output from `tsc --noEmit` | 2418e4c |
| pnpm test | passed | 0 | test.log, 01:30:14Z to 01:30:40Z (25.4 s). Files 110 passed of 110; tests 1967 passed, 0 failed, 0 skipped | 2418e4c |
| pnpm test:integration | failed | 1 | integration.log, 01:30:57Z to 01:38:42Z (464.7 s). Files 130 passed, 1 failed (131); tests 1838 passed, 1 failed (1839). The failure: `tests/integration/backup-failures.test.ts` > "run deadline (K143): a dump waiting on a held ACCESS EXCLUSIVE lock is stopped at BACKUP_MAX_RUN_SECONDS 8 …", `backup-failures.test.ts:460`: expected stdout to contain "[backup] backup aborted: run deadline passed", received "[backup] backup failed: dump" after 7161 ms. `tests/integration/egress-isolation.test.ts` is not among the files run: the log names it 0 times, and the 131 files are exactly `tests/integration/*.test.ts` (132) minus that file (`vitest.integration.config.ts:8`). See the diagnostic rerun below. | 2418e4c |
| pnpm test:egress | blocked (space) | 1; the rule J preflight stopped it before any build | egress.log, 01:40:28Z. "DockerPreflightError: Free space on the Docker VM is 13.2 GiB, below the 20.0 GiB rule J requires before an image build. Stopped; report to the owner." (`tests/support/docker-test-preflight.ts:90`, from `runBuildPreflight` at `:438`, called at `tests/integration/egress-isolation.test.ts:268`). The host check runs first in `runBuildPreflight` (`:436`) and passed; `df -h /System/Volumes/Data` read 23 GiB available just before the run. Counts: tests 1 passed (the stack-free installer egress inventory), 4 skipped; files 1 failed (the beforeAll stop). No image was built or pulled. | 2418e4c |
| pnpm test:e2e (run 1) | failed (global setup stalled on `/setup`) | 1 | e2e.log, 01:40:53Z to 01:41:33Z. `TimeoutError: page.waitForURL: Timeout 30000ms exceeded` at `tests/e2e/global-setup.ts:174`. No test ran. The 543 dev-server lines (prefix `[e2e-server]`) were copied to e2e-server-run1.log before the move: "Next.js 16.4.6 (Turbopack)", "Ready in 214ms", then 298 `GET /setup 200` lines alternating with "Compiled in 1ms", and no `POST /setup`. Owner item next-o1, not fixed here. | 2418e4c |
| `.next` move | done | mv exit 0 | 2026-11-13T01:41:41Z, after run 1: `mv .next ~/.Trash/aida-next-1794534101`. Never removed. Product code and config untouched. | - |
| pnpm test:e2e (run 2, the one rerun) | passed | 0 | e2e2.log, 01:41:51Z to 01:49:50Z (8.0 min). "Running 293 tests using 1 worker"; 292 passed, 0 failed, 0 flaky, 1 skipped. Phase 10 specs: team-invitations 14 passed, team-deactivation 4, notifications-bell 3, mentions-leak 7, csp 14, single-h1 9; none failed. | 2418e4c |
| pnpm build | passed | 0 | build.log, 01:50:03Z to 01:50:20Z. "Turbopack build encountered 5 warnings", each "Dynamic filesystem access causes tracing of the whole project" (the known Phase 02 deferred item). No Google Fonts host in the log (0 matches). | 2418e4c |
| pnpm audit --prod | failed | 1 | audit.log, 01:50:26Z. "48 vulnerabilities found", "Severity: 3 low \| 35 moderate \| 10 high" (AIDA-25, owner item 08-o3). The Phase 9 rerun gate had 42 (2 low, 30 moderate, 10 high). `git diff --stat 38ef41a 2418e4c -- package.json pnpm-lock.yaml` is empty, so no dependency changed in between; the difference comes from the advisory data the command reads (an inference: the old advisory list was not kept). | 2418e4c |

Further runs, recorded beside the charter rows and not replacing any of them:

| Command | State | Exit code | Log summary | Commit |
| --- | --- | --- | --- | --- |
| `pnpm test:integration tests/integration/backup-failures.test.ts` (diagnostic rerun of the one failing file, after the full run) | passed | 0 | backup-diag.log, 01:39:11Z to 01:40:17Z. 1 file, 20 tests passed, including the K143 run-deadline case. The failure in the full run is therefore timing-dependent, not deterministic. Phase 10 changed neither the backup code nor this test (`git diff --stat 5dc6890 2418e4c -- tests/integration/backup-failures.test.ts scripts src/lib/backup` is empty). The full-run row stays failed. | 2418e4c |
| `pnpm typecheck` (after E2E and build) | passed | 0 | typecheck-post.log, 01:50:28Z to 01:50:38Z. No second `.next` move was needed. | 2418e4c |

Docker: `colima status` and `docker info` both exited 0 before the first Docker step (01:30Z) and again before `pnpm test:egress` (01:40Z). Every Docker-using command ran with `AIDA_TEST_RUN_ID=mweatnnb-9c8802fc3d28e482`, `DOCKER_HOST` from the docker context and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. No `docker compose up`, `run`, `down`, `build` or `config` ran on any project, and no image was built or pulled. `pnpm test:docker-cleanup` was not run. After the last Docker-using run, `docker ps -a`, `docker images`, `docker volume ls` and `docker network ls`, each filtered on `label=aida.test.run=mweatnnb-9c8802fc3d28e482`, listed nothing, and no container name held the run id. Host disk stayed at 22 to 23 GiB available throughout (`df -h /System/Volumes/Data`).

## Static checks (re-run at 2418e4c)

| Check | Exit code | Result | Output |
| --- | --- | --- | --- |
| Single notification boundary (C10): `git grep -l -e "\.notification\." -e "\"Notification\"" -- src ':!src/generated'` | 0 | passed | `src/lib/notifications/store.ts`, `src/lib/scoped-db.ts`, exactly the two expected files |
| The one D-15 exception stays single (LOW): `git grep -l "listDigestPairs" -- src` | 0 | passed | `src/lib/notifications/digest.ts`, `src/lib/notifications/store.ts`, exactly the two expected files |
| `pnpm test tests/unit/membership-inventory.test.ts tests/unit/page-access-inventory.test.ts tests/unit/member-writers.test.ts tests/unit/invite-no-log.test.ts tests/unit/better-auth-routes.test.ts` | 0 | passed | unit5.log. The `test` script is `vitest run tests/unit`, so the named files only add to the whole unit tree: 110 files, 1967 tests passed |
| The same five files alone: `pnpm exec vitest run <the five files>` | 0 | passed | unit5-only.log: 5 files, 140 tests passed. A first attempt passed the five paths as one shell word, found no test file and exited 1; that was the command line, not the code, and the corrected run is the one recorded |
| `git diff --quiet 5dc6890 -- src/components/sidebar.tsx` | 0 | passed | the sidebar is unchanged in this phase |

## Design-system checklist (§9)

Mechanical checks only. The UI files are the 38 `.tsx` files under `src/` changed by `(10-NN)` commits (`git log --grep='(10-'` with `git diff-tree` over `src/**/*.tsx` and `src/**/*.css`, list ui-files.txt). No `.css` file and not `src/app/globals.css`. New surfaces: `src/app/(app)/settings/team/` (5 files), `src/app/(app)/settings/notifications/` (2), `src/app/(auth)/invite/[token]/` (2), `src/app/(auth)/no-access/` (2), `src/components/notification-bell.tsx`, `src/components/tickets/mention-autocomplete.tsx`, `src/components/join-welcome-toast.tsx`. Changed: `composer.tsx`, `top-bar.tsx`, `empty-state.tsx`, `settings-nav.tsx`, `(app)/layout.tsx` and the 18 existing `(app)` pages that gained `requirePageAccess` (10-17); all 20 `(app)` page files now call it (`git grep -l requirePageAccess` over them prints 20).

| Item | Result | Evidence |
| --- | --- | --- |
| 1 new tokens live in `globals.css`, not hardcoded | passed | The plan's grep `oklch\(\|#[0-9a-fA-F]{6}\b` over the six new-surface paths: exit 1 (no output). Over all 38 files: `oklch(`, `#hex` (3 to 8 digits), `rgb(`, `rgba(`, `hsl(`: exit 1; Tailwind palette colours (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, gradient stops with red, blue, gray, slate, white, black and the like): exit 1. |
| 2 empty state uses halo and icon box | passed | The bell's empty list renders `EmptyState` (`src/components/notification-bell.tsx:352-357`, `className="min-h-0 px-4 py-8"`, the compact variant of UI-SPEC Surface 3); `src/components/empty-state.tsx:35` halo (`-m-3 rounded-2xl bg-primary/5 blur-[2px]`), `:38` icon box (`rounded-xl border border-primary/15 bg-primary/10`). `EmptyState` gained only the optional `className` (`:15`, `:28-30`). |
| 3 sidebar uses `sidebar-*` tokens | passed (unchanged) | `git diff --quiet 5dc6890 -- src/components/sidebar.tsx` exit 0; `sidebar.tsx:48` `border-r border-sidebar-border bg-sidebar text-sidebar-foreground` |
| 4 top bar is sticky with backdrop blur | passed | `grep -c "sticky top-0 z-10" src/components/top-bar.tsx` prints 1; `top-bar.tsx:42` `sticky top-0 z-10 … border-border/70 … backdrop-blur-sm`; the bell sits at `:68` between Search and `ThemeToggle` (`:69`), amendment A8 |
| 5 auth page does not wrap itself | passed | `src/app/(auth)/no-access/page.tsx` returns one `Card` (`max-w-[400px] border-border/70 shadow-xl shadow-primary/5`) and nothing around it; `src/app/(auth)/invite/[token]/page.tsx:59`, `:92` return only `<InviteCard>`, and `invite-card.tsx:76`, `:386` render a `Card` as the outermost element. Neither adds a background, a `min-h-screen` or a `main`; both rely on `src/app/(auth)/layout.tsx`. |
| 6 typography uses explicit `text-[Npx]` | passed | The plan's grep `text-(xs\|sm\|base\|lg\|xl)\b` over the six new-surface paths: exit 1. Over all 38 files, `text-(xs\|sm\|base\|lg\|xl\|2xl…9xl)`: exit 1. The shadcn `CommandItem` default `text-sm` (`src/components/ui/command.tsx:145`) is overridden by `text-[13px]` on the instance (`mention-autocomplete.tsx:135`). |
| 7 dark mode tested | open (human) | Dark mode of the Team page and its three dialogs, the invitation page in every state, the bell (count pill, unread dot, empty state), the mention span in the thread and the autocomplete, Settings → Notifications and `/no-access` (DS §7, §8 rule 8), including the contrast of the count pill and the mention text. Not tested here; no result is recorded. |
| 8 `tsc --noEmit` clean | passed | `pnpm typecheck` exit 0, before and after E2E and build (Results above) |

Checks from the UI-SPEC hooks and the plan's acceptance, beyond the eight items:

| Check | Result | Evidence |
| --- | --- | --- |
| No inline script | passed | `grep -rEn "<script\|dangerouslySetInnerHTML"` over the six new-surface paths: exit 1; over all 38 files: exit 1. `tests/e2e/csp.spec.ts` loads `/invite/<valid>`, `/invite/<unknown>` and `/no-access` with zero CSP violations (E2E run 2, csp 14 passed). |
| Spacing on the declared scale (4, 8, 16, 24, 32; UI-SPEC "Spacing Scale") | failed (1 finding, not fixed by the gate) | A grep for off-scale padding, margin, gap, space and inset steps (`0.5`, `1.5`, `2.5`, `3`, `3.5`, `5`, `7`, `9` to `12`) over the seven new files and folders finds one: `src/components/tickets/mention-autocomplete.tsx:135` `py-0.5` (2px) on each autocomplete `CommandItem` (commit `6ac3176`, plan 10-12). It overrides the shadcn default `py-1.5`. Neither value is on the scale, and UI-SPEC lists no exception for it. The added lines of `composer.tsx`, `empty-state.tsx`, `top-bar.tsx` and `settings-nav.tsx` since `5dc6890` have no off-scale step (exit 1). For the phase code review; this gate changes no product code. |
| Sizes outside the scale by design | passed | `size-8` avatars and icon buttons, `w-[280px]` autocomplete, `w-[360px]` popover, `h-5 min-w-5` count pill, as UI-SPEC lists them |

`/no-access` has no `<main>` landmark (`deferred-items.md`, from 10-17): the `(auth)` layout has none. That is for the screen-reader item below, not a §9 item.

## UI-SPEC amendments (V-19)

UI-SPEC stays approved and binding; `10-UI-SPEC.md` was not edited. Each amendment below was made by the plan named and is recorded here.

| Amendment | What changed against UI-SPEC | Plan |
| --- | --- | --- |
| A1 | The scope line (UI-SPEC line 17) says Phase 9's `BrandMark`, Backups tab and single-`<h1>` work "do **not** exist". It is stale: all three exist (`src/components/brand-mark.tsx`, `/settings/backups`, `tests/e2e/single-h1.spec.ts`), and Phase 10 builds on them. | the replan (CONTEXT V-19); recorded here |
| A2 | Settings nav: Team and Notifications follow Backups, the last item today (UI-SPEC said "after Email", the last item on 2026-11-08); `settings-nav.tsx:15-18` | 10-10 |
| A3 | The "Unassigned tickets" switch on Settings → Notifications, for owners and admins only, default on, one switch for in-app and digest (owner item 11) | 10-11 |
| A4 | The digest's line "On unassigned tickets" for fallback rows | 10-09 |
| A5 | The `/no-access` body: "You are not a member of this workspace, or your membership was removed. If this is a mistake, ask a workspace admin to invite you again." (also covers the never-a-member case of V-27) | 10-02 |
| A6 | The throttled invitation view ("Something went wrong while joining." / "Wait a moment and try again." with "Go to sign in") and the server-side field refusal callout | 10-08 |
| A7 | Deactivation with reassignment: the skipped-ticket count in the toast, the warning callout for tickets that could not be reassigned, and "Try again" | 10-10 |
| A8 | The bell sits between the Search button and `ThemeToggle` (UI-SPEC said "before ThemeToggle"; Search was added since) | 10-11 |
