import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';

import { db } from '../db/index.js';
import {
  resolveExactDeliveryRoute,
  type DeliveryRouteRecord,
} from '../lib/business-conversation.js';

export const MOVED_TO_AGENT_STORAGE_ERROR = 'moved_to_agent_storage';
const GONE_STATUS = 410;

const DEFERRED_SURVIVOR_REASONS = {
  Conversation: 'route_binding_minimum',
  Message: 'history_read_compatibility',
  AiBackend: 'backend_registry_compatibility',
  EndUserBackend: 'per_end_user_backend_selection_compatibility',
} as const;

type DeferredSurvivorModel = keyof typeof DEFERRED_SURVIVOR_REASONS;

interface RouteBindingCheck {
  businessConversationKey?: string | null;
  cokeAccountId?: string | null;
  resolved?: boolean;
}

interface ActiveDeliveryRouteResolutionCheck {
  businessConversationKey: string | null;
  cokeAccountId: string | null;
  channelId: string | null;
  endUserId: string | null;
  externalEndUserId: string | null;
  hasChannel: boolean;
  hasEndUser: boolean;
  hasClawscaleUser: boolean;
  resolvedRoute?: DeliveryRouteRecord | null;
}

interface RetirementEvaluationInput {
  schema: string;
  migrationFiles: Record<string, string>;
  routeBindingCheck?: RouteBindingCheck;
  deferredUsageCounts?: Partial<Record<DeferredSurvivorModel, number>>;
}

interface TombstoneSummary {
  status: number;
  payload: {
    ok: false;
    error: typeof MOVED_TO_AGENT_STORAGE_ERROR;
  };
}

interface DeferredSurvivor {
  model: DeferredSurvivorModel;
  reason: (typeof DEFERRED_SURVIVOR_REASONS)[DeferredSurvivorModel];
}

interface StrandedModelRetirementSummary {
  errors: string[];
  deferredSurvivors: DeferredSurvivor[];
  deferredUsageCounts?: Partial<Record<DeferredSurvivorModel, number>>;
  tombstone: TombstoneSummary;
}

function getModelBlock(schema: string, modelName: string) {
  return schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\s*\\}`, 'm'))?.[0] ?? '';
}

function findMigration(
  migrationFiles: Record<string, string>,
  suffix: string,
) {
  return Object.entries(migrationFiles).find(([path]) => path.endsWith(suffix))?.[1] ?? '';
}

export function findBrokenActiveDeliveryRouteResolution(
  checks: ActiveDeliveryRouteResolutionCheck[],
): ActiveDeliveryRouteResolutionCheck | null {
  for (const check of checks) {
    if (
      !check.businessConversationKey ||
      !check.cokeAccountId ||
      !check.channelId ||
      !check.endUserId ||
      !check.externalEndUserId ||
      !check.hasChannel ||
      !check.hasEndUser ||
      !check.hasClawscaleUser
    ) {
      return check;
    }

    if (
      !check.resolvedRoute ||
      check.resolvedRoute.isActive !== true ||
      check.resolvedRoute.channelId !== check.channelId ||
      check.resolvedRoute.endUserId !== check.endUserId ||
      check.resolvedRoute.externalEndUserId !== check.externalEndUserId
    ) {
      return check;
    }
  }

  return null;
}

export function evaluateStrandedModelRetirement(
  input: RetirementEvaluationInput,
): StrandedModelRetirementSummary {
  const errors: string[] = [];
  const conversationModel = getModelBlock(input.schema, 'Conversation');
  const retirementMigration = findMigration(
    input.migrationFiles,
    'stranded_model_retirement/migration.sql',
  );

  if (input.schema.includes('model Workflow {')) {
    errors.push('workflow_model_still_present');
  }
  if (input.schema.includes('enum WorkflowType')) {
    errors.push('workflow_enum_still_present');
  }
  if (conversationModel.includes('backendId')) {
    errors.push('conversation_backend_id_still_present');
  }
  if (!retirementMigration.includes('DROP TABLE "workflows"')) {
    errors.push('workflow_retirement_migration_missing_drop_table');
  }
  if (!retirementMigration.includes('DROP TYPE "WorkflowType"')) {
    errors.push('workflow_retirement_migration_missing_drop_type');
  }
  if (input.routeBindingCheck && input.routeBindingCheck.resolved !== true) {
    errors.push('active_delivery_route_resolution_failed');
  }

  const deferredSurvivors = (Object.entries(
    DEFERRED_SURVIVOR_REASONS,
  ) as Array<[DeferredSurvivorModel, DeferredSurvivor['reason']]>)
    .filter(([model]) => input.schema.includes(`model ${model} {`))
    .map(([model, reason]) => ({ model, reason }));

  return {
    errors,
    deferredSurvivors,
    ...(input.deferredUsageCounts ? { deferredUsageCounts: input.deferredUsageCounts } : {}),
    tombstone: {
      status: GONE_STATUS,
      payload: {
        ok: false,
        error: MOVED_TO_AGENT_STORAGE_ERROR,
      },
    },
  };
}

function readMigrationFiles(dirPath: string, relativeDir = ''): Record<string, string> {
  if (!existsSync(dirPath)) {
    return {};
  }

  const files: Record<string, string> = {};
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = resolve(dirPath, entry.name);
    const entryRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(files, readMigrationFiles(entryPath, entryRelative));
      continue;
    }
    if (entry.isFile() && entry.name === 'migration.sql') {
      files[entryRelative] = readFileSync(entryPath, 'utf8');
    }
  }

  return files;
}

async function tableExists(tableName: string) {
  const rows = await db.$queryRaw<Array<{ exists: string | null }>>(Prisma.sql`
    SELECT to_regclass(${`public.${tableName}`})::text AS "exists"
  `);

  return Boolean(rows[0]?.exists);
}

async function columnExists(tableName: string, columnName: string) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `);

  return rows[0]?.exists === true;
}

async function getActiveDeliveryRoutesForVerification() {
  return db.$queryRaw<Array<{
    businessConversationKey: string | null;
    cokeAccountId: string | null;
    channelId: string | null;
    endUserId: string | null;
    externalEndUserId: string | null;
    hasChannel: boolean;
    hasEndUser: boolean;
    hasClawscaleUser: boolean;
  }>>(Prisma.sql`
    SELECT
      dr.business_conversation_key AS "businessConversationKey",
      dr.coke_account_id AS "cokeAccountId",
      dr.channel_id AS "channelId",
      dr.end_user_id AS "endUserId",
      dr.external_end_user_id AS "externalEndUserId",
      ch.id IS NOT NULL AS "hasChannel",
      eu.id IS NOT NULL AS "hasEndUser",
      cu.id IS NOT NULL AS "hasClawscaleUser"
    FROM delivery_routes dr
    LEFT JOIN channels ch ON ch.id = dr.channel_id
    LEFT JOIN end_users eu ON eu.id = dr.end_user_id
    LEFT JOIN clawscale_users cu ON cu.coke_account_id = dr.coke_account_id
    WHERE dr.is_active = TRUE
  `);
}

async function verifyStrandedModelRetirement() {
  const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
  const migrationsDir = resolve(process.cwd(), 'prisma/migrations');
  const schema = readFileSync(schemaPath, 'utf8');
  const migrationFiles = readMigrationFiles(migrationsDir);
  const activeRoutes = await getActiveDeliveryRoutesForVerification();
  const activeRouteChecks = await Promise.all(
    activeRoutes.map(async (route) => {
      if (!route.businessConversationKey || !route.cokeAccountId) {
        return {
          ...route,
          resolvedRoute: null,
        };
      }

      try {
        const resolvedRoute = await resolveExactDeliveryRoute({
          cokeAccountId: route.cokeAccountId,
          businessConversationKey: route.businessConversationKey,
        });

        return {
          ...route,
          resolvedRoute,
        };
      } catch {
        return {
          ...route,
          resolvedRoute: null,
        };
      }
    }),
  );
  const brokenRoute = findBrokenActiveDeliveryRouteResolution(activeRouteChecks);
  const [conversationCount, messageCount, aiBackendCount, endUserBackendCount] = await Promise.all([
    db.conversation.count(),
    db.message.count(),
    db.aiBackend.count(),
    db.endUserBackend.count(),
  ]);

  const summary = evaluateStrandedModelRetirement({
    schema,
    migrationFiles,
    deferredUsageCounts: {
      Conversation: conversationCount,
      Message: messageCount,
      AiBackend: aiBackendCount,
      EndUserBackend: endUserBackendCount,
    },
    ...(brokenRoute
      ? {
          routeBindingCheck: {
            businessConversationKey: brokenRoute.businessConversationKey,
            cokeAccountId: brokenRoute.cokeAccountId,
            resolved: false,
          },
        }
      : {}),
  });

  if (await tableExists('workflows')) {
    summary.errors.push('workflow_table_still_present');
  }
  if (await columnExists('conversations', 'backend_id')) {
    summary.errors.push('conversation_backend_id_column_still_present');
  }

  return summary;
}

async function main() {
  const summary = await verifyStrandedModelRetirement();

  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
