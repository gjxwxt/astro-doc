import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  createSynthesisRun,
  findActiveSynthesisRun,
  getSynthesisRun,
} from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';
import { aiRuntime } from '@/lib/synthesis/ai';
import { startSynthesis } from '@/lib/synthesis/runner';

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
  const old = getSynthesisRun(db, auth.ownerId, id);
  if (!old) return jsonError(404, 'NOT_FOUND', '找不到这个合成任务。');
  if (old.status !== 'failed' && old.status !== 'cancelled') {
    return jsonError(409, 'NOT_RETRYABLE', '只有失败或已取消的任务可以重试。');
  }
  const active = findActiveSynthesisRun(db, auth.ownerId);
  if (active) {
    return jsonError(409, 'RUN_IN_PROGRESS', '已有一个合成任务在运行。', {
      runId: active.id,
      status: active.status,
    });
  }

  const runtime = aiRuntime();
  const run = createSynthesisRun(db, auth.ownerId, {
    fragmentIds: old.fragmentIds,
    prompt: old.prompt,
    model: runtime?.model || 'local-structure',
  });
  startSynthesis(run.id);
  return jsonOk({ id: run.id, status: 'queued', retryOf: old.id }, 202);
};

export const OPTIONS: APIRoute = () => preflight();
