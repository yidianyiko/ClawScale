import { pathToFileURL } from 'node:url';

import { db } from '../db/index.js';

export interface SharedChannelRuntimeVerificationSummary {
  deliveryPathAssumptions: string[];
  counts: {
    queuedParkedInbounds: number;
    readyBindings: number;
    pendingBindings: number;
    errorBindings: number;
  };
  errors: string[];
  terminalErrors: string[];
}

interface AgentBindingRow {
  customerId: string;
  provisionStatus: string;
  provisionLastError: string | null;
}

interface ParkedInboundRow {
  id: string;
  channelId: string;
  payload: unknown;
}

interface ReplayablePayload {
  customerId?: string;
  customer_id?: string;
}

const DELIVERY_PATH_ASSUMPTIONS = [
  'delivery_route_truth_is_clawscale_owned',
  'exact_delivery_route_channel_id_is_authoritative',
  'failed_shared_channel_reclaims_do_not_reroute_to_a_different_channel',
] as const;

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPoint).href;
}

function parseLimit(): number | undefined {
  const explicit = process.argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length)
    ?? process.env.VERIFY_SHARED_CHANNEL_RUNTIME_LIMIT;

  if (!explicit) {
    return undefined;
  }

  const limit = Number.parseInt(explicit, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function readReplayablePayload(payload: unknown): ReplayablePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  return payload as ReplayablePayload;
}

function readCustomerId(payload: ReplayablePayload): string | undefined {
  return typeof payload.customerId === 'string' && payload.customerId.trim()
    ? payload.customerId.trim()
    : typeof payload.customer_id === 'string' && payload.customer_id.trim()
      ? payload.customer_id.trim()
      : undefined;
}

export async function verifySharedChannelRuntime(
  input: { limit?: number } = {},
): Promise<SharedChannelRuntimeVerificationSummary> {
  const [agentBindings, parkedInbounds] = await Promise.all([
    db.agentBinding.findMany({
      select: {
        customerId: true,
        provisionStatus: true,
        provisionLastError: true,
      },
      orderBy: { customerId: 'asc' },
    }),
    db.parkedInbound.findMany({
      where: {
        status: 'queued',
      },
      select: {
        id: true,
        channelId: true,
        payload: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(typeof input.limit === 'number' ? { take: input.limit } : {}),
    }),
  ]);

  const bindingsByCustomerId = new Map(
    (agentBindings as AgentBindingRow[]).map((binding) => [binding.customerId, binding] as const),
  );

  const summary: SharedChannelRuntimeVerificationSummary = {
    deliveryPathAssumptions: [...DELIVERY_PATH_ASSUMPTIONS],
    counts: {
      queuedParkedInbounds: parkedInbounds.length,
      readyBindings: 0,
      pendingBindings: 0,
      errorBindings: 0,
    },
    errors: [],
    terminalErrors: [],
  };

  for (const binding of agentBindings as AgentBindingRow[]) {
    if (binding.provisionStatus === 'ready') {
      summary.counts.readyBindings += 1;
      continue;
    }

    if (binding.provisionStatus === 'error') {
      summary.counts.errorBindings += 1;
      summary.terminalErrors.push(
        `agent_binding_terminal_error:${binding.customerId}:${binding.provisionLastError ?? 'unknown'}`,
      );
      continue;
    }

    summary.counts.pendingBindings += 1;
  }

  for (const row of parkedInbounds as ParkedInboundRow[]) {
    const payload = readReplayablePayload(row.payload);
    const customerId = readCustomerId(payload);

    if (!customerId) {
      summary.errors.push(`parked_inbound_missing_customer_id:${row.id}:channel=${row.channelId}`);
      continue;
    }

    const binding = bindingsByCustomerId.get(customerId);
    if (!binding) {
      summary.errors.push(`parked_inbound_missing_binding:${row.id}:${customerId}`);
      continue;
    }

    if (binding.provisionStatus === 'ready') {
      summary.errors.push(`parked_inbound_still_queued:${row.id}:${customerId}`);
      continue;
    }

    if (binding.provisionStatus === 'error') {
      summary.errors.push(`parked_inbound_blocked_by_terminal_error:${row.id}:${customerId}`);
    }
  }

  if (summary.terminalErrors.length > 0) {
    summary.errors.push(...summary.terminalErrors);
  }

  return summary;
}

async function main() {
  const summary = await verifySharedChannelRuntime({ limit: parseLimit() });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  await main();
}
