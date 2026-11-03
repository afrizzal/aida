---
phase: 01
phase_name: 01-foundation
verified: 2026-11-12
status: human_needed
method: evidence map built in Phase 9 (AIDA-39)
score: 2 of 4 success criteria passed now; 1 open for a human; 1 failed (invite and user management, owned by AIDA-42 and AIDA-43)
gaps:
  - "Criterion 2: no invite flow and no user management exist (v1 AIDA-10 was recorded complete without them); owned by AIDA-42 and AIDA-43, Phase 10"
human_needed:
  - "Criterion 1: `docker compose up` from a clean clone on a clean machine, app reachable and healthcheck passing"
---

# Phase 1: Foundation Verification Report

**Phase goal:** A running, self-hostable Next.js + Prisma + Postgres (pgvector) + pg-boss app with auth, workspace-scoped data, and `docker compose up`.
**Verified:** 2026-11-12, as an evidence map written in Phase 9 (plan 09-03, decision D-20, AIDA-39). Phase 1 was closed on 2026-07-01 through the 01-08 human gate and `01-UAT.md`, but no verification file was written then.
**Status:** human_needed
**Success criteria source:** `.planning/milestones/v1.0.0-ROADMAP.md`, Phase 1, "Success Criteria" (4 criteria).

## How to read this file

- **historical**: the evidence is a record written at the time (`01-UAT.md` or a Phase 1 SUMMARY). It is cited, not repeated. The commit is the one that recorded it.
- **re-run now**: the command was run again for this file. The commit is `git rev-parse HEAD`, read immediately before that command, and the exit code is the command's own.
- Status words: `passed`, `failed`, `open-human` (needs a person or a clean machine; never marked passed here), `open (no evidence)`.
- "Workspace" in the Phase 1 text is the Better Auth organization in the code; the scoping column is `organizationId`.

## Success criteria

| # | Criterion | Evidence kind | Evidence | Command | Commit | Exit code | Status |
|---|-----------|---------------|----------|---------|--------|-----------|--------|
| 1 | `docker compose up` from a clean clone brings up the app, PostgreSQL with pgvector and a pg-boss worker; the app is reachable and a healthcheck passes | historical | `01-UAT.md` test 1 "Cold Start Smoke Test" (pass) and test 9 "Worker Heartbeat Liveness" (pass, `/api/health` answered `{"status":"ok","db":"connected","worker":{...}}`), recorded 2026-07-01; `01-07-SUMMARY.md` (Dockerfile, compose, Caddyfile, healthchecks); `01-08-SUMMARY.md` "Verification Outcome" (gate approved). The health route's unit tests pass today in R3, but they do not start a stack. | not re-run: a compose stack run is outside Phase 9 (charter rule J and decision U-15: stack proofs wait for the Phase 8.1 harness and the owner; image builds stop at the 20 GiB preflight), and "clean clone on a clean machine" needs a person | 38fa9833fae6a9cb5ce3ccdf68bb184f05e50c08 | n/a | open-human |
| 2 | A user can register or log in; roles `admin` and `agent` exist; an admin can invite and manage users; protected routes are enforced server-side | re-run now | R5 `auth-setup.test.ts`: first-run `/setup` refuses invalid input, creates the admin and workspace, the admin can sign in, a second call is refused (4 of 4 pass). R3 includes `proxy.test.ts`, `proxy-matcher.test.ts` (server-side route guard). Historical: `01-UAT.md` tests 2, 3, 4 and 8 (pass). **Not met:** no invite flow and no user management exist in `src/` (`git grep` for `inviteMember`, `createInvitation`, `listUsers`, `setRole`, `removeMember` finds nothing; no Settings page for members); recorded as finding 1 in `milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md`, and `REQUIREMENTS.md` AIDA-42 states that v1 AIDA-10 "was recorded complete although no invite flow exists". The roles in the code are Better Auth's `owner`, `admin` and `member` (no role is named `agent`). | R5 (and R3) | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | failed |
| 3 | Every domain table carries a workspace id; a data-access helper scopes all queries to the active workspace (verified by a test seeding two workspaces) | re-run now | R5 `workspace-isolation.test.ts` (two organizations on a real Testcontainers Postgres, never mocked: read isolation both ways, `organizationId` injected on create) and `scoped-tx.test.ts` (injection inside an interactive transaction), 4 of 4 pass. R6: all 42 `DOMAIN_MODELS` in `src/lib/scoped-db.ts` have an `organizationId` field in `prisma/schema.prisma`, 0 missing. Historical: `01-03-SUMMARY.md` (AIDA-11 two-workspace test). | R5 (and R6) | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | passed |
| 4 | Prisma schema and migrations are committed; `.env.example` documents required config; `LICENSE` (Apache-2.0) and a skeleton README are present | re-run now | R4: `prisma/schema.prisma`, `.env.example`, `LICENSE` and `README.md` are tracked; 14 committed `migration.sql` files; `LICENSE` is the Apache License, Version 2.0; `.env.example` holds 22 documented settings. R5 applied all 14 migrations to a fresh database. R1 typecheck exit 0. | R4 | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | passed |

**Score:** 2 of 4 passed now (3, 4); 1 open-human (1); 1 failed (2).

## Re-run commands

Run one at a time on 2026-11-12, each to its own log, the exit code read without a pipe. HEAD did not move during the re-run (every command shows the same commit).

| Run | Command | Commit (HEAD before the command) | Exit code | Result |
|-----|---------|----------------------------------|-----------|--------|
| R1 | `pnpm typecheck` | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | `tsc --noEmit` clean |
| R2 | `pnpm lint` | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | 621 files, 0 errors, 1 warning (pre-existing, `tests/unit/container-config.test.ts:160`) |
| R3 | `pnpm test` | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | 80 files, 1454 tests passed |
| R4 | file check, see below | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | all files tracked, 14 migrations, Apache-2.0 |
| R5 | `pnpm test:integration tests/integration/workspace-isolation.test.ts tests/integration/scoped-tx.test.ts tests/integration/auth-setup.test.ts` | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | 3 files, 8 tests passed (Testcontainers Postgres; `colima status` and `docker info` exit 0 first) |
| R6 | domain-model scoping check, see below | 07641006cda1231c4d23e6052bf42d12529bfb70 | 0 | 42 domain models, 0 without `organizationId` |

R5 ran with `AIDA_TEST_RUN_ID` set to the run id of the dispatch, `DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.

R4:

```sh
git ls-files --error-unmatch prisma/schema.prisma .env.example LICENSE README.md \
  && test "$(git ls-files prisma/migrations | grep -c '/migration.sql$')" -gt 0 \
  && grep -q "Apache License" LICENSE && grep -q "Version 2.0" LICENSE \
  && grep -qE "^#? ?DATABASE_URL=|^POSTGRES_PASSWORD=" .env.example
```

R6:

```sh
node -e 'const fs=require("fs");const src=fs.readFileSync("src/lib/scoped-db.ts","utf8");const list=src.slice(src.indexOf("DOMAIN_MODELS = ["),src.indexOf("] as const")).match(/"[A-Za-z]+"/g).map(s=>s.slice(1,-1));const schema=fs.readFileSync("prisma/schema.prisma","utf8");const missing=list.filter(m=>{const b=schema.match(new RegExp("^model "+m+" \\{([\\s\\S]*?)^\\}","m"));return !b||!/^\s+organizationId\s/m.test(b[1]);});console.log("domain models:",list.length,"without organizationId:",missing.length,missing.join(","));process.exit(missing.length?1:0)'
```

## Open for a human

- Criterion 1: on a clean machine, clone the repository, `docker compose up`, and confirm the app is reachable and `/api/health` reports the database and the worker. The 2026-07-01 pass in `01-UAT.md` is historical; the code has changed through Phases 2 to 14 and Phase 8 Part A since then.
- The visual items of `01-UAT.md` (tests 5 and 6: app shell, dark mode) were passed by a person on 2026-07-01 and are not re-judged here.

## Gap (not fixed in Phase 9)

- Criterion 2, invite and user management: owned by AIDA-42 (invitations) and AIDA-43 (list members, change a role, deactivate) in Phase 10. Until then an admin cannot add a second team member in the product.

---
*Phase: 01-foundation*
*Evidence map written: 2026-11-12 (Phase 9, plan 09-03)*
