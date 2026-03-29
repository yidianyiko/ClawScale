# ClawScale

An open-source, self-hostable multi-tenant AI chatbot platform. Owners deploy a single bot instance across multiple messaging platforms — users interact with it without needing accounts.

## How it works

- **Owner** configures the bot persona, workflows, and access policies via a web dashboard
- **Users** chat with the bot on WhatsApp, Discord, WeChat, and more — no sign-up required
- **AI** responds using OpenAI with the owner-defined system prompt and conversation history

## Supported channels

| Channel | Method |
|---|---|
| WhatsApp (Personal) | QR code scan (via Baileys) |
| WhatsApp Business | Meta Cloud API webhook |
| Discord | Bot token (discord.js) |
| WeChat Work (WeCom) | Bot token (WebSocket) |
| WeChat Personal | QR code scan (iLink Bot API) |
| Telegram | Bot token (grammy long-polling) |
| Slack | Bot token + App-level token (Socket Mode) |
| LINE | Channel access token + secret (webhook) |
| Signal | signal-cli REST API |
| Microsoft Teams | Azure Bot Service (webhook) |
| Matrix | Homeserver URL + access token |
| Web Chat Widget | Webhook |

## Stack

- **API** — [Hono](https://hono.dev) + [Prisma](https://prisma.io) + PostgreSQL
- **Web** — [Next.js](https://nextjs.org) + Tailwind CSS
- **AI** — OpenAI (configurable model)
- **Monorepo** — pnpm workspaces

## Getting started

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for PostgreSQL)

### Local development

```bash
# 1. Start Postgres
docker compose up postgres -d

# 2. Configure environment
cp .env.example .env
# Edit .env — defaults work for local dev

# 3. Install dependencies
pnpm install

# 4. Push database schema
cd packages/api && pnpm db:push && cd ../..

# 5. Start API and web (separate terminals)
cd packages/api && pnpm dev
cd packages/web && pnpm dev
```

API → http://localhost:4041
Web → http://localhost:4040

### Docker (all-in-one)

```bash
cp .env.example .env
docker compose up --build
```

### First run

Open http://localhost:4040 and **Register** to create your workspace. You are automatically the admin.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing auth tokens |
| `OPENAI_API_KEY` | OpenAI API key |
| `CORS_ORIGIN` | Frontend URL (default: `http://localhost:4040`) |
| `PORT` | API port (default: `4041`) |
| `WHATSAPP_AUTH_DIR` | Directory for WhatsApp session files (default: `./data/whatsapp`) |

## License

MIT
