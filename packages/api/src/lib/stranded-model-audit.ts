import { Prisma } from '@prisma/client';

import { db } from '../db/index.js';

export interface StrandedModelCounts {
  conversations: number;
  messages: number;
  aiBackends: number;
  workflows: number;
  endUserBackends: number;
}

export interface StrandedModelAuditSummary {
  counts: StrandedModelCounts;
  verdicts: {
    Conversation: 'migrate_route_minimum';
    Message: 'drop_after_history_cutover';
    AiBackend: 'drop';
    Workflow: 'drop';
    EndUserBackend: 'drop_or_move';
  };
}

const STRANDED_MODEL_VERDICTS = Object.freeze({
  Conversation: 'migrate_route_minimum',
  Message: 'drop_after_history_cutover',
  AiBackend: 'drop',
  Workflow: 'drop',
  EndUserBackend: 'drop_or_move',
} as const);

export function summarizeStrandedModelAudit(
  counts: StrandedModelCounts,
): StrandedModelAuditSummary {
  return {
    counts,
    verdicts: STRANDED_MODEL_VERDICTS,
  };
}

export async function collectStrandedModelCounts(): Promise<StrandedModelCounts> {
  const [conversations, messages, aiBackends, endUserBackends, workflowRows] = await Promise.all([
    db.conversation.count(),
    db.message.count(),
    db.aiBackend.count(),
    db.endUserBackend.count(),
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "count"
      FROM "workflows"
    `).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('does not exist')) {
        return [{ count: 0 }];
      }
      throw error;
    }),
  ]);

  return {
    conversations,
    messages,
    aiBackends,
    workflows: workflowRows[0]?.count ?? 0,
    endUserBackends,
  };
}

export async function auditStrandedModels(): Promise<StrandedModelAuditSummary> {
  const counts = await collectStrandedModelCounts();
  return summarizeStrandedModelAudit(counts);
}
