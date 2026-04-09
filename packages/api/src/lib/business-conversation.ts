import { db } from '../db/index.js';

export interface BindBusinessConversationInput {
  tenantId: string;
  conversationId: string;
  cokeAccountId: string;
  businessConversationKey: string;
  channelId: string;
  endUserId: string;
  externalEndUserId: string;
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

export async function bindBusinessConversation(
  input: BindBusinessConversationInput,
): Promise<DeliveryRouteRecord> {
  return db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
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
        `Conversation ${input.conversationId} not found`,
      );
    }

    if (
      conversation.tenantId !== input.tenantId ||
      conversation.channelId !== input.channelId ||
      conversation.endUserId !== input.endUserId
    ) {
      throw new BusinessConversationBindingError(
        'conversation_identity_mismatch',
        `Conversation ${input.conversationId} does not match tenant/channel/end-user`,
      );
    }

    if (!conversation.endUser || conversation.endUser.externalId !== input.externalEndUserId) {
      throw new BusinessConversationBindingError(
        'external_end_user_mismatch',
        `Conversation ${input.conversationId} does not match external end-user identity`,
      );
    }

    const clawscaleUser = await tx.clawscaleUser.findUnique({
      where: { cokeAccountId: input.cokeAccountId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (
      !clawscaleUser ||
      clawscaleUser.tenantId !== input.tenantId ||
      conversation.endUser.clawscaleUserId !== clawscaleUser.id
    ) {
      throw new BusinessConversationBindingError(
        'coke_account_identity_mismatch',
        `Conversation ${input.conversationId} does not match coke account identity`,
      );
    }

    const snapshotBusinessConversationKey = conversation.businessConversationKey ?? null;
    const snapshotClawscaleUserId = conversation.clawscaleUserId ?? null;

    const claimant = await tx.conversation.findFirst({
      where: {
        tenantId: input.tenantId,
        id: { not: input.conversationId },
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
          tenantId: input.tenantId,
          clawscaleUserId: claimant.clawscaleUserId,
          businessConversationKey: claimant.businessConversationKey,
        },
        data: {
          businessConversationKey: null,
        },
      });

      if (clearClaimant.count !== 1) {
        throwConversationBindingConflict(input.conversationId);
      }
    }

    try {
      const applyBinding = await tx.conversation.updateMany({
        where: {
          id: input.conversationId,
          tenantId: input.tenantId,
          channelId: input.channelId,
          endUserId: input.endUserId,
          businessConversationKey: snapshotBusinessConversationKey,
          clawscaleUserId: snapshotClawscaleUserId,
        },
        data: {
          clawscaleUserId: clawscaleUser.id,
          businessConversationKey: input.businessConversationKey,
        },
      });

      if (applyBinding.count !== 1) {
        throwConversationBindingConflict(input.conversationId);
      }
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throwConversationBindingConflict(input.conversationId);
      }
      throw error;
    }

    if (
      conversation.businessConversationKey &&
      conversation.businessConversationKey !== input.businessConversationKey
    ) {
      await tx.deliveryRoute.updateMany({
        where: {
          cokeAccountId: input.cokeAccountId,
          businessConversationKey: conversation.businessConversationKey,
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
          cokeAccountId: input.cokeAccountId,
          businessConversationKey: input.businessConversationKey,
        },
      },
      create: {
        tenantId: input.tenantId,
        cokeAccountId: input.cokeAccountId,
        businessConversationKey: input.businessConversationKey,
        channelId: input.channelId,
        endUserId: input.endUserId,
        externalEndUserId: input.externalEndUserId,
        isActive: true,
      },
      update: {
        tenantId: input.tenantId,
        channelId: input.channelId,
        endUserId: input.endUserId,
        externalEndUserId: input.externalEndUserId,
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
