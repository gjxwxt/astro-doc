import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { getDraft } from '@/lib/db/syntheses';
import { buildDraftExport, exportFilename } from '@/lib/drafts/export';
import { authenticate } from '@/lib/private-auth';
import { jsonError, preflight } from '@/lib/private-http';

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
  if (!id) return jsonError(400, 'INVALID_ID', '缺少草稿 ID。');

  const draft = getDraft(getDatabase(), auth.ownerId, id);
  if (!draft) return jsonError(404, 'NOT_FOUND', '找不到这篇草稿。');

  const filename = exportFilename(draft);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '-');
  return new Response(buildDraftExport(draft), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
};

export const OPTIONS: APIRoute = () => preflight();
