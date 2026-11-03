# Phase 8 deferred items

## From 08-01

- **Turbopack NFT warning, "Dynamic filesystem access causes tracing of the whole project" (5 warnings).** Seen in `pnpm build` on next 16.4.6 (exit 0). Source: `src/lib/attachments/local-file-storage.ts` lines 18, 20, 24 and 27 (`path.join(ROOT, orgId, safeKey(key))`), reached from `src/app/api/tickets/[id]/messages/route.ts`. Next says the whole project, `public/` included, may then be traced into the server output. Not checked whether 16.2.11 printed the same warning (no rebuild on the old version). Out of scope for 08-01, which changes no product file. Relevant to 08-03, whose D-03 evidence greps `.next/standalone` for `shadcn` modules: a whole-project trace could put unrelated files into the standalone output. A likely fix is a `/*turbopackIgnore: true*/` hint or a `ROOT` that Turbopack can resolve statically.

## From 08-04

- **better-auth peer snapshot re-breaks on every `pnpm add` or `pnpm remove`.** pnpm re-resolves `@better-auth/core@1.7.20` against `better-call@1.1.8` and `@better-fetch/fetch@1.1.21`, the copies the dev-only `@better-auth/cli@1.4.21` brings in. The build then fails with `kAPIErrorHeaderSymbol was not found`. Workaround used in 08-02 and 08-04: `pnpm remove better-auth && pnpm add better-auth@1.7.20 --save-exact`, then check `grep "'@better-auth/core@1.7.20(" pnpm-lock.yaml` for `better-call@1.4.5`. A permanent fix (dropping or replacing the dev CLI) is out of 08-04's scope. Any plan that changes packages, and Dependabot PRs, should re-check this.

## From the Part A code review (step 7, 2026-11-11)

- **Ollama probe accepts any 200 JSON (F2 observation).** An HTTP service that answers the Ollama probe path with status 200 and any valid JSON makes the Test pass, because the probes do not check the response shape. Not a text oracle, but it tells "some JSON service answered" apart from `connection_failed`. Left for the Codex diff critique and Phase 8.1.
- The rows deferred in the "Orchestrator dispositions" section of `08-REVIEW.md` (a-IN-a3, a-IN-a5, a-IN-a6, a-IN-a7, b-IN-b5, b-IN-b6, b-IN-b8, c-IN-07), with the reasons given there.

- **Caddy-generated responses have no security headers (Codex diff round 1, LOW).** The probe's 404 and the body-size 413 come from Caddy, not the app proxy. Deferred to Phase 8.1 (08-22, real Caddy), because a global Caddy `header` block would duplicate the app's CSP.
- **The image check leaves its own temp directories (final gate, 2026-11-12).** `scripts/test-image-check.ts` creates `aida-image-check-*` directories under TMPDIR and does not remove them, also when it stops at the space preflight (10 small directories so far). Fix in Phase 8.1 together with the real image-check runs.
