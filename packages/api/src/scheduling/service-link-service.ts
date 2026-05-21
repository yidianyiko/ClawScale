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
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ServiceLinkRecord>;
  };
  appointmentRequest: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

interface ServiceLinkPairInput {
  providerAccountId: string;
  consumerAccountId: string;
}

type ServiceLinkPairWhere = ServiceLinkPairInput & Record<string, unknown>;

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

export async function createOrActivateServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  input: ServiceLinkPairInput,
): Promise<ServiceLinkRecord> {
  const where = pairWhere(input);
  const existing = await client.serviceLink.findFirst({ where });

  if (existing?.status === 'active' || existing?.status === 'blocked') {
    return existing;
  }

  if (existing?.status === 'removed') {
    return client.serviceLink.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        removedAt: null,
        capabilities: capabilities(),
      },
    });
  }

  return client.serviceLink.create({
    data: {
      ...where,
      status: 'active',
      capabilities: capabilities(),
    },
  });
}

export async function blockServiceLink(
  client: ServiceLinkClient,
  input: ServiceLinkPairInput,
): Promise<ServiceLinkRecord> {
  const where = pairWhere(input);
  const existing = await client.serviceLink.findFirst({ where });
  if (!existing) {
    throw new Error('service_link_not_found');
  }

  const blocked = await client.serviceLink.update({
    where: { id: existing.id },
    data: {
      status: 'blocked',
      blockedAt: new Date(),
      capabilities: [],
    },
  });

  await client.appointmentRequest.updateMany({
    where: { ...where, status: 'pending_held' },
    data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: new Date() },
  });

  return blocked;
}

export async function unblockServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  input: ServiceLinkPairInput,
): Promise<ServiceLinkRecord> {
  const where = pairWhere(input);
  const existing = await client.serviceLink.findFirst({ where });
  if (!existing) {
    return client.serviceLink.create({
      data: {
        ...where,
        status: 'active',
        capabilities: capabilities(),
      },
    });
  }

  return client.serviceLink.update({
    where: { id: existing.id },
    data: {
      status: 'active',
      blockedAt: null,
      capabilities: capabilities(),
    },
  });
}

export async function removeServiceLink(
  client: Pick<ServiceLinkClient, 'serviceLink'>,
  input: { serviceLinkId: string },
): Promise<ServiceLinkRecord> {
  return client.serviceLink.update({
    where: { id: nonEmpty(input.serviceLinkId, 'invalid_service_link') },
    data: { status: 'removed', removedAt: new Date() },
  });
}
