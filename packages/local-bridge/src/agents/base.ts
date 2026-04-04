/** Interface for local AI agent adapters. */
export interface LocalAgent {
  /** Initialize the agent (spawn process, etc.) */
  start(): Promise<void>;
  /** Send message history and get a response. */
  send(history: { role: string; content: string }[]): Promise<string>;
  /** Shut down the agent. */
  stop(): Promise<void>;
}
