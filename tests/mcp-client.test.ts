import { describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the MCP client module.
 *
 * Since createMcpToolExecutor requires a live MCP server connection,
 * we test the ToolExecutor contract by mocking the MCP SDK client.
 */

// Mock the MCP SDK before importing
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const MockClient = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'memphis_journal',
          description: 'Save entries to journal chain',
          inputSchema: { type: 'object', properties: { content: { type: 'string' } } },
        },
        {
          name: 'memphis_recall',
          description: 'Semantic search across chains',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    }),
    callTool: vi.fn().mockImplementation(async (params: { name: string }) => {
      if (params.name === 'memphis_journal') {
        return {
          content: [{ type: 'text', text: '{"ok":true,"blockId":"b-123"}' }],
        };
      }
      if (params.name === 'memphis_recall') {
        return {
          content: [{ type: 'text', text: '{"results":[{"content":"hello","score":0.9}]}' }],
        };
      }
      if (params.name === 'error_tool') {
        return {
          content: [{ type: 'text', text: 'something went wrong' }],
          isError: true,
        };
      }
      return { content: [] };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }));

  return { Client: MockClient };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  const MockTransport = vi.fn().mockImplementation(() => ({}));
  return { StreamableHTTPClientTransport: MockTransport };
});

import { createMcpToolExecutor } from '../src/mcp/client.js';

describe('MCP tool executor', () => {
  it('discovers tools from MCP server', async () => {
    const executor = await createMcpToolExecutor({ serverUrl: 'http://127.0.0.1:3001/mcp' });

    const tools = executor.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('memphis_journal');
    expect(tools[1].name).toBe('memphis_recall');
    expect(tools[0].description).toBe('Save entries to journal chain');
    expect(tools[0].inputSchema).toEqual({
      type: 'object',
      properties: { content: { type: 'string' } },
    });

    await executor.close();
  });

  it('executes a tool call and returns text content', async () => {
    const executor = await createMcpToolExecutor({ serverUrl: 'http://127.0.0.1:3001/mcp' });

    const result = await executor.execute({
      id: 'tc-1',
      name: 'memphis_journal',
      arguments: { content: 'test entry' },
    });

    expect(result).toBe('{"ok":true,"blockId":"b-123"}');
    await executor.close();
  });

  it('executes recall tool', async () => {
    const executor = await createMcpToolExecutor({ serverUrl: 'http://127.0.0.1:3001/mcp' });

    const result = await executor.execute({
      id: 'tc-2',
      name: 'memphis_recall',
      arguments: { query: 'hello' },
    });

    expect(result).toContain('"results"');
    expect(result).toContain('"score":0.9');
    await executor.close();
  });

  it('returns error JSON when tool reports isError', async () => {
    const executor = await createMcpToolExecutor({ serverUrl: 'http://127.0.0.1:3001/mcp' });

    const result = await executor.execute({
      id: 'tc-3',
      name: 'error_tool',
      arguments: {},
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('something went wrong');
    await executor.close();
  });

  it('returns empty JSON for tool with no text content', async () => {
    const executor = await createMcpToolExecutor({ serverUrl: 'http://127.0.0.1:3001/mcp' });

    const result = await executor.execute({
      id: 'tc-4',
      name: 'unknown_tool',
      arguments: {},
    });

    // Empty content array → returns "{}"
    expect(result).toBe('{}');
    await executor.close();
  });

  it('closes cleanly', async () => {
    const executor = await createMcpToolExecutor({ serverUrl: 'http://127.0.0.1:3001/mcp' });
    await expect(executor.close()).resolves.toBeUndefined();
  });
});
