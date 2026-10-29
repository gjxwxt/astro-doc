import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  getSynthesisRun,
  listSynthesisEvents,
} from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const GET: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少任务 ID。');

  const db = getDatabase();
  const run = getSynthesisRun(db, auth.ownerId, id);
  if (!run) return jsonError(404, 'NOT_FOUND', '找不到这个合成任务。');

  const url = new URL(request.url);
  const after = Number(url.searchParams.get('after') ?? request.headers.get('last-event-id') ?? 0);
  return jsonOk({
    run,
    events: listSynthesisEvents(db, run.id, Number.isFinite(after) ? after : 0),
  });
};

export const OPTIONS: APIRoute = () => preflight();
