import {
  AgentBindingProvisionStatus,
  CustomerKind,
  IdentityClaimStatus,
  MembershipRole,
  type Prisma,
} from '@prisma/client';

import { db } from '../db/index.js';
import {
  buildExternalIdentityUniqueWhere,
  normalizeExternalIdentity,
  type NormalizedExternalIdentity,
} from './external-identity.js';
import { generateId } from './id.js';
import { queueParkedInbound } from './parked-inbound.js';

interface SharedChannelProvisioningInput {
  channelId: string;
  agentId: string;
  displayName?: string | null;
  provider: string;
  identityType: string;
  rawIdentityValue: string;
  payload: Prisma.InputJsonValue;
}

interface SharedChannelProvisioningResult {
  customerId: string;
  created: boolean;
  parked: boolean;
  provisionStatus: 'ready' | 'pending' | 'error';
}

const CONCURRENT_PROVISION_READY_WAIT_MS = 2_000;
const CONCURRENT_PROVISION_POLL_MS = 100;

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

async function rereadCustomerId(identity: NormalizedExternalIdentity): Promise<string | null> {
  const existing = await db.externalIdentity.findUnique({
    where: buildExternalIdentityUniqueWhere(identity),
    select: { customerId: true },
  });

  return existing?.customerId ?? null;
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

async function waitForProvisionStatus(customerId: string) {
  let provisionStatus = await readProvisionStatus(customerId);
  if (provisionStatus !== 'pending') {
    return provisionStatus;
  }

  const deadline = Date.now() + CONCURRENT_PROVISION_READY_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CONCURRENT_PROVISION_POLL_MS));
    provisionStatus = await readProvisionStatus(customerId);
    if (provisionStatus !== 'pending') {
      return provisionStatus;
    }
  }

  return provisionStatus;
}

async function resolveExistingCustomer(
  customerId: string,
  identity: NormalizedExternalIdentity,
  input: SharedChannelProvisioningInput,
): Promise<SharedChannelProvisioningResult> {
  const provisionStatus = await waitForProvisionStatus(customerId);

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

async function markProvisionPending(customerId: string, errorMessage: string): Promise<void> {
  await db.agentBinding.update({
    where: { customerId },
    data: {
      provisionStatus: 'pending',
      provisionAttempts: { increment: 1 },
      provisionLastError: errorMessage,
      provisionUpdatedAt: new Date(),
    },
  });
}

async function markProvisionReady(customerId: string): Promise<void> {
  await db.agentBinding.update({
    where: { customerId },
    data: {
      provisionStatus: 'ready',
      provisionAttempts: { increment: 1 },
      provisionLastError: null,
      provisionUpdatedAt: new Date(),
    },
  });
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
    signal: AbortSignal.timeout(15_000),
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

  const now = new Date();
  const identityId = generateId('idn');
  const customerId = generateId('ck');
  const membershipId = generateId('mem');
  const displayName = buildDisplayName(input.displayName);

  let boundCustomerId: string;

  try {
    const externalIdentity = await db.$transaction(async (tx) => {
      return tx.externalIdentity.upsert({
        where: buildExternalIdentityUniqueWhere(identity),
        update: {
          lastSeenAt: now,
        },
        create: {
          provider: identity.provider,
          identityType: identity.identityType,
          identityValue: identity.identityValue,
          firstSeenChannel: { connect: { id: input.channelId } },
          lastSeenAt: now,
          customer: {
            create: {
              id: customerId,
              kind: CustomerKind.personal,
              displayName,
              memberships: {
                create: {
                  id: membershipId,
                  role: MembershipRole.owner,
                  identity: {
                    create: {
                      id: identityId,
                      displayName,
                      claimStatus: IdentityClaimStatus.unclaimed,
                    },
                  },
                },
              },
              agentBindings: {
                create: {
                  agentId: input.agentId,
                  provisionStatus: AgentBindingProvisionStatus.pending,
                  provisionAttempts: 0,
                  provisionLastError: null,
                  provisionUpdatedAt: now,
                },
              },
            },
          },
        },
      });
    });

    boundCustomerId = externalIdentity.customerId;
  } catch (error) {
    if (!isExternalIdentityUniqueConflict(error)) {
      throw error;
    }

    const winnerCustomerId = await rereadCustomerId(identity);
    if (!winnerCustomerId) {
      throw error;
    }

    return resolveExistingCustomer(winnerCustomerId, identity, input);
  }

  // ExternalIdentity is lifetime-stable by normalized provider/type/value, so later hits
  // reuse the mapped customer instead of provisioning a second owner graph.
  if (boundCustomerId !== customerId) {
    return resolveExistingCustomer(boundCustomerId, identity, input);
  }

  try {
    await provisionSharedChannelAgent(input.agentId, customerId, input.displayName);
  } catch (error) {
    await markProvisionPending(customerId, readErrorMessage(error));
    await parkInbound(identity, input, customerId);

    return {
      customerId,
      created: true,
      parked: true,
      provisionStatus: 'pending',
    };
  }

  try {
    await markProvisionReady(customerId);

    return {
      customerId,
      created: true,
      parked: false,
      provisionStatus: 'ready',
    };
  } catch (error) {
    await markProvisionPending(
      customerId,
      `shared_channel_ready_update_failed:${readErrorMessage(error)}` ,
    );
    await parkInbound(identity, input, customerId);

    return {
      customerId,
      created: true,
      parked: true,
      provisionStatus: 'pending',
    };
  }
}
