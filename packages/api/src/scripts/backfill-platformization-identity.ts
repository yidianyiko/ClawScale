import {
  backfillLegacyCustomers,
  ensureDefaultAgent,
} from '../lib/platformization-backfill.js';

function hasDryRunFlag() {
  return process.argv.includes('--dry-run');
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const endpoint = requireEnv('COKE_AGENT_ENDPOINT');
  const authToken = requireEnv('COKE_AGENT_AUTH_TOKEN');
  const dryRun = hasDryRunFlag();
  const agentId = await ensureDefaultAgent({ endpoint, authToken });
  const summary = await backfillLegacyCustomers({ agentId, dryRun });

  console.log(
    JSON.stringify(
      {
        agentId,
        dryRun,
        ...summary,
      },
      null,
      2,
    ),
  );
}

await main();
