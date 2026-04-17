import { describe, expect, it } from 'vitest';
import LegacyRedirectPage from '../../../../components/legacy-redirect-page';
import CokeLoginPage from './page';

describe('CokeLoginPage', () => {
  it('maps /coke/login to the neutral login redirect wrapper', () => {
    const page = CokeLoginPage();

    expect(page.type).toBe(LegacyRedirectPage);
    expect(page.props.pathname).toBe('/auth/login');
  });
});
