import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');

describe('platformization schema guard', () => {
  it('includes the dormant identity graph and shared-channel ownership fields', () => {
    const schema = readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('enum IdentityClaimStatus');
    expect(schema).toContain('model Identity');
    expect(schema).toContain('model Customer');
    expect(schema).toContain('model Membership');
    expect(schema).toContain('model Agent');
    expect(schema).toContain('model AgentBinding');
    expect(schema).toContain('model AdminAccount');
    expect(schema).toContain('mfaSecret');
    expect(schema).toContain('model ExternalIdentity');
    expect(schema).toContain('enum ChannelOwnershipKind');
    expect(schema).toContain('ownershipKind');
    expect(schema).toContain('customerId');
    expect(schema).toContain('agentId');
  });
});
