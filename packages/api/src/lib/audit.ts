import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { generateId } from './id.js';

export async function audit(params: {
  tenantId: string;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    id: generateId('audit'),
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId ?? null,
    meta: params.meta ?? null,
  });
}
