import type { SchedulingCapability } from './types.js';

const APPOINTMENT_REQUEST_CAPABILITY: SchedulingCapability = 'appointment_request';

interface ServiceLinkRecord {
  id: string;
  providerAccountId?: string;
  consumerAccountId?: string;
  status: 'active' | 'blocked' | 'removed';
  capabilities?: SchedulingCapability[];
}

interface ServiceLinkClient {
  serviceLink: {
    findFirst(args: { where: Record<string, unknown> }): Promise<ServiceLinkRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<ServiceLinkRecord>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  appointmentRequest: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  $transaction?<T>(fn: (client: ServiceLinkWriteClient) => Promise<T>): Promise<T>;
}

interface ServiceLinkPairInput {
  providerAccountId: string;
  consumerAccountId: string;
}

type ServiceLinkPairWhere = ServiceLinkPairInput & Record<string, unknown>;
type ServiceLinkWriteClient = Pick<ServiceLinkClient, 'serviceLink' | 'appointmentRequest'>;

function nonEmpty(value: string, code = 'invalid_input'): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(code);
  }
  return trimmed;
}

function pairWhere(input: ServiceLinkPairInput): ServiceLinkPairWhere {
  return {
    providerAccountId: nonEmpty(input.providerAccountId, 'invalid_provider_account'),
    consumerAccountId: nonEmpty(input.consumerAccountId, 'invalid_consumer_account'),
  };
}

function capabilities(): SchedulingCapability[] {
  return [APPOINTMENT_REQUEST_CAPABILITY];
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function activateExistingServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  existing: ServiceLinkRecord,
): Promise<ServiceLinkRecord> {
  if (existing.status === 'active' || existing.status === 'blocked') {
    return existing;
  }

  const activated = await client.serviceLink.updateMany({
    where: { id: existing.id, status: 'removed' },
    data: {
      status: 'active',
      removedAt: null,
      capabilities: capabilities(),
    },
  });

  const current = await findServiceLinkById(client, existing.id);
  if (!current) {
    throw new Error('service_link_not_found');
  }
  return current;
}

async function findServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  where: ServiceLinkPairWhere,
): Promise<ServiceLinkRecord | null> {
  return client.serviceLink.findFirst({ where });
}

async function findServiceLinkById(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  serviceLinkId: string,
): Promise<ServiceLinkRecord | null> {
  return client.serviceLink.findFirst({ where: { id: serviceLinkId } });
}

async function runServiceLinkWrite<T>(
  client: ServiceLinkClient,
  fn: (writeClient: ServiceLinkWriteClient) => Promise<T>,
): Promise<T> {
  if (client.$transaction) {
    return client.$transaction(fn);
  }
  return fn(client);
}

export async function createOrActivateServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  input: ServiceLinkPairInput,
): Promise<ServiceLinkRecord> {
  const where = pairWhere(input);
  const existing = await findServiceLink(client, where);

  if (existing) {
    return activateExistingServiceLink(client, existing);
  }

  try {
    return await client.serviceLink.create({
      data: {
        ...where,
        status: 'active',
        capabilities: capabilities(),
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const racedLink = await findServiceLink(client, where);
    if (!racedLink) {
      throw error;
    }
    return activateExistingServiceLink(client, racedLink);
  }
}

export async function blockServiceLink(
  client: ServiceLinkClient,
  input: ServiceLinkPairInput,
): Promise<ServiceLinkRecord> {
  const where = pairWhere(input);
  return runServiceLinkWrite(client, async (writeClient) => {
    const existing = await findServiceLink(writeClient, where);
    if (!existing) {
      throw new Error('service_link_not_found');
    }
    if (existing.status === 'removed') {
      throw new Error('service_link_not_blockable');
    }

    if (existing.status === 'blocked') {
      await writeClient.appointmentRequest.updateMany({
        where: { ...where, status: 'pending_held' },
        data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: new Date() },
      });
      return existing;
    }

    const blocked = await writeClient.serviceLink.updateMany({
      where: { id: existing.id, status: 'active' },
      data: {
        status: 'blocked',
        blockedAt: new Date(),
        capabilities: [],
      },
    });

    const current = await findServiceLinkById(writeClient, existing.id);
    if (!current) {
      throw new Error('service_link_not_found');
    }
    if (blocked.count === 0 && current.status === 'removed') {
      throw new Error('service_link_not_blockable');
    }
    if (current.status !== 'blocked') {
      throw new Error('service_link_not_blockable');
    }

    await writeClient.appointmentRequest.updateMany({
      where: { ...where, status: 'pending_held' },
      data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: new Date() },
    });

    return current;
  });
}

export async function unblockServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  input: ServiceLinkPairInput,
): Promise<ServiceLinkRecord> {
  const where = pairWhere(input);
  const existing = await findServiceLink(client, where);
  if (!existing) {
    throw new Error('service_link_not_found');
  }
  if (existing.status !== 'blocked') {
    throw new Error('service_link_not_blocked');
  }

  const unblocked = await client.serviceLink.updateMany({
    where: { id: existing.id, status: 'blocked' },
    data: {
      status: 'active',
      blockedAt: null,
      capabilities: capabilities(),
    },
  });
  const current = await findServiceLinkById(client, existing.id);
  if (!current) {
    throw new Error('service_link_not_found');
  }
  if (unblocked.count === 0 || current.status !== 'active') {
    throw new Error('service_link_not_blocked');
  }
  return current;
}

export async function removeServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  input: { serviceLinkId: string },
): Promise<ServiceLinkRecord> {
  const serviceLinkId = nonEmpty(input.serviceLinkId, 'invalid_service_link');
  const existing = await findServiceLinkById(client, serviceLinkId);
  if (!existing) {
    throw new Error('service_link_not_found');
  }
  if (existing.status === 'removed') {
    return existing;
  }
  if (existing.status === 'blocked') {
    throw new Error('service_link_blocked');
  }

  const removed = await client.serviceLink.updateMany({
    where: { id: serviceLinkId, status: 'active' },
    data: { status: 'removed', removedAt: new Date() },
  });
  const current = await findServiceLinkById(client, serviceLinkId);
  if (!current) {
    throw new Error('service_link_not_found');
  }
  if (removed.count === 0) {
    if (current.status === 'removed') {
      return current;
    }
    if (current.status === 'blocked') {
      throw new Error('service_link_blocked');
    }
    throw new Error('service_link_not_removed');
  }
  return current;
}
