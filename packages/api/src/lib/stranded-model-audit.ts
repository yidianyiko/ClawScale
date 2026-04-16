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
  const [conversations, messages, aiBackends, workflows, endUserBackends] = await Promise.all([
    db.conversation.count(),
    db.message.count(),
    db.aiBackend.count(),
    db.workflow.count(),
    db.endUserBackend.count(),
  ]);

  return {
    conversations,
    messages,
    aiBackends,
    workflows,
    endUserBackends,
  };
}

export async function auditStrandedModels(): Promise<StrandedModelAuditSummary> {
  const counts = await collectStrandedModelCounts();
  return summarizeStrandedModelAudit(counts);
}
