import { spawn } from 'node:child_process';
import type { LocalAgent } from './base.js';

/**
 * Claude Code agent — uses `claude --print` for stateless message handling.
 * Each call spawns a new claude process with the user's message.
 */
export class ClaudeCodeAgent implements LocalAgent {
  async start(): Promise<void> {
    // Verify claude CLI is available
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('claude', ['--version'], { stdio: 'pipe' });
      let output = '';
      proc.stdout.on('data', (d) => { output += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[claude-code] CLI available: ${output.trim()}`);
          resolve();
        } else {
          reject(new Error('claude CLI not found. Install it first: npm install -g @anthropic-ai/claude-code'));
        }
      });
      proc.on('error', () => reject(new Error('claude CLI not found')));
    });
  }

  async send(history: { role: string; content: string }[]): Promise<string> {
    // Get the last user message
    const lastUserMsg = [...history].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return '';

    return new Promise<string>((resolve, reject) => {
      const proc = spawn('claude', ['--dangerously-skip-permissions', '--print', '--', lastUserMsg.content], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }

  async stop(): Promise<void> {
    // Stateless — nothing to clean up
  }
}
