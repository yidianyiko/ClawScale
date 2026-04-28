import { describe, expect, it } from 'vitest';
import {
  normalizeInboundAttachments,
  MAX_INBOUND_ATTACHMENTS,
} from './inbound-attachments.js';

describe('normalizeInboundAttachments', () => {
  it('normalizes http attachments with defaults and safe display URLs', () => {
    const result = normalizeInboundAttachments([
      { url: ' https://cdn.example.com/photo.jpg ', filename: ' ', contentType: ' ' },
    ]);

    expect(result).toEqual({
      attachments: [
        {
          url: 'https://cdn.example.com/photo.jpg',
          filename: 'attachment',
          contentType: 'application/octet-stream',
          safeDisplayUrl: 'https://cdn.example.com/photo.jpg',
        },
      ],
      rejected: false,
    });
  });

  it('canonicalizes http URLs after whitespace and control normalization', () => {
    const result = normalizeInboundAttachments([
      { url: '\n https://CDN.Example.com/photo\t.jpg\r\n' },
    ]);

    expect(result).toEqual({
      attachments: [
        {
          url: 'https://cdn.example.com/photo.jpg',
          filename: 'attachment',
          contentType: 'application/octet-stream',
          safeDisplayUrl: 'https://cdn.example.com/photo.jpg',
        },
      ],
      rejected: false,
    });
  });

  it('redacts credentials, query, and fragment from http safe display URLs', () => {
    const result = normalizeInboundAttachments([
      { url: 'https://user:pass@cdn.example.com/photo.jpg?token=secret#private' },
    ]);

    expect(result).toEqual({
      attachments: [
        {
          url: 'https://user:pass@cdn.example.com/photo.jpg?token=secret#private',
          filename: 'attachment',
          contentType: 'application/octet-stream',
          safeDisplayUrl: 'https://cdn.example.com/photo.jpg',
        },
      ],
      rejected: false,
    });
  });

  it('rejects data URLs unless explicitly trusted', () => {
    const dataUrl = 'data:image/png;base64,' + Buffer.from('png').toString('base64');

    expect(normalizeInboundAttachments([{ url: dataUrl }])).toEqual({
      attachments: [],
      rejected: false,
    });
    expect(normalizeInboundAttachments([{ url: dataUrl }], { allowDataUrls: true })).toEqual({
      attachments: [
        {
          url: dataUrl,
          filename: 'attachment',
          contentType: 'image/png',
          safeDisplayUrl: '[inline image/png attachment: attachment]',
          size: 3,
        },
      ],
      rejected: false,
    });
  });

  it('sanitizes trusted data URL safe display text', () => {
    const dataUrl = 'data:image/png;base64,' + Buffer.from('png').toString('base64');
    const result = normalizeInboundAttachments(
      [{ url: dataUrl, filename: 'photo\ndata:image/png;base64,secret\tname.png' }],
      { allowDataUrls: true },
    );

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.safeDisplayUrl).toBe(
      '[inline image/png attachment: attachment]',
    );
    expect(result.attachments[0]?.safeDisplayUrl).not.toContain('\n');
    expect(result.attachments[0]?.safeDisplayUrl).not.toContain('\t');
    expect(result.attachments[0]?.safeDisplayUrl).not.toContain('data:');
    expect(result.attachments[0]?.safeDisplayUrl).not.toContain(dataUrl);
  });

  it('drops trusted data URLs with malformed base64 payloads', () => {
    expect(
      normalizeInboundAttachments([{ url: 'data:image/png;base64,cG5' }], { allowDataUrls: true }),
    ).toEqual({
      attachments: [],
      rejected: false,
    });
  });

  it('drops unsupported schemes and malformed entries', () => {
    const result = normalizeInboundAttachments([
      { url: 'file:///tmp/a.png' },
      { url: '/tmp/a.png' },
      { url: '' },
      null,
    ]);

    expect(result).toEqual({ attachments: [], rejected: false });
  });

  it('hard rejects over-count attachment sets', () => {
    const attachments = Array.from({ length: MAX_INBOUND_ATTACHMENTS + 1 }, (_, index) => ({
      url: `https://cdn.example.com/${index}.jpg`,
    }));

    expect(normalizeInboundAttachments(attachments)).toEqual({
      attachments: [],
      rejected: true,
      reason: 'attachment_limit_exceeded',
    });
  });

  it('hard rejects oversized trusted data URLs', () => {
    const oversized =
      'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');

    expect(normalizeInboundAttachments([{ url: oversized }], { allowDataUrls: true })).toEqual({
      attachments: [],
      rejected: true,
      reason: 'attachment_payload_too_large',
    });
  });

  it('hard rejects unsupported json payload values without throwing', () => {
    expect(normalizeInboundAttachments([{ url: 'https://cdn.example.com/photo.jpg', id: 1n }]))
      .toEqual({
        attachments: [],
        rejected: true,
        reason: 'attachment_payload_too_large',
      });
  });

  it('hard rejects circular json payload values without throwing', () => {
    const attachment: Record<string, unknown> = { url: 'https://cdn.example.com/photo.jpg' };
    attachment['self'] = attachment;

    expect(normalizeInboundAttachments([attachment])).toEqual({
      attachments: [],
      rejected: true,
      reason: 'attachment_payload_too_large',
    });
  });
});
