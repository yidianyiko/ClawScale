import { describe, expect, it } from 'vitest';
import LegacyRedirectPage from '../../../../components/legacy-redirect-page';
import VerifyEmailPage from './page';

describe('VerifyEmailPage', () => {
  it('maps /coke/verify-email to the neutral verify-email redirect wrapper', () => {
    const page = VerifyEmailPage();

    expect(page.type).toBe(LegacyRedirectPage);
    expect(page.props.pathname).toBe('/auth/verify-email');
  });
});
