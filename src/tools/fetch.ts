const GITHUB_RE = /(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i;
// Matches full URLs (https://...) and bare domains (www.example.com or example.com/path)
const URL_RE = /(?:https?:\/\/[^\s]+|(?:www\.)[^\s]+)/gi;

function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

type FetchedContext = {
  url: string;
  content: string;
};

async function fetchGithubRepo(owner: string, repo: string): Promise<string> {
  const headers: HeadersInit = { 'User-Agent': 'OpenClaw/1.0', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;

  const [repoRes, readmeRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(8000) }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers, signal: AbortSignal.timeout(8000) }),
  ]);

  const parts: string[] = [];

  if (repoRes.ok) {
    const data = await repoRes.json() as {
      description?: string;
      stargazers_count?: number;
      language?: string;
      topics?: string[];
      updated_at?: string;
    };
    parts.push(`Repo: ${owner}/${repo}`);
    if (data.description) parts.push(`Description: ${data.description}`);
    if (data.language) parts.push(`Language: ${data.language}`);
    if (data.stargazers_count != null) parts.push(`Stars: ${data.stargazers_count}`);
    if (data.topics?.length) parts.push(`Topics: ${data.topics.join(', ')}`);
    if (data.updated_at) parts.push(`Last updated: ${data.updated_at}`);
  }

  if (readmeRes.ok) {
    const data = await readmeRes.json() as { content?: string };
    if (data.content) {
      const text = Buffer.from(data.content, 'base64').toString('utf8');
      // Trim README to first 1500 chars to avoid context bloat
      parts.push(`\nREADME (first 1500 chars):\n${text.slice(0, 1500)}`);
    }
  }

  return parts.join('\n');
}

async function fetchWebPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OpenClaw/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return `Failed to fetch ${url}: ${res.status}`;
  const html = await res.text();
  // Strip tags, collapse whitespace, trim to 2000 chars
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
  return text;
}

/**
 * Extracts URLs from a message, fetches their content, and returns
 * an array of { url, content } objects to inject into LLM context.
 */
export async function fetchUrlsFromMessage(text: string): Promise<FetchedContext[]> {
  const urls = [...new Set(text.match(URL_RE) ?? [])].slice(0, 3); // max 3 URLs
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(
    urls.map(async (rawUrl): Promise<FetchedContext> => {
      const url = normalizeUrl(rawUrl);
      const ghMatch = url.match(GITHUB_RE);
      if (ghMatch) {
        const content = await fetchGithubRepo(ghMatch[1], ghMatch[2]);
        return { url, content };
      }
      const content = await fetchWebPage(url);
      return { url, content };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FetchedContext> => r.status === 'fulfilled')
    .map((r) => r.value);
}
