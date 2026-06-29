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
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client first — Prisma 7 does not auto-generate after migrate
RUN pnpm prisma generate
# Build Next.js app → produces .next/standalone (output: "standalone" in next.config.ts)
RUN pnpm build
# Bundle worker into a single self-contained CJS file (Pitfall 4: pnpm symlinks)
# --tsconfig resolves @/ path aliases (→ ./src/*); driver adapters = no native engine binary
# If esbuild cannot bundle @prisma/client (e.g. dynamic requires), add:
#   --external:@prisma/client --external:@prisma/adapter-pg --external:pg
# and COPY those node_modules subpaths + src/generated/prisma into the runner.
RUN pnpm exec esbuild src/lib/worker/index.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --target=node22 \
    --tsconfig=tsconfig.json \
    --outfile=dist/worker.cjs

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

# Worker esbuild bundle (self-contained CJS; reuses node_modules from standalone at runtime)
COPY --from=builder /app/dist ./dist

# Prisma schema directory — needed by the migrate service for prisma migrate deploy
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Default CMD runs the Next.js app; worker service overrides to: node dist/worker.cjs
CMD ["node", "server.js"]
