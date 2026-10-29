import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { restoreDraft } from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const POST: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;
  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少草稿 ID。');

  const draft = restoreDraft(getDatabase(), auth.ownerId, id);
  if (!draft) return jsonError(404, 'NOT_FOUND', '找不到这篇草稿。');
  return jsonOk({ ...draft, sourceCount: draft.citations.length });
};

export const OPTIONS: APIRoute = () => preflight();
