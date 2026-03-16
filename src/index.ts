import 'dotenv/config';
import { createInterface } from 'node:readline';
import pino from 'pino';

import { handleMessage, startGateway } from './gateway/loop.js';
import type { ChannelAdapter, GatewayConfig, LlmClient } from './gateway/types.js';
import { createTelegramAdapter } from './channels/telegram.js';
import { createDiscordAdapter } from './channels/discord.js';
import { createMemphisClient, createNullMemoryClient } from './memory/client.js';
import { createMcpToolExecutor } from './mcp/client.js';
import { createAnthropicClient } from './llm/anthropic.js';
import { createGlmClient } from './llm/glm.js';
import { createMinimaxClient } from './llm/minimax.js';
import { createOllamaClient } from './llm/ollama.js';
import { createMemphisLlmClient } from './llm/memphis.js';
import { createDeepSeekClient } from './llm/deepseek.js';
import { createFileSessionStore, createMemorySessionStore } from './session/store.js';

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
  let modelLabel = '';

  if (llmProvider === 'anthropic') {
    llm = createAnthropicClient({ apiKey: requireEnv('ANTHROPIC_API_KEY'), model: process.env.ANTHROPIC_MODEL });
    modelLabel = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    log.info({ model: modelLabel }, 'LLM: Anthropic');
  } else if (llmProvider === 'minimax') {
    llm = createMinimaxClient({ apiKey: requireEnv('MINIMAX_API_KEY'), model: process.env.MINIMAX_MODEL, baseUrl: process.env.MINIMAX_BASE_URL });
    modelLabel = process.env.MINIMAX_MODEL ?? 'MiniMax-M2.5-highspeed';
    log.info({ model: modelLabel }, 'LLM: MiniMax');
  } else if (llmProvider === 'glm') {
    llm = createGlmClient({ apiKey: requireEnv('GLM_API_KEY'), model: process.env.GLM_MODEL, baseUrl: process.env.GLM_BASE_URL });
    modelLabel = process.env.GLM_MODEL ?? 'glm-4-flash';
    log.info({ model: modelLabel }, 'LLM: GLM (Zhipu AI)');
  } else if (llmProvider === 'ollama') {
    llm = createOllamaClient({ baseUrl: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL, think: process.env.OLLAMA_THINK === 'true' });
    modelLabel = process.env.OLLAMA_MODEL ?? 'qwen3.5:2b';
    log.info({ model: modelLabel, baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434' }, 'LLM: Ollama');
  } else if (llmProvider === 'deepseek') {
    llm = createDeepSeekClient({ apiKey: requireEnv('DEEPSEEK_API_KEY'), model: process.env.DEEPSEEK_MODEL, baseUrl: process.env.DEEPSEEK_BASE_URL });
    modelLabel = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    log.info({ model: modelLabel }, 'LLM: DeepSeek');
  } else if (llmProvider === 'memphis') {
    const memphisLlmUrl = process.env.MEMPHIS_API_URL;
    if (!memphisLlmUrl) throw new Error('LLM_PROVIDER=memphis requires MEMPHIS_API_URL');
    llm = createMemphisLlmClient({ apiUrl: memphisLlmUrl, apiToken: process.env.MEMPHIS_API_TOKEN, model: process.env.MEMPHIS_LLM_MODEL });
    modelLabel = process.env.MEMPHIS_LLM_MODEL ?? 'auto (via Memphis)';
    log.info({ apiUrl: memphisLlmUrl, model: modelLabel }, 'LLM: Memphis (proxied)');
  } else {
    throw new Error(`unknown LLM_PROVIDER: ${llmProvider} — use 'ollama', 'anthropic', 'deepseek', 'glm', 'minimax', or 'memphis'`);
  }

  // Memory — optional, fails open
  const memphisUrl = process.env.MEMPHIS_API_URL;
  const memory = memphisUrl
    ? createMemphisClient({ apiUrl: memphisUrl, apiToken: process.env.MEMPHIS_API_TOKEN })
    : createNullMemoryClient();

  if (!memphisUrl) {
    log.warn('MEMPHIS_API_URL not set — running without memory (conversations will not be recalled)');
  }

  // Channels
  const adapters: ChannelAdapter[] = [];

  if (process.env.TELEGRAM_BOT_TOKEN) {
    adapters.push(createTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN, {
      onStatus: () => [
        '🟢 Soul — online',
        `LLM: ${llmProvider} (${modelLabel})`,
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

  const chatMode = adapters.length === 0 || process.argv.includes('--chat');

  // MCP tools — connect to Memphis MCP server if URL is set
  const mcpUrl = process.env.MEMPHIS_MCP_URL;
  let toolExecutor: Awaited<ReturnType<typeof createMcpToolExecutor>> | undefined;

  if (mcpUrl) {
    try {
      toolExecutor = await createMcpToolExecutor({ serverUrl: mcpUrl, apiToken: process.env.MEMPHIS_API_TOKEN });
      log.info({ url: mcpUrl, tools: toolExecutor.listTools().map((t) => t.name) }, 'MCP tools connected');
    } catch (err) {
      log.warn({ err, url: mcpUrl }, 'MCP connection failed — running without tools');
    }
  } else if (!chatMode) {
    log.info('MEMPHIS_MCP_URL not set — running without MCP tools');
  }

  // Sessions — persistent if OPENCLAW_DATA_DIR is set, in-memory otherwise
  const dataDir = process.env.OPENCLAW_DATA_DIR;
  const sessions = dataDir
    ? createFileSessionStore(dataDir)
    : createMemorySessionStore();

  if (dataDir) {
    log.info({ dataDir }, 'session persistence enabled');
  }

  // ── Interactive terminal mode ───────────────────────────────────────────
  if (chatMode) {
    const config: GatewayConfig = {
      adapters: [],
      memory,
      llm,
      systemPrompt: process.env.OPENCLAW_SYSTEM_PROMPT,
      toolExecutor,
      sessions,
    };

    // Dummy adapter map for handleMessage
    const adapterMap = new Map<string, ChannelAdapter>();
    const replies: string[] = [];
    adapterMap.set('terminal', {
      name: 'terminal',
      async start() {},
      async send(_chatId: string, text: string) { replies.push(text); },
      async stop() {},
    });

    // TUI
    const D = '\x1b[2m';
    const B = '\x1b[1m';
    const R = '\x1b[0m';
    const C = '\x1b[36m';
    const G = '\x1b[32m';
    const Y = '\x1b[33m';
    const hr = () => D + '\u2500'.repeat(Math.min(process.stdout.columns ?? 72, 72)) + R;
    const frames = ['\u28CB', '\u28D9', '\u28F9', '\u28F8', '\u28FC', '\u28F4', '\u28E6', '\u28E7', '\u28C7', '\u28CF'];

    console.log('');
    console.log(`${B}${C}  OpenClaw Interactive${R}`);
    console.log(`  ${D}Provider :${R} ${Y}${llmProvider}${R}`);
    console.log(`  ${D}Model    :${R} ${Y}${modelLabel}${R}`);
    console.log(`  ${D}Memory   :${R} ${Y}${memphisUrl ? 'Memphis' : 'off'}${R}`);
    console.log(`  ${D}Tools    :${R} ${Y}${toolExecutor ? toolExecutor.listTools().length + ' MCP tools' : 'none'}${R}`);
    console.log(`  ${D}Type a message. Ctrl+C to quit.${R}`);
    console.log(hr());
    console.log('');

    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${C}${B}You${R}${D} \u203A ${R}`, terminal: true });
    rl.prompt();

    rl.on('line', (line: string) => {
      const text = line.trim();
      if (!text) { rl.prompt(); return; }
      if (text === '/quit' || text === '/exit') { console.log(`\n  ${D}goodbye${R}\n`); process.exit(0); }
      if (text === '/clear') { console.clear(); rl.prompt(); return; }

      let fi = 0;
      const spinner = setInterval(() => {
        process.stdout.write(`\r  ${D}${frames[fi++ % frames.length]} thinking...${R}`);
      }, 80);

      const t0 = Date.now();
      replies.length = 0;

      void handleMessage(
        { id: String(Date.now()), channel: 'terminal', userId: 'terminal:local', chatId: 'terminal', text, timestamp: new Date() },
        config,
        adapterMap,
      ).then(() => {
        clearInterval(spinner);
        process.stdout.write('\r\x1b[K');
        const ms = Date.now() - t0;
        for (const reply of replies) {
          console.log(`${G}${B}Soul${R} ${D}${ms}ms${R}`);
          console.log('');
          for (const l of reply.split('\n')) console.log(`  ${l}`);
          console.log('');
        }
        console.log(hr());
        console.log('');
        rl.prompt();
      }).catch((err) => {
        clearInterval(spinner);
        process.stdout.write('\r\x1b[K');
        console.log(`  \x1b[31merror:\x1b[0m ${err instanceof Error ? err.message : String(err)}\n`);
        rl.prompt();
      });
    });

    rl.on('close', () => { console.log(''); process.exit(0); });
    return;
  }

  // ── Normal daemon mode ─────────────────────────────────────────────────
  if (adapters.length === 0) {
    throw new Error(
      'no channel tokens configured — set TELEGRAM_BOT_TOKEN and/or DISCORD_BOT_TOKEN, or use --chat',
    );
  }

  const gateway = await startGateway({
    adapters,
    memory,
    llm,
    systemPrompt: process.env.OPENCLAW_SYSTEM_PROMPT,
    toolExecutor,
    sessions,
  });

  log.info({ channels: adapters.map((a) => a.name) }, 'gateway running');

  // Graceful shutdown
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info({ signal }, 'shutting down');
      void Promise.all([
        gateway.stop(),
        toolExecutor?.close(),
      ]).then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  log.error({ err: error }, 'fatal error');
  process.exit(1);
});
