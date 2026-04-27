import { describe, expect, it } from 'vitest';
import { normalizeWechatEcloudWebhook, timingSafeEqualString } from './wechat-ecloud-webhook.js';

const textPayload = {
  wcId: 'wxid_bot',
  messageType: '60001',
  data: {
    self: false,
    fromUser: 'wxid_user',
    toUser: 'wxid_bot',
    content: '  hello  ',
    msgId: 123,
    newMsgId: '456',
    timestamp: 1710000000,
  },
};

describe('normalizeWechatEcloudWebhook', () => {
  it('normalizes text callbacks into route decisions', () => {
    expect(
      normalizeWechatEcloudWebhook(
        {
          ...textPayload,
          data: {
            ...textPayload.data,
            nickName: 'Alice',
          },
        },
        'app_1',
      ),
    ).toEqual({
      kind: 'route',
      externalId: 'wxid_user',
      displayName: 'Alice',
      text: 'hello',
      receiptKey: '456',
      meta: {
        platform: 'wechat_ecloud',
        appId: 'app_1',
        messageType: '60001',
        msgId: 123,
        newMsgId: '456',
        toUser: 'wxid_bot',
        fromUser: 'wxid_user',
        timestamp: 1710000000,
      },
    });
  });

  it('falls back to external id when text callbacks omit nicknames', () => {
    expect(normalizeWechatEcloudWebhook(textPayload, 'app_1')).toEqual(
      expect.objectContaining({
        kind: 'route',
        externalId: 'wxid_user',
        displayName: 'wxid_user',
      }),
    );
  });

  it('omits newMsgId from meta when only msgId is present', () => {
    const { newMsgId, ...data } = textPayload.data;
    const decision = normalizeWechatEcloudWebhook(
      {
        ...textPayload,
        data,
      },
      'app_1',
    );

    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.receiptKey).toBe('123');
      expect(decision.meta).toEqual(
        expect.objectContaining({
          msgId: 123,
        }),
      );
      expect(decision.meta).not.toHaveProperty('newMsgId');
    }
    expect(newMsgId).toBe('456');
  });

  it('omits msgId from meta when only newMsgId is present', () => {
    const { msgId, ...data } = textPayload.data;
    const decision = normalizeWechatEcloudWebhook(
      {
        ...textPayload,
        data,
      },
      'app_1',
    );

    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.receiptKey).toBe('456');
      expect(decision.meta).toEqual(
        expect.objectContaining({
          newMsgId: '456',
        }),
      );
      expect(decision.meta).not.toHaveProperty('msgId');
    }
    expect(msgId).toBe(123);
  });

  it('extracts visible reference title/content and bounded XML fields', () => {
    const decision = normalizeWechatEcloudWebhook(
      {
        ...textPayload,
        messageType: '60014',
        data: {
          ...textPayload.data,
          title: 'Quoted Alice',
          content: 'Visible quoted message',
          refermsg: {
            content:
              '<msg><appmsg><title>ignored</title></appmsg><displayname>Alice</displayname><content>Original &amp; quoted</content></msg>',
          },
        },
      },
      'app_1',
    );

    expect(decision).toEqual({
      kind: 'route',
      externalId: 'wxid_user',
      displayName: 'Quoted Alice',
      text: 'Visible quoted message',
      receiptKey: '456',
      meta: {
        platform: 'wechat_ecloud',
        appId: 'app_1',
        messageType: '60014',
        msgId: 123,
        newMsgId: '456',
        toUser: 'wxid_bot',
        fromUser: 'wxid_user',
        timestamp: 1710000000,
        reference: {
          displayname: 'Alice',
          content: 'Original & quoted',
        },
      },
    });
  });

  it('routes malformed reference XML with parse error metadata', () => {
    const decision = normalizeWechatEcloudWebhook(
      {
        ...textPayload,
        messageType: '60014',
        data: {
          ...textPayload.data,
          title: 'Quoted Alice',
          content: 'Visible quoted message',
          refermsg: {
            content: '<msg><displayname>Alice</displayname><content>unterminated',
          },
        },
      },
      'app_1',
    );

    expect(decision).toEqual(
      expect.objectContaining({
        kind: 'route',
        displayName: 'Quoted Alice',
        text: 'Visible quoted message',
        meta: expect.objectContaining({
          referenceParseError: true,
        }),
      }),
    );
  });

  it('ignores callbacks where self is not false', () => {
    expect(
      normalizeWechatEcloudWebhook(
        {
          ...textPayload,
          data: {
            ...textPayload.data,
            self: true,
          },
        },
        'app_1',
      ),
    ).toEqual({ kind: 'ignore', reason: 'self_message', receiptKey: '456' });
  });

  it('ignores chatroom callbacks', () => {
    expect(
      normalizeWechatEcloudWebhook(
        {
          ...textPayload,
          data: {
            ...textPayload.data,
            fromUser: '123@chatroom',
          },
        },
        'app_1',
      ),
    ).toEqual({ kind: 'ignore', reason: 'group_message', receiptKey: '456' });

    expect(
      normalizeWechatEcloudWebhook(
        {
          ...textPayload,
          data: {
            ...textPayload.data,
            toUser: '123@chatroom',
          },
        },
        'app_1',
      ),
    ).toEqual({ kind: 'ignore', reason: 'group_message', receiptKey: '456' });
  });

  it('ignores voice and image callbacks as unsupported media', () => {
    expect(
      normalizeWechatEcloudWebhook({ ...textPayload, messageType: '60004' }, 'app_1'),
    ).toEqual({ kind: 'ignore', reason: 'unsupported_media', receiptKey: '456' });
    expect(
      normalizeWechatEcloudWebhook({ ...textPayload, messageType: '60002' }, 'app_1'),
    ).toEqual({ kind: 'ignore', reason: 'unsupported_media', receiptKey: '456' });
  });

  it('ignores callbacks without msgId or newMsgId', () => {
    const { msgId, newMsgId, ...data } = textPayload.data;
    expect(
      normalizeWechatEcloudWebhook(
        {
          ...textPayload,
          data,
        },
        'app_1',
      ),
    ).toEqual({ kind: 'ignore', reason: 'missing_receipt_key' });
    expect(msgId).toBe(123);
    expect(newMsgId).toBe('456');
  });
});

describe('timingSafeEqualString', () => {
  it('returns false for empty or different strings', () => {
    expect(timingSafeEqualString('', '')).toBe(false);
    expect(timingSafeEqualString('token', '')).toBe(false);
    expect(timingSafeEqualString('token', 'different')).toBe(false);
    expect(timingSafeEqualString('token', 'tokem')).toBe(false);
    expect(timingSafeEqualString('token', 'token')).toBe(true);
  });
});
