# syntax=docker/dockerfile:1
#
# Build context: monorepo root
#   docker build -f apps/bot/Dockerfile -t grvt-bot .

FROM node:20-slim

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/bot/package.json        ./apps/bot/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY apps/bot/        ./apps/bot/

RUN pnpm --filter @grvt-grid-bot/shared build
RUN pnpm --filter bot exec prisma generate
RUN pnpm --filter bot build

ENV NODE_ENV=production
EXPOSE 4001

CMD ["node", "apps/bot/dist/main"]
