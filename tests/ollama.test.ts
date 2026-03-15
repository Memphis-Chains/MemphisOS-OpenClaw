import { describe, expect, it, vi, afterEach } from 'vitest';

import { createOllamaClient } from '../src/llm/ollama.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: object, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    }),
  );
}

describe('createOllamaClient', () => {
  it('sends model, messages, stream:false, and think:false by default', async () => {
    mockFetch({ message: { role: 'assistant', content: 'hi' } });

    const client = createOllamaClient({ model: 'qwen3.5:2b' });
    const result = await client.complete({
      system: 'you are helpful',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toEqual({ content: 'hi', tool_calls: undefined });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/chat');

    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      think: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('qwen3.5:2b');
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.messages[0]).toMatchObject({ role: 'system', content: 'you are helpful' });
    expect(body.messages[1]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('uses a custom baseUrl and model', async () => {
    mockFetch({ message: { role: 'assistant', content: 'ok' } });

    const client = createOllamaClient({
      baseUrl: 'http://myhost:11434',
      model: 'qwen2.5:72b',
    });
    await client.complete({ system: 'sys', messages: [{ role: 'user', content: 'test' }] });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('http://myhost:11434/api/chat');

    const body = JSON.parse(
      ((fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { model: string };
    expect(body.model).toBe('qwen2.5:72b');
  });

  it('forwards think:true when configured', async () => {
    mockFetch({ message: { role: 'assistant', content: 'thought about it' } });

    const client = createOllamaClient({ think: true });
    await client.complete({ system: 'sys', messages: [{ role: 'user', content: 'complex task' }] });

    const body = JSON.parse(
      ((fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { think: boolean };
    expect(body.think).toBe(true);
  });

  it('throws when Ollama returns a non-2xx status', async () => {
    mockFetch({ error: 'model not found' }, 404);

    const client = createOllamaClient();
    await expect(
      client.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('404');
  });

  it('throws with a helpful message when content is empty (think mode exhausted tokens)', async () => {
    mockFetch({ message: { role: 'assistant', content: '' }, thinking: 'still thinking...' });

    const client = createOllamaClient();
    await expect(
      client.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('empty content');
  });
});
