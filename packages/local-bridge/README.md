# @clawscale/local-bridge

Connect your local AI agent (Claude Code, Cursor, etc.) to ClawScale as a backend. Runs on your machine and tunnels messages to ClawScale via WebSocket — no public IP needed.

## Quick Start

### 1. Create a Local Bridge backend in ClawScale

Go to **AI Backends** in the ClawScale dashboard, click **Add backend**, and select **Local Bridge**. A bridge token will be auto-generated — copy it.

### 2. Install and run

```bash
# Run directly with npx (no install needed)
npx @clawscale/local-bridge \
  --server wss://your-clawscale-server/bridge \
  --token brg_xxxxxxxxxxxx \
  --agent claude-code

# Or install globally
npm install -g @clawscale/local-bridge
clawscale-bridge --server wss://your-server/bridge --token brg_xxx --agent claude-code
```

### 3. That's it

Messages sent to the Local Bridge backend in ClawScale will be forwarded to your local agent, and responses will be sent back.

## Options

```
-s, --server <url>    ClawScale WebSocket URL (required)
                      e.g. wss://your-server/bridge or ws://localhost:4041/bridge
-t, --token <token>   Bridge token from ClawScale dashboard (required)
-a, --agent <type>    Agent type to bridge (default: "claude-code")
```

## Supported Agents

| Agent | Description |
|-------|-------------|
| `claude-code` | Bridges to the Claude Code CLI (`claude --print`). Requires Claude Code to be installed locally. |

## How It Works

```
Your Machine                          ClawScale Server
+-----------------+                   +------------------+
| Local Agent     |                   |                  |
| (Claude Code)   |<-- PTY spawn     |   ClawScale API  |
|                 |                   |                  |
| clawscale-bridge|---WebSocket------>|   /bridge (WS)   |
|                 |   (outbound)      |                  |
+-----------------+                   +------------------+
                                             |
                                      Chat Platforms
                                      (Telegram, Discord, etc.)
```

1. The bridge opens an outbound WebSocket connection to ClawScale (no inbound ports needed)
2. Authenticates using the bridge token
3. When a user messages the Local Bridge backend, ClawScale sends the message over WebSocket
4. The bridge forwards it to the local agent (e.g. spawns `claude --print`)
5. The agent's response is sent back over WebSocket to ClawScale
6. ClawScale delivers the response to the user

The bridge automatically reconnects with exponential backoff if the connection drops.

## Adding Custom Agents

Create a class implementing the `LocalAgent` interface:

```typescript
import type { LocalAgent } from '@clawscale/local-bridge/agents/base';

class MyAgent implements LocalAgent {
  async start(): Promise<void> { /* init */ }
  async send(history: { role: string; content: string }[]): Promise<string> {
    // Process messages and return a response
    return 'Hello from my agent!';
  }
  async stop(): Promise<void> { /* cleanup */ }
}
```

## Development

```bash
# From the repo root
cd packages/local-bridge
pnpm install

# Run in dev mode
pnpm dev -- --server ws://localhost:4041/bridge --token brg_xxx --agent claude-code

# Build
pnpm build
```
