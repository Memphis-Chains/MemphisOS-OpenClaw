import type { LlmClient, LlmMessage } from '../gateway/types.js';

type OllamaConfig = {
  baseUrl?: string;
  model?: string;
  /**
   * Qwen3 thinking mode. Defaults to false for assistant use — enabling it burns
   * tokens on internal reasoning before producing a reply, which adds latency
   * and can return empty content if the context window is exhausted mid-think.
   * Set to true if you want step-by-step reasoning for complex tasks.
   */
  think?: boolean;
  timeoutMs?: number;
};

type OllamaChatResponse = {
  message: { role: string; content: string };
  thinking?: string;
};

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3.5:2b';
const DEFAULT_TIMEOUT_MS = 120_000; // local models can be slow on first token

export function createOllamaClient(config: OllamaConfig = {}): LlmClient {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = config.model ?? DEFAULT_MODEL;
  const think = config.think ?? false;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async complete(input: { system: string; messages: LlmMessage[] }): Promise<string> {
      const messages = [
        { role: 'system', content: input.system },
        ...input.messages,
      ];

      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, think }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama ${model} returned ${String(res.status)}: ${body}`);
      }

      const data = (await res.json()) as OllamaChatResponse;

      if (!data.message?.content) {
        throw new Error(
          `Ollama ${model} returned empty content — if using a Qwen3 model, ensure think:false is set`,
        );
      }

      return data.message.content;
    },
  };
}
