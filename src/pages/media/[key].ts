import type { APIRoute } from 'astro';

import { isMediaKey, mimeForKey, readLocalMedia } from '@/lib/media';

export const prerender = false;

async function mediaResponse(key: string, headOnly: boolean): Promise<Response> {
  if (!isMediaKey(key)) return new Response('Not found', { status: 404 });
  const bytes = await readLocalMedia(key);
  if (!bytes) return new Response('Not found', { status: 404 });

  const headers = {
    'content-type': mimeForKey(key),
    'content-length': String(bytes.byteLength),
    'content-disposition': `inline; filename="${key}"`,
    'cache-control': 'public, max-age=31536000, immutable',
    'cross-origin-resource-policy': 'cross-origin',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
  };
  return new Response(headOnly ? null : Buffer.from(bytes), { status: 200, headers });
}

export const GET: APIRoute = ({ params }) => mediaResponse(params.key?.trim() ?? '', false);
export const HEAD: APIRoute = ({ params }) => mediaResponse(params.key?.trim() ?? '', true);
