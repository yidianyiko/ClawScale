export interface RouteBindingSnapshot {
  tenantId: string;
  channelId: string;
  endUserId: string;
  externalEndUserId: string;
  cokeAccountId: string | null;
  customerId: string | null;
  gatewayConversationId: string | null;
  businessConversationKey: string | null;
  previousBusinessConversationKey: string | null;
  previousClawscaleUserId: string | null;
}

export interface RouteBindingDeliveryRoute {
  businessConversationKey: string;
}

export interface CreateRouteBindingSnapshotInput {
  tenantId: string;
  channelId: string;
  endUserId: string;
  externalEndUserId: string;
  cokeAccountId: string | null;
  customerId: string | null;
  gatewayConversationId: string | null;
  previousBusinessConversationKey: string | null;
  previousClawscaleUserId: string | null;
  deliveryRoute?: RouteBindingDeliveryRoute | null;
}

export interface LegacyConversationRouteBindingSource {
  tenantId: string;
  channelId: string;
  endUserId: string;
  businessConversationKey: string | null;
  endUser: {
    externalId: string | null;
  } | null;
  clawscaleUser: {
    cokeAccountId: string | null;
  } | null;
}

export interface RouteBindingRecord {
  tenantId: string;
  cokeAccountId: string;
  businessConversationKey: string;
  channelId: string;
  endUserId: string;
  externalEndUserId: string;
  isActive: boolean;
}

export interface RouteBindingBackfillConflict {
  cokeAccountId: string;
  businessConversationKey: string;
  records: RouteBindingRecord[];
}

export interface CollectedRouteBindingBackfill {
  records: RouteBindingRecord[];
  conflicts: RouteBindingBackfillConflict[];
}

function asNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createRouteBindingSnapshot(
  input: CreateRouteBindingSnapshotInput,
): RouteBindingSnapshot {
  return {
    tenantId: input.tenantId,
    channelId: input.channelId,
    endUserId: input.endUserId,
    externalEndUserId: input.externalEndUserId,
    cokeAccountId: input.cokeAccountId,
    customerId: input.customerId,
    gatewayConversationId: input.gatewayConversationId,
    businessConversationKey:
      input.deliveryRoute?.businessConversationKey ??
      input.previousBusinessConversationKey ??
      null,
    previousBusinessConversationKey: input.previousBusinessConversationKey,
    previousClawscaleUserId: input.previousClawscaleUserId,
  };
}

export function deriveRouteBindingRecordFromConversation(
  conversation: LegacyConversationRouteBindingSource,
): RouteBindingRecord | null {
  const businessConversationKey = asNonEmptyString(conversation.businessConversationKey);
  const externalEndUserId = asNonEmptyString(conversation.endUser?.externalId);
  const cokeAccountId = asNonEmptyString(conversation.clawscaleUser?.cokeAccountId);

  if (!businessConversationKey || !externalEndUserId || !cokeAccountId) {
    return null;
  }

  return {
    tenantId: conversation.tenantId,
    cokeAccountId,
    businessConversationKey,
    channelId: conversation.channelId,
    endUserId: conversation.endUserId,
    externalEndUserId,
    isActive: true,
  };
}

function makeRouteBindingCompositeKey(record: RouteBindingRecord): string {
  return `${record.cokeAccountId}::${record.businessConversationKey}`;
}

function sameRouteBindingRecord(
  left: RouteBindingRecord,
  right: RouteBindingRecord,
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.cokeAccountId === right.cokeAccountId &&
    left.businessConversationKey === right.businessConversationKey &&
    left.channelId === right.channelId &&
    left.endUserId === right.endUserId &&
    left.externalEndUserId === right.externalEndUserId &&
    left.isActive === right.isActive
  );
}

export function collectBackfillRouteBindingRecords(
  conversations: LegacyConversationRouteBindingSource[],
): CollectedRouteBindingBackfill {
  const grouped = new Map<string, RouteBindingRecord[]>();

  for (const conversation of conversations) {
    const record = deriveRouteBindingRecordFromConversation(conversation);
    if (!record) continue;

    const key = makeRouteBindingCompositeKey(record);
    const existing = grouped.get(key) ?? [];
    existing.push(record);
    grouped.set(key, existing);
  }

  const records: RouteBindingRecord[] = [];
  const conflicts: RouteBindingBackfillConflict[] = [];

  for (const [key, groupedRecords] of grouped.entries()) {
    const [firstRecord, ...rest] = groupedRecords;
    if (!firstRecord) continue;

    const hasConflict = rest.some((record) => !sameRouteBindingRecord(firstRecord, record));
    if (hasConflict) {
      conflicts.push({
        cokeAccountId: firstRecord.cokeAccountId,
        businessConversationKey: firstRecord.businessConversationKey,
        records: groupedRecords,
      });
      continue;
    }

    records.push(firstRecord);
  }

  return { records, conflicts };
}
