import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../gateway/types.js';

type MemphisLlmConfig = {
  apiUrl: string;
  apiToken?: string;
  model?: string;
  maxTokens?: number;
};

type CompletionsResponse = {
  ok: boolean;
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  model: string;
  provider: string;
  usage?: { prompt: number; completion: number; total: number };
  timingMs: number;
  error?: string;
};

/**
 * Memphis LLM client.
 *
 * Routes all LLM calls through Memphis's /v1/chat/completions endpoint.
 * Memphis handles provider selection, fallback, metrics, and audit.
 * This eliminates the need for OpenClaw to configure individual provider API keys.
 */
export function createMemphisLlmClient(config: MemphisLlmConfig): LlmClient {
  const headers: HeadersInit = config.apiToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiToken}` }
    : { 'Content-Type': 'application/json' };

  return {
    async complete(input): Promise<LlmResponse> {
      // Convert OpenClaw messages to Memphis chat completions format
      const messages = input.messages.map((m: LlmMessage) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, tool_call_id: m.tool_call_id, content: m.content };
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
          };
        }
        return { role: m.role, content: m.content };
      });

      const tools = input.tools?.map((t: ToolDefinition) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      const body: Record<string, unknown> = {
        messages,
        system: input.system,
      };
      if (config.model) body.model = config.model;
      if (config.maxTokens) body.maxTokens = config.maxTokens;
      if (tools?.length) body.tools = tools;

      const res = await fetch(`${config.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Memphis /v1/chat/completions returned ${res.status}: ${text}`);
      }

      const data = (await res.json()) as CompletionsResponse;

      if (!data.ok) {
        throw new Error(`Memphis completion error: ${data.error ?? 'unknown'}`);
      }

      return {
        content: data.content,
        tool_calls: data.tool_calls?.length ? data.tool_calls : undefined,
      };
    },
  };
}
