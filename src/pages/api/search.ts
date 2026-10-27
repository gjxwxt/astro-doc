import type { APIRoute } from 'astro';

import { clientKey, rateLimit } from '@/lib/rate-limit';
import { loadSearchIndex } from '@/lib/retrieve';
import { searchDocs } from '@/lib/search';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const limit = rateLimit(clientKey(request, 'search'), 60, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: '请求太频繁，稍后再试。' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    );
  }

  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const max = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 8));
  if (!query) return Response.json({ query, count: 0, results: [] });

  try {
    const entries = await loadSearchIndex(request);
    const results = searchDocs(entries, query, max).map((hit) => ({
      title: hit.doc.title,
      url: hit.doc.url,
      type: hit.doc.type,
      description: hit.doc.description ?? '',
      snippet: hit.snippet,
      score: Number(hit.score.toFixed(2)),
    }));
    return Response.json({ query, count: results.length, results });
  } catch (error) {
    return Response.json(
      {
        error: '搜索索引暂时不可用。',
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 503 },
    );
  }
};
