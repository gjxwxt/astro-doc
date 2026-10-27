import type { SearchDoc, SearchHit } from './search';
import { searchDocs } from './search';

interface CacheEntry {
  at: number;
  data: SearchDoc[];
}

const cache = new Map<string, CacheEntry>();
const TTL = 60_000;

export async function loadSearchIndex(request: Request): Promise<SearchDoc[]> {
  const origin = new URL(request.url).origin;
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  const response = await fetch(new URL('/search-index.json', origin), {
    headers: { accept: 'application/json', 'x-portal-internal': '1' },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`Search index returned ${response.status}.`);
  const data = (await response.json()) as { entries?: SearchDoc[] };
  const entries = Array.isArray(data.entries) ? data.entries : [];
  cache.set(origin, { at: Date.now(), data: entries });
  return entries;
}

export async function retrieve(request: Request, query: string, limit = 6): Promise<SearchHit[]> {
  const entries = await loadSearchIndex(request);
  return searchDocs(entries, query, limit);
}
