# ---- Stage 1: base ----
# Shared base with Node 22 + corepack/pnpm (D-13)
FROM node:22-alpine AS base
RUN corepack enable

# ---- Stage 2: deps ----
# Install all dependencies into a clean layer for layer caching
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Stage 3: builder ----
# Generate Prisma client, build Next.js standalone, bundle worker with esbuild (D-10)
FROM base AS builder
WORKDIR /app
# prisma.config.ts uses env("DATABASE_URL") which throws at module load time even for
# `prisma generate` (which doesn't connect to a DB). Provide a placeholder so the
# CLI loads correctly; the real URL comes from compose at runtime.
ARG DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ENV DATABASE_URL=${DATABASE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client first — Prisma 7 does not auto-generate after migrate
RUN pnpm prisma generate
# Build Next.js app → produces .next/standalone (output: "standalone" in next.config.ts)
RUN pnpm build
# Bundle worker into an ESM file.
# --format=esm: Prisma generated client uses import.meta.url (ESM-only; undefined in CJS → crash).
# --banner:js createRequire: bundled CJS deps (mailparser→@zone-eu/mailsplit, nodemailer, imapflow)
#   call require('stream')/other builtins at module load; esbuild's ESM __require shim throws
#   "Dynamic require of X is not supported" unless a real top-level `require` exists for it to
#   delegate to. The banner provides one via node:module's createRequire.
# --external:pg: traced into standalone/node_modules by Next.js NFT.
# --external:@prisma/client: runtime/client.js uses require('node:path') which esbuild's __require2
#   shim cannot resolve in ESM bundles; must stay external and be copied explicitly to runner.
# @prisma/adapter-pg and pg-boss (+ pure-JS deps) bundle cleanly.
# Physically copy @prisma/client to /tmp to resolve pnpm symlinks before COPY --from.
RUN pnpm exec esbuild src/lib/worker/index.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node22 \
    --tsconfig=tsconfig.json \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
    --external:pg \
    --external:@prisma/client \
    --outfile=dist/worker.mjs && \
    PRISMA_STORE=$(find /app/node_modules/.pnpm -maxdepth 1 -type d -name "@prisma+client@7.8.0*" | head -1) && \
    cp -rL "${PRISMA_STORE}/node_modules/@prisma" /tmp/prisma-scope

# ---- Stage 4: runner ----
# Minimal production image shared by app (node server.js) and worker (node dist/worker.cjs)
# Docker Compose overrides CMD per service — same image, different start command (D-09)
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone: self-contained app server + traced node_modules (no symlinks, real files)
# This includes @prisma/client, @prisma/adapter-pg, pg (all traced from src/lib/db.ts)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Worker ESM bundle; reuses pg from standalone node_modules at runtime
COPY --from=builder /app/dist ./dist

# @prisma/client is external in the worker bundle (its CJS runtime uses require('node:path') which
# esbuild's __require2 shim can't resolve in ESM bundles). Copy the entire @prisma scope so that
# @prisma/client-runtime-utils and any other intra-scope transitive deps are available at runtime.
# cp -rL in builder stage dereferences pnpm symlinks → plain files, no .pnpm virtual store needed.
COPY --from=builder /tmp/prisma-scope ./node_modules/@prisma

# Prisma schema directory — needed by the migrate service for prisma migrate deploy
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Default CMD runs the Next.js app; worker service overrides to: node dist/worker.cjs
CMD ["node", "server.js"]
