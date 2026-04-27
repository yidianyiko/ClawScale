import { timingSafeEqual } from 'node:crypto';

const MAX_REFERENCE_XML_BYTES = 64 * 1024;
const ROUTABLE_MESSAGE_TYPES = new Set(['60001', '60014']);
const UNSUPPORTED_MEDIA_MESSAGE_TYPES = new Set(['60002', '60004']);

export type WechatEcloudWebhookDecision =
  | {
      kind: 'route';
      externalId: string;
      displayName?: string;
      text: string;
      meta: Record<string, unknown>;
      receiptKey: string;
    }
  | { kind: 'ignore'; reason: string; receiptKey?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readReceiptKey(data: Record<string, unknown>): string | undefined {
  const newMsgId = data['newMsgId'];
  if (typeof newMsgId === 'string' && newMsgId.trim()) {
    return newMsgId.trim();
  }
  if (typeof newMsgId === 'number' && Number.isFinite(newMsgId)) {
    return String(newMsgId);
  }

  const msgId = data['msgId'];
  if (typeof msgId === 'string' && msgId.trim()) {
    return msgId.trim();
  }
  if (typeof msgId === 'number' && Number.isFinite(msgId)) {
    return String(msgId);
  }

  return undefined;
}

function buildBaseMeta(
  data: Record<string, unknown>,
  appId: string,
  messageType: string,
  fromUser: string,
  toUser: string,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    platform: 'wechat_ecloud',
    appId,
    messageType,
    msgId: data['msgId'],
    newMsgId: data['newMsgId'],
    toUser,
    fromUser,
  };

  if (data['timestamp'] != null) {
    meta['timestamp'] = data['timestamp'];
  }

  return meta;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlField(xml: string, field: 'displayname' | 'content'): string | undefined {
  const match = new RegExp(`<${field}\\b[^>]*>([\\s\\S]{0,4096})<\\/${field}>`, 'i').exec(xml);
  return readTrimmedString(match?.[1] ? decodeXmlText(match[1]) : undefined);
}

function hasUnclosedKnownField(xml: string, field: 'displayname' | 'content'): boolean {
  return new RegExp(`<${field}\\b`, 'i').test(xml) && !new RegExp(`<\\/${field}>`, 'i').test(xml);
}

function parseReferenceXml(value: unknown):
  | { reference?: Record<string, string>; parseError?: false }
  | { reference?: undefined; parseError: true } {
  const xml = readTrimmedString(value);
  if (!xml) {
    return {};
  }

  if (
    Buffer.byteLength(xml, 'utf8') > MAX_REFERENCE_XML_BYTES ||
    /<!DOCTYPE/i.test(xml) ||
    /<!ENTITY/i.test(xml) ||
    hasUnclosedKnownField(xml, 'displayname') ||
    hasUnclosedKnownField(xml, 'content')
  ) {
    return { parseError: true };
  }

  const displayname = extractXmlField(xml, 'displayname');
  const content = extractXmlField(xml, 'content');
  if (!displayname && !content) {
    return { parseError: true };
  }

  const reference: Record<string, string> = {};
  if (displayname) {
    reference['displayname'] = displayname;
  }
  if (content) {
    reference['content'] = content;
  }

  return { reference, parseError: false };
}

function readReferenceXml(data: Record<string, unknown>): unknown {
  const refermsg = data['refermsg'];
  if (isRecord(refermsg)) {
    return refermsg['content'];
  }

  return data['referMsg'] ?? data['quote'] ?? data['refermsg'];
}

function ignore(reason: string, receiptKey?: string): WechatEcloudWebhookDecision {
  return receiptKey ? { kind: 'ignore', reason, receiptKey } : { kind: 'ignore', reason };
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const leftLength = Buffer.byteLength(a);
  if (leftLength === 0 || leftLength !== Buffer.byteLength(b)) {
    return false;
  }

  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return timingSafeEqual(left, right);
}

export function normalizeWechatEcloudWebhook(
  payload: unknown,
  appId: string,
): WechatEcloudWebhookDecision {
  if (!isRecord(payload)) {
    return ignore('invalid_payload');
  }

  const messageType = readTrimmedString(payload['messageType']);
  const data = payload['data'];
  if (!messageType || !isRecord(data)) {
    return ignore('invalid_payload');
  }

  const receiptKey = readReceiptKey(data);
  if (!receiptKey) {
    return ignore('missing_receipt_key');
  }

  if (UNSUPPORTED_MEDIA_MESSAGE_TYPES.has(messageType)) {
    return ignore('unsupported_media', receiptKey);
  }

  if (!ROUTABLE_MESSAGE_TYPES.has(messageType)) {
    return ignore('unsupported_message_type', receiptKey);
  }

  if (data['self'] !== false) {
    return ignore('self_message', receiptKey);
  }

  const fromUser = readTrimmedString(data['fromUser']);
  const toUser = readTrimmedString(data['toUser']);
  if (!fromUser || !toUser) {
    return ignore('missing_private_id', receiptKey);
  }

  if (fromUser.includes('@chatroom') || toUser.includes('@chatroom')) {
    return ignore('group_message', receiptKey);
  }

  const meta = buildBaseMeta(data, appId, messageType, fromUser, toUser);

  if (messageType === '60001') {
    const text = readTrimmedString(data['content']);
    if (!text) {
      return ignore('missing_text', receiptKey);
    }

    return {
      kind: 'route',
      externalId: fromUser,
      text,
      meta,
      receiptKey,
    };
  }

  const title = readTrimmedString(data['title']);
  const content = readTrimmedString(data['content']);
  const visibleText = content ?? title;
  if (!visibleText) {
    return ignore('missing_text', receiptKey);
  }

  const reference = parseReferenceXml(readReferenceXml(data));
  if (reference.reference) {
    meta['reference'] = reference.reference;
  }
  if (reference.parseError) {
    meta['referenceParseError'] = true;
  }

  return {
    kind: 'route',
    externalId: fromUser,
    displayName: title,
    text: visibleText,
    meta,
    receiptKey,
  };
}
