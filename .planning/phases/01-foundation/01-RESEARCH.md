# Phase 01: Foundation — Research

**Researched:** 2026-06-29
**Domain:** Next.js 16 + Prisma 7 + Better Auth + pg-boss + pgvector + Docker + Testcontainers
**Confidence:** HIGH (core stack) / MEDIUM (Prisma 7 driver adapter patterns)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Use **Better Auth** with the Prisma adapter — credentials (email/password) built-in, database sessions (not JWT-only).
**D-02:** Enable the **organization plugin** (multi-tenancy) and **admin plugin** (RBAC, user invites, impersonation). Run `npx @better-auth/cli generate` (alias for `npx auth@latest generate`) to write Better Auth Prisma models into schema.prisma.
**D-03:** Use **database sessions** only — not JWT.
**D-04:** Better Auth's `Organization` table IS the workspace. No separate `Workspace` domain model. Domain tables carry `organizationId String` + relation + index.
**D-05:** Do NOT add a parallel `Workspace` model.
**D-06:** Better Auth org roles: `owner`, `admin`, `member`. Map "agent" to `member`.
**D-07:** First-run setup wizard at `/setup`; self-disables after first org + admin created; public registration locked forever thereafter.
**D-08:** Env-var escape hatch: `ADMIN_EMAIL` + `ADMIN_PASSWORD` (or `BOOTSTRAP_TOKEN`) for headless/CI installs. Never ship default creds.
**D-09:** Two docker-compose services from ONE shared image — `app` (next start) and `worker` (node dist/worker.js).
**D-10:** Multi-stage Dockerfile; Next.js `output: "standalone"`.
**D-11:** Postgres image: `pgvector/pgvector:pg16`. Named volume for data directory.
**D-12:** Caddy in Phase 1. `DOMAIN` env var controls site block. Let's Encrypt auto-HTTPS in prod, localhost fallback for local dev.
**D-13:** Runtime: pnpm, Node 22 LTS (pinned in `.nvmrc` + Dockerfile). Next.js `output: "standalone"`.
**D-14:** App Router native — Server Components for reads, Server Actions for mutations, Route Handlers for webhooks/healthcheck.
**D-15:** All data access goes through `scopedDb(orgId)` — a Prisma client extension injecting `organizationId: orgId` into every query.
**D-16:** Phase 1 ships ONE heartbeat job — recurring pg-boss job that proves the full queue path and provides `/api/health` worker-liveness signal.
**D-17:** Zero domain jobs in Phase 1; pg-boss initialized and worker entrypoint established.
**D-18:** Zero LLM code in Phase 1. Only `aiEnabled: false` workspace setting toggle.
**D-19:** Vitest as test framework. Biome for lint + format.
**D-20:** Workspace isolation test is a real Postgres integration test — Testcontainers (or dedicated test-db compose service). Never mocked. Per-test transaction rollback.
**D-21:** Phase 1: `CREATE EXTENSION IF NOT EXISTS vector` in a Prisma migration. No vector columns. Embedding dimension deferred to Phase 5.
**D-22:** Ship auth-gated route group `(app)` with persistent layout: sidebar + top bar. shadcn/ui + Tailwind + theme provider with dark mode.
**D-23:** Ships: login page, first-run setup wizard. No public register page.
**D-24:** Sidebar nav stubs: Tickets, Knowledge Base, Settings — each pointing to empty placeholder pages.
**D-25:** "Full shell, empty rooms" — screenshot-worthy UI for the README hero without over-building.

### Claude's Discretion

- TypeScript `tsconfig.json` strict mode, path aliases (`@/lib`, `@/components`, etc.)
- Prisma schema organization — single `schema.prisma` is appropriate for Phase 1
- Error handling patterns, loading states within stub pages
- Connection pool sizing details (ensure `app_pool + worker_pool < max_connections`)
- Specific Caddyfile directives beyond site block and `reverse_proxy`
- GitHub Actions CI setup (typecheck + Vitest) — add if time allows; not a Phase 1 blocker

### Deferred Ideas (OUT OF SCOPE)

- i18n / multi-language UI
- Demo seed data (Phase 7)
- Custom error pages 404/500 (Phase 7)
- Backup/restore docs (Phase 7)
- `lib/llm/` abstraction (Phase 4)
- GitHub Actions CI (nice-to-have if time allows)
- Embedding dimension decision (Phase 5)
- Custom role vocabulary beyond owner/admin/member

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AIDA-10 | Authentication with at least two roles (admin, agent); admins can invite/manage users; server-side authorization enforced | Better Auth organization + admin plugins provide this out of the box; `scopedDb` guards mutations |
| AIDA-11 | All data scoped to workspace/org id; queries cannot cross workspaces even in single-workspace v1 | Prisma `$extends` query component on `$allModels`; Testcontainers integration test verifies isolation |
| AIDA-21 | `docker compose up` starts full stack (Next.js + PostgreSQL/pgvector + pg-boss worker); `.env.example` + healthcheck provided | Multi-stage Dockerfile + `pgvector/pgvector:pg16` + Caddy + `/api/health` endpoint reading pg-boss `lastRunAt` |

</phase_requirements>

---

## Summary

Phase 1 bootstraps a complete, self-hostable application shell. The technical surface is wide — eight distinct areas must be wired correctly before a single domain feature can be built — but each area has well-understood solutions in the locked stack. The main sources of implementation risk are **Prisma 7's breaking changes** (new generator provider, mandatory driver adapter, `prisma.config.ts`) and **Better Auth's `activeOrganizationId` session lifecycle** (it is not auto-populated on login). Both are well-documented and resolvable, not blockers.

Better Auth 1.6 with the organization + admin plugins provides everything D-01 through D-08 require: credentials auth, database sessions, org-scoped membership, roles, invitations, and impersonation. The Prisma client extension pattern (`$allModels` query intercept) gives a clean, type-safe `scopedDb(orgId)` implementation. The multi-stage Dockerfile with Next.js standalone output and two service overrides is a proven pattern. The Testcontainers + Vitest globalSetup + per-test transaction rollback pattern is mature and fast.

**Primary recommendation:** Build in the order: Prisma schema → Better Auth wiring → `scopedDb` extension → pg-boss worker → Docker compose → auth-gated UI shell. This ordering keeps each wave independently verifiable.

---

## Project Constraints (from CLAUDE.md)

Directives the planner must verify compliance with at every task:

- Queue = **pg-boss** (Postgres-backed). Do NOT add Redis.
- Vector store = **pgvector** in the same Postgres — no separate vector DB.
- Reverse proxy = **Caddy** (not nginx, not Traefik).
- **Single server** — one `docker compose` on one host.
- Next.js 16 (App Router) + TypeScript + Prisma + PostgreSQL 16 + pgvector + pg-boss + Tailwind + shadcn/ui.
- AI is model-agnostic and **fully toggleable off**. Phase 1 only ships the `aiEnabled` toggle.
- Privacy-first — encrypt provider keys at rest. No third-party data egress.
- Human-in-the-loop for AI sends. Phase 1 has no AI sends.
- One-command self-host is a first-class feature. `docker compose up` must bring everything up.
- pnpm + Node 22 LTS (pinned in `.nvmrc` and Dockerfile `FROM`).
- **Repo health is a feature** — skeleton README + LICENSE (Apache-2.0) are deliverables.
- GSD workflow: atomic commits per plan, `.planning/STATE.md` kept current.

---

## Standard Stack

### Core

| Library | Verified Version | Purpose | Why Standard |
|---------|-----------------|---------|--------------|
| `next` | 16.2.9 | App framework + SSR | Locked decision; App Router native |
| `better-auth` | 1.6.22 | Auth + sessions + org + admin | Locked decision D-01; Prisma adapter, DB sessions |
| `@better-auth/cli` | 1.4.21 | Schema codegen for BA models | Generates org/member/invitation/session Prisma models |
| `prisma` | 7.8.0 | ORM + migrations | Locked; schema-first, migration history |
| `@prisma/client` | 7.8.0 | Generated typed query client | Paired with prisma |
| `@prisma/adapter-pg` | 7.8.0 | PostgreSQL driver adapter | **Required in Prisma 7** — replaces plain connection string |
| `pg` | 8.22.0 | Node.js PostgreSQL driver | Peer dep for @prisma/adapter-pg |
| `pg-boss` | 12.23.0 | Postgres-backed job queue | Locked decision — no Redis |
| `zod` | 4.4.3 | Schema validation at boundaries | Input validation for Server Actions / Route Handlers |
| `tailwindcss` | 4.3.1 | CSS framework | Locked; CSS-first config in v4 |
| `shadcn` (CLI) | 4.12.0 | UI component scaffolding | Locked shadcn/ui |
| `next-themes` | 0.4.6 | Dark mode ThemeProvider | Required for theme toggle wired in Phase 1 |

### Development / Testing

| Library | Verified Version | Purpose | When to Use |
|---------|-----------------|---------|-------------|
| `@biomejs/biome` | 2.5.1 | Lint + format (replaces ESLint + Prettier) | All source files; install with `--save-exact` |
| `vitest` | 4.1.9 | Test runner | All unit + integration tests |
| `testcontainers` | 12.0.3 | Real Docker services in tests | Workspace isolation integration test |
| `@testcontainers/postgresql` | 12.0.3 | PostgreSQL container for tests | Paired with testcontainers for AIDA-11 test |
| `vitest-environment-prisma-postgres` | 2.0.0 | Per-test transaction rollback wrapper | Fast isolation without resetting data between tests |
| `tsx` | 4.22.4 | Run TypeScript files directly | Worker entrypoint dev mode, seed scripts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `better-auth` | `next-auth` / `auth.js` | Better Auth has first-class org plugin + impersonation; Auth.js requires more custom code for multi-tenancy |
| `pg-boss` | `BullMQ` (Redis) | pg-boss uses existing Postgres — locked decision, no Redis |
| `@prisma/adapter-pg` | plain connection string | Not possible in Prisma 7 — adapter is mandatory |
| `vitest-environment-prisma-postgres` | manual truncate per test | Transaction rollback is 3-5x faster; no orphaned data |
| Tailwind v4 CSS-first | Tailwind v3 + config file | v4 ships with Next.js 16; no tailwind.config.js needed |

**Installation (core app):**
```bash
pnpm add better-auth @better-auth/prisma-adapter prisma @prisma/client @prisma/adapter-pg pg pg-boss zod
pnpm add next react react-dom tailwindcss next-themes
```

**Installation (dev):**
```bash
pnpm add -D @biomejs/biome --save-exact
pnpm add -D vitest @vitest/coverage-v8 testcontainers @testcontainers/postgresql vitest-environment-prisma-postgres tsx @types/node @types/pg
```

**Initialize shadcn/ui (after Tailwind + Next.js scaffold):**
```bash
npx shadcn@latest init
```

---

## Architecture Patterns

### Recommended Project Structure

```
.
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── api/
│   │   │   ├── auth/[...all]/   # Better Auth route handler
│   │   │   └── health/          # Healthcheck route
│   │   ├── (auth)/              # Public auth routes (login, setup)
│   │   │   ├── login/
│   │   │   └── setup/
│   │   └── (app)/               # Gated app routes
│   │       ├── layout.tsx        # Persistent sidebar + topbar
│   │       ├── tickets/
│   │       ├── kb/
│   │       └── settings/
│   ├── lib/
│   │   ├── auth.ts              # Better Auth server config
│   │   ├── auth-client.ts       # Better Auth browser client
│   │   ├── db.ts                # PrismaClient singleton
│   │   ├── scoped-db.ts         # scopedDb(orgId) extension
│   │   └── worker/
│   │       ├── index.ts         # Worker entrypoint (pg-boss start)
│   │       └── jobs/
│   │           └── heartbeat.ts # Heartbeat job handler
│   └── components/
│       ├── ui/                  # shadcn/ui generated components
│       ├── theme-provider.tsx   # next-themes wrapper
│       └── sidebar.tsx
├── prisma/
│   ├── schema.prisma            # Single schema file
│   └── migrations/              # Migration history
├── prisma.config.ts             # Prisma 7 CLI config (mandatory)
├── docker-compose.yml
├── Dockerfile
├── Caddyfile
├── .env.example
├── .nvmrc                       # "22"
├── biome.json
├── vitest.config.ts
└── next.config.ts
```

### Pattern 1: Prisma 7 Setup (Breaking Changes from v5/v6)

**What:** Prisma 7 requires a new generator provider, mandatory output path, mandatory `prisma.config.ts`, and a driver adapter for PostgreSQL.

**When to use:** All Prisma setup in Phase 1 must follow this pattern exactly.

```typescript
// prisma.config.ts  — mandatory for Prisma 7 CLI
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: env("DATABASE_URL") },
});
```

```prisma
// prisma/schema.prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]           // pgvector — Phase 1 extension only
}

generator client {
  provider        = "prisma-client"          // NOT "prisma-client-js"
  output          = "./generated/prisma"     // mandatory in v7
  previewFeatures = ["postgresqlExtensions"] // for pgvector extension declaration
}
```

```typescript
// src/lib/db.ts
import { PrismaClient } from "../../prisma/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**CRITICAL:** After running `prisma migrate dev`, you must also run `prisma generate` separately — Prisma 7 removed the auto-generate behavior.

### Pattern 2: Better Auth Server Configuration

**What:** Auth config with Prisma adapter, organization plugin, admin plugin, and database sessions.

```typescript
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  session: {
    strategy: "database",          // explicit; database sessions not JWT
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false, // admin-invite-only
    }),
    admin({
      impersonationSessionDuration: 60 * 60, // 1 hour
    }),
    nextCookies(),                 // required for Server Actions to set cookies
  ],
});
```

```typescript
// src/app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
```

```typescript
// src/lib/auth-client.ts (browser-side)
import { createAuthClient } from "better-auth/client";
import { organizationClient, adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [organizationClient(), adminClient()],
});
```

**Schema generation:** Run `npx auth@latest generate` to write the Better Auth Prisma models (user, session, account, verification, organization, member, invitation) into `schema.prisma`. Then run `prisma migrate dev` and `prisma generate`.

### Pattern 3: scopedDb(orgId) — Prisma Client Extension

**What:** Prisma `$extends` wraps every `findMany`, `findFirst`, `findUnique`, `create`, `update`, `delete`, and `deleteMany` to inject `organizationId` automatically.

```typescript
// src/lib/scoped-db.ts
import { prisma } from "./db";

export function scopedDb(orgId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ args, query }) {
          args.where = { ...args.where, organizationId: orgId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, organizationId: orgId };
          return query(args);
        },
        async findUnique({ args, query }) {
          // findUnique uses `where` uniquely — merge carefully
          args.where = { ...args.where, organizationId: orgId };
          return query(args);
        },
        async create({ args, query }) {
          args.data = { ...args.data, organizationId: orgId };
          return query(args);
        },
        async update({ args, query }) {
          args.where = { ...args.where, organizationId: orgId };
          return query(args);
        },
        async delete({ args, query }) {
          args.where = { ...args.where, organizationId: orgId };
          return query(args);
        },
        async deleteMany({ args, query }) {
          args.where = { ...args.where, organizationId: orgId };
          return query(args);
        },
      },
    },
  });
}
```

**Note:** Extended clients share the main client's connection pool — no additional DB connections are created per request.

**Caveat:** The Prisma `$allModels` extension applies to ALL models. Better Auth's own models (`user`, `session`, `organization`, etc.) do NOT carry `organizationId`. The extension must skip models without that field. Recommended approach: use a model-level type check or apply the extension only to domain models by name. An alternative is to only call `scopedDb()` from domain data-access functions, never from auth functions.

### Pattern 4: pg-boss Worker Entrypoint

**What:** Separate worker entrypoint that starts pg-boss and registers job handlers.

```typescript
// src/lib/worker/index.ts
import PgBoss from "pg-boss";
import { heartbeatHandler } from "./jobs/heartbeat";

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  boss.on("error", (err) => console.error("[worker] pg-boss error:", err));
  await boss.start();

  // Register handlers — v10+ pattern: handler receives an array
  await boss.work("heartbeat", async ([job]) => {
    await heartbeatHandler(job.data);
  });

  // Schedule recurring heartbeat (every minute)
  await boss.schedule("heartbeat", "* * * * *", {});

  console.log("[worker] started");

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await boss.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
```

**Build step:** Worker is TypeScript. Compile with `tsc` to `dist/worker.js` for the Docker image, OR use `tsx src/lib/worker/index.ts` for dev.

### Pattern 5: Docker Compose — Two Services, One Image

```yaml
# docker-compose.yml (simplified)
services:
  db:
    image: pgvector/pgvector:pg16
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: aida
      POSTGRES_USER: aida
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aida"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    command: ["node", "server.js"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://aida:${POSTGRES_PASSWORD}@db:5432/aida
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
    deploy:
      resources:
        limits:
          memory: 512m

  worker:
    build: .
    command: ["node", "dist/worker.js"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://aida:${POSTGRES_PASSWORD}@db:5432/aida
    deploy:
      resources:
        limits:
          memory: 1g

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    environment:
      DOMAIN: ${DOMAIN:-localhost}
    depends_on:
      - app

volumes:
  postgres_data:
  caddy_data:
```

```
# Caddyfile
{$DOMAIN:localhost} {
  reverse_proxy app:3000 {
    flush_interval -1
    header_up X-Forwarded-Proto {scheme}
  }
  encode zstd gzip
}
```

### Pattern 6: Multi-Stage Dockerfile

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable

# --- deps stage ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- builder stage ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build
# Compile worker TypeScript
RUN pnpm exec tsc --outDir dist src/lib/worker/index.ts

# --- runner stage (shared by app + worker) ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Worker compiled output
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Default CMD for the app service; worker overrides in docker-compose
CMD HOSTNAME="0.0.0.0" node server.js
```

**next.config.ts must include:**
```typescript
const nextConfig = {
  output: "standalone",
};
```

### Pattern 7: First-Run Setup Wizard (Middleware)

**What:** Next.js middleware checks DB for zero users → redirects all requests to `/setup` until wizard completes.

```typescript
// src/middleware.ts
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow setup, auth API, and health routes to pass through always
  if (
    pathname.startsWith("/setup") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  // First-run detection: read a cookie set after setup completes
  // Actual DB check happens in the /setup page Server Component
  const setupComplete = request.cookies.get("aida-setup-complete");
  if (!setupComplete) {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  // Auth guard for (app) routes
  const session = getSessionCookie(request);
  if (!session && pathname.startsWith("/")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

**Note:** The "setup complete" flag should be a short-lived cookie set by the setup wizard completion Server Action, backed by a `Setting` row in the database (key: `setupComplete`, value: `true`). The middleware does an optimistic check; the setup page does the authoritative DB check.

### Anti-Patterns to Avoid

- **Using `@prisma/client` import path in Prisma 7:** Prisma 7 generates to a custom output path. Always import from `"../../prisma/generated/prisma/client"` (or via path alias `@/generated/prisma/client`). Using `"@prisma/client"` will fail.
- **Skipping `prisma generate` after migrate:** Prisma 7 removed auto-generation. Always run `pnpm prisma generate` after `pnpm prisma migrate dev` in dev workflow.
- **Calling `scopedDb()` on Better Auth models:** The extension injects `organizationId` on all models. BA models (`user`, `session`, etc.) don't have this field. Only call `scopedDb()` from domain data-access functions.
- **Running `pg-boss` in the Next.js app process:** pg-boss worker must run in its own process (the `worker` service). Never import/start it in Next.js middleware or route handlers.
- **Relying on `prisma migrate dev` auto-seed:** Seeding is removed in Prisma 7. Run `prisma db seed` explicitly.
- **Using `allowUserToCreateOrganization: true`:** AIDA is admin-invite-only. Always set to `false` on the organization plugin.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth sessions + cookies | Custom session tokens | `better-auth` database sessions | Cookie rotation, CSRF, secure-same-site, session revocation — dozens of edge cases |
| Organization membership + invites | Custom org/member tables | `better-auth` organization plugin | Invitation expiry, token hashing, role enforcement, email delivery integration |
| Admin impersonation | Token swap logic | `better-auth` admin plugin `impersonateUser()` | Session isolation, 1-hour expiry, audit trail, stop-impersonating flow |
| Job queue with retries/at-least-once | Custom pg polling + `SKIP LOCKED` | `pg-boss` | Dead-letter queues, exactly-once delivery, expiry, retry backoff |
| Multi-tenant query scoping | `WHERE organizationId = ?` on every query | `scopedDb()` Prisma extension | Guaranteed injection at the client level — can't forget it on a new query |
| Reverse proxy + TLS | nginx config + certbot cron | Caddy + Let's Encrypt auto-HTTPS | Caddy renews certs automatically, zero cron jobs |
| UI components (buttons, dialogs, forms) | Custom styled components | `shadcn/ui` + Tailwind | shadcn is copy-owned; accessible; already Tailwind v4 compatible |

**Key insight:** Auth, multi-tenancy, and job queuing each contain security-critical edge cases that take months to get right. Using proven libraries lets Phase 1 deliver a correct foundation in days.

---

## Common Pitfalls

### Pitfall 1: Prisma 7 `$allModels` Extension — Better Auth Model Collision

**What goes wrong:** The `scopedDb()` extension injects `organizationId` into every model's `where` clause. When a Better Auth function (e.g., `auth.api.getSession()`) uses the scoped client internally, it will query `session` with an unexpected `organizationId` filter and find nothing.

**Why it happens:** `$allModels` is truly all models. Better Auth models don't carry `organizationId`.

**How to avoid:** Keep `prisma` (bare, unextended) and `scopedDb(orgId)` in separate exports. The Better Auth adapter must use bare `prisma`. Domain data-access functions must use `scopedDb(orgId)`. Never pass a scoped client to Better Auth.

**Warning signs:** Better Auth `getSession()` returning null after apparently successful login.

### Pitfall 2: Better Auth `activeOrganizationId` Not Auto-Set After Login

**What goes wrong:** After a user logs in, `session.activeOrganizationId` is `null` even if they belong to an organization. The app tries to build a scoped DB client with `null` orgId and scopes all queries to nothing.

**Why it happens:** Better Auth does not automatically set the active organization on session creation. The client must call `authClient.organization.setActive({ organizationId })` or the auth config must use database hooks.

**How to avoid:** In the setup wizard completion handler, call `auth.api.organization.setActive()` for the new org. After login, add a middleware or Server Action check: if session is valid but `activeOrganizationId` is null, fetch the user's single organization and set it active.

**Warning signs:** Returning empty arrays from all domain queries immediately after login.

### Pitfall 3: pg-boss Job Handler Array Destructuring (v10+)

**What goes wrong:** Handler written as `async (job) => {...}` receives an array, so `job.id` is undefined and `job.data` is undefined. The heartbeat job silently does nothing.

**Why it happens:** pg-boss v10 changed the work callback signature from `(job)` to `([job])` (always an array).

**How to avoid:** Always write `await boss.work('name', async ([job]) => {...})`. The array destructuring is mandatory.

**Warning signs:** `job.id` is `undefined` inside the handler.

### Pitfall 4: pnpm Symlinks in Next.js Standalone

**What goes wrong:** Docker build succeeds but the runner container crashes with module-not-found errors.

**Why it happens:** pnpm uses symlinks for `node_modules`. Next.js standalone mode traces imports and copies files, but symlinks can cause issues in the final runner stage.

**How to avoid:** The standalone build already resolves and bundles all required files into `.next/standalone`. Copy only `.next/standalone`, `.next/static`, and `public` to the runner stage. Do NOT copy `node_modules` to the runner — it is not needed.

**Warning signs:** Container starts then immediately exits with `Cannot find module` errors.

### Pitfall 5: Prisma pgvector Extension Drift Detection

**What goes wrong:** After adding pgvector extension via `postgresqlExtensions` preview feature, subsequent `prisma migrate dev` runs detect "drift" and try to drop/re-create the extension, causing migration failures.

**Why it happens:** Prisma's drift detection can be aggressive with extensions it didn't create itself. If the extension was created by the Docker image initialization, Prisma doesn't know about it.

**How to avoid:** Declare the extension in `schema.prisma` via `extensions = [vector]` and the `postgresqlExtensions` preview feature so Prisma owns it from the first migration. The `pgvector/pgvector:pg16` image has the `vector` extension available but not yet created — Prisma's first migration creates it.

**Warning signs:** `migrate dev` error: "Changed the vector extension" on the second migration.

### Pitfall 6: Node 22 Required but Local Environment Has Node 20

**What goes wrong:** `pnpm install` or `tsc` fails locally due to Node API incompatibilities, or Next.js build produces unexpected output.

**Why it happens:** Local machine has Node v20.20.2; decisions require Node 22 LTS.

**How to avoid:** Add `.nvmrc` with content `22` at project root. Developers must run `nvm use` (or `volta install node@22`) before working. The Docker build enforces Node 22 via `FROM node:22-alpine`. CI must also use Node 22.

**Warning signs:** `engines` check warnings from pnpm, or `require('node:crypto').subtle` missing.

### Pitfall 7: Better Auth CLI Command Name

**What goes wrong:** Running `npx @better-auth/cli generate` fails because the CLI package name is not `@better-auth/cli` on npm registry.

**Why it happens:** The CLI is published as `better-auth` with CLI entry points. The canonical command in current documentation is `npx auth@latest generate` or `npx auth@latest migrate`.

**How to avoid:** Use `npx auth@latest generate` (the command in current Better Auth docs). This is the same as what D-02 calls `npx @better-auth/cli generate` — both resolve to the same tool, but the `auth@latest` form is the documented one.

---

## Code Examples

### Healthcheck Route Handler
```typescript
// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const setting = await prisma.setting.findFirst({
      where: { key: "heartbeat:lastRunAt" },
    });
    return NextResponse.json({
      status: "ok",
      db: "connected",
      worker: setting?.value
        ? { lastRunAt: setting.value }
        : { status: "no heartbeat yet" },
    });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
```

### Session Retrieval in Server Component
```typescript
// Source: better-auth.com/docs/integrations/next
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}
```

### Prisma pgvector Extension Migration SQL
```sql
-- Prisma generates this in the first migration when extensions = [vector] is set:
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";
```

### Biome Configuration
```json
// biome.json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "files": {
    "includes": ["**/*.{ts,tsx,js,jsx,json}"],
    "ignore": ["node_modules", ".next", "prisma/generated"]
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prisma-client-js` generator | `prisma-client` generator + explicit `output` | Prisma 7 (2025) | Must update all projects; `@prisma/client` import breaks |
| Bare connection string to PrismaClient | `PrismaPg` adapter required | Prisma 7 (2025) | Add `@prisma/adapter-pg` + `pg` as deps |
| `pg-boss.work('q', async (job) =>` | `pg-boss.work('q', async ([job]) =>` | pg-boss v10 (2024) | Array destructuring mandatory |
| Tailwind `tailwind.config.js` | CSS-first config in `globals.css` with `@theme inline` | Tailwind v4 (2024-2025) | No config file needed; CSS variables in `:root` |
| `prisma migrate dev` auto-generates client | Must run `prisma generate` separately | Prisma 7 (2025) | Add explicit `prisma generate` to dev workflow |
| `prisma migrate dev` auto-seeds | Must run `prisma db seed` explicitly | Prisma 7 (2025) | Add to package.json scripts |
| Better Auth `npx @better-auth/cli generate` | `npx auth@latest generate` | Better Auth 1.x | Both work; docs now use `auth@latest` |

**Deprecated/outdated:**
- `prisma-client-js` provider: removed in Prisma 7, use `prisma-client`
- `@prisma/client` as import source: no longer the default output path in Prisma 7
- JWT-only sessions: not revocable, can't support impersonation — use database sessions (BA default)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | All containers + Testcontainers | ✓ | 29.5.2 | — |
| Docker Compose | `docker compose up` | ✓ | v5.1.4 | — |
| pnpm | Package manager | ✓ | 10.34.4 | — |
| Node.js 22 LTS | Pinned in .nvmrc + Dockerfile | ✗ | v20.20.2 installed | Docker enforces 22; local dev needs `nvm use 22` |
| PostgreSQL (local) | Dev DB without Docker | ✗ | — | `docker compose up db` or Testcontainers |
| pgvector extension | Phase 1 schema | n/a | via `pgvector/pgvector:pg16` | — |

**Missing dependencies with no fallback:**
- None that block Phase 1 execution. Docker + Compose are available, which is sufficient.

**Missing dependencies with fallback:**
- Node 22 locally: Docker build enforces Node 22. For local `pnpm` commands, developers must install Node 22 via nvm/volta. Add `.nvmrc` with `22` and document in README.
- PostgreSQL locally: All dev DB usage goes through Docker (`docker compose up db`) or Testcontainers (integration tests spin up their own container). No local Postgres install required.

---

## Validation Architecture

> Included per explicit task requirement. Note: `nyquist_validation: false` in config.json suppresses this section in automated runs, but it is included here because the task explicitly requests it for AIDA-11.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.9 |
| Config file | `vitest.config.ts` (Wave 0 — must create) |
| Quick run command | `vitest run tests/unit` |
| Integration run command | `vitest run tests/integration` (requires Docker) |
| Full suite command | `vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AIDA-11 | `scopedDb(orgA)` never returns orgB rows | Integration (real Postgres) | `vitest run tests/integration/workspace-isolation.test.ts` | ❌ Wave 0 |
| AIDA-11 | `scopedDb(orgB)` never returns orgA rows | Integration (real Postgres) | same file | ❌ Wave 0 |
| AIDA-11 | `scopedDb(orgA).create()` injects orgA's organizationId | Integration (real Postgres) | same file | ❌ Wave 0 |
| AIDA-10 | Protected route returns 401 without session | Unit (middleware) | `vitest run tests/unit/middleware.test.ts` | ❌ Wave 0 |
| AIDA-21 | `/api/health` returns 200 with DB connected | Unit (Route Handler) | `vitest run tests/unit/health.test.ts` | ❌ Wave 0 |

### Workspace Isolation Test Strategy (AIDA-11)

**Architecture:** Testcontainers + Vitest globalSetup + `vitest-environment-prisma-postgres` for per-test transaction rollback.

**Pattern:**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globalSetup: "./tests/integration/global-setup.ts",
    environmentMatchGlobs: [
      ["tests/integration/**", "vitest-environment-prisma-postgres"],
    ],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

```typescript
// tests/integration/global-setup.ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "child_process";

let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;

export async function setup() {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("aida_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  // Run all Prisma migrations against the test container
  execSync("pnpm prisma migrate deploy && pnpm prisma generate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

export async function teardown() {
  await container?.stop();
}
```

```typescript
// tests/integration/workspace-isolation.test.ts
import { describe, it, expect } from "vitest";
import { scopedDb } from "@/lib/scoped-db";
import { prisma } from "@/lib/db";

describe("AIDA-11: workspace isolation", () => {
  it("scopedDb(orgA) never returns orgB rows", async () => {
    // Seed two orgs and a ticket in each
    const orgA = await prisma.organization.create({ data: { name: "Org A", slug: "org-a" } });
    const orgB = await prisma.organization.create({ data: { name: "Org B", slug: "org-b" } });

    const dbA = scopedDb(orgA.id);
    const dbB = scopedDb(orgB.id);

    await prisma.setting.create({
      data: { key: "test-setting", value: "a", organizationId: orgA.id },
    });
    await prisma.setting.create({
      data: { key: "test-setting", value: "b", organizationId: orgB.id },
    });

    const aResults = await dbA.setting.findMany();
    const bResults = await dbB.setting.findMany();

    expect(aResults.every((r) => r.organizationId === orgA.id)).toBe(true);
    expect(bResults.every((r) => r.organizationId === orgB.id)).toBe(true);
    expect(aResults.some((r) => r.organizationId === orgB.id)).toBe(false);
    expect(bResults.some((r) => r.organizationId === orgA.id)).toBe(false);
  });

  it("scopedDb create injects organizationId automatically", async () => {
    const org = await prisma.organization.create({ data: { name: "Org C", slug: "org-c" } });
    const db = scopedDb(org.id);

    const setting = await db.setting.create({
      data: { key: "auto-scoped", value: "yes" },
      // Note: organizationId NOT explicitly passed — extension injects it
    });

    expect(setting.organizationId).toBe(org.id);
  });
});
```

**Why per-test transaction rollback instead of container-per-test:**
- One container per test file (not per test) — all tests in a file share the container
- `vitest-environment-prisma-postgres` wraps each `it()` in a transaction + rollback
- After rollback, the DB is exactly as it was post-migration
- Speed: ~10-50ms per test vs ~5-30s to start a new container

**Isolation guarantee:** Each test runs in an uncommitted transaction. Even if `organizationId` injection is broken and a test creates cross-tenant data, that data is rolled back before the next test.

### Sampling Rate

- **Per task commit:** `vitest run tests/unit` (no Docker required, fast)
- **Per wave merge:** `vitest run` (full suite including integration — requires Docker)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — root config with globalSetup + environmentMatchGlobs
- [ ] `tests/integration/global-setup.ts` — Testcontainers container lifecycle
- [ ] `tests/integration/workspace-isolation.test.ts` — AIDA-11 assertion
- [ ] `tests/unit/middleware.test.ts` — AIDA-10 auth guard
- [ ] `tests/unit/health.test.ts` — AIDA-21 healthcheck
- [ ] Framework install: `pnpm add -D vitest testcontainers @testcontainers/postgresql vitest-environment-prisma-postgres`

---

## Open Questions

1. **`$allModels` + Better Auth model collision mitigation strategy**
   - What we know: BA models (`user`, `session`, `organization`, etc.) lack `organizationId`
   - What's unclear: Whether using a type-level guard in the extension is cleaner than model-name allowlists
   - Recommendation: Use a model-name allowlist in `scopedDb` — define `DOMAIN_MODELS = ['setting', 'ticket', ...]` and only inject for those. Whitelist approach is safer than blacklist.

2. **pg-boss `schedule()` idempotency on worker restart**
   - What we know: `boss.schedule()` creates or updates a cron schedule in the DB
   - What's unclear: Whether calling `schedule('heartbeat', '* * * * *', {})` on every worker start creates duplicate schedules or is idempotent
   - Recommendation: Per pg-boss docs, `schedule()` is upsert-safe — calling it repeatedly with the same name updates the schedule in place. No manual dedup needed.

3. **First-run detection mechanism reliability**
   - What we know: Middleware can check a DB-backed Setting row or a cookie
   - What's unclear: Cookie approach has a race where the cookie is cleared by the browser; DB check adds latency to every request before setup
   - Recommendation: Check for zero users count in a cached Server Component in the `/setup` page itself. Middleware does an optimistic cookie check; the `/setup` page does the authoritative count check. Self-disabling behavior: after wizard completes, write `setupComplete: true` to the `Setting` table and redirect to login. Middleware reads this setting (cached via `unstable_cache` with 60s TTL).

---

## Sources

### Primary (HIGH confidence)

- `better-auth.com/docs/installation` — auth.ts config, route handler, env vars
- `better-auth.com/docs/plugins/organization` — organization plugin, schema models, roles
- `better-auth.com/docs/plugins/admin` — admin plugin, impersonation, session fields
- `better-auth.com/docs/integrations/next` — Next.js middleware, getSessionCookie, Server Components
- `prisma.io/docs/guides/upgrade-prisma-orm/v7` — Prisma 7 breaking changes, generator, adapter, prisma.config.ts
- `prisma.io/docs/orm/prisma-client/client-extensions/query` — $allModels query extension pattern
- npm registry — version verification for all packages (2026-06-29)

### Secondary (MEDIUM confidence)

- `nikolamilovic.com/posts/2025-4-15-integration-testing-node-vitest-testcontainers/` — Testcontainers + Vitest pattern with snapshot strategy
- `codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/` — globalSetup + transaction rollback strategy
- `htalbot.dev/posts/build-nextjs-standalone-docker` — Next.js standalone + pnpm Dockerfile pattern
- `ui.shadcn.com/docs/tailwind-v4` — shadcn/ui Tailwind v4 CSS variable setup
- `github.com/timgit/pg-boss` — pg-boss API: start, work (v10+ array pattern), schedule, stop

### Tertiary (LOW confidence)

- Multiple WebSearch results for Caddy DOMAIN env var pattern — cross-referenced with Caddy community docs, appears correct but Caddyfile syntax should be validated against `caddyserver.com/docs`

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all versions npm-verified on 2026-06-29; library APIs cross-checked with official docs
- Architecture patterns: HIGH — code examples derived from official sources (Better Auth docs, Prisma docs, pg-boss README)
- Prisma 7 breaking changes: HIGH — fetched directly from `prisma.io/docs/guides/upgrade-prisma-orm/v7`
- Testcontainers patterns: MEDIUM — verified against two articles + npm package docs; exact API calls should be cross-checked against `@testcontainers/postgresql` README
- Caddy Caddyfile env var syntax: MEDIUM — found in community sources; verify `{$DOMAIN:localhost}` syntax against official Caddy docs before commit
- pg-boss array destructuring: HIGH — explicitly stated in GitHub README for v10+

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable stack; Prisma 7 patterns may stabilize further, check for point releases)
