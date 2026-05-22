import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
  getRuntimeAgentInstance: vi.fn(),
  updateRuntimeAgentInstance: vi.fn(),
  resetRuntimeAgentInstance: vi.fn(),
}));

vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../lib/customer-auth.js', () => ({
  verifyCustomerToken: mocks.verifyCustomerToken,
  getCustomerSession: mocks.getCustomerSession,
}));
vi.mock('../lib/agent-instance-runtime-client.js', () => ({
  getRuntimeAgentInstance: mocks.getRuntimeAgentInstance,
  updateRuntimeAgentInstance: mocks.updateRuntimeAgentInstance,
  resetRuntimeAgentInstance: mocks.resetRuntimeAgentInstance,
}));

import { customerAgentInstanceRouter } from './customer-agent-instance-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/customer/agent-instance', customerAgentInstanceRouter);
  return app;
}

describe('customer agent instance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCustomerToken.mockReturnValue({
      sub: 'ck_123',
      identityId: 'idt_123',
      tokenType: 'access',
    });
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    mocks.getRuntimeAgentInstance.mockResolvedValue({
      ok: true,
      data: { agent_instance: { owner_user_id: 'ck_123' }, effective_profile: { display_name: 'Coke' } },
    });
    mocks.updateRuntimeAgentInstance.mockResolvedValue({
      ok: true,
      data: { agent_instance: { owner_user_id: 'ck_123' }, effective_profile: { display_name: '沈妄' } },
    });
    mocks.resetRuntimeAgentInstance.mockResolvedValue({
      ok: true,
      data: { agent_instance: { display_name: null }, effective_profile: { display_name: 'Coke' } },
    });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await createApp().request('/api/customer/agent-instance');

    expect(res.status).toBe(401);
    expect(mocks.verifyCustomerToken).not.toHaveBeenCalled();
    expect(mocks.getRuntimeAgentInstance).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('gets the authenticated customer instance and ignores query customer ids', async () => {
    const res = await createApp().request('/api/customer/agent-instance?customerId=ck_attacker', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(mocks.getRuntimeAgentInstance).toHaveBeenCalledWith({ customerId: 'ck_123' });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        agent_instance: { owner_user_id: 'ck_123' },
        effective_profile: { display_name: 'Coke' },
      },
    });
  });

  it('rejects inactive claims before calling bridge', async () => {
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'pending',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });

    const res = await createApp().request('/api/customer/agent-instance', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(403);
    expect(mocks.getRuntimeAgentInstance).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'claim_inactive' });
  });

  it('patches only allowed fields for the authenticated customer', async () => {
    const res = await createApp().request('/api/customer/agent-instance', {
      method: 'PATCH',
      headers: { authorization: 'Bearer customer-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: 'ck_attacker',
        display_name: '沈妄',
        persona: 'custom',
      }),
    });

    expect(res.status).toBe(400);
    expect(mocks.updateRuntimeAgentInstance).not.toHaveBeenCalled();
  });

  it('accepts valid patch body and passes session customer id', async () => {
    const res = await createApp().request('/api/customer/agent-instance', {
      method: 'PATCH',
      headers: { authorization: 'Bearer customer-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        display_name: '沈妄',
        nickname: '阿妄',
        user_address_name: '姐姐',
        persona: 'custom',
        background: 'history',
        speaking_style: 'quiet',
        extra_rules: 'short replies',
        status: { place: '书桌', action: '陪伴中' },
        proactive: { enabled: false },
        memory: { enabled: true },
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.updateRuntimeAgentInstance).toHaveBeenCalledWith({
      customerId: 'ck_123',
      patch: {
        display_name: '沈妄',
        nickname: '阿妄',
        user_address_name: '姐姐',
        persona: 'custom',
        background: 'history',
        speaking_style: 'quiet',
        extra_rules: 'short replies',
        status: { place: '书桌', action: '陪伴中' },
        proactive: { enabled: false },
        memory: { enabled: true },
      },
    });
  });

  it('resets the authenticated customer instance', async () => {
    const res = await createApp().request('/api/customer/agent-instance/reset', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(mocks.resetRuntimeAgentInstance).toHaveBeenCalledWith({ customerId: 'ck_123' });
  });
});
