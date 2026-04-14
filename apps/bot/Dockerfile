# syntax=docker/dockerfile:1
#
# Build context: monorepo root
#   docker build -f apps/bot/Dockerfile -t grvt-bot .
#
# Local dev is unchanged — just run `pnpm dev` or `pnpm bot` from the repo root.

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Copy workspace manifests first (maximises layer cache on dep changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/bot/package.json        ./apps/bot/package.json

# Install all deps (devDeps needed for tsc + nest build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ ./packages/shared/
COPY apps/bot/        ./apps/bot/

# 1. Compile shared types library (bot imports from @grvt-grid-bot/shared)
RUN pnpm --filter @grvt-grid-bot/shared build

# 2. Generate Prisma client
RUN pnpm --filter bot exec prisma generate

# 3. Compile NestJS → dist/
RUN pnpm --filter bot build

# 4. Create a self-contained production layout (resolves workspace symlinks,
#    installs only production deps, output goes to /standalone)
RUN pnpm deploy --filter bot --prod /standalone --legacy

# 5. Copy generated Prisma client into standalone (pnpm deploy excludes it)
RUN cp -r /app/node_modules/.prisma /standalone/node_modules/.prisma


# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Self-contained node_modules from pnpm deploy (includes @grvt-grid-bot/shared)
COPY --from=builder /standalone ./

# Compiled app
COPY --from=builder /app/apps/bot/dist ./dist

# Prisma schema + migrations (needed for `prisma migrate deploy` at startup)
COPY --from=builder /app/apps/bot/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 4001

CMD ["node", "dist/main"]
