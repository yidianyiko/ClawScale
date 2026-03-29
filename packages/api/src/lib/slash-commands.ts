/**
 * Slash command parser for ClawScale chat.
 *
 * Format: /<agent_name> <message>
 *
 * Examples:
 *   /clawscale list backends
 *   /gpt explain this code
 *   /basic-llm hello
 *
 * Reserved names:
 *   - "clawscale" — routes to the built-in ClawScale agent
 *
 * Other names are matched against AI backend names or command aliases.
 */

export interface SlashCommand {
  /** The target agent/backend name */
  target: string;
  /** The message body after the target name */
  message: string;
}

/**
 * Parse a slash command from user text.
 * Returns null if the text is not a slash command.
 *
 * Format: /<target> <message>
 */
export function parseSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  // /<target> <message...>
  const match = trimmed.match(/^\/(\S+)\s+([\s\S]+)$/);
  if (match) {
    return {
      target: match[1].toLowerCase(),
      message: match[2].trim(),
    };
  }

  // /<target> (no message)
  const targetOnly = trimmed.match(/^\/(\S+)\s*$/);
  if (targetOnly) {
    return {
      target: targetOnly[1].toLowerCase(),
      message: '',
    };
  }

  return null;
}

export interface ResolvedTarget {
  type: 'clawscale' | 'backend' | 'not_found';
  backendId?: string;
  backendName?: string;
}

/**
 * Resolve a slash command target name to a backend.
 *
 * Matching priority:
 *   1. Reserved name "clawscale"
 *   2. Exact backend name match (case-insensitive)
 *   3. Backend config.commandAlias match (case-insensitive)
 *   4. Prefix match on backend name (if unambiguous)
 */
export function resolveTarget(
  target: string,
  backends: { id: string; name: string; config: unknown }[],
): ResolvedTarget {
  if (target === 'clawscale') {
    return { type: 'clawscale' };
  }

  // Exact name match
  const exact = backends.find((b) => b.name.toLowerCase() === target);
  if (exact) {
    return { type: 'backend', backendId: exact.id, backendName: exact.name };
  }

  // Command alias match (admin-defined in backend config)
  const aliasMatch = backends.find((b) => {
    const cfg = (b.config ?? {}) as { commandAlias?: string };
    return cfg.commandAlias?.toLowerCase() === target;
  });
  if (aliasMatch) {
    return { type: 'backend', backendId: aliasMatch.id, backendName: aliasMatch.name };
  }

  // Prefix match (unambiguous only)
  const prefixMatches = backends.filter((b) => b.name.toLowerCase().startsWith(target));
  if (prefixMatches.length === 1) {
    return { type: 'backend', backendId: prefixMatches[0].id, backendName: prefixMatches[0].name };
  }

  return { type: 'not_found' };
}
