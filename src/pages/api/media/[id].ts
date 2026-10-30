import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { countMediaReferences, deleteMedia, getMedia } from '@/lib/db/media';
import { removeLocalMedia } from '@/lib/media';
import { authenticate } from '@/lib/private-auth';
import { jsonError, jsonOk, preflight } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;

export const DELETE: APIRoute = async ({ request, params }) => {
  const auth = authenticate(request, process.env);
  if (!auth) {
    return jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。');
  }

  const limit = rateLimit(clientKey(request, 'media:delete'), 20, 60_000);
  if (!limit.ok) return jsonError(429, 'RATE_LIMITED', '删除太频繁，稍后再试。');

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少媒体 ID。');

  const db = getDatabase();
  const media = getMedia(db, auth.ownerId, id);
  if (!media) return jsonError(404, 'NOT_FOUND', '找不到这张图片。');

  const references = countMediaReferences(db, auth.ownerId, media.storageKey);
  if (references > 0) {
    return jsonError(
      409,
      'MEDIA_REFERENCED',
      `还有 ${references} 处碎片或草稿在引用这张图片，先处理引用再删除。`,
    );
  }

  if (!deleteMedia(db, auth.ownerId, media.id)) {
    return jsonError(404, 'NOT_FOUND', '找不到这张图片。');
  }

  if (media.storageDriver === 'local') {
    try {
      await removeLocalMedia(media.storageKey);
    } catch (error) {
      console.error('[media:delete] file cleanup failed', error);
    }
  }

  return jsonOk({ id: media.id, removed: true });
};

export const OPTIONS: APIRoute = () => preflight();
