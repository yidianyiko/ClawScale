export type EndUserStatus = 'allowed' | 'blocked';
export type MessageRole = 'user' | 'assistant';

export interface ClawscaleUserRef {
  id: string;
  cokeAccountId: string;
}

/** External user who interacts with the bot via a social channel */
export interface EndUser {
  id: string;
  tenantId: string;
  channelId: string;
  /** Platform-native identifier (e.g. phone number, Telegram user_id) */
  externalId: string;
  name: string | null;
  email: string | null;
  status: EndUserStatus;
  clawscaleUserId: string | null;
  clawscaleUser: ClawscaleUserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  channelId: string;
  endUserId: string;
  createdAt: string;
  updatedAt: string;
  endUser?: Pick<EndUser, 'id' | 'externalId' | 'name' | 'email' | 'status'>;
  channel?: { id: string; name: string; type: string };
  messages?: Message[];
  _count?: { messages: number };
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}
