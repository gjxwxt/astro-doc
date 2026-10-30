import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { generateReview, getReviewStats } from '@/lib/review';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = authenticate(request, process.env);
  if (!auth) {
    return jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。');
  }

  const limit = rateLimit(clientKey(request, 'review:generate'), 6, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '生成太频繁，稍后再试。');

  const stats = getReviewStats(getDatabase(), auth.ownerId);
  return jsonOk(await generateReview(stats, process.env));
};

export const OPTIONS: APIRoute = () => preflight();
