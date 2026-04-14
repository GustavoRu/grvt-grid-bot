# syntax=docker/dockerfile:1
#
# Build context: monorepo root
#   docker build -f apps/bot/Dockerfile -t grvt-bot .

FROM node:20-alpine AS builder

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/bot/package.json        ./apps/bot/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY apps/bot/        ./apps/bot/

RUN pnpm --filter @grvt-grid-bot/shared build

# Generate Prisma client (linux-musl binary for alpine — stays in node_modules)
RUN pnpm --filter bot exec prisma generate

RUN pnpm --filter bot build


# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Copy everything — node_modules already includes the generated .prisma binary
COPY --from=builder /app/node_modules          ./node_modules
COPY --from=builder /app/packages/shared       ./packages/shared
COPY --from=builder /app/apps/bot/dist         ./apps/bot/dist
COPY --from=builder /app/apps/bot/prisma       ./apps/bot/prisma
COPY --from=builder /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=builder /app/package.json          ./package.json

ENV NODE_ENV=production
EXPOSE 4001

CMD ["node", "apps/bot/dist/main"]
