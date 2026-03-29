/**
 * WhatsApp Adapter (via @whiskeysockets/baileys)
 *
 * Manages one Baileys socket per connected WhatsApp channel.
 * Connection is established by scanning a QR code.
 *
 * Flow:
 *   1. Owner requests QR → startWhatsAppQR() → returns base64 PNG
 *   2. Owner scans QR with phone → socket connects → status = connected
 *   3. Incoming message → normalize → POST /gateway/:channelId → reply
 */

import path from 'path';
import fs from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import pino from 'pino';
import { db } from '../db/index.js';

const logger = pino({ level: 'silent' });

// Cache the WA version so we only fetch it once per process
let waVersion: [number, number, number] | null = null;
async function getWAVersion(): Promise<[number, number, number]> {
  if (!waVersion) {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
    console.log(`[whatsapp] Using WA version ${version.join('.')}`);
  }
  return waVersion;
}

const GATEWAY_URL = `http://127.0.0.1:${process.env['PORT'] ?? 3001}`;
const AUTH_BASE = process.env['WHATSAPP_AUTH_DIR'] ?? path.join(process.cwd(), 'data', 'whatsapp');

// ── State per channel ─────────────────────────────────────────────────────────

interface ChannelState {
  socket: WASocket | null;
  qr: string | null;          // base64 PNG, set while waiting for scan
  qrUrl: string | null;       // raw string encoded in the QR
  status: 'qr_pending' | 'connected' | 'disconnected';
}

const channels = new Map<string, ChannelState>();

function getAuthDir(channelId: string): string {
  const dir = path.join(AUTH_BASE, channelId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Start / connect a WhatsApp session ───────────────────────────────────────

export async function startWhatsAppBot(channelId: string, isReconnect = false): Promise<void> {
  const existing = channels.get(channelId);
  if (!isReconnect && existing?.status === 'connected') return;
  // Clear stale state so the new socket takes over cleanly
  channels.delete(channelId);

  const authDir = getAuthDir(channelId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version = await getWAVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
  });

  channels.set(channelId, { socket: sock, qr: null, qrUrl: null, status: 'qr_pending' });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const png = await qrcode.toDataURL(qr);
      const ch = channels.get(channelId);
      if (ch) { ch.qr = png; ch.qrUrl = qr; }
      console.log(`[whatsapp:${channelId}] QR code ready`);
    }

    if (connection === 'open') {
      const ch = channels.get(channelId);
      if (ch) { ch.status = 'connected'; ch.qr = null; }
      await db.channel.update({ where: { id: channelId }, data: { status: 'connected' } });
      console.log(`[whatsapp:${channelId}] Connected`);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[whatsapp:${channelId}] Disconnected, reason: ${reason}, reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Re-create socket after a short delay
        setTimeout(() => startWhatsAppBot(channelId, true), 3000);
      } else {
        // Logged out — clear credentials
        fs.rmSync(getAuthDir(channelId), { recursive: true, force: true });
        channels.delete(channelId);
        await db.channel.update({ where: { id: channelId }, data: { status: 'disconnected' } });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[whatsapp:${channelId}] messages.upsert type=${type} count=${messages.length}`);
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe && msg.key.remoteJid === 'status@broadcast') continue;
      if (!msg.message) continue;

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        '';

      console.log(`[whatsapp:${channelId}] Incoming from ${msg.key.remoteJid} (fromMe=${msg.key.fromMe}): "${text}"`);
      if (!text.trim()) continue;

      const externalId = msg.key.remoteJid ?? 'unknown';
      const displayName = msg.pushName ?? undefined;

      try {
        const res = await fetch(`${GATEWAY_URL}/gateway/${channelId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            externalId,
            displayName,
            text: text.trim(),
            meta: { platform: 'whatsapp', messageId: msg.key.id },
          }),
        });

        const data = (await res.json()) as { ok: boolean; data?: { reply: string } };

        if (data.ok && data.data?.reply && sock) {
          await sock.sendMessage(externalId, { text: data.data.reply });
        }
      } catch (err) {
        console.error(`[whatsapp:${channelId}] Error routing message:`, err);
      }
    }
  });
}

// ── Get current QR code (base64 PNG + raw URL) ───────────────────────────────

export function getWhatsAppQR(channelId: string): { image: string; url: string } | null {
  const ch = channels.get(channelId);
  if (!ch?.qr) return null;
  return { image: ch.qr, url: ch.qrUrl ?? '' };
}

// ── Get current status ────────────────────────────────────────────────────────

export function getWhatsAppStatus(channelId: string): ChannelState['status'] | null {
  return channels.get(channelId)?.status ?? null;
}

// ── Stop / disconnect ─────────────────────────────────────────────────────────

export async function stopWhatsAppBot(channelId: string): Promise<void> {
  const ch = channels.get(channelId);
  if (!ch) return;
  try { await ch.socket?.logout(); } catch { /* ignore */ }
  fs.rmSync(getAuthDir(channelId), { recursive: true, force: true });
  channels.delete(channelId);
  console.log(`[whatsapp:${channelId}] Stopped and logged out`);
}

// ── Boot all connected WhatsApp channels on startup ───────────────────────────

export async function initWhatsAppAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'whatsapp', status: 'connected' },
    select: { id: true },
  });

  for (const row of rows) {
    try {
      await startWhatsAppBot(row.id);
    } catch (err) {
      console.error(`[whatsapp:${row.id}] Failed to start:`, err);
    }
  }

  console.log(`[whatsapp] Initialized ${rows.length} WhatsApp bot(s)`);
}
