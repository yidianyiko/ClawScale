export type AiBackendType = 'llm' | 'openclaw' | 'palmos'  | 'claude-code' | 'custom' | 'local-bridge';

/** Transport method — how ClawScale connects to the backend. */
export type Transport = 'http' | 'sse' | 'websocket' | 'pty-websocket';

/** Response format — how ClawScale parses the backend's response. */
export type ResponseFormat = 'json-auto' | 'langgraph' | 'raw-text';

export interface AiBackendProviderConfig {
  /** API key */
  apiKey?: string;
  /** Model identifier (LLM / OpenClaw) */
  model?: string;
  /** System prompt (LLM only) */
  systemPrompt?: string;
  /** Base URL — backend endpoint */
  baseUrl?: string;
  /** Short alias for direct messages (e.g. "gpt" so users can type gpt> hello) */
  commandAlias?: string;
  /** Optional Authorization header value sent to the backend */
  authHeader?: string;
  /** Transport override (used by 'custom' type) */
  transport?: Transport;
  /** Response format override (used by 'custom' type) */
  responseFormat?: ResponseFormat;
  /** Auto-generated token for local-bridge authentication */
  bridgeToken?: string;
}

// ── Backend type descriptors ─────────────────────────────────────────────────

export interface BackendFieldDef {
  /** Config key this field maps to */
  key: keyof AiBackendProviderConfig;
  /** Display label */
  label: string;
  /** Input type for the form */
  inputType?: 'text' | 'password' | 'textarea' | 'checkbox' | 'select';
  /** Options for select input type */
  selectOptions?: { label: string; value: string }[];
  /** Whether this field is required */
  required?: boolean;
  /** Help text shown below the field */
  hint?: string;
  /** If true, field is read-only (set by descriptor) */
  fixed?: boolean;
  /** Default value */
  defaultValue?: string | boolean;
}

export interface BackendTypeDescriptor {
  type: AiBackendType;
  /** Display label */
  label: string;
  /** Default transport for this type */
  transport: Transport;
  /** Default response format for this type */
  responseFormat: ResponseFormat;
  /** Endpoint URL pattern — e.g. "{baseUrl}/api/agent/manager/stream" */
  endpointPattern?: string;
  /** Config values forced by this type (not user-editable) */
  fixedConfig?: Partial<AiBackendProviderConfig>;
  /** Form fields shown for this type */
  fields: BackendFieldDef[];
  /** Pre-request hooks (e.g. Palmos user registration) */
  hooks?: ('palmos-register')[];
}

export const BACKEND_TYPE_DESCRIPTORS: Record<AiBackendType, BackendTypeDescriptor> = {
  llm: {
    type: 'llm',
    label: 'LLM',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'apiKey', label: 'API Key', inputType: 'password', required: true },
      { key: 'model', label: 'Model', hint: 'e.g. gpt-4o-mini' },
      { key: 'baseUrl', label: 'Base URL', hint: 'Leave blank for OpenAI, or set for compatible providers' },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
    ],
  },
  openclaw: {
    type: 'openclaw',
    label: 'OpenClaw',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'baseUrl', label: 'Base URL', required: true, hint: '/v1 is appended automatically' },
      { key: 'apiKey', label: 'API Key', inputType: 'password' },
      { key: 'model', label: 'Model' },
    ],
  },
  palmos: {
    type: 'palmos',
    label: 'Palmos',
    transport: 'sse',
    responseFormat: 'langgraph',
    endpointPattern: '{baseUrl}/api/agent/manager/stream',
    hooks: ['palmos-register'],
    fields: [
      { key: 'apiKey', label: 'API Key', inputType: 'password', required: true, hint: 'Sent as Bearer token' },
    ],
  },
  'claude-code': {
    type: 'claude-code',
    label: 'Claude Code',
    transport: 'http',
    responseFormat: 'json-auto',
    endpointPattern: '{baseUrl}/message',
    fields: [
      { key: 'baseUrl', label: 'Channel Server URL', required: true },
      { key: 'apiKey', label: 'API Key', inputType: 'password' },
      { key: 'authHeader', label: 'Authorization Header', inputType: 'password', hint: 'Overrides API Key if set' },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
    ],
  },
  custom: {
    type: 'custom',
    label: 'Custom Backend',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'baseUrl', label: 'Endpoint URL', required: true },
      {
        key: 'transport', label: 'Transport', inputType: 'select', required: true,
        selectOptions: [
          { label: 'HTTP', value: 'http' },
          { label: 'SSE', value: 'sse' },
          { label: 'WebSocket', value: 'websocket' },
        ],
      },
      {
        key: 'responseFormat', label: 'Response Format', inputType: 'select', required: true,
        selectOptions: [
          { label: 'JSON (auto-detect)', value: 'json-auto' },
          { label: 'LangGraph SSE', value: 'langgraph' },
          { label: 'Raw Text', value: 'raw-text' },
        ],
      },
      { key: 'apiKey', label: 'API Key', inputType: 'password' },
      { key: 'authHeader', label: 'Authorization Header', inputType: 'password' },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
    ],
  },
  'local-bridge': {
    type: 'local-bridge',
    label: 'Local Bridge',
    transport: 'pty-websocket',
    responseFormat: 'raw-text',
    fields: [
      { key: 'bridgeToken', label: 'Bridge Token', fixed: true, hint: 'Auto-generated. Use this token when connecting the local bridge.' },
    ],
  },
};

export interface AiBackend {
  id: string;
  tenantId: string;
  name: string;
  type: AiBackendType;
  config: AiBackendProviderConfig;
  isActive: boolean;
  /** True for the built-in ClawScale default agent (one per tenant). */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const AI_PROVIDER_LABELS: Record<AiBackendType, string> = Object.fromEntries(
  Object.values(BACKEND_TYPE_DESCRIPTORS).map((d) => [d.type, d.label]),
) as Record<AiBackendType, string>;

export const AI_PROVIDER_TYPES: AiBackendType[] = Object.keys(BACKEND_TYPE_DESCRIPTORS) as AiBackendType[];
