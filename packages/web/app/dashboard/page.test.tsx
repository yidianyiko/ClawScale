import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const legacyRootPage = resolve(process.cwd(), 'app' + '/dash' + 'board/page.tsx');

describe('dashboard root legacy redirect stub', () => {
  it('routes the legacy dashboard root through LegacyRedirectPage', () => {
    const source = readFileSync(legacyRootPage, 'utf8');

    expect(source).toContain('LegacyRedirectPage');
    expect(source).toContain("pathname='/admin/customers'");
  });
});
