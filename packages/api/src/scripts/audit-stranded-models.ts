import { auditStrandedModels } from '../lib/stranded-model-audit.js';

async function main() {
  const summary = await auditStrandedModels();

  console.log(JSON.stringify(summary, null, 2));
}

await main();
