import { auditLegacyBaseline } from '../lib/platformization-backfill.js';

function parseMongoAccountIds() {
  return (process.env.MONGO_ACCOUNT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const summary = await auditLegacyBaseline({
    mongoAccountIds: parseMongoAccountIds(),
  });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

await main();
