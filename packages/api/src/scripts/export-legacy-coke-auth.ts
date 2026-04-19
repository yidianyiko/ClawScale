import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';

import { db, type DB } from '../db/index.js';

type JsonRow = Record<string, unknown>;

type LegacyExportPayload = {
  exportedAt: string;
  cokeAccounts: JsonRow[];
  verifyTokens: JsonRow[];
};

export interface ExportLegacyCokeAuthOptions {
  outputPath?: string;
  now?: Date;
}

export interface ExportLegacyCokeAuthSummary {
  exportedAt: string;
  outputPath: string;
  cokeAccounts: number;
  verifyTokens: number;
}

function buildDefaultOutputPath(now: Date): string {
  const stamp = now.toISOString().replaceAll(':', '-');
  return path.join(
    tmpdir(),
    'coke-auth-retirement',
    stamp,
    'legacy-coke-auth-export.json',
  );
}

function parseOutputPath(argv: string[], env: NodeJS.ProcessEnv): string | undefined {
  const flagIndex = argv.indexOf('--output');
  if (flagIndex >= 0) {
    return argv[flagIndex + 1]?.trim() || undefined;
  }

  return env.LEGACY_COKE_AUTH_EXPORT_PATH?.trim() || undefined;
}

async function readTableRows(
  client: Pick<DB, '$queryRaw'>,
  tableName: 'coke_accounts' | 'verify_tokens',
): Promise<JsonRow[]> {
  const query =
    tableName === 'coke_accounts'
      ? Prisma.sql`SELECT to_jsonb(ca) AS row FROM "coke_accounts" AS ca ORDER BY ca."id"`
      : Prisma.sql`SELECT to_jsonb(vt) AS row FROM "verify_tokens" AS vt ORDER BY vt."id"`;

  const rows = await client.$queryRaw<Array<{ row: JsonRow }>>(query);
  return rows.map((entry) => entry.row);
}

export async function exportLegacyCokeAuth(
  client: Pick<DB, '$queryRaw'> = db,
  options: ExportLegacyCokeAuthOptions = {},
): Promise<ExportLegacyCokeAuthSummary> {
  const now = options.now ?? new Date();
  const exportedAt = now.toISOString();
  const outputPath = options.outputPath ?? buildDefaultOutputPath(now);
  const [cokeAccounts, verifyTokens] = await Promise.all([
    readTableRows(client, 'coke_accounts'),
    readTableRows(client, 'verify_tokens'),
  ]);

  const payload: LegacyExportPayload = {
    exportedAt,
    cokeAccounts,
    verifyTokens,
  };

  mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  return {
    exportedAt,
    outputPath,
    cokeAccounts: cokeAccounts.length,
    verifyTokens: verifyTokens.length,
  };
}

async function main() {
  try {
    const summary = await exportLegacyCokeAuth(db, {
      outputPath: parseOutputPath(process.argv, process.env),
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await db.$disconnect();
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  await main();
}
