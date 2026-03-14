import type { MemoryClient, RecalledContext } from '../gateway/types.js';

type MemphisConfig = {
  apiUrl: string;
  apiToken?: string;
};

type RecallHit = { id: string; score: number; text_preview: string };
type RecallResponse = {
  ok: boolean;
  results: { query: string; count: number; hits: RecallHit[] };
};

/**
 * Memphis HTTP memory client.
 *
 * Talks to the Memphis v5 Fastify API (MEMPHIS_API_URL).
 * Fails open — if Memphis is unreachable, recall returns empty and store is a no-op.
 * This lets OpenClaw run without a Memphis instance during development.
 */
export function createMemphisClient(config: MemphisConfig): MemoryClient {
  let _available = true;

  function headers(): HeadersInit {
    return config.apiToken
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiToken}` }
      : { 'Content-Type': 'application/json' };
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Memphis ${path} returned ${String(res.status)}`);
    return res.json() as Promise<unknown>;
  }

  return {
    isAvailable() {
      return _available;
    },

    async recall(userId: string, query: string, limit = 5): Promise<RecalledContext> {
      try {
        // Request more than needed so we have headroom after userId filtering
        const data = await post('/api/recall', { userId, query, limit: limit * 3 }) as RecallResponse;
        _available = true;
        const userTag = `[${userId}]`;
        const hits = (data.results?.hits ?? [])
          .filter((h) => h.text_preview.includes(userTag))
          .slice(0, limit);
        return {
          items: hits.map((h) => ({ content: h.text_preview, score: h.score })),
        };
      } catch {
        _available = false;
        return { items: [] };
      }
    },

    async store(userId: string, userText: string, assistantReply: string): Promise<void> {
      try {
        await post('/api/journal', {
          content: `[${userId}] User: ${userText}\nAssistant: ${assistantReply}`,
          tags: [userId, 'conversation'],
        });
        _available = true;
      } catch {
        _available = false;
      }
    },
  };
}

/**
 * No-op memory client for running without Memphis.
 */
export function createNullMemoryClient(): MemoryClient {
  return {
    isAvailable: () => false,
    async recall() { return { items: [] }; },
    async store() { /* no-op */ },
  };
}
