import WebSocket from 'ws';
import type { LocalAgent } from './agents/base.js';

interface BridgeOptions {
  server: string;
  token: string;
  agent: LocalAgent;
}

interface ServerMessage {
  type: string;
  requestId?: string;
  history?: { role: string; content: string }[];
  backendId?: string;
  message?: string;
  sender?: string;
  platform?: string;
}

export class Bridge {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private stopping = false;

  constructor(private opts: BridgeOptions) {}

  async start(): Promise<void> {
    await this.opts.agent.start();
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    this.ws?.close();
    this.opts.agent.stop().catch(() => {});
  }

  private connect(): void {
    if (this.stopping) return;

    console.log(`[bridge] Connecting to ${this.opts.server}...`);
    this.ws = new WebSocket(this.opts.server);

    this.ws.on('open', () => {
      console.log('[bridge] Connected, authenticating...');
      this.reconnectDelay = 1000;
      this.ws!.send(JSON.stringify({ type: 'auth', token: this.opts.token }));
    });

    this.ws.on('message', async (raw) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'auth_ok') {
        console.log(`[bridge] Authenticated as backend ${msg.backendId}`);
        return;
      }

      if (msg.type === 'auth_error') {
        console.error(`[bridge] Auth failed: ${msg.message}`);
        this.stopping = true;
        this.ws?.close();
        process.exit(1);
      }

      if (msg.type === 'message' && msg.requestId && msg.history) {
        const infoParts = [
          `id=${msg.requestId}`,
          `history=${msg.history.length}`,
          msg.sender ? `sender=${msg.sender}` : null,
          msg.platform ? `platform=${msg.platform}` : null,
        ].filter(Boolean).join(', ');
        const lastUserMsg = [...msg.history].reverse().find(m => m.role === 'user');
        console.log(`[bridge] Received message [${infoParts}]`);
        console.log(`[bridge]   ← ${lastUserMsg?.content ?? '(no user message)'}`);
        try {
          const text = await this.opts.agent.send(msg.history);
          this.ws?.send(JSON.stringify({ type: 'reply', requestId: msg.requestId, text }));
          console.log(`[bridge]   → ${text.length > 200 ? text.slice(0, 200) + '...' : text}`);
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error';
          this.ws?.send(JSON.stringify({ type: 'reply', requestId: msg.requestId, error }));
          console.error(`[bridge] Error processing ${msg.requestId}:`, error);
        }
      }
    });

    this.ws.on('close', () => {
      if (this.stopping) return;
      console.log(`[bridge] Disconnected, reconnecting in ${this.reconnectDelay}ms...`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    });

    this.ws.on('error', (err) => {
      console.error(`[bridge] WebSocket error:`, err.message);
    });
  }
}
