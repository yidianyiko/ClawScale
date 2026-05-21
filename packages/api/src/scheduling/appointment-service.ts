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
}

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
  const serviceLink = await requireActiveServiceLink(
    client,
    input.providerAccountId,
    input.consumerAccountId,
  );

  try {
    const request = await client.appointmentRequest.create({
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
    await client.appointmentEvent.create({
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
  const updated = await client.appointmentRequest.updateMany({
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
  await writeTransitionEvent(client, {
    appointmentId: input.requestId,
    fromState: 'pending_held',
    toState: 'confirmed_shared',
    actorAccountId: input.actorAccountId,
    actorRole: 'provider',
    reason: 'confirmed_by_a',
  });
  return { id: input.requestId, status: 'confirmed_shared' };
}

export async function rejectAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'released'; releaseReason: 'rejected_by_a' }> {
  const updated = await client.appointmentRequest.updateMany({
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
  await writeTransitionEvent(client, {
    appointmentId: input.requestId,
    fromState: 'pending_held',
    toState: 'released',
    actorAccountId: input.actorAccountId,
    actorRole: 'provider',
    reason: 'rejected_by_a',
  });
  return { id: input.requestId, status: 'released', releaseReason: 'rejected_by_a' };
}

export async function cancelAppointment(
  client: AppointmentClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<{ id: string; status: 'released'; releaseReason: 'cancelled_by_a' | 'cancelled_by_b' }> {
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
  const updated = await client.appointmentRequest.updateMany({
    where: {
      id: current.id,
      status: { in: [...ACTIVE_APPOINTMENT_STATES] },
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
  await writeTransitionEvent(client, {
    appointmentId: current.id,
    fromState: current.status,
    toState: 'released',
    actorAccountId: input.actorAccountId,
    actorRole,
    reason: releaseReason,
  });
  return { id: current.id, status: 'released', releaseReason };
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
