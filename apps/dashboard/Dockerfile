# syntax=docker/dockerfile:1
#
# Build context: monorepo root
#   docker build -f apps/dashboard/Dockerfile -t grvt-dashboard .

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json           ./packages/shared/package.json
COPY apps/dashboard/package.json            ./apps/dashboard/package.json

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ ./packages/shared/
COPY apps/dashboard/  ./apps/dashboard/

# 1. Build shared types (dashboard imports from @grvt-grid-bot/shared)
RUN pnpm --filter @grvt-grid-bot/shared build

# 2. Build Next.js
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter dashboard build

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static     ./.next/static
COPY --from=builder /app/apps/dashboard/public           ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
