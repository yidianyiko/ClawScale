interface SchedulingNotificationClient {
  schedulingNotification: {
    create(args: { data: Record<string, unknown> }): Promise<SchedulingNotificationRecord>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<SchedulingNotificationRecord[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface SchedulingNotificationRecord {
  id: string;
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  payload: unknown;
}

interface SchedulingNotificationPayload {
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface EnqueueSchedulingNotificationInput {
  appointmentId: string;
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  text: string;
  metadata: Record<string, unknown>;
}

function readBridgeInboundUrl(): string {
  return process.env['COKE_BRIDGE_INBOUND_URL']?.trim() || 'http://127.0.0.1:8090/bridge/inbound';
}

function bridgeHeaders(): Record<string, string> {
  const apiKey = process.env['COKE_BRIDGE_API_KEY']?.trim();
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function notificationPayload(payload: unknown): SchedulingNotificationPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const value = payload as SchedulingNotificationPayload;
  return {
    text: typeof value.text === 'string' ? value.text : undefined,
    metadata: value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? value.metadata : undefined,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markDeliveryFailure(
  client: SchedulingNotificationClient,
  notification: SchedulingNotificationRecord,
  error: unknown,
): Promise<void> {
  await client.schedulingNotification.update({
    where: { id: notification.id },
    data: {
      attempts: { increment: 1 },
      lastError: errorMessage(error),
    },
  });
}

async function deliver(notification: SchedulingNotificationRecord, client: SchedulingNotificationClient): Promise<void> {
  const payload = notificationPayload(notification.payload);
  const response = await fetch(readBridgeInboundUrl(), {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({
      customer_id: notification.recipientAccountId,
      inbound_event_id: notification.idempotencyKey,
      text: payload.text,
      timestamp: Math.floor(Date.now() / 1000),
      message_type: 'scheduling_notification',
      scheduling: {
        ...(payload.metadata || {}),
        kind: notification.kind,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`bridge_http_${response.status}`);
  }
  await client.schedulingNotification.update({
    where: { id: notification.id },
    data: { status: 'delivered', deliveredAt: new Date(), lastError: null },
  });
}

export async function enqueueSchedulingNotification(
  client: SchedulingNotificationClient,
  input: EnqueueSchedulingNotificationInput,
): Promise<SchedulingNotificationRecord> {
  const notification = await client.schedulingNotification.create({
    data: {
      appointmentId: input.appointmentId,
      recipientAccountId: input.recipientAccountId,
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      payload: { text: input.text, metadata: input.metadata },
      status: 'pending_delivery',
    },
  });
  try {
    await deliver(notification, client);
  } catch (error) {
    await markDeliveryFailure(client, notification, error);
    throw error;
  }
  return notification;
}

export async function retryPendingSchedulingNotifications(
  client: SchedulingNotificationClient,
  input: { limit: number },
): Promise<{ delivered: number; failed: number }> {
  const pending = await client.schedulingNotification.findMany({
    where: { status: 'pending_delivery' },
    orderBy: { createdAt: 'asc' },
    take: input.limit,
  });
  let delivered = 0;
  let failed = 0;
  for (const notification of pending) {
    try {
      await deliver(notification, client);
      delivered += 1;
    } catch (error) {
      failed += 1;
      await markDeliveryFailure(client, notification, error);
    }
  }
  return { delivered, failed };
}
