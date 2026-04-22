export type CalendarImportRunStatus =
  | 'authorizing'
  | 'importing'
  | 'succeeded'
  | 'succeeded_with_errors'
  | 'failed';

export type CalendarImportRunTriggerSource = 'manual_web' | 'whatsapp_claim_redirect';

export interface CalendarImportRunRecord {
  id: string;
  customerId: string;
  identityId: string;
  targetConversationId: string;
  targetCharacterId: string;
  provider: string;
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
    update(args: {
      where: { id: string };
      data: CalendarImportRunUpdateData;
    }): Promise<CalendarImportRunRecord>;
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
  provider: 'google_calendar';
  triggerSource: CalendarImportRunTriggerSource;
  status: 'authorizing';
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
  return client.calendarImportRun.update({
    where: { id: input.id },
    data: {
      status: 'importing',
      ...buildOptionalAssignment('providerAccountEmail', input.providerAccountEmail),
    },
  });
}

export async function markCalendarImportRunFinished(
  client: CalendarImportRunClient,
  input: CalendarImportRunFinishedInput,
) {
  return client.calendarImportRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      finishedAt: new Date(),
      importedCount: input.importedCount,
      skippedCount: input.skippedCount,
      failedCount: input.failedCount,
      ...buildOptionalAssignment('providerAccountEmail', input.providerAccountEmail),
      ...buildOptionalAssignment('errorSummary', input.errorSummary),
    },
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
    orderBy: [{ startedAt: 'desc' }],
  });
}
