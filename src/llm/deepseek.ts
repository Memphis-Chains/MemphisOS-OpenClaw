import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../gateway/types.js';

type DeepSeekConfig = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
};

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MAX_TOKENS = 2048;

type OaiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

function toOaiMessages(messages: LlmMessage[]): OaiMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: m.tool_call_id, content: m.content };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant' as const,
        content: m.content,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * DeepSeek LLM client (OpenAI-compatible API).
 *
 * Models:
 *   deepseek-chat      — DeepSeek-V3 (fast, general-purpose)
 *   deepseek-reasoner  — DeepSeek-R1 (step-by-step reasoning)
 */
export function createDeepSeekClient(config: DeepSeekConfig): LlmClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async complete(input): Promise<LlmResponse> {
      const messages: OaiMessage[] = [
        { role: 'system', content: input.system },
        ...toOaiMessages(input.messages),
      ];

      const tools = input.tools?.map((t: ToolDefinition) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
      };

      if (tools?.length) {
        body.tools = tools;
      }

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DeepSeek API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const msg = data.choices?.[0]?.message;
      const content = msg?.content ?? '';

      const tool_calls = msg?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      return {
        content,
        tool_calls: tool_calls?.length ? tool_calls : undefined,
      };
    },
  };
}
