import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { FragmentError, updateFragmentsStatus } from '@/lib/db/fragments';
import { authenticate } from '@/lib/private-auth';
import { asRecord, jsonError, jsonOk, preflight, readJson } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const POST: APIRoute = async ({ request }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:bulk'), 30, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '操作太频繁，稍后再试。');

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const value = asRecord(body.value);
  if (!Array.isArray(value.ids) || value.ids.some((id) => typeof id !== 'string')) {
    return jsonError(400, 'INVALID_INPUT', 'ids 必须是字符串数组。');
  }
  if (typeof value.status !== 'string') {
    return jsonError(400, 'INVALID_INPUT', '请提供 status。');
  }

  try {
    const updated = updateFragmentsStatus(
      getDatabase(),
      auth.ownerId,
      value.ids as string[],
      value.status,
    );
    return jsonOk({ updated, status: value.status });
  } catch (error) {
    if (error instanceof FragmentError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('[fragments:bulk]', error);
    return jsonError(500, 'INTERNAL_ERROR', '批量操作失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
