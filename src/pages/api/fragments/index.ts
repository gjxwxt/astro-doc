import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  DuplicateFragmentError,
  FragmentError,
  createFragment,
  type FragmentInput,
  listFragments,
  listTags,
} from '@/lib/db/fragments';
import { authenticate } from '@/lib/private-auth';
import {
  asRecord,
  jsonError,
  jsonOk,
  preflight,
  readJson,
} from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

function option(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

export const GET: APIRoute = ({ request }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? 50);
  const rawOffset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;

  try {
    const db = getDatabase();
    const result = listFragments(db, auth.ownerId, {
      query: option(url, 'query'),
      tag: option(url, 'tag'),
      status: option(url, 'status'),
      from: option(url, 'from'),
      to: option(url, 'to'),
      limit,
      offset,
    });
    return jsonOk({
      ...result,
      tags: listTags(db, auth.ownerId),
      limit,
      offset,
    });
  } catch (error) {
    console.error('[fragments:list]', error);
    return jsonError(500, 'INTERNAL_ERROR', '读取碎片失败。');
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const limit = rateLimit(clientKey(request, 'fragments:create'), 60, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '保存太频繁，稍后再试。');

  const body = await readJson(request);
  if (!body.ok) return body.response;

  try {
    const db = getDatabase();
    const result = createFragment(db, auth.ownerId, asRecord(body.value) as unknown as FragmentInput);
    return jsonOk(result.fragment, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof DuplicateFragmentError) {
      return jsonError(409, 'DUPLICATE', error.message, { fragmentId: error.fragmentId });
    }
    if (error instanceof FragmentError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('[fragments:create]', error);
    return jsonError(500, 'INTERNAL_ERROR', '保存碎片失败。');
  }
};

export const OPTIONS: APIRoute = () => preflight();
