import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COKE_AGENT_ID,
  buildDefaultAgentSeed,
  buildLegacyAgentBindingSeed,
  buildLegacyCustomerGraph,
  deriveCustomerIdFromLegacyAccount,
  deriveDeterministicPlatformId,
  summarizeLegacyBaseline,
} from './platformization-migration.js';

describe('deriveCustomerIdFromLegacyAccount', () => {
  it('reuses the legacy CokeAccount id byte-for-byte', () => {
    expect(deriveCustomerIdFromLegacyAccount('ck_legacy_123')).toBe('ck_legacy_123');
  });
});

describe('deriveDeterministicPlatformId', () => {
  it('returns a stable UUID-like id for the same scope and legacy account id', () => {
    const first = deriveDeterministicPlatformId('identity', 'ck_legacy_123');
    const second = deriveDeterministicPlatformId('identity', 'ck_legacy_123');
    const differentScope = deriveDeterministicPlatformId('membership', 'ck_legacy_123');
    const differentLegacyAccountId = deriveDeterministicPlatformId('identity', 'ck_legacy_456');

    expect(first).toBe(second);
    expect(first).not.toBe(differentScope);
    expect(first).not.toBe(differentLegacyAccountId);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('buildLegacyCustomerGraph', () => {
  it('preserves customer id, lowercases email, marks the claim active, and derives deterministic relation ids', () => {
    const graph = buildLegacyCustomerGraph({
      cokeAccountId: 'ck_legacy_123',
      email: 'Alice@Example.COM',
      displayName: 'Alice',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
    });

    expect(graph.customer).toMatchObject({
      id: 'ck_legacy_123',
      displayName: 'Alice',
    });
    expect(graph.identity).toMatchObject({
      id: deriveDeterministicPlatformId('identity', 'ck_legacy_123'),
      email: 'alice@example.com',
      claimStatus: 'active',
    });
    expect(graph.membership).toMatchObject({
      id: deriveDeterministicPlatformId('membership', 'ck_legacy_123'),
      customerId: 'ck_legacy_123',
    });
    expect(graph.identity.id).not.toBe(graph.membership.id);
  });
});

describe('buildLegacyAgentBindingSeed', () => {
  it('creates a ready binding with zero attempts and null last error', () => {
    expect(
      buildLegacyAgentBindingSeed({
        customerId: 'ck_legacy_123',
        agentId: '33333333-3333-3333-3333-333333333333',
      }),
    ).toMatchObject({
      customerId: 'ck_legacy_123',
      agentId: '33333333-3333-3333-3333-333333333333',
      provisionStatus: 'ready',
      provisionAttempts: 0,
      provisionLastError: null,
    });
  });
});

describe('buildDefaultAgentSeed', () => {
  it('creates the default Coke agent row with slug coke and isDefault true', () => {
    expect(
      buildDefaultAgentSeed({
        id: '44444444-4444-4444-4444-444444444444',
        endpoint: 'https://coke.example.com/agent',
        authToken: 'secret-token',
      }),
    ).toMatchObject({
      id: '44444444-4444-4444-4444-444444444444',
      slug: 'coke',
      isDefault: true,
      endpoint: 'https://coke.example.com/agent',
      authToken: 'secret-token',
    });
  });

  it('uses the deterministic default Coke agent id when no id is provided', () => {
    expect(
      buildDefaultAgentSeed({
        endpoint: 'https://coke.example.com/agent',
        authToken: 'secret-token',
      }),
    ).toMatchObject({
      id: DEFAULT_COKE_AGENT_ID,
      slug: 'coke',
      isDefault: true,
      endpoint: 'https://coke.example.com/agent',
      authToken: 'secret-token',
    });
  });
});

describe('summarizeLegacyBaseline', () => {
  it('reports missing ClawscaleUser rows and orphan Mongo account ids', () => {
    const summary = summarizeLegacyBaseline({
      cokeAccounts: [
        { cokeAccountId: 'ck_1', email: 'one@example.com' },
        { cokeAccountId: 'ck_2', email: 'two@example.com' },
      ],
      clawscaleUsers: [{ cokeAccountId: 'ck_1', tenantId: 'tnt_1' }],
      mongoAccountIds: ['ck_1', 'ck_orphan'],
    });

    expect(summary.errors).toEqual([
      'missing_clawscale_user:ck_2',
      'orphan_mongo_account_id:ck_orphan',
    ]);
    expect(summary.counts).toEqual({
      cokeAccounts: 2,
      clawscaleUsers: 1,
      mongoAccountIds: 2,
    });
  });
});
