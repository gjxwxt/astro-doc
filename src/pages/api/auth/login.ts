import type { APIRoute } from 'astro';

import {
  createSessionToken,
  isSecureRequest,
  sessionCookie,
  verifyAdminPassword,
} from '@/lib/private-auth';
import { asRecord, jsonError, readJson } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const env = process.env;
  const limit = rateLimit(clientKey(request, 'private-login'), 5, 60_000);
  if (!limit.ok) {
    return jsonError(429, 'RATE_LIMITED', '尝试次数太多，等一会儿再试。');
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const password = asRecord(body.value).password;
  const adminPassword = env.ADMIN_PASSWORD?.trim();
  const secret = env.SESSION_SECRET?.trim();
  if (!adminPassword || !secret) {
    return jsonError(503, 'NOT_CONFIGURED', '私有入口还没有配置 ADMIN_PASSWORD / SESSION_SECRET。');
  }

  if (!verifyAdminPassword(password, env)) {
    return jsonError(401, 'INVALID_PASSWORD', '密码不对。');
  }

  const token = createSessionToken(secret);
  const response = Response.json(
    { ok: true },
    { headers: { 'cache-control': 'no-store' } },
  );
  response.headers.append('set-cookie', sessionCookie(token, isSecureRequest(request, env)));
  return response;
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204 });
