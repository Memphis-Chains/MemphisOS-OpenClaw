import 'dotenv/config';
import pino from 'pino';

import { startGateway } from './gateway/loop.js';
import type { ChannelAdapter, LlmClient } from './gateway/types.js';
import { createTelegramAdapter } from './channels/telegram.js';
import { createDiscordAdapter } from './channels/discord.js';
import { createMemphisClient, createNullMemoryClient } from './memory/client.js';
import { createAnthropicClient } from './llm/anthropic.js';
import { createGlmClient } from './llm/glm.js';
import { createMinimaxClient } from './llm/minimax.js';
import { createOllamaClient } from './llm/ollama.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

async function main(): Promise<void> {
  log.info('OpenClaw starting');

  // LLM — provider selected by LLM_PROVIDER env var (default: ollama)
  const llmProvider = process.env.LLM_PROVIDER ?? 'ollama';
  let llm: LlmClient;

  if (llmProvider === 'anthropic') {
    llm = createAnthropicClient({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      model: process.env.ANTHROPIC_MODEL,
    });
    log.info({ model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6' }, 'LLM: Anthropic');
  } else if (llmProvider === 'minimax') {
    llm = createMinimaxClient({
      apiKey: requireEnv('MINIMAX_API_KEY'),
      model: process.env.MINIMAX_MODEL,
      baseUrl: process.env.MINIMAX_BASE_URL,
    });
    log.info({ model: process.env.MINIMAX_MODEL ?? 'MiniMax-M2.5-highspeed' }, 'LLM: MiniMax');
  } else if (llmProvider === 'glm') {
    llm = createGlmClient({
      apiKey: requireEnv('GLM_API_KEY'),
      model: process.env.GLM_MODEL,
      baseUrl: process.env.GLM_BASE_URL,
    });
    log.info({ model: process.env.GLM_MODEL ?? 'glm-4-flash' }, 'LLM: GLM (Zhipu AI)');
  } else if (llmProvider === 'ollama') {
    llm = createOllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL,
      think: process.env.OLLAMA_THINK === 'true',
    });
    log.info(
      { model: process.env.OLLAMA_MODEL ?? 'qwen3.5:2b', baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434' },
      'LLM: Ollama',
    );
  } else {
    throw new Error(`unknown LLM_PROVIDER: ${llmProvider} — use 'ollama', 'anthropic', 'glm', or 'minimax'`);
  }

  // Memory — optional, fails open
  const memphisUrl = process.env.MEMPHIS_API_URL;
  const memory = memphisUrl
    ? createMemphisClient({ apiUrl: memphisUrl, apiToken: process.env.MEMPHIS_API_TOKEN })
    : createNullMemoryClient();

  if (!memphisUrl) {
    log.warn('MEMPHIS_API_URL not set — running without memory (conversations will not be recalled)');
  }

  // Channels — at least one required
  const adapters: ChannelAdapter[] = [];

  if (process.env.TELEGRAM_BOT_TOKEN) {
    adapters.push(createTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN, {
      onStatus: () => [
        '🟢 Soul — online',
        `LLM: ${llmProvider} (${process.env.MINIMAX_MODEL ?? process.env.GLM_MODEL ?? process.env.OLLAMA_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'default'})`,
        `Memory: ${memphisUrl ? 'Memphis v5 connected' : 'disabled'}`,
        'Gateway: OpenClaw',
      ].join('\n'),
      onRecall: async (userId) => {
        const ctx = await memory.recall(userId, 'recent conversations topics identity', 8);
        if (ctx.items.length === 0) return 'No memories stored yet.';
        return 'What I remember:\n' + ctx.items.map((i) => `• ${i.content.slice(0, 120)}`).join('\n');
      },
    }));
    log.info('Telegram channel enabled');
  }

  if (process.env.DISCORD_BOT_TOKEN) {
    adapters.push(createDiscordAdapter(process.env.DISCORD_BOT_TOKEN));
    log.info('Discord channel enabled');
  }

  if (adapters.length === 0) {
    throw new Error(
      'no channel tokens configured — set TELEGRAM_BOT_TOKEN and/or DISCORD_BOT_TOKEN',
    );
  }

  const gateway = await startGateway({
    adapters,
    memory,
    llm,
    systemPrompt: process.env.OPENCLAW_SYSTEM_PROMPT,
  });

  log.info({ channels: adapters.map((a) => a.name) }, 'gateway running');

  // Graceful shutdown
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info({ signal }, 'shutting down');
      void gateway.stop().then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  log.error({ err: error }, 'fatal error');
  process.exit(1);
});
