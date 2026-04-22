import type {
  CalendarImportRunProvider as PrismaCalendarImportRunProvider,
  CalendarImportRunStatus as PrismaCalendarImportRunStatus,
  CalendarImportRunTriggerSource as PrismaCalendarImportRunTriggerSource,
} from '@prisma/client';

export type CalendarImportRunProvider = PrismaCalendarImportRunProvider;
export type CalendarImportRunStatus = PrismaCalendarImportRunStatus;
export type CalendarImportRunTriggerSource = PrismaCalendarImportRunTriggerSource;

export interface CalendarImportRunRecord {
  id: string;
  customerId: string;
  identityId: string;
  targetConversationId: string;
  targetCharacterId: string;
  provider: CalendarImportRunProvider;
  triggerSource: CalendarImportRunTriggerSource;
  status: CalendarImportRunStatus;
  providerAccountEmail: string | null;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  errorSummary: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarImportRunClient {
  calendarImportRun: {
    create(args: { data: CalendarImportRunCreateData }): Promise<CalendarImportRunRecord>;
    updateMany(args: {
      where: { id: string; status: CalendarImportRunStatus };
      data: CalendarImportRunUpdateData;
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
    }): Promise<CalendarImportRunRecord | null>;
    findFirst(args: {
      where: {
        customerId?: string;
        identityId?: string;
      };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<CalendarImportRunRecord | null>;
  };
}

export interface CalendarImportRunCreateInput {
  customerId: string;
  identityId: string;
  targetConversationId: string;
  targetCharacterId: string;
  triggerSource: CalendarImportRunTriggerSource;
}

export interface CalendarImportRunImportingInput {
  id: string;
  providerAccountEmail?: string | null;
}

export interface CalendarImportRunFinishedInput {
  id: string;
  status: Exclude<CalendarImportRunStatus, 'authorizing' | 'importing'>;
  providerAccountEmail?: string | null;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  errorSummary?: string | null;
}

export interface CalendarImportRunLookupInput {
  customerId: string;
  identityId: string;
}

export interface CalendarImportRunCreateData {
  customerId: string;
  identityId: string;
  targetConversationId: string;
  targetCharacterId: string;
  provider: CalendarImportRunProvider;
  triggerSource: CalendarImportRunTriggerSource;
  status: CalendarImportRunStatus;
}

export interface CalendarImportRunUpdateData {
  status?: CalendarImportRunStatus;
  providerAccountEmail?: string | null;
  importedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  errorSummary?: string | null;
  finishedAt?: Date | null;
}

function buildOptionalAssignment<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value } as Record<string, T>;
}

async function updateCalendarImportRunTransition(
  client: CalendarImportRunClient,
  id: string,
  fromStatus: CalendarImportRunStatus,
  data: CalendarImportRunUpdateData,
): Promise<CalendarImportRunRecord> {
  const updated = await client.calendarImportRun.updateMany({
    where: { id, status: fromStatus },
    data,
  });

  if (updated.count !== 1) {
    throw new Error(`calendar_import_run_invalid_transition:${id}`);
  }

  const run = await client.calendarImportRun.findUnique({ where: { id } });
  if (!run) {
    throw new Error(`calendar_import_run_missing:${id}`);
  }

  return run;
}

export async function createCalendarImportRun(
  client: CalendarImportRunClient,
  input: CalendarImportRunCreateInput,
) {
  return client.calendarImportRun.create({
    data: {
      customerId: input.customerId,
      identityId: input.identityId,
      targetConversationId: input.targetConversationId,
      targetCharacterId: input.targetCharacterId,
      provider: 'google_calendar',
      triggerSource: input.triggerSource,
      status: 'authorizing',
    },
  });
}

export async function markCalendarImportRunImporting(
  client: CalendarImportRunClient,
  input: CalendarImportRunImportingInput,
) {
  return updateCalendarImportRunTransition(client, input.id, 'authorizing', {
    status: 'importing',
    ...buildOptionalAssignment('providerAccountEmail', input.providerAccountEmail),
  });
}

export async function markCalendarImportRunFinished(
  client: CalendarImportRunClient,
  input: CalendarImportRunFinishedInput,
) {
  return updateCalendarImportRunTransition(client, input.id, 'importing', {
    status: input.status,
    finishedAt: new Date(),
    importedCount: input.importedCount,
    skippedCount: input.skippedCount,
    failedCount: input.failedCount,
    ...buildOptionalAssignment('providerAccountEmail', input.providerAccountEmail),
    ...buildOptionalAssignment('errorSummary', input.errorSummary),
  });
}

export async function getLatestCalendarImportRun(
  client: CalendarImportRunClient,
  input: CalendarImportRunLookupInput,
) {
  return client.calendarImportRun.findFirst({
    where: {
      customerId: input.customerId,
      identityId: input.identityId,
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
}
