import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { getFragment } from '@/lib/db/fragments';
import {
  createSynthesisRun,
  findActiveSynthesisRun,
} from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import {
  asRecord,
  jsonError,
  jsonOk,
  preflight,
  readJson,
} from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { aiRuntime } from '@/lib/synthesis/ai';
import { startSynthesis } from '@/lib/synthesis/runner';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const POST: APIRoute = async ({ request }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'synthesis:create'), 10, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '合成太频繁，稍后再试。');

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const value = asRecord(body.value);
  const fragmentIds = Array.isArray(value.fragmentIds)
    ? value.fragmentIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const uniqueIds = [...new Set(fragmentIds)].slice(0, 30);
  if (uniqueIds.length === 0) {
    return jsonError(400, 'INVALID_INPUT', '至少选一条碎片。');
  }
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim().slice(0, 4_000) : '';

  try {
    const db = getDatabase();
    const active = findActiveSynthesisRun(db, auth.ownerId);
    if (active) {
      return jsonError(409, 'RUN_IN_PROGRESS', '已有一个合成任务在运行。', {
        runId: active.id,
        status: active.status,
      });
    }

    const fragments = uniqueIds
      .map((id) => getFragment(db, auth.ownerId, id))
      .filter((fragment): fragment is NonNullable<typeof fragment> => Boolean(fragment));
    if (fragments.length === 0) {
      return jsonError(400, 'NO_FRAGMENTS', '选中的碎片都不存在。');
    }

    const runtime = aiRuntime();
    const run = createSynthesisRun(db, auth.ownerId, {
      fragmentIds: fragments.map((fragment) => fragment.id),
      prompt,
      model: runtime?.model || 'local-structure',
    });
    startSynthesis(run.id);
    return jsonOk(
      {
        id: run.id,
        status: 'queued',
        ai: Boolean(runtime),
        model: runtime?.model || 'local-structure',
        fragmentIds: run.fragmentIds,
        skipped: uniqueIds.filter((id) => !fragments.some((fragment) => fragment.id === id)),
      },
      202,
    );
  } catch (error) {
    console.error('[synthesis:create]', error);
    return jsonError(500, 'INTERNAL_ERROR', '创建合成任务失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
