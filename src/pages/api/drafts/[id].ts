import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  getDraft,
  softDeleteDraft,
  updateDraft,
  type DraftStatus,
} from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import {
  asRecord,
  jsonError,
  jsonOk,
  preflight,
  readJson,
} from '@/lib/private-http';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

function draftId(params: Record<string, string | undefined>): string {
  return params.id?.trim() ?? '';
}

function statusValue(value: unknown): DraftStatus | undefined {
  return value === 'draft' || value === 'exported' || value === 'archived' ? value : undefined;
}

export const GET: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;
  const id = draftId(params);
  if (!id) return jsonError(400, 'INVALID_ID', '缺少草稿 ID。');

  const draft = getDraft(getDatabase(), auth.ownerId, id);
  if (!draft) return jsonError(404, 'NOT_FOUND', '找不到这篇草稿。');
  return jsonOk({ ...draft, sourceCount: draft.citations.length });
};

export const PATCH: APIRoute = async ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;
  const id = draftId(params);
  if (!id) return jsonError(400, 'INVALID_ID', '缺少草稿 ID。');

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const value = asRecord(body.value);
  if (value.title !== undefined && typeof value.title !== 'string') {
    return jsonError(400, 'INVALID_INPUT', '标题格式不对。');
  }
  if (value.markdown !== undefined && typeof value.markdown !== 'string') {
    return jsonError(400, 'INVALID_INPUT', '正文格式不对。');
  }
  if (value.status !== undefined && statusValue(value.status) === undefined) {
    return jsonError(400, 'INVALID_INPUT', '状态只能是 draft / exported / archived。');
  }
  if (typeof value.title === 'string' && !value.title.trim()) {
    return jsonError(400, 'INVALID_INPUT', '标题不能为空。');
  }

  const draft = updateDraft(getDatabase(), auth.ownerId, id, {
    title: typeof value.title === 'string' ? value.title : undefined,
    markdown: typeof value.markdown === 'string' ? value.markdown : undefined,
    status: statusValue(value.status),
  });
  if (!draft) return jsonError(404, 'NOT_FOUND', '找不到这篇草稿。');
  return jsonOk({ ...draft, sourceCount: draft.citations.length });
};

export const DELETE: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;
  const id = draftId(params);
  if (!id) return jsonError(400, 'INVALID_ID', '缺少草稿 ID。');

  if (!softDeleteDraft(getDatabase(), auth.ownerId, id)) {
    return jsonError(404, 'NOT_FOUND', '找不到这篇草稿。');
  }
  return jsonOk({ id, deleted: true });
};

export const OPTIONS: APIRoute = () => preflight();
