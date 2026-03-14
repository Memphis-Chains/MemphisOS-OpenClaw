export type ChannelName = 'telegram' | 'discord';

export type IncomingMessage = {
  id: string;
  channel: ChannelName;
  userId: string;   // stable per-user ID within the channel
  chatId: string;   // where to send the reply (DM, group, channel)
  text: string;
  timestamp: Date;
};

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export type ChannelAdapter = {
  readonly name: ChannelName;
  start(handler: MessageHandler): Promise<void>;
  send(chatId: string, text: string): Promise<void>;
  stop(): Promise<void>;
};

export type RecalledContext = {
  items: Array<{ content: string; score: number }>;
};

export type MemoryClient = {
  recall(userId: string, query: string, limit?: number): Promise<RecalledContext>;
  store(userId: string, userText: string, assistantReply: string): Promise<void>;
  isAvailable(): boolean;
};

export type LlmMessage = { role: 'user' | 'assistant'; content: string };

export type LlmClient = {
  complete(input: { system: string; messages: LlmMessage[] }): Promise<string>;
};

export type GatewayConfig = {
  adapters: ChannelAdapter[];
  memory: MemoryClient;
  llm: LlmClient;
  systemPrompt?: string;
};
