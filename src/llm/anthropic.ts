import Anthropic from '@anthropic-ai/sdk';

import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../gateway/types.js';

type AnthropicConfig = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

function toAnthropicMessages(
  messages: LlmMessage[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: m.content,
          },
        ],
      });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      out.push({ role: 'assistant', content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }

  return out;
}

function toAnthropicTools(
  tools: ToolDefinition[],
): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

export function createAnthropicClient(config: AnthropicConfig): LlmClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async complete(input): Promise<LlmResponse> {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokens,
        system: input.system,
        messages: toAnthropicMessages(input.messages),
      };

      if (input.tools?.length) {
        params.tools = toAnthropicTools(input.tools);
      }

      const response = await client.messages.create(params);

      let content = '';
      const tool_calls: LlmResponse['tool_calls'] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          tool_calls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      return { content, tool_calls: tool_calls.length > 0 ? tool_calls : undefined };
    },
  };
}
