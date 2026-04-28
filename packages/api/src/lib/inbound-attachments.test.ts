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
});
