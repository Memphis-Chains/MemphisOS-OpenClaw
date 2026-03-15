import type { LlmClient, LlmMessage, LlmResponse, ToolCall, ToolDefinition } from '../gateway/types.js';

type MinimaxConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

type MinimaxMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  name?: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

type MinimaxToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type MinimaxResponse = {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: MinimaxToolCall[];
    };
  }>;
};

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-M2.5-highspeed';

function toMinimaxMessages(
  system: string,
  messages: LlmMessage[],
): MinimaxMessage[] {
  const out: MinimaxMessage[] = [
    { role: 'system', name: 'Soul', content: system },
  ];

  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        name: 'Soul',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      out.push({
        role: m.role,
        name: m.role === 'user' ? 'User' : 'Soul',
        content: m.content,
      });
    }
  }

  return out;
}

function toMinimaxTools(
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
    async complete(input): Promise<LlmResponse> {
      const messages = toMinimaxMessages(input.system, input.messages);

      const body: Record<string, unknown> = { model, messages, stream: false };
      if (input.tools?.length) {
        body.tools = toMinimaxTools(input.tools);
      }

      const res = await fetch(`${baseUrl}/text/chatcompletion_v2`, {
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
        throw new Error(`MiniMax ${model} returned ${String(res.status)}: ${text}`);
      }

      const data = (await res.json()) as MinimaxResponse;
      const choice = data.choices?.[0]?.message;
      const content = choice?.content ?? '';
      const rawToolCalls = choice?.tool_calls;

      if (!content && !rawToolCalls?.length) {
        throw new Error(`MiniMax ${model} returned empty content`);
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
