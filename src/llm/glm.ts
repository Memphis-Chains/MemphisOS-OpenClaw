import type { LlmClient, LlmMessage } from '../gateway/types.js';

type GlmConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

type OpenAiCompatResponse = {
  choices: Array<{ message: { content: string } }>;
};

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';

/**
 * Zhipu AI (Z.ai) GLM client.
 *
 * Uses the OpenAI-compatible /chat/completions endpoint.
 * Set LLM_PROVIDER=glm, GLM_API_KEY, and optionally GLM_MODEL / GLM_BASE_URL.
 */
export function createGlmClient(config: GlmConfig): LlmClient {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    async complete(input: { system: string; messages: LlmMessage[] }): Promise<string> {
      const messages = [
        { role: 'system', content: input.system },
        ...input.messages,
      ];

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GLM ${model} returned ${String(res.status)}: ${body}`);
      }

      const data = (await res.json()) as OpenAiCompatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`GLM ${model} returned empty content`);
      return content;
    },
  };
}
