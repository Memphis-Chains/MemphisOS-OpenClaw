import Anthropic from '@anthropic-ai/sdk';

import type { LlmClient, LlmMessage } from '../gateway/types.js';

type AnthropicConfig = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

export function createAnthropicClient(config: AnthropicConfig): LlmClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async complete(input: { system: string; messages: LlmMessage[] }): Promise<string> {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: input.system,
        messages: input.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const block = response.content[0];
      if (!block || block.type !== 'text') {
        throw new Error('unexpected LLM response shape');
      }
      return block.text;
    },
  };
}
