import pino from 'pino';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { ToolCall, ToolDefinition, ToolExecutor } from '../gateway/types.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export type McpToolExecutorConfig = {
  /** Memphis MCP server URL, e.g. http://127.0.0.1:3001/mcp */
  serverUrl: string;
  /** How long to wait for connection (ms). Default: 10_000 */
  connectTimeoutMs?: number;
};

/**
 * Creates a ToolExecutor backed by a Memphis MCP server.
 *
 * On `connect()`, it discovers tools via MCP `tools/list`.
 * On `execute()`, it calls tools via MCP `tools/call` and extracts text content.
 */
export async function createMcpToolExecutor(
  config: McpToolExecutorConfig,
): Promise<ToolExecutor & { close(): Promise<void> }> {
  const client = new Client(
    { name: 'openclaw', version: '0.1.0' },
    { capabilities: {} },
  );

  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl));

  const timeoutMs = config.connectTimeoutMs ?? 10_000;
  const connectPromise = client.connect(transport);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`MCP connect timeout after ${timeoutMs}ms`)), timeoutMs),
  );

  await Promise.race([connectPromise, timeoutPromise]);
  log.info({ url: config.serverUrl }, 'MCP client connected');

  // Discover tools
  const toolsResult = await client.listTools();
  const mcpTools = toolsResult.tools;

  const tools: ToolDefinition[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  log.info({ tools: tools.map((t) => t.name) }, 'MCP tools discovered');

  return {
    listTools(): ToolDefinition[] {
      return tools;
    },

    async execute(call: ToolCall): Promise<string> {
      log.info({ tool: call.name, id: call.id }, 'MCP tool call');

      const result = await client.callTool({
        name: call.name,
        arguments: call.arguments,
      });

      // Extract text from content blocks
      if ('content' in result && Array.isArray(result.content)) {
        const texts = result.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map((block) => block.text);

        if (result.isError) {
          return JSON.stringify({ error: texts.join('\n') || 'tool returned error' });
        }

        return texts.join('\n') || JSON.stringify(result.structuredContent ?? {});
      }

      // Fallback: return raw result as JSON
      return JSON.stringify(result);
    },

    async close(): Promise<void> {
      await client.close();
      log.info('MCP client closed');
    },
  };
}
