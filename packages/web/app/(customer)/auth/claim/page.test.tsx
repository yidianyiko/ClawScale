import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

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

  it('renders a stable placeholder for future claim flows', () => {
    flushSync(() => {
      root.render(<ClaimPage />);
    });

    expect(container.textContent).toContain('Claim access is coming soon');
    expect(container.textContent).toContain('Use the sign-in or registration flow for now.');
  });
});
