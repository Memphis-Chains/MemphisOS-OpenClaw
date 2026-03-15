import { describe, expect, it, vi } from 'vitest';

import { handleMessage, startGateway, applyLoopStep, newLoopState } from '../src/gateway/loop.js';
import type {
  ChannelAdapter,
  GatewayConfig,
  IncomingMessage,
  LlmClient,
  LlmResponse,
  LoopLimits,
  MemoryClient,
  ToolCall,
  ToolDefinition,
  ToolExecutor,
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
    complete: vi.fn().mockResolvedValue({ content: reply } satisfies LlmResponse),
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

function makeToolExecutor(results: Record<string, string> = {}): ToolExecutor {
  return {
    listTools: () =>
      Object.keys(results).map((name) => ({
        name,
        description: `${name} tool`,
        inputSchema: { type: 'object', properties: {} },
      })),
    execute: vi.fn().mockImplementation(async (call: ToolCall) => {
      return results[call.name] ?? JSON.stringify({ error: 'unknown tool' });
    }),
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

  it('executes tool calls and feeds results back to LLM', async () => {
    const memory = makeMemory();
    const toolExecutor = makeToolExecutor({ memphis_health: '{"status":"healthy"}' });

    // First call returns tool_calls, second call returns final text
    const llm: LlmClient = {
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [{ id: 'tc-1', name: 'memphis_health', arguments: {} }],
        } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: 'System is healthy!' } satisfies LlmResponse),
    };

    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = { adapters: [adapter], memory, llm, toolExecutor };

    await handleMessage(makeMessage({ text: 'check health' }), config, adapterMap);

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'memphis_health' }),
    );
    expect(adapter.send).toHaveBeenCalledWith('99', 'System is healthy!');
  });

  it('halts tool loop when limits are exceeded', async () => {
    const memory = makeMemory();
    const toolExecutor = makeToolExecutor({ search: '"result"' });

    // LLM always returns tool calls — loop should halt via limits
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue({
        content: '',
        tool_calls: [{ id: 'tc-x', name: 'search', arguments: {} }],
      } satisfies LlmResponse),
    };

    const adapter = makeAdapter();
    const adapterMap = new Map([['telegram', adapter as ChannelAdapter]]);
    const config: GatewayConfig = {
      adapters: [adapter],
      memory,
      llm,
      toolExecutor,
      loopLimits: { max_steps: 5, max_tool_calls: 2, max_wait_ms: 1000, max_errors: 1 },
    };

    await handleMessage(makeMessage({ text: 'search everything' }), config, adapterMap);

    // Should have stopped after 2 tool calls (limit)
    expect((toolExecutor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(3);
    expect(adapter.send).toHaveBeenCalledOnce();
    expect(adapter.sent[0]).toContain('limit');
  });
});

describe('applyLoopStep', () => {
  it('increments steps and tool_calls on tool_call action', () => {
    const state = newLoopState();
    const limits: LoopLimits = { max_steps: 10, max_tool_calls: 5, max_wait_ms: 1000, max_errors: 3 };

    const result = applyLoopStep(state, { type: 'tool_call', data: { tool: 'search' } }, limits);

    expect(result.applied).toBe(true);
    expect(result.state.steps).toBe(1);
    expect(result.state.tool_calls).toBe(1);
  });

  it('rejects when max_tool_calls exceeded', () => {
    let state = newLoopState();
    const limits: LoopLimits = { max_steps: 10, max_tool_calls: 1, max_wait_ms: 1000, max_errors: 3 };

    const r1 = applyLoopStep(state, { type: 'tool_call', data: { tool: 'a' } }, limits);
    expect(r1.applied).toBe(true);
    state = r1.state;

    const r2 = applyLoopStep(state, { type: 'tool_call', data: { tool: 'b' } }, limits);
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('max_tool_calls_exceeded');
  });

  it('rejects when max_steps exceeded', () => {
    let state = newLoopState();
    const limits: LoopLimits = { max_steps: 1, max_tool_calls: 10, max_wait_ms: 1000, max_errors: 3 };

    const r1 = applyLoopStep(state, { type: 'complete', data: {} }, limits);
    expect(r1.applied).toBe(true);
    state = r1.state;

    const r2 = applyLoopStep(state, { type: 'complete', data: {} }, limits);
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('max_steps_exceeded');
  });

  it('halts on non-recoverable error', () => {
    const state = newLoopState();
    const limits: LoopLimits = { max_steps: 10, max_tool_calls: 10, max_wait_ms: 1000, max_errors: 3 };

    const result = applyLoopStep(state, { type: 'error', data: { recoverable: false, message: 'fatal' } }, limits);

    expect(result.applied).toBe(true);
    expect(result.state.completed).toBe(true);
    expect(result.state.halt_reason).toBe('non_recoverable_error');
  });

  it('rejects when max_errors exceeded', () => {
    let state = newLoopState();
    const limits: LoopLimits = { max_steps: 10, max_tool_calls: 10, max_wait_ms: 1000, max_errors: 1 };

    const r1 = applyLoopStep(state, { type: 'error', data: { recoverable: true, message: 'oops' } }, limits);
    expect(r1.applied).toBe(true);
    state = r1.state;

    const r2 = applyLoopStep(state, { type: 'error', data: { recoverable: true, message: 'oops again' } }, limits);
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('max_errors_exceeded');
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
