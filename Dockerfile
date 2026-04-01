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

# --- Build everything ---
FROM base AS build
WORKDIR /app
ENV DATABASE_PROVIDER=postgresql
ARG NEXT_PUBLIC_API_URL=http://localhost:4041
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @clawscale/api db:generate
RUN pnpm --filter @clawscale/api build
RUN pnpm --filter @clawscale/web build

# --- Final runner ---
FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install prod deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile --prod

# Copy API build
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/node_modules/.prisma ./packages/api/node_modules/.prisma
COPY packages/api/prisma ./packages/api/prisma

# Copy Web build
COPY --from=build /app/packages/web/.next/standalone ./web-standalone
COPY --from=build /app/packages/web/.next/static ./web-standalone/packages/web/.next/static
COPY --from=build /app/packages/web/public ./web-standalone/packages/web/public

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
