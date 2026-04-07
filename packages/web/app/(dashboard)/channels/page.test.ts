import { describe, expect, it } from 'vitest';
import { isAdminAddChannelTypeAllowed } from './channel-options';

describe('channel add options', () => {
  it('keeps shared wechat personal channels out of the admin create menu', () => {
    expect(isAdminAddChannelTypeAllowed('wechat_personal')).toBe(false);
    expect(isAdminAddChannelTypeAllowed('whatsapp')).toBe(true);
  });
});
