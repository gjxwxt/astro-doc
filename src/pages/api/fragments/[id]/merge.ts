import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { FragmentError, mergeFragments } from '@/lib/db/fragments';
import { authenticate } from '@/lib/private-auth';
import { asRecord, jsonError, jsonOk, preflight, readJson } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const POST: APIRoute = async ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:merge'), 30, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '操作太频繁，稍后再试。');

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少目标碎片 ID。');

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const duplicateId = asRecord(body.value).duplicateId;
  if (typeof duplicateId !== 'string' || !duplicateId.trim()) {
    return jsonError(400, 'INVALID_INPUT', '请提供要合并的碎片 ID。');
  }

  try {
    const fragment = mergeFragments(getDatabase(), auth.ownerId, id, duplicateId.trim());
    if (!fragment) return jsonError(404, 'NOT_FOUND', '找不到要合并的碎片。');
    return jsonOk({ fragment, mergedId: duplicateId.trim() });
  } catch (error) {
    if (error instanceof FragmentError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('[fragments:merge]', error);
    return jsonError(500, 'INTERNAL_ERROR', '合并碎片失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
