/**
 * ClawScale Default Agent
 *
 * A built-in, rule-based agent that runs before any external AI backend is
 * selected. It handles:
 *
 *   1. Backend selection — parses add/remove commands, presents the menu.
 *   2. ClawScale knowledge — answers questions about what ClawScale is and
 *      how it works, without calling any external LLM.
 *
 * Users can select multiple backends simultaneously. All active backends
 * respond to each message independently.
 */

export interface BackendOption {
  id: string;
  name: string;
}

export interface AgentResponse {
  /** The reply text to send back to the user. */
  reply: string;
  /**
   * Backend IDs to add to the user's active set.
   * The caller should persist these in the EndUserBackend join table.
   */
  addBackendIds?: string[];
  /**
   * Backend IDs to remove from the user's active set.
   */
  removeBackendIds?: string[];
}

// ── ClawScale knowledge base ──────────────────────────────────────────────────

/**
 * Returns a knowledge-base answer if the text matches a ClawScale topic,
 * or null if the question is off-topic.
 */
function matchKnowledge(text: string): string | null {
  const t = text.toLowerCase().trim();

  // What is ClawScale?
  if (/what (is|are) clawscale|about clawscale|tell me about|clawscale\?/.test(t)) {
    return (
      `*ClawScale* is a multi-tenant AI chat gateway built by Pulse.\n\n` +
      `It connects any messaging platform (WhatsApp, Telegram, Discord, Slack, LINE, Teams, Signal, Matrix, WeChat, and more) ` +
      `to one or more AI backends — so your team can deploy a smart assistant without ` +
      `end-users needing accounts or technical knowledge.\n\n` +
      `You can add multiple AI assistants to your session and they'll all respond to your messages.`
    );
  }

  // How does it work?
  if (/how does (it|clawscale) work|how (do i|to) use|getting started/.test(t)) {
    return (
      `Here's how ClawScale works:\n\n` +
      `1️⃣  An admin connects one or more messaging platforms (e.g. WhatsApp, Telegram).\n` +
      `2️⃣  The admin configures AI backends — any LLM or OpenClaw instance.\n` +
      `3️⃣  You choose which AI backends to add to your session.\n` +
      `4️⃣  All your active backends respond to each message independently.\n\n` +
      `Reply with a number to add an AI assistant, or say "remove <number>" to remove one.`
    );
  }

  // What is an AI backend / what backends are available?
  if (/what (is an?|are) (ai )?backend|which (ai|backend|model)|available (ai|backend|model)/.test(t)) {
    return (
      `An *AI backend* is the language model that powers your conversation.\n\n` +
      `ClawScale supports:\n` +
      `• *OpenAI* (GPT-4o, GPT-4o-mini, etc.)\n` +
      `• *Anthropic Claude* (Haiku, Sonnet, Opus)\n` +
      `• *OpenRouter* (hundreds of models via one API)\n` +
      `• *OpenClaw* (your own self-hosted AI instance)\n` +
      `• *Pulse Editor AI* (Pulse's built-in AI manager)\n` +
      `• *Custom* (any OpenAI-compatible endpoint)\n\n` +
      `Your admin decides which backends are available in this workspace.\n` +
      `You can add multiple backends at once — they'll each respond to your messages.`
    );
  }

  // How do I switch / change backend?
  if (/switch|change (backend|ai|model|assistant)|use (a )?different|reset/.test(t)) {
    return (
      `You can manage your active AI assistants at any time:\n\n` +
      `• Reply with a *number* to add a backend\n` +
      `• Say *"remove <number>"* to remove one\n` +
      `• Say *"list"* to see your active backends\n` +
      `• Say *"clear"* to remove all and start fresh`
    );
  }

  // What platforms / channels are supported?
  if (/platform|channel|support(ed)?|integrate|connect/.test(t)) {
    return (
      `ClawScale currently supports these messaging platforms:\n\n` +
      `• WhatsApp (Personal & Business)\n` +
      `• Telegram\n` +
      `• Discord\n` +
      `• Slack\n` +
      `• Microsoft Teams\n` +
      `• LINE\n` +
      `• Signal\n` +
      `• Matrix\n` +
      `• WeChat Work (WeCom)\n` +
      `• WeChat Personal\n\n` +
      `Admins can connect platforms from the *Channels* section of the dashboard.`
    );
  }

  // Who made / built ClawScale?
  if (/who (made|built|created|developed)|by (pulse|who)/.test(t)) {
    return (
      `ClawScale is built by *Pulse* — a developer tools company focused on AI workflows.`
    );
  }

  // Help
  if (/^help$|what can you do|what do you know|commands/.test(t)) {
    return (
      `I'm the *ClawScale* default assistant. I can help you:\n\n` +
      `• *Add backends*: reply with a number from the menu\n` +
      `• *Remove backends*: say "remove <number>"\n` +
      `• *List active*: say "list" or "active"\n` +
      `• *Clear all*: say "clear"\n\n` +
      `I can also answer questions about ClawScale:\n` +
      `• What is ClawScale?\n` +
      `• How does it work?\n` +
      `• What AI backends are available?\n` +
      `• What platforms are supported?`
    );
  }

  return null; // off-topic
}

// ── Backend list formatting ───────────────────────────────────────────────────

function formatBackendList(backends: BackendOption[], activeIds: string[]): string {
  return backends.map((b, i) => {
    const active = activeIds.includes(b.id) ? ' ✅' : '';
    return `${i + 1}. ${b.name}${active}`;
  }).join('\n');
}

function formatActiveList(backends: BackendOption[], activeIds: string[]): string {
  const active = backends.filter((b) => activeIds.includes(b.id));
  if (active.length === 0) return 'You have no active AI assistants.';
  return `Your active AI assistants:\n\n` +
    active.map((b) => `• ${b.name}`).join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the ClawScale default agent.
 *
 * @param text          The user's message text.
 * @param backends      Active backends the user can choose from.
 * @param activeIds     IDs of backends currently active for this user.
 * @param personaName   The persona display name configured by the admin.
 * @param mode
 *   - `'select'` (default): normal mode. The agent presents the menu,
 *     parses add/remove commands, and answers ClawScale questions.
 *   - `'chat'`: user has explicitly selected the ClawScale backend. Only
 *     answers ClawScale questions and declines off-topic ones.
 */
export function clawscaleAgent(
  text: string,
  backends: BackendOption[],
  activeIds: string[],
  personaName: string,
  mode: 'select' | 'chat' = 'select',
  answerStyle?: string,
): AgentResponse {
  const styled = (reply: string) =>
    answerStyle ? `${reply}\n\n${answerStyle}` : reply;

  const t = text.trim().toLowerCase();

  if (mode === 'select') {
    // ── "clear" / "remove all" ──────────────────────────────────────────
    if (/^(clear|remove all|reset)$/.test(t)) {
      if (activeIds.length === 0) {
        const list = formatBackendList(backends, []);
        return { reply: styled(`You have no active backends to clear.\n\nAvailable:\n\n${list}`) };
      }
      const list = formatBackendList(backends, []);
      return {
        reply: styled(`✅ Cleared all active AI assistants.\n\nAvailable:\n\n${list}\n\nReply with a number to add one.`),
        removeBackendIds: [...activeIds],
      };
    }

    // ── "list" / "active" ───────────────────────────────────────────────
    if (/^(list|active|status|my backends)$/.test(t)) {
      const activeList = formatActiveList(backends, activeIds);
      const list = formatBackendList(backends, activeIds);
      return { reply: styled(`${activeList}\n\nAll available:\n\n${list}`) };
    }

    // ── "remove <N>" ────────────────────────────────────────────────────
    const removeMatch = t.match(/^remove\s+(\d+)$/);
    if (removeMatch) {
      const idx = parseInt(removeMatch[1], 10) - 1;
      if (idx >= 0 && idx < backends.length) {
        const target = backends[idx];
        if (!activeIds.includes(target.id)) {
          return { reply: styled(`*${target.name}* is not currently active.`) };
        }
        const newActiveIds = activeIds.filter((id) => id !== target.id);
        const list = formatBackendList(backends, newActiveIds);
        return {
          reply: styled(`✅ Removed *${target.name}*.\n\nActive backends:\n\n${list}`),
          removeBackendIds: [target.id],
        };
      }
      return { reply: styled(`Invalid number. Reply with a number between 1 and ${backends.length}.`) };
    }

    // ── Add by number ───────────────────────────────────────────────────
    const choice = parseInt(t, 10);
    if (!isNaN(choice) && choice >= 1 && choice <= backends.length) {
      const selected = backends[choice - 1];
      if (activeIds.includes(selected.id)) {
        return { reply: styled(`*${selected.name}* is already active. Say "remove ${choice}" to remove it.`) };
      }
      const newActiveIds = [...activeIds, selected.id];
      const list = formatBackendList(backends, newActiveIds);
      return {
        reply: styled(`✅ Added *${selected.name}*. It will now respond to your messages.\n\nActive backends:\n\n${list}\n\nReply with another number to add more, or just send a message.`),
        addBackendIds: [selected.id],
      };
    }
  }

  // ── If user has active backends, stay silent for everything else ─────
  // ClawScale only handles explicit selection commands when backends are active.
  // All other messages go straight to the active backends.
  if (mode === 'select' && activeIds.length > 0) {
    return { reply: '' };
  }

  // ── No active backends — ClawScale handles knowledge + menu ───────────

  if (mode === 'chat') {
    const knowledgeReply = matchKnowledge(text);
    if (knowledgeReply) return { reply: styled(knowledgeReply) };
    return {
      reply: styled(
        `I'm the built-in *ClawScale* assistant. I can only answer questions about ClawScale itself.\n\n` +
        `For general questions, please start a new conversation and choose a different AI backend.`,
      ),
    };
  }

  // select mode, no active backends
  const knowledgeReply = matchKnowledge(text);
  if (knowledgeReply) {
    if (backends.length > 0) {
      const list = formatBackendList(backends, activeIds);
      return { reply: styled(`${knowledgeReply}\n\n${list}`) };
    }
    return { reply: styled(knowledgeReply) };
  }

  if (backends.length === 0) {
    return {
      reply: styled(
        `I can only answer questions about ClawScale before an AI backend is selected. ` +
        `Ask your admin to configure at least one AI backend in the dashboard.`,
      ),
    };
  }

  const list = formatBackendList(backends, activeIds);
  return {
    reply: styled(
      `I'm the *ClawScale* default assistant — I can only answer questions about ClawScale ` +
      `or help you choose an AI backend.\n\n` +
      `Please choose a backend to continue:\n\n${list}\n\n` +
      `Reply with a number to add one, or ask me: *"What is ClawScale?"*, *"How does it work?"*, or *"help"*`,
    ),
  };
}

/**
 * Build the initial greeting + backend selection menu.
 */
export function buildSelectionMenu(personaName: string, backends: BackendOption[], activeIds: string[] = []): string {
  if (backends.length === 0) {
    return (
      `👋 Welcome to ClawScale!\n\n` +
      `I'm ${personaName}, your AI-powered assistant. ` +
      `No AI backends have been configured yet — please ask your admin to set one up.\n\n` +
      `In the meantime, you can ask me about ClawScale.`
    );
  }

  const list = formatBackendList(backends, activeIds);
  return (
    `👋 Welcome to ClawScale!\n\n` +
    `I'm ${personaName}, your AI-powered assistant. ClawScale connects you to multiple AI backends ` +
    `— you can add as many as you like and they'll all respond to your messages.\n\n` +
    `Available AI assistants:\n\n${list}\n\n` +
    `Reply with a number to add one, or ask me *"What is ClawScale?"* to learn more.`
  );
}
