/**
 * OpenClaw Bridge
 *
 * ClawScale manages per-tenant OpenClaw gateway processes.
 * Each channel connection spawns (or reuses) an OpenClaw instance
 * configured for that tenant's data directory.
 *
 * Architecture:
 *   ClawScale API  <──HTTP/WS──>  OpenClaw gateway (ws://127.0.0.1:{port})
 *
 * The bridge:
 *   1. Launches `openclaw daemon start` in a tenant-scoped data directory.
 *   2. Tracks the process PID and assigned port in the DB.
 *   3. Proxies inbound messages from social channels to that gateway.
 *   4. Forwards responses back to the originating channel.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const DATA_DIR = process.env['OPENCLAW_DATA_DIR'] ?? './data/tenants';
const OPENCLAW_BIN = process.env['OPENCLAW_BIN'] ?? 'openclaw';
const PORT_BASE = parseInt(process.env['OPENCLAW_PORT_BASE'] ?? '19000', 10);

// In-memory registry of running OpenClaw processes.
// In production you'd persist PIDs to disk for crash recovery.
const registry = new Map<string, { process: ChildProcess; port: number; ws: WebSocket | null }>();

let nextPort = PORT_BASE;

function allocatePort(): number {
  return nextPort++;
}

function tenantDataDir(tenantId: string): string {
  return path.join(DATA_DIR, tenantId);
}

/**
 * Ensure the tenant data directory exists and launch an OpenClaw daemon
 * instance bound to an isolated port.
 *
 * Returns the port the instance is listening on.
 */
export async function startTenantGateway(tenantId: string): Promise<number> {
  if (registry.has(tenantId)) {
    const entry = registry.get(tenantId)!;
    return entry.port;
  }

  const dataDir = tenantDataDir(tenantId);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const port = allocatePort();

  const proc = spawn(
    OPENCLAW_BIN,
    ['daemon', 'start', '--gateway-port', String(port)],
    {
      cwd: dataDir,
      env: {
        ...process.env,
        OPENCLAW_HOME: dataDir,
        OPENCLAW_GATEWAY_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    },
  );

  proc.stdout?.on('data', (d: Buffer) => {
    console.log(`[openclaw:${tenantId}] ${d.toString().trim()}`);
  });
  proc.stderr?.on('data', (d: Buffer) => {
    console.error(`[openclaw:${tenantId}:err] ${d.toString().trim()}`);
  });
  proc.on('exit', (code) => {
    console.warn(`[openclaw:${tenantId}] exited with code ${code}`);
    registry.delete(tenantId);
  });

  registry.set(tenantId, { process: proc, port, ws: null });

  // Give the daemon a moment to bind its WebSocket port.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  return port;
}

/**
 * Stop a running tenant gateway process.
 */
export function stopTenantGateway(tenantId: string): void {
  const entry = registry.get(tenantId);
  if (!entry) return;
  entry.ws?.close();
  entry.process.kill('SIGTERM');
  registry.delete(tenantId);
}

/**
 * Get an open WebSocket connection to a tenant's OpenClaw gateway.
 * Creates a new connection if none exists.
 */
export function getGatewaySocket(tenantId: string): WebSocket | null {
  const entry = registry.get(tenantId);
  if (!entry) return null;

  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    return entry.ws;
  }

  const ws = new WebSocket(`ws://127.0.0.1:${entry.port}`);
  entry.ws = ws;
  ws.on('error', (err) => {
    console.error(`[openclaw:${tenantId}:ws] ${err.message}`);
  });
  return ws;
}

/**
 * Send a message to a tenant's OpenClaw gateway and return the response.
 * This is a simplified request/response helper — production use should
 * maintain a persistent WebSocket and correlate responses by message ID.
 */
export function sendToGateway(
  tenantId: string,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const entry = registry.get(tenantId);
    if (!entry) {
      reject(new Error(`No running gateway for tenant ${tenantId}`));
      return;
    }

    const ws = new WebSocket(`ws://127.0.0.1:${entry.port}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Gateway response timeout'));
    }, 10_000);

    ws.once('open', () => {
      ws.send(JSON.stringify(message));
    });

    ws.once('message', (raw) => {
      clearTimeout(timeout);
      ws.close();
      try {
        resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON response from gateway'));
      }
    });

    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function getGatewayStatus(tenantId: string): 'running' | 'stopped' {
  return registry.has(tenantId) ? 'running' : 'stopped';
}

export function listRunningGateways(): string[] {
  return Array.from(registry.keys());
}
