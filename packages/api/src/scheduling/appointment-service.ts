import { capQueryRange, generateWindowInstances, renderWindowForViewer } from './time.js';
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
  status: 'pending_held' | 'confirmed_shared';
}

interface AppointmentClient {
  serviceLink: {
    findFirst(args: { where: Record<string, unknown> }): Promise<ServiceLinkRecord | null>;
  };
  bookableWindow: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; rule: unknown } | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ id: string; rule: unknown }>>;
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
    create(args: { data: Record<string, unknown> }): Promise<{ id: string } & Record<string, unknown>>;
    findFirst(args: { where: Record<string, unknown> }): Promise<AppointmentRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  appointmentEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  $transaction?<T>(fn: (client: AppointmentWriteClient) => Promise<T>): Promise<T>;
}

type AppointmentWriteClient = Pick<AppointmentClient, 'appointmentRequest' | 'appointmentEvent'>;

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
  client: Pick<AppointmentClient, 'bookableWindow' | 'bookableWindowExclusion'>,
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
  const date = input.instanceStart.slice(0, 10);
  const instances = generateWindowInstances({
    bookableWindowId: input.bookableWindowId,
    rule: bookableWindow.rule as BookableWindowRule,
    dateFrom: addUtcDays(date, -1),
    dateTo: addUtcDays(date, 1),
    excluded,
    occupied: [],
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

async function writeTransitionEvent(
  client: Pick<AppointmentClient, 'appointmentEvent'>,
  data: {
    appointmentId: string;
    fromState: 'pending_held' | 'confirmed_shared';
    toState: 'confirmed_shared' | 'released';
    actorAccountId: string;
    actorRole: 'provider' | 'consumer';
    reason: string;
  },
): Promise<void> {
  await client.appointmentEvent.create({ data });
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
): Promise<{ id: string } & Record<string, unknown>> {
  void input.idempotencyKey;
  const serviceLink = await requireActiveServiceLink(
    client,
    input.providerAccountId,
    input.consumerAccountId,
  );
  await requireAvailableWindowInstance(client, input);

  try {
    return await runAppointmentWrite(client, async (writeClient) => {
      const request = await writeClient.appointmentRequest.create({
        data: {
          providerAccountId: input.providerAccountId,
          consumerAccountId: input.consumerAccountId,
          serviceLinkId: serviceLink.id,
          bookableWindowId: input.bookableWindowId,
          instanceStart: new Date(input.instanceStart),
          instanceEnd: new Date(input.instanceEnd),
          timezone: input.timezone,
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
          reason: 'requested',
        },
      });
      return request;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new Error('slot_unavailable');
    }
    throw error;
  }
}

export async function confirmAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'confirmed_shared' }> {
  void input.idempotencyKey;
  return runAppointmentWrite(client, async (writeClient) => {
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
      reason: 'confirmed_by_a',
    });
    return { id: input.requestId, status: 'confirmed_shared' };
  });
}

export async function rejectAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'released'; releaseReason: 'rejected_by_a' }> {
  void input.idempotencyKey;
  return runAppointmentWrite(client, async (writeClient) => {
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
      reason: 'rejected_by_a',
    });
    return { id: input.requestId, status: 'released', releaseReason: 'rejected_by_a' };
  });
}

export async function cancelAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'released'; releaseReason: 'cancelled_by_a' | 'cancelled_by_b' }> {
  void input.idempotencyKey;
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
  const releaseReason = actorRole === 'provider' ? 'cancelled_by_a' : 'cancelled_by_b';
  return runAppointmentWrite(client, async (writeClient) => {
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
      await writeClient.appointmentRequest.findFirst({
        where: {
          id: current.id,
          OR: [
            { providerAccountId: input.actorAccountId },
            { consumerAccountId: input.actorAccountId },
          ],
        },
      });
      throw new Error('appointment_not_found');
    }
    await writeTransitionEvent(writeClient, {
      appointmentId: current.id,
      fromState: current.status,
      toState: 'released',
      actorAccountId: input.actorAccountId,
      actorRole,
      reason: releaseReason,
    });
    return { id: current.id, status: 'released', releaseReason };
  });
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
