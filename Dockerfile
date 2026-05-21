FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_COKE_API_URL

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_COKE_API_URL=${NEXT_PUBLIC_COKE_API_URL}

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @clawscale/api db:generate
RUN pnpm run build

ENV NODE_ENV=production

COPY <<'EOF' /app/start.sh
#!/bin/sh
cd /app/packages/api && npx prisma db push --skip-generate && cd /app
HOST=0.0.0.0 PORT=4041 node /app/packages/api/dist/index.js &
API_PID=$!
cd /app/packages/web && npx next start --hostname 0.0.0.0 --port 4040 &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null' EXIT
while kill -0 $API_PID 2>/dev/null && kill -0 $WEB_PID 2>/dev/null; do sleep 1; done
exit 1
EOF
RUN chmod +x /app/start.sh

EXPOSE 4040 4041
CMD ["/app/start.sh"]
