import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  client: {
    conversation: {
      count: vi.fn(),
    },
    message: {
      count: vi.fn(),
    },
    aiBackend: {
      count: vi.fn(),
    },
    endUserBackend: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db: db.client }));

import {
  auditStrandedModels,
  collectStrandedModelCounts,
  summarizeStrandedModelAudit,
} from './stranded-model-audit.js';

describe('stranded model audit helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarizeStrandedModelAudit locks the target verdict for each stranded model', () => {
    const summary = summarizeStrandedModelAudit({
      conversations: 4,
      messages: 9,
      aiBackends: 2,
      workflows: 3,
      endUserBackends: 5,
    });

    expect(summary).toEqual({
      counts: {
        conversations: 4,
        messages: 9,
        aiBackends: 2,
        workflows: 3,
        endUserBackends: 5,
      },
      verdicts: {
        Conversation: 'migrate_route_minimum',
        Message: 'drop_after_history_cutover',
        AiBackend: 'drop',
        Workflow: 'drop',
        EndUserBackend: 'drop_or_move',
      },
    });
    expect(Object.isFrozen(summary.verdicts)).toBe(true);
    expect(() => {
      (summary.verdicts as { Conversation: string }).Conversation = 'drop';
    }).toThrow(TypeError);
  });

  it('collectStrandedModelCounts queries each stranded table exactly once', async () => {
    db.client.conversation.count.mockResolvedValue(7);
    db.client.message.count.mockResolvedValue(11);
    db.client.aiBackend.count.mockResolvedValue(3);
    db.client.endUserBackend.count.mockResolvedValue(13);
    db.client.$queryRaw.mockResolvedValue([{ count: 5 }]);

    await expect(collectStrandedModelCounts()).resolves.toEqual({
      conversations: 7,
      messages: 11,
      aiBackends: 3,
      workflows: 5,
      endUserBackends: 13,
    });

    expect(db.client.conversation.count).toHaveBeenCalledTimes(1);
    expect(db.client.message.count).toHaveBeenCalledTimes(1);
    expect(db.client.aiBackend.count).toHaveBeenCalledTimes(1);
    expect(db.client.endUserBackend.count).toHaveBeenCalledTimes(1);
    expect(db.client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('auditStrandedModels combines live counts with the frozen verdict table', async () => {
    db.client.conversation.count.mockResolvedValue(1);
    db.client.message.count.mockResolvedValue(2);
    db.client.aiBackend.count.mockResolvedValue(3);
    db.client.endUserBackend.count.mockResolvedValue(5);
    db.client.$queryRaw.mockResolvedValue([{ count: 4 }]);

    await expect(auditStrandedModels()).resolves.toEqual({
      counts: {
        conversations: 1,
        messages: 2,
        aiBackends: 3,
        workflows: 4,
        endUserBackends: 5,
      },
      verdicts: {
        Conversation: 'migrate_route_minimum',
        Message: 'drop_after_history_cutover',
        AiBackend: 'drop',
        Workflow: 'drop',
        EndUserBackend: 'drop_or_move',
      },
    });
  });

  it('treats a missing workflows table as already retired', async () => {
    db.client.conversation.count.mockResolvedValue(0);
    db.client.message.count.mockResolvedValue(0);
    db.client.aiBackend.count.mockResolvedValue(0);
    db.client.endUserBackend.count.mockResolvedValue(0);
    db.client.$queryRaw.mockRejectedValue(new Error('relation "workflows" does not exist'));

    await expect(collectStrandedModelCounts()).resolves.toEqual({
      conversations: 0,
      messages: 0,
      aiBackends: 0,
      workflows: 0,
      endUserBackends: 0,
    });
  });
});
