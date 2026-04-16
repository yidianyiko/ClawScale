import { describe, expect, it } from 'vitest';

import {
  evaluateStrandedModelRetirement,
  findBrokenActiveDeliveryRouteResolution,
  MOVED_TO_AGENT_STORAGE_ERROR,
} from '../scripts/verify-stranded-model-retirement.js';

describe('verify stranded model retirement helpers', () => {
  it('accepts active delivery routes that resolve through businessConversationKey alone', () => {
    const broken = findBrokenActiveDeliveryRouteResolution([
      {
        businessConversationKey: 'biz_conv_1',
        cokeAccountId: 'acct_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'wxid_123',
        hasChannel: true,
        hasEndUser: true,
        hasClawscaleUser: true,
        resolvedRoute: {
          tenantId: 'ten_1',
          cokeAccountId: 'acct_1',
          businessConversationKey: 'biz_conv_1',
          channelId: 'ch_1',
          endUserId: 'eu_1',
          externalEndUserId: 'wxid_123',
          isActive: true,
        },
      },
    ]);

    expect(broken).toBeNull();
  });

  it('flags active delivery routes that cannot be re-resolved through businessConversationKey', () => {
    const broken = findBrokenActiveDeliveryRouteResolution([
      {
        businessConversationKey: 'biz_conv_1',
        cokeAccountId: 'acct_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'wxid_123',
        hasChannel: true,
        hasEndUser: true,
        hasClawscaleUser: true,
        resolvedRoute: {
          tenantId: 'ten_1',
          cokeAccountId: 'acct_1',
          businessConversationKey: 'biz_conv_1',
          channelId: 'ch_other',
          endUserId: 'eu_1',
          externalEndUserId: 'wxid_123',
          isActive: true,
        },
      },
    ]);

    expect(broken).toMatchObject({
      businessConversationKey: 'biz_conv_1',
      cokeAccountId: 'acct_1',
    });
  });

  it('reports deferred survivors without failing when the safe retirement subset is present', () => {
    const summary = evaluateStrandedModelRetirement({
      schema: `
        model Conversation {
          /// Compatibility survivor: route-binding minimum retained until agent storage cutover completes.
          id String @id
        }

        model Message {
          /// Compatibility survivor: message history still reads from gateway storage.
          id String @id
        }

        model AiBackend {
          /// Compatibility survivor: backend registry still powers bridge delivery and message attribution.
          id String @id
        }

        model EndUserBackend {
          /// Compatibility survivor: per-end-user backend selections still read from gateway storage.
          endUserId String
          backendId String
        }
      `,
      migrationFiles: {
        '20260416000000_legacy_schema_baseline/migration.sql':
          'CREATE TABLE "workflows" ("id" TEXT NOT NULL); CREATE TABLE "conversations" ("id" TEXT NOT NULL, "backend_id" TEXT);',
        '20260417010000_stranded_model_retirement/migration.sql':
          'DROP TABLE "workflows"; ALTER TABLE "conversations" DROP COLUMN "backend_id"; DROP TYPE "WorkflowType";',
      },
      deferredUsageCounts: {
        Conversation: 3,
        Message: 9,
        AiBackend: 2,
        EndUserBackend: 4,
      },
    });

    expect(summary.errors).toEqual([]);
    expect(summary.tombstone).toEqual({
      status: 410,
      payload: { ok: false, error: MOVED_TO_AGENT_STORAGE_ERROR },
    });
    expect(summary.deferredSurvivors).toEqual([
      {
        model: 'Conversation',
        reason: 'route_binding_minimum',
      },
      {
        model: 'Message',
        reason: 'history_read_compatibility',
      },
      {
        model: 'AiBackend',
        reason: 'backend_registry_compatibility',
      },
      {
        model: 'EndUserBackend',
        reason: 'per_end_user_backend_selection_compatibility',
      },
    ]);
    expect(summary.deferredUsageCounts).toEqual({
      Conversation: 3,
      Message: 9,
      AiBackend: 2,
      EndUserBackend: 4,
    });
  });

  it('fails when workflow retirement or active delivery-route resolution is broken', () => {
    const summary = evaluateStrandedModelRetirement({
      schema: `
        enum WorkflowType {
          script_js
        }

        model Workflow {
          id String @id
        }

        model Conversation {
          /// Compatibility survivor: route-binding minimum retained until agent storage cutover completes.
          id String @id
          backendId String?
        }
      `,
      migrationFiles: {
        '20260416000000_legacy_schema_baseline/migration.sql':
          'CREATE TABLE "workflows" ("id" TEXT NOT NULL);',
        '20260417010000_stranded_model_retirement/migration.sql':
          'ALTER TABLE "conversations" DROP COLUMN "backend_id";',
      },
      routeBindingCheck: {
        businessConversationKey: 'biz_legacy',
      },
    });

    expect(summary.errors).toEqual([
      'workflow_model_still_present',
      'workflow_enum_still_present',
      'conversation_backend_id_still_present',
      'workflow_retirement_migration_missing_drop_table',
      'workflow_retirement_migration_missing_drop_type',
      'active_delivery_route_resolution_failed',
    ]);
  });
});
