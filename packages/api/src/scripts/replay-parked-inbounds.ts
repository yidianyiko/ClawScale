import { pathToFileURL } from 'node:url';

import type { InboundMessage } from '../lib/route-message.js';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';

const SHARED_CHANNEL_PROVISION_RETRY_THRESHOLD = 3;
const SHARED_CHANNEL_PROVISION_TIMEOUT_MS = 15_000;

interface ReplayParkedInboundsSummary {
  scanned: number;
  replayed: number;
  skipped: number;
  terminalErrors: string[];
}

interface ReplayParkedInboundRow {
  id: string;
  channelId: string;
  payload: unknown;
}

interface ReplayablePayload {
  customerId?: string;
  customer_id?: string;
  externalId?: string;
  external_id?: string;
  displayName?: string;
  display_name?: string;
  text?: string;
  attachments?: InboundMessage['attachments'];
  meta?: InboundMessage['meta'];
}

interface AgentBindingRow {
  customerId: string;
  agentId: string;
  provisionStatus: 'pending' | 'ready' | 'error';
  provisionAttempts: number;
  provisionLastError: string | null;
  customer: {
    displayName: string | null;
  } | null;
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPoint).href;
}

function parseLimit(): number | undefined {
  const explicit = process.argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length)
    ?? process.env.REPLAY_PARKED_INBOUNDS_LIMIT;

  if (!explicit) {
    return undefined;
  }

  const limit = Number.parseInt(explicit, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readReplayablePayload(payload: unknown): ReplayablePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  return payload as ReplayablePayload;
}

function readCustomerId(payload: ReplayablePayload): string | undefined {
  return readString(payload.customerId) ?? readString(payload.customer_id);
}

function readExternalId(payload: ReplayablePayload): string | undefined {
  return readString(payload.externalId) ?? readString(payload.external_id);
}

function readDisplayName(payload: ReplayablePayload): string | undefined {
  return readString(payload.displayName) ?? readString(payload.display_name);
}

async function markParkedInboundDrained(id: string): Promise<void> {
  await db.parkedInbound.update({
    where: { id },
    data: {
      status: 'drained',
      drainedAt: new Date(),
    },
  });
}

async function readReplayBinding(customerId: string): Promise<AgentBindingRow | null> {
  return db.agentBinding.findUnique({
    where: { customerId },
    select: {
      customerId: true,
      agentId: true,
      provisionStatus: true,
      provisionAttempts: true,
      provisionLastError: true,
      customer: {
        select: {
          displayName: true,
        },
      },
    },
  }) as Promise<AgentBindingRow | null>;
}

async function markBindingStatus(
  customerId: string,
  status: 'pending' | 'ready' | 'error',
  errorMessage: string | null,
): Promise<void> {
  await db.agentBinding.update({
    where: { customerId },
    data: {
      provisionStatus: status,
      provisionAttempts: { increment: 1 },
      provisionLastError: errorMessage,
      provisionUpdatedAt: new Date(),
    },
  });
}

async function retrySharedChannelProvision(binding: AgentBindingRow): Promise<AgentBindingRow> {
  const agent = await db.agent.findUnique({
    where: { id: binding.agentId },
    select: {
      endpoint: true,
      authToken: true,
    },
  });

  if (!agent) {
    const message = `shared_channel_agent_not_found:${binding.agentId}`;
    await markBindingStatus(binding.customerId, 'error', message);
    return {
      ...binding,
      provisionStatus: 'error',
      provisionAttempts: binding.provisionAttempts + 1,
      provisionLastError: message,
    };
  }

  try {
    const response = await fetch(agent.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.authToken}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(SHARED_CHANNEL_PROVISION_TIMEOUT_MS),
      body: JSON.stringify({
        customer_id: binding.customerId,
        ...(readString(binding.customer?.displayName) ? { display_name: binding.customer?.displayName } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`shared_channel_agent_provision_failed:${response.status}`);
    }

    await markBindingStatus(binding.customerId, 'ready', null);
    return {
      ...binding,
      provisionStatus: 'ready',
      provisionAttempts: binding.provisionAttempts + 1,
      provisionLastError: null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error && error.message.trim()
      ? error.message
      : 'shared_channel_provision_replay_failed';
    const nextAttempts = binding.provisionAttempts + 1;
    const nextStatus = nextAttempts >= SHARED_CHANNEL_PROVISION_RETRY_THRESHOLD ? 'error' : 'pending';
    await markBindingStatus(binding.customerId, nextStatus, errorMessage);
    return {
      ...binding,
      provisionStatus: nextStatus,
      provisionAttempts: nextAttempts,
      provisionLastError: errorMessage,
    };
  }
}

function pushTerminalError(summary: ReplayParkedInboundsSummary, customerId: string, errorMessage: string | null | undefined) {
  summary.terminalErrors.push(
    `agent_binding_terminal_error:${customerId}:${errorMessage ?? 'unknown'}`,
  );
}

function pushRowError(summary: ReplayParkedInboundsSummary, rowId: string, error: unknown) {
  const errorMessage = error instanceof Error && error.message.trim()
    ? error.message
    : 'unknown';
  summary.terminalErrors.push(`parked_inbound_replay_error:${rowId}:${errorMessage}`);
}

export async function replayParkedInbounds(
  input: { limit?: number } = {},
): Promise<ReplayParkedInboundsSummary> {
  const rows = await db.parkedInbound.findMany({
    where: {
      status: 'queued',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...(typeof input.limit === 'number' ? { take: input.limit } : {}),
  });

  const summary: ReplayParkedInboundsSummary = {
    scanned: rows.length,
    replayed: 0,
    skipped: 0,
    terminalErrors: [],
  };
  const bindingCache = new Map<string, AgentBindingRow | null>();
  const retriedPendingCustomers = new Set<string>();

  const readCachedReplayBinding = async (customerId: string): Promise<AgentBindingRow | null> => {
    if (!bindingCache.has(customerId)) {
      bindingCache.set(customerId, await readReplayBinding(customerId));
    }

    const binding = bindingCache.get(customerId) ?? null;
    if (!binding) {
      return null;
    }

    if (binding.provisionStatus !== 'pending' || retriedPendingCustomers.has(customerId)) {
      return binding;
    }

    retriedPendingCustomers.add(customerId);
    const nextBinding = await retrySharedChannelProvision(binding);
    bindingCache.set(customerId, nextBinding);
    return nextBinding;
  };

  for (const row of rows as ReplayParkedInboundRow[]) {
    try {
      const payload = readReplayablePayload(row.payload);
      const customerId = readCustomerId(payload);

      if (!customerId) {
        summary.skipped += 1;
        continue;
      }

      const binding = await readCachedReplayBinding(customerId);
      if (!binding) {
        summary.skipped += 1;
        continue;
      }

      if (binding.provisionStatus !== 'ready') {
        summary.skipped += 1;
        if (binding.provisionStatus === 'error') {
          pushTerminalError(summary, customerId, binding.provisionLastError);
        }
        continue;
      }

      const externalId = readExternalId(payload);
      const text = readString(payload.text);
      if (!externalId || !text) {
        summary.skipped += 1;
        continue;
      }

      const message: InboundMessage = {
        channelId: row.channelId,
        externalId,
        text,
      };

      const displayName = readDisplayName(payload);
      if (displayName) {
        message.displayName = displayName;
      }

      if (payload.attachments) {
        message.attachments = payload.attachments;
      }

      if (payload.meta) {
        message.meta = payload.meta;
      }

      const result = await routeInboundMessage(message);
      if (!result) {
        summary.skipped += 1;
        continue;
      }

      await markParkedInboundDrained(row.id);
      summary.replayed += 1;
    } catch (error) {
      summary.skipped += 1;
      pushRowError(summary, row.id, error);
    }
  }

  return summary;
}

async function main() {
  const summary = await replayParkedInbounds({ limit: parseLimit() });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.terminalErrors.length > 0) {
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  await main();
}
