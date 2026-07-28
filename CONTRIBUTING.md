# Contributing to AIDA

Thanks for considering a contribution to AIDA — an open-source, self-hostable, AI-native helpdesk. This guide gets you from a clean clone to a running dev environment, and explains the conventions that keep the codebase coherent.

## Ways to contribute

- **Bugs** — something doesn't work as documented. Open an issue with the bug report template.
- **Features** — something is missing. Open an issue with the feature request template first if the change is non-trivial; it saves everyone time to agree on the approach before code is written.
- **Docs** — README, `docs/`, code comments, this file. Docs PRs are always welcome.

If you're planning a large PR (new feature, refactor touching many files), please open an issue first so we can align on direction before you invest the time.

## Development setup

```bash
git clone https://github.com/afrizzal/aida.git && cd aida
pnpm install
cp .env.example .env      # required: prisma.config.ts reads DATABASE_URL at load time
docker compose up -d db   # or point DATABASE_URL at your own Postgres 16 + pgvector
pnpm db:deploy            # apply migrations
pnpm db:generate          # generate the Prisma client (src/generated is gitignored)
pnpm dev                  # app on http://localhost:3000
pnpm worker               # in a second terminal: background jobs
```

**Node 22+ is required** (Testcontainers/undici constraint — see `.nvmrc`). **pnpm** is the only supported package manager (`packageManager` is pinned in `package.json`); please don't commit an `npm`/`yarn` lockfile.

## Quality gates before you open a PR

These are exactly what CI runs (see `.github/workflows/ci.yml`):

- `pnpm lint` — Biome check
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — unit tests

Additionally, before submitting anything that touches data access, background jobs, or the browser UI:

- `pnpm test:integration` — Testcontainers-backed Postgres integration suite; needs Docker and Node 22 (runs nightly in CI, not on every PR — see `.github/workflows/integration.yml`)
- `pnpm test:e2e` — Playwright end-to-end suite; needs Playwright browsers installed (`pnpm exec playwright install`)

## Project conventions

These are the ones a contributor will otherwise get wrong:

- Import the Prisma client from `@/generated/prisma/client`, never `@prisma/client` — the generated output path is customized.
- All tenant data access goes through `scopedDb(orgId)` / `getScopedDb()`; `src/lib/auth.ts` is the one exception and uses bare `prisma` (Better Auth's own models aren't org-scoped).
- Raw SQL is never scoped automatically — any `$queryRaw`/`$executeRaw` touching tenant tables must filter `organizationId` explicitly.
- Files under `src/lib/worker/` (and anything they import) use **relative imports only** (no `@/`), because the worker is esbuild-bundled separately from the Next.js app.
- There is exactly **one** ticket write path (`createTicket`), **one** KB write path (`createKbArticle`), **one** Markdown/HTML sanitiser (`src/lib/markdown/render.ts`), **one** encryption primitive (`src/lib/crypto/secret-box.ts`) and **one** audit write path (`recordAuditEvent`). Do not add a second — extend the existing one.
- Every mutating Settings Server Action starts with `await requireOrgAdmin()`.
- UI must follow [`.planning/DESIGN-SYSTEM.md`](.planning/DESIGN-SYSTEM.md): design tokens only (no hardcoded hex/oklch in components), explicit `text-[Npx]` sizes rather than Tailwind's named sizes.

## Architectural non-negotiables

AIDA has a small set of rules that are not up for debate in a PR (see `CLAUDE.md` for the full rationale):

- The LLM layer stays **model-agnostic** — all calls go through the one provider abstraction in `lib/llm/` with adapters for OpenAI, Anthropic, and Ollama. Never hardcode a single vendor.
- AI must remain **fully toggleable off** — the helpdesk works with AI disabled.
- Nothing is sent to any third party other than the operator-configured LLM. No telemetry, no third-party analytics by default.
- AI never sends to a customer without a human approving first. Drafted replies must carry citations.
- **The stack stays single-server** — no Redis, no extra queue or vector service. pg-boss and pgvector both live in the same Postgres. A PR that adds a new runtime service will be declined; if you think one is genuinely needed, open an issue and make the case first.

## Honest claims

Contributions to README, docs, or any marketing copy may not invent metrics, may not claim models are "trained" or "fine-tuned" by AIDA (they are consumed via API / orchestrated locally or remotely), and comparisons stay relative — no fabricated resolution-rate statistics.

## Commit and PR style

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
- One logical change per PR. Link the issue it closes (`Closes #123`).
- Fill in the PR template — the checklist mirrors the quality gates above and the invariants in this file.

## License

By contributing, you agree that your contributions are licensed under the project's [Apache-2.0](LICENSE) license.
