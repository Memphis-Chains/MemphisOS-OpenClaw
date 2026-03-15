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

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type LlmResponse = {
  content: string;
  tool_calls?: ToolCall[];
};

export type LlmClient = {
  complete(input: {
    system: string;
    messages: LlmMessage[];
    tools?: ToolDefinition[];
  }): Promise<LlmResponse>;
};

export type ToolExecutor = {
  execute(call: ToolCall): Promise<string>;
  listTools(): ToolDefinition[];
};

export type LoopLimits = {
  max_steps: number;
  max_tool_calls: number;
  max_wait_ms: number;
  max_errors: number;
};

export type LoopState = {
  steps: number;
  tool_calls: number;
  wait_ms: number;
  errors: number;
  completed: boolean;
  halt_reason: string | null;
};

export type GatewayConfig = {
  adapters: ChannelAdapter[];
  memory: MemoryClient;
  llm: LlmClient;
  systemPrompt?: string;
  toolExecutor?: ToolExecutor;
  loopLimits?: LoopLimits;
};
