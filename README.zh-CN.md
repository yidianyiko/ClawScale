<p align="center">
  <img src="https://clawscale.org/logo.png" alt="ClawScale" width="200" />
</p>

<h1 align="center">ClawScale</h1>
<p align="center"><strong>将你的 AI 智能体连接到任意消息平台</strong></p>
<p align="center"><a href="README.md">English</a> | 中文</p>

ClawScale 是一个开源网关，可以将 AI 智能体（OpenClaw、Claude Code、大语言模型或任何自定义智能体）连接到 WhatsApp、Discord、Slack、Telegram 等 10 多个消息平台。它负责多租户隔离、会话路由和后端编排，让数百个用户可以同时与你的智能体对话，互不干扰。

## ClawScale 能做什么？

- **将 AI 智能体部署到消息平台** — 通过统一面板将任何大语言模型或 AI 智能体连接到 WhatsApp、Discord、Slack、Telegram、Teams 等平台
- **支持大量用户同时使用** — 每个用户拥有独立的会话、记忆和状态，用户之间完全隔离
- **灵活组合 AI 后端** — 同时运行 OpenClaw、GPT、Claude、自托管模型等，用户可以在同一个聊天中与多个智能体对话
- **统一管理面板** — 在一个地方管理频道、后端、用户、角色和审计日志

## 支持的频道

| 频道 | 连接方式 |
|---|---|
| WhatsApp（个人版） | 扫描二维码 |
| WhatsApp Business | Meta Cloud API Webhook |
| Discord | Bot Token |
| Telegram | Bot Token |
| Slack | Bot Token（Socket Mode） |
| LINE | Channel Access Token（Webhook） |
| Signal | signal-cli REST API |
| Microsoft Teams | Azure Bot Service（Webhook） |
| Matrix | Homeserver URL + Access Token |
| 企业微信 | Bot Token（WebSocket） |
| 微信个人版 | 扫描二维码 |
| 网页聊天组件 | Webhook |
| Instagram | Meta API |
| Facebook | Webhook |

在面板中添加频道 — 填写凭据后点击**连接**即可。WhatsApp 和微信个人版会显示二维码供扫描配对。

## 支持的 AI 后端

ClawScale 不绑定任何单一 AI 供应商。你可以自由组合以下后端：

| 后端 | 说明 |
|---|---|
| **OpenClaw** | 一个或多个 OpenClaw 实例，拥有独立的工具、记忆和提示词 |
| **OpenAI** | 通过 OpenAI API 使用 GPT 模型 |
| **Anthropic** | 通过 Anthropic API 使用 Claude 模型 |
| **OpenRouter** | 通过一个 API Key 访问数百种模型 |
| **Pulse** | Pulse Editor AI 智能体 |
| **自定义** | 任何 OpenAI 兼容的端点（vLLM、Ollama、自托管模型等） |

用户可以同时激活多个后端。回复会标注来源（如 `[GPT-4o]`、`[Claude]`），方便用户了解是哪个智能体在回复。

## 快速开始

### 前置要求

- Node.js 20+
- pnpm
- Docker（用于 PostgreSQL）

### 启动步骤

```bash
# 1. 启动 Postgres
docker compose up postgres -d

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env — 默认配置适用于本地开发

# 3. 安装依赖
pnpm install

# 4. 推送数据库结构
cd packages/api && pnpm db:push && cd ../..

# 5. 启动 API 和 Web（分别在不同终端）
cd packages/api && pnpm dev
cd packages/web && pnpm dev
```

- **管理面板**: http://localhost:4040
- **API**: http://localhost:4041

或者使用 Docker 一键启动：

```bash
cp .env.example .env
docker compose up --build
```

打开面板并**注册**以创建你的工作区。你将成为管理员。

## 工作原理

```
终端用户（WhatsApp、Discord、Slack 等）
    |
    v
频道适配器 ──> POST /gateway/:channelId
    |
    v
消息路由器
    ├── 解析命令（/team、/backends 等）
    ├── 解析目标后端
    ├── 加载会话历史
    ├── 调用 AI 后端
    └── 保存消息 + 返回回复
    |
    v
频道适配器 ──> 回复终端用户
```

1. 用户在任意已连接的平台上发送消息
2. 频道适配器将消息标准化后转发给 ClawScale
3. ClawScale 将消息路由到对应的 AI 后端，保持每个用户的会话历史隔离
4. AI 的回复通过同一频道返回给用户

## 聊天命令

终端用户可以在聊天中直接使用命令来管理体验：

| 命令 | 功能 |
|---|---|
| `/backends` | 列出可用的 AI 后端 |
| `/team` | 显示当前激活的后端 |
| `/team invite <名称>` | 将后端添加到会话中 |
| `/team kick <名称>` | 移除后端 |
| `/clear` | 删除会话历史 |
| `/help` | 显示所有命令 |

向指定后端发送消息：`gpt> 解释量子计算`

## 多租户隔离

ClawScale 专为多用户部署设计。每个用户的会话、记忆和状态完全隔离 — 数据绝不会跨越边界。

**访问控制** — 工作区管理员决定谁可以与机器人交互：

- **匿名** — 任何人都可以聊天（默认）
- **白名单** — 仅允许已批准的用户
- **黑名单** — 屏蔽特定用户

**角色** — 每个工作区有三种角色：

| 角色 | 权限 |
|---|---|
| **管理员** | 完全访问 — 频道、后端、设置、成员、审计日志 |
| **成员** | 管理会话和工作流 |
| **查看者** | 只读访问 |

**方案**：入门版（5 名成员、3 个频道）、商业版（50 名成员、20 个频道）、企业版（无限制）。

## 与 OpenClaw 的对比

ClawScale 源自 [OpenClaw](https://github.com/pulseeditor/openclaw)。OpenClaw 将消息网关和 AI 智能体捆绑在一个进程中 — 适合个人使用，但当多个用户共享同一实例时，会话之间会相互干扰。

ClawScale 将网关层与智能体层分离，使两者可以独立扩展：

| | OpenClaw | ClawScale |
|---|---|---|
| **架构** | 单体 — 网关 + 智能体在同一进程 | 解耦 — 网关层 + 可插拔的智能体后端 |
| **用户** | 单用户，共享记忆 | 多租户，每个用户独立记忆 |
| **智能体** | 一个内置智能体 | 每个租户支持多个后端 |
| **扩展性** | 单实例 | 水平扩展 — 多个智能体共用一个网关 |
| **管理功能** | 无 | 面板 + RBAC、审计日志、访问策略 |

## 技术栈

- **API** — [Hono](https://hono.dev) + [Prisma](https://prisma.io) + PostgreSQL
- **Web** — [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS
- **AI** — OpenAI SDK、Anthropic SDK、LangChain
- **Monorepo** — pnpm workspaces

```
packages/
├── api/       # 后端、频道适配器、AI 路由、Prisma 模型
├── web/       # Next.js 管理面板
└── shared/    # 共享 TypeScript 类型
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | 用于签署认证令牌的密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥（可选） |
| `CORS_ORIGIN` | 前端 URL（默认：`http://localhost:4040`） |
| `PORT` | API 端口（默认：`4041`） |
| `WHATSAPP_AUTH_DIR` | WhatsApp 会话文件目录（默认：`./data/whatsapp`） |
| `OPENCLAW_BIN` | OpenClaw 二进制文件路径（可选） |
| `OPENCLAW_PORT_BASE` | 动态端口分配基数（默认：`19000`） |
| `OPENCLAW_DATA_DIR` | 每租户 OpenClaw 数据目录（默认：`./data/tenants`） |

## 许可证

MIT
