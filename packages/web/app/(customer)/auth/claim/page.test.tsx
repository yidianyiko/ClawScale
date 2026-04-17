import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { LocaleProvider } from '../../../../components/locale-provider';
import ClaimPage from './page';

describe('ClaimPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState({}, '', '/auth/claim');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders the English placeholder from the locale catalog', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <ClaimPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('Reserved route');
    expect(container.textContent).toContain('Claim access is coming soon');
    expect(container.textContent).toContain('Use the sign-in or registration flow for now.');
  });

  it('renders the Chinese placeholder from the locale catalog', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <ClaimPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('预留路由');
    expect(container.textContent).toContain('认领入口即将开放');
    expect(container.textContent).toContain('目前请先使用登录或注册流程。');
    expect(container.textContent).not.toContain('Claim access is coming soon');
  });
});
