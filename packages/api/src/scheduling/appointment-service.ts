import { capQueryRange, generateWindowInstances, renderWindowForViewer } from './time.js';
import { enqueueSchedulingNotification } from './notification-service.js';
import type { BookableWindowRule, GeneratedWindowInstance, SchedulingCapability } from './types.js';

const APPOINTMENT_REQUEST_CAPABILITY: SchedulingCapability = 'appointment_request';
const ACTIVE_APPOINTMENT_STATES = ['pending_held', 'confirmed_shared'] as const;

interface ServiceLinkRecord {
  id: string;
  status?: string;
  capabilities?: SchedulingCapability[];
}

interface AppointmentRecord {
  id: string;
  providerAccountId: string;
  consumerAccountId: string;
  status: 'pending_held' | 'confirmed_shared' | 'released';
}

interface AppointmentEventRecord {
  appointmentId: string;
  toState: 'pending_held' | 'confirmed_shared' | 'released';
  actorAccountId: string;
  actorRole: 'provider' | 'consumer';
  reason?: string | null;
}

interface SchedulingNotificationRecord {
  id: string;
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  payload: unknown;
}

interface AppointmentClient {
  serviceLink: {
    findFirst(args: { where: Record<string, unknown> }): Promise<ServiceLinkRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  bookableWindow: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; rule: unknown } | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ id: string; rule: unknown }>>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  bookableWindowExclusion: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{ bookableWindowId?: string; instanceStart: Date | string; instanceEnd: Date | string }>>;
  };
  appointmentRequest: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<Array<Record<string, unknown>>>;
    create(args: { data: Record<string, unknown> }): Promise<AppointmentRecord>;
    findFirst(args: { where: Record<string, unknown> }): Promise<AppointmentRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  appointmentEvent: {
    findFirst(args: { where: Record<string, unknown> }): Promise<AppointmentEventRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  schedulingNotification: {
    create(args: { data: Record<string, unknown> }): Promise<SchedulingNotificationRecord>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<SchedulingNotificationRecord[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  $transaction?<T>(fn: (client: AppointmentWriteClient) => Promise<T>): Promise<T>;
}

type AppointmentWriteClient = Pick<
  AppointmentClient,
  'serviceLink' | 'bookableWindow' | 'bookableWindowExclusion' | 'appointmentRequest' | 'appointmentEvent'
>;

interface PendingRequestRecord {
  id: string;
  createdAt: Date | string;
  consumer?: { displayName?: string | null } | null;
  instanceStart: Date | string;
  instanceEnd: Date | string;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function toIsoDateTime(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function requireActiveServiceLink(
  client: Pick<AppointmentClient, 'serviceLink'>,
  providerAccountId: string,
  consumerAccountId: string,
): Promise<ServiceLinkRecord> {
  const serviceLink = await client.serviceLink.findFirst({
    where: {
      providerAccountId,
      consumerAccountId,
      status: 'active',
      capabilities: { has: APPOINTMENT_REQUEST_CAPABILITY },
    },
  });
  if (!serviceLink) {
    throw new Error('service_link_required');
  }
  return serviceLink;
}

async function runAppointmentWrite<T>(
  client: AppointmentClient,
  fn: (writeClient: AppointmentWriteClient) => Promise<T>,
): Promise<T> {
  if (client.$transaction) {
    return client.$transaction(fn);
  }
  return fn(client);
}

async function requireAvailableWindowInstance(
  client: Pick<AppointmentClient, 'bookableWindow' | 'bookableWindowExclusion' | 'appointmentRequest'>,
  input: {
    providerAccountId: string;
    bookableWindowId: string;
    instanceStart: string;
    instanceEnd: string;
  },
): Promise<void> {
  const bookableWindow = await client.bookableWindow.findFirst({
    where: {
      id: input.bookableWindowId,
      providerAccountId: input.providerAccountId,
      capability: APPOINTMENT_REQUEST_CAPABILITY,
      status: 'active',
    },
  });
  if (!bookableWindow) {
    throw new Error('slot_unavailable');
  }

  const exclusions = await client.bookableWindowExclusion.findMany({
    where: { bookableWindowId: input.bookableWindowId },
    select: { instanceStart: true, instanceEnd: true },
  });
  const excluded = exclusions.map((item) => ({
    instanceStart: toIsoDateTime(item.instanceStart),
    instanceEnd: toIsoDateTime(item.instanceEnd),
  }));
  const occupied = await client.appointmentRequest.findMany({
    where: {
      providerAccountId: input.providerAccountId,
      status: { in: [...ACTIVE_APPOINTMENT_STATES] },
    },
    select: { instanceStart: true, instanceEnd: true },
  });
  const occupiedPairs = occupied.map((item) => ({
    instanceStart: toIsoDateTime(item['instanceStart'] as Date | string),
    instanceEnd: toIsoDateTime(item['instanceEnd'] as Date | string),
  }));
  const date = input.instanceStart.slice(0, 10);
  const instances = generateWindowInstances({
    bookableWindowId: input.bookableWindowId,
    rule: bookableWindow.rule as BookableWindowRule,
    dateFrom: addUtcDays(date, -1),
    dateTo: addUtcDays(date, 1),
    excluded,
    occupied: occupiedPairs,
  });
  const requestedStart = toIsoDateTime(input.instanceStart);
  const requestedEnd = toIsoDateTime(input.instanceEnd);
  const isGeneratedAndAvailable = instances.some(
    (instance) => instance.instanceStart === requestedStart && instance.instanceEnd === requestedEnd,
  );
  if (!isGeneratedAndAvailable) {
    throw new Error('slot_unavailable');
  }
}

async function guardActiveServiceLink(
  client: Pick<AppointmentClient, 'serviceLink'>,
  input: {
    serviceLinkId: string;
    providerAccountId: string;
    consumerAccountId: string;
  },
): Promise<void> {
  const guarded = await client.serviceLink.updateMany({
    where: {
      id: input.serviceLinkId,
      providerAccountId: input.providerAccountId,
      consumerAccountId: input.consumerAccountId,
      status: 'active',
      capabilities: { has: APPOINTMENT_REQUEST_CAPABILITY },
    },
    data: { status: 'active' },
  });
  if (guarded.count !== 1) {
    throw new Error('service_link_required');
  }
}

async function guardActiveBookableWindow(
  client: Pick<AppointmentClient, 'bookableWindow'>,
  input: {
    providerAccountId: string;
    bookableWindowId: string;
  },
): Promise<void> {
  const guarded = await client.bookableWindow.updateMany({
    where: {
      id: input.bookableWindowId,
      providerAccountId: input.providerAccountId,
      capability: APPOINTMENT_REQUEST_CAPABILITY,
      status: 'active',
    },
    data: { status: 'active' },
  });
  if (guarded.count !== 1) {
    throw new Error('slot_unavailable');
  }
}

async function writeTransitionEvent(
  client: Pick<AppointmentClient, 'appointmentEvent'>,
  data: {
    appointmentId: string;
    fromState: 'pending_held' | 'confirmed_shared';
    toState: 'confirmed_shared' | 'released';
    actorAccountId: string;
    actorRole: 'provider' | 'consumer';
    idempotencyKey?: string | null;
    reason: string;
  },
): Promise<void> {
  await client.appointmentEvent.create({ data });
}

async function findIdempotentEvent(
  client: Pick<AppointmentClient, 'appointmentEvent'>,
  where: Record<string, unknown> & { idempotencyKey?: string },
): Promise<AppointmentEventRecord | null> {
  if (!where.idempotencyKey) return null;
  return client.appointmentEvent.findFirst({ where });
}

function notificationText(kind: string): string {
  const messages: Record<string, string> = {
    appointment_request: '你有一个新的预约请求，请确认或拒绝。',
    appointment_confirmed: '你的预约已确认。',
    appointment_rejected: '你的预约请求已被拒绝。',
    appointment_cancelled: '预约已取消。',
  };
  return messages[kind] ?? '预约状态已更新。';
}

async function enqueueAppointmentNotification(
  client: AppointmentClient,
  input: {
    appointmentId: string;
    recipientAccountId: string;
    idempotencyKey: string;
    kind: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await enqueueSchedulingNotification(client, {
      appointmentId: input.appointmentId,
      recipientAccountId: input.recipientAccountId,
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      text: notificationText(input.kind),
      metadata: input.metadata,
    });
  } catch {
    // The notification intent is persisted before delivery; retry handles failures.
  }
}

async function enqueueRequestNotification(client: AppointmentClient, request: AppointmentRecord): Promise<void> {
  await enqueueAppointmentNotification(client, {
    appointmentId: request.id,
    recipientAccountId: request.providerAccountId,
    idempotencyKey: `appt:${request.id}:request:A`,
    kind: 'appointment_request',
    metadata: {
      request_id: request.id,
      provider_account_id: request.providerAccountId,
      consumer_account_id: request.consumerAccountId,
      allowed_actions: ['confirm', 'reject'],
    },
  });
}

async function enqueueProviderDecisionNotification(
  client: AppointmentClient,
  request: AppointmentRecord,
  input: { kind: 'appointment_confirmed' | 'appointment_rejected'; notificationAction: 'confirmed' | 'rejected' },
): Promise<void> {
  await enqueueAppointmentNotification(client, {
    appointmentId: request.id,
    recipientAccountId: request.consumerAccountId,
    idempotencyKey: `appt:${request.id}:${input.notificationAction}:B`,
    kind: input.kind,
    metadata: {
      request_id: request.id,
      provider_account_id: request.providerAccountId,
      consumer_account_id: request.consumerAccountId,
    },
  });
}

async function enqueueCancellationNotification(
  client: AppointmentClient,
  request: AppointmentRecord,
  input: { actorRole: 'provider' | 'consumer'; releaseReason: 'cancelled_by_a' | 'cancelled_by_b' },
): Promise<void> {
  await enqueueAppointmentNotification(client, {
    appointmentId: request.id,
    recipientAccountId: input.actorRole === 'provider' ? request.consumerAccountId : request.providerAccountId,
    idempotencyKey: `appt:${request.id}:${input.releaseReason}:${input.actorRole === 'provider' ? 'B' : 'A'}`,
    kind: 'appointment_cancelled',
    metadata: {
      request_id: request.id,
      provider_account_id: request.providerAccountId,
      consumer_account_id: request.consumerAccountId,
      release_reason: input.releaseReason,
    },
  });
}

export async function queryBookableWindows(
  client: AppointmentClient,
  input: {
    providerAccountId: string;
    consumerAccountId: string;
    dateFrom: string;
    dateTo?: string;
    viewerTimezone?: string;
  },
): Promise<{ serviceLinkId: string; instances: Array<GeneratedWindowInstance & ReturnType<typeof renderWindowForViewer>> }> {
  const serviceLink = await requireActiveServiceLink(
    client,
    input.providerAccountId,
    input.consumerAccountId,
  );
  const { dateFrom, dateTo } = capQueryRange(input.dateFrom, input.dateTo);
  const windows = await client.bookableWindow.findMany({
    where: {
      providerAccountId: input.providerAccountId,
      capability: APPOINTMENT_REQUEST_CAPABILITY,
      status: 'active',
    },
  });
  const exclusions = await client.bookableWindowExclusion.findMany({
    where: { bookableWindow: { providerAccountId: input.providerAccountId } },
    select: { bookableWindowId: true, instanceStart: true, instanceEnd: true },
  });
  const occupied = await client.appointmentRequest.findMany({
    where: {
      providerAccountId: input.providerAccountId,
      status: { in: [...ACTIVE_APPOINTMENT_STATES] },
    },
    select: { instanceStart: true, instanceEnd: true },
  });
  const occupiedPairs = occupied.map((item) => ({
    instanceStart: toIsoDateTime(item['instanceStart'] as Date | string),
    instanceEnd: toIsoDateTime(item['instanceEnd'] as Date | string),
  }));
  const viewerTimezone = input.viewerTimezone || 'UTC';
  const instances = windows.flatMap((window) => {
    const excludedPairs = exclusions
      .filter((item) => item.bookableWindowId === window.id)
      .map((item) => ({
        instanceStart: toIsoDateTime(item.instanceStart),
        instanceEnd: toIsoDateTime(item.instanceEnd),
      }));

    return generateWindowInstances({
      bookableWindowId: window.id,
      rule: window.rule as BookableWindowRule,
      dateFrom,
      dateTo,
      excluded: excludedPairs,
      occupied: occupiedPairs,
    }).map((instance) => ({
      ...instance,
      ...renderWindowForViewer(instance, viewerTimezone),
    }));
  });

  return { serviceLinkId: serviceLink.id, instances };
}

export async function requestAppointment(
  client: AppointmentClient,
  input: {
    providerAccountId: string;
    consumerAccountId: string;
    bookableWindowId: string;
    instanceStart: string;
    instanceEnd: string;
    timezone: string;
    idempotencyKey: string;
  },
): Promise<AppointmentRecord> {
  const existing = input.idempotencyKey
    ? await client.appointmentRequest.findFirst({
        where: {
          providerAccountId: input.providerAccountId,
          consumerAccountId: input.consumerAccountId,
          idempotencyKey: input.idempotencyKey,
        },
      })
    : null;
  if (existing) {
    await enqueueRequestNotification(client, existing);
    return existing;
  }

  try {
    const request = await runAppointmentWrite(client, async (writeClient) => {
      const serviceLink = await requireActiveServiceLink(
        writeClient,
        input.providerAccountId,
        input.consumerAccountId,
      );
      await requireAvailableWindowInstance(writeClient, input);
      await guardActiveServiceLink(writeClient, {
        serviceLinkId: serviceLink.id,
        providerAccountId: input.providerAccountId,
        consumerAccountId: input.consumerAccountId,
      });
      await guardActiveBookableWindow(writeClient, input);
      const request = await writeClient.appointmentRequest.create({
        data: {
          providerAccountId: input.providerAccountId,
          consumerAccountId: input.consumerAccountId,
          serviceLinkId: serviceLink.id,
          bookableWindowId: input.bookableWindowId,
          instanceStart: new Date(input.instanceStart),
          instanceEnd: new Date(input.instanceEnd),
          timezone: input.timezone,
          idempotencyKey: input.idempotencyKey || null,
          status: 'pending_held',
        },
      });
      await writeClient.appointmentEvent.create({
        data: {
          appointmentId: request.id,
          fromState: null,
          toState: 'pending_held',
          actorAccountId: input.consumerAccountId,
          actorRole: 'consumer',
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:event:requested` : null,
          reason: 'requested',
        },
      });
      return request;
    });
    await enqueueRequestNotification(client, request);
    return request;
  } catch (error) {
    if (isUniqueConflict(error)) {
      const replayed = input.idempotencyKey
        ? await client.appointmentRequest.findFirst({
            where: {
              providerAccountId: input.providerAccountId,
              consumerAccountId: input.consumerAccountId,
              idempotencyKey: input.idempotencyKey,
            },
          })
        : null;
      if (replayed) {
        await enqueueRequestNotification(client, replayed);
        return replayed;
      }
      throw new Error('slot_unavailable');
    }
    throw error;
  }
}

export async function confirmAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'confirmed_shared' }> {
  const replayed = await findIdempotentEvent(client, {
    appointmentId: input.requestId,
    actorAccountId: input.actorAccountId,
    actorRole: 'provider',
    toState: 'confirmed_shared',
    reason: 'confirmed_by_a',
    idempotencyKey: input.idempotencyKey,
  });
  if (replayed) {
    const request = await client.appointmentRequest.findFirst({
      where: { id: input.requestId, providerAccountId: input.actorAccountId },
    });
    if (!request) {
      throw new Error('appointment_not_found');
    }
    await enqueueProviderDecisionNotification(client, request, {
      kind: 'appointment_confirmed',
      notificationAction: 'confirmed',
    });
    return { id: input.requestId, status: 'confirmed_shared' };
  }
  const current = await client.appointmentRequest.findFirst({
    where: {
      id: input.requestId,
      providerAccountId: input.actorAccountId,
      status: 'pending_held',
    },
  });
  if (!current) {
    throw new Error('appointment_not_found');
  }
  const result = await runAppointmentWrite(client, async (writeClient) => {
    const updated = await writeClient.appointmentRequest.updateMany({
      where: {
        id: input.requestId,
        providerAccountId: input.actorAccountId,
        status: 'pending_held',
      },
      data: { status: 'confirmed_shared' },
    });
    if (updated.count !== 1) {
      throw new Error('appointment_not_found');
    }
    await writeTransitionEvent(writeClient, {
      appointmentId: input.requestId,
      fromState: 'pending_held',
      toState: 'confirmed_shared',
      actorAccountId: input.actorAccountId,
      actorRole: 'provider',
      idempotencyKey: input.idempotencyKey || null,
      reason: 'confirmed_by_a',
    });
    return { id: input.requestId, status: 'confirmed_shared' as const };
  });
  await enqueueProviderDecisionNotification(client, current, {
    kind: 'appointment_confirmed',
    notificationAction: 'confirmed',
  });
  return result;
}

export async function rejectAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'released'; releaseReason: 'rejected_by_a' }> {
  const replayed = await findIdempotentEvent(client, {
    appointmentId: input.requestId,
    actorAccountId: input.actorAccountId,
    actorRole: 'provider',
    toState: 'released',
    reason: 'rejected_by_a',
    idempotencyKey: input.idempotencyKey,
  });
  if (replayed) {
    const request = await client.appointmentRequest.findFirst({
      where: { id: input.requestId, providerAccountId: input.actorAccountId },
    });
    if (!request) {
      throw new Error('appointment_not_found');
    }
    await enqueueProviderDecisionNotification(client, request, {
      kind: 'appointment_rejected',
      notificationAction: 'rejected',
    });
    return { id: input.requestId, status: 'released', releaseReason: 'rejected_by_a' };
  }
  const current = await client.appointmentRequest.findFirst({
    where: {
      id: input.requestId,
      providerAccountId: input.actorAccountId,
      status: 'pending_held',
    },
  });
  if (!current) {
    throw new Error('appointment_not_found');
  }
  const result = await runAppointmentWrite(client, async (writeClient) => {
    const updated = await writeClient.appointmentRequest.updateMany({
      where: {
        id: input.requestId,
        providerAccountId: input.actorAccountId,
        status: 'pending_held',
      },
      data: {
        status: 'released',
        releaseReason: 'rejected_by_a',
        releasedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new Error('appointment_not_found');
    }
    await writeTransitionEvent(writeClient, {
      appointmentId: input.requestId,
      fromState: 'pending_held',
      toState: 'released',
      actorAccountId: input.actorAccountId,
      actorRole: 'provider',
      idempotencyKey: input.idempotencyKey || null,
      reason: 'rejected_by_a',
    });
    return { id: input.requestId, status: 'released' as const, releaseReason: 'rejected_by_a' as const };
  });
  await enqueueProviderDecisionNotification(client, current, {
    kind: 'appointment_rejected',
    notificationAction: 'rejected',
  });
  return result;
}

export async function cancelAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'released'; releaseReason: 'cancelled_by_a' | 'cancelled_by_b' }> {
  const replayed = await findIdempotentEvent(client, {
    appointmentId: input.requestId,
    actorAccountId: input.actorAccountId,
    toState: 'released',
    reason: { in: ['cancelled_by_a', 'cancelled_by_b'] },
    idempotencyKey: input.idempotencyKey,
  });
  if (replayed) {
    const releaseReason =
      replayed.reason === 'cancelled_by_a' || replayed.reason === 'cancelled_by_b'
        ? replayed.reason
        : 'cancelled_by_b';
    const request = await client.appointmentRequest.findFirst({
      where: {
        id: input.requestId,
        OR: [
          { providerAccountId: input.actorAccountId },
          { consumerAccountId: input.actorAccountId },
        ],
      },
    });
    if (!request) {
      throw new Error('appointment_not_found');
    }
    await enqueueCancellationNotification(client, request, {
      actorRole: replayed.actorRole,
      releaseReason,
    });
    return { id: input.requestId, status: 'released', releaseReason };
  }
  const current = await client.appointmentRequest.findFirst({
    where: {
      id: input.requestId,
      status: { in: [...ACTIVE_APPOINTMENT_STATES] },
      OR: [
        { providerAccountId: input.actorAccountId },
        { consumerAccountId: input.actorAccountId },
      ],
    },
  });
  if (!current) {
    throw new Error('appointment_not_found');
  }

  const actorRole = current.providerAccountId === input.actorAccountId ? 'provider' : 'consumer';
  const releaseReason: 'cancelled_by_a' | 'cancelled_by_b' =
    actorRole === 'provider' ? 'cancelled_by_a' : 'cancelled_by_b';
  const result = await runAppointmentWrite(client, async (writeClient) => {
    const updated = await writeClient.appointmentRequest.updateMany({
      where: {
        id: current.id,
        status: current.status,
        OR: [
          { providerAccountId: input.actorAccountId },
          { consumerAccountId: input.actorAccountId },
        ],
      },
      data: {
        status: 'released',
        releaseReason,
        releasedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new Error('appointment_not_found');
    }
    const fromState = current.status === 'confirmed_shared' ? 'confirmed_shared' : 'pending_held';
    await writeTransitionEvent(writeClient, {
      appointmentId: current.id,
      fromState,
      toState: 'released',
      actorAccountId: input.actorAccountId,
      actorRole,
      idempotencyKey: input.idempotencyKey || null,
      reason: releaseReason,
    });
    return { id: current.id, status: 'released' as const, releaseReason };
  });
  await enqueueCancellationNotification(client, current, {
    actorRole,
    releaseReason,
  });
  return result;
}

export async function listPendingRequests(
  client: AppointmentClient,
  input: { providerAccountId: string; now: Date },
): Promise<
  Array<{
    id: string;
    requesterDisplayName: string | null;
    instanceStart: string;
    instanceEnd: string;
    createdAt: string;
    holdAgeMinutes: number;
  }>
> {
  const requests = (await client.appointmentRequest.findMany({
    where: { providerAccountId: input.providerAccountId, status: 'pending_held' },
    orderBy: { createdAt: 'asc' },
    include: { consumer: { select: { displayName: true } } },
  })) as unknown as PendingRequestRecord[];

  return requests.map((request) => {
    const createdAt = toIsoDateTime(request.createdAt);
    return {
      id: request.id,
      requesterDisplayName: request.consumer?.displayName ?? null,
      instanceStart: toIsoDateTime(request.instanceStart),
      instanceEnd: toIsoDateTime(request.instanceEnd),
      createdAt,
      holdAgeMinutes: Math.floor((input.now.getTime() - new Date(createdAt).getTime()) / 60000),
    };
  });
}
