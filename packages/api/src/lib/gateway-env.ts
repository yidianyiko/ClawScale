import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenvFile } from 'dotenv';

type EnvMap = Record<string, string | undefined>;
type DotenvEnvMap = Record<string, string>;

interface LoadGatewayEnvOptions {
  cwd?: string;
  repoRoot?: string;
  env?: EnvMap;
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../');
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

function gatewayEnvPaths(options: LoadGatewayEnvOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  return unique([
    resolve(cwd, '.env'),
    resolve(repoRoot, 'gateway/packages/api/.env'),
    resolve(repoRoot, 'gateway/.env'),
    resolve(repoRoot, '.env'),
  ]);
}

export function loadGatewayEnv(options: LoadGatewayEnvOptions = {}): void {
  const env = (options.env ?? process.env) as DotenvEnvMap;
  for (const path of gatewayEnvPaths(options)) {
    if (!existsSync(path)) {
      continue;
    }
    loadDotenvFile({ path, override: false, processEnv: env });
  }
}
