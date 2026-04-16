import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Rule = {
  path: string;
  required?: string[];
  forbidden?: string[];
};

type RuleResult = {
  path: string;
  requiredFound: string[];
  requiredMissing: string[];
  forbiddenFound: string[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../../../');

const rules: Rule[] = [
  {
    path: 'connector/clawscale_bridge/customer_ids.py',
    required: ['def resolve_customer_id('],
  },
  {
    path: 'connector/clawscale_bridge/gateway_identity_client.py',
    required: ['"customer_id": normalized_customer_id'],
    forbidden: ['"coke_account_id": coke_account_id'],
  },
  {
    path: 'connector/clawscale_bridge/gateway_personal_channel_client.py',
    required: ['json={"customer_id": normalized_customer_id}', 'params={"customer_id": normalized_customer_id}'],
    forbidden: ['json={"account_id": account_id}', 'params={"account_id": account_id}'],
  },
  {
    path: 'connector/clawscale_bridge/gateway_outbound_client.py',
    required: ['"customer_id": normalized_customer_id'],
    forbidden: ['"account_id": account_id'],
  },
  {
    path: 'connector/clawscale_bridge/personal_wechat_channel_service.py',
    required: ['customer_id=normalized_customer_id'],
  },
  {
    path: 'connector/clawscale_bridge/output_dispatcher.py',
    required: ['{"customer_id": {"$exists": True}}', '"customer_id": customer_id'],
    forbidden: ['"account_id": message["account_id"]'],
  },
  {
    path: 'connector/clawscale_bridge/message_gateway.py',
    required: ['"customer": customer', '"coke_account": customer'],
  },
  {
    path: 'connector/clawscale_bridge/app.py',
    required: [
      'inbound_payload.get("customer_id")',
      'enqueue_payload["customer_id"] = inbound["coke_account_id"]',
    ],
  },
  {
    path: 'agent/runner/identity.py',
    required: ['customer = metadata.get("customer")', 'normalized.startswith(("acct_", "ck_"))'],
  },
  {
    path: 'gateway/packages/api/src/routes/coke-bindings.ts',
    required: ['customer_id: z.string().min(1).optional()', 'const customerId = resolveCustomerId(parsed.data);'],
  },
  {
    path: 'gateway/packages/api/src/routes/user-wechat-channel.ts',
    required: ["c.req.query('customer_id')", 'payload.customer_id ?? payload.account_id'],
  },
  {
    path: 'gateway/packages/api/src/routes/outbound.ts',
    required: [
      'account_id: z.string().min(1).optional()',
      'customer_id: z.string().min(1).optional()',
      'customer_id: body.customer_id',
      'cokeAccountId: body.customer_id',
    ],
    forbidden: ['account_id: body.account_id'],
  },
];

function evaluateRule(rule: Rule): RuleResult {
  const absolutePath = path.join(repoRoot, rule.path);
  const content = readFileSync(absolutePath, 'utf8');

  const requiredFound = (rule.required ?? []).filter((snippet) => content.includes(snippet));
  const requiredMissing = (rule.required ?? []).filter((snippet) => !content.includes(snippet));
  const forbiddenFound = (rule.forbidden ?? []).filter((snippet) => content.includes(snippet));

  return {
    path: rule.path,
    requiredFound,
    requiredMissing,
    forbiddenFound,
  };
}

const results = rules.map(evaluateRule);
const failures = results.filter((result) => result.requiredMissing.length > 0 || result.forbiddenFound.length > 0);

const report = {
  checkedFiles: results.length,
  failures: failures.length,
  results,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
