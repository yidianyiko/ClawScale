import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => {
  const stub = () => ({ variable: '' });
  return { Fraunces: stub, Inter: stub, JetBrains_Mono: stub };
});

import { metadata } from './layout';

describe('root metadata', () => {
  it('brands the public site title as kap', () => {
    expect(metadata.title).toBe('kap | An AI Partner That Grows With You');
  });

  it('brands the public site description as kap ai', () => {
    expect(metadata.description).toBe(
      'Kap AI public homepage, user sign-in, registration, and personal channel setup.',
    );
  });
});
