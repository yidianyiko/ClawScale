import type { Prisma } from '@prisma/client';

import { db } from '../db/index.js';

type ParkedInboundStatus = 'queued' | 'processing' | 'drained' | 'failed';

interface ParkedInboundRecord {
  id: string;
  channelId: string;
  provider: string;
  identityType: string;
  identityValue: string;
  payload: Prisma.JsonValue;
  status: ParkedInboundStatus;
  attempts: number;
  lastError: string | null;
  drainedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface QueueParkedInboundInput {
  channelId: string;
  provider: string;
  identityType: string;
  identityValue: string;
  payload: Prisma.InputJsonValue;
}

interface DrainParkedInboundsInput {
  channelId?: string;
  limit?: number;
}

export async function queueParkedInbound(
  input: QueueParkedInboundInput,
): Promise<ParkedInboundRecord> {
  return db.$transaction(async (tx) => {
    return tx.parkedInbound.create({
      data: {
        channelId: input.channelId,
        provider: input.provider,
        identityType: input.identityType,
        identityValue: input.identityValue,
        payload: input.payload,
        status: 'queued',
      },
    });
  });
}

export async function drainParkedInbounds(
  input: DrainParkedInboundsInput = {},
): Promise<ParkedInboundRecord[]> {
  return db.$transaction(async (tx) => {
    const rows = await tx.parkedInbound.findMany({
      where: {
        ...(input.channelId ? { channelId: input.channelId } : {}),
        status: 'queued',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(typeof input.limit === 'number' ? { take: input.limit } : {}),
    });

    const drainedAt = new Date();
    const drainedRows: ParkedInboundRecord[] = [];

    for (const row of rows) {
      const drainedRow = await tx.parkedInbound.update({
        where: { id: row.id },
        data: {
          status: 'drained',
          drainedAt,
        },
      });
      drainedRows.push(drainedRow);
    }

    return drainedRows;
  });
}
