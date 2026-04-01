FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Install dependencies ---
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

# --- Build API ---
FROM base AS build-api
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

# --- Build Web ---
FROM base AS build-web
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4041
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
RUN pnpm --filter @clawscale/web build

# --- Final runner ---
FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install prod deps for API
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile --prod

# Copy API build
COPY --from=build-api /app/packages/api/dist ./packages/api/dist
COPY --from=build-api /app/packages/api/node_modules/.prisma ./packages/api/node_modules/.prisma
COPY packages/api/prisma ./packages/api/prisma

# Copy Web build
COPY --from=build-web /app/packages/web/.next/standalone ./web-standalone
COPY --from=build-web /app/packages/web/.next/static ./web-standalone/packages/web/.next/static
COPY --from=build-web /app/packages/web/public ./web-standalone/packages/web/public

ENV NODE_ENV=production

# Start script runs both servers
COPY <<'EOF' /app/start.sh
#!/bin/sh
node /app/packages/api/dist/index.js &
node /app/web-standalone/packages/web/server.js &
wait -n
exit $?
EOF
RUN chmod +x /app/start.sh

EXPOSE 4040 4041
CMD ["/app/start.sh"]
