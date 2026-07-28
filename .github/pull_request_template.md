## What

<!-- What does this PR change? -->

## Why

<!-- Why is this change needed? Link the issue if one exists. -->

## How to test

<!-- Exact steps a reviewer can follow to verify this works. -->

## Checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] Tenant data access goes through `scopedDb` / `getScopedDb` (or the raw SQL filters `organizationId` explicitly)
- [ ] Mutating Settings actions call `requireOrgAdmin()`
- [ ] UI uses design tokens only (no hex/oklch, explicit `text-[Npx]` sizes)
- [ ] No new runtime service was added (the stack stays single-server)
- [ ] Docs/README updated if behaviour or configuration changed

Closes #
