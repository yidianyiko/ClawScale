import { db } from '../db/index.js';
import type { RouteBindingSnapshot } from './route-binding.js';

export interface BindBusinessConversationInput {
  routeBinding: RouteBindingSnapshot;
  businessConversationKey: string;
}

export interface DeliveryRouteRecord {
  tenantId: string;
  cokeAccountId: string;
  businessConversationKey: string;
  channelId: string;
  endUserId: string;
  externalEndUserId: string;
  isActive: boolean;
}

export interface ResolveExactDeliveryRouteInput {
  cokeAccountId: string;
  businessConversationKey: string;
}

export type BusinessConversationBindingErrorCode =
  | 'conversation_not_found'
  | 'conversation_identity_mismatch'
  | 'external_end_user_mismatch'
  | 'coke_account_identity_mismatch'
  | 'conversation_binding_conflict';

export class BusinessConversationBindingError extends Error {
  constructor(
    public readonly code: BusinessConversationBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessConversationBindingError';
  }
}

export type DeliveryRouteResolutionErrorCode = 'missing_delivery_route';

export class DeliveryRouteResolutionError extends Error {
  constructor(
    public readonly code: DeliveryRouteResolutionErrorCode,
    public readonly context: ResolveExactDeliveryRouteInput,
  ) {
    super(
      `No active delivery route for cokeAccountId=${context.cokeAccountId} businessConversationKey=${context.businessConversationKey}`,
    );
    this.name = 'DeliveryRouteResolutionError';
  }
}

export interface InvalidateRoutesForChannelReplacementInput {
  tenantId: string;
  archivedChannelId: string;
}

export interface InvalidateRoutesForChannelReplacementResult {
  updatedCount: number;
}

function throwConversationBindingConflict(conversationId: string): never {
  throw new BusinessConversationBindingError(
    'conversation_binding_conflict',
    `Conversation ${conversationId} binding changed concurrently`,
  );
}

function isUniqueConstraint(error: unknown): boolean {
  const prismaError = error as { code?: string };
  return prismaError.code === 'P2002';
}

function collectStaleBusinessConversationKeys(
  routeBinding: RouteBindingSnapshot,
  nextBusinessConversationKey: string,
): string[] {
  const staleKeys: string[] = [];

  for (const candidate of [
    routeBinding.businessConversationKey,
    routeBinding.previousBusinessConversationKey,
  ]) {
    if (!candidate || candidate === nextBusinessConversationKey || staleKeys.includes(candidate)) {
      continue;
    }
    staleKeys.push(candidate);
  }

  return staleKeys;
}

export async function bindBusinessConversation(
  input: BindBusinessConversationInput,
): Promise<DeliveryRouteRecord> {
  const { routeBinding } = input;
  const conversationId = routeBinding.gatewayConversationId;
  const cokeAccountId = routeBinding.cokeAccountId;

  if (!conversationId) {
    throw new BusinessConversationBindingError(
      'conversation_not_found',
      'Route binding is missing a gateway conversation id',
    );
  }

  if (!cokeAccountId) {
    throw new BusinessConversationBindingError(
      'coke_account_identity_mismatch',
      `Conversation ${conversationId} does not match coke account identity`,
    );
  }

  return db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        tenantId: true,
        channelId: true,
        endUserId: true,
        clawscaleUserId: true,
        businessConversationKey: true,
        endUser: {
          select: {
            externalId: true,
            clawscaleUserId: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new BusinessConversationBindingError(
        'conversation_not_found',
        `Conversation ${conversationId} not found`,
      );
    }

    if (
      conversation.tenantId !== routeBinding.tenantId ||
      conversation.channelId !== routeBinding.channelId ||
      conversation.endUserId !== routeBinding.endUserId
    ) {
      throw new BusinessConversationBindingError(
        'conversation_identity_mismatch',
        `Conversation ${conversationId} does not match tenant/channel/end-user`,
      );
    }

    if (
      !conversation.endUser ||
      conversation.endUser.externalId !== routeBinding.externalEndUserId
    ) {
      throw new BusinessConversationBindingError(
        'external_end_user_mismatch',
        `Conversation ${conversationId} does not match external end-user identity`,
      );
    }

    const clawscaleUser = await tx.clawscaleUser.findUnique({
      where: { cokeAccountId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (
      !clawscaleUser ||
      clawscaleUser.tenantId !== routeBinding.tenantId ||
      conversation.endUser.clawscaleUserId !== clawscaleUser.id
    ) {
      throw new BusinessConversationBindingError(
        'coke_account_identity_mismatch',
        `Conversation ${conversationId} does not match coke account identity`,
      );
    }

    const claimant = await tx.conversation.findFirst({
      where: {
        tenantId: routeBinding.tenantId,
        id: { not: conversationId },
        clawscaleUserId: clawscaleUser.id,
        businessConversationKey: input.businessConversationKey,
      },
      select: {
        id: true,
        clawscaleUserId: true,
        businessConversationKey: true,
      },
    });

    if (claimant) {
      const clearClaimant = await tx.conversation.updateMany({
        where: {
          id: claimant.id,
          tenantId: routeBinding.tenantId,
          clawscaleUserId: claimant.clawscaleUserId,
          businessConversationKey: claimant.businessConversationKey,
        },
        data: {
          businessConversationKey: null,
        },
      });

      if (clearClaimant.count !== 1) {
        throwConversationBindingConflict(conversationId);
      }
    }

    try {
      const applyBinding = await tx.conversation.updateMany({
        where: {
          id: conversationId,
          tenantId: routeBinding.tenantId,
          channelId: routeBinding.channelId,
          endUserId: routeBinding.endUserId,
          businessConversationKey:
            routeBinding.previousBusinessConversationKey === null
              ? { equals: null }
              : routeBinding.previousBusinessConversationKey,
          clawscaleUserId:
            routeBinding.previousClawscaleUserId === null
              ? { equals: null }
              : routeBinding.previousClawscaleUserId,
        },
        data: {
          clawscaleUserId: clawscaleUser.id,
          businessConversationKey: input.businessConversationKey,
        },
      });

      if (applyBinding.count !== 1) {
        throwConversationBindingConflict(conversationId);
      }
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throwConversationBindingConflict(conversationId);
      }
      throw error;
    }

    for (const staleBusinessConversationKey of collectStaleBusinessConversationKeys(
      routeBinding,
      input.businessConversationKey,
    )) {
      await tx.deliveryRoute.updateMany({
        where: {
          cokeAccountId,
          businessConversationKey: staleBusinessConversationKey,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });
    }

    return tx.deliveryRoute.upsert({
      where: {
        cokeAccountId_businessConversationKey: {
          cokeAccountId,
          businessConversationKey: input.businessConversationKey,
        },
      },
      create: {
        tenantId: routeBinding.tenantId,
        cokeAccountId,
        businessConversationKey: input.businessConversationKey,
        channelId: routeBinding.channelId,
        endUserId: routeBinding.endUserId,
        externalEndUserId: routeBinding.externalEndUserId,
        isActive: true,
      },
      update: {
        tenantId: routeBinding.tenantId,
        channelId: routeBinding.channelId,
        endUserId: routeBinding.endUserId,
        externalEndUserId: routeBinding.externalEndUserId,
        isActive: true,
      },
    });
  });
}

export async function resolveExactDeliveryRoute(
  input: ResolveExactDeliveryRouteInput,
): Promise<DeliveryRouteRecord> {
  const route = await db.deliveryRoute.findUnique({
    where: {
      cokeAccountId_businessConversationKey: {
        cokeAccountId: input.cokeAccountId,
        businessConversationKey: input.businessConversationKey,
      },
    },
  });

  if (!route || !route.isActive) {
    throw new DeliveryRouteResolutionError('missing_delivery_route', input);
  }

  return route;
}

export async function invalidateRoutesForChannelReplacement(
  input: InvalidateRoutesForChannelReplacementInput,
): Promise<InvalidateRoutesForChannelReplacementResult> {
  const result = await db.deliveryRoute.updateMany({
    where: {
      tenantId: input.tenantId,
      channelId: input.archivedChannelId,
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });

  return {
    updatedCount: result.count,
  };
}
