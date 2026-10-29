import type { APIRoute } from 'astro';

import { clearSessionCookie, isSecureRequest } from '@/lib/private-auth';

export const prerender = false;

export const POST: APIRoute = ({ request }) => {
  const response = Response.json(
    { ok: true },
    { headers: { 'cache-control': 'no-store' } },
  );
  response.headers.append('set-cookie', clearSessionCookie(isSecureRequest(request, process.env)));
  return response;
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204 });
