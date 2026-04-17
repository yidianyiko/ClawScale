import { describe, expect, it } from 'vitest';
import LegacyRedirectPage from '../../../../components/legacy-redirect-page';
import LegacyBindWechatPage from './page';

describe('LegacyBindWechatPage', () => {
  it('maps /coke/bind-wechat to the neutral personal-channel redirect wrapper', () => {
    const page = LegacyBindWechatPage();

    expect(page.type).toBe(LegacyRedirectPage);
    expect(page.props.pathname).toBe('/channels/wechat-personal');
  });
});
