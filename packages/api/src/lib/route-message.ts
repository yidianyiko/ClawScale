/**
 * routeInboundMessage — central message routing function.
 *
 * All channel adapters call this directly. It handles:
 *   - EndUser creation / lookup
 *   - Access policy enforcement
 *   - Conversation management
 *   - Message persistence
 *   - Current Coke bridge routing through custom HTTP backends
 */

import { db } from '../db/index.js';
import { generateId } from './id.js';
import { generateReply, type BackendReplyPayload } from './ai-backend.js';
import { bindEndUserToCokeAccount, getUnifiedConversationIds } from './clawscale-user.js';
import { bindBusinessConversation, upsertDirectDeliveryRoute } from './business-conversation.js';
import { resolveCokeAccountAccess } from './coke-account-access.js';
import { buildPublicCheckoutUrl, issuePublicCheckoutToken } from './coke-public-checkout.js';
import { provisionSharedChannelCustomer } from './shared-channel-provisioning.js';
import { createRouteBindingSnapshot } from './route-binding.js';
import { parseCommand, formatCommandHelp } from './slash-commands.js';
import { normalizeInboundAttachments } from './inbound-attachments.js';
import type { Prisma } from '@prisma/client';
import type { AiBackendType, AiBackendProviderConfig } from './ai-backend-runtime.js';

export interface Attachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  safeDisplayUrl?: string;
}

export interface InboundMessage {
  channelId: string;
  externalId: string;
  displayName?: string;
  text: string;
  attachments?: Attachment[];
  attachmentPolicy?: { allowDataUrls?: boolean };
  meta?: Record<string, unknown>;
}

interface ReplyEntry {
  backendId: string | null;
  backendName: string | null;
  reply: string;
}

interface RouteResult {
  conversationId: string;
  replies: ReplyEntry[];
  /** @deprecated Use replies[0].reply for backwards compat with single-reply adapters */
  reply: string;
}

function formatCombinedReplies(replies: ReplyEntry[]): string {
  if (replies.length <= 1) {
    return replies[0]?.reply ?? '';
  }

  return replies.map((r) =>
    r.backendName ? `[${r.backendName}]\n${r.reply}` : r.reply,
  ).join('\n\n---\n\n');
}

function isSharedAutoProvisionedChannelType(type: string | null): boolean {
  return (
    type === 'whatsapp' ||
    type === 'whatsapp_business' ||
    type === 'whatsapp_evolution' ||
    type === 'wechat_ecloud' ||
    type === 'linq'
  );
}

function getSharedChannelIdentityType(provider: string): string {
  if (provider === 'linq') return 'phone_number';
  if (
    provider === 'whatsapp' ||
    provider === 'whatsapp_business' ||
    provider === 'whatsapp_evolution'
  ) {
    return 'wa_id';
  }
  return 'external_id';
}

export async function routeInboundMessage(input: InboundMessage): Promise<RouteResult | null> {
  const { channelId, externalId, displayName, text, attachments, meta } = input;
  const normalizedAttachmentResult = normalizeInboundAttachments(attachments, input.attachmentPolicy);
  if (normalizedAttachmentResult.rejected) {
    return null;
  }
  const normalizedAttachments = normalizedAttachmentResult.attachments;

  const metadataPlatform = meta?.platform as string | undefined;

  // 1. Resolve channel + tenant
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      tenantId: true,
      type: true,
      ownershipKind: true,
      customerId: true,
      agentId: true,
      status: true,
      scope: true,
      ownerClawscaleUserId: true,
      ownerClawscaleUser: {
        select: {
          id: true,
          cokeAccountId: true,
        },
      },
    },
  });
  if (!channel || channel.status !== 'connected') return null;
  const platform = metadataPlatform ?? channel.type ?? 'unknown';
  console.log(`[inbound] ${platform} | user=${displayName ?? externalId} (${externalId}) | channel=${channelId}`);
  const { tenantId } = channel;
  const isSharedAutoProvisionedChannel =
    channel.ownershipKind === 'shared' &&
    isSharedAutoProvisionedChannelType(channel.type);
  const personalChannelOwnership =
    channel.scope === 'personal' &&
    channel.ownerClawscaleUserId &&
    channel.ownerClawscaleUser
      ? {
          channelScope: 'personal' as const,
          clawscaleUserId: channel.ownerClawscaleUserId,
          cokeAccountId: channel.ownerClawscaleUser.cokeAccountId,
        }
      : null;

  let resolvedChannelCustomerId = channel.customerId ?? null;

  if (isSharedAutoProvisionedChannel && channel.agentId) {
    const sharedChannelProvider = channel.type ?? 'unknown';
    const sharedChannelPayload = {
      externalId,
      ...(displayName ? { displayName } : {}),
      text,
      ...(normalizedAttachments.length
        ? { attachments: normalizedAttachments as unknown as Prisma.InputJsonValue }
        : {}),
      ...(meta ? { meta: meta as Prisma.InputJsonValue } : {}),
    } satisfies Prisma.InputJsonObject;

    const sharedChannelProvisioning = await provisionSharedChannelCustomer({
      channelId: channel.id,
      agentId: channel.agentId,
      displayName,
      provider: sharedChannelProvider,
      identityType: getSharedChannelIdentityType(sharedChannelProvider),
      rawIdentityValue: externalId,
      payload: sharedChannelPayload,
    });

    if (sharedChannelProvisioning.parked || sharedChannelProvisioning.provisionStatus !== 'ready') {
      return null;
    }
    resolvedChannelCustomerId = sharedChannelProvisioning.customerId ?? resolvedChannelCustomerId;
  }

  // 2. Load tenant settings
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const settings = (tenant?.settings ?? {}) as {
    personaName?: string;
    endUserAccess?: 'anonymous' | 'whitelist' | 'blacklist';
    allowList?: string[];
    blockList?: string[];
  };

  // 3. Find or create EndUser
  let endUser = await db.endUser.findUnique({
    where: { tenantId_channelId_externalId: { tenantId, channelId, externalId } },
    include: {
      activeBackends: { select: { backendId: true } },
      clawscaleUser: { select: { id: true, cokeAccountId: true } },
    },
  });
  const isNewUser = !endUser;
  if (!endUser) {
    endUser = await db.endUser.create({
      data: { id: generateId('eu'), tenantId, channelId, externalId, name: displayName ?? null, status: 'allowed' },
      include: {
        activeBackends: { select: { backendId: true } },
        clawscaleUser: { select: { id: true, cokeAccountId: true } },
      },
    });
  } else if (displayName && !endUser.name) {
    endUser = await db.endUser.update({
      where: { id: endUser.id },
      data: { name: displayName },
      include: {
        activeBackends: { select: { backendId: true } },
        clawscaleUser: { select: { id: true, cokeAccountId: true } },
      },
    });
  }
  const activeBackendIds = endUser.activeBackends.map((ab) => ab.backendId);
  const resolvedClawscaleUserId =
    personalChannelOwnership?.clawscaleUserId ?? endUser.clawscaleUserId ?? null;
  const resolvedCokeAccountId =
    personalChannelOwnership?.cokeAccountId ?? endUser.clawscaleUser?.cokeAccountId ?? null;
  const routeCokeAccountId =
    resolvedCokeAccountId ??
    (isSharedAutoProvisionedChannel ? resolvedChannelCustomerId : null);
  const accessCustomerId =
    isSharedAutoProvisionedChannel ? resolvedChannelCustomerId : resolvedCokeAccountId;
  const resolvedAccessAccountOwner = accessCustomerId
    ? await db.membership.findFirst({
        where: {
          customerId: accessCustomerId,
          role: 'owner',
        },
        include: {
          customer: {
            select: {
              id: true,
              displayName: true,
            },
          },
          identity: {
            select: {
              claimStatus: true,
            },
          },
        },
      })
    : null;
  const resolvedAccessAccount = accessCustomerId && resolvedAccessAccountOwner
    ? {
        id: accessCustomerId,
        displayName: resolvedAccessAccountOwner.customer.displayName,
        emailVerified: resolvedAccessAccountOwner.identity.claimStatus === 'active',
        status: 'normal' as const,
      }
    : null;
  const resolvedAccessAccountDecision = resolvedAccessAccount
    ? await resolveCokeAccountAccess({
        account: {
          id: resolvedAccessAccount.id,
          emailVerified: resolvedAccessAccount.emailVerified,
          displayName: resolvedAccessAccount.displayName,
          status: resolvedAccessAccount.status,
        },
        ...(isSharedAutoProvisionedChannel ? { requireEmailVerified: false } : {}),
      })
    : null;
  const resolvedAccessAccountMetadata =
    isSharedAutoProvisionedChannel &&
    resolvedAccessAccountDecision?.accountAccessDeniedReason === 'subscription_required' &&
    resolvedChannelCustomerId
      ? {
          ...resolvedAccessAccountDecision,
          renewalUrl: buildPublicCheckoutUrl(
            issuePublicCheckoutToken({ customerId: resolvedChannelCustomerId }),
          ),
        }
      : resolvedAccessAccountDecision;

  // 4. Enforce access policy
  const access = settings.endUserAccess ?? 'anonymous';
  if (endUser.status === 'blocked') return null;
  if (access === 'whitelist' && !(settings.allowList ?? []).includes(externalId)) return null;
  if (access === 'blacklist' && (settings.blockList ?? []).includes(externalId)) {
    await db.endUser.update({ where: { id: endUser.id }, data: { status: 'blocked' } });
    return null;
  }

  // 5. Find or create Conversation
  let conversation = await db.conversation.findFirst({
    where: { tenantId, channelId, endUserId: endUser.id },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { id: generateId('conv'), tenantId, channelId, endUserId: endUser.id },
    });
  }
  const inboundEventId = generateId('in_evt');
  const activeDeliveryRoute = routeCokeAccountId
    ? await db.deliveryRoute.findFirst({
        where: {
          tenantId,
          channelId,
          endUserId: endUser.id,
          externalEndUserId: endUser.externalId,
          cokeAccountId: routeCokeAccountId,
          isActive: true,
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          businessConversationKey: true,
        },
      })
    : null;
  const routeBinding = createRouteBindingSnapshot({
    tenantId,
    channelId,
    endUserId: endUser.id,
    externalEndUserId: endUser.externalId,
    cokeAccountId: routeCokeAccountId,
    customerId: resolvedChannelCustomerId,
    gatewayConversationId: conversation.id,
    previousBusinessConversationKey: conversation.businessConversationKey ?? null,
    previousClawscaleUserId: conversation.clawscaleUserId ?? null,
    deliveryRoute: activeDeliveryRoute,
  });

  await db.message.create({
    data: {
      id: generateId('msg'),
      conversationId: conversation.id,
      role: 'user',
      content: text,
      metadata: {
        ...(meta ?? {}),
        ...(personalChannelOwnership ?? {}),
        ...(resolvedChannelCustomerId
          ? { customerId: resolvedChannelCustomerId, customer_id: resolvedChannelCustomerId }
          : {}),
        ...(resolvedCokeAccountId
          ? { cokeAccountId: resolvedCokeAccountId, coke_account_id: resolvedCokeAccountId }
          : {}),
        ...(routeBinding.businessConversationKey
          ? { businessConversationKey: routeBinding.businessConversationKey }
          : {}),
        gatewayConversationId: routeBinding.gatewayConversationId,
        inboundEventId,
        ...(normalizedAttachments.length ? { attachments: normalizedAttachments } : {}),
      } as any,
    },
  });

  // 6b. Resolve all conversation IDs for the unified identity history.
  let historyConvIds =
    resolvedClawscaleUserId || endUser.linkedTo
      ? await getUnifiedConversationIds({
          tenantId,
          endUserId: endUser.id,
          clawscaleUserId: resolvedClawscaleUserId,
          linkedTo: endUser.linkedTo ?? null,
        })
      : [conversation.id];
  if (
    personalChannelOwnership &&
    Array.isArray(historyConvIds) &&
    historyConvIds.length === 0
  ) {
    historyConvIds = [conversation.id];
  }

  // 7. Load the current custom bridge backends. Retired provider-backed
  // backend types are intentionally excluded from inbound routing.
  const allBackends = await db.aiBackend.findMany({
    where: { tenantId, isActive: true, type: 'custom' },
    orderBy: { createdAt: 'asc' },
  });
  const channelCustomerId = resolvedChannelCustomerId;

  const replies: ReplyEntry[] = [];

  // ── Helper closures ─────────────────────────────────────────────────

  async function reply(content: string, backendId: string | null = null, backendName: string | null = 'Gateway'): Promise<RouteResult> {
    replies.push({ backendId, backendName, reply: content });
    await db.message.create({
      data: {
        id: generateId('msg'),
        conversationId: conversation!.id,
        role: 'assistant',
        content,
        backendId,
      },
    });
    await db.conversation.update({ where: { id: conversation!.id }, data: { updatedAt: new Date() } });
    const combined = formatCombinedReplies(replies);
    return { conversationId: conversation!.id, replies, reply: combined };
  }

  async function addBackend(backendId: string) {
    await db.endUserBackend.upsert({
      where: { endUserId_backendId: { endUserId: endUser!.id, backendId } },
      create: { endUserId: endUser!.id, backendId },
      update: {},
    });
    if (!activeBackendIds.includes(backendId)) activeBackendIds.push(backendId);
  }

  async function routeToBackends(backends: typeof allBackends): Promise<RouteResult> {
    const results = await Promise.allSettled(
      backends.map(async (backend) => {
        const backendReply = await runBackend(backend, historyConvIds, {
          tenantId,
          channelId,
          endUserId: endUser!.id,
          conversationId: conversation!.id,
          gatewayConversationId: routeBinding.gatewayConversationId ?? conversation!.id,
          inboundEventId,
          externalId: endUser!.externalId,
          ...(routeBinding.businessConversationKey
            ? { businessConversationKey: routeBinding.businessConversationKey }
            : {}),
          ...(resolvedClawscaleUserId ? { clawscaleUserId: resolvedClawscaleUserId } : {}),
          ...(channelCustomerId
            ? { customerId: channelCustomerId, customer_id: channelCustomerId }
            : {}),
          ...(routeCokeAccountId
            ? { cokeAccountId: routeCokeAccountId, coke_account_id: routeCokeAccountId }
            : {}),
          ...(personalChannelOwnership ?? {}),
          ...(resolvedAccessAccount && resolvedAccessAccountMetadata
            ? {
                cokeAccountDisplayName: resolvedAccessAccount.displayName,
                accountStatus: resolvedAccessAccountMetadata.accountStatus,
                emailVerified: resolvedAccessAccountMetadata.emailVerified,
                subscriptionActive: resolvedAccessAccountMetadata.subscriptionActive,
                subscriptionExpiresAt: resolvedAccessAccountMetadata.subscriptionExpiresAt,
                accountAccessAllowed: resolvedAccessAccountMetadata.accountAccessAllowed,
                accountAccessDeniedReason: resolvedAccessAccountMetadata.accountAccessDeniedReason,
                renewalUrl: resolvedAccessAccountMetadata.renewalUrl,
              }
            : {}),
        }, {
          sender: endUser!.name ?? displayName,
          platform,
        });
        let bindingErrorCode: string | undefined;
        let bindingErrorMessage: string | undefined;
        if (backendReply.businessConversationKey && routeCokeAccountId) {
          try {
            await bindEndUserToCokeAccount({
              tenantId,
              channelId,
              externalId: endUser!.externalId,
              cokeAccountId: routeCokeAccountId,
            });
            await bindBusinessConversation({
              routeBinding,
              businessConversationKey: backendReply.businessConversationKey,
            });
          } catch (error) {
            let effectiveError = error;
            let code = (effectiveError as { code?: unknown })?.code;
            if (code === 'coke_account_tenant_mismatch') {
              try {
                await upsertDirectDeliveryRoute({
                  tenantId,
                  channelId,
                  endUserId: endUser!.id,
                  externalEndUserId: endUser!.externalId,
                  cokeAccountId: routeCokeAccountId,
                  gatewayConversationId:
                    routeBinding.gatewayConversationId ?? conversation!.id,
                  businessConversationKey: backendReply.businessConversationKey,
                });
              } catch (fallbackError) {
                effectiveError = fallbackError;
                code = (effectiveError as { code?: unknown })?.code;
              }
            }

            if (code === 'coke_account_tenant_mismatch') {
              code = undefined;
              effectiveError = undefined;
            }

            if (effectiveError !== undefined) {
              bindingErrorCode = typeof code === 'string' ? code : undefined;
              bindingErrorMessage =
                effectiveError instanceof Error
                  ? effectiveError.message
                  : 'business conversation bind failed';
              console.error('[business conversation bind error]', {
                tenantId,
                channelId,
                endUserId: endUser!.id,
                externalId: endUser!.externalId,
                conversationId: conversation!.id,
                cokeAccountId: routeCokeAccountId,
                businessConversationKey: backendReply.businessConversationKey,
                ...(bindingErrorCode ? { code: bindingErrorCode } : {}),
                message: bindingErrorMessage,
              });
            }
          }
        }
        return {
          backend,
          backendReply,
          ...(bindingErrorCode ? { bindingErrorCode } : {}),
          ...(bindingErrorMessage ? { bindingErrorMessage } : {}),
        };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { backend, backendReply, bindingErrorCode, bindingErrorMessage } = result.value;
        const replyText = backendReply.text;
        if (!replyText.trim()) {
          continue;
        }
        replies.push({ backendId: backend.id, backendName: backend.name, reply: replyText });
        await db.message.create({
          data: {
            id: generateId('msg'),
            conversationId: conversation!.id,
            role: 'assistant',
            content: replyText,
            backendId: backend.id,
            metadata: {
              backendName: backend.name,
              ...(backendReply.businessConversationKey
                ? { businessConversationKey: backendReply.businessConversationKey }
                : {}),
              ...(backendReply.outputId ? { outputId: backendReply.outputId } : {}),
              ...(backendReply.causalInboundEventId
                ? { causalInboundEventId: backendReply.causalInboundEventId }
                : {}),
              ...(bindingErrorCode
                ? { businessConversationBindingErrorCode: bindingErrorCode }
                : {}),
              ...(bindingErrorMessage
                ? { businessConversationBindingErrorMessage: bindingErrorMessage }
                : {}),
            },
          },
        });
      } else {
        console.error('[backend error]', (result as PromiseRejectedResult).reason);
      }
    }
    await db.conversation.update({ where: { id: conversation!.id }, data: { updatedAt: new Date() } });
    const combined = formatCombinedReplies(replies);
    return { conversationId: conversation!.id, replies, reply: combined };
  }

  // 8. Parse supported Gateway commands
  const cmd = parseCommand(text);
  const activeBackends = allBackends.filter((b) => activeBackendIds.includes(b.id));

  if (cmd) {
    switch (cmd.command) {
        case 'help': {
          return reply(formatCommandHelp());
        }

        case 'clear': {
          // Delete all messages in the conversation
          await db.message.deleteMany({ where: { conversationId: conversation.id } });
          return reply('✅ Conversation context cleared.');
        }

        case 'link': {
          if (!cmd.arg) {
            // Generate a link code
            const code = String(Math.floor(100000 + Math.random() * 900000));
            await db.linkCode.create({
              data: {
                code,
                tenantId,
                endUserId: endUser!.id,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              },
            });
            return reply(`Your link code: **${code}**\n\nEnter this code from your other channel within 10 minutes:\n\`/link ${code}\``);
          }

          // Consume a link code
          const linkCode = await db.linkCode.findFirst({
            where: {
              code: cmd.arg,
              used: false,
              tenantId,
              expiresAt: { gt: new Date() },
            },
            include: { endUser: true },
          });

          if (!linkCode) {
            return reply('Invalid or expired link code.');
          }
          if (linkCode.endUserId === endUser!.id) {
            return reply("You can't link to yourself.");
          }

          // Resolve primary: if source is already linked, follow to its primary
          const primaryId = linkCode.endUser.linkedTo ?? linkCode.endUserId;

          // Set current EndUser's linkedTo
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { linkedTo: primaryId },
          });

          // Mark code as used
          await db.linkCode.update({
            where: { id: linkCode.id },
            data: { used: true },
          });

          // Copy active backends from primary
          const primaryBackends = await db.endUserBackend.findMany({
            where: { endUserId: primaryId },
          });
          for (const pb of primaryBackends) {
            await db.endUserBackend.upsert({
              where: { endUserId_backendId: { endUserId: endUser!.id, backendId: pb.backendId } },
              create: { endUserId: endUser!.id, backendId: pb.backendId },
              update: {},
            });
          }

          const sourceName = linkCode.endUser.name ?? linkCode.endUser.externalId;
          return reply(`✅ Linked to *${sourceName}*'s account. Your identities are now connected across channels.`);
        }

        case 'unlink': {
          if (!endUser!.linkedTo) {
            return reply('This channel is not linked to another account.');
          }
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { linkedTo: null },
          });
          return reply('✅ Unlinked. This channel now has its own separate identity.');
        }

        case 'linked': {
          const primaryId = endUser!.linkedTo ?? endUser!.id;

          const linkedUsers = await db.endUser.findMany({
            where: {
              tenantId,
              OR: [
                { id: primaryId },
                { linkedTo: primaryId },
              ],
            },
            include: { channel: { select: { name: true, type: true } } },
            orderBy: { createdAt: 'asc' },
          });

          if (linkedUsers.length <= 1) {
            return reply('No linked accounts. Use `/link` to generate a link code and connect another channel.');
          }

          const lines = linkedUsers.map((u) => {
            const name = u.name ?? u.externalId;
            const isCurrent = u.id === endUser!.id ? ' ← you' : '';
            const isPrimary = u.id === primaryId ? ' (primary)' : '';
            return `• *${name}* — ${u.channel.name} (${u.channel.type})${isPrimary}${isCurrent}`;
          });

          return reply(`*Linked accounts:*\n\n${lines.join('\n')}`);
        }

        case 'deleteaccount': {
          if (cmd.arg.toLowerCase() !== 'confirm') {
            return reply(
              '⚠️ *This will permanently delete your account and all associated data* (conversations, messages, linked accounts, and backend selections).\n\n' +
              'This action cannot be undone.\n\n' +
              'To confirm, type: `/deleteaccount confirm`',
            );
          }

          const userId = endUser!.id;
          const confirmMsg = '✅ Your account and all associated data have been permanently deleted. Your next message will create a new account.';

          // Reply BEFORE deleting — deletion cascades to conversations/messages
          const result = await reply(confirmMsg);

          // Unlink any accounts that point to this user as primary
          await db.endUser.updateMany({
            where: { linkedTo: userId },
            data: { linkedTo: null },
          });

          // Delete the EndUser (cascades to conversations, messages, backends, link codes)
          await db.endUser.delete({ where: { id: userId } });

          return result;
        }
    }
  }

  // 9. No command — route to active backends or auto-select the default bridge.
  if (activeBackends.length > 0) {
    return routeToBackends(activeBackends);
  }

  // No active backends — recover onto the tenant default backend for brand-new
  // users, personal channels, and shared channels whose EndUser row was
  // created before the tenant backend existed.
  if (isNewUser || personalChannelOwnership || channel.ownershipKind === 'shared') {
    const defaultBackend = allBackends.find((b) => b.isDefault);
    const autoSelect = defaultBackend ?? (allBackends.length === 1 ? allBackends[0] : null);

    if (autoSelect) {
      await addBackend(autoSelect.id);
      return routeToBackends([autoSelect]);
    }
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadHistory(conversationIds: string | string[], backendId: string | null) {
  const ids = Array.isArray(conversationIds) ? conversationIds : [conversationIds];
  const msgs = await db.message.findMany({
    where: {
      conversationId: { in: ids },
      OR: [
        { role: 'user' },
        { role: 'assistant', backendId },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { role: true, content: true, metadata: true },
  });
  return [...msgs].reverse().map((m) => {
    const meta = m.metadata as Record<string, unknown> | null;
    const attachments = scrubHistoryAttachments(meta?.attachments);
    return { role: m.role as 'user' | 'assistant', content: m.content, ...(attachments.length ? { attachments } : {}) };
  });
}

function scrubHistoryAttachments(rawAttachments: unknown): Attachment[] {
  const normalized = normalizeInboundAttachments(rawAttachments);
  if (normalized.rejected) return [];
  return normalized.attachments.map((attachment) => ({
    ...attachment,
    url: attachment.safeDisplayUrl,
  }));
}

async function runBackend(
  backend: { id: string; type: string; config: unknown },
  conversationIds: string | string[],
  metadata: {
    tenantId: string;
    channelId: string;
    endUserId: string;
    conversationId: string;
    gatewayConversationId: string;
    inboundEventId: string;
    externalId: string;
    businessConversationKey?: string;
    clawscaleUserId?: string;
    cokeAccountId?: string;
    coke_account_id?: string;
    customerId?: string;
    customer_id?: string;
    cokeAccountDisplayName?: string | null;
    accountStatus?: 'normal' | 'suspended';
    emailVerified?: boolean;
    subscriptionActive?: boolean;
    subscriptionExpiresAt?: string | null;
    accountAccessAllowed?: boolean;
    accountAccessDeniedReason?:
      | 'email_not_verified'
      | 'subscription_required'
      | 'account_suspended'
      | null;
    renewalUrl?: string;
    channelScope?: 'personal' | 'tenant_shared';
  },
  meta?: { sender?: string; platform?: string },
): Promise<BackendReplyPayload> {
  const history = await loadHistory(conversationIds, backend.id);
  const cfg = (backend.config ?? {}) as AiBackendProviderConfig;
  const backendReply = await generateReply({
    backend: {
      type: backend.type as AiBackendType,
      config: cfg,
    },
    history,
    sender: meta?.sender,
    platform: meta?.platform,
    metadata,
  });
  if (typeof backendReply === 'string') {
    return { text: backendReply };
  }
  return {
    text: backendReply.text ?? '',
    ...(backendReply.businessConversationKey
      ? { businessConversationKey: backendReply.businessConversationKey }
      : {}),
    ...(backendReply.outputId ? { outputId: backendReply.outputId } : {}),
    ...(backendReply.causalInboundEventId
      ? { causalInboundEventId: backendReply.causalInboundEventId }
      : {}),
  };
}
