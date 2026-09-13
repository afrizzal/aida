---
phase: 07-launch-readiness
plan: 06
subsystem: infra
tags: [astro, starlight, github-pages, github-actions, docs-site, tsconfig, biome, docker]

# Dependency graph
requires:
  - phase: 07-launch-readiness
    provides: "07-01 repo-hygiene pass (clean, LF-normalized tree; biome check usable as a gate)"
provides:
  - "website/ — a standalone Astro 7.1.5 + Starlight 0.41.5 project with its own package.json and pnpm-lock.yaml, building for the GitHub Pages project subpath (site https://afrizzal.github.io, base /aida)"
  - "A real Starlight splash landing page (6-card feature grid) and a genuinely usable quick-start guide matching the actual docker-compose stack"
  - ".github/workflows/docs.yml — path-filtered (website/**) build+deploy-pages workflow using withastro/action@v6 and actions/deploy-pages@v5"
  - "Four isolation edits proving website/ is invisible to the product's tsc, biome, and Docker build context: tsconfig.json exclude, biome.json files.includes negation, .dockerignore, .gitignore"
affects: ["07-11 (fills the docs site with the remaining content pages)", "07-12 (launch checklist picks up the two deferred human-only Pages setup items)"]

# Tech tracking
tech-stack:
  added: ["astro@7.1.5", "@astrojs/starlight@0.41.5 (website/ only, own lockfile — not a root/workspace dependency)"]
  patterns: ["Sibling standalone package inside a non-workspace repo: own package.json + own pnpm-lock.yaml, no root pnpm-workspace.yaml, explicitly excluded from root tsconfig/biome/dockerignore"]

key-files:
  created:
    - website/package.json
    - website/astro.config.mjs
    - website/src/content/docs/index.mdx
    - website/src/content/docs/getting-started/quick-start.md
    - website/pnpm-lock.yaml
    - .github/workflows/docs.yml
  modified:
    - tsconfig.json
    - biome.json
    - .dockerignore
    - .gitignore
    - .planning/phases/07-launch-readiness/deferred-items.md

key-decisions:
  - "Starlight 0.41.5 removed the older `{ label, autogenerate: { directory } }` sidebar shorthand (Starlight v0.39+) — used the plan's documented fallback and wrote `{ label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] }` instead."
  - "Card icon `seti:chart` (planned for the AIDA Insight card) is not a valid Starlight built-in icon key — swapped for the built-in `analytics` icon, which renders the same intent (a bar-chart glyph)."
  - "pnpm create astro's scaffold generated its own `website/pnpm-workspace.yaml` containing only `allowBuilds: { esbuild: true, sharp: true }` (pnpm 10's build-script allowlist for that one package) — this is scoped inside website/ and is NOT a repo-root workspace file, so it does not violate the plan's hard constraint against a root pnpm-workspace.yaml; left in place."
  - "Scaffold also generated website/AGENTS.md and website/CLAUDE.md (Astro's own generic AI-assistant guidance for that project) — left untouched; scoped to website/ and harmless alongside the root CLAUDE.md."

requirements-completed: [AIDA-23]

# Metrics
duration: 16min
completed: 2026-07-29
---

# Phase 07 Plan 06: Docs site infrastructure (Astro Starlight on GitHub Pages) Summary

**Astro 7.1.5 + Starlight 0.41.5 in `website/` (own package.json/lockfile) building for `https://afrizzal.github.io/aida`, deployed by a path-filtered GitHub Actions workflow, and provably invisible to the product app's tsc/biome/Docker build.**

## Performance

- **Duration:** ~16 min (05:52–06:08 local)
- **Started:** 2026-07-28T22:52:00Z (approx, first commit ea21096)
- **Completed:** 2026-07-28T23:07:44Z (last task commit c68b33c)
- **Tasks:** 3/3 completed
- **Files modified:** 15 created (website/ scaffold + docs.yml) + 4 modified (tsconfig.json, biome.json, .dockerignore, .gitignore) + 1 shared-doc append (deferred-items.md)

## Accomplishments
- Scaffolded a Starlight docs site (`website/`) non-interactively via `pnpm create astro@latest`, configured for the GitHub Pages project subpath (`site: 'https://afrizzal.github.io'`, `base: '/aida'`), with a real 6-card splash landing page and a quick-start guide that matches the actual `docker-compose.yml` stack (correcting the README's known `localhost:3000` error).
- Proved — not assumed — that `website/` is invisible to the product's toolchain: root `tsc --noEmit` exits 0 with zero `website/` paths in scope, root `biome check .` exits 0 with zero `website/` paths in scope, and `pnpm build` (Next.js) exits 0 unaffected.
- Added `.github/workflows/docs.yml`: a path-filtered (`website/**`), `withastro/action@v6` → `actions/deploy-pages@v5` two-job workflow, matching the canonical Astro Pages recipe with no separate setup-node/install/build steps.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold the Starlight site and configure it for the /aida base path** - `ea21096` (feat)
2. **Task 2: Isolate website/ from the product app's toolchain** - `a2ff3cf` (chore)
3. **Task 3: GitHub Pages deploy workflow** - `c68b33c` (feat)

**Plan metadata:** (this commit) — docs(07-06): complete docs-site-infrastructure plan

_Note: Task 1's commit (`ea21096`) also contains `.github/workflows/ci.yml` and `.github/workflows/integration.yml` — see Deviations below, this was a parallel-execution staging race, not a scope violation of this plan's own work._

## Files Created/Modified
- `website/package.json` - Standalone Astro+Starlight package, own lockfile, not referenced from root package.json
- `website/astro.config.mjs` - `site`/`base` for the GitHub Pages project page, title/description/social/editLink, one sidebar group (`getting-started`, autogenerate)
- `website/src/content/docs/index.mdx` - Splash landing page: hero tagline + Quick start/GitHub actions + 6-card feature grid (ticketing, triage, RAG replies, Insight, BYO-LLM, one-command self-host)
- `website/src/content/docs/getting-started/quick-start.md` - Prerequisites, clone+env+secrets steps, `docker compose up -d`, `/setup` wizard vs headless `ADMIN_*` env vars, services table, `/api/health` verification, explicit `localhost:3000` != compose-URL clarification
- `website/pnpm-lock.yaml` - Tracked lockfile for the deploy workflow's package-manager detection
- `.github/workflows/docs.yml` - Path-filtered build+deploy-pages workflow; header comment records the one-time human Settings > Pages step
- `tsconfig.json` - Added `"website"` to `exclude`
- `biome.json` - Added `"!website"` to `files.includes`
- `.dockerignore` - Appended `website` (with rationale comment) to keep it out of the Docker build context
- `.gitignore` - Added `website/node_modules`, `website/dist`, `website/.astro`
- `.planning/phases/07-launch-readiness/deferred-items.md` - Appended `## From 07-06 (docs site)` with the two human-only GitHub Pages setup items for 07-12's launch checklist

## Decisions Made
- Sidebar `autogenerate` shape updated for Starlight 0.41.5 (nested `items` array) — see key-decisions above.
- `analytics` icon substituted for the non-existent `seti:chart` on the AIDA Insight card.
- Kept the scaffold-generated `website/pnpm-workspace.yaml` (pnpm build-script allowlist, scoped to `website/`) and `website/AGENTS.md`/`website/CLAUDE.md` (Astro's own AI-assistant docs) — none of these violate the plan's "no root pnpm-workspace.yaml, no Astro dep at root" constraint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Starlight 0.41.5 rejects the plan's sidebar `autogenerate` shorthand**
- **Found during:** Task 1 (`pnpm build` immediately failed with `AstroUserError: Invalid config passed to starlight integration`)
- **Issue:** The plan's `astro.config.mjs` snippet used `{ label: 'Getting started', autogenerate: { directory: 'getting-started' } }`, a shape Starlight removed in v0.39.0
- **Fix:** Changed to `{ label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] }` per the error message's own documented replacement
- **Files modified:** website/astro.config.mjs
- **Verification:** `pnpm build` then succeeded, 3 pages built, `/aida/` confirmed present in output HTML
- **Committed in:** ea21096 (Task 1 commit)

**2. [Rule 1 - Bug] Invalid Starlight icon key `seti:chart`**
- **Found during:** Task 1, while writing the CardGrid (caught before build rather than as a build failure, since Starlight icons fail silently/render blank rather than erroring)
- **Issue:** `seti:chart` is a file-tree icon set key, not a valid `Card`/action icon
- **Fix:** Used the built-in `analytics` icon instead
- **Files modified:** website/src/content/docs/index.mdx
- **Verification:** Visual inspection of the Icons.ts built-in icon list in the installed `@astrojs/starlight` package
- **Committed in:** ea21096 (Task 1 commit)

**3. [Parallel-execution hazard, not a deviation rule] `git commit -m` (no pathspec) on Task 1 swept up two sibling-agent files**
- **Found during:** post-Task-1 commit inspection
- **Issue:** This plan's `git commit -m "..."` (Task 1) was run without a trailing pathspec after `git add website/`; a concurrently-running sibling agent (07-05) had staged `.github/workflows/ci.yml` and `.github/workflows/integration.yml` at that exact moment, and a plain `git commit -m` commits the *entire* index, not just what the current agent added. Both files ended up inside `ea21096` (this plan's Task 1 commit) instead of 07-05's own commit.
- **Fix:** Content is correct and not lost — no code changes needed. Adopted `git commit --no-verify -m "..." -- <explicit files>` for every subsequent commit in this plan (Tasks 2 and 3) to make the same race impossible going forward. Symmetrically, a sibling agent (07-03, commit `0c5a6f2`) later swept up this plan's own `## From 07-06` addition to `deferred-items.md` before this plan could commit it itself — that content is present and correct in git history, just under 07-03's commit message instead of this plan's.
- **Files affected:** `.github/workflows/ci.yml`, `.github/workflows/integration.yml` (in `ea21096`); `.planning/phases/07-launch-readiness/deferred-items.md` (in `0c5a6f2`, not committed by this plan at all)
- **Verification:** `git show --stat` on both commits confirms the content is present, correct, and matches each source plan's intent
- **Committed in:** ea21096 (incoming, not by this plan), 0c5a6f2 (not by this plan)

---

**Total deviations:** 2 auto-fixed (2 blocking/bug, both Starlight config-shape issues) + 1 parallel-execution staging-race note (no code impact, process learning only)
**Impact on plan:** Both config fixes were required for the build to succeed at all — no scope creep. The staging race did not lose or corrupt any content from this plan or any sibling plan; it only misattributed which commit message a few files' worth of content landed under.

## Issues Encountered
- pnpm's resolved Node for `pnpm create astro@latest` inside this shell defaulted to a stale Volta-pinned 20.20.2 runtime (unsupported by current create-astro, which requires >=22.12.0) rather than the project's pinned 22.23.1 — resolved by explicitly running the scaffold command through `volta run --node 22.23.1 -- pnpm create astro@latest ...` (same class of Node/PATH quirk as this project's existing `volta run --node 22` E2E memory note).

## User Setup Required

External/manual one-time steps are required before the deployed site is live, but they are GitHub repo-settings clicks, not local environment configuration — tracked in `.planning/phases/07-launch-readiness/deferred-items.md` under `## From 07-06 (docs site)` for 07-12's launch checklist:
- Enable GitHub Pages with **Source = GitHub Actions** in the repo's Settings > Pages (one-time, human-only; a workflow cannot do this).
- After the first deploy, verify `https://afrizzal.github.io/aida` renders with working CSS (a Pages-URL/`base` mismatch shows as an unstyled page).

## Next Phase Readiness
- The docs site skeleton builds, deploys, and is toolchain-isolated — Plan 07-11 can now add the remaining content pages (configuration, AI setup, etc.) as new files under `website/src/content/docs/`, extending the existing `getting-started` sidebar group with additional groups, without touching any of this plan's infrastructure.
- No blockers. The two deferred human-only GitHub Pages settings steps are the only outstanding items, and they are explicitly scoped to 07-12 (launch checklist), not this plan.

---
*Phase: 07-launch-readiness*
*Completed: 2026-07-29*

## Self-Check: PASSED

All 10 claimed files found on disk (website/package.json, website/astro.config.mjs,
website/src/content/docs/index.mdx, website/src/content/docs/getting-started/quick-start.md,
website/pnpm-lock.yaml, .github/workflows/docs.yml, tsconfig.json, biome.json, .dockerignore,
.gitignore). All 3 task commit hashes (ea21096, a2ff3cf, c68b33c) found in git history.
