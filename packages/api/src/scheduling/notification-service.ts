export interface EnqueueProductNotificationInput {
  requestId: string;
  requestType: 'friend_request' | 'shared_reminder_request';
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  text: string;
  metadata: Record<string, unknown>;
}

interface ProductNotificationRecord {
  id: string;
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  payload: unknown;
}

interface ProductNotificationClient {
  productNotification: {
    create(args: { data: Record<string, unknown> }): Promise<ProductNotificationRecord | Record<string, unknown>>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<ProductNotificationRecord[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

interface ProductNotificationPayload {
  text: string;
  metadata: Record<string, unknown>;
}

const retryableProductNotificationStatus = { in: ['pending_delivery', 'failed'] };

function readBridgeInboundUrl(): string {
  return (
    process.env['COKE_BRIDGE_INBOUND_URL']?.trim() ||
    'http://127.0.0.1:8090/bridge/inbound'
  );
}

function readBridgeHeaders(): Record<string, string> {
  const apiKey = process.env['COKE_BRIDGE_API_KEY']?.trim();
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function productNotificationConversationKey(recipientAccountId: string): string {
  return `product-notification:${recipientAccountId}`;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function requestRelationField(
  requestType: EnqueueProductNotificationInput['requestType'],
  requestId: string,
): Record<string, string> {
  if (requestType === 'friend_request') {
    return { friendRequestId: requestId };
  }
  return { sharedReminderRequestId: requestId };
}

function readPayload(record: ProductNotificationRecord): ProductNotificationPayload {
  const payload = record.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('invalid_product_notification_payload');
  }
  const row = payload as Record<string, unknown>;
  const text = typeof row['text'] === 'string' ? row['text'] : '';
  const metadata =
    typeof row['metadata'] === 'object' && row['metadata'] !== null && !Array.isArray(row['metadata'])
      ? (row['metadata'] as Record<string, unknown>)
      : {};
  if (!text.trim()) {
    throw new Error('invalid_product_notification_payload');
  }
  return { text, metadata };
}

async function deliverProductNotification(record: ProductNotificationRecord): Promise<void> {
  const payload = readPayload(record);
  let response: Response;
  try {
    response = await fetch(readBridgeInboundUrl(), {
      method: 'POST',
      headers: readBridgeHeaders(),
      body: JSON.stringify({
        customer_id: record.recipientAccountId,
        tenant_id: 'product_notification',
        channel_id: 'product_notification',
        platform: 'product_notification',
        external_id: record.recipientAccountId,
        end_user_id: record.recipientAccountId,
        business_conversation_key: productNotificationConversationKey(
          record.recipientAccountId,
        ),
        gateway_conversation_id: productNotificationConversationKey(
          record.recipientAccountId,
        ),
        inbound_event_id: record.idempotencyKey,
        input: payload.text,
        text: payload.text,
        timestamp: Date.now(),
        message_type: 'product_notification',
        product_notification: {
          ...payload.metadata,
          kind: record.kind,
        },
      }),
    });
  } catch {
    throw new Error('product_notification_transport_failed');
  }
  if (!response.ok) {
    throw new Error('product_notification_delivery_failed');
  }
}

async function markDelivered(
  client: ProductNotificationClient,
  notificationId: string,
): Promise<void> {
  await client.productNotification.updateMany({
    where: { id: notificationId, status: retryableProductNotificationStatus },
    data: {
      status: 'delivered',
      deliveredAt: new Date(),
      lastError: null,
    },
  });
}

async function markFailed(
  client: ProductNotificationClient,
  notificationId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : 'product_notification_delivery_failed';
  await client.productNotification.updateMany({
    where: { id: notificationId, status: retryableProductNotificationStatus },
    data: {
      status: 'failed',
      attempts: { increment: 1 },
      lastError: message,
    },
  });
}

export async function enqueueProductNotification(
  client: ProductNotificationClient,
  input: EnqueueProductNotificationInput,
): Promise<void> {
  let notification: ProductNotificationRecord | Record<string, unknown>;
  try {
    notification = await client.productNotification.create({
      data: {
        ...requestRelationField(input.requestType, input.requestId),
        recipientAccountId: input.recipientAccountId,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        payload: {
          text: input.text,
          metadata: input.metadata,
        },
        status: 'pending_delivery',
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return;
    }
    throw error;
  }

  const record = notification as ProductNotificationRecord;
  try {
    await deliverProductNotification(record);
    await markDelivered(client, record.id);
  } catch (error) {
    await markFailed(client, record.id, error);
  }
}

export async function deliverPendingProductNotifications(
  client: ProductNotificationClient,
  input: { limit?: number } = {},
): Promise<{ delivered: number; failed: number }> {
  const limit = input.limit && input.limit > 0 ? input.limit : 50;
  const notifications = await client.productNotification.findMany({
    where: { status: retryableProductNotificationStatus },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let delivered = 0;
  let failed = 0;
  for (const notification of notifications) {
    try {
      await deliverProductNotification(notification);
      await markDelivered(client, notification.id);
      delivered += 1;
    } catch (error) {
      await markFailed(client, notification.id, error);
      failed += 1;
    }
  }
  return { delivered, failed };
}
