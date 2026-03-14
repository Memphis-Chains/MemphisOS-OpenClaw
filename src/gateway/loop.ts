import type {
  ChannelAdapter,
  GatewayConfig,
  IncomingMessage,
  LlmMessage,
  MemoryClient,
} from './types.js';
import { fetchUrlsFromMessage } from '../tools/fetch.js';

const DEFAULT_SYSTEM_PROMPT = `You are OpenClaw, a personal AI assistant. You run on the user's own device and speak to them on the channels they already use. You have access to their memory of past conversations. Be concise, direct, and genuinely helpful.`;

// Keep last N message pairs per chat session (in-memory, resets on restart)
const SESSION_DEPTH = 10;
const sessions = new Map<string, LlmMessage[]>();

function getSession(chatId: string): LlmMessage[] {
  if (!sessions.has(chatId)) sessions.set(chatId, []);
  return sessions.get(chatId)!;
}

function appendToSession(chatId: string, userText: string, assistantReply: string): void {
  const history = getSession(chatId);
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: assistantReply });
  // Trim to last SESSION_DEPTH pairs
  if (history.length > SESSION_DEPTH * 2) {
    history.splice(0, history.length - SESSION_DEPTH * 2);
  }
}

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
  const [context, fetched] = await Promise.all([
    config.memory.recall(message.userId, message.text, 5),
    fetchUrlsFromMessage(message.text),
  ]);

  const systemPrompt = buildSystemPrompt(config, context);

  // Append fetched URL content directly to the user message
  let userContent = message.text;
  if (fetched.length > 0) {
    const fetchedBlock = fetched
      .map((f) => `[Fetched: ${f.url}]\n${f.content}`)
      .join('\n\n');
    userContent = `${message.text}\n\n${fetchedBlock}`;
  }

  // Build messages: in-session history + current message (with fetched content)
  const history = getSession(message.chatId);
  const messages: LlmMessage[] = [
    ...history,
    { role: 'user', content: userContent },
  ];

  const reply = await config.llm.complete({ system: systemPrompt, messages });

  appendToSession(message.chatId, message.text, reply);
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
