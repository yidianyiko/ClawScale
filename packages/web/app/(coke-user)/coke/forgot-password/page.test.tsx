import { describe, expect, it } from 'vitest';
import LegacyRedirectPage from '../../../../components/legacy-redirect-page';
import ForgotPasswordPage from './page';

describe('ForgotPasswordPage', () => {
  it('maps /coke/forgot-password to the neutral forgot-password redirect wrapper', () => {
    const page = ForgotPasswordPage();

    expect(page.type).toBe(LegacyRedirectPage);
    expect(page.props.pathname).toBe('/auth/forgot-password');
  });
});
