import { db } from '../db/index.js';
import { collectBackfillRouteBindingRecords } from '../lib/route-binding.js';

function hasDryRunFlag() {
  return process.argv.includes('--dry-run');
}

export async function backfillRouteBindings(options: { dryRun?: boolean } = {}) {
  const dryRun = options.dryRun ?? false;
  const conversations = await db.conversation.findMany({
    select: {
      tenantId: true,
      channelId: true,
      endUserId: true,
      businessConversationKey: true,
      endUser: {
        select: {
          externalId: true,
        },
      },
      clawscaleUser: {
        select: {
          cokeAccountId: true,
        },
      },
    },
  });

  const { records, conflicts } = collectBackfillRouteBindingRecords(conversations);

  if (conflicts.length > 0) {
    const summary = {
      dryRun,
      scanned: conversations.length,
      derived: records.length,
      conflicts,
    };
    console.log(JSON.stringify(summary, null, 2));
    throw new Error('route_binding_backfill_conflicts_detected');
  }

  if (!dryRun) {
    for (const record of records) {
      await db.deliveryRoute.upsert({
        where: {
          cokeAccountId_businessConversationKey: {
            cokeAccountId: record.cokeAccountId,
            businessConversationKey: record.businessConversationKey,
          },
        },
        create: record,
        update: {
          tenantId: record.tenantId,
          channelId: record.channelId,
          endUserId: record.endUserId,
          externalEndUserId: record.externalEndUserId,
          isActive: true,
        },
      });
    }
  }

  return {
    dryRun,
    scanned: conversations.length,
    derived: records.length,
    conflicts: [],
  };
}

async function main() {
  const summary = await backfillRouteBindings({
    dryRun: hasDryRunFlag(),
  });

  console.log(JSON.stringify(summary, null, 2));
}

await main();
