# Phase 8 deferred items

## From 08-01

- **Turbopack NFT warning, "Dynamic filesystem access causes tracing of the whole project" (5 warnings).** Seen in `pnpm build` on next 16.4.6 (exit 0). Source: `src/lib/attachments/local-file-storage.ts` lines 18, 20, 24 and 27 (`path.join(ROOT, orgId, safeKey(key))`), reached from `src/app/api/tickets/[id]/messages/route.ts`. Next says the whole project, `public/` included, may then be traced into the server output. Not checked whether 16.2.11 printed the same warning (no rebuild on the old version). Out of scope for 08-01, which changes no product file. Relevant to 08-03, whose D-03 evidence greps `.next/standalone` for `shadcn` modules: a whole-project trace could put unrelated files into the standalone output. A likely fix is a `/*turbopackIgnore: true*/` hint or a `ROOT` that Turbopack can resolve statically.
