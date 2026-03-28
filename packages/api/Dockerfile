FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
ENV DATABASE_PROVIDER=postgresql
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN pnpm --filter @clawscale/api db:generate
RUN pnpm --filter @clawscale/api build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/node_modules/.prisma ./packages/api/node_modules/.prisma
COPY packages/api/prisma ./packages/api/prisma
EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
