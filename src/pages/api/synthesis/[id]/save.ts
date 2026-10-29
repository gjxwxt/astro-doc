import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { createDraft, getSynthesisRun } from '@/lib/db/syntheses';
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

function slugify(value: string, id: string): string {
  const base = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'draft'}-${id.slice(0, 8)}`;
}

export const POST: APIRoute = async ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少任务 ID。');

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const titleInput = asRecord(body.value).title;
  const title = typeof titleInput === 'string' ? titleInput.trim().slice(0, 500) : '';

  const db = getDatabase();
  const run = getSynthesisRun(db, auth.ownerId, id);
  if (!run) return jsonError(404, 'NOT_FOUND', '找不到这个合成任务。');
  if (run.status !== 'completed' || !run.resultMarkdown) {
    return jsonError(409, 'NOT_COMPLETED', '合成还没完成，不能保存草稿。');
  }

  const planTitle =
    run.outline && typeof run.outline === 'object' && !Array.isArray(run.outline)
      ? (run.outline as { title?: unknown }).title
      : '';
  const fallbackTitle = typeof planTitle === 'string' ? planTitle : '未命名草稿';
  const finalTitle = title || fallbackTitle;
  const citations = run.citations ?? [];

  const existing = db
    .prepare(
      'SELECT id, title, slug FROM drafts WHERE owner_id = ? AND synthesis_run_id = ? LIMIT 1',
    )
    .get(auth.ownerId, run.id) as { id: string; title: string; slug: string } | undefined;
  if (existing) return jsonOk(existing);

  try {
    const draft = createDraft(db, auth.ownerId, {
      synthesisRunId: run.id,
      title: finalTitle,
      slug: slugify(finalTitle, run.id),
      markdown: run.resultMarkdown,
      citations,
    });
    return jsonOk(draft, 201);
  } catch (error) {
    console.error('[synthesis:save]', error);
    return jsonError(500, 'INTERNAL_ERROR', '保存草稿失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
