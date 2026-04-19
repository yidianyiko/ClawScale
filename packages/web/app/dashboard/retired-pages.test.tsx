import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const expectedRedirects = [
  ['login/page.tsx', '/admin/login'],
  ['register/page.tsx', '/admin/login'],
  ['onboard/page.tsx', '/admin/channels'],
  ['channels/page.tsx', '/admin/channels'],
  ['conversations/page.tsx', '/admin/customers'],
  ['ai-backends/page.tsx', '/admin/agents'],
  ['workflows/page.tsx', '/admin/customers'],
  ['end-users/page.tsx', '/admin/customers'],
  ['users/page.tsx', '/admin/admins'],
  ['settings/page.tsx', '/admin/agents'],
] as const;

const dashboardDir = resolve(process.cwd(), 'app' + '/dash' + 'board');

describe('retired dashboard route stubs', () => {
  it('keeps each legacy dashboard entry point as a thin redirect wrapper', () => {
    for (const [relativePath, destination] of expectedRedirects) {
      const source = readFileSync(resolve(dashboardDir, relativePath), 'utf8');

      expect(source).toContain('LegacyRedirectPage');
      expect(source).toContain(`pathname='${destination}'`);
    }
  });
});
