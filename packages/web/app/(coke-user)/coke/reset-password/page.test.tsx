import { describe, expect, it } from 'vitest';
import LegacyRedirectPage from '../../../../components/legacy-redirect-page';
import ResetPasswordPage from './page';

describe('ResetPasswordPage', () => {
  it('maps /coke/reset-password to the neutral reset-password redirect wrapper', () => {
    const page = ResetPasswordPage();

    expect(page.type).toBe(LegacyRedirectPage);
    expect(page.props.pathname).toBe('/auth/reset-password');
  });
});
