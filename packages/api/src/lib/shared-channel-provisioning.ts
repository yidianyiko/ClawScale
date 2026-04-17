import type { Prisma } from '@prisma/client';

import { db } from '../db/index.js';
import {
  buildExternalIdentityUniqueWhere,
  normalizeExternalIdentity,
  type NormalizedExternalIdentity,
} from './external-identity.js';
import { generateId } from './id.js';
import { queueParkedInbound } from './parked-inbound.js';

export interface SharedChannelProvisioningInput {
  channelId: string;
  agentId: string;
  displayName?: string | null;
  provider: string;
  identityType: string;
  rawIdentityValue: string;
  payload: Prisma.InputJsonValue;
}

export interface SharedChannelProvisioningResult {
  customerId: string;
  created: boolean;
  parked: boolean;
  provisionStatus: 'ready' | 'pending' | 'error';
}

function buildDisplayName(displayName?: string | null): string {
  return displayName?.trim() ?? '';
}

function buildParkedPayload(
  customerId: string,
  payload: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      ...(payload as Prisma.InputJsonObject),
      customerId,
    } satisfies Prisma.InputJsonObject;
  }

  return {
    customerId,
    payload,
  } satisfies Prisma.InputJsonObject;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'shared_channel_provisioning_failed';
}

function isExternalIdentityUniqueConflict(error: unknown): boolean {
  const prismaError = error as {
    code?: string;
    meta?: { target?: unknown };
  };

  if (prismaError?.code !== 'P2002') {
    return false;
  }

  const target = prismaError.meta?.target;
  if (!Array.isArray(target)) {
    return false;
  }

  const normalizedTarget = new Set(target.map((entry) => String(entry)));
  return (
    normalizedTarget.has('provider') &&
    (normalizedTarget.has('identityType') || normalizedTarget.has('identity_type')) &&
    (normalizedTarget.has('identityValue') || normalizedTarget.has('identity_value'))
  );
}

async function findExistingCustomerId(identity: NormalizedExternalIdentity): Promise<string | null> {
  const existing = await db.externalIdentity.findUnique({
    where: buildExternalIdentityUniqueWhere(identity),
    select: { customerId: true },
  });

  return existing?.customerId ?? null;
}

async function touchExternalIdentity(identity: NormalizedExternalIdentity): Promise<void> {
  await db.externalIdentity.update({
    where: buildExternalIdentityUniqueWhere(identity),
    data: {
      lastSeenAt: new Date(),
    },
  });
}

async function parkInbound(
  identity: NormalizedExternalIdentity,
  input: SharedChannelProvisioningInput,
  customerId: string,
): Promise<void> {
  await queueParkedInbound({
    channelId: input.channelId,
    provider: identity.provider,
    identityType: identity.identityType,
    identityValue: identity.identityValue,
    payload: buildParkedPayload(customerId, input.payload),
  });
}

async function readProvisionStatus(customerId: string) {
  const binding = await db.agentBinding.findUnique({
    where: { customerId },
    select: { provisionStatus: true },
  });

  return binding?.provisionStatus ?? 'pending';
}

async function resolveExistingCustomer(
  customerId: string,
  identity: NormalizedExternalIdentity,
  input: SharedChannelProvisioningInput,
): Promise<SharedChannelProvisioningResult> {
  await touchExternalIdentity(identity);
  const provisionStatus = await readProvisionStatus(customerId);

  if (provisionStatus === 'ready') {
    return {
      customerId,
      created: false,
      parked: false,
      provisionStatus,
    };
  }

  await parkInbound(identity, input, customerId);
  return {
    customerId,
    created: false,
    parked: true,
    provisionStatus,
  };
}

async function provisionSharedChannelAgent(
  agentId: string,
  customerId: string,
  displayName?: string | null,
): Promise<void> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      endpoint: true,
      authToken: true,
    },
  });

  if (!agent) {
    throw new Error(`shared_channel_agent_not_found:${agentId}`);
  }

  const response = await fetch(agent.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agent.authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      customer_id: customerId,
      ...(buildDisplayName(displayName)
        ? { display_name: buildDisplayName(displayName) }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`shared_channel_agent_provision_failed:${response.status}`);
  }
}

export async function provisionSharedChannelCustomer(
  input: SharedChannelProvisioningInput,
): Promise<SharedChannelProvisioningResult> {
  const identity = normalizeExternalIdentity({
    provider: input.provider,
    identityType: input.identityType,
    rawValue: input.rawIdentityValue,
  });

  const existingCustomerId = await findExistingCustomerId(identity);
  if (existingCustomerId) {
    return resolveExistingCustomer(existingCustomerId, identity, input);
  }

  try {
    const customerId = await db.$transaction(async (tx) => {
      const now = new Date();
      const identityId = generateId('idn');
      const customerId = generateId('ck');
      const membershipId = generateId('mem');
      const displayName = buildDisplayName(input.displayName);

      await tx.identity.create({
        data: {
          id: identityId,
          displayName,
          claimStatus: 'unclaimed',
        },
      });
      await tx.customer.create({
        data: {
          id: customerId,
          kind: 'personal',
          displayName,
        },
      });
      await tx.membership.create({
        data: {
          id: membershipId,
          identityId,
          customerId,
          role: 'owner',
        },
      });
      await tx.agentBinding.create({
        data: {
          customerId,
          agentId: input.agentId,
          provisionStatus: 'pending',
          provisionAttempts: 0,
          provisionLastError: null,
          provisionUpdatedAt: now,
        },
      });
      await tx.externalIdentity.create({
        data: {
          provider: identity.provider,
          identityType: identity.identityType,
          identityValue: identity.identityValue,
          customerId,
          firstSeenChannelId: input.channelId,
          lastSeenAt: now,
        },
      });

      return customerId;
    });

    try {
      await provisionSharedChannelAgent(input.agentId, customerId, input.displayName);
      await db.agentBinding.update({
        where: { customerId },
        data: {
          provisionStatus: 'ready',
          provisionAttempts: { increment: 1 },
          provisionLastError: null,
          provisionUpdatedAt: new Date(),
        },
      });

      return {
        customerId,
        created: true,
        parked: false,
        provisionStatus: 'ready',
      };
    } catch (error) {
      await db.agentBinding.update({
        where: { customerId },
        data: {
          provisionStatus: 'pending',
          provisionAttempts: { increment: 1 },
          provisionLastError: readErrorMessage(error),
          provisionUpdatedAt: new Date(),
        },
      });
      await parkInbound(identity, input, customerId);

      return {
        customerId,
        created: true,
        parked: true,
        provisionStatus: 'pending',
      };
    }
  } catch (error) {
    if (!isExternalIdentityUniqueConflict(error)) {
      throw error;
    }

    const winnerCustomerId = await findExistingCustomerId(identity);
    if (!winnerCustomerId) {
      throw error;
    }

    return resolveExistingCustomer(winnerCustomerId, identity, input);
  }
}
