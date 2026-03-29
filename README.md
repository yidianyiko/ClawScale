# ClawScale

An open-source, self-hostable multi-tenant AI chatbot platform. Deploy a single bot instance across 12+ messaging platforms — end-users interact with it without needing accounts.

> **OpenClaw was built for one. ClawScale is built for everyone.**

## How ClawScale differs from OpenClaw

[OpenClaw](https://github.com/pulseeditor/openclaw) is a personal AI assistant designed for individual use. ClawScale extends it into an organizational tool:

| | OpenClaw | ClawScale |
|---|---|---|
| **Users** | Single user | Multi-tenant with team accounts and roles |
| **Channels** | Direct CLI / web | 12+ messaging platforms (WhatsApp, Discord, Telegram, etc.) |
| **AI providers** | Built-in engine | Pluggable backends — OpenAI, Anthropic, OpenRouter, OpenClaw, or any OpenAI-compatible endpoint |
| **Memory** | Session-specific | Per-conversation history with per-backend context isolation |
| **Admin controls** | None | Dashboard with RBAC, audit logs, access policies |
| **Knowledge** | Open internet | Custom system prompts and personas per workspace |
| **Deployment** | Local | Self-hosted or managed, handles concurrent users |

ClawScale can use OpenClaw as one of its AI backends — routing messages to an OpenClaw instance via its OpenAI-compatible API.

## Key concepts

### Channels

Channels are **messaging platform integrations** that connect end-users to your bot. Each channel has a dedicated adapter that normalizes incoming messages and delivers replies.

| Channel | Method |
|---|---|
| WhatsApp (Personal) | QR code scan (via Baileys) |
| WhatsApp Business | Meta Cloud API webhook |
| Discord | Bot token (discord.js) |
| Telegram | Bot token (grammy long-polling) |
| Slack | Bot token + App-level token (Socket Mode) |
| LINE | Channel access token + secret (webhook) |
| Signal | signal-cli REST API |
| Microsoft Teams | Azure Bot Service (webhook) |
| Matrix | Homeserver URL + access token |
| WeChat Work (WeCom) | Bot token (WebSocket) |
| WeChat Personal | QR code scan (iLink Bot API) |
| Web Chat Widget | Webhook |
| Instagram | Meta API |
| Facebook | Webhook |

Channels are managed from the dashboard — create one, provide credentials, and hit **Connect**. For WhatsApp and WeChat Personal, a QR code is shown for pairing.

### AI backends

AI backends are **pluggable LLM providers** that generate replies. You can configure multiple backends and let end-users choose between them.

| Type | Description |
|---|---|
| **OpenAI** | GPT models via OpenAI API |
| **Anthropic** | Claude models via Anthropic API |
| **OpenRouter** | Multi-model aggregator |
| **OpenClaw** | External OpenClaw instance (manages its own tools and prompts) |
| **Pulse** | Pulse Editor AI agent |
| **Custom** | Any OpenAI-compatible endpoint |

Each backend has its own system prompt, API key, and model configuration. ClawScale never injects hidden prompts — what you configure is what the LLM sees.

**Multi-backend conversations**: End-users can have multiple backends active at once. Replies are labeled (e.g. `[GPT-4o]`, `[Claude]`) so users know which model responded.

### ClawScale orchestrator

A built-in LangChain agent that helps end-users navigate available backends and execute commands. It can:

- List and describe available AI backends
- Help users add/remove backends from their active "team"
- Execute slash commands on behalf of users
- Fall back to rule-based responses if no LLM is configured

### Slash commands

End-users can run commands directly in chat:

| Command | Description |
|---|---|
| `/backends` | List available AI backends |
| `/team` | Show active backends |
| `/team invite <name>` | Add a backend to the conversation |
| `/team kick <name>` | Remove a backend |
| `/clear` | Delete conversation history |
| `/help` | Show all commands |

Users can also direct a message to a specific backend: `gpt> explain quantum computing`

### Conversations and end-users

- **End-users** are identified by their platform identity (phone number, Discord ID, etc.) — no sign-up required
- **Conversations** are scoped per end-user per channel, with full message history
- **History isolation**: Each backend only sees its own prior replies plus all user messages, preventing cross-contamination between models

### Access control

Workspace admins can control who interacts with the bot:

- **Anonymous** — anyone can chat (default)
- **Whitelist** — only approved external IDs
- **Blacklist** — block specific external IDs

### Tenants and roles

Each workspace (tenant) is isolated. Members have one of three roles:

| Role | Access |
|---|---|
| **Admin** | Full access — channels, backends, settings, members, audit logs |
| **Member** | Manage conversations and workflows |
| **Viewer** | Read-only access to conversations |

Plans: **Starter** (5 members, 3 channels), **Business** (50 members, 20 channels), **Enterprise** (unlimited).

## Architecture

```
End-user (WhatsApp, Discord, etc.)
    |
    v
Channel Adapter ──> POST /gateway/:channelId
    |
    v
Message Router
    ├── Parse commands (/team, /backends, etc.)
    ├── Resolve target backend(s)
    ├── Load conversation history
    ├── Call AI backend(s)
    └── Save messages + return reply
    |
    v
Channel Adapter ──> Reply to end-user
```

## Stack

- **API** — [Hono](https://hono.dev) + [Prisma](https://prisma.io) + PostgreSQL
- **Web** — [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS
- **AI** — OpenAI SDK, Anthropic SDK, LangChain (orchestrator agent)
- **Monorepo** — pnpm workspaces

```
packages/
├── api/       # Hono backend, adapters, AI routing, Prisma schema
├── web/       # Next.js dashboard
└── shared/    # TypeScript types shared between API and web
```

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

API: http://localhost:4041
Dashboard: http://localhost:4040

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
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `CORS_ORIGIN` | Frontend URL (default: `http://localhost:4040`) |
| `PORT` | API port (default: `4041`) |
| `WHATSAPP_AUTH_DIR` | Directory for WhatsApp session files (default: `./data/whatsapp`) |
| `OPENCLAW_BIN` | Path to OpenClaw binary (optional) |
| `OPENCLAW_PORT_BASE` | Dynamic port assignment base (default: `19000`) |
| `OPENCLAW_DATA_DIR` | Per-tenant OpenClaw data directory (default: `./data/tenants`) |

## License

MIT
