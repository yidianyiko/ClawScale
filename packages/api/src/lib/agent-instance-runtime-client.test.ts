import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRuntimeAgentInstance,
  resetRuntimeAgentInstance,
  updateRuntimeAgentInstance,
} from './agent-instance-runtime-client.js';

describe('agent instance runtime client', () => {
  beforeEach(() => {
    vi.stubEnv('COKE_BRIDGE_INBOUND_URL', 'http://127.0.0.1:8090/bridge/inbound');
    vi.stubEnv('COKE_BRIDGE_API_KEY', 'bridge-secret');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('gets the active customer agent instance through bridge auth', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { agent_instance: {}, effective_profile: {} } }), {
        status: 200,
      }),
    );

    const result = await getRuntimeAgentInstance({ customerId: 'ck_123' });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/agent-instances?customer_id=ck_123',
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer bridge-secret',
        },
      },
    );
    expect(result.ok).toBe(true);
  });

  it('patches allowed fields and injects trusted customer id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { agent_instance: {}, effective_profile: {} } }), {
        status: 200,
      }),
    );

    await updateRuntimeAgentInstance({
      customerId: 'ck_123',
      patch: { display_name: '沈妄', proactive: { enabled: false } },
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/agent-instances',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          customer_id: 'ck_123',
          display_name: '沈妄',
          proactive: { enabled: false },
        }),
      }),
    );
  });

  it('does not let patch payload override the trusted customer id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { agent_instance: {}, effective_profile: {} } }), {
        status: 200,
      }),
    );

    await updateRuntimeAgentInstance({
      customerId: 'ck_123',
      patch: { customer_id: 'ck_attacker', display_name: '沈妄' },
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/agent-instances',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          customer_id: 'ck_123',
          display_name: '沈妄',
        }),
      }),
    );
  });

  it('normalizes bridge transport and invalid response errors', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'));
    await expect(getRuntimeAgentInstance({ customerId: 'ck_123' })).resolves.toEqual({
      ok: false,
      error: 'agent_instance_bridge_transport_failed',
    });

    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(getRuntimeAgentInstance({ customerId: 'ck_123' })).resolves.toEqual({
      ok: false,
      error: 'agent_instance_bridge_invalid_response',
    });
  });

  it('resets the active instance through the reset endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { agent_instance: {}, effective_profile: {} } }), {
        status: 200,
      }),
    );

    await resetRuntimeAgentInstance({ customerId: 'ck_123' });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/agent-instances/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customer_id: 'ck_123' }),
      }),
    );
  });
});
