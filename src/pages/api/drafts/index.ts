import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { listDrafts, type DraftStatus } from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

function statusValue(value: string | null): DraftStatus | undefined {
  return value === 'draft' || value === 'exported' || value === 'archived' ? value : undefined;
}

export const GET: APIRoute = ({ request }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const db = getDatabase();
  const result = listDrafts(db, auth.ownerId, {
    status: statusValue(url.searchParams.get('status')),
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return jsonOk({
    ...result,
    drafts: result.drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      slug: draft.slug,
      status: draft.status,
      sourceCount: draft.citations.length,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    })),
    limit,
    offset,
  });
};

export const OPTIONS: APIRoute = () => preflight();
