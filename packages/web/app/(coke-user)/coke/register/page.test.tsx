import { describe, expect, it } from 'vitest';
import LegacyRedirectPage from '../../../../components/legacy-redirect-page';
import CokeRegisterPage from './page';

describe('CokeRegisterPage', () => {
  it('maps /coke/register to the neutral register redirect wrapper', () => {
    const page = CokeRegisterPage();

    expect(page.type).toBe(LegacyRedirectPage);
    expect(page.props.pathname).toBe('/auth/register');
  });
});
