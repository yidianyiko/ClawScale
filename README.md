# ClawScale Gateway

ClawScale Gateway is the platform layer that connects customer-facing channels
to a business runtime. In this repository it is used by Coke/Kap: Gateway owns
customer accounts, channel records, shared-channel provisioning, delivery-route
state, and the web/API surfaces that sit between public channels and the Coke
runtime.

The current architecture is not the old "generic AI backend dashboard" model.
Gateway no longer presents itself as an OpenClaw wrapper, a multi-backend chat
command system, or a CLI bridge product. Its live role is to provide a stable
channel and customer platform for the Coke supervision runtime.

## Current Responsibilities

- **Customer provisioning** - create and authenticate customer accounts, resolve
  external identities, provision customer ownership, and expose customer account
  flows.
- **Customer-owned channels** - let a signed-in customer manage their own
  personal channel, currently centered on `wechat_personal`.
- **Shared channels** - let an admin configure a shared channel once, then map
  inbound external users into Gateway customers through normalized external
  identities.
- **Inbound routing** - normalize channel webhooks into `routeInboundMessage()`
  and forward business messages to the configured agent/runtime boundary.
- **Outbound delivery** - receive Coke runtime output through `/api/outbound`,
  resolve the exact delivery route, apply idempotency, and send the message
  through the owning channel adapter.
- **Admin operations** - expose admin views for agents, customers, channels,
  shared channels, deliveries, and admin accounts.

## Runtime Shape

```text
External channel
  -> Gateway channel adapter / webhook route
  -> ExternalIdentity + Customer provisioning
  -> Business conversation + delivery route
  -> Agent/runtime endpoint
  -> /api/outbound
  -> Gateway outbound delivery
  -> External channel
```

The web app runs on `4040`. The API runs on `4041`.

The Coke Python runtime and bridge are separate processes. Gateway owns the
platform/channel side; Coke owns business memory, workflows, reminders, and the
assistant turn pipeline.

## Channel Models

### Customer-Owned Personal Channel

`wechat_personal` is the current customer-facing personal channel flow.

Supported customer pages and APIs:

- `/channels/wechat-personal`
- `GET /api/customer/channels/wechat-personal/status`
- `POST /api/customer/channels/wechat-personal`
- `POST /api/customer/channels/wechat-personal/connect`
- `POST /api/customer/channels/wechat-personal/disconnect`
- `DELETE /api/customer/channels/wechat-personal`

Gateway treats the channel row as the source of truth for ownership and
lifecycle state.

### Shared Channels

Shared channels are admin-managed channels that many external users can enter
through. On first inbound contact, Gateway:

1. normalizes the external identity by provider, identity type, and value
2. creates or reuses the matching `Customer`
3. creates an unclaimed owner identity and agent binding when needed
4. provisions the configured shared-channel agent
5. parks the inbound event if provisioning is still pending

Current and active shared-channel work is centered on the `whatsapp_evolution`
shape, with the same model intended for additional shared adapters such as
Linq or WeChat Ecloud.

Important admin/API surfaces:

- `/admin/shared-channels`
- `/api/admin/shared-channels`
- `/gateway/evolution/whatsapp/:channelId/:webhookToken`

Shared-channel secrets stay server-side. Public/admin responses must not expose
stored webhook tokens or provider credentials.

## API Namespaces

Gateway uses audience-first route namespaces:

- `/api/auth/*` - customer authentication and session hydration
- `/api/customer/*` - signed-in customer resources and customer-triggered
  actions
- `/api/public/*` - unauthenticated tokenized or externally linked handoff
  endpoints
- `/api/webhooks/*` - third-party callbacks
- `/api/admin/*` - authenticated admin/operator interfaces
- `/api/internal/*` - bridge/runtime/internal operational calls

Do not add new public routes under `/coke/*`, `/api/coke/*`, or `/user/*`.
Those names are retired compatibility surfaces.

## Local Development

Prerequisites:

- Node.js 20+
- pnpm 9+
- PostgreSQL

Setup:

```bash
cp .env.example .env
pnpm install
pnpm db:push
```

Run API and web:

```bash
pnpm dev
```

Or run them separately:

```bash
pnpm --dir packages/api dev
pnpm --dir packages/web dev
```

Useful URLs:

- Web: `http://localhost:4040`
- API health: `http://localhost:4041/health`
- Admin: `http://localhost:4040/admin/login`
- Customer login: `http://localhost:4040/auth/login`
- Personal channel setup: `http://localhost:4040/channels/wechat-personal`

## Key Environment Variables

Core:

- `DATABASE_URL`
- `ADMIN_JWT_SECRET`
- `CUSTOMER_JWT_SECRET`
- `CORS_ORIGIN`
- `DOMAIN_CLIENT`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_COKE_API_URL`

Coke/ClawScale runtime boundary:

- `CLAWSCALE_OUTBOUND_API_KEY`
- `CLAWSCALE_IDENTITY_API_KEY`
- `COKE_PLATFORM_TENANT_ID`

Email and subscription flows:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

Shared-channel adapters may require additional provider-specific secrets.

## Testing

Run all Gateway tests:

```bash
pnpm test
```

Run focused package tests:

```bash
pnpm --dir packages/api test
pnpm --dir packages/web test
```

Useful focused areas:

```bash
pnpm --dir packages/api test -- src/routes/admin-shared-channels.test.ts src/lib/shared-channel-provisioning.test.ts src/routes/outbound.test.ts
pnpm --dir packages/web test -- 'app/(admin)/admin/shared-channels/page.test.tsx' 'app/(customer)/channels/wechat-personal/page.test.tsx'
```

## Package Layout

```text
packages/
  api/       Hono API, Prisma schema, channel adapters, routing, delivery
  web/       Next.js public, customer, and admin surfaces
  shared/    shared TypeScript types
```

## What Is Retired

The following older README claims are no longer the current Gateway product
positioning:

- OpenClaw wrapper or comparison-driven positioning
- end-user chat commands such as `/team` and `/backends` as the main product
- generic multi-AI-backend dashboard as the primary surface
- public `/coke/*` or `/api/coke/*` compatibility routes
- Coke-owned direct channel runtimes outside the Gateway/channel boundary
