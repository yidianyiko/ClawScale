import { describe, expect, it, vi } from 'vitest';
import {
  createCalendarImportRun,
  markCalendarImportRunFinished,
  markCalendarImportRunImporting,
} from './google-calendar-import-runs.js';

describe('google calendar import runs', () => {
  it('creates an authorizing run with target conversation identity', async () => {
    const db = {
      calendarImportRun: {
        create: vi.fn().mockResolvedValue({
          id: 'cir_1',
          status: 'authorizing',
          customerId: 'ck_1',
          identityId: 'idt_1',
          targetConversationId: 'conv_1',
          targetCharacterId: 'char_1',
        }),
      },
    };

    const result = await createCalendarImportRun(db as never, {
      customerId: 'ck_1',
      identityId: 'idt_1',
      targetConversationId: 'conv_1',
      targetCharacterId: 'char_1',
      triggerSource: 'manual_web',
    });

    expect(result.status).toBe('authorizing');
    expect(db.calendarImportRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'google_calendar',
          targetConversationId: 'conv_1',
          targetCharacterId: 'char_1',
        }),
      }),
    );
  });

  it('marks an import run as importing with the provider account email', async () => {
    const db = {
      calendarImportRun: {
        update: vi.fn().mockResolvedValue({
          id: 'cir_1',
          status: 'importing',
          providerAccountEmail: 'user@example.com',
        }),
      },
    };

    const result = await markCalendarImportRunImporting(db as never, {
      id: 'cir_1',
      providerAccountEmail: 'user@example.com',
    });

    expect(result.status).toBe('importing');
    expect(db.calendarImportRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_1' },
        data: expect.objectContaining({
          status: 'importing',
          providerAccountEmail: 'user@example.com',
        }),
      }),
    );
  });

  it('marks a finished import run with summary counts and error details', async () => {
    const db = {
      calendarImportRun: {
        update: vi.fn().mockResolvedValue({
          id: 'cir_1',
          status: 'succeeded_with_errors',
          importedCount: 10,
          skippedCount: 1,
          failedCount: 2,
          errorSummary: 'partial fetch failure',
        }),
      },
    };

    const result = await markCalendarImportRunFinished(db as never, {
      id: 'cir_1',
      status: 'succeeded_with_errors',
      importedCount: 10,
      skippedCount: 1,
      failedCount: 2,
      errorSummary: 'partial fetch failure',
    });

    expect(result.status).toBe('succeeded_with_errors');
    expect(db.calendarImportRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_1' },
        data: expect.objectContaining({
          status: 'succeeded_with_errors',
          importedCount: 10,
          skippedCount: 1,
          failedCount: 2,
          errorSummary: 'partial fetch failure',
          finishedAt: expect.any(Date),
        }),
      }),
    );
  });
});
