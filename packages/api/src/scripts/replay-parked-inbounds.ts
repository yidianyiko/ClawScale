import { pathToFileURL } from 'node:url';

import type { InboundMessage } from '../lib/route-message.js';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';

export interface ReplayParkedInboundsSummary {
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

function isReadyBinding(binding: { provisionStatus?: string } | null | undefined): boolean {
  return binding?.provisionStatus === 'ready';
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

  for (const row of rows as ReplayParkedInboundRow[]) {
    const payload = readReplayablePayload(row.payload);
    const customerId = readCustomerId(payload);
    const externalId = readExternalId(payload);
    const text = readString(payload.text);

    if (!customerId || !externalId || !text) {
      summary.skipped += 1;
      continue;
    }

    const binding = await db.agentBinding.findUnique({
      where: { customerId },
      select: {
        provisionStatus: true,
        provisionLastError: true,
      },
    });

    if (!isReadyBinding(binding)) {
      summary.skipped += 1;
      if (binding?.provisionStatus === 'error') {
        summary.terminalErrors.push(
          `agent_binding_terminal_error:${customerId}:${binding.provisionLastError ?? 'unknown'}`,
        );
      }
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
