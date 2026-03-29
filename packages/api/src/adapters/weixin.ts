/**
 * WeChat Personal Adapter
 *
 * Implements QR login + messaging against Tencent's iLink Bot API directly.
 *
 * Login flow:
 *   GET /ilink/bot/get_bot_qrcode  → qrcode + qrcode_img_content (SVG/PNG)
 *   Poll GET /ilink/bot/get_qrcode_status → wait | scaned | confirmed | expired
 *   On confirmed → bot_token, baseurl, ilink_bot_id saved to channel config
 *
 * Messaging:
 *   POST /ilink/bot/getupdates  (35s long-poll)
 *   POST /ilink/bot/sendmessage
 */

import qrcode from 'qrcode';
import { db } from '../db/index.js';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const GATEWAY_URL = `http://127.0.0.1:${process.env['PORT'] ?? 3001}`;

// ── State ─────────────────────────────────────────────────────────────────────

interface WeixinState {
  running: boolean;
  cursor: string;
  qr: string | null;         // base64 PNG for dashboard
  status: 'qr_pending' | 'connected' | 'disconnected';
}

const channels = new Map<string, WeixinState>();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function msgHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': `Bearer ${token}`,
    'X-WECHAT-UIN': Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString('base64'),
  };
}

// ── QR Login ──────────────────────────────────────────────────────────────────

export async function startWeixinQR(channelId: string): Promise<void> {
  const state: WeixinState = { running: true, cursor: '', qr: null, status: 'qr_pending' };
  channels.set(channelId, state);

  // Run login flow in background
  loginFlow(channelId).catch((err) =>
    console.error(`[weixin:${channelId}] Login flow error:`, err),
  );
}

async function loginFlow(channelId: string): Promise<void> {
  const state = channels.get(channelId);
  if (!state) return;

  let attempts = 0;

  while (state.running && attempts < 3) {
    // 1. Fetch QR code
    const qrRes = await fetch(`${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: AbortSignal.timeout(30_000),
    });

    const qrRaw = await qrRes.text();
    console.log(`[weixin:${channelId}] QR response (${qrRes.status}):`, qrRaw.slice(0, 500));
    const qrData = JSON.parse(qrRaw) as { qrcode?: string; qrcode_img_content?: string };
    const qrcodeId = qrData.qrcode;
    const imgContent = qrData.qrcode_img_content;

    if (!qrcodeId || !imgContent) {
      console.error(`[weixin:${channelId}] Failed to get QR code`);
      return;
    }

    // Convert QR content to PNG data URL for dashboard display
    state.qr = await qrcode.toDataURL(imgContent);
    console.log(`[weixin:${channelId}] QR code ready`);

    // 2. Poll for scan status (max 8 hours)
    const deadline = Date.now() + 8 * 60 * 60 * 1000;

    while (state.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));

      const statusRes = await fetch(
        `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`,
        { headers: { 'iLink-App-ClientVersion': '1' }, signal: AbortSignal.timeout(30_000) },
      );

      const statusData = (await statusRes.json()) as {
        status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
        bot_token?: string;
        ilink_bot_id?: string;
        baseurl?: string;
        ilink_user_id?: string;
      };

      if (statusData.status === 'confirmed' && statusData.bot_token) {
        const botBaseUrl = statusData.baseurl ?? DEFAULT_BASE_URL;
        const token = statusData.bot_token;

        // Save credentials to channel config
        await db.channel.update({
          where: { id: channelId },
          data: {
            status: 'connected',
            config: { baseUrl: botBaseUrl, token, botId: statusData.ilink_bot_id ?? '' },
          },
        });

        state.qr = null;
        state.status = 'connected';
        console.log(`[weixin:${channelId}] Logged in, starting poll loop`);
        pollLoop(channelId, botBaseUrl, token);
        return;
      }

      if (statusData.status === 'expired') {
        console.log(`[weixin:${channelId}] QR expired, refreshing (attempt ${attempts + 1})`);
        attempts++;
        break;
      }

      if (statusData.status === 'scaned') {
        console.log(`[weixin:${channelId}] QR scanned, waiting for confirmation…`);
      }
    }
  }

  if (state.running) {
    state.status = 'disconnected';
    await db.channel.update({ where: { id: channelId }, data: { status: 'disconnected' } });
    console.error(`[weixin:${channelId}] Login timed out`);
  }
}

// ── Message poll loop ─────────────────────────────────────────────────────────

async function pollLoop(channelId: string, baseUrl: string, token: string): Promise<void> {
  let state = channels.get(channelId);
  if (!state) {
    state = { running: true, cursor: '', qr: null, status: 'connected' };
    channels.set(channelId, state);
  }
  state.status = 'connected';

  while (state.running) {
    try {
      const res = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
        method: 'POST',
        headers: msgHeaders(token),
        body: JSON.stringify({ get_updates_buf: state.cursor }),
        signal: AbortSignal.timeout(40_000),
      });

      const data = (await res.json()) as {
        msgs?: Array<{
          from_user_id?: string;
          context_token?: string;
          item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
        }>;
        get_updates_buf?: string;
      };

      if (data.get_updates_buf) state.cursor = data.get_updates_buf;

      for (const msg of data.msgs ?? []) {
        const text = msg.item_list?.find((i) => i.type === 1)?.text_item?.text?.trim();
        if (!text || !msg.from_user_id) continue;

        console.log(`[weixin:${channelId}] Incoming from ${msg.from_user_id}: "${text}"`);

        try {
          const gwRes = await fetch(`${GATEWAY_URL}/gateway/${channelId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              externalId: msg.from_user_id,
              text,
              meta: { platform: 'wechat_personal', contextToken: msg.context_token },
            }),
          });

          const gwData = (await gwRes.json()) as { ok: boolean; data?: { reply: string } };

          if (gwData.ok && gwData.data?.reply && msg.context_token) {
            await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
              method: 'POST',
              headers: msgHeaders(token),
              body: JSON.stringify({
                msg: {
                  to_user_id: msg.from_user_id,
                  message_type: 2,
                  message_state: 2,
                  context_token: msg.context_token,
                  item_list: [{ type: 1, text_item: { text: gwData.data.reply } }],
                },
              }),
              signal: AbortSignal.timeout(15_000),
            });
          }
        } catch (err) {
          console.error(`[weixin:${channelId}] Error routing message:`, err);
        }
      }
    } catch (err) {
      if (!state.running) break;
      console.error(`[weixin:${channelId}] Poll error, retrying in 3s:`, err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getWeixinQR(channelId: string): string | null {
  return channels.get(channelId)?.qr ?? null;
}

export function getWeixinStatus(channelId: string): WeixinState['status'] | null {
  return channels.get(channelId)?.status ?? null;
}

export async function stopWeixinBot(channelId: string): Promise<void> {
  const state = channels.get(channelId);
  if (!state) return;
  state.running = false;
  channels.delete(channelId);
  console.log(`[weixin:${channelId}] Stopped`);
}

export async function startWeixinBot(channelId: string, baseUrl: string, token: string): Promise<void> {
  if (channels.has(channelId)) return;
  pollLoop(channelId, baseUrl, token).catch((err) =>
    console.error(`[weixin:${channelId}] Poll loop crashed:`, err),
  );
}

export async function initWeixinAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'wechat_personal', status: 'connected' },
    select: { id: true, config: true },
  });

  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const baseUrl = config?.['baseUrl'];
    const token = config?.['token'];
    if (!baseUrl || !token) continue;
    try {
      await startWeixinBot(row.id, baseUrl, token);
    } catch (err) {
      console.error(`[weixin:${row.id}] Failed to start:`, err);
    }
  }

  console.log(`[weixin] Initialized ${rows.length} WeChat Personal bot(s)`);
}
