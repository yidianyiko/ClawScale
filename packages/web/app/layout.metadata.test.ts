import { describe, expect, it } from 'vitest';

import { metadata } from './layout';

describe('root metadata', () => {
  it('brands the public site title as coke', () => {
    expect(metadata.title).toBe('coke | An AI Partner That Grows With You');
  });
});
