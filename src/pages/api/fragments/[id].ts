import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  FragmentError,
  getFragment,
  softDeleteFragment,
  updateFragment,
} from '@/lib/db/fragments';
import { authenticate } from '@/lib/private-auth';
import {
  asRecord,
  jsonError,
  jsonOk,
  preflight,
  readJson,
} from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

function fragmentId(params: Record<string, string | undefined>): string {
  return params.id?.trim() ?? '';
}

export const GET: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const id = fragmentId(params);
  if (!id) return jsonError(400, 'INVALID_ID', '缺少碎片 ID。');

  const fragment = getFragment(getDatabase(), auth.ownerId, id);
  if (!fragment) return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');
  return jsonOk(fragment);
};

export const PATCH: APIRoute = async ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:update'), 120, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '操作太频繁，稍后再试。');

  const id = fragmentId(params);
  if (!id) return jsonError(400, 'INVALID_ID', '缺少碎片 ID。');

  const body = await readJson(request);
  if (!body.ok) return body.response;

  try {
    const patch = asRecord(body.value);
    const fragment = updateFragment(getDatabase(), auth.ownerId, id, {
      note: typeof patch.note === 'string' ? patch.note : undefined,
      tags: Array.isArray(patch.tags) ? (patch.tags as string[]) : undefined,
      status: typeof patch.status === 'string' ? patch.status : undefined,
    });
    if (!fragment) return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');
    return jsonOk(fragment);
  } catch (error) {
    if (error instanceof FragmentError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('[fragments:update]', error);
    return jsonError(500, 'INTERNAL_ERROR', '更新碎片失败。');
  }
};

export const DELETE: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:delete'), 60, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '操作太频繁，稍后再试。');

  const id = fragmentId(params);
  if (!id) return jsonError(400, 'INVALID_ID', '缺少碎片 ID。');

  if (!softDeleteFragment(getDatabase(), auth.ownerId, id)) {
    return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');
  }
  return jsonOk({ id, deleted: true });
};

export const OPTIONS: APIRoute = () => preflight();
