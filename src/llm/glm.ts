import type { LlmClient, LlmMessage, LlmResponse, ToolCall, ToolDefinition } from '../gateway/types.js';

type GlmConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAiCompatResponse = {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
};

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';

function toOpenAiMessages(
  system: string,
  messages: LlmMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [
    { role: 'system', content: system },
  ];

  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }

  return out;
}

function toOpenAiTools(
  tools: ToolDefinition[],
): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

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
    async complete(input): Promise<LlmResponse> {
      const messages = toOpenAiMessages(input.system, input.messages);

      const body: Record<string, unknown> = { model, messages };
      if (input.tools?.length) {
        body.tools = toOpenAiTools(input.tools);
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GLM ${model} returned ${String(res.status)}: ${text}`);
      }

      const data = (await res.json()) as OpenAiCompatResponse;
      const choice = data.choices?.[0]?.message;
      const content = choice?.content ?? '';
      const rawToolCalls = choice?.tool_calls;

      if (!content && !rawToolCalls?.length) {
        throw new Error(`GLM ${model} returned empty content`);
      }

      let tool_calls: ToolCall[] | undefined;
      if (rawToolCalls?.length) {
        tool_calls = rawToolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        }));
      }

      return { content, tool_calls };
    },
  };
}
