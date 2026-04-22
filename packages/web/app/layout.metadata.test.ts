import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => {
  const stub = () => ({ variable: '' });
  return { Fraunces: stub, Inter: stub, JetBrains_Mono: stub };
});

import { metadata } from './layout';

describe('root metadata', () => {
  it('brands the public site title as coke', () => {
    expect(metadata.title).toBe('coke | An AI Partner That Grows With You');
  });
});
