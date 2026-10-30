import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { getFragment, listFragments, listTags } from '@/lib/db/fragments';
import { organizeFragment } from '@/lib/organize';
import { authenticate } from '@/lib/private-auth';
import { asRecord, jsonError, jsonOk, preflight, readJson } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = authenticate(request, process.env);
  if (!auth) {
    return jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。');
  }

  const limit = rateLimit(clientKey(request, 'organize:suggest'), 20, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '整理太频繁，稍后再试。');

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const fragmentId = asRecord(body.value).fragmentId;
  if (typeof fragmentId !== 'string' || !fragmentId.trim()) {
    return jsonError(400, 'INVALID_ID', '缺少碎片 ID。');
  }

  const db = getDatabase();
  const fragment = getFragment(db, auth.ownerId, fragmentId.trim());
  if (!fragment) return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');

  const candidates = listFragments(db, auth.ownerId, { limit: 250 }).fragments;
  const knownTags = listTags(db, auth.ownerId);
  return jsonOk(
    await organizeFragment({
      fragment,
      candidates,
      knownTags,
      env: process.env,
    }),
  );
};

export const OPTIONS: APIRoute = () => preflight();
