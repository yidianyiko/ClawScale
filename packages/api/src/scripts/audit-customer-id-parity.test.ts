import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  customer: {
    findMany: vi.fn(),
  },
}));

const execFileSync = vi.hoisted(() => vi.fn());
const readdirSync = vi.hoisted(() => vi.fn());
const readFileSync = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('node:fs', () => ({ readdirSync, readFileSync }));

import {
  auditCustomerIdParity,
  scanKnownTouchpoints,
} from './audit-customer-id-parity.js';

describe('audit customer id parity script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readdirSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('connector/clawscale_bridge')) {
        return ['app.py', 'output_dispatcher.py'];
      }
      if (filePath.endsWith('dao')) {
        return ['conversation_dao.py', 'reminder_dao.py', 'user_dao.py'];
      }
      throw new Error(`unexpected directory read: ${filePath}`);
    });
    readFileSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('agent/util/message_util.py')) {
        return 'outputmessages';
      }
      if (filePath.endsWith('agent/runner/identity.py')) {
        return 'def is_synthetic_coke_account_id(value: str) -> bool:';
      }
      if (filePath.endsWith('connector/clawscale_bridge/output_dispatcher.py')) {
        return 'outputmessages account_id';
      }
      if (filePath.endsWith('dao/reminder_dao.py')) {
        return 'reminders user_id';
      }
      if (filePath.endsWith('dao/conversation_dao.py')) {
        return 'conversations talkers';
      }
      return '';
    });
    db.customer.findMany.mockResolvedValue([{ id: 'acct_live' }, { id: 'ck_live' }]);
    execFileSync.mockReturnValue(
      JSON.stringify({
        collectionsChecked: ['ignored-by-ts-wrapper'],
        driftCount: 1,
        examples: [
          {
            collection: 'reminders',
            fieldPath: 'user_id',
            documentId: 'rem_1',
            accountId: 'acct_missing',
          },
        ],
      }),
    );
  });

  it('scans the known touchpoint source areas and combines them with the python parity report', async () => {
    const report = await auditCustomerIdParity(db as never);

    expect(report).toEqual({
      collectionsChecked: ['outputmessages', 'reminders', 'conversations'],
      driftCount: 1,
      examples: [
        {
          collection: 'reminders',
          fieldPath: 'user_id',
          documentId: 'rem_1',
          accountId: 'acct_missing',
        },
      ],
    });
    expect(db.customer.findMany).toHaveBeenCalledWith({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(execFileSync).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        '-c',
        expect.stringContaining('audit_customer_id_parity'),
      ]),
      expect.objectContaining({
        timeout: 120_000,
        encoding: 'utf8',
        input: JSON.stringify(['acct_live', 'ck_live']),
      }),
    );
  });

  it('fails fast when a required touchpoint evidence disappears from the scanned files', () => {
    readFileSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('agent/util/message_util.py')) {
        return 'outputmessages';
      }
      if (filePath.endsWith('agent/runner/identity.py')) {
        return 'def is_synthetic_coke_account_id(value: str) -> bool:';
      }
      if (filePath.endsWith('connector/clawscale_bridge/output_dispatcher.py')) {
        return 'outputmessages account_id';
      }
      if (filePath.endsWith('dao/reminder_dao.py')) {
        return 'reminders user_id';
      }
      return '';
    });

    expect(() => scanKnownTouchpoints()).toThrow(
      'Missing expected touchpoint evidence',
    );
  });
});
