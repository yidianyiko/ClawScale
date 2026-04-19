import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard legacy layout cleanup', () => {
  it('removes the obsolete dashboard layout shell', () => {
    expect(existsSync(new URL('./layout.tsx', import.meta.url))).toBe(false);
  });
});
