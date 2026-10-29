import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { getSynthesisRun } from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';
import { cancelSynthesis } from '@/lib/synthesis/runner';

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
  if (!id) return jsonError(400, 'INVALID_ID', '缺少任务 ID。');

  const db = getDatabase();
  const run = getSynthesisRun(db, auth.ownerId, id);
  if (!run) return jsonError(404, 'NOT_FOUND', '找不到这个合成任务。');
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return jsonError(409, 'NOT_RUNNING', '这个任务已经结束。');
  }

  cancelSynthesis(run.id);
  return jsonOk({ id: run.id, status: 'cancelling' }, 202);
};

export const OPTIONS: APIRoute = () => preflight();
