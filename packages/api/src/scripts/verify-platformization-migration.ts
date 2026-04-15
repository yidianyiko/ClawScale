import { verifyPlatformizationMigration } from '../lib/platformization-backfill.js';

function parseMongoAccountIds() {
  return (process.env.MONGO_ACCOUNT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const mongoAccountIds = parseMongoAccountIds();
  const summary = await verifyPlatformizationMigration({
    cokeAccountIds: mongoAccountIds,
  });

  console.log(
    JSON.stringify(
      {
        mongoAccountIds,
        ...summary,
      },
      null,
      2,
    ),
  );

  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

await main();
