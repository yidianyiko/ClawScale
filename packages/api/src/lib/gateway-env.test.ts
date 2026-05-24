import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGatewayEnv } from './gateway-env.js';

describe('gateway env bootstrap', () => {
  it('loads the repository root .env when the API runs from its package cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'coke-gateway-env-'));
    const apiCwd = join(root, 'gateway', 'packages', 'api');
    mkdirSync(apiCwd, { recursive: true });
    writeFileSync(
      join(root, '.env'),
      ['DOMAIN_CLIENT=http://localhost:4040', 'COKE_BRIDGE_API_KEY=bridge-key'].join('\n'),
    );
    const env: Record<string, string> = { DATABASE_URL: 'postgres://existing' };

    loadGatewayEnv({
      cwd: apiCwd,
      repoRoot: root,
      env,
    });

    expect(env.DOMAIN_CLIENT).toBe('http://localhost:4040');
    expect(env.COKE_BRIDGE_API_KEY).toBe('bridge-key');
    expect(env.DATABASE_URL).toBe('postgres://existing');
  });

  it('does not overwrite explicit process env values', () => {
    const root = mkdtempSync(join(tmpdir(), 'coke-gateway-env-'));
    mkdirSync(join(root, 'gateway', 'packages', 'api'), { recursive: true });
    writeFileSync(join(root, '.env'), 'COKE_BRIDGE_API_KEY=file-key\n');
    const env: Record<string, string> = { COKE_BRIDGE_API_KEY: 'process-key' };

    loadGatewayEnv({
      cwd: join(root, 'gateway', 'packages', 'api'),
      repoRoot: root,
      env,
    });

    expect(env.COKE_BRIDGE_API_KEY).toBe('process-key');
  });
});
