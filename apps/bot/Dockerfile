# syntax=docker/dockerfile:1
#
# Build context: monorepo root
#   docker build -f apps/bot/Dockerfile -t grvt-bot .

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

# 1. Compile shared types library
RUN pnpm --filter @grvt-grid-bot/shared build

# 2. Generate Prisma client (targets linux-musl for alpine)
RUN pnpm --filter bot exec prisma generate

# 3. Compile NestJS → dist/
RUN pnpm --filter bot build


# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Copy workspace manifests for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/bot/package.json        ./apps/bot/package.json

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled shared + bot
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/bot/dist        ./apps/bot/dist
COPY --from=builder /app/apps/bot/prisma      ./apps/bot/prisma

# Regenerate Prisma client for production (uses linux-musl binary)
RUN pnpm --filter bot exec prisma generate

ENV NODE_ENV=production
EXPOSE 4001

CMD ["node", "apps/bot/dist/main"]
