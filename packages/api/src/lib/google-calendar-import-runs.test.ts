import { describe, expect, it, vi } from 'vitest';
import {
  beginCalendarImportRun,
  createCalendarImportRun,
  getLatestCalendarImportRun,
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
        updateMany: vi.fn().mockResolvedValue({
          count: 1,
        }),
        findUnique: vi.fn().mockResolvedValue({
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
    expect(db.calendarImportRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_1', status: 'authorizing' },
        data: expect.objectContaining({
          status: 'importing',
          providerAccountEmail: 'user@example.com',
        }),
      }),
    );
  });

  it('treats repeated importing calls as idempotent when the run is already importing', async () => {
    const current = {
      id: 'cir_1',
      status: 'importing',
      providerAccountEmail: 'user@example.com',
    };
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(current),
      },
    };

    await expect(
      markCalendarImportRunImporting(db as never, {
        id: 'cir_1',
        providerAccountEmail: 'user@example.com',
      }),
    ).resolves.toEqual(current);

    expect(db.calendarImportRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_1', status: 'authorizing' },
      }),
    );
    expect(db.calendarImportRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'cir_1' },
    });
  });

  it('reports whether the callback won the authorizing to importing transition', async () => {
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'cir_1',
          status: 'importing',
          providerAccountEmail: null,
        }),
      },
    };

    await expect(
      beginCalendarImportRun(db as never, {
        id: 'cir_1',
      }),
    ).resolves.toEqual({
      won: true,
      run: {
        id: 'cir_1',
        status: 'importing',
        providerAccountEmail: null,
      },
    });
  });

  it('tells the callback to bail out when another request already moved the run to importing', async () => {
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'cir_1',
          status: 'importing',
          providerAccountEmail: 'user@example.com',
        }),
      },
    };

    await expect(
      beginCalendarImportRun(db as never, {
        id: 'cir_1',
      }),
    ).resolves.toEqual({
      won: false,
      run: {
        id: 'cir_1',
        status: 'importing',
        providerAccountEmail: 'user@example.com',
      },
    });
  });

  it('marks a finished import run with summary counts and error details', async () => {
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({
          count: 1,
        }),
        findUnique: vi.fn().mockResolvedValue({
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
    expect(db.calendarImportRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_1', status: 'importing' },
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

  it('treats repeated finished calls as idempotent when the run is already finished', async () => {
    const current = {
      id: 'cir_1',
      status: 'succeeded_with_errors',
      importedCount: 10,
      skippedCount: 1,
      failedCount: 2,
      errorSummary: 'partial fetch failure',
      providerAccountEmail: 'user@example.com',
    };
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(current),
      },
    };

    await expect(
      markCalendarImportRunFinished(db as never, {
        id: 'cir_1',
        status: 'succeeded_with_errors',
        importedCount: 10,
        skippedCount: 1,
        failedCount: 2,
        errorSummary: 'partial fetch failure',
      }),
    ).resolves.toEqual(current);

    expect(db.calendarImportRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_1', status: 'importing' },
      }),
    );
    expect(db.calendarImportRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'cir_1' },
    });
  });

  it('omits optional fields when marking an import run importing or finished', async () => {
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'cir_1',
          status: 'failed',
          importedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          providerAccountEmail: null,
          errorSummary: null,
        }),
      },
    };

    await markCalendarImportRunFinished(db as never, {
      id: 'cir_1',
      status: 'failed',
      importedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });

    const data = db.calendarImportRun.updateMany.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty('providerAccountEmail');
    expect(data).not.toHaveProperty('errorSummary');
  });

  it('rejects transition attempts from a terminal run back to importing', async () => {
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'cir_terminal',
          status: 'failed',
        }),
      },
    };

    await expect(
      markCalendarImportRunImporting(db as never, {
        id: 'cir_terminal',
        providerAccountEmail: 'user@example.com',
      }),
    ).rejects.toThrow('calendar_import_run_invalid_transition:cir_terminal');

    expect(db.calendarImportRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_terminal', status: 'authorizing' },
      }),
    );
    expect(db.calendarImportRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'cir_terminal' },
    });
  });

  it('rejects finishing a run that is still authorizing', async () => {
    const db = {
      calendarImportRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'cir_terminal',
          status: 'authorizing',
        }),
      },
    };

    await expect(
      markCalendarImportRunFinished(db as never, {
        id: 'cir_terminal',
        status: 'failed',
        importedCount: 10,
        skippedCount: 0,
        failedCount: 1,
      }),
    ).rejects.toThrow('calendar_import_run_invalid_transition:cir_terminal');

    expect(db.calendarImportRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cir_terminal', status: 'importing' },
      }),
    );
    expect(db.calendarImportRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'cir_terminal' },
    });
  });

  it('loads the latest run with deterministic ordering', async () => {
    const db = {
      calendarImportRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cir_2',
          status: 'authorizing',
        }),
      },
    };

    await getLatestCalendarImportRun(db as never, {
      customerId: 'ck_1',
      identityId: 'idt_1',
    });

    expect(db.calendarImportRun.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_1',
        identityId: 'idt_1',
      },
      orderBy: [
        { startedAt: 'desc' },
        { id: 'desc' },
      ],
    });
  });
});
