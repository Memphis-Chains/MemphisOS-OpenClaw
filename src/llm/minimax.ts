import type { LlmClient, LlmMessage } from '../gateway/types.js';

type MinimaxConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

type MinimaxMessage = {
  role: 'system' | 'user' | 'assistant';
  name?: string;
  content?: string;
};

type MinimaxResponse = {
  choices: Array<{ message: { content: string } }>;
};

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-M2.5-highspeed';

/**
 * MiniMax client.
 *
 * Uses the /text/chatcompletion_v2 endpoint (MiniMax's own format, similar to OpenAI).
 * Set LLM_PROVIDER=minimax, MINIMAX_API_KEY, and optionally MINIMAX_MODEL / MINIMAX_BASE_URL.
 */
export function createMinimaxClient(config: MinimaxConfig): LlmClient {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    async complete(input: { system: string; messages: LlmMessage[] }): Promise<string> {
      const messages: MinimaxMessage[] = [
        { role: 'system', name: 'Soul', content: input.system },
        ...input.messages.map((m) => ({
          role: m.role,
          name: m.role === 'user' ? 'User' : 'Soul',
          content: m.content,
        })),
      ];

      const res = await fetch(`${baseUrl}/text/chatcompletion_v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`MiniMax ${model} returned ${String(res.status)}: ${body}`);
      }

      const data = (await res.json()) as MinimaxResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`MiniMax ${model} returned empty content`);
      return content;
    },
  };
}
