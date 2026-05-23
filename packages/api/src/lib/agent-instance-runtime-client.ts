type AgentInstanceRuntimeRecord = Record<string, unknown>;

interface AgentInstanceRuntimeData {
  agent_instance: AgentInstanceRuntimeRecord;
  effective_profile: AgentInstanceRuntimeRecord;
}

export type AgentInstanceRuntimeResult =
  | { ok: true; data: AgentInstanceRuntimeData }
  | { ok: false; error: string };

export interface GetRuntimeAgentInstanceInput {
  customerId: string;
}

export interface UpdateRuntimeAgentInstanceInput {
  customerId: string;
  patch: Record<string, unknown>;
}

function readBridgeBaseUrl(): string {
  const raw =
    process.env['COKE_BRIDGE_INBOUND_URL']?.trim() || 'http://127.0.0.1:8090/bridge/inbound';
  return raw.replace(/\/bridge\/inbound\/?$/, '');
}

function readBridgeHeaders(): Record<string, string> {
  const apiKey = process.env['COKE_BRIDGE_API_KEY']?.trim();
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

async function readBridgeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      throw new Error('agent_instance_bridge_invalid_response');
    }

    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null) {
      throw new Error('agent_instance_bridge_invalid_response');
    }

    return json as Record<string, unknown>;
  } catch {
    throw new Error('agent_instance_bridge_invalid_response');
  }
}

async function requestBridgeJson(
  path: string,
  init: RequestInit,
): Promise<{ ok: true; response: Response; json: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${readBridgeBaseUrl()}${path}`, {
      ...init,
      headers: readBridgeHeaders(),
    });
  } catch {
    return { ok: false, error: 'agent_instance_bridge_transport_failed' };
  }

  try {
    return { ok: true, response, json: await readBridgeJson(response) };
  } catch {
    return { ok: false, error: 'agent_instance_bridge_invalid_response' };
  }
}

function bridgeFailureError(
  bridge: { error: string } | { response: Response; json: Record<string, unknown> },
): string {
  if ('error' in bridge) {
    return bridge.error;
  }
  if (!bridge.response.ok || bridge.json.ok !== true) {
    return readString(bridge.json.error) ?? 'agent_instance_request_failed';
  }
  return 'agent_instance_request_failed';
}

function readBridgeData(json: Record<string, unknown>): AgentInstanceRuntimeData {
  return (json.data ?? { agent_instance: {}, effective_profile: {} }) as AgentInstanceRuntimeData;
}

function readRuntimeResult(
  bridge: { ok: true; response: Response; json: Record<string, unknown> } | { ok: false; error: string },
): AgentInstanceRuntimeResult {
  if (!bridge.ok) {
    return { ok: false, error: bridgeFailureError(bridge) };
  }
  if (!bridge.response.ok || bridge.json.ok !== true) {
    return { ok: false, error: bridgeFailureError(bridge) };
  }
  return { ok: true, data: readBridgeData(bridge.json) };
}

export async function getRuntimeAgentInstance(
  input: GetRuntimeAgentInstanceInput,
): Promise<AgentInstanceRuntimeResult> {
  const query = new URLSearchParams({ customer_id: input.customerId });
  const bridge = await requestBridgeJson(`/bridge/internal/agent-instances?${query.toString()}`, {
    method: 'GET',
  });
  return readRuntimeResult(bridge);
}

export async function updateRuntimeAgentInstance(
  input: UpdateRuntimeAgentInstanceInput,
): Promise<AgentInstanceRuntimeResult> {
  const patch = { ...input.patch };
  delete patch['customer_id'];

  const bridge = await requestBridgeJson('/bridge/internal/agent-instances', {
    method: 'PATCH',
    body: JSON.stringify({ customer_id: input.customerId, ...patch }),
  });
  return readRuntimeResult(bridge);
}

export async function resetRuntimeAgentInstance(
  input: GetRuntimeAgentInstanceInput,
): Promise<AgentInstanceRuntimeResult> {
  const bridge = await requestBridgeJson('/bridge/internal/agent-instances/reset', {
    method: 'POST',
    body: JSON.stringify({ customer_id: input.customerId }),
  });
  return readRuntimeResult(bridge);
}
