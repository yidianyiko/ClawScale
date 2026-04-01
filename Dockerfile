FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @clawscale/api db:generate
RUN pnpm --filter @clawscale/api build
RUN pnpm --filter @clawscale/web build

ENV NODE_ENV=production

COPY <<'EOF' /app/start.sh
#!/bin/sh
node /app/packages/api/dist/index.js &
node /app/packages/web/.next/standalone/packages/web/server.js &
wait -n
exit $?
EOF
RUN chmod +x /app/start.sh

EXPOSE 4040 4041
CMD ["/app/start.sh"]
