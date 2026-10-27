import type { APIRoute } from 'astro';

import { createChatResponse } from '@/lib/ai';
import { isAuthorized } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { retrieve } from '@/lib/retrieve';
import type { SearchHit } from '@/lib/search';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const env = process.env;
  if (!isAuthorized(request, env)) {
    return Response.json({ error: '未授权。' }, { status: 401 });
  }

  const limit = rateLimit(clientKey(request, 'chat'), 12, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: '问得太快了，等一会儿再试。' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 64_000) {
    return Response.json({ error: '请求体太大。' }, { status: 413 });
  }

  let body: { messages?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown };
  } catch {
    return Response.json({ error: '请求体不是合法 JSON。' }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: '缺少消息。' }, { status: 400 });
  }

  const lastUser = [...body.messages]
    .reverse()
    .find(
      (message): message is { role: string; content: string } =>
        Boolean(message) &&
        typeof message === 'object' &&
        (message as { role?: string }).role === 'user' &&
        typeof (message as { content?: unknown }).content === 'string',
    );

  const query = lastUser?.content.trim().slice(0, 1200) ?? '';
  if (!query) return Response.json({ error: '最后一条消息没有内容。' }, { status: 400 });

  let hits: SearchHit[] = [];
  try {
    hits = await retrieve(request, query, 6);
  } catch {
    // The assistant still works without retrieval; it will be less grounded.
  }

  return createChatResponse({ request, env, messages: body.messages, hits });
};
