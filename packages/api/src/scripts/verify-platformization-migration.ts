import { verifyPlatformizationMigration } from '../lib/platformization-backfill.js';

async function main() {
  const summary = await verifyPlatformizationMigration();

  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

await main();
