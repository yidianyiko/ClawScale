#!/usr/bin/env node

import { Command } from 'commander';
import { Bridge } from './bridge.js';
import { ClaudeCodeAgent } from './agents/claude-code.js';
import type { LocalAgent } from './agents/base.js';

const AGENTS: Record<string, () => LocalAgent> = {
  'claude-code': () => new ClaudeCodeAgent(),
};

const program = new Command()
  .name('clawscale-bridge')
  .description('Connect a local AI agent to ClawScale as a backend')
  .requiredOption('-s, --server <url>', 'ClawScale WebSocket URL (e.g. wss://your-server/bridge)')
  .requiredOption('-t, --token <token>', 'Bridge token from ClawScale dashboard')
  .option('-a, --agent <type>', 'Agent type to bridge', 'claude-code')
  .parse();

const opts = program.opts<{ server: string; token: string; agent: string }>();

const agentFactory = AGENTS[opts.agent];
if (!agentFactory) {
  console.error(`Unknown agent type: ${opts.agent}`);
  console.error(`Available agents: ${Object.keys(AGENTS).join(', ')}`);
  process.exit(1);
}

const bridge = new Bridge({
  server: opts.server,
  token: opts.token,
  agent: agentFactory(),
});

bridge.start().catch((err) => {
  console.error('Failed to start bridge:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[bridge] Shutting down...');
  bridge.stop();
  process.exit(0);
});
