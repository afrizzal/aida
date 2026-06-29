---
phase: 01-foundation
plan: "01"
subsystem: infra
tags: [nextjs, typescript, tailwind, shadcn, vitest, biome, pnpm, next-themes]

# Dependency graph
requires: []
provides:
  - Next.js 16 (App Router) + TypeScript project scaffold at locked dependency versions
  - Tailwind v4 CSS-first design system with shadcn/ui new-york/zinc preset (12 components)
  - Inter font + next-themes dark-mode ThemeProvider wired once in root layout
  - Vitest unit test infrastructure with @ alias and passing smoke test
  - Standalone Docker-ready production build (next build with output: standalone)
  - .env.example documenting all Phase-1 environment variables
affects: [02-database, 03-testing, 04-docker, 05-auth, 06-app-shell, 07-e2e]

# Tech tracking
tech-stack:
  added:
    - next@16.2.9
    - react + react-dom (latest)
    - typescript
    - tailwindcss@4.3.1 (CSS-first, no config file)
    - "@tailwindcss/postcss"
    - shadcn/ui (new-york/zinc, CSS variables)
    - next-themes@0.4.6
    - "@biomejs/biome@2.5.1"
    - vitest@4.1.9
    - "@vitest/coverage-v8"
    - better-auth@1.6.22
    - prisma@7.8.0 + "@prisma/client" + "@prisma/adapter-pg"
    - pg@8.22.0
    - pg-boss@12.23.0
    - zod@4.4.3
    - tsx@4.22.4
    - esbuild
    - testcontainers@12.0.3
    - sonner (via shadcn)
  patterns:
    - CSS-first Tailwind v4 (tokens in globals.css @theme inline block, no tailwind.config)
    - shadcn/ui component pattern (src/components/ui/ registry)
    - next/font/google Inter with CSS variable --font-inter applied on <html>
    - ThemeProvider wraps children once at root layout (no per-page setup)
    - @ path alias (tsconfig paths + vitest resolve.alias both pointing to src/)
    - "use client" boundary wrapper pattern for next-themes ThemeProvider

key-files:
  created:
    - package.json
    - pnpm-lock.yaml
    - .nvmrc
    - tsconfig.json
    - next.config.ts
    - biome.json
    - postcss.config.mjs
    - components.json
    - .env.example
    - src/app/layout.tsx
    - src/app/page.tsx
    - src/app/globals.css
    - src/components/theme-provider.tsx
    - src/components/ui/button.tsx
    - src/components/ui/input.tsx
    - src/components/ui/label.tsx
    - src/components/ui/card.tsx
    - src/components/ui/form.tsx
    - src/components/ui/switch.tsx
    - src/components/ui/separator.tsx
    - src/components/ui/dropdown-menu.tsx
    - src/components/ui/avatar.tsx
    - src/components/ui/sonner.tsx
    - src/components/ui/tooltip.tsx
    - src/components/ui/badge.tsx
    - src/lib/utils.ts
    - vitest.config.ts
    - tests/unit/smoke.test.ts
  modified:
    - .gitignore (appended /src/generated/ and /dist/)

key-decisions:
  - "Tailwind v4 CSS-first: no tailwind.config.js/ts — all design tokens live in globals.css @theme inline block"
  - "shadcn/ui initialized with new-york style + zinc base color + CSS variables mode"
  - "Two font weights only (400, 600) per UI-SPEC — no font-medium or font-bold utilities"
  - "next.config.ts uses output: standalone for Docker single-server deployment"
  - "pnpm@10.34.4 + Node 22 pinned via packageManager field and .nvmrc"
  - "@ path alias defined in both tsconfig.json and vitest.config.ts resolve.alias"
  - "src/app/page.tsx immediately redirects to /login (populated in Plan 05)"

patterns-established:
  - "Component pattern: all shadcn primitives live under src/components/ui/, never duplicated"
  - "Theme pattern: ThemeProvider with attribute=class defaultTheme=system — downstream pages never re-wrap"
  - "Import alias: always use @/ prefix for src/ imports; never use relative paths across boundaries"
  - "Env pattern: all env vars documented in .env.example with comments before any code reads them"
  - "Test pattern: unit tests in tests/unit/, integration tests will use vitest.integration.config.ts (Plan 03)"

requirements-completed: [AIDA-21]

# Metrics
duration: previously executed (summary only)
completed: "2026-06-29"
---

# Phase 01 Plan 01: Project Scaffold Summary

**Next.js 16 App Router + TypeScript project bootstrapped with Tailwind v4 CSS-first design system, shadcn/ui new-york/zinc (12 components), next-themes dark mode, Inter font, Vitest unit suite, and standalone Docker-ready build — all green across typecheck + lint + test + build.**

## Performance

- **Duration:** Previously executed (summary backfilled 2026-06-29)
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3
- **Files modified:** 29

## Accomplishments

- Manually scaffolded Next.js 16 + TypeScript app from a non-empty repo (create-next-app not usable), installing all Phase-1 dependencies at researched locked versions via pnpm
- Wired Tailwind v4 CSS-first design system with shadcn/ui new-york/zinc preset; all 12 Phase-1 components (button, input, label, card, form, switch, separator, dropdown-menu, avatar, sonner, tooltip, badge) installed under src/components/ui/
- Integrated Inter font via next/font/google with CSS variable --font-inter, ThemeProvider (next-themes, class-based) and sonner Toaster in root layout, with standalone output for Docker
- Established Vitest unit config with @ alias mirroring tsconfig, smoke test passes; full green bar: pnpm typecheck + lint + test + build all exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize Next.js + TypeScript project, dependencies, and tooling configs** - `30b1ded` (feat)
2. **Task 2: Wire Tailwind v4 + shadcn/ui + Inter font + dark-mode ThemeProvider + root layout** - `b32c2a0` (feat)
3. **Task 3: Vitest unit config + smoke test + full green-bar verification** - `55dcb8f` (feat)

## Files Created/Modified

- `package.json` - Project manifest with all Phase-1 deps at locked versions; scripts: dev, build, start, worker, lint, format, typecheck, test, test:integration, test:all, db:* commands
- `pnpm-lock.yaml` - Lockfile generated by pnpm install
- `.nvmrc` - Node 22 pin
- `tsconfig.json` - Strict TypeScript config with @ path alias, ES2022 target, bundler moduleResolution, Next.js plugin
- `next.config.ts` - output: standalone for Docker single-server deployment
- `biome.json` - Biome 2.5.1 config: organizeImports on, indentWidth 2, lineWidth 100, linter recommended; ignores node_modules/.next/src/generated/prisma/generated
- `postcss.config.mjs` - @tailwindcss/postcss plugin (required for Tailwind v4)
- `components.json` - shadcn config: style new-york, baseColor zinc, cssVariables true, rsc true, tsx true
- `.env.example` - All Phase-1 env vars: BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL, BETTER_AUTH_SECRET, DATABASE_URL, POSTGRES_*, DOMAIN, ADMIN_* (optional bootstrap)
- `src/app/layout.tsx` - Root layout: Inter font via next/font/google, ThemeProvider (attribute=class, defaultTheme=system, enableSystem), sonner Toaster, html suppressHydrationWarning
- `src/app/page.tsx` - Server Component that redirects to /login
- `src/app/globals.css` - Tailwind v4 @import, @theme inline block with zinc design tokens + --font-inter, body font-family
- `src/components/theme-provider.tsx` - "use client" wrapper re-exporting next-themes ThemeProvider
- `src/components/ui/*.tsx` - 12 shadcn components: avatar, badge, button, card, dropdown-menu, form, input, label, separator, sonner, switch, tooltip
- `src/lib/utils.ts` - cn() helper (clsx + tailwind-merge)
- `vitest.config.ts` - Unit test config: include tests/unit/**/*.test.ts, environment node, resolve alias @ -> src/
- `tests/unit/smoke.test.ts` - Smoke test verifying vitest runs and @ alias resolves via cn() import
- `.gitignore` - Appended /src/generated/ and /dist/

## Decisions Made

- **Tailwind v4 CSS-first:** No tailwind.config.js/ts created. All tokens in globals.css @theme inline block per UI-SPEC Note 2. shadcn init's tailwind config was deleted if generated.
- **Two font weights only (400, 600):** Followed UI-SPEC restriction — no font-medium or font-bold utility classes in the design system.
- **Standalone output:** next.config.ts sets output: "standalone" for Docker deployment (one-command self-host is a first-class feature).
- **pnpm@10.34.4 pinned:** Set via packageManager field in package.json and engine >= node 22 constraint.
- **@ alias in both tsconfig and vitest:** Ensures imports work identically at compile time and test time.
- **page.tsx redirects to /login immediately:** /login route is created in Plan 05; redirect 404s until then by design.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required for this plan. Database and auth setup occur in Plans 02 and 05.

## Next Phase Readiness

- Plan 02 (Database/Prisma schema) can now add prisma/schema.prisma — all Prisma deps are installed
- Plan 03 (Integration test infra) can add vitest.integration.config.ts — testcontainers already installed
- Plan 04 (Docker/Caddy) can build the standalone output that next build already produces
- Plan 05 (Auth — better-auth) can wire /login route — better-auth@1.6.22 already installed
- All downstream plans can use @ alias for src imports without any additional config

---

## Self-Check: PASSED

- `src/components/ui/` — 12 components confirmed present (avatar, badge, button, card, dropdown-menu, form, input, label, separator, sonner, switch, tooltip)
- Commits `30b1ded`, `b32c2a0`, `55dcb8f` confirmed in git log
- `.planning/phases/01-foundation/01-01-SUMMARY.md` — this file

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
