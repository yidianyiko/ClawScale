import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('gateway API topology', () => {
  it('does not mount retired workspace member and generic channel routes', () => {
    expect(indexSource).not.toContain("app.route('/auth'");
    expect(indexSource).not.toContain("app.route('/api/users'");
    expect(indexSource).not.toContain("app.route('/api/tenant'");
    expect(indexSource).not.toContain("app.route('/api/end-users'");
    expect(indexSource).not.toContain("app.route('/api/onboard'");
    expect(indexSource).not.toContain("app.route('/api/channels'");
    expect(indexSource).not.toContain("app.route('/api/internal/user/wechat-channel'");
    expect(indexSource).not.toContain("app.route('/api/admin/channels'");
    expect(indexSource).not.toContain("app.route('/api/admin/agents'");
  });

  it('does not initialize retired generic channel adapters', () => {
    expect(indexSource).not.toContain('initDiscordAdapters');
    expect(indexSource).not.toContain('initWeChatAdapters');
    expect(indexSource).not.toContain('initWhatsAppAdapters');
    expect(indexSource).not.toContain('initTelegramAdapters');
    expect(indexSource).not.toContain('initSlackAdapters');
    expect(indexSource).not.toContain('initMatrixAdapters');
    expect(indexSource).not.toContain('initLineAdapters');
    expect(indexSource).not.toContain('initSignalAdapters');
    expect(indexSource).not.toContain('initTeamsAdapters');
    expect(indexSource).not.toContain('initWABusinessAdapters');
  });

  it('keeps active customer, admin, shared-channel, and bridge routes mounted', () => {
    expect(indexSource).toContain("app.route('/api/auth', customerAuthRouter)");
    expect(indexSource).toContain("app.route('/api/customer/channels/wechat-personal', customerChannelRouter)");
    expect(indexSource).toContain("app.route('/api/admin', adminAuthRouter)");
    expect(indexSource).toContain("app.route('/api/admin/customers', adminCustomersRouter)");
    expect(indexSource).toContain("app.route('/api/admin/shared-channels', adminSharedChannelsRouter)");
    expect(indexSource).toContain("app.route('/api/admin/deliveries', adminDeliveriesRouter)");
    expect(indexSource).toContain("app.route('/api/outbound', outboundRouter)");
    expect(indexSource).toContain("app.route('/gateway', gatewayRouter)");
  });
});
