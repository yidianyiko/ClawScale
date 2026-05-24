/**
 * Supported Gateway-owned chat commands.
 *
 * Generic multi-backend commands and direct backend routing syntax are retired.
 * Unrecognized slash/direct-looking text is forwarded to the Coke bridge as
 * ordinary user content.
 */

type CommandType = 'clear' | 'help' | 'link' | 'unlink' | 'linked' | 'deleteaccount';

interface SystemCommand {
  command: CommandType;
  arg: string;
}

const SYSTEM_COMMANDS = new Set<CommandType>([
  'clear',
  'help',
  'link',
  'unlink',
  'linked',
  'deleteaccount',
]);

export function parseCommand(text: string): SystemCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const slashMatch = trimmed.match(/^\/(\S+)(?:\s+([\s\S]+))?$/);
  if (!slashMatch) return null;

  const cmd = slashMatch[1]!.toLowerCase();
  const arg = (slashMatch[2] ?? '').trim();

  if (SYSTEM_COMMANDS.has(cmd as CommandType)) {
    return { command: cmd as CommandType, arg };
  }

  return null;
}

const COMMAND_REFERENCE = [
  { command: '/clear', description: 'clear conversation context' },
  { command: '/link', description: 'generate a link code for this channel' },
  { command: '/link <code>', description: 'link this channel to another using a code' },
  { command: '/unlink', description: 'remove the link from this channel' },
  { command: '/linked', description: 'show all linked accounts and channels' },
  { command: '/deleteaccount', description: 'permanently delete your account and all data' },
  { command: '/help', description: 'show all commands' },
] as const;

export function formatCommandHelp(): string {
  const cmds = COMMAND_REFERENCE.map((c) => `${c.command} — ${c.description}`).join('\n');
  return `*Commands:*\n\n${cmds}`;
}
