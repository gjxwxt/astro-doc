import type { APIRoute } from 'astro';

import { hasAiKey } from '@/lib/ai';

export const prerender = false;

export const GET: APIRoute = () =>
  Response.json({
    ok: true,
    ai: hasAiKey(process.env),
    mediaResolver: Boolean(process.env.MEDIA_RESOLVER_URL),
    time: new Date().toISOString(),
  });
