# ClawScale Gateway

ClawScale Gateway 是连接外部消息渠道和业务运行时的平台层。在当前仓库里，
它服务于 Coke/Kap：Gateway 负责客户账号、渠道记录、共享渠道开通、
投递路由状态，以及位于公开渠道和 Coke 运行时之间的 Web/API 表面。

当前架构已经不是旧的“通用 AI 后端 Dashboard”。Gateway 不再把自己定位成
OpenClaw 包装层、多后端聊天命令系统或 CLI Bridge 产品。它现在的核心职责是
为 Coke 监督运行时提供稳定的渠道平台和客户平台。

## 当前职责

- **客户开通**：创建和认证客户账号，解析外部身份，建立客户归属关系，并暴露客户账号流程。
- **客户自有渠道**：让登录客户管理自己的个人渠道，目前核心是 `wechat_personal`。
- **共享渠道**：管理员只配置一次共享渠道，外部用户进入后通过标准化外部身份映射成 Gateway 客户。
- **入站路由**：把渠道 webhook 标准化为 `routeInboundMessage()` 输入，并转发到配置好的 agent / runtime 边界。
- **出站投递**：通过 `/api/outbound` 接收 Coke 运行时输出，解析精确投递路由，做幂等控制，并通过对应渠道适配器发送。
- **管理员操作**：提供 agents、customers、channels、shared channels、deliveries 和 admin accounts 的管理界面。

## 运行时形态

```text
外部渠道
  -> Gateway 渠道适配器 / webhook route
  -> ExternalIdentity + Customer provisioning
  -> Business conversation + delivery route
  -> Agent/runtime endpoint
  -> /api/outbound
  -> Gateway outbound delivery
  -> 外部渠道
```

Web 运行在 `4040`，API 运行在 `4041`。

Coke Python runtime 和 bridge 是独立进程。Gateway 负责平台和渠道侧；
Coke 负责业务记忆、工作流、提醒，以及助手的回合处理流水线。

## 渠道模型

### 客户自有个人渠道

`wechat_personal` 是当前面向客户的个人渠道流程。

相关页面和 API：

- `/channels/wechat-personal`
- `GET /api/customer/channels/wechat-personal/status`
- `POST /api/customer/channels/wechat-personal`
- `POST /api/customer/channels/wechat-personal/connect`
- `POST /api/customer/channels/wechat-personal/disconnect`
- `DELETE /api/customer/channels/wechat-personal`

Gateway 把 channel row 作为所有权和生命周期状态的事实来源。

### 共享渠道

共享渠道由管理员配置，多个外部用户可以从同一个渠道进入。第一次收到外部用户消息时，Gateway 会：

1. 按 provider、identity type、identity value 标准化外部身份
2. 创建或复用对应的 `Customer`
3. 在需要时创建未认领的 owner identity 和 agent binding
4. 为配置的共享渠道 agent 执行开通
5. 如果开通仍在 pending，就先 park 这条入站事件

当前活跃的共享渠道工作主要围绕 `whatsapp_evolution` 形态展开；Linq、
WeChat Ecloud 等后续共享适配器也应沿用同一模型。

重要的管理和 API 表面：

- `/admin/shared-channels`
- `/api/admin/shared-channels`
- `/gateway/evolution/whatsapp/:channelId/:webhookToken`

共享渠道密钥只保存在服务端。公开或管理员响应不能泄露存储的 webhook token
或 provider 凭据。

## API 命名空间

Gateway 使用“先区分受众”的路由命名：

- `/api/auth/*`：客户认证和 session hydration
- `/api/customer/*`：登录客户拥有的资源和客户触发的业务动作
- `/api/public/*`：无需登录的 token 化或外部链接交接端点
- `/api/webhooks/*`：第三方回调
- `/api/admin/*`：管理员/运营接口
- `/api/internal/*`：bridge、runtime 或内部运维调用

不要再新增 `/coke/*`、`/api/coke/*` 或 `/user/*` 公开路由。这些都是已退役的兼容表面。

## 本地开发

前置要求：

- Node.js 20+
- pnpm 9+
- PostgreSQL

初始化：

```bash
cp .env.example .env
pnpm install
pnpm db:push
```

同时启动 API 和 Web：

```bash
pnpm dev
```

或分别启动：

```bash
pnpm --dir packages/api dev
pnpm --dir packages/web dev
```

常用地址：

- Web：`http://localhost:4040`
- API health：`http://localhost:4041/health`
- Admin：`http://localhost:4040/admin/login`
- Customer login：`http://localhost:4040/auth/login`
- Personal channel setup：`http://localhost:4040/channels/wechat-personal`

## 关键环境变量

核心：

- `DATABASE_URL`
- `ADMIN_JWT_SECRET`
- `CUSTOMER_JWT_SECRET`
- `CORS_ORIGIN`
- `DOMAIN_CLIENT`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_COKE_API_URL`

Coke / ClawScale 运行时边界：

- `CLAWSCALE_OUTBOUND_API_KEY`
- `CLAWSCALE_IDENTITY_API_KEY`
- `COKE_PLATFORM_TENANT_ID`

邮件和订阅流程：

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

共享渠道适配器可能还需要额外的 provider-specific 密钥。

## 测试

运行所有 Gateway 测试：

```bash
pnpm test
```

按 package 运行：

```bash
pnpm --dir packages/api test
pnpm --dir packages/web test
```

常用聚焦测试：

```bash
pnpm --dir packages/api test -- src/routes/admin-shared-channels.test.ts src/lib/shared-channel-provisioning.test.ts src/routes/outbound.test.ts
pnpm --dir packages/web test -- 'app/(admin)/admin/shared-channels/page.test.tsx' 'app/(customer)/channels/wechat-personal/page.test.tsx'
```

## 包结构

```text
packages/
  api/       Hono API、Prisma schema、渠道适配器、路由、投递
  web/       Next.js 公开页面、客户页面和管理员页面
  shared/    共享 TypeScript 类型
```

## 已退役内容

旧 README 里的这些说法不再代表当前 Gateway 产品定位：

- OpenClaw 包装层或以 OpenClaw 对比为中心的定位
- `/team`、`/backends` 等终端用户聊天命令作为主产品面
- 通用多 AI 后端 Dashboard 作为主要表面
- 公开 `/coke/*` 或 `/api/coke/*` 兼容路由
- Gateway / channel 边界之外由 Coke 自己维护的直接渠道运行时
