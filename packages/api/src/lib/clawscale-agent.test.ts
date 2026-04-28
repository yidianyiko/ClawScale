import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentInvoke = vi.hoisted(() => vi.fn());
const createAgent = vi.hoisted(() => vi.fn());
const initChatModel = vi.hoisted(() => vi.fn());
const tool = vi.hoisted(() => vi.fn((handler, config) => ({ handler, config })));

vi.mock('langchain', () => ({
  createAgent,
  initChatModel,
  tool,
}));

import { runClawscaleAgent } from './clawscale-agent.js';

describe('runClawscaleAgent multimodal attachment conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initChatModel.mockResolvedValue({ model: 'mock-model' });
    createAgent.mockReturnValue({
      invoke: agentInvoke,
    });
    agentInvoke.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'ok' }],
    });
  });

  it('sends http image attachments as image_url parts', async () => {
    await runClawscaleAgent({
      text: 'caption',
      backends: [],
      activeIds: [],
      personaName: 'ClawScale',
      mode: 'select',
      llmConfig: { model: 'openai:gpt-test', apiKey: 'key', multimodal: true },
      attachments: [
        {
          url: 'https://cdn.example.com/photo.jpg',
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          safeDisplayUrl: 'https://cdn.example.com/photo.jpg',
        },
      ],
      executeCommand: vi.fn(),
    });

    const request = agentInvoke.mock.calls[0]?.[0];
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.com/photo.jpg' } },
        ],
      },
    ]);
  });

  it('redacts credentialed or query-bearing http image attachments into safe text', async () => {
    const secretUrl = 'https://user:pass@cdn.example.com/photo.jpg?token=secret#frag';

    await runClawscaleAgent({
      text: 'caption',
      backends: [],
      activeIds: [],
      personaName: 'ClawScale',
      mode: 'select',
      llmConfig: { model: 'openai:gpt-test', apiKey: 'key', multimodal: true },
      attachments: [
        {
          url: secretUrl,
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          safeDisplayUrl: 'https://cdn.example.com/photo.jpg',
        },
      ],
      executeCommand: vi.fn(),
    });

    const request = agentInvoke.mock.calls[0]?.[0];
    const parts = request.messages[0].content;
    expect(parts).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'text', text: '[Attached image: https://cdn.example.com/photo.jpg]' },
    ]);
    expect(JSON.stringify(parts)).not.toContain(secretUrl);
    expect(parts).not.toContainEqual(
      expect.objectContaining({
        type: 'image_url',
        image_url: expect.objectContaining({ url: secretUrl }),
      }),
    );
  });

  it('redacts data image attachments into text parts', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;

    await runClawscaleAgent({
      text: 'caption',
      backends: [],
      activeIds: [],
      personaName: 'ClawScale',
      mode: 'select',
      llmConfig: { model: 'openai:gpt-test', apiKey: 'key', multimodal: true },
      attachments: [
        {
          url: dataUrl,
          filename: 'photo.png',
          contentType: 'image/png',
          safeDisplayUrl: '[inline image/png attachment: photo.png]',
        },
      ],
      executeCommand: vi.fn(),
    });

    const request = agentInvoke.mock.calls[0]?.[0];
    const parts = request.messages[0].content;
    expect(parts).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'text', text: '[Attached image: [inline image/png attachment: photo.png]]' },
    ]);
    expect(JSON.stringify(parts)).not.toContain('data:image');
  });

  it('uses a redacted marker for unsafe data images without safeDisplayUrl', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('legacy').toString('base64')}`;

    await runClawscaleAgent({
      text: 'caption',
      backends: [],
      activeIds: [],
      personaName: 'ClawScale',
      mode: 'select',
      llmConfig: { model: 'openai:gpt-test', apiKey: 'key', multimodal: true },
      attachments: [
        {
          url: dataUrl,
          filename: 'legacy.png',
          contentType: 'image/png',
        },
      ],
      executeCommand: vi.fn(),
    });

    const request = agentInvoke.mock.calls[0]?.[0];
    const parts = request.messages[0].content;
    expect(parts).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'text', text: '[Attached image: [redacted inline image attachment]]' },
    ]);
    expect(JSON.stringify(parts)).not.toContain('data:image');
  });

  it('represents non-image attachments as safe display text only', async () => {
    await runClawscaleAgent({
      text: 'see attached',
      backends: [],
      activeIds: [],
      personaName: 'ClawScale',
      mode: 'select',
      llmConfig: { model: 'openai:gpt-test', apiKey: 'key', multimodal: true },
      attachments: [
        {
          url: 'https://cdn.example.com/file.pdf?token=secret',
          filename: 'file.pdf',
          contentType: 'application/pdf',
          safeDisplayUrl: 'https://cdn.example.com/file.pdf',
        },
      ],
      executeCommand: vi.fn(),
    });

    const request = agentInvoke.mock.calls[0]?.[0];
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see attached' },
          { type: 'text', text: '[Attached file: https://cdn.example.com/file.pdf]' },
        ],
      },
    ]);
  });
});
