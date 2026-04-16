import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
const baselineMigrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260416000000_legacy_schema_baseline/migration.sql',
);
const retirementMigrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260417010000_stranded_model_retirement/migration.sql',
);

function getModelBlock(schema: string, modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'm'));
  expect(match, `expected to find model ${modelName}`).toBeTruthy();
  return match?.[0].replace(/[ \t]+/g, ' ') ?? '';
}

describe('stranded model retirement schema guard', () => {
  it('retires workflow and keeps only documented compatibility survivors', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const compactSchema = schema.replace(/[ \t]+/g, ' ');
    const tenantModel = getModelBlock(schema, 'Tenant');
    const conversationModel = getModelBlock(schema, 'Conversation');
    const messageModel = getModelBlock(schema, 'Message');
    const aiBackendModel = getModelBlock(schema, 'AiBackend');
    const endUserBackendModel = getModelBlock(schema, 'EndUserBackend');

    expect(compactSchema).not.toContain('enum WorkflowType');
    expect(compactSchema).not.toContain('model Workflow {');
    expect(tenantModel).not.toContain('workflows Workflow[]');

    expect(conversationModel).toContain('Compatibility survivor');
    expect(conversationModel).not.toContain('backendId');
    expect(conversationModel).not.toContain('backend AiBackend?');

    expect(messageModel).toContain('Compatibility survivor');
    expect(aiBackendModel).toContain('Compatibility survivor');
    expect(aiBackendModel).not.toContain('conversations Conversation[]');
    expect(endUserBackendModel).toContain('Compatibility survivor');
  });
});

describe('stranded model retirement migration guard', () => {
  it('keeps a resettable legacy baseline and a safe retirement subset migration', () => {
    expect(existsSync(baselineMigrationPath)).toBe(true);
    expect(existsSync(retirementMigrationPath)).toBe(true);

    const baselineMigration = readFileSync(baselineMigrationPath, 'utf8').replace(/\s+/g, ' ');
    const retirementMigration = readFileSync(retirementMigrationPath, 'utf8').replace(/\s+/g, ' ');

    expect(baselineMigration).toContain('CREATE TABLE "workflows"');
    expect(baselineMigration).toContain('CREATE TABLE "conversations"');
    expect(retirementMigration).toContain('DROP TABLE "workflows"');
    expect(retirementMigration).toContain('ALTER TABLE "conversations" DROP COLUMN "backend_id"');
    expect(retirementMigration).toContain('DROP TYPE "WorkflowType"');
  });
});
