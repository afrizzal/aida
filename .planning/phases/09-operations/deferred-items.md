# Phase 09 deferred items

Out-of-scope findings logged by plan executors. Not fixed by the plan that found them.

## From 09-08

- **Badge `destructive` variant in dark mode** (`src/components/ui/badge.tsx`): the variant adds `dark:bg-destructive/20`. axe measured 3.96:1 for 12px `text-destructive` on that tint over `--card` in dark mode (needs 4.5:1), found by `tests/e2e/backups-status.spec.ts` on the Backups "Failed" badge. The Backups page now passes the spec's `/10` tint in both themes (`dark:bg-destructive/10`). Other uses of the Badge `destructive` variant, if any, were not scanned. A fix at the variant (or the token) belongs to a design-system pass, not to this plan.

## From 09-09

- **The page still runs under the "No workspace found" fallback** (`src/app/(app)/layout.tsx`, `src/lib/session.ts:41`): for a signed-in user with no organization, the layout returns its fallback, but next dev still renders the route's page in parallel, so `/tickets` runs `TicketListPanel`, whose `getScopedDb()` throws "No active organization on session" and logs a server error with a digest. Seen in `tests/e2e/single-h1.spec.ts` (the no-workspace case): the browser gets only the fallback and no tenant data, because the throw happens before any query. This behaviour existed before 09-09 and is not caused by it. A quieter path (a page-level guard, or `getScopedDb` returning a typed "no workspace" result) is a separate change.
