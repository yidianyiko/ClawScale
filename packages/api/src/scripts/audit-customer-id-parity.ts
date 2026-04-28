import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, type DB } from '../db/index.js';

type AuditExample = {
  collection: string;
  fieldPath: string;
  documentId: string;
  accountId: string;
};

type CustomerIdParityReport = {
  collectionsChecked: string[];
  driftCount: number;
  examples: AuditExample[];
};

type TouchpointCheck = {
  collection: string;
  description: string;
  matches: (files: Map<string, string>) => boolean;
};

const PYTHON_TIMEOUT_MS = Number(process.env.CUSTOMER_ID_AUDIT_TIMEOUT_MS ?? 120_000);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../../../');

const REQUIRED_AGENT_FILES = [
  'agent/util/message_util.py',
  'agent/runner/identity.py',
] as const;

const DIRECTORY_SCANS = [
  'connector/clawscale_bridge',
  'dao',
] as const;

const TOUCHPOINT_CHECKS: TouchpointCheck[] = [
  {
    collection: 'outputmessages',
    description: 'message util still writes Coke business outputs to outputmessages',
    matches: (files) => (files.get('agent/util/message_util.py') ?? '').includes('outputmessages'),
  },
  {
    collection: 'outputmessages',
    description: 'bridge runtime still reads outputmessages for account-owned delivery',
    matches: (files) =>
      [...files.entries()].some(
        ([relativePath, content]) =>
          relativePath.startsWith('connector/clawscale_bridge/')
          && content.includes('outputmessages')
          && content.includes('account_id'),
      ),
  },
  {
    collection: 'reminders',
    description: 'DAO layer still stores Coke-owned reminder rows',
    matches: (files) =>
      [...files.entries()].some(
        ([relativePath, content]) =>
          relativePath.startsWith('dao/')
          && content.includes('reminders')
          && content.includes('user_id'),
      ),
  },
  {
    collection: 'conversations',
    description: 'DAO layer still stores Coke-owned conversation talkers',
    matches: (files) =>
      [...files.entries()].some(
        ([relativePath, content]) =>
          relativePath.startsWith('dao/')
          && content.includes('conversations')
          && content.includes('talkers'),
      ),
  },
  {
    collection: 'conversations',
    description: 'identity resolution still recognizes synthetic Coke account ids',
    matches: (files) =>
      (files.get('agent/runner/identity.py') ?? '').includes('is_synthetic_coke_account_id'),
  },
];

function listScannedFiles(): string[] {
  const files: string[] = [...REQUIRED_AGENT_FILES];

  for (const relativeDir of DIRECTORY_SCANS) {
    const absoluteDir = path.join(repoRoot, relativeDir);
    for (const entry of readdirSync(absoluteDir)) {
      if (!entry.endsWith('.py')) {
        continue;
      }
      files.push(path.posix.join(relativeDir, entry));
    }
  }

  return files;
}

export function scanKnownTouchpoints(): string[] {
  const fileContents = new Map(
    listScannedFiles().map((relativePath) => [
      relativePath,
      readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    ]),
  );

  const collectionsChecked: string[] = [];
  const seenCollections = new Set<string>();

  for (const check of TOUCHPOINT_CHECKS) {
    if (!check.matches(fileContents)) {
      throw new Error(`Missing expected touchpoint evidence: ${check.description}`);
    }
    if (seenCollections.has(check.collection)) {
      continue;
    }
    seenCollections.add(check.collection);
    collectionsChecked.push(check.collection);
  }

  return collectionsChecked;
}

function buildPythonAuditProgram(): string {
  return [
    'import json',
    'import sys',
    'from dao.user_dao import audit_customer_id_parity',
    'customer_ids = json.loads(sys.stdin.read())',
    'print(json.dumps(audit_customer_id_parity(customer_ids=customer_ids)))',
  ].join('\n');
}

export async function auditCustomerIdParity(
  client: Pick<DB, 'customer'> = db,
): Promise<CustomerIdParityReport> {
  const collectionsChecked = scanKnownTouchpoints();
  const customers = await client.customer.findMany({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const customerIds = customers.map(({ id }) => id);

  const stdout = execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-c', buildPythonAuditProgram()],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: PYTHON_TIMEOUT_MS,
      input: JSON.stringify(customerIds),
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: [repoRoot, process.env.PYTHONPATH]
          .filter((value): value is string => Boolean(value))
          .join(path.delimiter),
      },
    },
  );

  const report = JSON.parse(stdout.trim()) as CustomerIdParityReport;
  return {
    collectionsChecked,
    driftCount: report.driftCount,
    examples: report.examples,
  };
}

async function main() {
  try {
    const report = await auditCustomerIdParity();
    console.log(JSON.stringify(report, null, 2));
    if (report.driftCount > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
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
