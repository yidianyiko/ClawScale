/**
 * Matrix Adapter (via matrix-js-sdk)
 * Credentials: homeserver URL + access token
 */

import sdk from 'matrix-js-sdk';
import { db } from '../db/index.js';

const GATEWAY_URL = `http://127.0.0.1:${process.env['PORT'] ?? 3001}`;

const clients = new Map<string, ReturnType<typeof sdk.createClient>>();

export async function startMatrixBot(channelId: string, homeserverUrl: string, accessToken: string): Promise<void> {
  if (clients.has(channelId)) return;

  const client = sdk.createClient({ baseUrl: homeserverUrl, accessToken });

  client.on(sdk.RoomEvent.Timeline, async (event, room) => {
    if (event.getType() !== 'm.room.message') return;
    if (event.getSender() === client.getUserId()) return; // ignore own messages
    if (event.isEncrypted()) return; // skip encrypted for now

    const content = event.getContent();
    if (content.msgtype !== 'm.text') return;

    const text = (content.body as string)?.trim();
    if (!text) return;

    const externalId = event.getSender() ?? 'unknown';
    console.log(`[matrix:${channelId}] Incoming from ${externalId}: "${text}"`);

    try {
      const res = await fetch(`${GATEWAY_URL}/gateway/${channelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId, text, meta: { platform: 'matrix', roomId: room?.roomId } }),
      });
      const data = (await res.json()) as { ok: boolean; data?: { reply: string } };
      if (data.ok && data.data?.reply && room) {
        await client.sendTextMessage(room.roomId, data.data.reply);
      }
    } catch (err) {
      console.error(`[matrix:${channelId}] Error routing message:`, err);
    }
  });

  await client.startClient({ initialSyncLimit: 0 });
  clients.set(channelId, client);
  console.log(`[matrix:${channelId}] Client started (${homeserverUrl})`);
}

export async function stopMatrixBot(channelId: string): Promise<void> {
  const client = clients.get(channelId);
  if (!client) return;
  client.stopClient();
  clients.delete(channelId);
  console.log(`[matrix:${channelId}] Stopped`);
}

export async function initMatrixAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'matrix', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const homeserverUrl = config?.['homeserverUrl'];
    const accessToken = config?.['accessToken'];
    if (!homeserverUrl || !accessToken) continue;
    try { await startMatrixBot(row.id, homeserverUrl, accessToken); } catch (err) { console.error(`[matrix:${row.id}] Init error:`, err); }
  }
  console.log(`[matrix] Initialized ${rows.length} bot(s)`);
}
