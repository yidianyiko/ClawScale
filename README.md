<p align="center">
  <img src="https://clawscale.org/logo.png" alt="ClawScale" width="200" />
</p>

<h1 align="center">ClawScale</h1>
<p align="center"><strong>Connect your AI agents to any messaging platform</strong></p>
<p align="center">English | <a href="README.zh-CN.md">中文</a></p>

ClawScale is an open-source gateway that connects AI agents — OpenClaw, Claude Code, LLMs, or any custom agent — to WhatsApp, Discord, Slack, Telegram, and 10+ other messaging platforms. It handles multi-tenant isolation, conversation routing, and backend orchestration so hundreds of users can talk to your agents without interfering with each other.

## What can you do with ClawScale?

- **Deploy AI agents to messaging platforms** — connect any LLM or AI agent to WhatsApp, Discord, Slack, Telegram, Teams, and more from a single dashboard
- **Support many users at once** — each user gets isolated conversations, memory, and state. No cross-contamination between users
- **Mix and match AI backends** — run OpenClaw, GPT, Claude, self-hosted models, or all of them at once. Users can talk to multiple agents in the same chat
- **Manage everything from a dashboard** — channels, backends, users, roles, and audit logs in one place

## Supported channels

| Channel | Connection method |
|---|---|
| WhatsApp (Personal) | QR code scan |
| WhatsApp Business | Meta Cloud API webhook |
| Discord | Bot token |
| Telegram | Bot token |
| Slack | Bot token (Socket Mode) |
| LINE | Channel access token (webhook) |
| Signal | signal-cli REST API |
| Microsoft Teams | Azure Bot Service (webhook) |
| Matrix | Homeserver URL + access token |
| WeChat Work (WeCom) | Bot token (WebSocket) |
| WeChat Personal | QR code scan |
| Web Chat Widget | Webhook |
| Instagram | Meta API |
| Facebook | Webhook |

Add channels from the dashboard — provide credentials and hit **Connect**. WhatsApp and WeChat Personal show a QR code for pairing.

## Supported AI backends

ClawScale doesn't lock you into one AI provider. Connect any combination of these:

| Backend | Description |
|---|---|
| **OpenClaw** | One or more OpenClaw instances with their own tools, memory, and prompts |
| **OpenAI** | GPT models via OpenAI API |
| **Anthropic** | Claude models via Anthropic API |
| **OpenRouter** | Access hundreds of models through one API key |
| **Pulse** | Pulse Editor AI agent |
| **Custom** | Any OpenAI-compatible endpoint (vLLM, Ollama, self-hosted models, etc.) |

Users can have multiple backends active at once. Replies are labeled by source (e.g. `[GPT-4o]`, `[Claude]`) so users know which agent is responding.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for PostgreSQL)

### Quick start

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

- **Dashboard**: http://localhost:4040
- **API**: http://localhost:4041

Or run everything with Docker:

```bash
cp .env.example .env
docker compose up --build
```

Open the dashboard and **Register** to create your workspace. You're the admin.

## How it works

```
End-user (WhatsApp, Discord, Slack, etc.)
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

1. A user sends a message on any connected platform
2. The channel adapter normalizes the message and forwards it to ClawScale
3. ClawScale routes the message to the right AI backend(s), keeping each user's conversation history isolated
4. The AI response is sent back through the same channel

## Chat commands

End-users can run commands directly in chat to manage their experience:

| Command | What it does |
|---|---|
| `/backends` | List available AI backends |
| `/team` | Show which backends are active |
| `/team invite <name>` | Add a backend to the conversation |
| `/team kick <name>` | Remove a backend |
| `/clear` | Delete conversation history |
| `/help` | Show all commands |

To message a specific backend: `gpt> explain quantum computing`

## Multi-tenant isolation

ClawScale is designed for multi-user deployments. Every user's conversations, memory, and state are fully isolated — data never crosses boundaries.

**Access control** — workspace admins decide who can interact with the bot:

- **Anonymous** — anyone can chat (default)
- **Whitelist** — only approved users
- **Blacklist** — block specific users

**Roles** — each workspace has three roles:

| Role | Access |
|---|---|
| **Admin** | Full access — channels, backends, settings, members, audit logs |
| **Member** | Manage conversations and workflows |
| **Viewer** | Read-only access |

**Plans**: Starter (5 members, 3 channels), Business (50 members, 20 channels), Enterprise (unlimited).

## Comparison with OpenClaw

ClawScale originated from [OpenClaw](https://github.com/pulseeditor/openclaw). OpenClaw bundles messaging gateways and an AI agent into one process — great for personal use, but conversations bleed into each other when multiple users share the same instance.

ClawScale separates the gateway layer from the agent layer, so each can scale independently:

| | OpenClaw | ClawScale |
|---|---|---|
| **Architecture** | Monolithic — gateways + agent in one process | Decoupled — gateway layer + pluggable agent backends |
| **Users** | Single user, shared memory | Multi-tenant with isolated memory per user |
| **Agents** | One built-in agent | Multiple backends per tenant |
| **Scaling** | One instance | Horizontal — multiple agents behind one gateway |
| **Admin controls** | None | Dashboard with RBAC, audit logs, access policies |

## Tech stack

- **API** — [Hono](https://hono.dev) + [Prisma](https://prisma.io) + PostgreSQL
- **Web** — [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS
- **AI** — OpenAI SDK, Anthropic SDK, LangChain
- **Monorepo** — pnpm workspaces

```
packages/
├── api/       # Backend, channel adapters, AI routing, Prisma schema
├── web/       # Next.js dashboard
└── shared/    # Shared TypeScript types
```

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing auth tokens |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `CORS_ORIGIN` | Frontend URL (default: `http://localhost:4040`) |
| `PORT` | API port (default: `4041`) |
| `WHATSAPP_AUTH_DIR` | WhatsApp session files directory (default: `./data/whatsapp`) |
| `OPENCLAW_BIN` | Path to OpenClaw binary (optional) |
| `OPENCLAW_PORT_BASE` | Dynamic port assignment base (default: `19000`) |
| `OPENCLAW_DATA_DIR` | Per-tenant OpenClaw data directory (default: `./data/tenants`) |

## License

MIT
