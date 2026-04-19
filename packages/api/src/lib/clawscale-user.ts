import { db } from '../db/index.js';
import { generateId } from './id.js';
import {
  DEFAULT_COKE_AGENT_ID,
  buildLegacyAgentBindingSeed,
} from './platformization-migration.js';

export type ClawscaleUserBindingErrorCode =
  | 'end_user_not_found'
  | 'end_user_already_bound'
  | 'customer_not_found'
  | 'coke_account_not_found'
  | 'coke_account_tenant_mismatch';

const defaultPersonalTenantSettings = {
  personaName: 'Assistant',
  personaPrompt: 'You are a helpful assistant.',
  endUserAccess: 'anonymous',
  features: { knowledgeBase: false },
};
const personalCokeBridgeBackendName = 'Coke Bridge';

export interface EnsureClawscaleUserForCokeAccountInput {
  cokeAccountId: string;
  displayName?: string | null;
}

export interface EnsureClawscaleUserForCustomerInput {
  customerId: string;
}

export interface EnsureClawscaleUserForCokeAccountResult {
  tenantId: string;
  clawscaleUserId: string;
  created: boolean;
  ready: boolean;
}

export class ClawscaleUserBindingError extends Error {
  constructor(
    public readonly code: ClawscaleUserBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClawscaleUserBindingError';
  }
}

export interface BindEndUserToCokeAccountInput {
  tenantId: string;
  channelId: string;
  externalId: string;
  cokeAccountId: string;
}

export interface BindEndUserToCokeAccountResult {
  clawscaleUserId: string;
  endUserId: string;
  cokeAccountId: string;
}

export interface UnifiedConversationIdsInput {
  tenantId: string;
  endUserId: string;
  clawscaleUserId: string | null;
  linkedTo: string | null;
}

type CustomerCompatibilityProvisioningRecord = {
  customer: {
    id: string;
    displayName: string;
    createdAt: Date;
    updatedAt: Date;
  };
  identity: {
    id: string;
    email: string | null;
    displayName: string;
    passwordHash: string | null;
    claimStatus: 'active' | 'unclaimed' | 'pending';
    updatedAt: Date;
  };
  role: 'owner' | 'member' | 'viewer';
};

type CustomerOwnershipLookupClient = Pick<typeof db, 'membership'>;
type CustomerCompatibilityClient = Pick<typeof db, 'agentBinding'>;

function buildPersonalTenantSlug(cokeAccountId: string): string {
  return `personal-${cokeAccountId.toLowerCase()}`;
}

function buildPersonalTenantName(displayName?: string | null): string {
  const trimmed = displayName?.trim();
  return trimmed ? `${trimmed}'s Workspace` : 'Personal Workspace';
}

function resolvePersonalCokeBridgeBackendConfig() {
  const baseUrl =
    process.env['COKE_BRIDGE_INBOUND_URL']?.trim() ||
    'http://127.0.0.1:8090/bridge/inbound';
  const apiKey = process.env['COKE_BRIDGE_API_KEY']?.trim() ?? '';

  return {
    baseUrl,
    transport: 'http' as const,
    responseFormat: 'json-auto' as const,
    ...(apiKey ? { authHeader: `Bearer ${apiKey}` } : {}),
  };
}

async function ensurePersonalCokeBridgeBackend(tenantId: string) {
  const config = resolvePersonalCokeBridgeBackendConfig();
  const existing = await db.aiBackend.findFirst({
    where: {
      tenantId,
      name: personalCokeBridgeBackendName,
    },
    select: {
      id: true,
      isActive: true,
      isDefault: true,
      type: true,
      config: true,
    },
  });

  if (existing) {
    await db.aiBackend.update({
      where: { id: existing.id },
      data: {
        type: 'custom',
        isActive: true,
        isDefault: true,
        config,
      },
    });
    return;
  }

  await db.aiBackend.updateMany({
    where: { tenantId, isDefault: true },
    data: { isDefault: false },
  });

  await db.aiBackend.create({
    data: {
      id: generateId('aib'),
      tenantId,
      name: personalCokeBridgeBackendName,
      type: 'custom',
      config,
      isActive: true,
      isDefault: true,
    },
  });
}

function isUniqueConstraint(error: unknown, fieldName: string): boolean {
  const prismaError = error as {
    code?: string;
    meta?: { target?: unknown };
  };

  if (prismaError.code !== 'P2002') {
    return false;
  }

  const target = prismaError.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(fieldName);
  }

  return target === fieldName;
}

function isCustomerCompatibilityId(value: string): boolean {
  return value.startsWith('ck_');
}

async function getCustomerOwnerForProvisioning(
  client: CustomerOwnershipLookupClient,
  customerId: string,
): Promise<CustomerCompatibilityProvisioningRecord> {
  const membership = await client.membership.findFirst({
    where: {
      customerId,
      role: 'owner',
    },
    include: {
      customer: {
        select: {
          id: true,
          displayName: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      identity: {
        select: {
          id: true,
          email: true,
          displayName: true,
          passwordHash: true,
          claimStatus: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!membership) {
    throw new ClawscaleUserBindingError(
      'customer_not_found',
      'Customer owner not found',
    );
  }

  return membership;
}

async function ensureCustomerCompatibilityBinding(
  client: CustomerCompatibilityClient,
  ownership: CustomerCompatibilityProvisioningRecord,
) {
  const agentBindingSeed = buildLegacyAgentBindingSeed({
    customerId: ownership.customer.id,
    agentId: DEFAULT_COKE_AGENT_ID,
  });

  await client.agentBinding.upsert({
    where: { customerId: ownership.customer.id },
    create: agentBindingSeed,
    update: {
      agentId: agentBindingSeed.agentId,
      provisionStatus: agentBindingSeed.provisionStatus,
      provisionAttempts: agentBindingSeed.provisionAttempts,
      provisionLastError: agentBindingSeed.provisionLastError,
    },
  });
}

export async function ensureClawscaleUserForCokeAccount(
  input: EnsureClawscaleUserForCokeAccountInput,
): Promise<EnsureClawscaleUserForCokeAccountResult> {
  if (!isCustomerCompatibilityId(input.cokeAccountId)) {
    throw new ClawscaleUserBindingError(
      'coke_account_not_found',
      'Coke account not found',
    );
  }

  try {
    return await ensureClawscaleUserForCustomer({
      customerId: input.cokeAccountId,
    });
  } catch (error) {
    if (
      error instanceof ClawscaleUserBindingError &&
      error.code === 'customer_not_found'
    ) {
      throw new ClawscaleUserBindingError(
        'coke_account_not_found',
        'Coke account not found',
      );
    }

    throw error;
  }
}

export async function ensureClawscaleUserForCustomer(
  input: EnsureClawscaleUserForCustomerInput,
): Promise<EnsureClawscaleUserForCokeAccountResult> {
  const ownership = await getCustomerOwnerForProvisioning(db, input.customerId);

  const existing = await db.clawscaleUser.findUnique({
    where: { cokeAccountId: input.customerId },
    select: { id: true, tenantId: true },
  });

  if (existing) {
    await db.$transaction(async (tx) => {
      const currentOwnership = await getCustomerOwnerForProvisioning(tx, input.customerId);
      await ensureCustomerCompatibilityBinding(tx, currentOwnership);
    });
    await ensurePersonalCokeBridgeBackend(existing.tenantId);
    return {
      tenantId: existing.tenantId,
      clawscaleUserId: existing.id,
      created: false,
      ready: true,
    };
  }

  try {
    return await db.$transaction(async (tx) => {
      const currentOwnership = await getCustomerOwnerForProvisioning(tx, input.customerId);
      await ensureCustomerCompatibilityBinding(tx, currentOwnership);

      const raced = await tx.clawscaleUser.findUnique({
        where: { cokeAccountId: input.customerId },
        select: { id: true, tenantId: true },
      });

      if (raced) {
        await ensurePersonalCokeBridgeBackend(raced.tenantId);
        return {
          tenantId: raced.tenantId,
          clawscaleUserId: raced.id,
          created: false,
          ready: true,
        };
      }

      const tenantId = generateId('tnt');
      const clawscaleUserId = generateId('csu');

      await tx.tenant.create({
        data: {
          id: tenantId,
          slug: buildPersonalTenantSlug(input.customerId),
          name: buildPersonalTenantName(currentOwnership.customer.displayName),
          settings: {
            ...defaultPersonalTenantSettings,
            kind: 'personal',
            ownerCokeAccountId: input.customerId,
            autoCreated: true,
          },
        },
      });

      await tx.clawscaleUser.create({
        data: {
          id: clawscaleUserId,
          tenantId,
          cokeAccountId: input.customerId,
        },
      });

      await tx.aiBackend.create({
        data: {
          id: generateId('aib'),
          tenantId,
          name: personalCokeBridgeBackendName,
          type: 'custom',
          config: resolvePersonalCokeBridgeBackendConfig(),
          isActive: true,
          isDefault: true,
        },
      });

      return {
        tenantId,
        clawscaleUserId,
        created: true,
        ready: true,
      };
    });
  } catch (error) {
    if (!isUniqueConstraint(error, 'slug') && !isUniqueConstraint(error, 'cokeAccountId')) {
      throw error;
    }

    const raced = await db.clawscaleUser.findUnique({
      where: { cokeAccountId: input.customerId },
      select: { id: true, tenantId: true },
    });
    if (!raced) {
      throw error;
    }

    await db.$transaction(async (tx) => {
      const currentOwnership = await getCustomerOwnerForProvisioning(tx, input.customerId);
      await ensureCustomerCompatibilityBinding(tx, currentOwnership);
    });
    await ensurePersonalCokeBridgeBackend(raced.tenantId);

    return {
      tenantId: raced.tenantId,
      clawscaleUserId: raced.id,
      created: false,
      ready: true,
    };
  }
}

export async function bindEndUserToCokeAccount(
  input: BindEndUserToCokeAccountInput,
): Promise<BindEndUserToCokeAccountResult> {
  return db.$transaction(async (tx) => {
    const endUser = await tx.endUser.findUnique({
      where: {
        tenantId_channelId_externalId: {
          tenantId: input.tenantId,
          channelId: input.channelId,
          externalId: input.externalId,
        },
      },
      select: {
        id: true,
        clawscaleUserId: true,
      },
    });

    if (!endUser) {
      throw new ClawscaleUserBindingError('end_user_not_found', 'End user not found');
    }

    const user = await tx.clawscaleUser.findUnique({
      where: { cokeAccountId: input.cokeAccountId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!user) {
      throw new ClawscaleUserBindingError(
        'coke_account_not_found',
        'Coke account is not bound to a Clawscale user',
      );
    }

    if (user.tenantId !== input.tenantId) {
      throw new ClawscaleUserBindingError(
        'coke_account_tenant_mismatch',
        'Coke account belongs to a different tenant',
      );
    }

    const updated = await tx.endUser.updateMany({
      where: {
        id: endUser.id,
        tenantId: input.tenantId,
        OR: [{ clawscaleUserId: null }, { clawscaleUserId: user.id }],
      },
      data: { clawscaleUserId: user.id },
    });

    if (updated.count !== 1) {
      throw new ClawscaleUserBindingError(
        'end_user_already_bound',
        'End user is already bound to another ClawscaleUser',
      );
    }

    return {
      clawscaleUserId: user.id,
      endUserId: endUser.id,
      cokeAccountId: input.cokeAccountId,
    };
  });
}

export async function getUnifiedConversationIds(
  input: UnifiedConversationIdsInput,
): Promise<string[]> {
  if (input.clawscaleUserId) {
    const unifiedEndUsers = await db.endUser.findMany({
      where: {
        tenantId: input.tenantId,
        clawscaleUserId: input.clawscaleUserId,
      },
      select: { id: true },
    });

    const conversations = await db.conversation.findMany({
      where: {
        endUserId: {
          in: unifiedEndUsers.map((endUser) => endUser.id),
        },
      },
      select: { id: true },
    });

    return conversations.map((conversation) => conversation.id);
  }

  const primaryId = input.linkedTo ?? input.endUserId;
  const linkedUsers = await db.endUser.findMany({
    where: {
      tenantId: input.tenantId,
      OR: [{ id: primaryId }, { linkedTo: primaryId }],
    },
    select: { id: true },
  });

  const conversations = await db.conversation.findMany({
    where: {
      endUserId: {
        in: linkedUsers.map((endUser) => endUser.id),
      },
    },
    select: { id: true },
  });

  return conversations.map((conversation) => conversation.id);
}
