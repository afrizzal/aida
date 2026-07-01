---
phase: 02-core-ticketing
plan: 02
subsystem: ui
tags: [markdown, sanitization, rehype, remark, unified, shadcn, design-tokens, xss]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Next.js/Tailwind/shadcn app shell, Badge component with destructive-variant tint-only pattern, globals.css token structure
provides:
  - unified/remark/rehype Markdown-sanitization npm packages installed
  - 5 shadcn primitives (textarea, popover, command, checkbox, skeleton) + transitively-pulled dialog/input-group
  - --warning / --success design tokens (light + dark) registered in @theme inline
  - Badge warning/success tint-only variants
  - src/lib/markdown/render.ts — the single renderMarkdown() sanitized Markdown->HTML pipeline
affects: [02-03, 02-06, 02-07, 02-08, 02-09, 02-11, 02-12]

# Tech tracking
tech-stack:
  added:
    - unified@11.0.5, remark-parse@11.0.0, remark-gfm@4.0.1, remark-rehype@11.1.2, rehype-sanitize@6.0.0, rehype-stringify@10.0.1 (Markdown->sanitized-HTML pipeline)
    - file-type@22.0.1 (magic-byte MIME sniffing, consumed by Phase 2 attachment plans)
    - hast-util-sanitize@5.0.2 (devDependency, type-only Schema import)
    - unist-util-visit@5.1.0 + @types/hast@3.0.4 (runtime + types for the custom rehypeSafeLinks plugin)
    - shadcn primitives: textarea, popover, command (+cmdk), checkbox, skeleton, dialog, input-group
  patterns:
    - "Single shared renderMarkdown() call site — never a second ad hoc dangerouslySetInnerHTML"
    - "Tint-only Badge variant pattern (bg-{token}/10 text-{token}, no -foreground companion) extended to warning/success"
    - "Custom rehype plugin (rehypeSafeLinks) to actively stamp safe target/rel attributes on links, run before rehype-sanitize's allowlist pass"

key-files:
  created:
    - src/lib/markdown/render.ts
    - tests/unit/markdown-render.test.ts
    - src/components/ui/textarea.tsx
    - src/components/ui/popover.tsx
    - src/components/ui/command.tsx
    - src/components/ui/checkbox.tsx
    - src/components/ui/skeleton.tsx
    - src/components/ui/dialog.tsx
    - src/components/ui/input-group.tsx
  modified:
    - package.json
    - src/app/globals.css
    - src/components/ui/badge.tsx

key-decisions:
  - "hast-util-sanitize added as an explicit devDependency (not left as an implicit transitive) — pnpm's strict node_modules linking made the plan's `import type { Schema } from \"hast-util-sanitize\"` unresolvable without it"
  - "rehype-sanitize's defaultSchema allowlist only lets target/rel SURVIVE sanitization if already present — it does not add them. Added a small custom rehypeSafeLinks plugin (unist-util-visit) that stamps target=_blank + rel=\"nofollow noopener noreferrer\" on every link before the sanitize pass, to actually satisfy the plan's Test 5 acceptance criterion"
  - "Created .env from .env.example and ran `pnpm prisma generate` to unblock tsc --noEmit in this fresh worktree checkout (generated Prisma client + .env are both gitignored, not committed)"

patterns-established:
  - "renderMarkdown(markdown: string): string is the ONE sanitization pipeline; bodyMarkdown/bodyHtml split (future plans) always computes bodyHtml via this function"
  - "New semantic Badge variants follow the destructive tint-only template exactly: bg-{token}/10 text-{token} focus-visible:ring-{token}/20 dark:bg-{token}/20 dark:focus-visible:ring-{token}/40 [a]:hover:bg-{token}/20"

requirements-completed: [AIDA-04, AIDA-07]

# Metrics
duration: ~25min
completed: 2026-07-01
---

# Phase 02 Plan 02: Deps, Design Tokens, Sanitized Markdown Summary

**Installed the Phase-2 unified/remark/rehype Markdown-sanitization pipeline and 5 shadcn primitives, added `--warning`/`--success` design tokens with matching Badge variants, and shipped a TDD-verified `renderMarkdown()` that strips `<script>`/`javascript:`/event-handler XSS vectors while stamping safe `target`/`rel` on every link.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-01T23:49:58Z
- **Tasks:** 3 (all `type="auto"`, Task 3 was TDD)
- **Files modified:** 12 (3 modified, 9 created)

## Accomplishments
- 7 markdown/file-type npm packages installed (`unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify`, `file-type`) plus 5 shadcn primitives (`textarea`, `popover`, `command`, `checkbox`, `skeleton`) with zero `select`/`tabs`/`table`/`alert`/`calendar` footprint
- `--warning`/`--success` tokens live in `@theme inline`, `:root`, and `.dark`, with `Badge` `warning`/`success` tint-only variants mirroring the existing `destructive` template exactly (no `-foreground` companions)
- `renderMarkdown()` — one shared sanitized Markdown->HTML pipeline — passes all 6 TDD behavior assertions (bold, `<script>` stripped, `javascript:` stripped, `onerror` stripped, safe link `rel`/`target`, GFM strikethrough)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install markdown/file-type packages and add 5 shadcn primitives** - `64acb84` (feat)
2. **Task 2: Add --warning / --success tokens and Badge variants** - `fc7166c` (feat)
3. **Task 3: Build and test renderMarkdown() sanitized pipeline (TDD)**
   - RED: `a758621` (test) — 6 failing assertions committed first (import resolution failure, confirmed red)
   - GREEN: `63ce2c5` (feat) — implementation, all 6 assertions pass
   - REFACTOR: `2441fa3` (refactor) — biome import-order auto-fix, no behavior change

_TDD task produced 3 commits (test → feat → refactor) as expected._

## Files Created/Modified
- `src/lib/markdown/render.ts` - `renderMarkdown(markdown): string`; unified pipeline (remark-parse → remark-gfm → remark-rehype → custom `rehypeSafeLinks` → rehype-sanitize → rehype-stringify)
- `tests/unit/markdown-render.test.ts` - 6 behavior assertions (XSS + GFM); placed under `tests/unit/` per vitest.config.ts's `include` pattern (not `src/lib/markdown/render.test.ts` as the frontmatter's `files_modified` hinted — the task body's own explicit instruction, followed here, since vitest only discovers `tests/unit/**/*.test.ts`)
- `src/app/globals.css` - `--color-warning`/`--color-success` in `@theme inline`; `--warning`/`--success` oklch values in `:root` and `.dark`
- `src/components/ui/badge.tsx` - `warning`/`success` variants added to `badgeVariants`
- `src/components/ui/textarea.tsx`, `popover.tsx`, `command.tsx`, `checkbox.tsx`, `skeleton.tsx` - new shadcn primitives (as specified)
- `src/components/ui/dialog.tsx`, `input-group.tsx` - transitively created by the shadcn CLI as dependencies of `command` (cmdk's `CommandDialog` needs `Dialog`); not a scope violation of the "don't add select/tabs/table/alert/calendar" instruction, which was about explicit unwanted primitives, not the `command` component's own registry dependencies
- `package.json` / `pnpm-lock.yaml` - the 7 planned packages + `cmdk` (command's own dependency) + `hast-util-sanitize`, `unist-util-visit`, `@types/hast` (see Deviations)

## Decisions Made
- `hast-util-sanitize` was made an explicit `devDependency` rather than relying on it being transitively present — pnpm's strict `node_modules` linking does not expose transitive packages to direct imports, so the plan's literal `import type { Schema } from "hast-util-sanitize"` would not resolve otherwise.
- Added a small custom `rehypeSafeLinks` rehype plugin (via `unist-util-visit`) instead of a new named package like `rehype-external-links`, to keep the dependency footprint minimal while actually satisfying the "every link gets safe `target`/`rel`" requirement that `rehype-sanitize`'s `defaultSchema` alone does not implement (it only permits those attributes to survive sanitization if already present on the node).
- Bootstrapped a local `.env` (from `.env.example`) and ran `pnpm prisma generate` to unblock `tsc --noEmit` in this fresh worktree — both are gitignored and not part of any task commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `renderMarkdown` didn't actually add safe `target`/`rel` to links**
- **Found during:** Task 3, TDD GREEN phase (Test 5 failed on first implementation attempt)
- **Issue:** The RESEARCH.md-supplied schema (extending `defaultSchema.attributes.a` with `target`/`rel`) only allowlists those attributes to *survive* sanitization if present — `remark-rehype`'s plain link conversion never adds them, so the rendered `<a>` tags had no `target`/`rel` at all, failing the plan's own Test 5 acceptance criterion.
- **Fix:** Added a custom `rehypeSafeLinks` unified plugin (using `unist-util-visit`) that visits every `a` element in the hast tree and sets `target="_blank"` + `rel="nofollow noopener noreferrer"`, run before the `rehype-sanitize` pass.
- **Files modified:** `src/lib/markdown/render.ts`, `package.json`, `pnpm-lock.yaml` (added `unist-util-visit`, `@types/hast`)
- **Verification:** All 6 `markdown-render.test.ts` assertions green; `pnpm exec tsc --noEmit` clean.
- **Committed in:** `63ce2c5` (Task 3 GREEN commit)

**2. [Rule 3 - Blocking] `hast-util-sanitize` unresolvable under pnpm strict linking**
- **Found during:** Task 3, before writing `render.ts`
- **Issue:** `hast-util-sanitize` (needed for the `Schema` type import specified by the plan/RESEARCH.md) is only a transitive peer of `rehype-sanitize` and is not resolvable from application code under pnpm's strict `node_modules` — `require.resolve('hast-util-sanitize')` failed.
- **Fix:** Added `hast-util-sanitize@5.0.2` as an explicit `devDependency` (type-only usage, erased at compile time).
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `require.resolve('hast-util-sanitize')` succeeds; `tsc --noEmit` clean.
- **Committed in:** `a758621` (Task 3 RED commit)

**3. [Rule 3 - Blocking] Missing generated Prisma client / `.env` in fresh worktree checkout**
- **Found during:** Task 1 verification (`pnpm exec tsc --noEmit`)
- **Issue:** `tsc --noEmit` failed with `Cannot find module '@/generated/prisma/client'` — this worktree had never run `prisma generate`, and `prisma.config.ts` requires `DATABASE_URL` at module load even for `generate` (no DB connection needed, but the env var must exist).
- **Fix:** Copied `.env.example` to `.env` (gitignored, not committed) and ran `pnpm prisma generate`.
- **Files modified:** none tracked (both `.env` and `src/generated/` are gitignored)
- **Verification:** `pnpm exec tsc --noEmit` exits 0.
- **Committed in:** N/A (no tracked files changed by this fix)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were necessary to meet the plan's own stated acceptance criteria (Test 5) and to make the specified `hast-util-sanitize`/generated-client imports actually resolve. No scope creep — no unplanned features added, only the minimum fix in each case.

## Issues Encountered
- The worktree branch (`worktree-agent-ac9971f5a7ed576cf`) was 15 commits behind `master` at the start of this session — it predated Phase 2 planning entirely, so `.planning/phases/02-core-ticketing/*` didn't exist yet. Fast-forward merged (`git merge --ff-only master`) to bring in the 12 Phase-2 plans before starting; no local commits were lost (the merge was a clean fast-forward, zero divergent commits on the worktree branch).
- `pnpm dlx shadcn@latest add ... command ...` prompts interactively ("file already exists, overwrite?") for `button.tsx`/`input.tsx` (pre-existing shared dependencies of the `command`/`cmdk` component) even with `--yes`; resolved by piping `n` answers (`yes n | pnpm dlx shadcn@latest add command --yes`) to decline overwriting existing, working components.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `renderMarkdown()` is ready for Wave-2 plans (02-03 ticket core composer, 02-09 reading pane thread) to consume for both public replies and internal notes — `bodyHtml` should always be computed via this single function.
- `--warning`/`--success` tokens + `Badge` variants are ready for 02-06 (tags/chips) and SLA breach-indicator chips (02-05/02-07/02-08/02-09).
- `popover`+`command` are ready for tag/contact autocomplete (02-06); `checkbox`/`skeleton` ready for custom-fields and loading states across Wave 2/3.
- No blockers for Wave 2. Note for future maintainers: `dialog.tsx` and `input-group.tsx` now exist in `src/components/ui/` as side effects of adding `command` — available for reuse if a later plan needs a modal or input-with-affix pattern, but were not explicitly requested by any Phase 2 plan yet.

---
*Phase: 02-core-ticketing*
*Completed: 2026-07-01*

## Self-Check: PASSED

All 12 claimed files verified present on disk; all 5 claimed commit hashes (`64acb84`, `fc7166c`, `a758621`, `63ce2c5`, `2441fa3`) verified present in git history.
