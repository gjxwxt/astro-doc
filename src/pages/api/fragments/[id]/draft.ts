import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';
import { createDraftFromFragment } from '@/lib/triage';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const POST: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:draft'), 30, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '操作太频繁，稍后再试。');

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少碎片 ID。');

  const result = createDraftFromFragment(getDatabase(), auth.ownerId, id);
  if (!result) return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');
  return jsonOk(result, result.created ? 201 : 200);
};

export const OPTIONS: APIRoute = () => preflight();
