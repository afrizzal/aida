# AGENTS.md

Instructions for AI coding agents working in this repository. The full project rules are in
[`CLAUDE.md`](./CLAUDE.md); this file mirrors the commands and the rules that break silently.
Where the two differ, `CLAUDE.md` wins.

`next.config.ts` sets `agentRules: false`, so `next dev` never writes its own `AGENTS.md`.
This checked-in file is the only one.

## Prerequisites

- Node 22 (`.nvmrc`, `engines.node` `>=22`; Volta pins 22.23.1 in `package.json`) and the
  pnpm version named by `packageManager` in `package.json`.
- Docker, for `docker compose up`, the integration suite (Testcontainers PostgreSQL with
  pgvector), the egress suite and the end-to-end suite.

## Commands

```sh
pnpm install
pnpm lint              # Biome
pnpm typecheck         # tsc --noEmit
pnpm test              # unit tests (Vitest), no Docker
pnpm test:integration  # Vitest against Testcontainers PostgreSQL
pnpm test:egress       # builds the images and checks that nothing leaves the stack
pnpm test:e2e          # Playwright
pnpm build             # next build
```

- Run **one test process at a time**. The integration suite runs its files one after another
  and shares one database container; two suites at once fight over Docker and the database.
- Send long output to a log file and read the exit code directly, not through a pipe.
- A step that could not run is reported as not run or blocked, never as passed.

## Database migrations

- Create a migration with `prisma migrate dev --create-only` against a disposable database
  (never a database that holds real data), review the SQL, then apply it with
  `prisma migrate deploy` (`pnpm db:deploy`).
- Never use `prisma db push`. Committed migrations are the only way the schema changes.

## Code rules

- **Worker-bundled modules use relative imports only.** The esbuild worker bundle has no `@/`
  alias, so any module read by both the Next.js app and the pg-boss worker imports by
  relative path.
- **`src/proxy.ts` owns the public prefixes.** `PUBLIC_PREFIXES` and `BLOCKED_PUBLIC_ROUTES`
  live there (there is no `middleware.ts`). A new public route goes under an existing public
  prefix or is added there, with a test.
- **Tenant scoping.** Every domain model is scoped to its organization through `scopedDb`,
  with an isolation test that is not mocked.
- **AI only through `src/lib/llm/`.** One provider abstraction (OpenAI, Anthropic, Ollama),
  bring your own key, and AI can be switched off. Never call a vendor SDK from anywhere else.
- **A human approves anything sent to a customer.** AI may draft and suggest; it never sends.
  Ticket text, webhook payloads and task content are untrusted input.
- **Privacy.** Ticket data and provider keys stay on the operator's server. Any new outbound
  call is documented in `docs/SECURITY.md` and covered by
  `tests/integration/egress-isolation.test.ts`.
- **Single server.** One `docker compose`; the queue is pg-boss and vectors live in pgvector.
  Do not add Redis or another service without a written reason.

## UI

Every UI change follows [`.planning/DESIGN-SYSTEM.md`](./.planning/DESIGN-SYSTEM.md): design
tokens only (no hardcoded colours), the sidebar, top bar and empty-state patterns, explicit
`text-[Npx]` sizes, and the section 9 checklist after UI work.

## Repository hygiene

- This repository is public. Never commit secrets, API keys, personal names or local
  machine paths. Do not read or edit `.env`.
- Files are LF (`.gitattributes`).
- Planning lives in `.planning/` (GSD); `.planning/STATE.md` is the current state.
