export type AiBackendType = 'llm' | 'openclaw' | 'palmos' | 'claude-code' | 'custom' | 'cli-bridge';

export type Transport = 'http' | 'sse' | 'websocket' | 'pty-websocket';

export type ResponseFormat = 'json-auto' | 'langgraph' | 'raw-text';

export interface AiBackendProviderConfig {
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  baseUrl?: string;
  commandAlias?: string;
  authHeader?: string;
  transport?: Transport;
  responseFormat?: ResponseFormat;
  bridgeToken?: string;
}

interface BackendFieldDef {
  key: keyof AiBackendProviderConfig;
  label: string;
  inputType?: 'text' | 'password' | 'textarea' | 'checkbox' | 'select';
  selectOptions?: { label: string; value: string }[];
  required?: boolean;
  hint?: string;
  fixed?: boolean;
  defaultValue?: string | boolean;
}

export interface BackendTypeDescriptor {
  type: AiBackendType;
  label: string;
  transport: Transport;
  responseFormat: ResponseFormat;
  endpointPattern?: string;
  fixedConfig?: Partial<AiBackendProviderConfig>;
  fields: BackendFieldDef[];
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
        key: 'transport',
        label: 'Transport',
        inputType: 'select',
        required: true,
        selectOptions: [
          { label: 'HTTP', value: 'http' },
          { label: 'SSE', value: 'sse' },
          { label: 'WebSocket', value: 'websocket' },
        ],
      },
      {
        key: 'responseFormat',
        label: 'Response Format',
        inputType: 'select',
        required: true,
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
  'cli-bridge': {
    type: 'cli-bridge',
    label: 'CLI Bridge',
    transport: 'pty-websocket',
    responseFormat: 'raw-text',
    fields: [
      { key: 'bridgeToken', label: 'Bridge Token', fixed: true, hint: 'Auto-generated. Use this token when connecting the CLI bridge.' },
    ],
  },
};
