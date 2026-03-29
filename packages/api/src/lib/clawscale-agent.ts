/**
 * ClawScale Default Agent
 *
 * A built-in, rule-based agent that runs before any external AI backend is
 * selected. It handles two things:
 *
 *   1. Backend selection — presents the menu, parses the user's choice.
 *   2. ClawScale knowledge — answers questions about what ClawScale is and
 *      how it works, without calling any external LLM.
 *
 * If the user sends something that is neither a backend selection nor a
 * ClawScale question, the agent prompts them to choose a backend first.
 * It never attempts to answer general or off-topic queries.
 */

export interface BackendOption {
  id: string;
  name: string;
}

export interface AgentResponse {
  /** The reply text to send back to the user. */
  reply: string;
  /**
   * If the user successfully chose a backend, this is set to its id.
   * The caller should persist this as the user's selectedBackendId.
   */
  selectedBackendId?: string;
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
      `Reply with a number to choose an AI assistant and get started.`
    );
  }

  // How does it work?
  if (/how does (it|clawscale) work|how (do i|to) use|getting started/.test(t)) {
    return (
      `Here's how ClawScale works:\n\n` +
      `1️⃣  An admin connects one or more messaging platforms (e.g. WhatsApp, Telegram).\n` +
      `2️⃣  The admin configures AI backends — any LLM or OpenClaw instance.\n` +
      `3️⃣  When you start a conversation, ClawScale asks you to choose a backend.\n` +
      `4️⃣  From then on, all your messages are routed to the AI you picked.\n\n` +
      `Reply with a number to choose your AI assistant now.`
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
      `Reply with a number to choose the one you'd like to use.`
    );
  }

  // How do I switch / change backend?
  if (/switch|change (backend|ai|model|assistant)|use (a )?different|reset/.test(t)) {
    return (
      `To switch AI assistants, simply start a new conversation or ask your workspace admin ` +
      `to reset your selection.\n\n` +
      `Reply with a number below to choose your AI assistant for this conversation.`
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
      `Admins can connect platforms from the *Channels* section of the dashboard.\n\n` +
      `Reply with a number to choose your AI assistant.`
    );
  }

  // Who made / built ClawScale?
  if (/who (made|built|created|developed)|by (pulse|who)/.test(t)) {
    return (
      `ClawScale is built by *Pulse* — a developer tools company focused on AI workflows.\n\n` +
      `Reply with a number to choose your AI assistant.`
    );
  }

  // Help
  if (/^help$|what can you do|what do you know|commands/.test(t)) {
    return (
      `I'm the *ClawScale* default assistant. Before you pick an AI backend, I can answer:\n\n` +
      `• What is ClawScale?\n` +
      `• How does it work?\n` +
      `• What AI backends are available?\n` +
      `• What platforms are supported?\n` +
      `• How do I switch backends?\n\n` +
      `Once you've chosen a backend, all further questions go to your chosen AI.`
    );
  }

  return null; // off-topic
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the ClawScale default agent for a user who has not yet selected a backend.
 *
 * @param text       The user's message text.
 * @param backends   Active backends the user can choose from.
 * @param personaName The persona display name configured by the admin.
 */
export function clawscaleAgent(
  text: string,
  backends: BackendOption[],
  personaName: string,
): AgentResponse {
  // 1. Check if the user is selecting a backend by number
  const choice = parseInt(text.trim(), 10);
  if (!isNaN(choice) && choice >= 1 && choice <= backends.length) {
    const selected = backends[choice - 1];
    return {
      reply: `✅ Connected to *${selected.name}*. How can I help you today?`,
      selectedBackendId: selected.id,
    };
  }

  // 2. Check ClawScale knowledge base
  const knowledgeReply = matchKnowledge(text);
  if (knowledgeReply) {
    // Append the backend list so the user can still choose after reading the answer
    if (backends.length > 0) {
      const list = backends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
      return { reply: `${knowledgeReply}\n\n${list}` };
    }
    return { reply: knowledgeReply };
  }

  // 3. Off-topic — do not answer; redirect to backend selection
  if (backends.length === 0) {
    return {
      reply:
        `I can only answer questions about ClawScale before an AI backend is selected. ` +
        `Ask your admin to configure at least one AI backend in the dashboard.`,
    };
  }

  const list = backends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
  return {
    reply:
      `I'm the *ClawScale* default assistant — I can only answer questions about ClawScale ` +
      `or help you choose an AI backend.\n\n` +
      `Please choose a backend to continue:\n\n${list}\n\n` +
      `Or ask me: *"What is ClawScale?"*, *"How does it work?"*, or *"What backends are available?"*`,
  };
}

/**
 * Build the initial greeting + backend selection menu.
 */
export function buildSelectionMenu(personaName: string, backends: BackendOption[]): string {
  if (backends.length === 0) {
    return (
      `👋 Welcome to ClawScale!\n\n` +
      `I'm ${personaName}, your AI-powered assistant. ` +
      `No AI backends have been configured yet — please ask your admin to set one up.\n\n` +
      `In the meantime, you can ask me about ClawScale.`
    );
  }

  const list = backends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
  return (
    `👋 Welcome to ClawScale!\n\n` +
    `I'm ${personaName}, your AI-powered assistant. ClawScale connects you to multiple AI backends ` +
    `so you can choose the one that works best for you — all through this chat.\n\n` +
    `Please choose an AI assistant to get started:\n\n${list}\n\n` +
    `Reply with a number to continue, or ask me *"What is ClawScale?"* to learn more.`
  );
}
