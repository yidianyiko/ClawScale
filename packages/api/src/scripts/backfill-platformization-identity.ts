import {
  auditLegacyBaseline,
  backfillLegacyCustomers,
  ensureDefaultAgent,
} from '../lib/platformization-backfill.js';

function hasDryRunFlag() {
  return process.argv.includes('--dry-run');
}

function parseMongoAccountIds() {
  return (process.env.MONGO_ACCOUNT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const dryRun = hasDryRunFlag();
  let agentId = 'dry-run';
  const mongoAccountIds = parseMongoAccountIds();

  if (!dryRun) {
    const auditSummary = await auditLegacyBaseline({ mongoAccountIds });
    if (auditSummary.errors.length > 0) {
      console.log(
        JSON.stringify(
          {
            dryRun,
            blocked: true,
            reason: 'platformization_audit_blocked',
            mongoAccountIds,
            ...auditSummary,
          },
          null,
          2,
        ),
      );
      throw new Error('platformization_audit_blocked');
    }
  }

  if (!dryRun) {
    const endpoint = requireEnv('COKE_AGENT_ENDPOINT');
    const authToken = requireEnv('COKE_AGENT_AUTH_TOKEN');
    agentId = await ensureDefaultAgent({ endpoint, authToken });
  }

  const summary = await backfillLegacyCustomers({
    agentId,
    dryRun,
    cokeAccountIds: mongoAccountIds,
  });

  console.log(
    JSON.stringify(
      {
        agentId,
        dryRun,
        mongoAccountIds,
        ...summary,
      },
      null,
      2,
    ),
  );
}

await main();
