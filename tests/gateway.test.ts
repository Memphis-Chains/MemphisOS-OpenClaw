import { describe, expect, it, vi } from 'vitest';

import { handleMessage, startGateway } from '../src/gateway/loop.js';
import type {
  ChannelAdapter,
  GatewayConfig,
  IncomingMessage,
  LlmClient,
  MemoryClient,
} from '../src/gateway/types.js';

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg-1',
    channel: 'telegram',
    userId: 'telegram:42',
    chatId: '99',
    text: 'hello',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeMemory(items: Array<{ content: string; score: number }> = []): MemoryClient {
  return {
    isAvailable: () => true,
    recall: vi.fn().mockResolvedValue({ items }),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLlm(reply = 'hi there'): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(reply),
  };
}

function makeAdapter(name: 'telegram' | 'discord' = 'telegram'): ChannelAdapter & { sent: string[] } {
  const sent: string[] = [];
  return {
    name,
    sent,
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockImplementation(async (_chatId: string, text: string) => { sent.push(text); }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleMessage', () => {
  it('calls LLM with user text and sends reply to the right adapter', async () => {
    const memory = makeMemory();
    const llm = makeLlm('pong');
    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = { adapters: [adapter], memory, llm };

    await handleMessage(makeMessage({ text: 'ping', chatId: '99' }), config, adapterMap);

    expect(llm.complete).toHaveBeenCalledOnce();
    expect(adapter.send).toHaveBeenCalledWith('99', 'pong');
  });

  it('recalls memory before calling the LLM', async () => {
    const memory = makeMemory([{ content: 'user likes coffee', score: 0.9 }]);
    const llm = makeLlm('noted');
    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = { adapters: [adapter], memory, llm };

    await handleMessage(makeMessage({ userId: 'telegram:42', text: 'remind me' }), config, adapterMap);

    expect(memory.recall).toHaveBeenCalledWith('telegram:42', 'remind me', expect.any(Number));
    const callArgs = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('user likes coffee');
  });

  it('stores the exchange in memory after replying', async () => {
    const memory = makeMemory();
    const llm = makeLlm('response');
    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = { adapters: [adapter], memory, llm };

    await handleMessage(makeMessage({ userId: 'telegram:42', text: 'hello' }), config, adapterMap);

    expect(memory.store).toHaveBeenCalledWith('telegram:42', 'hello', 'response');
  });

  it('does not crash when memory is unavailable', async () => {
    const memory: MemoryClient = {
      isAvailable: () => false,
      recall: vi.fn().mockResolvedValue({ items: [] }),
      store: vi.fn().mockResolvedValue(undefined),
    };
    const llm = makeLlm('ok');
    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = { adapters: [adapter], memory, llm };

    await expect(handleMessage(makeMessage(), config, adapterMap)).resolves.toBeUndefined();
    expect(adapter.send).toHaveBeenCalledWith('99', 'ok');
  });

  it('uses a custom system prompt when configured', async () => {
    const memory = makeMemory();
    const llm = makeLlm('aye');
    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = {
      adapters: [adapter],
      memory,
      llm,
      systemPrompt: 'You are a pirate assistant.',
    };

    await handleMessage(makeMessage(), config, adapterMap);

    const callArgs = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('pirate');
  });
});

describe('startGateway', () => {
  it('starts all adapters and returns a stop handle', async () => {
    const memory = makeMemory();
    const llm = makeLlm();
    const telegram = makeAdapter('telegram');
    const discord = makeAdapter('discord');

    const handle = await startGateway({ adapters: [telegram, discord], memory, llm });

    expect(telegram.start).toHaveBeenCalledOnce();
    expect(discord.start).toHaveBeenCalledOnce();

    await handle.stop();
    expect(telegram.stop).toHaveBeenCalledOnce();
    expect(discord.stop).toHaveBeenCalledOnce();
  });
});
