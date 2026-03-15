import type { LlmClient, LlmMessage, LlmResponse, ToolCall, ToolDefinition } from '../gateway/types.js';

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

type OllamaToolCall = {
  function: { name: string; arguments: Record<string, unknown> };
};

type OllamaChatResponse = {
  message: { role: string; content: string; tool_calls?: OllamaToolCall[] };
  thinking?: string;
};

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3.5:2b';
const DEFAULT_TIMEOUT_MS = 120_000; // local models can be slow on first token

function toOllamaMessages(
  system: string,
  messages: LlmMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [
    { role: 'system', content: system },
  ];

  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: m.content,
        tool_calls: m.tool_calls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }

  return out;
}

function toOllamaTools(
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

let toolCallCounter = 0;

export function createOllamaClient(config: OllamaConfig = {}): LlmClient {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = config.model ?? DEFAULT_MODEL;
  const think = config.think ?? false;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async complete(input): Promise<LlmResponse> {
      const messages = toOllamaMessages(input.system, input.messages);

      const body: Record<string, unknown> = { model, messages, stream: false, think };
      if (input.tools?.length) {
        body.tools = toOllamaTools(input.tools);
      }

      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama ${model} returned ${String(res.status)}: ${text}`);
      }

      const data = (await res.json()) as OllamaChatResponse;
      const content = data.message?.content ?? '';
      const rawToolCalls = data.message?.tool_calls;

      if (!content && !rawToolCalls?.length) {
        throw new Error(
          `Ollama ${model} returned empty content — if using a Qwen3 model, ensure think:false is set`,
        );
      }

      let tool_calls: ToolCall[] | undefined;
      if (rawToolCalls?.length) {
        tool_calls = rawToolCalls.map((tc) => ({
          id: `ollama-tc-${String(++toolCallCounter)}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));
      }

      return { content, tool_calls };
    },
  };
}
