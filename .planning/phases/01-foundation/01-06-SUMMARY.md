---
phase: 01-foundation
plan: "06"
subsystem: ui
tags: [next-js, shadcn, tailwind, next-themes, better-auth, prisma, app-shell]

# Dependency graph
requires:
  - phase: 01-foundation/01-02
    provides: "authClient (Better Auth client with signOut), auth-client.ts"
  - phase: 01-foundation/01-03
    provides: "requireSession, getScopedDb, session helpers"
  - phase: 01-foundation/01-05
    provides: "activeOrganizationId auto-set at login via databaseHooks.session.create.before; post-login redirect target /tickets confirmed"

provides:
  - Auth-gated (app) route group: src/app/(app)/layout.tsx calls requireSession() (AIDA-10 server-side) + activeOrganizationId null-guard
  - Sidebar (240px, w-60, bg-muted): AIDA wordmark, Tickets/KB/Settings nav with active state (bg-primary) and hover (hover:bg-accent), user area with avatar initials
  - TopBar (h-14, border-b, bg-background): page title from pathname, ThemeToggle + UserMenu
  - ThemeToggle: resolvedTheme-aware, Sun/Moon icons, tooltip "Switch to light/dark mode", hydration-safe mount guard
  - UserMenu: avatar trigger aria-label="Open user menu", authClient.signOut() → /login redirect
  - EmptyState shared component: centered, h-12 w-12 icon, 18px/600 heading, 14px muted body
  - Tickets stub: "Your inbox is empty" empty state
  - KB stub: "No articles yet" empty state
  - Settings page: reads aiEnabled from org-scoped Setting (getScopedDb), defaults false
  - AiToggle: Switch component with optimistic UI, setAiEnabled Server Action (findFirst+create/update via scopedDb)
  - setAiEnabled Server Action: getScopedDb → findFirst + conditional create/update; revalidatePath; no bare prisma

affects: [07-docker, 08-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App shell pattern: Server Component layout (requireSession + org guard) wraps Client Component Sidebar + TopBar; children render in <main>"
    - "Active nav pattern: usePathname() in Sidebar Client Component; pathname.startsWith(href) drives bg-primary active state"
    - "Hydration-safe theme toggle: useEffect setMounted guard prevents SSR/client mismatch for resolvedTheme"
    - "scopedDb findFirst+create/update pattern: avoids Prisma upsert where-clause constraint with compound unique; scopedDb injects organizationId on all domain model ops"
    - "Optimistic UI toggle: local useState optimistically updates; server action failure reverts state + sonner error toast"

key-files:
  created:
    - src/app/(app)/layout.tsx
    - src/components/sidebar.tsx
    - src/components/top-bar.tsx
    - src/components/theme-toggle.tsx
    - src/components/user-menu.tsx
    - src/components/empty-state.tsx
    - src/app/(app)/tickets/page.tsx
    - src/app/(app)/kb/page.tsx
    - src/app/(app)/settings/actions.ts
    - src/app/(app)/settings/page.tsx
    - src/app/(app)/settings/ai-toggle.tsx
  modified: []

key-decisions:
  - "findFirst+create/update instead of upsert for setAiEnabled: Prisma upsert where requires a unique identifier; scopedDb injects organizationId into the top-level where object which makes the compound unique clause ambiguous at runtime. findFirst (scoped by organizationId automatically) + update-by-id or create (scopedDb injects orgId) is unambiguously correct."
  - "activeOrganizationId null-guard in layout shows 'No workspace found' message rather than crashing: databaseHooks.session.create.before ensures it's always set after login; the guard is a defensive fallback for orphaned sessions, not a normal path."
  - "Two-weight rule enforced: font-normal (400) and font-semibold (600) only in all new files; shadcn component internals (DropdownMenuLabel uses font-medium) are not 'our' files per the rule."
  - "organizationId passed explicitly in create data: TypeScript requires it (Prisma schema mandates the field); scopedDb also injects it at runtime (harmless duplicate spread)."

patterns-established:
  - "App shell guard pattern: layout calls requireSession() (server-side AIDA-10); if activeOrganizationId null show fallback; render Sidebar+TopBar+main with children"
  - "Client Component page title: usePathname() mapped to display names in TopBar; avoids passing title through props"
  - "Shared EmptyState: LucideIcon prop + heading + body; reused by Tickets, KB, and future stub pages"
  - "Settings persistence pattern: getScopedDb() in Server Component (page) reads current value; getScopedDb() in Server Action writes new value; AiToggle Client Component bridges with optimistic state"

requirements-completed: [AIDA-10]

# Metrics
duration: ~10min
completed: "2026-06-29"
---

# Phase 01 Plan 06: App Shell — Full Shell, Empty Rooms Summary

**Auth-gated (app) shell with 240px sidebar (Tickets/KB/Settings, active-state nav), 56px top bar (page title + theme toggle + user menu), screenshot-worthy empty states, and org-scoped AI toggle persisted via scopedDb — "full shell, empty rooms" delivered, AIDA-10 server-side guard in layout.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Server Component `src/app/(app)/layout.tsx` calls `requireSession()` (AIDA-10 server-side defense-in-depth with middleware), resolves `activeOrganizationId` null-guard, renders persistent 240px sidebar + 56px top bar wrapping `<main>` content area
- Sidebar (`w-60 bg-muted`) with AIDA wordmark, Tickets/Knowledge Base/Settings nav items using `usePathname()` for active state (`bg-primary text-primary-foreground`) and hover (`hover:bg-accent`), Lucide icons Inbox/BookOpen/Settings2 at `h-4 w-4`, user area with initials avatar
- TopBar (`h-14 border-b`) with page title derived from pathname, ThemeToggle (hydration-safe, `resolvedTheme`-aware, tooltip copy per UI-SPEC), UserMenu (`aria-label="Open user menu"`, `authClient.signOut()`)
- Shared `EmptyState` component (centered, `min-h-[60vh]`, `h-12 w-12` icon, `18px/600` heading, `14px` muted body) used by Tickets ("Your inbox is empty") and KB ("No articles yet") stubs
- Settings page reads `aiEnabled` via `getScopedDb()` (default `false`, D-18); `AiToggle` Client Component with optimistic UI; `setAiEnabled` Server Action persists to org-scoped Setting via scopedDb (D-15) — the only AI artifact in Phase 1
- Two-weight rule (`font-normal`/`font-semibold`) maintained across all 11 new files; `tsc --noEmit` and `biome check` exit 0

## Task Commits

1. **Task 1: Auth-gated layout + sidebar + top bar** - `4cfbc0f` (feat)
2. **Task 2: Stub pages — Tickets + KB empty states** - `1fd8493` (feat)
3. **Task 3: Settings page + AI toggle via scopedDb** - `0e95fed` (feat)

## Files Created/Modified

- `src/app/(app)/layout.tsx` - Server Component: requireSession() guard + activeOrganizationId null check; renders Sidebar + TopBar + main children
- `src/components/sidebar.tsx` - "use client": w-60 bg-muted, AIDA wordmark, Tickets/KB/Settings nav with usePathname active state, user area with avatar initials
- `src/components/top-bar.tsx` - "use client": h-14 border-b, page title from pathname map, ThemeToggle + UserMenu
- `src/components/theme-toggle.tsx` - "use client": resolvedTheme-aware Sun/Moon toggle, tooltip "Switch to light/dark mode", mounted guard for hydration safety
- `src/components/user-menu.tsx` - "use client": avatar trigger aria-label="Open user menu", authClient.signOut() → router.push("/login"), name/email header in dropdown
- `src/components/empty-state.tsx` - Shared centered empty state: LucideIcon h-12 w-12, 18px/600 heading, 14px muted body, min-h-[60vh]
- `src/app/(app)/tickets/page.tsx` - Server Component: EmptyState "Your inbox is empty" + full body copy
- `src/app/(app)/kb/page.tsx` - Server Component: EmptyState "No articles yet" + full body copy
- `src/app/(app)/settings/actions.ts` - "use server": getScopedDb() → findFirst + conditional create/update for aiEnabled Setting; revalidatePath
- `src/app/(app)/settings/page.tsx` - Server Component: getScopedDb reads aiEnabled (default false); renders AiToggle
- `src/app/(app)/settings/ai-toggle.tsx` - "use client": Switch with optimistic UI; setAiEnabled Server Action; sonner error toast + state revert on failure

## scopedDb Upsert Decision (for Phase 2+)

The plan suggested `db.setting.upsert({ where: { organizationId_key: {...} } })`. This was NOT used because scopedDb's `upsert` interceptor adds `organizationId: orgId` to the top-level `where` object — making it `{ organizationId_key: {...}, organizationId: orgId }`. Prisma's `upsert` `where` must be a unique identifier; adding a non-unique field like `organizationId` at the top level causes a Prisma runtime validation error.

**Pattern established:** For scopedDb-managed models with compound unique keys, use `findFirst` (auto-scoped) + conditional `create`/`update` (orgId auto-injected on create, id-based on update). This is unambiguously correct and safe.

## Active-Org Resolution (for Phase 2+)

`activeOrganizationId` is always set at login by `databaseHooks.session.create.before` in `auth.ts`. The layout's null-guard is purely defensive (orphaned session edge case). No `auth.api.setActiveOrganization` call is needed in the layout — it would require an extra DB lookup and the auth hook already handles it at sign-in.

## Component Map for Phase 2 (which stubs will be replaced)

| File | Phase 2 replacement |
|------|---------------------|
| `src/app/(app)/tickets/page.tsx` | Full ticket inbox (AIDA-02) |
| `src/app/(app)/kb/page.tsx` | KB article list + editor (AIDA-15) |
| `src/app/(app)/settings/page.tsx` | Full settings page (AIDA-12) |
| `src/app/(app)/settings/ai-toggle.tsx` | Expanded AI settings panel (AIDA-13) |
| `src/app/(app)/settings/actions.ts` | Extended settings Server Actions |
| `src/components/sidebar.tsx` | Collapsible sidebar + notification badges (Phase 3+) |

Components that will persist unchanged: `empty-state.tsx`, `theme-toggle.tsx`, `user-menu.tsx`, `top-bar.tsx`.

## Decisions Made

- `findFirst + conditional create/update` for `setAiEnabled` instead of `upsert`: Prisma upsert where-clause constraint with compound unique; scopedDb injects `organizationId` into the top-level where which breaks upsert unique identification at runtime.
- `activeOrganizationId` null-guard shows message (not redirect): defensive fallback only; in normal flow it's always set at login. Redirecting to /login could cause infinite loops if the session exists but the org is missing.
- `organizationId` passed explicitly in create data: TypeScript requires it (Prisma schema field is required); scopedDb also injects at runtime (harmless).
- `resolvedTheme` (not `theme`) used in ThemeToggle: handles `"system"` theme value correctly (resolves to actual dark/light).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome import order and formatting corrections**
- **Found during:** Task 1 (biome check after creation)
- **Issue 1:** `src/app/(app)/layout.tsx` — imports not sorted (lib imports should come after component imports); function signature multiline vs inline format
- **Issue 2:** `src/components/theme-toggle.tsx` — multi-line import should be single-line per biome line-width
- **Issue 3:** `src/components/user-menu.tsx` — Button JSX props multiline vs inline
- **Fix:** Applied biome-correct formatting in all three files before commit
- **Verification:** `biome check` exits 0 after fix
- **Committed in:** `4cfbc0f` (Task 1 commit)

**2. [Rule 1 - Bug] Biome formatting on Switch component in ai-toggle.tsx**
- **Found during:** Task 3 (biome check after creation)
- **Issue:** Switch JSX props multiline vs inline
- **Fix:** Collapsed to single-line props
- **Verification:** `biome check` exits 0 after fix
- **Committed in:** `0e95fed` (Task 3 commit)

**3. [Rule 1 - Bug/Adaptation] Replaced upsert with findFirst+create/update for setAiEnabled**
- **Found during:** Task 3 (TypeScript compilation revealed organizationId required; runtime analysis of scopedDb upsert hook)
- **Issue:** Two problems: (a) TypeScript requires `organizationId` in create data since Prisma schema mandates it; (b) scopedDb's upsert hook adds `organizationId: orgId` to the top-level `where`, which conflicts with Prisma upsert's requirement for a unique identifier only in where.
- **Fix:** Used `findFirst({ where: { key: "aiEnabled" } })` (scopedDb auto-scopes by org) + conditional `update({ where: { id: existing.id } })` / `create({ data: { organizationId: orgId, key: "aiEnabled", value } })`
- **Verification:** `tsc --noEmit` exits 0; biome clean; functionally equivalent to upsert
- **Committed in:** `0e95fed` (Task 3 commit)

---

**Total deviations:** 3 (2 Rule 1 Biome format, 1 Rule 1 adaptation)
**Impact on plan:** All fixes necessary for correctness and type safety. Core objectives fully achieved. The upsert adaptation is actually safer than the plan's suggested upsert approach.

## Issues Encountered

None beyond what's documented in Deviations.

## Known Stubs

The Tickets and KB pages are INTENTIONAL stubs — their empty states are the Phase 1 deliverable ("full shell, empty rooms"). They are correct as designed and will be replaced in Phase 2. No unintended stubs exist.

## User Setup Required

None for this plan. (End-to-end verification of the shell with a real DB and running app is Plan 08.)

## Next Phase Readiness

- **Plan 07 (Docker):** `src/app/(app)/` route group is ready; `src/instrumentation.ts` bootstrap is ready for env vars; the app shell renders the full `/tickets` post-login destination
- **Plan 08 (E2E):** Full flow available: /setup → /login → /tickets (empty state) → navigate to /settings → toggle AI; theme toggle and user menu are exercisable

---

## Self-Check

- `src/app/(app)/layout.tsx` — FOUND, contains requireSession, activeOrganizationId guard, Sidebar, TopBar
- `src/components/sidebar.tsx` — FOUND, contains "Tickets", "Knowledge Base", "Settings", Inbox, BookOpen, Settings2, w-60, bg-muted, bg-primary
- `src/components/top-bar.tsx` — FOUND, contains h-14, border-b, ThemeToggle, UserMenu
- `src/components/theme-toggle.tsx` — FOUND, contains setTheme, "Switch to light mode", "Switch to dark mode"
- `src/components/user-menu.tsx` — FOUND, contains aria-label="Open user menu", "Sign out", signOut
- `src/components/empty-state.tsx` — FOUND, exports EmptyState, h-12 w-12, text-muted-foreground
- `src/app/(app)/tickets/page.tsx` — FOUND, contains "Your inbox is empty"
- `src/app/(app)/kb/page.tsx` — FOUND, contains "No articles yet"
- `src/app/(app)/settings/actions.ts` — FOUND, contains "use server", getScopedDb, aiEnabled
- `src/app/(app)/settings/page.tsx` — FOUND, contains getScopedDb, aiEnabled, AiToggle
- `src/app/(app)/settings/ai-toggle.tsx` — FOUND, contains "use client", Switch, "Enable AI", "Configure your AI provider"
- Commits 4cfbc0f, 1fd8493, 0e95fed — verified in git log

## Self-Check: PASSED

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
