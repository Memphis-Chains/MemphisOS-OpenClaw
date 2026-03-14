import type {
  ChannelAdapter,
  GatewayConfig,
  IncomingMessage,
  LlmMessage,
  MemoryClient,
  LlmClient,
} from './types.js';

const DEFAULT_SYSTEM_PROMPT = `You are OpenClaw, a personal AI assistant. You run on the user's own device and speak to them on the channels they already use. You have access to their memory of past conversations. Be concise, direct, and genuinely helpful.`;

function buildSystemPrompt(config: GatewayConfig, context: Awaited<ReturnType<MemoryClient['recall']>>): string {
  const base = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  if (context.items.length === 0) return base;

  const contextBlock = context.items
    .map((item) => `- ${item.content}`)
    .join('\n');

  return `${base}\n\nRelevant context from memory:\n${contextBlock}`;
}

export async function handleMessage(
  message: IncomingMessage,
  config: GatewayConfig,
  adapterMap: Map<string, ChannelAdapter>,
): Promise<void> {
  const context = await config.memory.recall(message.userId, message.text, 5);

  const systemPrompt = buildSystemPrompt(config, context);
  const messages: LlmMessage[] = [{ role: 'user', content: message.text }];

  const reply = await config.llm.complete({ system: systemPrompt, messages });

  await config.memory.store(message.userId, message.text, reply);

  const adapter = adapterMap.get(message.channel);
  if (adapter) {
    await adapter.send(message.chatId, reply);
  }
}

export type GatewayHandle = {
  stop(): Promise<void>;
};

export async function startGateway(config: GatewayConfig): Promise<GatewayHandle> {
  const adapterMap = new Map<string, ChannelAdapter>(
    config.adapters.map((adapter) => [adapter.name, adapter]),
  );

  await Promise.all(
    config.adapters.map((adapter) =>
      adapter.start((message) => handleMessage(message, config, adapterMap)),
    ),
  );

  return {
    async stop() {
      await Promise.all(config.adapters.map((adapter) => adapter.stop()));
    },
  };
}
